import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CustomerReviewPage from "./customer-review";

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: mocks.request,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

const local = { id: 7, name: "Cedar legal", irrigoName: "Cedar Ridge", address: "7 Local Road" };
const fixture = () => ({
  held: [
    { id: 21, qbCustomerId: "qb-duplicate", qbName: "Cedar QB", qbAddress: "21 QB Road", kind: "possible_duplicate", candidateCustomer: local },
    { id: 22, qbCustomerId: "qb-child", qbName: "Child QB", qbAddress: "22 QB Road", kind: "sub_customer", candidateCustomer: null },
  ],
  unlinked: [{ customer: { id: 8, name: "Pine legal", irrigoName: "Pine Grove", address: "8 Local Road" }, candidates: [
    { qbId: "qb-pine", name: "Pine QB", address: "8 Remote Road", score: 0.9 },
    { qbId: "qb-other", name: "Other QB", address: "9 Remote Road", score: 0.4 },
  ] }],
});
type Fixture = ReturnType<typeof fixture> & { qbError?: string };

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue({ id: 7 });
  mocks.toast.mockReset();
});

function show(data?: Fixture, queryFn?: () => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity, queryFn: queryFn ?? (() => new Promise(() => {})),
  } } });
  if (data) client.setQueryData(["/api/customer-review"], data);
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const view = render(<QueryClientProvider client={client}><CustomerReviewPage /></QueryClientProvider>);
  return { client, invalidate, ...view };
}
async function open(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label, exact: true }));
  return screen.findByRole("alertdialog");
}
function approve(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: /^(?!Cancel$)/ }));
}

describe("customer review", () => {
  it("renders the fixed copy, badges, addresses, profile links and ranked labels without numeric scores", () => {
    show(fixture());
    expect(screen.getByRole("heading", { name: "Customer review" })).toBeTruthy();
    expect(screen.getByText("QuickBooks customers the sync held back, and IrrigoPro customers that aren't linked to QuickBooks. Nothing here changes until you confirm it.")).toBeTruthy();
    for (const text of ["Possible duplicate", "Filed under another customer in QuickBooks", "Matches IrrigoPro customer:",
      "Strong match", "Possible match", "21 QB Road", "22 QB Road", "8 Local Road", "8 Remote Road", "9 Remote Road"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "Cedar Ridge" }).getAttribute("href")).toBe("/customers/7/profile");
    expect(screen.getByRole("link", { name: "Pine Grove" }).getAttribute("href")).toBe("/customers/8/profile");
    expect(document.body.textContent).not.toMatch(/0\.9|0\.4/);
    expect(document.body.textContent!.indexOf("Cedar QB")).toBeLessThan(document.body.textContent!.indexOf("Child QB"));
  });

  it.each([
    [0.8, "Strong match"], [0.799, "Possible match"],
  ])("labels the threshold %s without exposing its numeric value", (score, label) => {
    const data = fixture();
    data.unlinked[0].candidates = [{ ...data.unlinked[0].candidates[0], score }];
    show(data);
    expect(screen.getByText(label)).toBeTruthy();
    expect(document.body.textContent).not.toContain(String(score));
  });

  it("asks before linking a held duplicate and invalidates all three caches before notifying", async () => {
    const { invalidate } = show(fixture());
    const dialog = await open("Link to Cedar Ridge");
    expect(dialog.textContent).toContain('Link Cedar Ridge to QuickBooks customer "Cedar QB"? Invoices for this customer will go to that QuickBooks customer. Its billing details will update from QuickBooks on the next sync.');
    expect(mocks.request).not.toHaveBeenCalled();
    approve(dialog);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.request.mock.calls).toEqual([["/api/customer-review/link", "POST", { customerId: 7, qbCustomerId: "qb-duplicate" }]]);
    for (const key of ["/api/customer-review", "/api/customer-review/summary", "/api/customers"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(Math.max(...invalidate.mock.invocationCallOrder)).toBeLessThan(mocks.toast.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("asks before ignoring and sends nothing on cancellation", async () => {
    show(fixture());
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore", exact: true })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain('Ignore "Cedar QB"? The QuickBooks sync will skip this customer from now on. It will not be created in IrrigoPro.');
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    ["Create as new customer", "/api/customer-review/21/create", 'Create "Cedar QB" as a new IrrigoPro customer? Use this only if it is not the same customer as Cedar Ridge.'],
    ["Create as its own customer", "/api/customer-review/22/create", 'QuickBooks files "Child QB" under another customer. IrrigoPro doesn\'t support that yet, so it will be created as its own separate customer. Continue?'],
    ["Not in QuickBooks", "/api/customer-review/not-in-quickbooks", "Mark Pine Grove as not in QuickBooks? It will leave this list and the sync will stop comparing it against new QuickBooks customers. It still can't be invoiced to QuickBooks."],
  ])("confirms %s with exact copy and request", async (label, path, text) => {
    const { invalidate } = show(fixture());
    const dialog = await open(label);
    expect(dialog.textContent).toContain(text);
    expect(mocks.request).not.toHaveBeenCalled();
    approve(dialog);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    if (label === "Not in QuickBooks") {
      expect(mocks.request.mock.calls).toEqual([[path, "POST", { customerId: 8, value: true }]]);
    } else {
      expect(mocks.request.mock.calls).toEqual([[path, "POST"]]);
    }
    expect(invalidate).toHaveBeenCalledTimes(3);
  });

  it("confirms an ignore POST to the selected review", async () => {
    show(fixture());
    fireEvent.click(screen.getAllByRole("button", { name: "Ignore", exact: true })[1]);
    approve(await screen.findByRole("alertdialog"));
    await waitFor(() => expect(mocks.request.mock.calls).toEqual([["/api/customer-review/22/dismiss", "POST"]]));
  });

  it("links an unlinked customer's chosen QB candidate", async () => {
    show(fixture());
    fireEvent.click(screen.getAllByRole("button", { name: "Link", exact: true })[1]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain('Link Pine Grove to QuickBooks customer "Other QB"? Invoices for this customer will go to that QuickBooks customer. Its billing details will update from QuickBooks on the next sync.');
    approve(dialog);
    await waitFor(() => expect(mocks.request.mock.calls).toEqual([["/api/customer-review/link", "POST", { customerId: 8, qbCustomerId: "qb-other" }]]));
  });

  it.each(["held", "unlinked"])("disables every action on a pending %s row and repeat confirmation", async kind => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockImplementation(() => new Promise(res => { resolve = res; }));
    show(fixture());
    const firstAction = kind === "held" ? "Link to Cedar Ridge" : "Not in QuickBooks";
    const row = screen.getByTestId(kind === "held" ? "row-held-21" : "card-unlinked-8");
    const dialog = await open(firstAction);
    approve(dialog);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    const confirmButton = within(dialog).getByRole("button", { name: /^(?!Cancel$)/ });
    expect(confirmButton).toHaveProperty("disabled", true);
    fireEvent.click(confirmButton);
    // Find row controls outside Radix's aria-hidden dialog background.
    const labels = kind === "held" ? ["Link to Cedar Ridge", "Create as new customer"] : ["Not in QuickBooks", "Link"];
    for (const label of labels) {
      const controls = Array.from(document.querySelectorAll("button")).filter(button => button.textContent === label);
      expect(controls.length).toBeGreaterThan(0);
      for (const button of controls) expect(button.disabled).toBe(true);
    }
    for (const button of row.querySelectorAll("button")) expect(button.disabled).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => resolve({}));
  });

  it("uses the server's message on error, without invalidating successful data", async () => {
    mocks.request.mockRejectedValue(new Error('409: {"message":"This customer was linked by someone else."}'));
    const { invalidate } = show(fixture());
    approve(await open("Link to Cedar Ridge"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: "destructive", description: "This customer was linked by someone else.",
    })));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("preserves local rows on QB failure and removes suggestions with the fixed warning and no-match copy", () => {
    show({ ...fixture(), qbError: "timeout" });
    expect(screen.getByText("Couldn't reach QuickBooks to suggest matches: timeout")).toBeTruthy();
    expect(screen.getByText("Cedar QB")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pine Grove" })).toBeTruthy();
    expect(screen.queryByText("Pine QB")).toBeNull();
    expect(screen.getByText("No likely QuickBooks match. Check the customer exists in QuickBooks, then sync customers.")).toBeTruthy();
  });

  it("shows no-match guidance when a successful QB read finds no candidates", () => {
    const data = fixture();
    data.unlinked[0].candidates = [];
    show(data);
    expect(screen.getByText("No likely QuickBooks match. Check the customer exists in QuickBooks, then sync customers.")).toBeTruthy();
  });
  it("keeps a deleted candidate's hold resolvable without an invalid profile or link action", async () => {
    const data = fixture();
    Object.assign(data.held[0], { candidateCustomer: null });
    show(data);
    expect(screen.queryByRole("link", { name: "Cedar Ridge" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Link to Cedar Ridge" })).toBeNull();
    const dialog = await open("Create as new customer");
    expect(dialog.textContent).toContain("The IrrigoPro customer it was matched to no longer exists.");
    approve(dialog);
    await waitFor(() => expect(mocks.request.mock.calls).toEqual([["/api/customer-review/21/create", "POST"]]));
  });
  it("shows both exact empty states", () => {
    show({ held: [], unlinked: [] });
    expect(screen.getByText("The sync hasn't held anything back.")).toBeTruthy();
    expect(screen.getByText("Every customer is linked to QuickBooks.")).toBeTruthy();
  });
  it("shows a loading skeleton rather than empty data", () => {
    show();
    expect(document.querySelector(".animate-pulse")).toBeTruthy();
    expect(screen.queryByText("Every customer is linked to QuickBooks.")).toBeNull();
  });
  it("shows a distinct failed-read state, never either empty state", async () => {
    show(undefined, () => Promise.reject(new Error('500: {"message":"Review database unavailable."}')));
    await screen.findByRole("button", { name: /retry|try again/i });
    expect(screen.queryByText("Every customer is linked to QuickBooks.")).toBeNull();
    expect(screen.queryByText("The sync hasn't held anything back.")).toBeNull();
  });

  it("registers routes only in the permitted shells and forbids browser confirmation", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const admin = readFileSync("src/components/company-admin-app.tsx", "utf8");
    const page = readFileSync("src/pages/customer-review.tsx", "utf8");
    expect(app.match(/path="\/customer-review"/g)).toHaveLength(2);
    expect(admin.match(/path="\/customer-review"/g)).toHaveLength(1);
    for (const role of ["bookkeeper", "billing_manager"]) {
      const shell = app.split(`if (user.role === "${role}")`)[1].split("if (user.role ===")[0];
      expect(shell).toMatch(/path="\/quickbooks"[^]*?\/>\s*<Route path="\/customer-review"/);
    }
    for (const role of ["irrigation_manager", "super_admin"]) {
      const shell = app.split(`if (user.role === "${role}")`)[1].split("if (user.role ===")[0];
      expect(shell).not.toContain('path="/customer-review"');
    }
    expect(page).not.toMatch(/window\.confirm|confirm\(/);
  });
});

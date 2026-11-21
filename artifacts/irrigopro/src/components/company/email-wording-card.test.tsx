import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanyEmailWordingEntry, EmailWordingContent } from "@workspace/api-client-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailWordingCard } from "./email-wording-card";

const proto = HTMLElement.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const defaults = {
  subject: "Final notice: Invoice {invoiceNumber}", eyebrow: "Final notice", headline: "Final notice",
  intro: "This is our final notice.", closing: "Please reply today.",
};
const final: CompanyEmailWordingEntry = {
  key: "reminder_final", label: "Reminder: final notice", placeholders: ["invoiceNumber"], defaults,
  wording: { ...defaults, intro: "This is the saved custom wording." }, isCustom: true,
  updatedAt: "2026-11-20T14:00:00Z", updatedBy: "Admin Person",
};
const invoice: CompanyEmailWordingEntry = {
  ...final, key: "invoice", label: "Invoice", isCustom: false, wording: { ...defaults, intro: "Invoice default." },
  updatedAt: null, updatedBy: null,
};
const path = "/api/company/123/email-wording";
const preview = (key: string) => `${path}/${key}/preview`;
let client: QueryClient;
let rows: CompanyEmailWordingEntry[];
const requests: { url: string; method: string; body?: EmailWordingContent }[] = [];
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  rows = [invoice, final];
  requests.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as EmailWordingContent : undefined;
    requests.push({ url: input, method, body });
    if (method === "GET" && input === path) return json(rows);
    if (method === "POST" && input.endsWith("/preview") && body) {
      if (body.intro.includes("{invoiceNumbr}")) return json({ fieldErrors: {
        subject: null, eyebrow: null, headline: null, closing: null,
        intro: "Unknown placeholder {invoiceNumbr}. Use one of: {invoiceNumber}.",
      } });
      return json({ subject: body.subject, text: body.intro, html: `<p>${body.intro}</p>`, fieldErrors: null });
    }
    if (input === `${path}/reminder_final` && method === "PUT" && body) {
      const saved = { ...final, wording: body };
      rows = [invoice, saved];
      return json(saved);
    }
    if (input === `${path}/reminder_final` && method === "DELETE") {
      rows = [invoice, { ...final, wording: final.defaults, isCustom: false, updatedAt: null, updatedBy: null }];
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${input}`);
  }));
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function mount() {
  client.setQueryData([path], rows);
  render(<QueryClientProvider client={client}><EmailWordingCard companyId={123} /><a href="/away">Other page</a></QueryClientProvider>);
  await tick(0);
}

function pick(key: string) {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByTestId(`option-customer-email-${key}`));
}

describe("Email wording card", () => {
  it("debounces the real API call, keeps the last good preview, disables Save on validation errors and saves the correction", async () => {
    await mount();
    pick("reminder_final");
    await tick(401);
    const intro = screen.getByLabelText("Opening paragraph");
    const save = screen.getByTestId<HTMLButtonElement>("button-save-email-wording");
    const frame = () => screen.getByTitle("Email preview");
    expect(frame().getAttribute("sandbox")).toBe("");
    expect(frame().getAttribute("srcdoc")).toContain(final.wording.intro);
    expect(save.disabled).toBe(true);
    const start = requests.filter(r => r.url === preview("reminder_final")).length;
    fireEvent.change(intro, { target: { value: "Follow up on {invoiceNumbr}." } });
    await tick(399);
    expect(requests.filter(r => r.url === preview("reminder_final"))).toHaveLength(start);
    expect(screen.getByText("Updating…")).toBeTruthy();
    expect(frame().getAttribute("srcdoc")).toContain(final.wording.intro);
    await tick(2);
    expect(screen.getByRole("alert").textContent).toContain("Unknown placeholder {invoiceNumbr}");
    expect(save.disabled).toBe(true);
    expect(frame().getAttribute("srcdoc")).toContain(final.wording.intro);
    fireEvent.change(intro, { target: { value: "Follow up on {invoiceNumber}." } });
    await tick(401);
    expect(frame().getAttribute("srcdoc")).toContain("Follow up on {invoiceNumber}.");
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await tick(10);
    expect(requests.find(r => r.method === "PUT")?.body?.intro).toBe("Follow up on {invoiceNumber}.");
    expect(save.disabled).toBe(true);
    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.getByText(/Last changed .* by Admin Person/)).toBeTruthy();
  });

  it("requires reset confirmation and restores the default preview", async () => {
    await mount();
    pick("reminder_final");
    await tick(401);
    fireEvent.click(screen.getByTestId("button-reset-email-wording"));
    expect(screen.getByRole("alertdialog").textContent).toContain("Reset Reminder: final notice to IrrigoPro's default wording?");
    fireEvent.click(screen.getByTestId("button-cancel-reset-email-wording"));
    expect(requests.some(r => r.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByTestId("button-reset-email-wording"));
    fireEvent.click(screen.getByTestId("button-confirm-reset-email-wording"));
    await tick(10);
    expect(requests.filter(r => r.method === "DELETE")).toHaveLength(1);
    expect(screen.queryByTestId("button-reset-email-wording")).toBeNull();
    await tick(401);
    expect(screen.getByTitle("Email preview").getAttribute("srcdoc")).toContain(defaults.intro);
  });

  it("inserts at the last focused cursor and confirms before switching or following a link", async () => {
    await mount();
    const subject = screen.getByLabelText<HTMLInputElement>("Subject");
    fireEvent.change(subject, { target: { value: "About  today." } });
    fireEvent.focus(subject);
    subject.setSelectionRange(6, 6);
    fireEvent.click(screen.getByTestId("button-insert-wording-invoiceNumber"));
    expect(subject.value).toBe("About {invoiceNumber} today.");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    pick("reminder_final");
    expect(confirm).toHaveBeenCalledWith("Discard your changes to Invoice?");
    expect(screen.getByLabelText<HTMLInputElement>("Subject").value).toBe(subject.value);
    expect(fireEvent.click(screen.getByText("Other page"))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    confirm.mockReturnValue(true);
    pick("reminder_final");
    expect(screen.getByLabelText<HTMLInputElement>("Opening paragraph").value).toBe(final.wording.intro);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
});

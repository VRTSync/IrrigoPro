import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BatchInvoiceSendDialog } from "./batch-invoice-send-dialog";

const reviewUrl = "/api/outgoing-email/invoice/batch/preview";
const startUrl = "/api/outgoing-email/invoice/batch";
const detailUrl = "/api/outgoing-email/batches/8";
const one = {
  invoiceId: 1, invoiceNumber: "IR-1008", customerLabel: "The Ranch", to: "ap@example.invalid",
  subject: "Irrigation Invoice IR-1008 – The Ranch – October 2026", amountDue: 45,
};
const skipped = {
  invoiceId: 2, invoiceNumber: "IR-1009", customerLabel: "Oak Bed",
  reason: "no_email", message: "No billing email for Oak Bed. Add one in QuickBooks and resync.",
};
const bootstrap = {
  id: 8, companyId: 1, status: "running", total: 2, queued: 0, sending: 1, sent: 0, skipped: 1, failed: 0,
  items: [{ ...one, id: 11, status: "sending" }, { ...skipped, id: 12, status: "skipped" }],
};
let progress: typeof bootstrap;
let requests: { url: string; body: Record<string, unknown> }[];
let guide: { filename: string } | null;

beforeEach(() => {
  progress = bootstrap;
  requests = [];
  guide = { filename: "Understanding Your Invoice.pdf" };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ url, body });
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (url === reviewUrl) return json({
      from: { name: "ABC Irrigation", email: "send@example.invalid" }, replyTo: "office@example.invalid",
      guide,
      willSend: [one], willSkip: [skipped], notFound: [3], confirmationToken: `token-${body.note}`, expiresAt: new Date().toISOString(),
    });
    if (url === "/api/outgoing-email/invoice/1/preview") return json({
      ...one, html: "<p>Invoice for The Ranch</p>", attachments: [{ filename: "IR-1008.pdf", viewUrl: "/api/invoices/1/pdf/download" }], confirmationToken: "single-send-token",
    });
    if (url === startUrl) return json({ batchId: 8 }, 202);
    if (url === detailUrl) return json(progress);
    if (url === `${detailUrl}/resume`) {
      progress = bootstrap;
      return json({ batchId: 8 }, 202);
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function show(batchId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <BatchInvoiceSendDialog open onOpenChange={onOpenChange} invoiceIds={[1, 2, 3]} batchId={batchId} />
    </QueryClientProvider>,
  );
  return { client, onOpenChange };
}

it("lists the full review without sending, and opens a sandboxed per-invoice email", async () => {
  show();
  await screen.findByText(one.subject);
  expect(screen.getByText(one.to)).toBeTruthy();
  expect(screen.getByText(skipped.message)).toBeTruthy();
  expect(screen.getByText(/Replies go to office@example.invalid/)).toBeTruthy();
  expect(screen.getByTestId("text-batch-invoice-guide")).toHaveTextContent("Each email also includes Understanding Your Invoice.pdf.");
  expect(screen.getByText(/Unavailable invoices: 1/)).toBeTruthy();
  expect(requests.some(({ url }) => url === startUrl)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "View email" }));
  const frame = await screen.findByTitle("Email for IR-1008");
  expect(frame.getAttribute("sandbox")).toBe("");
  expect(frame.getAttribute("srcdoc")).toBe("<p>Invoice for The Ranch</p>");
  expect(screen.getByText(/IR-1008\.pdf/)).toBeTruthy();
});

it("debounces note changes and can only send using the refreshed confirmation", async () => {
  guide = null;
  show();
  await screen.findByText(one.subject);
  expect(screen.queryByTestId("text-batch-invoice-guide")).not.toBeInTheDocument();
  const button = screen.getByTestId("button-confirm-invoice-batch");
  fireEvent.change(screen.getByLabelText("Note added to every email (optional)"), { target: { value: "Thank you" } });
  expect(button).toHaveProperty("disabled", true);
  expect(requests.filter(({ url }) => url === reviewUrl)).toHaveLength(1);
  fireEvent.click(button);
  expect(requests.some(({ url }) => url === startUrl)).toBe(false);
  await waitFor(() => expect(button).toHaveProperty("disabled", false), { timeout: 2000 });
  fireEvent.click(button);
  await screen.findByText("Invoice batch progress");
  expect(requests.find(({ url }) => url === startUrl)?.body).toEqual({
    invoiceIds: [1, 2, 3], note: "Thank you", confirmationToken: "token-Thank you",
  });
});

it("starts a batch, polls the updated rows, and invalidates the invoice list when complete", async () => {
  const { client, onOpenChange } = show();
  const invalidated = vi.spyOn(client, "invalidateQueries");
  await screen.findByText(one.subject);
  fireEvent.click(screen.getByTestId("button-confirm-invoice-batch"));
  const row = await screen.findByTestId("batch-invoice-progress-1");
  expect(within(row).getByText("Sending")).toBeTruthy();
  progress = { ...bootstrap, status: "completed", sending: 0, sent: 1,
    items: [{ ...bootstrap.items[0], status: "sent" }, bootstrap.items[1]],
  };
  await waitFor(() => expect(within(row).getByText("Sent")).toBeTruthy(), { timeout: 4000 });
  expect(screen.getByText("1 sent · 0 failed · 1 skipped · 0 to go")).toBeTruthy();
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ["/api/invoices"] });
  fireEvent.click(screen.getByTestId("button-close-invoice-batch"));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("reopens interrupted progress and resumes only through the resume endpoint", async () => {
  progress = { ...bootstrap, status: "interrupted", sending: 0, queued: 1,
    items: [{ ...bootstrap.items[0], status: "queued" }, bootstrap.items[1]],
  };
  show(8);
  await screen.findByText("Interrupted.");
  expect(within(screen.getByTestId("batch-invoice-progress-1")).getByText("Queued")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await screen.findByText("Sending");
  expect(requests.some(({ url }) => url === `${detailUrl}/resume`)).toBe(true);
  expect(requests.some(({ url }) => url === startUrl)).toBe(false);
});

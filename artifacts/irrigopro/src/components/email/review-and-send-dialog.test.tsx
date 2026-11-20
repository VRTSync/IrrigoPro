import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicePdfPreviewModal } from "@/components/billing/invoice-pdf-preview-modal";
import { ReviewAndSendDialog } from "./review-and-send-dialog";

const spies = vi.hoisted(() => ({ toast: vi.fn(), openAuthedPdf: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: spies.toast }) }));
vi.mock("@/lib/open-authed-pdf", () => ({ openAuthedPdf: spies.openAuthedPdf }));

// Radix Select pointer methods are not implemented in jsdom.
const proto = HTMLElement.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const base = "/api/outgoing-email/invoice/1008";
const subject = "Irrigation Invoice IR-1008 – The Ranch – October 2026";
const to = "billing@example.com";
const filename = "The Ranch - Irrigation Billing Detail - (10-1-26_10-31-26).pdf";
const download = "/api/invoices/1008/pdf/download";
const changed = "This invoice changed after you reviewed it. Review it again before sending.";
const sentAt = "2026-11-19T12:01:00.000Z";
const makePreview = (fields = {}, token = "review-one") => ({
  kind: "invoice", id: 1008, to, cc: [], bcc: [], subject, note: "", options: {}, optionDefs: [],
  from: { name: "High Plains Property Maintenance", email: "billing@highplainsprop.com" },
  replyTo: "office@highplainsprop.com", usingCompanyAddress: true,
  attachments: [{ filename, viewUrl: download }], warnings: [],
  html: "<h1>High Plains Property Maintenance</h1>", text: "High Plains Property Maintenance",
  confirmationToken: token, expiresAt: "2026-11-19T12:15:00Z", ...fields,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let api: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  spies.toast.mockReset();
  spies.openAuthedPdf.mockReset().mockResolvedValue({ ok: true });
  api = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url) === `${base}/preview` && init?.method === "POST") return json(makePreview());
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", api);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function openReview() {
  const onOpenChange = vi.fn();
  const onSent = vi.fn();
  render(<ReviewAndSendDialog open onOpenChange={onOpenChange} kind="invoice" entityId={1008} title="Send invoice IR-1008" onSent={onSent} />);
  return { onOpenChange, onSent };
}
const sendButton = () => screen.getByTestId("button-send-reviewed-email");
const postBody = (call: number) => JSON.parse(String(api.mock.calls[call][1]?.body));

describe("Review and Send", () => {
  it("opens estimate PDFs with POST and refreshes the review when the attachment is removed", async () => {
    const estimateBase = "/api/outgoing-email/estimate_resend/50123";
    const viewUrl = `${estimateBase}/attachment`;
    const warning = "The estimate date and approval link remain unchanged, and the 30-day window restarts from today's send.";
    api.mockImplementation(async (url, init) => {
      if (String(url) !== `${estimateBase}/preview` || init?.method !== "POST") throw new Error("Unexpected request");
      const attachPdf = JSON.parse(String(init.body)).options?.attachPdf ?? true;
      return json(makePreview({
        kind: "estimate_resend", id: 50123, subject: "Irrigation Estimate #50123 – The Ranch",
        options: { attachPdf }, optionDefs: [{ key: "attachPdf", label: "Attach the estimate as a PDF", default: true }],
        attachments: attachPdf ? [{ filename: "Estimate-50123.pdf", viewUrl }] : [],
        warnings: [warning], html: '<a href="about:blank#link-created-when-sent">Approve Estimate</a>',
      }));
    });
    render(<ReviewAndSendDialog open onOpenChange={() => {}} kind="estimate_resend" entityId={50123} title="Resend estimate #50123" />);
    expect(await screen.findByText(warning)).toBeVisible();
    expect(screen.getByTitle("Email preview")).toHaveAttribute("srcdoc", expect.stringContaining("link-created-when-sent"));
    const checkbox = screen.getByRole("checkbox", { name: "Attach the estimate as a PDF" });
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(spies.openAuthedPdf).toHaveBeenCalledWith(viewUrl, "POST", { confirmationToken: makePreview().confirmationToken });
    fireEvent.click(checkbox);
    expect(sendButton()).toBeDisabled();
    await waitFor(() => expect(screen.queryByText("Estimate-50123.pdf")).not.toBeInTheDocument(), { timeout: 1500 });
    expect(postBody(1).options).toEqual({ attachPdf: false });
    expect(sendButton()).toBeEnabled();
  });

  it("prefills from the server and shows its sender, sandboxed HTML and PDF attachment", async () => {
    openReview();
    expect(sendButton()).toBeDisabled();
    await screen.findByTitle("Email preview");
    expect(postBody(0)).toEqual({});
    expect(screen.getByLabelText("To")).toHaveValue(to);
    expect(screen.getByLabelText("Subject")).toHaveValue(subject);
    expect(screen.getByTestId("text-email-from")).toHaveTextContent("High Plains Property Maintenance <billing@highplainsprop.com>");
    expect(screen.getByTestId("text-email-replies")).toHaveTextContent("Replies go to office@highplainsprop.com");
    expect(screen.getByTitle("Email preview")).toHaveAttribute("sandbox", "");
    expect(screen.getByTitle("Email preview")).toHaveAttribute("srcdoc", makePreview().html);
    expect(screen.getByText(filename)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(spies.openAuthedPdf).toHaveBeenCalledWith(download);
    expect(sendButton()).toBeEnabled();
  });

  it("disables send on field edits, discards outdated preview responses, and sends the latest token", async () => {
    const { onOpenChange, onSent } = openReview();
    await screen.findByTitle("Email preview");
    const stale = defer<Response>();
    const latest = defer<Response>();
    api.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => latest.promise);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Stale edit" } });
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("Updating preview…")).toBeVisible();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2), { timeout: 1500 });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Current edit" } });
    expect(sendButton()).toBeDisabled();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3), { timeout: 1500 });
    await act(async () => stale.resolve(json(makePreview({ subject: "Stale edit" }, "stale"))));
    expect(screen.getByLabelText("Subject")).toHaveValue("Current edit");
    expect(sendButton()).toBeDisabled();
    expect(postBody(2)).toEqual({ to, cc: [], bcc: [], subject: "Current edit", note: "", options: {} });
    await act(async () => latest.resolve(json(makePreview({ subject: "Current edit" }, "review-two"))));
    expect(sendButton()).toBeEnabled();

    const delivery = defer<Response>();
    api.mockImplementationOnce(() => delivery.promise);
    fireEvent.click(sendButton());
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(api.mock.calls[3][0]).toBe(`${base}/send`);
    expect(postBody(3)).toEqual({ ...postBody(2), confirmationToken: "review-two" });
    await act(async () => delivery.resolve(json({ sentTo: to, sentAt })));
    expect(spies.toast).toHaveBeenCalledWith({ title: `Sent to ${to}` });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSent).toHaveBeenCalledWith({ sentTo: to, sentAt });
  });

  it("preserves the 409 message and fetches another review without sending again", async () => {
    openReview();
    await screen.findByTitle("Email preview");
    api.mockResolvedValueOnce(json({ message: changed }, 409));
    const refreshed = defer<Response>();
    api.mockImplementationOnce(() => refreshed.promise);
    fireEvent.click(sendButton());
    expect(await screen.findByText(changed)).toBeVisible();
    expect(sendButton()).toBeDisabled();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    expect(api.mock.calls[2][0]).toBe(`${base}/preview`);
    await act(async () => refreshed.resolve(json(makePreview({}, "review-refreshed"))));
    expect(sendButton()).toBeEnabled();
    expect(screen.getByText(changed)).toBeVisible();
  });

  it("shows the server's 422 and totals drift details instead of allowing reuse of the token", async () => {
    openReview();
    await screen.findByTitle("Email preview");
    api.mockResolvedValueOnce(json({
      message: "Invoice totals validation failed", validationFailure: {
        validationFailed: true, rowErrors: [], totalsError: { computedGrandTotal: 110, storedTotal: 120, delta: 10 },
      },
    }, 422));
    fireEvent.click(sendButton());
    expect(await screen.findByText("Invoice totals validation failed")).toBeVisible();
    expect(screen.getByText(/Line items sum to \$110.00/)).toBeVisible();
    expect(sendButton()).toBeDisabled();
  });
});

describe("Invoice PDF modal", () => {
  for (const button of ["Send to Customer", "Send the invoice"]) {
    it(`opens the same review from "${button}" rather than sending directly`, async () => {
      localStorage.setItem("user", JSON.stringify({ role: "billing_manager", id: 7, companyId: 1 }));
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => {
        if (queryKey[2] === "pdf") return { filename };
        if (queryKey[2] === "ar-notes") return { notes: [] };
        if (queryKey[2] === "reminders") return {
          refusal: { reason: "never_sent", message: "The invoice has not been sent.", action: { kind: "send_invoice", label: "Send the invoice" } },
          reminders: [], templates: [], balanceDue: "10", daysOverdue: 8,
        };
        return [];
      } } } });
      render(
        <QueryClientProvider client={queryClient}>
          <InvoicePdfPreviewModal invoiceId={1008} invoiceNumber="IR-1008" customerEmail="stale@example.com" open onOpenChange={() => {}} />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: button }));
      await screen.findByTitle("Email preview");
      expect(screen.getByLabelText("To")).toHaveValue(to);
      expect(api).toHaveBeenCalledTimes(1);
      expect(api.mock.calls[0][0]).toBe(`${base}/preview`);
    });
  }
});

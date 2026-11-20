import { createHash } from "node:crypto";
import type { Customer, Invoice, InvoicePdf } from "@workspace/db";
import { buildInvoiceEmailSubject } from "../invoice-pdf-service";
import type { BuiltDraft } from "./types";

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const unsendable = new Set(["cancelled", "superseded", "merged"]);

export function classifyForBatch(
  invoice: Pick<Invoice, "status" | "invoiceNumber" | "sentAt" | "qbVoidDetectedAt" | "customerEmail" | "periodStart" | "periodEnd">,
  customer: Pick<Customer, "email" | "name" | "irrigoName">,
  latestSentCopy?: Pick<InvoicePdf, "sentAt" | "createdAt">,
):
  | { send: true; to: string; subject: string }
  | { send: false; reason: "not_sendable" | "already_sent" | "no_email" | "qb_voided"; message: string } {
  const { status, invoiceNumber } = invoice;
  if (unsendable.has(status)) {
    return { send: false, reason: "not_sendable", message: `Invoice ${invoiceNumber} is ${status} and can't be sent.` };
  }
  const sentAt = invoice.sentAt ?? latestSentCopy?.sentAt ?? latestSentCopy?.createdAt;
  if (sentAt) {
    return { send: false, reason: "already_sent", message: `Already sent on ${shortDate.format(sentAt)}. Send it on its own to resend.` };
  }
  if (invoice.qbVoidDetectedAt) {
    return { send: false, reason: "qb_voided", message: `QuickBooks shows invoice ${invoiceNumber} as voided. Settle that before sending.` };
  }
  const to = customer.email?.trim() || invoice.customerEmail?.trim();
  if (!to) {
    return { send: false, reason: "no_email", message: `No billing email for ${customer.irrigoName ?? customer.name}. Add one in QuickBooks and resync.` };
  }
  return { send: true, to, subject: buildInvoiceEmailSubject(invoice, customer) };
}

export const emailReviewDigest = (value: string) => createHash("sha256").update(value).digest("base64url");

export function reviewedInvoiceDraft(draft: BuiltDraft): string {
  // Review binds actual body and envelope as well as the attachment's source
  // version: e.g. payment terms can change the email without changing the PDF.
  return emailReviewDigest(JSON.stringify([
    draft.to, draft.subject, draft.sender.from.name, draft.sender.from.email,
    draft.sender.replyTo ?? null, draft.html, draft.text, draft.attachments, draft.versionStamp,
  ]));
}

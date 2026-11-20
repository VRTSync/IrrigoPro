import { randomUUID } from "node:crypto";
import type { Company, Customer, Invoice } from "@workspace/db";
import { computeEffectiveDueDate, resolveBalanceDue } from "@workspace/shared";
import { EmailService } from "../email-service";
import { buildInvoicePdfFilename, invoiceBillingPeriod, InvoicePdfService } from "../invoice-pdf-service";
import { senderFromCompany } from "../lib/company-sender";
import { logger } from "../lib/logger";
import { ObjectStorageService } from "../objectStorage";
import { requireInvoiceSend } from "../routes/role-guards";
import { storage } from "../storage";
import { formatPhone, renderEmailLayout } from "./layout";
import { INVOICE_CHANGED, OutgoingEmailError, type BuiltDraft, type OutgoingEmailHandler } from "./types";
import { fillWording, getEmailWording } from "./wording";

export interface InvoiceEmailEntity { invoice: Invoice; customer: Customer; company: Company }
interface InvoiceEmailDeps {
  storage: Pick<typeof storage, "getInvoiceById" | "getCustomerById" | "getCompanyProfile" | "getLatestInvoiceSentCopy" | "createInvoicePdf" | "stampInvoiceSent">;
  pdf: Pick<InvoicePdfService, "getDocumentVersion" | "generatePdfBuffer">;
  objects: Pick<ObjectStorageService, "writeBufferToFirstSearchPath" | "deleteFromFirstSearchPath">;
  mailer: typeof EmailService.sendInvoiceDetailPdf;
}

const defaultDeps: InvoiceEmailDeps = {
  storage,
  pdf: new InvoicePdfService(storage),
  objects: new ObjectStorageService(),
  mailer: (...args) => EmailService.sendInvoiceDetailPdf(...args),
};
const unsendable = new Set(["cancelled", "superseded", "merged"]);
const noRecipient = "This customer has no billing email. Enter one, or add it in QuickBooks and resync.";
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthAndDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function billingDateRange(invoice: Invoice): string {
  const start = new Date(invoice.periodStart);
  const end = new Date(invoice.periodEnd);
  const startFormat = start.getUTCFullYear() === end.getUTCFullYear() ? monthAndDay : shortDate;
  return `${startFormat.format(start)} – ${shortDate.format(end)}`;
}

export function createInvoiceEmailHandler(deps: InvoiceEmailDeps = defaultDeps) {
  return {
    kind: "invoice",
    capabilities: [requireInvoiceSend],
    async load(req, id) {
      const companyId = req.authenticatedUserRole === "super_admin" ? null : req.authenticatedUserCompanyId;
      if (companyId == null && req.authenticatedUserRole !== "super_admin") return null;
      const invoice = await deps.storage.getInvoiceById(id, companyId ?? null);
      if (!invoice || unsendable.has(invoice.status)) return null;
      const customer = await deps.storage.getCustomerById(invoice.customerId);
      if (!customer || customer.companyId !== invoice.companyId) return null;
      const company = await deps.storage.getCompanyProfile(invoice.companyId);
      if (!company) return null;
      return { invoice, customer, company };
    },
    async draft({ invoice, customer, company }, input) {
      const sender = senderFromCompany(company);
      const to = input.to || customer.email?.trim() || invoice.customerEmail?.trim() || "";
      const note = input.note ?? "";
      const dueDate = computeEffectiveDueDate(invoice.dueDate, invoice.createdAt, customer.paymentTerms);
      const values = {
        customerName: customer.irrigoName ?? customer.name,
        companyName: company.name,
        companyPhone: formatPhone(company.phone),
        companyEmail: company.email?.trim() ?? "",
        invoiceNumber: invoice.invoiceNumber,
        billingMonth: invoiceBillingPeriod(invoice),
        balanceDue: currency.format(resolveBalanceDue(invoice)),
        dueDate: Number.isFinite(dueDate.getTime()) ? shortDate.format(dueDate) : "",
      };
      const filename = buildInvoicePdfFilename(invoice, customer, invoice.id);
      const [latest, versionStamp, wording] = await Promise.all([
        deps.storage.getLatestInvoiceSentCopy(invoice.id, invoice.companyId),
        deps.pdf.getDocumentVersion(invoice.id, invoice.companyId),
        getEmailWording(invoice.companyId, "invoice"),
      ]);
      const subject = input.subject || fillWording(wording.subject, values);
      const warnings: string[] = [];
      if (invoice.qbVoidDetectedAt) warnings.push("QuickBooks shows this invoice as voided.");
      if (latest?.sentAt && latest.sentToEmail) {
        warnings.push(`Already sent on ${shortDate.format(latest.sentAt)} to ${latest.sentToEmail}. Sending again sends a new copy.`);
      }
      if (!sender.usingCompanyAddress && company.emailFromAddress?.trim()) {
        warnings.push(`Your sending address isn't authenticated yet, so this goes from ${sender.from.email} on your behalf.`);
      }
      if (!to) warnings.push(noRecipient);
      return {
        sender, to, cc: input.cc ?? [], bcc: input.bcc ?? [], subject, note,
        ...renderEmailLayout({
          company, subject, docType: "Invoice", docNumber: invoice.invoiceNumber, stripe: "green",
          wording: {
            eyebrow: fillWording(wording.eyebrow, values),
            headline: fillWording(wording.headline, values),
            intro: fillWording(wording.intro, values),
            closing: fillWording(wording.closing, values),
          },
          customerName: values.customerName, note,
          facts: [
            { label: "Invoice", value: invoice.invoiceNumber },
            { label: "Billing period", value: billingDateRange(invoice) },
            ...(values.dueDate ? [{ label: "Due", value: values.dueDate }] : []),
          ],
          total: { label: "Amount due", value: values.balanceDue },
          attachments: [{ title: "Billing detail report", filename }],
        }),
        attachments: [{ filename, viewUrl: `/api/invoices/${invoice.id}/pdf/download` }],
        warnings, versionStamp, options: {}, variant: null,
      };
    },
    send: ({ invoice, customer }, draft, req) => sendInvoiceEmail(invoice, customer, draft, req.authenticatedUserId!, deps),
  } satisfies OutgoingEmailHandler<InvoiceEmailEntity>;
}

/** Deliver exactly the reviewed content and preserve the PDF bytes the provider accepted. */
export class InvoiceDeliveryError extends OutgoingEmailError {
  constructor(readonly providerMessage: string) {
    super(500, "Failed to send PDF.");
  }
}

export async function sendInvoiceEmail(
  invoice: Invoice, customer: Customer, draft: BuiltDraft, userId: number, deps: InvoiceEmailDeps = defaultDeps,
): Promise<{ sentTo: string; sentAt: Date }> {
  if (customer.companyId !== invoice.companyId || customer.id !== invoice.customerId || unsendable.has(invoice.status)) {
    throw new OutgoingEmailError(404, "Document not found.");
  }
  if (!draft.to) throw new OutgoingEmailError(422, noRecipient);
  const result = await deps.pdf.generatePdfBuffer(invoice.id, invoice.companyId);
  if (result.documentVersion && result.documentVersion !== draft.versionStamp) {
    throw new OutgoingEmailError(409, INVOICE_CHANGED);
  }
  if (!result.success || !result.pdfBuffer) {
    if (result.validationFailure) {
      throw new OutgoingEmailError(422, result.error || "Invoice totals validation failed", { validationFailure: result.validationFailure });
    }
    throw new OutgoingEmailError(500, result.error || "Failed to generate PDF.");
  }
  // Check both the exact source snapshot Chromium rendered and the latest
  // source. The first detects changes before rendering (even if reverted);
  // the second detects changes made while Chromium was running.
  const current = await deps.storage.getInvoiceById(invoice.id, invoice.companyId);
  if (!current || result.documentVersion !== draft.versionStamp ||
      await deps.pdf.getDocumentVersion(invoice.id, invoice.companyId) !== draft.versionStamp) {
    throw new OutgoingEmailError(409, INVOICE_CHANGED);
  }

  const buf = result.pdfBuffer;
  const key = `invoice-sent-copies/${invoice.companyId}/${invoice.id}/${randomUUID()}.pdf`;
  const filename = draft.attachments[0].filename;
  try {
    await deps.objects.writeBufferToFirstSearchPath(key, buf, "application/pdf", "private, no-store");
  } catch (err) {
    logger.error({ err, invoiceId: invoice.id }, "Could not save invoice PDF");
    throw new OutgoingEmailError(500, "Could not save the invoice PDF. Nothing was sent.");
  }

  const { to, cc, bcc, subject, html, text, sender } = draft;
  try {
    const mail = await deps.mailer(to, customer.irrigoName ?? customer.name, invoice.invoiceNumber, buf, {
      sender, filename, cc, bcc, subject, html, text,
    });
    if (!mail.success) throw new Error(mail.error || "Email provider rejected the message");
  } catch (err) {
    try {
      await deps.objects.deleteFromFirstSearchPath(key);
    } catch (cleanupError) {
      logger.error({ err: cleanupError, invoiceId: invoice.id }, "Failed to remove rejected invoice upload");
    }
    logger.error({ err, invoiceId: invoice.id }, "Failed to send invoice PDF");
    throw new InvoiceDeliveryError(err instanceof Error ? err.message : "Email provider rejected the message");
  }
  const sentAt = new Date();
  await deps.storage.createInvoicePdf({
    invoiceId: invoice.id, customerId: customer.id, companyId: invoice.companyId,
    pdfUrl: key, filename, status: "sent", sentAt, sentToEmail: to,
    ccEmails: cc, bccEmails: bcc, subject, sentByUserId: userId, byteSize: buf.length,
  });
  if (!current.sentAt) await deps.storage.stampInvoiceSent(invoice.id, invoice.companyId, sentAt);
  return { sentTo: to, sentAt };
}

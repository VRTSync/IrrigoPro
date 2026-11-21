import { randomUUID } from "node:crypto";
import type { Company, Customer, Invoice, PlatformDocument } from "@workspace/db";
import { computeEffectiveDueDate, resolveBalanceDue } from "@workspace/shared";
import { EmailService } from "../email-service";
import { buildInvoicePdfFilename, invoiceBillingPeriod, InvoicePdfService } from "../invoice-pdf-service";
import { senderFromCompany } from "../lib/company-sender";
import { logger } from "../lib/logger";
import { getCurrentInvoiceGuide, getInvoiceGuide, readPlatformDocument } from "../lib/platform-documents";
import { ObjectStorageService } from "../objectStorage";
import { requireInvoiceSend } from "../routes/role-guards";
import { storage } from "../storage";
import { billingDateRange, invoiceCurrency as currency, invoiceShortDate as shortDate } from "./invoice-email-format";
import { buildInvoiceEmail, INVOICE_GUIDE_ATTACHMENT_TITLE as guideTitle } from "./invoice-email";
import { INVOICE_CHANGED, INVOICE_GUIDE_CHANGED, OutgoingEmailError, type BuiltDraft, type OutgoingEmailHandler } from "./types";

export interface InvoiceEmailEntity {
  invoice: Invoice;
  customer: Customer;
  company: Company;
  // Batch review reads the current version once so every preview shares it.
  guideSnapshot?: PlatformDocument | null;
}
const defaultGuides = { getCurrentInvoiceGuide, getInvoiceGuide, readPlatformDocument };
interface InvoiceEmailDeps {
  storage: Pick<typeof storage, "getInvoiceById" | "getCustomerById" | "getCompanyProfile" | "getLatestInvoiceSentCopy" | "createInvoicePdf" | "stampInvoiceSent">;
  pdf: Pick<InvoicePdfService, "getDocumentVersion" | "generatePdfBuffer">;
  objects: Pick<ObjectStorageService, "writeBufferToFirstSearchPath" | "deleteFromFirstSearchPath">;
  mailer: typeof EmailService.sendInvoiceDetailPdf;
  guides?: typeof defaultGuides;
}

const defaultDeps: InvoiceEmailDeps = {
  storage,
  pdf: new InvoicePdfService(storage),
  objects: new ObjectStorageService(),
  mailer: (...args) => EmailService.sendInvoiceDetailPdf(...args),
};
const unsendable = new Set(["cancelled", "superseded", "merged"]);
const noRecipient = "This customer has no billing email. Enter one, or add it in QuickBooks and resync.";

export function createInvoiceEmailHandler(deps: InvoiceEmailDeps = defaultDeps) {
  const guides = deps.guides ?? defaultGuides;
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
    async draft({ invoice, customer, company, guideSnapshot }, input) {
      const sender = senderFromCompany(company);
      const to = input.to || customer.email?.trim() || invoice.customerEmail?.trim() || "";
      const note = input.note ?? "";
      const dueDate = computeEffectiveDueDate(invoice.dueDate, invoice.createdAt, customer.paymentTerms);
      const filename = buildInvoicePdfFilename(invoice, customer, invoice.id);
      const [latest, versionStamp, guide] = await Promise.all([
        deps.storage.getLatestInvoiceSentCopy(invoice.id, invoice.companyId),
        deps.pdf.getDocumentVersion(invoice.id, invoice.companyId),
        company.attachInvoiceGuide
          ? guideSnapshot === undefined ? guides.getCurrentInvoiceGuide() : guideSnapshot
          : undefined,
      ]);
      const content = await buildInvoiceEmail({
        company, customerName: customer.irrigoName ?? customer.name, invoiceNumber: invoice.invoiceNumber,
        billingMonth: invoiceBillingPeriod(invoice), billingPeriodRange: billingDateRange(invoice),
        dueDateLabel: Number.isFinite(dueDate.getTime()) ? shortDate.format(dueDate) : null,
        balanceDue: currency.format(resolveBalanceDue(invoice)), note, subject: input.subject,
        attachments: [
          { title: "Billing detail report", filename },
          ...(guide ? [{ title: guideTitle, filename: guide.filename }] : []),
        ],
      });
      const warnings: string[] = [];
      if (invoice.qbVoidDetectedAt) warnings.push("QuickBooks shows this invoice as voided.");
      if (latest?.sentAt && latest.sentToEmail) {
        warnings.push(`Already sent on ${shortDate.format(latest.sentAt)} to ${latest.sentToEmail}. Sending again sends a new copy.`);
      }
      if (!sender.usingCompanyAddress && company.emailFromAddress?.trim()) {
        warnings.push(`Your sending address isn't authenticated yet, so this goes from ${sender.from.email} on your behalf.`);
      }
      if (!to) warnings.push(noRecipient);
      if (company.attachInvoiceGuide && !guide) warnings.push("No invoice guide is uploaded yet, so this email goes without it.");
      return {
        sender, to, cc: input.cc ?? [], bcc: input.bcc ?? [], note, ...content,
        attachments: [
          { filename, viewUrl: `/api/invoices/${invoice.id}/pdf/download` },
          ...(guide ? [{ title: guideTitle, filename: guide.filename, viewUrl: `/api/platform-documents/${guide.id}/file` }] : []),
        ],
        guideDocumentId: guide?.id,
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

  let extraAttachments: { filename: string; content: Buffer }[] | undefined;
  if (draft.guideDocumentId != null) {
    const guides = deps.guides ?? defaultGuides;
    const guide = await guides.getInvoiceGuide(draft.guideDocumentId);
    if (!guide?.isCurrent) throw new OutgoingEmailError(409, INVOICE_GUIDE_CHANGED);
    let content: Buffer;
    try {
      content = await guides.readPlatformDocument(guide);
    } catch (err) {
      logger.error({ err, guideDocumentId: guide.id }, "Could not read invoice guide before sending");
      throw new OutgoingEmailError(500, "Could not load the invoice guide. Nothing was sent.");
    }
    if ((await guides.getCurrentInvoiceGuide())?.id !== guide.id) {
      throw new OutgoingEmailError(409, INVOICE_GUIDE_CHANGED);
    }
    extraAttachments = [{ filename: guide.filename, content }];
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
      sender, filename, cc, bcc, subject, html, text, ...(extraAttachments ? { extraAttachments } : {}),
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
    guideDocumentId: draft.guideDocumentId ?? null,
  });
  if (!current.sentAt) await deps.storage.stampInvoiceSent(invoice.id, invoice.companyId, sentAt);
  return { sentTo: to, sentAt };
}

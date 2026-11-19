import type { Express, RequestHandler, Response } from "express";
import { storage as defaultStorage } from "../storage";
import { InvoicePdfService, buildInvoicePdfFilename } from "../invoice-pdf-service";
import { EmailService, buildInvoiceDetailEmailBody } from "../email-service";
import { ObjectStorageService } from "../objectStorage";
import { logger } from "../lib/logger";
import type { InvoicePdfGenerationResult } from "../invoice-pdf-service";
import { resolveCompanySender } from "../lib/company-sender";

interface Deps {
  requireAuthentication: RequestHandler;
  requireInvoiceRead: RequestHandler;
  requireInvoiceSend: RequestHandler;
  _storageApi?: typeof defaultStorage;
  _generatePdf?: (invoiceId: number) => Promise<InvoicePdfGenerationResult>;
  _objectStorage?: Pick<ObjectStorageService, "writeBufferToFirstSearchPath" | "deleteFromFirstSearchPath">;
  _mailer?: typeof EmailService.sendInvoiceDetailPdf;
  _resolveSender?: typeof resolveCompanySender;
}

export function registerInvoicePdfRoutes(app: Express, deps: Deps): void {
  const storage = deps._storageApi ?? defaultStorage;
  const generate = deps._generatePdf ?? ((id) => new InvoicePdfService(storage).generatePdfBuffer(id));
  const objects = deps._objectStorage ?? new ObjectStorageService();
  const mailer = deps._mailer ?? EmailService.sendInvoiceDetailPdf.bind(EmailService);
  const scope = (req: any) => req.authenticatedUserRole === "super_admin"
    ? null : req.authenticatedUserCompanyId;
  const validate = (result: InvoicePdfGenerationResult, res: Response): result is InvoicePdfGenerationResult & { pdfBuffer: Buffer } => {
    if (result.success && result.pdfBuffer) return true;
    if (result.validationFailure) {
      res.status(422).json({ message: result.error || "Invoice totals validation failed", validationFailure: result.validationFailure });
    } else {
      res.status(500).json({ message: result.error || "Failed to generate PDF" });
    }
    return false;
  };
  // Check ownership before generating a PDF or resolving customer details.
  async function load(req: any, res: Response) {
    const invoiceId = Number(req.params.invoiceId);
    const companyId = scope(req);
    const invoice = (companyId == null && req.authenticatedUserRole !== "super_admin")
      || !Number.isSafeInteger(invoiceId) || invoiceId <= 0
      ? undefined : await storage.getInvoiceById(invoiceId, companyId);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return null;
    }
    const customer = await storage.getCustomerById(invoice.customerId);
    if (!customer || customer.companyId !== invoice.companyId) {
      res.status(404).json({ message: "Invoice not found" });
      return null;
    }
    return { invoice, customer };
  }

  app.get("/api/invoices/:invoiceId/pdf", deps.requireAuthentication, deps.requireInvoiceRead, async (req, res) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const result = await generate(ctx.invoice.id);
      if (!validate(result, res)) return;
      const latest = await storage.getLatestInvoiceSentCopy(ctx.invoice.id);
      res.json({
        filename: buildInvoicePdfFilename(ctx.invoice, ctx.customer, ctx.invoice.id),
        sentAt: latest?.sentAt ?? null,
        sentToEmail: latest?.sentToEmail ?? null,
      });
    } catch (err) {
      logger.error({ err }, "Error fetching invoice PDF");
      res.status(500).json({ message: "Failed to fetch invoice PDF" });
    }
  });

  app.get("/api/invoices/:invoiceId/pdf/download", deps.requireAuthentication, deps.requireInvoiceRead, async (req, res) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const result = await generate(ctx.invoice.id);
      if (!validate(result, res)) return;
      const filename = buildInvoicePdfFilename(ctx.invoice, ctx.customer, ctx.invoice.id);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": result.pdfBuffer.length.toString(),
      });
      res.end(result.pdfBuffer);
    } catch (err) {
      logger.error({ err }, "Error downloading invoice PDF");
      res.status(500).json({ message: "Failed to download invoice PDF" });
    }
  });

  app.post("/api/invoices/:invoiceId/pdf/send", deps.requireAuthentication, deps.requireInvoiceSend, async (req: any, res) => {
    try {
      const ctx = await load(req, res);
      if (!ctx) return;
      const { invoice, customer } = ctx;
      const to = customer.email?.trim() || invoice.customerEmail?.trim();
      if (!to) {
        res.status(422).json({ message: "This customer has no billing email. Add one in QuickBooks, resync customers, then send." });
        return;
      }
      const result = await generate(invoice.id);
      if (!validate(result, res)) return;
      const buf = result.pdfBuffer;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const key = `invoice-sent-copies/${invoice.companyId}/${invoice.id}/${stamp}.pdf`;
      const sender = await (deps._resolveSender ?? resolveCompanySender)(invoice.companyId);
      const filename = buildInvoicePdfFilename(invoice, customer, invoice.id);
      try {
        await objects.writeBufferToFirstSearchPath(key, buf, "application/pdf", "private, no-store");
      } catch (err) {
        logger.error({ err, invoiceId: invoice.id }, "Could not save invoice PDF");
        res.status(500).json({ message: "Could not save the invoice PDF. Nothing was sent." });
        return;
      }
      let emailResult;
      try {
        emailResult = await mailer(to, invoice.customerName, invoice.invoiceNumber, buf, { sender, filename });
      } catch (err) {
        emailResult = { success: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      if (!emailResult.success) {
        try {
          await objects.deleteFromFirstSearchPath(key);
        } catch (err) {
          logger.error({ err, invoiceId: invoice.id }, "Failed to remove rejected invoice upload");
        }
        res.status(500).json({ message: "Failed to send PDF", error: emailResult.error });
        return;
      }
      const now = new Date();
      await storage.createInvoicePdf({
        invoiceId: invoice.id, customerId: invoice.customerId, companyId: invoice.companyId,
        pdfUrl: key, filename, status: "sent", sentAt: now, sentToEmail: to,
        ccEmails: [], bccEmails: [],
        subject: buildInvoiceDetailEmailBody(invoice.customerName, invoice.invoiceNumber).subject,
        sentByUserId: req.authenticatedUserId, byteSize: buf.length,
      });
      if (!invoice.sentAt) await storage.updateInvoice(invoice.id, { sentAt: now });
      res.json({ message: "PDF sent successfully to customer", email: to });
    } catch (err) {
      logger.error({ err }, "Error sending invoice PDF");
      res.status(500).json({ message: "Failed to send invoice PDF" });
    }
  });
}

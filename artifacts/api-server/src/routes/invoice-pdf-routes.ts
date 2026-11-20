import type { Express, RequestHandler, Response } from "express";
import { storage as defaultStorage } from "../storage";
import { InvoicePdfService, buildInvoicePdfFilename, readInvoiceSentCopy } from "../invoice-pdf-service";
import { logger } from "../lib/logger";
import type { InvoicePdfGenerationResult } from "../invoice-pdf-service";

interface Deps {
  requireAuthentication: RequestHandler;
  requireInvoiceRead: RequestHandler;
  _storageApi?: typeof defaultStorage;
  _generatePdf?: (invoiceId: number) => Promise<InvoicePdfGenerationResult>;
  _readSentCopy?: typeof readInvoiceSentCopy;
}

export function registerInvoicePdfRoutes(app: Express, deps: Deps): void {
  const storage = deps._storageApi ?? defaultStorage;
  const generate = deps._generatePdf ?? ((id) => new InvoicePdfService(storage).generatePdfBuffer(id));
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
  async function loadInvoice(req: any, res: Response) {
    const invoiceId = Number(req.params.invoiceId ?? req.params.id);
    const companyId = scope(req);
    const invoice = (companyId == null && req.authenticatedUserRole !== "super_admin")
      || !Number.isSafeInteger(invoiceId) || invoiceId <= 0
      ? undefined : await storage.getInvoiceById(invoiceId, companyId);
    if (!invoice) {
      res.status(404).json({ message: "Invoice not found" });
      return undefined;
    }
    return invoice;
  }
  async function load(req: any, res: Response) {
    const invoice = await loadInvoice(req, res);
    if (!invoice) return null;
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
      const latest = await storage.getLatestInvoiceSentCopy(ctx.invoice.id, ctx.invoice.companyId);
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

  app.get("/api/invoices/:id/sent-copy", deps.requireAuthentication, deps.requireInvoiceRead, async (req, res) => {
    try {
      const invoice = await loadInvoice(req, res);
      if (!invoice) return;
      const copy = await storage.getLatestInvoiceSentCopy(invoice.id, invoice.companyId);
      const bytes = copy && await (deps._readSentCopy ?? readInvoiceSentCopy)(copy.pdfUrl);
      if (!copy || !bytes) {
        res.status(404).json({ message: "No saved invoice PDF found." });
        return;
      }
      const ascii = copy.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
      res.set({
        "Cache-Control": "private, no-store",
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(copy.filename)}`,
        "Content-Length": String(bytes.length),
      });
      res.end(bytes);
    } catch (err) {
      logger.error({ err }, "Error downloading saved invoice PDF");
      res.status(500).json({ message: "Failed to download saved invoice PDF." });
    }
  });
}

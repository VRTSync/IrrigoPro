import type { Express, RequestHandler } from "express";
import { ListInvoiceGuideVersionsResponse, UploadInvoiceGuideVersionBody, UploadInvoiceGuideVersionResponse, ViewPlatformDocumentParams } from "@workspace/api-zod";
import type { PlatformDocument } from "@workspace/db/schema";
import { getGuideUploaderName, getInvoiceGuide, InvoiceGuideValidationError, listInvoiceGuides, readPlatformDocument, uploadInvoiceGuide } from "../lib/platform-documents";
import { logger } from "../lib/logger";
import { recordAuditEvent } from "./audit-log";

const defaultDocuments = { getGuideUploaderName, getInvoiceGuide, listInvoiceGuides, readPlatformDocument, uploadInvoiceGuide };
const adminPath = "/api/admin/platform-documents/invoice-guide";
const metadata = ({ id, filename, byteSize, pageCount, uploadedAt }: PlatformDocument, uploaderName: string) =>
  ({ id, filename, byteSize, pageCount, uploadedAt, uploaderName });

const requireSuperAdmin: RequestHandler = (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  if (req.authenticatedUserRole !== "super_admin") {
    res.status(403).json({ message: "Super admin access required." });
    return;
  }
  next();
};

export function registerPlatformDocumentRoutes(app: Express, {
  requireAuthentication, documents = defaultDocuments, audit = recordAuditEvent,
}: {
  requireAuthentication: RequestHandler;
  documents?: typeof defaultDocuments;
  audit?: typeof recordAuditEvent;
}): void {
  app.get(adminPath, requireAuthentication, requireSuperAdmin, async (req, res) => {
    try {
      const docs = await documents.listInvoiceGuides();
      const current = docs.find(doc => doc.isCurrent);
      res.json(ListInvoiceGuideVersionsResponse.parse({
        current: current ? metadata(current, current.uploaderName) : null,
        history: docs.filter(doc => !doc.isCurrent).map(doc => metadata(doc, doc.uploaderName)),
      }));
    } catch (err) {
      (req.log ?? logger).error({ err }, "Could not list invoice guide versions");
      res.status(500).json({ message: "Could not load invoice guide versions." });
    }
  });

  app.post(adminPath, requireAuthentication, requireSuperAdmin, async (req, res) => {
    const input = UploadInvoiceGuideVersionBody.safeParse(req.body);
    if (!input.success || !input.data.filename.trim() || /[\u0000-\u001f\u007f]/.test(input.data.filename.trim())) {
      res.status(400).json({ message: "Enter a filename and select a PDF." });
      return;
    }
    try {
      const userId = req.authenticatedUserId!;
      const uploaderName = await documents.getGuideUploaderName(userId);
      if (uploaderName == null) {
        res.status(401).json({ message: "Sign in again before uploading the guide." });
        return;
      }
      const doc = await documents.uploadInvoiceGuide({
        filename: input.data.filename, bytes: Buffer.from(input.data.contentBase64, "base64"), userId,
      });
      await audit(req, {
        actorUserId: userId, actorRole: req.authenticatedUserRole,
        action: "platform_document.uploaded", targetType: "platform_document", targetId: String(doc.id),
        summary: "Invoice guide uploaded", details: { filename: doc.filename, byteSize: doc.byteSize, pageCount: doc.pageCount },
      });
      res.json(UploadInvoiceGuideVersionResponse.parse(metadata(doc, uploaderName)));
    } catch (err) {
      if (err instanceof InvoiceGuideValidationError) {
        res.status(422).json({ message: err.message });
        return;
      }
      (req.log ?? logger).error({ err }, "Could not upload invoice guide");
      res.status(500).json({ message: "Could not upload the invoice guide." });
    }
  });

  app.get("/api/platform-documents/:documentId/file", requireAuthentication, async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const params = ViewPlatformDocumentParams.safeParse(req.params);
    try {
      const doc = params.success && Number.isInteger(params.data.documentId)
        ? await documents.getInvoiceGuide(params.data.documentId) : undefined;
      if (!doc || (!doc.isCurrent && req.authenticatedUserRole !== "super_admin")) {
        res.status(404).json({ message: "Guide not found." });
        return;
      }
      const bytes = await documents.readPlatformDocument(doc);
      // Express encodes filenames safely (including Unicode) for attachments.
      res.attachment(doc.filename);
      res.set("Content-Disposition", res.get("Content-Disposition")!.replace(/^attachment\b/, "inline"));
      res.set("X-Content-Type-Options", "nosniff").type("application/pdf").send(bytes);
    } catch (err) {
      (req.log ?? logger).error({ err }, "Could not read invoice guide");
      res.status(500).json({ message: "Could not load the invoice guide." });
    }
  });
}

import { createHash, randomUUID } from "node:crypto";
import { platformDocuments, users, type PlatformDocument } from "@workspace/db/schema";
import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db } from "../db";
import { ObjectStorageService } from "../objectStorage";
import { logger } from "./logger";

const MAX_GUIDE_BYTES = 5 * 1024 * 1024;
const invoiceGuide = eq(platformDocuments.kind, "invoice_guide");
const currentGuide = and(invoiceGuide, eq(platformDocuments.isCurrent, true));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export class InvoiceGuideValidationError extends Error {}

// Only metadata is kept in PostgreSQL; PDF bytes are read through this module.
export function createPlatformDocumentService(
  objects: Pick<ObjectStorageService, "writeBufferToFirstSearchPath" | "deleteFromFirstSearchPath" | "searchPublicObject"> = new ObjectStorageService(),
  database: Pick<typeof db, "select" | "transaction"> = db,
) {
  return {
    async getCurrentInvoiceGuide(): Promise<PlatformDocument | undefined> {
      const [doc] = await database.select().from(platformDocuments).where(currentGuide).limit(1);
      return doc;
    },
    async getInvoiceGuide(id: number): Promise<PlatformDocument | undefined> {
      const [doc] = await database.select().from(platformDocuments).where(and(invoiceGuide, eq(platformDocuments.id, id))).limit(1);
      return doc;
    },
    async listInvoiceGuides(): Promise<(PlatformDocument & { uploaderName: string })[]> {
      return database.select({ ...getTableColumns(platformDocuments), uploaderName: users.name })
        .from(platformDocuments).innerJoin(users, eq(users.id, platformDocuments.uploadedByUserId))
        .where(invoiceGuide).orderBy(desc(platformDocuments.uploadedAt), desc(platformDocuments.id));
    },
    async getGuideUploaderName(userId: number): Promise<string | undefined> {
      const [user] = await database.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
      return user?.name;
    },
    async uploadInvoiceGuide({ filename, bytes, userId }: { filename: string; bytes: Buffer; userId: number }): Promise<PlatformDocument> {
      if (bytes.length < 1 || bytes.length > MAX_GUIDE_BYTES) {
        throw new InvoiceGuideValidationError("The guide must be a PDF of 5 MB or less.");
      }
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new InvoiceGuideValidationError("That file isn't a PDF.");
      }
      let pageCount: number;
      try {
        pageCount = (await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false })).getPageCount();
        if (pageCount < 1) throw new Error("Empty PDF");
      } catch {
        throw new InvoiceGuideValidationError("That PDF couldn't be opened.");
      }
      const trimmed = filename.trim();
      const storageKey = `platform-documents/invoice-guide/${randomUUID()}.pdf`;
      await objects.writeBufferToFirstSearchPath(storageKey, bytes, "application/pdf", "private, no-store");
      try {
        return await database.transaction(async (tx) => {
          // Serialize even the very first upload, when there is no row to lock.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform-documents:invoice-guide'))`);
          await tx.update(platformDocuments).set({ isCurrent: false }).where(currentGuide);
          const [doc] = await tx.insert(platformDocuments).values({
            kind: "invoice_guide", isCurrent: true, storageKey, byteSize: bytes.length,
            filename: /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`,
            sha256: sha256(bytes), pageCount, uploadedByUserId: userId,
          }).returning();
          return doc;
        });
      } catch (err) {
        try {
          await objects.deleteFromFirstSearchPath(storageKey);
        } catch (cleanupError) {
          logger.error({ err: cleanupError, storageKey }, "Could not remove failed invoice guide upload");
        }
        throw err;
      }
    },
    async readPlatformDocument(doc: PlatformDocument): Promise<Buffer> {
      const file = await objects.searchPublicObject(doc.storageKey);
      if (!file) throw new Error("Platform document file is missing");
      const [bytes] = await file.download();
      if (sha256(bytes) !== doc.sha256) throw new Error("Platform document checksum did not match");
      return bytes;
    },
  };
}

export const { getCurrentInvoiceGuide, getInvoiceGuide, listInvoiceGuides, getGuideUploaderName, uploadInvoiceGuide, readPlatformDocument } =
  createPlatformDocumentService();

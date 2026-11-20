import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, it } from "node:test";
import { db, pool, users } from "@workspace/db";
import express, { type RequestHandler } from "express";
import { PDFDocument } from "pdf-lib";
import request from "supertest";
import { createPlatformDocumentService } from "../lib/platform-documents";
import type { ObjectStorageService } from "../objectStorage";
import { registerPlatformDocumentRoutes } from "./platform-document-routes";
import { enforceRoleApiAllowlist } from "./role-guards";

const adminPath = "/api/admin/platform-documents/invoice-guide";
const guidePath = (id: number) => `/api/platform-documents/${id}/file`;
after(async () => { await pool.end(); });

it("validates and versions the platform guide and keeps earlier bytes restricted to super admins", async () => {
  const rollback = new Error("Leave the shared database unchanged");
  const files = new Map<string, Buffer>();
  const pdf = await PDFDocument.create();
  pdf.addPage(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const zeroPages = Buffer.from(await (await PDFDocument.create()).save({ addDefaultPage: false }));
  await assert.rejects(db.transaction(async tx => {
    const [uploader] = await tx.insert(users).values({
      username: `platform-guide-${randomUUID()}`, name: "Guide Admin", password: "not-used", role: "super_admin",
    }).returning();
    // Nested transactions are savepoints. No current guide changes are
    // visible to other app sessions, even when dev already has a real guide.
    const documents = createPlatformDocumentService({
      async writeBufferToFirstSearchPath(key, data, type, cacheControl) {
        assert.match(key, /^platform-documents\/invoice-guide\/[\w-]+\.pdf$/);
        assert.equal(type, "application/pdf");
        assert.equal(cacheControl, "private, no-store");
        files.set(key, data);
      },
      async deleteFromFirstSearchPath(key) { files.delete(key); },
      async searchPublicObject(key) {
        const bytes = files.get(key);
        return bytes ? { download: async () => [bytes] } as unknown as NonNullable<Awaited<ReturnType<ObjectStorageService["searchPublicObject"]>>> : null;
      },
    }, tx);
    const events: string[] = [];
    const requireAuthentication: RequestHandler = (req, res, next) => {
      const role = req.header("x-role");
      if (!role) { res.sendStatus(401); return; }
      req.authenticatedUserRole = role;
      req.authenticatedUserCompanyId = role === "super_admin" ? null : Number(req.header("x-company"));
      req.authenticatedUserId = uploader.id;
      if (!enforceRoleApiAllowlist(req, res)) return;
      next();
    };
    const app = express();
    app.use(express.json({ limit: "50mb" }));
    registerPlatformDocumentRoutes(app, {
      requireAuthentication, documents, audit: async (_req, event) => { events.push(event.action); },
    });
    const admin = request(app);
    const upload = (bytes: Buffer, filename = "Understanding Your Invoice.pdf") =>
      admin.post(adminPath).set("x-role", "super_admin").send({ filename, contentBase64: bytes.toString("base64") });
    await admin.get(adminPath).set("x-role", "company_admin").expect(403);
    await admin.post(adminPath).set("x-role", "company_admin").send({ filename: "Guide", contentBase64: bytes.toString("base64") }).expect(403);
    await upload(Buffer.from("not pdf")).expect(422, { message: "That file isn't a PDF." });
    await upload(Buffer.alloc(6 * 1024 * 1024)).expect(422, { message: "The guide must be a PDF of 5 MB or less." });
    await upload(Buffer.alloc(0)).expect(422, { message: "The guide must be a PDF of 5 MB or less." });
    await upload(Buffer.from("%PDF-1.7\ninvalid")).expect(422, { message: "That PDF couldn't be opened." });
    await upload(zeroPages).expect(422, { message: "That PDF couldn't be opened." });
    assert.equal(files.size, 0);

    const { body: earlier } = await upload(bytes, " Understanding Your Invoice ").expect(200);
    const { body: current } = await upload(bytes, "Understanding Your Invoice.pdf").expect(200);
    assert.equal(earlier.filename, "Understanding Your Invoice.pdf");
    assert.equal(current.byteSize, bytes.length);
    assert.equal(current.pageCount, 2);
    assert.equal(current.uploaderName, "Guide Admin");
    assert.ok(Number.isFinite(Date.parse(current.uploadedAt)));
    assert.deepEqual(events, ["platform_document.uploaded", "platform_document.uploaded"]);
    const { body: versions } = await admin.get(adminPath).set("x-role", "super_admin").expect(200);
    assert.deepEqual(versions.current, current);
    assert.deepEqual(versions.history.find((row: { id: number }) => row.id === earlier.id), earlier);
    const docs = await documents.listInvoiceGuides();
    assert.deepEqual(docs.filter(doc => doc.isCurrent).map(doc => doc.id), [current.id]);
    assert.equal((await documents.getInvoiceGuide(earlier.id))?.isCurrent, false);

    for (const id of [111, 222]) {
      const response = await admin.get(guidePath(current.id)).set("x-role", "field_tech").set("x-company", String(id))
        .expect(200).expect("Content-Type", "application/pdf").expect("Cache-Control", "private, no-store")
        .expect("Content-Disposition", 'inline; filename="Understanding Your Invoice.pdf"');
      assert.deepEqual(response.body, bytes);
      await admin.get(guidePath(earlier.id)).set("x-role", "field_tech").set("x-company", String(id)).expect(404);
    }
    await admin.get(guidePath(current.id)).expect(401);
    await admin.get(guidePath(current.id)).set("x-role", "system_documenter").set("x-company", "111").expect(200);
    await admin.get(guidePath(earlier.id)).set("x-role", "system_documenter").set("x-company", "111").expect(404);
    const oldPdf = await admin.get(guidePath(earlier.id)).set("x-role", "super_admin").expect(200);
    assert.deepEqual(oldPdf.body, bytes);

    await assert.rejects(documents.uploadInvoiceGuide({ filename: "Will roll back", bytes, userId: -1 }));
    assert.equal(files.size, 2, "database failure removes the upload");
    const active = await documents.getCurrentInvoiceGuide();
    assert.equal(active?.id, current.id);
    files.set(active!.storageKey, Buffer.from("corrupt"));
    await assert.rejects(documents.readPlatformDocument(active!), /checksum/);
    files.delete(active!.storageKey);
    await assert.rejects(documents.readPlatformDocument(active!), /missing/);
    throw rollback;
  }), error => error === rollback);
});

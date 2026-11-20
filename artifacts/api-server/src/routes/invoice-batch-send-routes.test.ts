import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, it, type TestContext } from "node:test";
import express, { type RequestHandler } from "express";
import { eq, inArray } from "drizzle-orm";
import { companies, customers, db, emailBatchItems, emailBatches, invoicePdfs, invoices, platformDocuments, pool, users, type PlatformDocument } from "@workspace/db";
import { InvoicePdfService } from "../invoice-pdf-service";
import { classifyForBatch, emailReviewDigest } from "../outgoing-email/invoice-batch";
import { INTERRUPTED_SEND } from "../outgoing-email/invoice-batch-store";
import { createInvoiceEmailHandler, sendInvoiceEmail } from "../outgoing-email/invoice-handler";
import { storage } from "../storage";
import { recoverInterruptedEmailBatches, registerInvoiceBatchSendRoutes } from "./invoice-batch-send-routes";
import { registerOutgoingEmailRoutes } from "./outgoing-email-routes";
import { requireInvoiceSend } from "./role-guards";

const prefix = "/api/outgoing-email";
const pdfBuffer = Buffer.from("%PDF-1.7\nsynthetic invoice");
const guideBytes = Buffer.from("%PDF-1.7\nsynthetic guide");
const date = new Date("2026-10-31T12:00:00Z");
const httpPreview = `${prefix}/invoice/batch/preview`;
const httpStart = `${prefix}/invoice/batch`;
const httpActive = `${prefix}/batches/active`;
const detail = (id: number) => `${prefix}/batches/${id}`;

after(async () => { await pool.end(); });

it("classifies the exact skip messages in priority order and only returns a recipient when sendable", () => {
  const customer = { name: "QB Ranch", irrigoName: "The Ranch", email: " ranch@example.invalid " };
  const invoice = { status: "generated", invoiceNumber: "IR-1008", sentAt: null, qbVoidDetectedAt: null,
    customerEmail: "old@example.invalid" };
  for (const status of ["cancelled", "superseded", "merged"]) {
    assert.deepEqual(classifyForBatch({ ...invoice, status, sentAt: date }, customer), {
      send: false, reason: "not_sendable", message: `Invoice IR-1008 is ${status} and can't be sent.`,
    });
  }
  const already = { send: false, reason: "already_sent", message: "Already sent on Oct 31, 2026. Send it on its own to resend." };
  assert.deepEqual(classifyForBatch({ ...invoice, sentAt: date, qbVoidDetectedAt: date }, customer), already);
  assert.deepEqual(classifyForBatch(invoice, customer, { sentAt: date, createdAt: date }), already);
  assert.deepEqual(classifyForBatch({ ...invoice, qbVoidDetectedAt: date }, customer), {
    send: false, reason: "qb_voided", message: "QuickBooks shows invoice IR-1008 as voided. Settle that before sending.",
  });
  assert.deepEqual(classifyForBatch({ ...invoice, customerEmail: " " }, { ...customer, email: " " }), {
    send: false, reason: "no_email", message: "No billing email for The Ranch. Add one in QuickBooks and resync.",
  });
  assert.deepEqual(classifyForBatch(invoice, customer), { send: true, to: "ranch@example.invalid" });
  assert.deepEqual(classifyForBatch(invoice, { ...customer, email: " " }), { send: true, to: "old@example.invalid" });
});

async function harness(t: TestContext) {
  const salt = randomUUID();
  const tenantIds: number[] = [];
  const guideIds: number[] = [];
  let currentGuide: PlatformDocument | undefined;
  const scheduled: (() => Promise<void>)[] = [];
  const uploads = new Map<string, Buffer>();
  const mail: Parameters<typeof import("../email-service").EmailService.sendInvoiceDetailPdf>[] = [];
  const refused = new Set<string>();
  const server = createServer();
  t.after(async () => {
    while (scheduled.length) await scheduled.shift()!();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!tenantIds.length) return;
    await db.delete(emailBatchItems).where(inArray(emailBatchItems.companyId, tenantIds));
    await db.delete(emailBatches).where(inArray(emailBatches.companyId, tenantIds));
    await db.delete(invoicePdfs).where(inArray(invoicePdfs.companyId, tenantIds));
    if (guideIds.length) await db.delete(platformDocuments).where(inArray(platformDocuments.id, guideIds));
    await db.delete(invoices).where(inArray(invoices.companyId, tenantIds));
    await db.delete(customers).where(inArray(customers.companyId, tenantIds));
    await db.delete(users).where(inArray(users.companyId, tenantIds));
    await db.delete(companies).where(inArray(companies.id, tenantIds));
  });
  async function company(label: string) {
    const domain = `${salt}-${label.toLowerCase()}.example.invalid`;
    const [row] = await db.insert(companies).values({
      name: `${label} ${salt}`, email: "office@example.invalid", emailFromName: `${label} Irrigation`,
      emailFromAddress: `billing@${domain}`, emailSendingDomain: domain,
      emailReplyTo: "office@example.invalid", emailDomainVerifiedAt: date,
    }).returning();
    tenantIds.push(row.id);
    return row;
  }
  const a = await company("A");
  const b = await company("B");
  const [actor] = await db.insert(users).values({
    username: `batch-${salt}`, password: "not-used", name: "Batch fixture", companyId: a.id, role: "bookkeeper",
  }).returning();
  async function replaceGuide() {
    // Leave the actual development current version alone. The dependency seam
    // represents currentness; the real FK proves each send stores a version.
    const [row] = await db.insert(platformDocuments).values({
      kind: "invoice_guide", isCurrent: false, storageKey: `test/${randomUUID()}.pdf`, sha256: "fixture",
      filename: "Understanding Your Invoice.pdf", byteSize: guideBytes.length, pageCount: 1, uploadedByUserId: actor.id,
    }).returning();
    guideIds.push(row.id);
    return currentGuide = { ...row, isCurrent: true };
  }
  async function invoice(n: number, companyId = a.id, email = `customer${n}@example.invalid`) {
    const [customer] = await db.insert(customers).values({
      companyId, name: `Customer ${n}`, irrigoName: n === 1 ? "The Ranch" : null, email,
    }).returning();
    const [row] = await db.insert(invoices).values({
      companyId, customerId: customer.id, invoiceNumber: `IR-100${n}`, customerName: customer.name,
      customerEmail: email ? "snapshot@example.invalid" : "", status: "generated",
      invoiceMonth: 10, invoiceYear: 2026, periodStart: new Date("2026-10-01T12:00:00Z"), periodEnd: date,
      laborSubtotal: "0", partsSubtotal: "0", totalAmount: "40", createdAt: date, updatedAt: date,
    }).returning();
    return row;
  }
  const doc = new InvoicePdfService(storage);
  const getCurrentInvoiceGuide = async () => currentGuide;
  const transport: NonNullable<Parameters<typeof createInvoiceEmailHandler>[0]> = {
    storage,
    guides: {
      getCurrentInvoiceGuide,
      async getInvoiceGuide(id) { return currentGuide?.id === id ? currentGuide : undefined; },
      async readPlatformDocument() { return guideBytes; },
    },
    pdf: {
      getDocumentVersion: doc.getDocumentVersion.bind(doc),
      async generatePdfBuffer(id, companyId) {
        assert.ok(companyId != null && tenantIds.includes(companyId));
        return { success: true, pdfBuffer, documentVersion: await doc.getDocumentVersion(id, companyId) };
      },
    },
    objects: {
      async writeBufferToFirstSearchPath(key, data) { uploads.set(key, data); },
      async deleteFromFirstSearchPath(key) { uploads.delete(key); },
    },
    async mailer(...args) {
      mail.push(args);
      return refused.has(args[2]) ? { success: false, error: "550 mailbox unavailable" } : { success: true };
    },
  };
  const handler = createInvoiceEmailHandler(transport);
  const requireAuthentication: RequestHandler = (req, res, next) => {
    if (!req.header("x-fixture-role")) { res.sendStatus(401); return; }
    req.authenticatedUserRole = req.header("x-fixture-role")!;
    req.authenticatedUserCompanyId = req.authenticatedUserRole === "super_admin" ? null : Number(req.header("x-fixture-company"));
    req.authenticatedUserId = actor.id;
    next();
  };
  const app = express();
  app.use(express.json());
  registerInvoiceBatchSendRoutes(app, {
    requireAuthentication, requireInvoiceSend,
    delivery: {
      draft: handler.draft,
      getCurrentInvoiceGuide,
      send: (invoice, customer, draft, userId) => sendInvoiceEmail(invoice, customer, draft, userId, transport),
    },
    schedule: (run) => { scheduled.push(run); },
  });
  registerOutgoingEmailRoutes(app, { requireAuthentication, handlers: [handler] });
  server.on("request", app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const origin = `http://127.0.0.1:${addr.port}`;
  async function request(path: string, body?: unknown, companyId = a.id, role = "bookkeeper") {
    const response = await fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "x-fixture-role": role, "x-fixture-company": String(companyId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: JSON.parse(await response.text()) };
  }
  async function review(invoiceIds: number[], note = "Thank you.") {
    const body = { invoiceIds, note };
    const result = await request(httpPreview, body);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { preview: result.data, body: { ...body, confirmationToken: result.data.confirmationToken } };
  }
  async function run() { assert.ok(scheduled.length); await scheduled.shift()!(); }
  async function start(invoiceIds: number[]) {
    const { body } = await review(invoiceIds);
    const result = await request(httpStart, body);
    assert.equal(result.status, 202, JSON.stringify(result.data));
    return result.data.batchId as number;
  }
  return { a, b, actor, invoice, request, review, run, start, mail, refused, uploads, replaceGuide };
}

it("previews, confirms and sends separate emails in order with exact saved PDFs and Sent stamps", async (t) => {
  const h = await harness(t);
  assert.equal(h.a.attachInvoiceGuide, true);
  const guide = await h.replaceGuide();
  const one = await h.invoice(1);
  const missing = await h.invoice(2, h.a.id, "");
  const three = await h.invoice(3);
  const { preview, body } = await h.review([one.id, missing.id, three.id]);
  assert.equal(preview.from.name, "A Irrigation");
  assert.equal(preview.from.email, h.a.emailFromAddress);
  assert.equal(preview.replyTo, "office@example.invalid");
  assert.deepEqual(preview.guide, { filename: guide.filename });
  assert.equal(preview.willSend[0].amountDue, 40);
  assert.equal(preview.willSkip[0].reason, "no_email");
  assert.equal(preview.willSend[0].subject, "Irrigation Invoice IR-1001 – The Ranch – October 2026");
  assert.equal(h.mail.length, 0);
  const row = await h.request(`${prefix}/invoice/${one.id}/preview`, { note: body.note });
  assert.equal(row.status, 200);
  assert.equal(preview.willSend[0].subject, row.data.subject);
  const started = await h.request(httpStart, body);
  assert.equal(started.status, 202);
  const { batchId } = started.data;
  assert.equal((await h.request(httpActive)).data.queued, 2);
  await h.run();
  const result = await h.request(detail(batchId));
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.items.map((item: any) => [item.invoiceId, item.status]), [
    [one.id, "sent"], [missing.id, "skipped"], [three.id, "sent"],
  ]);
  assert.deepEqual(h.mail.map(([to, , , buf, options]) => [to, options.subject, buf]), preview.willSend.map((item: any) => [
    item.to, item.subject, pdfBuffer,
  ]));
  assert.equal(h.mail[0][4].html, row.data.html);
  assert.equal(h.mail[0][4].text, row.data.text);
  assert.equal(h.mail[0][4].filename, row.data.attachments[0].filename);
  for (const [, , , , options] of h.mail) {
    assert.deepEqual(options.extraAttachments, [{ filename: guide.filename, content: guideBytes }]);
  }
  for (const invoice of [one, three]) {
    const copy = await storage.getLatestInvoiceSentCopy(invoice.id, h.a.id);
    assert.ok(copy);
    assert.ok(copy.pdfUrl.startsWith(`invoice-sent-copies/${h.a.id}/${invoice.id}/`));
    assert.deepEqual(h.uploads.get(copy.pdfUrl), pdfBuffer);
    assert.equal(copy.guideDocumentId, guide.id);
    assert.ok((await storage.getInvoiceById(invoice.id, h.a.id))?.sentAt);
  }
  assert.equal((await h.request(httpActive)).data, null);
});

it("does not send a batch if the guide changes before confirmation or while queued", async (t) => {
  const h = await harness(t);
  await h.replaceGuide();
  const one = await h.invoice(1);
  const { body } = await h.review([one.id]);
  await h.replaceGuide();
  assert.equal((await h.request(httpStart, body)).status, 409);
  const batchId = await h.start([one.id]);
  await h.replaceGuide();
  await h.run();
  assert.equal((await h.request(detail(batchId))).data.items[0].status, "failed");
  assert.equal(h.mail.length, 0);
  assert.equal(h.uploads.size, 0);
});

it("omits the guide in batch review and delivery when the company opts out", async (t) => {
  const h = await harness(t);
  await h.replaceGuide();
  await db.update(companies).set({ attachInvoiceGuide: false }).where(eq(companies.id, h.a.id));
  const one = await h.invoice(1);
  const { preview, body } = await h.review([one.id]);
  assert.equal(preview.guide, null);
  assert.equal((await h.request(httpStart, body)).status, 202);
  await h.run();
  assert.equal(h.mail.length, 1);
  assert.equal(h.mail[0][4].extraAttachments, undefined);
  assert.equal((await storage.getLatestInvoiceSentCopy(one.id, h.a.id))?.guideDocumentId, null);
});

it("keeps sending after a provider error", async (t) => {
  const h = await harness(t);
  const rows = [await h.invoice(1), await h.invoice(2), await h.invoice(3)];
  h.refused.add(rows[1].invoiceNumber);
  const id = await h.start(rows.map((row) => row.id));
  await h.run();
  const { data } = await h.request(detail(id));
  assert.deepEqual(data.items.map((item: any) => [item.status, item.message]), [
    ["sent", null], ["failed", "550 mailbox unavailable"], ["sent", null],
  ]);
  assert.equal(h.mail.length, 3);
  assert.equal(h.uploads.size, 2);
  assert.equal(await storage.getLatestInvoiceSentCopy(rows[1].id, h.a.id), undefined);
});

it("skips an invoice sent individually before its turn and never sends a changed recipient", async (t) => {
  const h = await harness(t);
  const rows = [await h.invoice(1), await h.invoice(2), await h.invoice(3)];
  const id = await h.start(rows.map((row) => row.id));
  const single = `${prefix}/invoice/${rows[1].id}`;
  const { data: singlePreview } = await h.request(`${single}/preview`, {});
  assert.equal((await h.request(`${single}/send`, { confirmationToken: singlePreview.confirmationToken })).status, 200);
  await db.update(customers).set({ email: "changed@example.invalid" }).where(eq(customers.id, rows[2].customerId));
  await h.run();
  const { data } = await h.request(detail(id));
  assert.deepEqual(data.items.map((item: any) => item.status), ["sent", "skipped", "failed"]);
  assert.match(data.items[1].message, /Already sent on/);
  assert.match(data.items[2].message, /changed after review/);
  assert.deepEqual(h.mail.map((entry) => entry[0]), ["customer2@example.invalid", "customer1@example.invalid"]);
});

it("rejects a missing or stale token and a second simultaneous batch", async (t) => {
  const h = await harness(t);
  const one = await h.invoice(1);
  const two = await h.invoice(2);
  assert.equal((await h.request(httpStart, { invoiceIds: [one.id] })).status, 400);
  assert.deepEqual(await h.request(httpPreview, { invoiceIds: Array.from({ length: 201 }, (_, i) => i + 1) }), {
    status: 400, data: { message: "Send at most 200 invoices at a time." },
  });
  const { body } = await h.review([one.id]);
  await db.update(invoices).set({ updatedAt: new Date() }).where(eq(invoices.id, one.id));
  const stale = await h.request(httpStart, body);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.message, "The invoices changed after you reviewed them. Review again. Nothing was sent.");
  assert.deepEqual(await db.select().from(emailBatches).where(eq(emailBatches.companyId, h.a.id)), []);
  const previouslyUsed = await h.review([one.id]);
  await db.insert(emailBatches).values({
    companyId: h.a.id, createdByUserId: h.actor.id, kind: "invoice", status: "completed",
    confirmationDigest: emailReviewDigest(previouslyUsed.body.confirmationToken),
  });
  const replay = await h.request(httpStart, previouslyUsed.body);
  assert.equal(replay.status, 409);
  assert.equal(replay.data.reason, "confirmation_used", "replay must not depend on a process-local spent-token map");
  const freshOne = await h.review([one.id]);
  const freshTwo = await h.review([two.id]);
  const results = await Promise.all([h.request(httpStart, freshOne.body), h.request(httpStart, freshTwo.body)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [202, 409]);
  assert.equal(results.find((result) => result.status === 409)?.data.message, "Another batch is still sending for this company.");
  await recoverInterruptedEmailBatches();
  assert.equal((await h.request(httpActive)).data.status, "running", "boot recovery must not interrupt a live worker");
  await h.run();
});

it("recovers abandoned sending items without retrying them; resume only processes queued", async (t) => {
  const h = await harness(t);
  const one = await h.invoice(1);
  const two = await h.invoice(2);
  const three = await h.invoice(3);
  const initial = await h.start([one.id, two.id, three.id]);
  await h.run();
  const existing = await db.select().from(emailBatchItems).where(eq(emailBatchItems.batchId, initial)).orderBy(emailBatchItems.position);
  // Simulate the persisted state left by a stopped process, with only the
  // first mail accepted and no session lease still held.
  await db.update(emailBatches).set({ status: "running", completedAt: null }).where(eq(emailBatches.id, initial));
  await db.update(emailBatchItems).set({ status: "sending", sentAt: null }).where(eq(emailBatchItems.id, existing[1].id));
  await db.update(emailBatchItems).set({ status: "queued", sentAt: null }).where(eq(emailBatchItems.id, existing[2].id));
  await db.delete(invoicePdfs).where(inArray(invoicePdfs.invoiceId, [two.id, three.id]));
  await db.update(invoices).set({ sentAt: null }).where(inArray(invoices.id, [two.id, three.id]));
  h.mail.length = 0;
  await recoverInterruptedEmailBatches();
  const { data: interrupted } = await h.request(detail(initial));
  assert.equal(interrupted.status, "interrupted");
  assert.deepEqual(interrupted.items.map((item: any) => [item.status, item.message]), [
    ["sent", null], ["failed", INTERRUPTED_SEND], ["queued", null],
  ]);
  assert.equal((await h.request(httpActive)).data.queued, 1);
  const resumed = await h.request(`${detail(initial)}/resume`, {});
  assert.equal(resumed.status, 202);
  await h.run();
  assert.equal((await h.request(`${detail(initial)}/resume`, {})).status, 409);
  assert.deepEqual(h.mail.map((entry) => entry[2]), [three.invoiceNumber]);
  assert.equal((await h.request(detail(initial))).data.status, "completed");
});

it("does not expose foreign invoices or batch IDs; super admins must choose a company", async (t) => {
  const h = await harness(t);
  const ours = await h.invoice(1);
  const other = await h.invoice(2, h.b.id);
  const { preview, body } = await h.review([other.id, ours.id]);
  assert.deepEqual(preview.notFound, [other.id]);
  assert.deepEqual(preview.willSend.map((item: any) => item.invoiceId), [ours.id]);
  const { data } = await h.request(httpStart, body);
  assert.equal((await h.request(detail(data.batchId), undefined, h.b.id)).status, 404);
  assert.equal((await h.request(`${detail(data.batchId)}/resume`, {}, h.b.id)).status, 404);
  assert.equal((await h.request(httpActive, undefined, h.b.id)).data, null);
  assert.equal((await h.request(httpPreview, { invoiceIds: [ours.id] }, h.b.id, "field_tech")).status, 403);
  assert.equal((await h.request(httpActive, undefined, h.b.id, "super_admin")).status, 400);
  const admin = await h.request(httpPreview, { companyId: h.b.id, invoiceIds: [ours.id, other.id] }, h.a.id, "super_admin");
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.data.notFound, [ours.id]);
  assert.equal(admin.data.willSend[0].invoiceId, other.id);
  assert.equal((await h.request(`${detail(data.batchId)}?companyId=${h.a.id}`, undefined, h.b.id, "super_admin")).status, 200);
  assert.equal((await h.request(`${detail(data.batchId)}?companyId=${h.b.id}`, undefined, h.a.id, "super_admin")).status, 404);
  await h.run();
  assert.equal(h.mail.length, 1);
});

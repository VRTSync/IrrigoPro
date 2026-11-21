import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, it } from "node:test";
import express, { type RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { auditLog, companies, companyEmailWording, customers, db, invoices, pool, users } from "@workspace/db";
import { ListCompanyEmailWordingResponse, SaveCompanyEmailWordingResponse } from "@workspace/api-zod";
import { renderReminderEmail } from "../invoice-reminder-templates";
import { createInvoiceEmailHandler } from "../outgoing-email/invoice-handler";
import { defaultEmailWording, EMAIL_LABELS, getEmailWording, isEmailKey } from "../outgoing-email/wording";
import { renderWordingPreview } from "../outgoing-email/wording-preview";
import { storage } from "../storage";
import { registerEmailWordingRoutes } from "./email-wording-routes";
import { registerInvoiceBatchSendRoutes } from "./invoice-batch-send-routes";
import { registerOutgoingEmailRoutes } from "./outgoing-email-routes";
import { requireInvoiceSend } from "./role-guards";

after(async () => { await pool.end(); });

it("scopes wording and audit history, and uses saved invoice wording in both reviewed send paths", async t => {
  const companyIds: number[] = [];
  const server = createServer();
  t.after(async () => {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (!companyIds.length) return;
    await db.delete(auditLog).where(and(inArray(auditLog.targetId, companyIds.map(String)), eq(auditLog.targetType, "company"),
      inArray(auditLog.action, ["email_wording.updated", "email_wording.reset"])));
    await db.delete(companyEmailWording).where(inArray(companyEmailWording.companyId, companyIds));
    await db.delete(invoices).where(inArray(invoices.companyId, companyIds));
    await db.delete(customers).where(inArray(customers.companyId, companyIds));
    await db.delete(users).where(inArray(users.companyId, companyIds));
    await db.delete(companies).where(inArray(companies.id, companyIds));
  });
  const salt = randomUUID();
  const addCompany = async (label: string) => {
    const [company] = await db.insert(companies).values({
      name: `Wording ${label} ${salt}`, phone: "9705550100", address: "100 Test Street",
      email: "office@example.invalid", logo: "company-logos/sample-test-logo", attachInvoiceGuide: false,
    }).returning();
    companyIds.push(company.id);
    return company;
  };
  const a = await addCompany("A");
  const b = await addCompany("B");
  const [actor] = await db.insert(users).values({
    username: `wording-${salt}`, password: "not-used", name: "Wording Test Admin", companyId: a.id, role: "company_admin",
  }).returning();
  const date = new Date("2026-10-31T12:00:00Z");
  async function addInvoice(companyId: number) {
    const [customer] = await db.insert(customers).values({ companyId, name: "Invoice Fixture", email: "test@example.invalid" }).returning();
    const [invoice] = await db.insert(invoices).values({
      companyId, customerId: customer.id, invoiceNumber: "IR-2001", customerName: customer.name, customerEmail: customer.email,
      status: "generated", invoiceMonth: 10, invoiceYear: 2026, periodStart: new Date("2026-10-01T12:00:00Z"),
      periodEnd: date, createdAt: date, dueDate: new Date("2026-11-30T12:00:00Z"),
      partsSubtotal: "1250.00", laborSubtotal: "0.00", totalAmount: "1250.00",
    }).returning();
    return invoice;
  }
  const invoiceA = await addInvoice(a.id);
  const invoiceB = await addInvoice(b.id);
  const requireAuthentication: RequestHandler = (req, res, next) => {
    const role = req.header("x-test-role");
    if (!role) { res.sendStatus(401); return; }
    req.authenticatedUserRole = role;
    req.authenticatedUserCompanyId = role === "super_admin" ? null : Number(req.header("x-test-company"));
    req.authenticatedUserId = actor.id;
    next();
  };
  const mustNotSend = async (): Promise<never> => { assert.fail("A preview must not send anything"); };
  const handler = createInvoiceEmailHandler({
    storage,
    pdf: { getDocumentVersion: async () => "test-source-version", generatePdfBuffer: mustNotSend },
    objects: { writeBufferToFirstSearchPath: mustNotSend, deleteFromFirstSearchPath: mustNotSend },
    mailer: mustNotSend,
  });
  const app = express();
  app.use(express.json());
  registerEmailWordingRoutes(app, { requireAuthentication });
  registerInvoiceBatchSendRoutes(app, { requireAuthentication, requireInvoiceSend, delivery: { draft: handler.draft, send: mustNotSend } });
  registerOutgoingEmailRoutes(app, { requireAuthentication, handlers: [handler] });
  server.on("request", app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = async (path: string, method = "GET", body?: unknown, companyId = a.id, role = "company_admin") => {
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, headers: { "content-type": "application/json", "x-test-role": role, "x-test-company": String(companyId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: any = res.status === 204 || res.status === 401 ? null : await res.json();
    return { status: res.status, data };
  };
  const path = (companyId: number) => `/api/company/${companyId}/email-wording`;
  const own = `${path(a.id)}/invoice`;
  const foreign = `${path(b.id)}/invoice`;
  const defaults = defaultEmailWording("invoice");
  const custom = { ...defaults, subject: `Updated wording {invoiceNumber}`, intro: "Thank you & please see {invoiceNumber}." };
  const invalid = { ...custom, intro: "Invoice {invoiceNumbr}." };

  const listed = await request(path(a.id));
  assert.equal(listed.status, 200);
  assert.equal(listed.data.length, 9);
  assert.deepEqual(listed.data[0].wording, defaults);
  assert.equal(listed.data[0].isCustom, false);
  assert.equal((await request(path(a.id), "GET", undefined, a.id, "")).status, 401);
  for (const [target, method] of [[path(b.id), "GET"], [foreign, "PUT"], [foreign, "DELETE"], [`${foreign}/preview`, "POST"]]) {
    assert.equal((await request(target, method, method === "GET" || method === "DELETE" ? undefined : custom)).status, 403);
  }
  for (const [target, method] of [[path(a.id), "GET"], [own, "PUT"], [own, "DELETE"], [`${own}/preview`, "POST"]]) {
    assert.equal((await request(target, method, method === "GET" || method === "DELETE" ? undefined : custom, a.id, "billing_manager")).status, 403);
  }
  assert.equal((await request(path(b.id), "GET", undefined, a.id, "super_admin")).status, 200);
  assert.equal((await request(path(2147483647), "GET", undefined, a.id, "super_admin")).status, 404);
  assert.equal((await request(`${path(a.id)}/constructor/preview`, "POST", custom)).status, 404);

  const badSave = await request(own, "PUT", invalid);
  assert.equal(badSave.status, 422);
  assert.equal(badSave.data.message, "Fix the highlighted fields.");
  assert.match(badSave.data.fieldErrors.intro, /^Unknown placeholder \{invoiceNumbr\}\. Use one of:/);
  assert.deepEqual(await request(`${own}/preview`, "POST", invalid), { status: 200, data: { fieldErrors: badSave.data.fieldErrors } });

  const single = (id: number) => `/api/outgoing-email/invoice/${id}`;
  const initial = await request(`${single(invoiceA.id)}/preview`, "POST", {});
  assert.equal(initial.status, 200);
  const saved = await request(own, "PUT", { ...custom, subject: ` ${custom.subject} ` });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.isCustom, true);
  assert.equal(saved.data.updatedBy, actor.name);
  assert.ok(Number.isFinite(Date.parse(saved.data.updatedAt)));
  assert.deepEqual(await getEmailWording(a.id, "invoice"), custom);
  assert.deepEqual(await getEmailWording(b.id, "invoice"), defaults);
  const listing = await request(path(a.id));
  assert.deepEqual(listing.data[0], saved.data);
  assert.equal((await request(path(b.id), "GET", undefined, b.id)).data[0].isCustom, false);

  const staleSend = await request(`${single(invoiceA.id)}/send`, "POST", { confirmationToken: initial.data.confirmationToken });
  assert.equal(staleSend.status, 409);
  const reviewed = await request(`${single(invoiceA.id)}/preview`, "POST", {});
  assert.equal(reviewed.data.subject, "Updated wording IR-2001");
  assert.match(reviewed.data.html, /Thank you &amp; please see IR-2001\./);
  const unaffected = await request(`${single(invoiceB.id)}/preview`, "POST", {}, b.id);
  assert.equal(unaffected.data.subject, initial.data.subject);
  const batch = await request("/api/outgoing-email/invoice/batch/preview", "POST", { invoiceIds: [invoiceA.id] });
  assert.equal(batch.status, 200);
  assert.equal(batch.data.willSend[0].subject, reviewed.data.subject);

  for (const key of Object.keys(EMAIL_LABELS).filter(isEmailKey)) {
    const preview = await request(`${path(a.id)}/${key}/preview`, "POST", defaultEmailWording(key));
    assert.equal(preview.status, 200, key);
    assert.equal(preview.data.fieldErrors, null, key);
    assert.match(preview.data.html, /Sample Customer/);
    assert.match(preview.data.html, /sample-test-logo/);
    assert.match(preview.data.text, /100 Test Street/);
  }
  const reminderWording = { ...defaultEmailWording("reminder_final"), intro: "Please contact us about {invoiceNumber}." };
  const direct = renderReminderEmail({
    company: a, wording: reminderWording, templateKey: "final_notice", customerName: "Sample Customer", invoiceNumber: "IR-1001",
    billingMonth: "October 2026", billingPeriodRange: "Oct 1 – Oct 31, 2026", effectiveDueDate: new Date("2026-11-30T19:00:00Z"),
    daysOverdue: 12, balanceDue: 1250, note: "",
    attachmentFilename: "Sample Customer - Irrigation Billing Detail - (10-1-26_10-31-26).pdf",
  });
  assert.deepEqual(await renderWordingPreview("reminder_final", reminderWording, a), direct);
  assert.deepEqual((await request(`${path(a.id)}/reminder_final/preview`, "POST", reminderWording)).data, { ...direct, fieldErrors: null });
  assert.deepEqual(await getEmailWording(a.id, "reminder_final"), defaultEmailWording("reminder_final"), "preview is read only");
  assert.equal((await request(own, "DELETE")).status, 204);
  assert.equal((await request(own, "DELETE")).status, 204);
  assert.deepEqual(await getEmailWording(a.id, "invoice"), defaults);
  const events = await db.select().from(auditLog).where(and(eq(auditLog.targetId, String(a.id)), eq(auditLog.targetType, "company"))).orderBy(auditLog.id);
  assert.deepEqual(events.map(event => event.action), ["email_wording.updated", "email_wording.reset", "email_wording.reset"]);
  assert.deepEqual(events[0].details, { key: "invoice", before: defaults, after: custom });
  assert.deepEqual(events[1].details, { key: "invoice", before: custom, after: defaults });
});

it("preserves company wording, timestamps and audit events after either permanent user deletion", async t => {
  const salt = randomUUID();
  const [company] = await db.insert(companies).values({ name: `Wording offboarding ${salt}` }).returning();
  t.after(async () => {
    await db.delete(auditLog).where(and(eq(auditLog.targetType, "company"), eq(auditLog.targetId, String(company.id)),
      eq(auditLog.action, "email_wording.updated")));
    await db.delete(companyEmailWording).where(eq(companyEmailWording.companyId, company.id));
    await db.delete(users).where(eq(users.companyId, company.id));
    await db.delete(companies).where(eq(companies.id, company.id));
  });
  const [reviewer, normalEditor, cascadeEditor] = await db.insert(users).values(
    ["remaining-admin", "normal-editor", "cascade-editor"].map(name => ({
      username: `${name}-${salt}`, password: "not-used", name, companyId: company.id, role: "company_admin",
    })),
  ).returning();
  const { registerRoutes } = await import("./routes");
  const server = await registerRoutes(express().use(express.json()));
  t.after(async () => {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const path = `/api/company/${company.id}/email-wording`;
  const asUser = (userId: number) => ({
    "content-type": "application/json", "x-user-id": String(userId),
    "x-user-role": "company_admin", "x-user-company-id": String(company.id),
  });
  const cases = [
    { key: "invoice", editor: normalEditor, deletion: `/api/users/${normalEditor.id}` },
    { key: "reminder_final", editor: cascadeEditor, deletion: `/api/users/${cascadeEditor.id}/hard-delete` },
  ] as const;
  for (const { key, editor, deletion } of cases) {
    const wording = { ...defaultEmailWording(key), intro: "Please review our statement for {invoiceNumber}." };
    const save = await fetch(`${origin}${path}/${key}`, {
      method: "PUT", headers: asUser(editor.id), body: JSON.stringify(wording),
    });
    assert.equal(save.status, 200);
    const saved = SaveCompanyEmailWordingResponse.parse(await save.json());
    assert.equal(saved.updatedBy, editor.name);

    const deleted = await fetch(`${origin}${deletion}`, { method: "DELETE", headers: asUser(reviewer.id) });
    assert.equal(deleted.status, 200, deletion);
    assert.equal(await storage.getUser(editor.id), undefined, "the user was permanently removed");
    const listing = await fetch(`${origin}${path}`, { headers: asUser(reviewer.id) });
    assert.equal(listing.status, 200);
    const entries = ListCompanyEmailWordingResponse.parse(await listing.json());
    assert.deepEqual(entries.find(entry => entry.key === key), { ...saved, updatedBy: null });
    assert.deepEqual(await getEmailWording(company.id, key), wording);
    const [event] = await db.select().from(auditLog).where(and(
      eq(auditLog.action, "email_wording.updated"), eq(auditLog.targetType, "company"),
      eq(auditLog.targetId, String(company.id)), eq(auditLog.actorUserId, editor.id),
    ));
    assert.deepEqual(event?.details, { key, before: defaultEmailWording(key), after: wording });
  }
});

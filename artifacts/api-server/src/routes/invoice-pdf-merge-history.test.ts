import { it } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLog, billingSheets, companies, customers, invoiceItems, invoicePdfs, invoiceReminders, invoices, users } from "@workspace/db/schema";
import { db } from "../db";
import { InvoicePdfService } from "../invoice-pdf-service";
import { storage } from "../storage";
import { createInvoiceEmailHandler } from "../outgoing-email/invoice-handler";
import { registerOutgoingEmailRoutes } from "./outgoing-email-routes";
import { registerInvoiceEditabilityRoutes } from "./invoice-editability-routes";
import { createReminderCore } from "./invoice-reminder-routes";

it("keeps pre-merge sent copies for audit but only reminds with the newly sent merged document", async () => {
  const [company] = await db.insert(companies).values({ name: `Invoice merge test ${crypto.randomUUID()}` }).returning();
  const invoiceIds: number[] = [];
  try {
    const [customer] = await db.insert(customers).values({
      companyId: company.id, name: "Merge Fixture", email: "billing@example.invalid",
    }).returning();
    const [user] = await db.insert(users).values({
      companyId: company.id, name: "Test sender", username: `merge-pdf-${crypto.randomUUID()}`,
      password: "unused", role: "billing_manager",
    }).returning();
    const [survivor, absorbed] = await db.insert(invoices).values(["IR-MERGE-A", "IR-MERGE-B"].map(invoiceNumber => ({
      invoiceNumber, companyId: company.id, customerId: customer.id, customerName: customer.name,
      customerEmail: customer.email!, invoiceMonth: 10, invoiceYear: 2026, status: "generated",
      periodStart: new Date(2026, 9, 1), periodEnd: new Date(2026, 9, 31),
      dueDate: new Date(2026, 10, 1), totalAmount: "100", partsSubtotal: "50", laborSubtotal: "50",
    }))).returning();
    invoiceIds.push(survivor.id, absorbed.id);

    const scope = { authenticatedUserCompanyId: company.id, authenticatedUserRole: "billing_manager", authenticatedUserId: user.id };
    const auth: RequestHandler = (req, _res, next) => { Object.assign(req, scope); next(); };
    const objects = new Map<string, Buffer>();
    const received: Buffer[] = [];
    const app = express();
    app.use(express.json());
    const pdf = new InvoicePdfService(storage);
    const handler = createInvoiceEmailHandler({
      storage,
      pdf: {
        getDocumentVersion: pdf.getDocumentVersion.bind(pdf),
        generatePdfBuffer: async (id) => ({
          success: true,
          documentVersion: await pdf.getDocumentVersion(id, company.id),
          pdfBuffer: Buffer.from(`%PDF-1.7\n${(await storage.getInvoiceById(id, company.id))!.totalAmount}`),
        }),
      },
      objects: {
        async writeBufferToFirstSearchPath(key, bytes) { objects.set(key, bytes); },
        async deleteFromFirstSearchPath(key) { objects.delete(key); },
      },
      mailer: async (_to, _name, _number, pdf) => {
        received.push(pdf);
        return { success: true };
      },
    });
    registerOutgoingEmailRoutes(app, { requireAuthentication: auth, handlers: [handler] });
    const reminders = createReminderCore({
      _readSentCopy: async key => objects.get(key) ?? null,
      _loadPaymentTerms: async () => null,
      _mailer: async (_to, _name, _number, pdf) => {
        received.push(pdf);
        return { success: true };
      },
    });
    const emailUrl = `/api/outgoing-email/invoice/${survivor.id}`;
    async function reviewAndSend() {
      const { body } = await request(app).post(`${emailUrl}/preview`).send({}).expect(200);
      await request(app).post(`${emailUrl}/send`).send({ confirmationToken: body.confirmationToken }).expect(200);
    }
    await reviewAndSend();
    const original = await storage.getLatestInvoiceSentCopy(survivor.id);
    assert.ok(original);

    await storage.mergeInvoices({ survivingId: survivor.id, mergedIds: [absorbed.id], companyId: company.id });
    const [historical] = await db.select().from(invoicePdfs).where(eq(invoicePdfs.id, original.id));
    assert.deepEqual(historical, { ...original, status: "superseded" });
    assert.deepEqual(objects.get(original.pdfUrl), received[0]);
    assert.equal(await storage.getLatestInvoiceSentCopy(survivor.id), undefined);
    const refusal = await reminders.sendOne(scope, survivor.id, "firm");
    assert.equal(refusal.outcome, "skipped");
    assert.equal(refusal.reason, "no_pdf");
    assert.equal(received.length, 1);

    await reviewAndSend();
    const latest = await storage.getLatestInvoiceSentCopy(survivor.id);
    assert.ok(latest);
    assert.notEqual(latest.id, original.id);
    assert.notDeepEqual(received[1], received[0]);
    assert.equal((await reminders.sendOne(scope, survivor.id, "firm")).outcome, "sent");
    assert.deepEqual(received[2], received[1]);
    assert.deepEqual(objects.get(original.pdfUrl), received[0], "resend leaves the historical object intact");
  } finally {
    await db.transaction(async tx => {
      if (invoiceIds.length) {
        await tx.delete(auditLog).where(and(eq(auditLog.targetType, "invoice"), inArray(auditLog.targetId, invoiceIds.map(String))));
      }
      await tx.delete(invoiceReminders).where(eq(invoiceReminders.companyId, company.id));
      await tx.delete(invoicePdfs).where(eq(invoicePdfs.companyId, company.id));
      await tx.delete(invoices).where(eq(invoices.companyId, company.id));
      await tx.delete(users).where(eq(users.companyId, company.id));
      await tx.delete(customers).where(eq(customers.companyId, company.id));
      await tx.delete(companies).where(eq(companies.id, company.id));
    });
  }
});

it("refuses an unchanged-total ticket replacement or a source-only edit after review", async () => {
  const [company] = await db.insert(companies).values({ name: `Invoice email review ${crypto.randomUUID()}` }).returning();
  try {
    const [customer] = await db.insert(customers).values({
      companyId: company.id, name: "Review Fixture", email: "billing@example.invalid",
    }).returning();
    const [user] = await db.insert(users).values({
      companyId: company.id, name: "Test sender", username: `review-pdf-${crypto.randomUUID()}`,
      password: "unused", role: "billing_manager",
    }).returning();
    const [invoice] = await db.insert(invoices).values({
      invoiceNumber: "IR-REVIEW-A", companyId: company.id, customerId: customer.id,
      customerName: customer.name, customerEmail: customer.email!,
      invoiceMonth: 10, invoiceYear: 2026, status: "draft",
      periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"),
      totalAmount: "100.00", partsSubtotal: "0.00", laborSubtotal: "100.00",
    }).returning();
    const [original, replacement] = await db.insert(billingSheets).values(["Original", "Replacement"].map(label => ({
      companyId: company.id, customerId: customer.id, customerName: customer.name,
      billingNumber: `BS-${label}-${company.id}`, technicianName: "Test Tech", propertyAddress: "Fixture Site",
      workDate: new Date("2026-10-02"), workDescription: label, totalHours: "1.00", laborRate: "100.00",
      laborSubtotal: "100.00", partsSubtotal: "0.00", totalAmount: "100.00",
      status: label === "Original" ? "billed" : "approved_passed_to_billing",
      invoiceId: label === "Original" ? invoice.id : null,
    }))).returning();
    await db.insert(invoiceItems).values({
      invoiceId: invoice.id, sourceType: "billing_sheet", sourceId: original.id, billingSheetId: original.id,
      description: original.workDescription, workDate: original.workDate, totalPrice: "100.00", laborTotal: "100.00",
    });
    const auth: RequestHandler = (req, _res, next) => {
      Object.assign(req, { authenticatedUserCompanyId: company.id, authenticatedUserRole: "billing_manager", authenticatedUserId: user.id });
      next();
    };
    const pass: RequestHandler = (_req, _res, next) => next();
    const app = express();
    app.use(express.json());
    registerInvoiceEditabilityRoutes(app, { requireAuthentication: auth, requireInvoiceRead: pass, requireInvoiceWrite: pass });
    const pdf = new InvoicePdfService(storage);
    const effects: string[] = [];
    const handler = createInvoiceEmailHandler({
      storage,
      pdf: {
        getDocumentVersion: pdf.getDocumentVersion.bind(pdf),
        async generatePdfBuffer() { effects.push("render"); throw new Error("Unexpected PDF render"); },
      },
      objects: {
        async writeBufferToFirstSearchPath() { effects.push("upload"); },
        async deleteFromFirstSearchPath() { effects.push("delete"); },
      },
      async mailer() { effects.push("email"); return { success: true }; },
    });
    registerOutgoingEmailRoutes(app, { requireAuthentication: auth, handlers: [handler] });
    const emailUrl = `/api/outgoing-email/invoice/${invoice.id}`;
    const tickets = `/api/invoices/${invoice.id}/tickets`;
    const preview = async () => (await request(app).post(`${emailUrl}/preview`).send({}).expect(200)).body.confirmationToken;
    const expectStale = async (confirmationToken: string) => {
      const { body } = await request(app).post(`${emailUrl}/send`).send({ confirmationToken }).expect(409);
      assert.equal(body.message, "This invoice changed after you reviewed it. Review it again before sending.");
      assert.deepEqual(effects, []);
    };

    const beforeSwap = await preview();
    await request(app).post(tickets).send({ ticketType: "billing_sheet", ticketId: replacement.id }).expect(200);
    await request(app).delete(`${tickets}/billing_sheet:${original.id}`).expect(200);
    const afterSwap = await storage.getInvoiceById(invoice.id, company.id);
    assert.equal(afterSwap?.totalAmount, invoice.totalAmount);
    assert.deepEqual(afterSwap?.updatedAt, invoice.updatedAt, "ticket routes do not bump the invoice timestamp");
    assert.deepEqual(afterSwap?.items.map(item => item.billingSheetId), [replacement.id]);
    await expectStale(beforeSwap);

    const beforeDetailEdit = await preview();
    await db.update(billingSheets).set({ workDescription: "Different work detail, unchanged total" })
      .where(and(eq(billingSheets.id, replacement.id), eq(billingSheets.companyId, company.id)));
    await expectStale(beforeDetailEdit);
  } finally {
    await db.transaction(async tx => {
      await tx.delete(auditLog).where(eq(auditLog.actorCompanyId, company.id));
      await tx.delete(invoiceItems).where(inArray(invoiceItems.invoiceId, tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.companyId, company.id))));
      await tx.delete(billingSheets).where(eq(billingSheets.companyId, company.id));
      await tx.delete(invoices).where(eq(invoices.companyId, company.id));
      await tx.delete(users).where(eq(users.companyId, company.id));
      await tx.delete(customers).where(eq(customers.companyId, company.id));
      await tx.delete(companies).where(eq(companies.id, company.id));
    });
  }
});

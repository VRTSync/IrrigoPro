import { it } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLog, companies, customers, invoicePdfs, invoiceReminders, invoices, users } from "@workspace/db/schema";
import { db } from "../db";
import { storage } from "../storage";
import { registerInvoicePdfRoutes } from "./invoice-pdf-routes";
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
    const guard: RequestHandler = (_req, _res, next) => next();
    const objects = new Map<string, Buffer>();
    const received: Buffer[] = [];
    const app = express();
    registerInvoicePdfRoutes(app, {
      requireAuthentication: auth, requireInvoiceRead: guard, requireInvoiceSend: guard,
      _generatePdf: async (id) => ({
        success: true,
        pdfBuffer: Buffer.from(`%PDF-1.7\n${(await storage.getInvoiceById(id, company.id))!.totalAmount}`),
      }),
      _objectStorage: {
        async writeBufferToFirstSearchPath(key, bytes) { objects.set(key, bytes); },
        async deleteFromFirstSearchPath(key) { objects.delete(key); },
      },
      _mailer: async (_to, _name, _number, pdf) => {
        received.push(pdf);
        return { success: true };
      },
    });
    const reminders = createReminderCore({
      _readSentCopy: async key => objects.get(key) ?? null,
      _loadPaymentTerms: async () => null,
      _mailer: async (_to, _name, _number, pdf) => {
        received.push(pdf);
        return { success: true };
      },
    });
    const sendUrl = `/api/invoices/${survivor.id}/pdf/send`;
    await request(app).post(sendUrl).expect(200);
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

    await request(app).post(sendUrl).expect(200);
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

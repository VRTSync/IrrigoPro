import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { companies, customers, users, parts, pricingAuditEvents, materialMarkupSchedules, materialMarkupTiers,
  billingSheets, billingSheetItems, workOrders, workOrderItems, estimates, estimateItems } from "@workspace/db";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import { db, pool } from "../db";
import { storage } from "../storage";
import { createMarkupSchedule, activateMarkupSchedule, getActiveMarkupSchedule } from "../storage/markup-schedules";
import { previewMarkupRecalculation, runMarkupRecalculation, repriceMarkupPart } from "./markup-recalculation";

test("confirmed 100-part batches, accurate counts, repeatability, atomic audits and frozen documents", async () => {
  const [company] = await db.insert(companies).values({ name: "Recalculation test" }).returning();
  const companyId = company.id;
  try {
    const [user] = await db.insert(users).values({ companyId, role: "company_admin", username: `markup-${companyId}`, name: "Markup reviewer", password: "not-a-login" }).returning();
    const actor = { companyId, userId: user.id, name: user.name };
    const [customer] = await db.insert(customers).values({ companyId, name: "Customer", email: "reprice@example.invalid" }).returning();
    const schedule = await createMarkupSchedule({ companyId, name: "Default fixture", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    await assert.rejects(previewMarkupRecalculation(actor), /No active/);
    await activateMarkupSchedule(schedule.id, companyId);
    const catalog = await db.insert(parts).values([
      ...Array.from({ length: 205 }, (_, i) => ({ companyId, name: `Valve ${i}`, sku: `VALVE-${i}`, cost: "180.00", price: "1.00", category: "Valve" })),
      ...["Rental", "Service", "Labor"].map(category => ({ companyId, name: category, sku: category, cost: "180.00", price: "70.00", category })),
      { companyId, name: "No cost", sku: "NO-COST", cost: null, price: "20.00", category: "Valve" },
      { companyId, name: "Zero cost", sku: "ZERO", cost: "0", price: "21.00", category: "Valve" },
      { companyId, name: "Inactive", sku: "INACTIVE", cost: "180", price: "22.00", category: "Valve", isActive: false },
    ]).returning();
    const [sheet] = await db.insert(billingSheets).values({
      companyId, customerId: customer.id, billingNumber: `MARKUP-${companyId}`, customerName: "Customer", propertyAddress: "Test",
      workDate: new Date(), technicianName: "Reviewer", workDescription: "Test", totalHours: "0", laborRate: "45", laborSubtotal: "0", partsSubtotal: "7", totalAmount: "7",
    }).returning();
    const [sheetItem] = await db.insert(billingSheetItems).values({ billingSheetId: sheet.id, partId: catalog[0].id, partName: "Frozen", quantity: "1", unitPrice: "7", totalPrice: "7" }).returning();
    const [order] = await db.insert(workOrders).values({ companyId, customerId: customer.id, workOrderNumber: `MARKUP-${companyId}`, customerName: "Customer", customerEmail: "fixture@example.invalid", projectName: "Frozen" }).returning();
    const [orderItem] = await db.insert(workOrderItems).values({ workOrderId: order.id, partId: catalog[0].id, partName: "Frozen", quantity: 1, partPrice: "8", totalPrice: "8" }).returning();
    const [estimate] = await db.insert(estimates).values({ companyId, customerId: customer.id, estimateNumber: `MARKUP-${companyId}`, customerName: "Customer", customerEmail: "fixture@example.invalid", projectName: "Frozen", laborRate: "45", partsSubtotal: "9", laborSubtotal: "0", totalAmount: "9" }).returning();
    const [estimateItem] = await db.insert(estimateItems).values({ estimateId: estimate.id, partId: catalog[0].id, partName: "Frozen", quantity: 1, partPrice: "9", totalPrice: "9" }).returning();

    const preview = await previewMarkupRecalculation(actor);
    assert.equal(preview.eligible, 205); assert.equal(preview.excluded, 6);
    await assert.rejects(runMarkupRecalculation({ ...actor, userId: actor.userId + 1 }, preview.confirmationToken, 0), /Preview/);
    await assert.rejects(runMarkupRecalculation({ ...actor, companyId: companyId + 1 }, preview.confirmationToken, 0), /Preview/);
    await assert.rejects(runMarkupRecalculation(actor, "missing", 0), /Preview/);
    let result = await runMarkupRecalculation(actor, preview.confirmationToken, 0);
    assert.equal(result.processed, 100); assert.equal(result.updated, 100); assert.equal(result.done, false);
    await assert.rejects(runMarkupRecalculation(actor, preview.confirmationToken, 0), /already/);
    result = await runMarkupRecalculation(actor, preview.confirmationToken, 100);
    assert.equal(result.processed, 200);
    result = await runMarkupRecalculation(actor, preview.confirmationToken, 200);
    assert.deepEqual(result, { total: 205, processed: 205, updated: 205, unchanged: 0, excluded: 6, errors: [], done: true });
    const audits = await db.select().from(pricingAuditEvents).where(eq(pricingAuditEvents.companyId, companyId)).orderBy(pricingAuditEvents.id);
    assert.equal(audits.length, 205);
    assert.deepEqual(audits[0].details, { beforePrice: "1.00", afterPrice: "288.25", cost: "180.00", scheduleId: schedule.id, scheduleName: schedule.name, effectiveMarkupPercent: (288.25 - 180) / 180 * 100 });
    assert.equal(audits[0].source, "catalog_part"); assert.equal(audits[0].kind, "markup_schedule_reprice");
    assert.equal(audits[0].parentNumber, "VALVE-0"); assert.equal(audits[0].itemCount, 1);
    assert.equal(audits[0].actorUserId, user.id); assert.equal(audits[0].actorName, user.name);
    assert.equal(audits[0].delta, "287.25");
    const second = await previewMarkupRecalculation(actor);
    let repeated = await runMarkupRecalculation(actor, second.confirmationToken, 0);
    while (!repeated.done) repeated = await runMarkupRecalculation(actor, second.confirmationToken, repeated.processed);
    assert.equal(repeated.updated, 0); assert.equal(repeated.unchanged, 205);
    assert.equal((await db.select().from(pricingAuditEvents).where(eq(pricingAuditEvents.companyId, companyId))).length, 205);
    const unchanged = await db.select().from(parts).where(inArray(parts.id, catalog.slice(205).map(p => p.id)));
    assert.deepEqual(unchanged.map(p => p.price), catalog.slice(205).map(p => p.price));

    // Approval must compute a tamper-resistant catalog price without propagating
    // into open (not just invoiced) documents.
    await storage.approvePart(catalog[0].id, "0.01", "1.75", companyId);
    assert.equal((await storage.getPart(catalog[0].id))?.price, "4.38");
    assert.deepEqual((await db.select().from(billingSheetItems).where(eq(billingSheetItems.id, sheetItem.id)))[0], sheetItem);
    assert.deepEqual((await db.select().from(workOrderItems).where(eq(workOrderItems.id, orderItem.id)))[0], orderItem);
    assert.deepEqual((await db.select().from(estimateItems).where(eq(estimateItems.id, estimateItem.id)))[0], estimateItem);

    // An audit failure rolls the price back in the very same transaction.
    const [expected] = await db.select().from(parts).where(eq(parts.id, catalog[0].id));
    const context = (await getActiveMarkupSchedule(companyId))!;
    const transaction = db.transaction.bind(db);
    const spy = mock.method(db, "transaction", (fn: any) => transaction(async tx => {
      const insert = tx.insert.bind(tx);
      const insertSpy = mock.method(tx, "insert", (table: any) => {
        if (table === pricingAuditEvents) throw new Error("Injected audit failure");
        return insert(table);
      });
      try { return await fn(tx); } finally { insertSpy.mock.restore(); }
    }));
    // Different applicable tiers force a price change.
    try {
      await assert.rejects(repriceMarkupPart(expected, { ...context, tiers: context.tiers.map(t => ({ ...t, markupPercent: 1 })) }, actor), /audit failure/);
    } finally { spy.mock.restore(); }
    assert.equal((await storage.getPart(expected.id))?.price, expected.price);

    const stale = await previewMarkupRecalculation(actor);
    await db.update(parts).set({ cost: "2" }).where(eq(parts.id, expected.id));
    await assert.rejects(runMarkupRecalculation(actor, stale.confirmationToken, 0), /changed/);
    const staleSchedule = await previewMarkupRecalculation(actor);
    const other = await createMarkupSchedule({ companyId, name: "Other", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    await activateMarkupSchedule(other.id, companyId);
    await assert.rejects(runMarkupRecalculation(actor, staleSchedule.confirmationToken, 0), /changed/);
  } finally {
    const es = await db.select({ id: estimates.id }).from(estimates).where(eq(estimates.companyId, companyId));
    if (es.length) await db.delete(estimateItems).where(inArray(estimateItems.estimateId, es.map(e => e.id)));
    await db.delete(estimates).where(eq(estimates.companyId, companyId));
    const ws = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.companyId, companyId));
    if (ws.length) await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, ws.map(w => w.id)));
    await db.delete(workOrders).where(eq(workOrders.companyId, companyId));
    const bs = await db.select({ id: billingSheets.id }).from(billingSheets).where(eq(billingSheets.companyId, companyId));
    if (bs.length) await db.delete(billingSheetItems).where(inArray(billingSheetItems.billingSheetId, bs.map(b => b.id)));
    await db.delete(billingSheets).where(eq(billingSheets.companyId, companyId));
    await db.delete(pricingAuditEvents).where(eq(pricingAuditEvents.companyId, companyId));
    await db.delete(parts).where(eq(parts.companyId, companyId));
    await db.delete(materialMarkupSchedules).where(eq(materialMarkupSchedules.companyId, companyId));
    await db.delete(customers).where(eq(customers.companyId, companyId));
    await db.delete(users).where(eq(users.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await pool.end();
  }
});

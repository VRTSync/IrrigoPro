import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// Task #211 — regression test that locks in Task #210's storage-side fix:
// the catalog $0-price reprice and the labor-rate mismatch reprice must
// NEVER write the audit trail into billing_sheets.notes or work_orders.notes.
// The audit trail lives in [AUDIT] console log lines only. If this guarantee
// regresses, manager-facing UI fields would once again leak audit text and
// the customer-facing PDF could re-leak it the next time anything renders
// `notes`. The PDF-render-side regression is already covered by
// invoice-pdf-qa.test.mjs; this file is the storage-side bookend.

const { storage } = await import("../server/storage.ts");
const { db } = await import("../server/db.ts");
const { eq } = await import("drizzle-orm");
const {
  parts,
  customers,
  billingSheets,
  billingSheetItems,
  workOrders,
  workOrderItems,
} = await import("../shared/schema.ts");

const COMPANY_ID = 99;

// ── tiny helper: capture console.log lines emitted while `fn` runs ──────────
async function captureConsoleLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(" "));
    // Still echo to stderr so the test runner output remains readable.
    original.apply(console, args);
  };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

let CUSTOMER_ID;
let CATALOG_PART_ID;
const CATALOG_PART_PRICE = 17.5;

// Notes sentinels — must be byte-for-byte preserved across the reprice.
const SHEET_NOTES = "MANAGER NOTE — call before re-entry. DO NOT TOUCH.";
const WO_NOTES = "WO MANAGER NOTE — gate code 1234. DO NOT TOUCH.";
const SHEET_NOTES_LABOR = "MANAGER NOTE (labor) — emergency call-out. DO NOT TOUCH.";
const WO_NOTES_LABOR = "WO MANAGER NOTE (labor) — after-hours rate. DO NOT TOUCH.";

describe("Reprice never writes to the notes column (Task #211)", () => {
  before(async () => {
    // Seed a dedicated customer so we don't collide with any other test file.
    const [cust] = await db.insert(customers).values({
      companyId: COMPANY_ID,
      name: "Reprice Notes Immutability Customer",
      email: `reprice_notes_${Date.now()}@example.com`,
      laborRate: "60.00",
      emergencyLaborRate: "180.00",
    }).returning();
    CUSTOMER_ID = cust.id;

    // Seed a catalog part starting at the real price. We will plant the $0
    // line items directly via db so the audit picks them up.
    const [part] = await db.insert(parts).values({
      companyId: COMPANY_ID,
      name: "Reprice Notes Test Part",
      sku: `RPN-${Date.now()}`,
      description: "Used by billing-reprice-notes-immutability.test.mjs",
      price: CATALOG_PART_PRICE.toFixed(2),
      cost: "5.00",
      category: "Test",
    }).returning();
    CATALOG_PART_ID = part.id;
  });

  test("repriceBillingSheetItems(dryRun:false) leaves billing_sheets.notes and work_orders.notes byte-for-byte unchanged", async () => {
    // 1. Plant a billing sheet with a known notes value and a $0 catalog row.
    const billingNumber = `BS-RPN-CAT-${Date.now()}`;
    const [sheet] = await db.insert(billingSheets).values({
      billingNumber,
      customerId: CUSTOMER_ID,
      customerName: "Reprice Notes Immutability Customer",
      propertyAddress: "1 Reprice Way",
      workDate: new Date(),
      technicianName: "Reprice Tech",
      workDescription: "Catalog reprice notes-immutability test sheet",
      status: "approved_passed_to_billing",
      totalHours: "1.00",
      laborRate: "60.00",
      laborSubtotal: "60.00",
      partsSubtotal: "0.00",
      totalAmount: "60.00",
      notes: SHEET_NOTES,
    }).returning();
    const [sheetItem] = await db.insert(billingSheetItems).values({
      billingSheetId: sheet.id,
      partId: CATALOG_PART_ID,
      partName: "Reprice Notes Test Part",
      quantity: "3",
      unitPrice: "0.00",
      totalPrice: "0.00",
      laborHours: "0",
    }).returning();

    // 2. Plant a work order with a known notes value and a $0 catalog row.
    const woNumber = `WO-RPN-CAT-${Date.now()}`;
    const [wo] = await db.insert(workOrders).values({
      workOrderNumber: woNumber,
      customerId: CUSTOMER_ID,
      customerName: "Reprice Notes Immutability Customer",
      customerEmail: "reprice_wo@example.com",
      projectName: "Reprice Notes WO",
      projectAddress: "1 Reprice Way",
      workType: "direct_billing",
      status: "approved_passed_to_billing",
      priority: "medium",
      description: "Catalog reprice notes-immutability test WO",
      totalHours: "1.00",
      laborRate: "60.00",
      appliedLaborRate: "60.00",
      laborSubtotal: "60.00",
      partsSubtotal: "0.00",
      totalPartsCost: "0.00",
      totalAmount: "60.00",
      notes: WO_NOTES,
    }).returning();
    const [woItem] = await db.insert(workOrderItems).values({
      workOrderId: wo.id,
      partId: CATALOG_PART_ID,
      partName: "Reprice Notes Test Part",
      partPrice: "0.00",
      quantity: 2,
      laborHours: "0",
      totalPrice: "0.00",
    }).returning();

    // 3. Run the catalog reprice for exactly these two rows, capturing logs.
    const { result, lines } = await captureConsoleLog(() =>
      storage.repriceBillingSheetItems(
        [
          { source: "billing_sheet", itemId: sheetItem.id },
          { source: "work_order", itemId: woItem.id },
        ],
        COMPANY_ID,
        { dryRun: false, performedByUserId: null, performedByName: "task-211-test" },
      ),
    );

    assert.equal(result.dryRun, false, "reprice should run in apply mode");
    assert.equal(result.parentCount, 2, "should have repriced exactly 2 parents");
    assert.equal(result.itemCount, 2, "should have repriced exactly 2 items");

    // 4. Assert the [AUDIT] log lines fired (audit trail is in stdout, not notes).
    const sheetAuditLine = lines.find(
      (l) => l.includes("[AUDIT] billing_sheet_repriced") && l.includes(`billingSheetId=${sheet.id}`),
    );
    assert.ok(
      sheetAuditLine,
      `expected a "[AUDIT] billing_sheet_repriced" log line for sheet ${sheet.id}; ` +
        `captured lines: ${JSON.stringify(lines)}`,
    );
    const woAuditLine = lines.find(
      (l) => l.includes("[AUDIT] work_order_repriced") && l.includes(`workOrderId=${wo.id}`),
    );
    assert.ok(
      woAuditLine,
      `expected a "[AUDIT] work_order_repriced" log line for WO ${wo.id}; ` +
        `captured lines: ${JSON.stringify(lines)}`,
    );

    // 5. Assert the prices were actually applied (proves we hit the write path,
    //    not a no-op short-circuit that would also leave notes alone trivially).
    const [refreshedSheetItem] = await db
      .select()
      .from(billingSheetItems)
      .where(eq(billingSheetItems.id, sheetItem.id));
    assert.ok(
      Math.abs(parseFloat(refreshedSheetItem.unitPrice) - CATALOG_PART_PRICE) < 0.01,
      `sheet item should have been repriced to ${CATALOG_PART_PRICE}, got ${refreshedSheetItem.unitPrice}`,
    );
    const [refreshedWoItem] = await db
      .select()
      .from(workOrderItems)
      .where(eq(workOrderItems.id, woItem.id));
    assert.ok(
      Math.abs(parseFloat(refreshedWoItem.partPrice) - CATALOG_PART_PRICE) < 0.01,
      `WO item should have been repriced to ${CATALOG_PART_PRICE}, got ${refreshedWoItem.partPrice}`,
    );

    // 6. THE CORE INVARIANT: notes must be byte-for-byte unchanged.
    const [refreshedSheet] = await db
      .select()
      .from(billingSheets)
      .where(eq(billingSheets.id, sheet.id));
    assert.strictEqual(
      refreshedSheet.notes,
      SHEET_NOTES,
      `billing_sheets.notes must NOT be mutated by reprice. ` +
        `Expected ${JSON.stringify(SHEET_NOTES)}, got ${JSON.stringify(refreshedSheet.notes)}`,
    );

    const [refreshedWo] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, wo.id));
    assert.strictEqual(
      refreshedWo.notes,
      WO_NOTES,
      `work_orders.notes must NOT be mutated by reprice. ` +
        `Expected ${JSON.stringify(WO_NOTES)}, got ${JSON.stringify(refreshedWo.notes)}`,
    );
  });

  test("repriceLaborRateMismatches(dryRun:false) leaves billing_sheets.notes and work_orders.notes byte-for-byte unchanged", async () => {
    // 1. Plant a billing sheet with a labor_rate that matches NEITHER the
    //    customer's standard ($60) nor emergency ($180) rate, with known notes.
    const billingNumber = `BS-RPN-LAB-${Date.now()}`;
    const [sheet] = await db.insert(billingSheets).values({
      billingNumber,
      customerId: CUSTOMER_ID,
      customerName: "Reprice Notes Immutability Customer",
      propertyAddress: "1 Reprice Way",
      workDate: new Date(),
      technicianName: "Reprice Tech",
      workDescription: "Labor-rate reprice notes-immutability test sheet",
      status: "approved_passed_to_billing",
      totalHours: "2.00",
      laborRate: "99.99", // mismatched on purpose
      laborSubtotal: "199.98",
      partsSubtotal: "0.00",
      totalAmount: "199.98",
      notes: SHEET_NOTES_LABOR,
    }).returning();

    // 2. Plant a work order with the same kind of labor-rate mismatch + notes.
    const woNumber = `WO-RPN-LAB-${Date.now()}`;
    const [wo] = await db.insert(workOrders).values({
      workOrderNumber: woNumber,
      customerId: CUSTOMER_ID,
      customerName: "Reprice Notes Immutability Customer",
      customerEmail: "reprice_wo_labor@example.com",
      projectName: "Reprice Notes WO (labor)",
      projectAddress: "1 Reprice Way",
      workType: "direct_billing",
      status: "approved_passed_to_billing",
      priority: "medium",
      description: "Labor-rate reprice notes-immutability test WO",
      totalHours: "3.00",
      laborRate: "99.99", // mismatched on purpose
      appliedLaborRate: "99.99",
      laborSubtotal: "299.97",
      partsSubtotal: "0.00",
      totalPartsCost: "0.00",
      totalAmount: "299.97",
      notes: WO_NOTES_LABOR,
    }).returning();

    // 3. Apply the labor-rate reprice (re-classify both as "standard" → $60).
    const { result, lines } = await captureConsoleLog(() =>
      storage.repriceLaborRateMismatches(
        [
          { source: "billing_sheet", parentId: sheet.id, classification: "standard" },
          { source: "work_order", parentId: wo.id, classification: "standard" },
        ],
        COMPANY_ID,
        { dryRun: false, performedByUserId: null, performedByName: "task-211-test" },
      ),
    );

    assert.equal(result.dryRun, false, "labor reprice should run in apply mode");
    assert.equal(result.parentCount, 2, "should have repriced exactly 2 parents");
    assert.deepEqual(result.skipped, [], `unexpected skipped entries: ${JSON.stringify(result.skipped)}`);

    // 4. Assert the [AUDIT] log lines fired.
    const sheetAuditLine = lines.find(
      (l) =>
        l.includes("[AUDIT] billing_sheet_labor_repriced") &&
        l.includes(`billingSheetId=${sheet.id}`),
    );
    assert.ok(
      sheetAuditLine,
      `expected a "[AUDIT] billing_sheet_labor_repriced" log line for sheet ${sheet.id}; ` +
        `captured lines: ${JSON.stringify(lines)}`,
    );
    const woAuditLine = lines.find(
      (l) =>
        l.includes("[AUDIT] work_order_labor_repriced") &&
        l.includes(`workOrderId=${wo.id}`),
    );
    assert.ok(
      woAuditLine,
      `expected a "[AUDIT] work_order_labor_repriced" log line for WO ${wo.id}; ` +
        `captured lines: ${JSON.stringify(lines)}`,
    );

    // 5. Sanity: the labor rate was actually rewritten.
    const [refreshedSheet] = await db
      .select()
      .from(billingSheets)
      .where(eq(billingSheets.id, sheet.id));
    assert.ok(
      Math.abs(parseFloat(refreshedSheet.laborRate) - 60) < 0.01,
      `sheet laborRate should be 60.00, got ${refreshedSheet.laborRate}`,
    );
    const [refreshedWo] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, wo.id));
    assert.ok(
      Math.abs(parseFloat(refreshedWo.laborRate) - 60) < 0.01,
      `WO laborRate should be 60.00, got ${refreshedWo.laborRate}`,
    );

    // 6. THE CORE INVARIANT: notes must be byte-for-byte unchanged.
    assert.strictEqual(
      refreshedSheet.notes,
      SHEET_NOTES_LABOR,
      `billing_sheets.notes must NOT be mutated by labor reprice. ` +
        `Expected ${JSON.stringify(SHEET_NOTES_LABOR)}, got ${JSON.stringify(refreshedSheet.notes)}`,
    );
    assert.strictEqual(
      refreshedWo.notes,
      WO_NOTES_LABOR,
      `work_orders.notes must NOT be mutated by labor reprice. ` +
        `Expected ${JSON.stringify(WO_NOTES_LABOR)}, got ${JSON.stringify(refreshedWo.notes)}`,
    );
  });
});

/**
 * customer-billing-preview-wet-check.test.ts (Task #788 Slice 3)
 *
 * Integration tests for the GET /api/customers/billing-preview rollup logic
 * once wet_check_billings are included. Seeds real DB fixtures, applies the
 * same filtering logic as the route, and asserts exact numeric values.
 *
 * Scenarios:
 *   1. One billing sheet ($100, approved_passed_to_billing) + one WCB ($50,
 *      approved_passed_to_billing) → combined unbilledAmount = 150.00.
 *   2. A submitted WCB ($30, no invoiceId) is excluded from unbilledAmount
 *      but contributes to unapprovedTotal.
 *   3. wetCheckBillings array contains all WCBs for the customer regardless of status.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

const TAG = `bp-wcb-${Date.now()}`;

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWetCheckId: number;
let fixtureBillingSheetId: number;
const wcbIds: number[] = [];

// Mirror of the safeAmount helper in the route
function safeAmount(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : 0;
}

describe("billing-preview rollup — wet check billings integration (Task #788)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`BP WCB Test Co ${TAG}`}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'BP WCB Customer', ${`bp-wcb-${TAG}@example.com`})
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`bp-wcb-tech-${TAG}`}, 'hashed', 'BP WCB Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    const wcRows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId},
        'BP WCB Tech', 'BP WCB Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    fixtureWetCheckId = Number((wcRows.rows[0] as { id: number }).id);

    // Billing sheet: $100, approved_passed_to_billing, no invoiceId
    const bsRows = await db.execute(sql`
      INSERT INTO billing_sheets (
        billing_number, customer_id, customer_name, technician_id, technician_name,
        property_address, work_description, work_date, status,
        labor_subtotal, parts_subtotal, total_amount, total_hours, labor_rate
      ) VALUES (
        ${`BS-${TAG}-1`}, ${fixtureCustomerId}, 'BP WCB Customer', ${fixtureTechId}, 'BP WCB Tech',
        '123 Preview St', 'Test work', NOW(), 'approved_passed_to_billing',
        '60.00', '40.00', '100.00', '2.00', '30.00'
      ) RETURNING id
    `);
    fixtureBillingSheetId = Number((bsRows.rows[0] as { id: number }).id);

    // WCB 1: $50, approved_passed_to_billing, no invoiceId — should be unbilled
    const wcb1Rows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address, work_date,
        technician_name, technician_id, wet_check_id, status,
        total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
        no_photos_needed
      ) VALUES (
        ${`WCB-${TAG}-1`}, ${fixtureCustomerId}, 'BP WCB Customer', '123 Test St', NOW(),
        'BP WCB Tech', ${fixtureTechId}, ${fixtureWetCheckId}, 'approved_passed_to_billing',
        '1.00', '30.00', '30.00', '20.00', '50.00',
        false
      ) RETURNING id
    `);
    wcbIds.push(Number((wcb1Rows.rows[0] as { id: number }).id));

    // WCB 2: $30, submitted, no invoiceId — should be unapproved only
    const wcb2Rows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address, work_date,
        technician_name, technician_id, wet_check_id, status,
        total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
        no_photos_needed
      ) VALUES (
        ${`WCB-${TAG}-2`}, ${fixtureCustomerId}, 'BP WCB Customer', '456 Test Ave', NOW(),
        'BP WCB Tech', ${fixtureTechId}, ${fixtureWetCheckId}, 'submitted',
        '1.00', '30.00', '30.00', '0.00', '30.00',
        false
      ) RETURNING id
    `);
    wcbIds.push(Number((wcb2Rows.rows[0] as { id: number }).id));
  });

  after(async () => {
    for (const id of wcbIds) {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${id}`);
    }
    if (fixtureBillingSheetId) {
      await db.execute(sql`DELETE FROM billing_sheets WHERE id = ${fixtureBillingSheetId}`);
    }
    if (fixtureWetCheckId) await db.execute(sql`DELETE FROM wet_checks WHERE id = ${fixtureWetCheckId}`);
    if (fixtureCustomerId) await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    if (fixtureTechId) await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    if (fixtureCompanyId) await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  it("unbilledAmount = BS($100) + WCB($50) = $150.00", async () => {
    const billingSheets = await storage.getBillingSheetsByCustomer(fixtureCustomerId);
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);

    const unbilledBSs = billingSheets.filter(
      (bs) => bs.status === "approved_passed_to_billing" && !bs.invoiceId,
    );
    const unbilledWCBs = wetCheckBillings.filter(
      (wcb) => wcb.status === "approved_passed_to_billing" && !wcb.invoiceId,
    );

    const unbilledAmount =
      unbilledBSs.reduce((s, bs) => s + safeAmount(bs.totalAmount), 0) +
      unbilledWCBs.reduce((s, wcb) => s + safeAmount(wcb.totalAmount), 0);

    assert.equal(unbilledAmount.toFixed(2), "150.00",
      `Expected unbilledAmount=150.00, got ${unbilledAmount.toFixed(2)}`);
  });

  it("submitted WCB is excluded from unbilledAmount", async () => {
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);
    const unbilledWCBs = wetCheckBillings.filter(
      (wcb) => wcb.status === "approved_passed_to_billing" && !wcb.invoiceId,
    );
    // Only the approved_passed_to_billing WCB ($50) should be unbilled
    assert.equal(unbilledWCBs.length, 1);
    assert.equal(safeAmount(unbilledWCBs[0].totalAmount).toFixed(2), "50.00");
  });

  it("submitted WCB contributes to unapprovedTotal", async () => {
    const billingSheets = await storage.getBillingSheetsByCustomer(fixtureCustomerId);
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);

    const unapprovedBSs = billingSheets.filter(
      (bs) => ["pending_manager_review", "completed", "submitted"].includes(bs.status) && !bs.invoiceId,
    );
    const unapprovedWCBs = wetCheckBillings.filter(
      (wcb) => ["submitted", "pending_manager_review"].includes(wcb.status) && !wcb.invoiceId,
    );

    const unapprovedTotal =
      unapprovedBSs.reduce((s, bs) => s + safeAmount(bs.totalAmount), 0) +
      unapprovedWCBs.reduce((s, wcb) => s + safeAmount(wcb.totalAmount), 0);

    // The submitted WCB ($30) must appear in unapprovedTotal
    assert.ok(
      unapprovedTotal >= 30,
      `Expected unapprovedTotal >= 30.00 (submitted WCB), got ${unapprovedTotal.toFixed(2)}`,
    );
    const submittedWcbs = unapprovedWCBs.filter((w) => w.status === "submitted");
    assert.ok(submittedWcbs.length >= 1, "submitted WCB should be in unapprovedWCBs");
  });

  it("wetCheckBillings array contains all WCBs for the customer", async () => {
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);
    // Both WCBs (approved_passed_to_billing + submitted) must be present
    assert.ok(
      wetCheckBillings.length >= 2,
      `Expected at least 2 WCBs, got ${wetCheckBillings.length}`,
    );
    const ids = wetCheckBillings.map((w) => w.id);
    assert.ok(ids.includes(wcbIds[0]), "approved_passed_to_billing WCB should be in the array");
    assert.ok(ids.includes(wcbIds[1]), "submitted WCB should be in the array");
  });

  it("getWetCheckBillingsByCustomer returns WCBs scoped to the correct customer", async () => {
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);
    for (const wcb of wetCheckBillings) {
      assert.equal(
        wcb.customerId,
        fixtureCustomerId,
        `WCB id=${wcb.id} has wrong customerId: ${wcb.customerId}`,
      );
    }
  });
});

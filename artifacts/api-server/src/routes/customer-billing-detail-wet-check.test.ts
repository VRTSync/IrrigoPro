/**
 * customer-billing-detail-wet-check.test.ts (Task #788 Slice 3)
 *
 * Integration tests for the GET /api/customers/:id/billing response shape
 * once wet_check_billings are included. Seeds real DB fixtures, applies the
 * same filtering/transformation logic as the route, and asserts exact values.
 *
 * Scenarios:
 *   1. Two WCBs: one approved_passed_to_billing (no invoiceId), one billed (with invoiceId).
 *      - wetCheckBillings has both rows.
 *      - unbilledWetCheckBillings has only the first.
 *      - totalUnbilledAmount includes only the first WCB's amount.
 *   2. Existing billing-sheet fields (billingSheets, unbilledBillingSheets) still appear.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

const TAG = `bd-wcb-${Date.now()}`;

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWetCheckId: number;
let fixtureBillingSheetId: number;
let fixtureInvoiceId: number;
const wcbIds: number[] = [];

// Mirror of the safeAmount helper used in the route
function safeAmount(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : 0;
}

describe("billing-detail rollup — wet check billings integration (Task #788)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`BD WCB Test Co ${TAG}`}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'BD WCB Customer', ${`bd-wcb-${TAG}@example.com`})
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`bd-wcb-tech-${TAG}`}, 'hashed', 'BD WCB Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    const wcRows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId},
        'BD WCB Tech', 'BD WCB Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    fixtureWetCheckId = Number((wcRows.rows[0] as { id: number }).id);

    // A stub invoice (needed as the FK target for the billed WCB)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const invoiceRows = await db.execute(sql`
      INSERT INTO invoices (invoice_number, customer_id, customer_name, customer_email, status,
        labor_subtotal, parts_subtotal, total_amount, invoice_month, invoice_year,
        period_start, period_end)
      VALUES (
        ${`INV-${TAG}`}, ${fixtureCustomerId}, 'BD WCB Customer', 'bd-wcb@example.com', 'paid',
        '0.00', '0.00', '0.00', ${now.getMonth() + 1}, ${now.getFullYear()},
        ${monthStart.toISOString()}, ${monthEnd.toISOString()}
      ) RETURNING id
    `);
    fixtureInvoiceId = Number((invoiceRows.rows[0] as { id: number }).id);

    // Billing sheet: $100, approved_passed_to_billing, no invoiceId
    const bsRows = await db.execute(sql`
      INSERT INTO billing_sheets (
        billing_number, customer_id, customer_name, technician_id, technician_name,
        property_address, work_description, work_date, status,
        labor_subtotal, parts_subtotal, total_amount, total_hours, labor_rate
      ) VALUES (
        ${`BS-BD-${TAG}`}, ${fixtureCustomerId}, 'BD WCB Customer', ${fixtureTechId}, 'BD WCB Tech',
        '100 Detail Rd', 'Test detail work', NOW(), 'approved_passed_to_billing',
        '70.00', '30.00', '100.00', '2.00', '35.00'
      ) RETURNING id
    `);
    fixtureBillingSheetId = Number((bsRows.rows[0] as { id: number }).id);

    // WCB 1: $75, approved_passed_to_billing, no invoiceId — unbilled
    const wcb1Rows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address, work_date,
        technician_name, technician_id, wet_check_id, status,
        total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
        no_photos_needed
      ) VALUES (
        ${`WCB-BD-${TAG}-1`}, ${fixtureCustomerId}, 'BD WCB Customer', '123 Detail St', NOW(),
        'BD WCB Tech', ${fixtureTechId}, ${fixtureWetCheckId}, 'approved_passed_to_billing',
        '2.00', '30.00', '60.00', '15.00', '75.00',
        false
      ) RETURNING id
    `);
    wcbIds.push(Number((wcb1Rows.rows[0] as { id: number }).id));

    // WCB 2: $40, billed, with invoiceId — already billed, not unbilled
    const wcb2Rows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address, work_date,
        technician_name, technician_id, wet_check_id, status, invoice_id,
        total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
        no_photos_needed
      ) VALUES (
        ${`WCB-BD-${TAG}-2`}, ${fixtureCustomerId}, 'BD WCB Customer', '456 Detail Ave', NOW(),
        'BD WCB Tech', ${fixtureTechId}, ${fixtureWetCheckId}, 'billed', ${fixtureInvoiceId},
        '1.00', '30.00', '30.00', '10.00', '40.00',
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
    if (fixtureInvoiceId) await db.execute(sql`DELETE FROM invoices WHERE id = ${fixtureInvoiceId}`);
    if (fixtureWetCheckId) await db.execute(sql`DELETE FROM wet_checks WHERE id = ${fixtureWetCheckId}`);
    if (fixtureCustomerId) await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    if (fixtureTechId) await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    if (fixtureCompanyId) await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  it("wetCheckBillings contains both WCBs (approved + billed)", async () => {
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);
    const ids = wetCheckBillings.map((w) => w.id);
    assert.ok(ids.includes(wcbIds[0]), "approved_passed_to_billing WCB should appear");
    assert.ok(ids.includes(wcbIds[1]), "billed WCB should appear");
    assert.ok(
      wetCheckBillings.length >= 2,
      `Expected at least 2 WCBs, got ${wetCheckBillings.length}`,
    );
  });

  it("unbilledWetCheckBillings contains only the approved_passed_to_billing WCB", async () => {
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);
    // Apply the same filter as the route
    const unbilledWCBs = wetCheckBillings.filter(
      (wcb) => wcb.status === "approved_passed_to_billing" && !wcb.invoiceId,
    );
    // Only WCB 1 qualifies
    assert.ok(unbilledWCBs.some((w) => w.id === wcbIds[0]),
      "WCB 1 (approved_passed_to_billing) should be unbilled");
    assert.ok(!unbilledWCBs.some((w) => w.id === wcbIds[1]),
      "WCB 2 (billed with invoiceId) must not be unbilled");
  });

  it("totalUnbilledAmount = BS($100) + WCB1($75) = $175.00 (billed WCB2 excluded)", async () => {
    const billingSheets = await storage.getBillingSheetsByCustomer(fixtureCustomerId, null);
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);

    const unbilledBSs = billingSheets.filter(
      (bs) => bs.status === "approved_passed_to_billing" && !bs.invoiceId,
    );
    const unbilledWCBs = wetCheckBillings.filter(
      (wcb) => wcb.status === "approved_passed_to_billing" && !wcb.invoiceId,
    );

    const totalUnbilledAmount =
      unbilledBSs.reduce((s, bs) => s + safeAmount(bs.totalAmount), 0) +
      unbilledWCBs.reduce((s, wcb) => s + safeAmount(wcb.totalAmount), 0);

    assert.equal(
      totalUnbilledAmount.toFixed(2),
      "175.00",
      `Expected totalUnbilledAmount=175.00, got ${totalUnbilledAmount.toFixed(2)}`,
    );
  });

  it("billingSheets field includes the fixture billing sheet (existing shape)", async () => {
    const billingSheets = await storage.getBillingSheetsByCustomer(fixtureCustomerId, null);
    const ids = billingSheets.map((bs) => bs.id);
    assert.ok(ids.includes(fixtureBillingSheetId),
      "fixture billing sheet should appear in getBillingSheetsByCustomer");
  });

  it("unbilledBillingSheets includes the approved_passed_to_billing billing sheet", async () => {
    const billingSheets = await storage.getBillingSheetsByCustomer(fixtureCustomerId, null);
    const unbilledBSs = billingSheets.filter(
      (bs) => bs.status === "approved_passed_to_billing" && !bs.invoiceId,
    );
    assert.ok(unbilledBSs.some((bs) => bs.id === fixtureBillingSheetId),
      "fixture billing sheet should be unbilled");
  });

  it("WCB transformation: totalAmount is numeric-parseable", async () => {
    const wetCheckBillings = await storage.getWetCheckBillingsByCustomer(fixtureCustomerId);
    for (const wcb of wetCheckBillings.filter((w) => wcbIds.includes(w.id))) {
      const n = parseFloat(String(wcb.totalAmount));
      assert.ok(Number.isFinite(n),
        `WCB id=${wcb.id} totalAmount '${wcb.totalAmount}' should be numeric`);
      assert.ok(n > 0, `WCB id=${wcb.id} totalAmount should be > 0`);
    }
  });
});

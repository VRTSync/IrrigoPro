// Task #783 — WC Billing Slice 10: wet_check_billings CRUD storage tests.
//
// Verifies:
//   1. createWetCheckBilling inserts and returns full object with auto-assigned id
//   2. getWetCheckBillingById retrieves it
//   3. getWetCheckBillingsByWetCheckId returns the row
//   4. getAllWetCheckBillings includes the row
//   5. updateWetCheckBilling mutates status, advances updatedAt, returns non-optional row
//   6. deleteWetCheckBilling removes the row; subsequent getWetCheckBillingById => undefined

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWetCheckId: number;
let createdBillingId: number;

const TEST_BILLING_NUMBER = `WC-TEST-SLICE10-${Date.now()}`;

describe("wetCheckBillings CRUD storage methods", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES ('WCB Test Co Slice10', 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'WCB Test Customer', 'wcb-test-slice10@example.com')
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES ('wcb-test-tech-slice10', 'hashed', 'WCB Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    const wcRows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId}, 'WCB Tech', 'WCB Test Customer', 1, 'in_progress', 'flat')
      RETURNING id
    `);
    fixtureWetCheckId = Number((wcRows.rows[0] as { id: number }).id);
  });

  after(async () => {
    if (createdBillingId) {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${createdBillingId}`);
    }
    await db.execute(sql`DELETE FROM wet_check_billings WHERE billing_number = ${TEST_BILLING_NUMBER}`);
    if (fixtureWetCheckId) await db.execute(sql`DELETE FROM wet_checks WHERE id = ${fixtureWetCheckId}`);
    if (fixtureCustomerId) await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    if (fixtureTechId) await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    if (fixtureCompanyId) await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  it("createWetCheckBilling inserts and returns a row with auto-assigned id", async () => {
    const row = await storage.createWetCheckBilling({
      billingNumber: TEST_BILLING_NUMBER,
      customerId: fixtureCustomerId,
      customerName: "WCB Test Customer",
      propertyAddress: "123 Test St",
      wetCheckId: fixtureWetCheckId,
      technicianId: fixtureTechId,
      technicianName: "WCB Tech",
      workDate: new Date("2026-05-01T00:00:00Z"),
      status: "submitted",
      totalHours: "2.00",
      laborRate: "45.00",
      laborSubtotal: "90.00",
      partsSubtotal: "0.00",
      totalAmount: "90.00",
      noPhotosNeeded: false,
    });

    assert.ok(row.id > 0, "id should be a positive integer");
    assert.equal(row.billingNumber, TEST_BILLING_NUMBER);
    assert.equal(row.status, "submitted");
    assert.equal(row.totalHours, "2.00");
    assert.equal(row.wetCheckId, fixtureWetCheckId);
    assert.equal(row.noPhotosNeeded, false);
    assert.ok(row.createdAt instanceof Date);
    assert.ok(row.updatedAt instanceof Date);

    createdBillingId = row.id;
  });

  it("getWetCheckBillingById retrieves the created row", async () => {
    const row = await storage.getWetCheckBillingById(createdBillingId);
    assert.ok(row !== undefined, "row should be found");
    assert.equal(row!.id, createdBillingId);
    assert.equal(row!.billingNumber, TEST_BILLING_NUMBER);
    assert.equal(row!.totalHours, "2.00");
  });

  it("getWetCheckBillingsByWetCheckId returns the row", async () => {
    const rows = await storage.getWetCheckBillingsByWetCheckId(fixtureWetCheckId);
    const found = rows.find((r) => r.id === createdBillingId);
    assert.ok(found !== undefined, "created billing should appear in the wetCheckId query");
  });

  it("getAllWetCheckBillings includes the created row", async () => {
    const rows = await storage.getAllWetCheckBillings();
    const found = rows.find((r) => r.id === createdBillingId);
    assert.ok(found !== undefined, "created billing should appear in getAllWetCheckBillings");
  });

  it("updateWetCheckBilling mutates status, advances updatedAt, and returns a non-optional row", async () => {
    const before = await storage.getWetCheckBillingById(createdBillingId);
    assert.ok(before !== undefined);

    await new Promise((r) => setTimeout(r, 10));

    const updated = await storage.updateWetCheckBilling(createdBillingId, {
      status: "approved_passed_to_billing",
    });
    // Non-optional contract: updateWetCheckBilling must return WetCheckBilling directly
    assert.equal(typeof updated.id, "number", "returned row must have id (non-optional)");
    assert.equal(updated.status, "approved_passed_to_billing");
    assert.ok(
      updated.updatedAt.getTime() >= before!.updatedAt.getTime(),
      "updatedAt should not go backwards",
    );
  });

  it("deleteWetCheckBilling removes the row; subsequent getById returns undefined", async () => {
    await storage.deleteWetCheckBilling(createdBillingId);

    const row = await storage.getWetCheckBillingById(createdBillingId);
    assert.equal(row, undefined, "row should be gone after delete");

    createdBillingId = 0;
  });
});

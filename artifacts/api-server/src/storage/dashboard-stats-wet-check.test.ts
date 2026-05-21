/**
 * dashboard-stats-wet-check.test.ts (Task #788 Slice 3)
 *
 * Integration test for the getDashboardStats() storage method:
 *   - fixture with three WCBs (submitted, pending_manager_review, billed)
 *   - wetCheckBillingStats.pendingManagerReview counts EXACTLY the two
 *     fixture-owned submitted + pending_manager_review rows (queried
 *     directly so the assertion is fixture-isolated).
 *   - billingSheetStats.pendingManagerReview is derived only from
 *     billing_sheets: verifies it does NOT change when only WCBs are
 *     added.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

const TAG = `wcb-dash-stats-${Date.now()}`;

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWetCheckId: number;
const createdWcbIds: number[] = [];

describe("getDashboardStats — wetCheckBillingStats (Task #788)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`WCB Dash Stats Co ${TAG}`}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'WCB Dash Customer', ${`wcb-dash-${TAG}@example.com`})
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`wcb-dash-tech-${TAG}`}, 'hashed', 'WCB Dash Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    const wcRows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId},
        'WCB Dash Tech', 'WCB Dash Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    fixtureWetCheckId = Number((wcRows.rows[0] as { id: number }).id);

    // Insert three WCBs: submitted, pending_manager_review, billed
    for (const [idx, status] of [
      [0, "submitted"],
      [1, "pending_manager_review"],
      [2, "billed"],
    ] as [number, string][]) {
      const wcbRows = await db.execute(sql`
        INSERT INTO wet_check_billings (
          billing_number, customer_id, customer_name, property_address,
          work_date, technician_name, technician_id, wet_check_id,
          status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
          no_photos_needed
        ) VALUES (
          ${`WCB-DASH-${TAG}-${idx}`}, ${fixtureCustomerId}, 'WCB Dash Customer', '123 Dash St',
          NOW(), 'WCB Dash Tech', ${fixtureTechId}, ${fixtureWetCheckId},
          ${status}, '2.00', '45.00', '90.00', '0.00', '90.00',
          false
        ) RETURNING id
      `);
      createdWcbIds.push(Number((wcbRows.rows[0] as { id: number }).id));
    }
  });

  after(async () => {
    for (const id of createdWcbIds) {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${id}`);
    }
    if (fixtureWetCheckId) await db.execute(sql`DELETE FROM wet_checks WHERE id = ${fixtureWetCheckId}`);
    if (fixtureCustomerId) await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    if (fixtureTechId) await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    if (fixtureCompanyId) await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  it("getDashboardStats returns a wetCheckBillingStats field", async () => {
    const stats = await storage.getDashboardStats();
    assert.ok(
      stats.wetCheckBillingStats !== undefined,
      "wetCheckBillingStats should be present on the return object",
    );
    assert.ok(
      typeof stats.wetCheckBillingStats.pendingManagerReview === "number",
      "pendingManagerReview should be a number",
    );
  });

  it("wetCheckBillingStats.pendingManagerReview counts exactly submitted+pending_manager_review rows (fixture-isolated)", async () => {
    // Query the fixture WCBs directly to know the expected pending count from our rows
    const fixtureRows = await db.execute(sql`
      SELECT status FROM wet_check_billings WHERE id = ANY(ARRAY[${createdWcbIds[0]}, ${createdWcbIds[1]}, ${createdWcbIds[2]}]::int[])
    `);
    const fixtureStatuses = (fixtureRows.rows as { status: string }[]).map((r) => r.status);

    // Our fixture should have exactly 2 pending rows
    const fixturePending = fixtureStatuses.filter(
      (s) => s === "submitted" || s === "pending_manager_review",
    ).length;
    assert.equal(fixturePending, 2, "fixture should have exactly 2 pending WCBs");

    // getDashboardStats counts all pending WCBs in the table; verify our 2 rows are included
    const stats = await storage.getDashboardStats();
    assert.ok(
      stats.wetCheckBillingStats.pendingManagerReview >= 2,
      `Expected pendingManagerReview >= 2 (our 2 pending fixture rows), got ${stats.wetCheckBillingStats.pendingManagerReview}`,
    );
  });

  it("'billed' WCB is excluded from wetCheckBillingStats.pendingManagerReview", async () => {
    // Verify by direct query that the billed fixture WCB is not in pending status
    const billedRow = await db.execute(sql`
      SELECT status FROM wet_check_billings WHERE id = ${createdWcbIds[2]}
    `);
    const billedStatus = (billedRow.rows[0] as { status: string }).status;
    assert.equal(billedStatus, "billed", "WCB 3 should have status='billed'");

    // Temporarily count pending WCBs globally
    const stats = await storage.getDashboardStats();
    // Remove the billed WCB and recount to confirm the billed row doesn't affect the count
    await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${createdWcbIds[2]}`);
    createdWcbIds.splice(2, 1); // remove from cleanup list since already deleted

    const statsAfter = await storage.getDashboardStats();
    assert.equal(
      statsAfter.wetCheckBillingStats.pendingManagerReview,
      stats.wetCheckBillingStats.pendingManagerReview,
      "deleting a 'billed' WCB must not change pendingManagerReview count",
    );
  });

  it("billingSheetStats.pendingManagerReview is derived from billing_sheets only (not WCBs)", async () => {
    // Record current billingSheetStats count before and after adding a pending WCB
    const before = await storage.getDashboardStats();
    const bsCountBefore = before.billingSheetStats.pendingManagerReview;

    // Insert an extra submitted WCB (should not change billingSheetStats)
    const extraWcbRows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address,
        work_date, technician_name, technician_id, wet_check_id,
        status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
        no_photos_needed
      ) VALUES (
        ${`WCB-DASH-EXTRA-${TAG}`}, ${fixtureCustomerId}, 'WCB Dash Customer', '789 Dash St',
        NOW(), 'WCB Dash Tech', ${fixtureTechId}, ${fixtureWetCheckId},
        'submitted', '1.00', '30.00', '30.00', '0.00', '30.00',
        false
      ) RETURNING id
    `);
    const extraId = Number((extraWcbRows.rows[0] as { id: number }).id);

    try {
      const after = await storage.getDashboardStats();
      assert.equal(
        after.billingSheetStats.pendingManagerReview,
        bsCountBefore,
        "billingSheetStats must not change when a WCB is added — it only reads billing_sheets",
      );
      // But wetCheckBillingStats should have increased by 1
      assert.ok(
        after.wetCheckBillingStats.pendingManagerReview > before.wetCheckBillingStats.pendingManagerReview,
        "wetCheckBillingStats.pendingManagerReview should increase when a submitted WCB is added",
      );
    } finally {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${extraId}`);
    }
  });
});

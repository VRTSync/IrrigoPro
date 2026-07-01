// Behavioral guard: estimate with a null-priced adjustment line item must
// never produce NaN in partsSubtotal, laborSubtotal, or totalAmount — and
// those same finite values must propagate cleanly into a work order snapshot.
//
// Tests the money() helper path end-to-end through:
//   getEstimate() → createWorkOrderFromEstimate()
//
// Uses a real DB (same integration pattern as other storage-layer tests here).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { money } from "../lib/money";

// ── Unit tests for the money() helper ─────────────────────────────────────────

describe("money() helper", () => {
  it("returns 0 for null", () => {
    assert.equal(money(null), 0);
  });

  it("returns 0 for undefined", () => {
    assert.equal(money(undefined), 0);
  });

  it("returns 0 for the string 'NaN'", () => {
    assert.equal(money("NaN"), 0);
  });

  it("returns 0 for NaN number", () => {
    assert.equal(money(NaN), 0);
  });

  it("returns 0 for Infinity", () => {
    assert.equal(money(Infinity), 0);
  });

  it("returns 0 for -Infinity", () => {
    assert.equal(money(-Infinity), 0);
  });

  it("parses a numeric string correctly", () => {
    assert.equal(money("12.50"), 12.5);
  });

  it("passes through a finite number", () => {
    assert.equal(money(99.99), 99.99);
  });

  it("returns 0 for empty string", () => {
    assert.equal(money(""), 0);
  });

  it("returns 0 for blank string", () => {
    assert.equal(money("  "), 0);
  });
});

// ── Integration: estimate with one null-priced item ──────────────────────────
//
// Creates a minimal company + customer + estimate with:
//   - one priced part ($50, qty 2 → totalPrice $100)
//   - one adjustment item with partPrice NULL and totalPrice NULL
//     (mimics a wet-check adjustment line stored before the guard landed)
//
// Asserts:
//   1. getEstimate() returns finite partsSubtotal, laborSubtotal, totalAmount.
//   2. totalAmount = partsSubtotal + laborSubtotal (no NaN contamination).
//   3. createWorkOrderFromEstimate() snapshots finite totals onto the WO.

let testCompanyId: number;
let testCustomerId: number;
let testEstimateId: number;
let testWorkOrderId: number | null = null;

describe("NaN guard — estimate with null-priced adjustment item", () => {
  before(async () => {
    // Minimal company
    const [co] = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name, is_active)
      VALUES ('NaN Guard Test Co', true)
      RETURNING id
    `).then(r => r.rows);
    testCompanyId = co.id;

    // Minimal customer
    const [cu] = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${testCompanyId}, 'NaN Guard Customer', 'nan-guard@example.com')
      RETURNING id
    `).then(r => r.rows);
    testCustomerId = cu.id;

    // Estimate in "approved" status (required by createWorkOrderFromEstimate)
    const [est] = await db.execute<{ id: number }>(sql`
      INSERT INTO estimates (
        company_id, customer_id, customer_name, customer_email,
        project_name,
        status, internal_status, lifecycle,
        labor_rate, applied_labor_rate, labor_mode, total_labor_hours,
        estimate_number, parts_subtotal, labor_subtotal, total_amount
      )
      VALUES (
        ${testCompanyId}, ${testCustomerId}, 'NaN Guard Customer', 'nan-guard@example.com',
        'NaN Guard Test Project',
        'approved', 'approved_internal', 'approved',
        95, 95, 'flat', 2,
        'TEST-NAN-001', 0.00, 0.00, 0.00
      )
      RETURNING id
    `).then(r => r.rows);
    testEstimateId = est.id;

    // Item 1: priced part — $50 × 2 = $100
    await db.execute(sql`
      INSERT INTO estimate_items (estimate_id, part_name, part_price, quantity, labor_hours, total_price, sort_order)
      VALUES (${testEstimateId}, 'Valve Head', 50, 2, 0, 100, 0)
    `);

    // Item 2: adjustment / null-priced line — simulates a wet-check finding
    // stored before the write-time guard. The actual bug stored NaN (not NULL)
    // because `quantity × null` in JS produces NaN and Postgres numeric accepts it.
    await db.execute(sql`
      INSERT INTO estimate_items (estimate_id, part_name, part_price, quantity, labor_hours, total_price, sort_order)
      VALUES (${testEstimateId}, 'Adjustment — no part', 'NaN', 1, 0, 'NaN', 1)
    `);
  });

  after(async () => {
    if (testWorkOrderId != null) {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${testWorkOrderId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${testWorkOrderId}`);
    }
    await db.execute(sql`DELETE FROM estimate_items WHERE estimate_id = ${testEstimateId}`);
    await db.execute(sql`DELETE FROM estimates WHERE id = ${testEstimateId}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${testCustomerId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${testCompanyId}`);
  });

  it("getEstimate() returns finite partsSubtotal (NaN item coerced to 0)", async () => {
    const est = await storage.getEstimate(testEstimateId);
    assert.ok(est, "estimate should exist");
    const parts = parseFloat(est!.partsSubtotal ?? "0");
    assert.ok(Number.isFinite(parts), `partsSubtotal should be finite, got ${est!.partsSubtotal}`);
    // $50 × 2 = $100 priced part; $0 adjustment → total $100
    assert.equal(parts, 100, `expected partsSubtotal 100, got ${parts}`);
  });

  it("getEstimate() returns finite laborSubtotal", async () => {
    const est = await storage.getEstimate(testEstimateId);
    assert.ok(est, "estimate should exist");
    const labor = parseFloat(est!.laborSubtotal ?? "0");
    assert.ok(Number.isFinite(labor), `laborSubtotal should be finite, got ${est!.laborSubtotal}`);
    // 2 hours × $95 = $190
    assert.equal(labor, 190, `expected laborSubtotal 190, got ${labor}`);
  });

  it("getEstimate() returns finite totalAmount equal to parts + labor", async () => {
    const est = await storage.getEstimate(testEstimateId);
    assert.ok(est, "estimate should exist");
    const total = parseFloat(est!.totalAmount ?? "0");
    assert.ok(Number.isFinite(total), `totalAmount should be finite, got ${est!.totalAmount}`);
    assert.equal(total, 290, `expected totalAmount 290 (100 parts + 190 labor), got ${total}`);
  });

  it("createWorkOrderFromEstimate() snapshots finite totals onto the work order", async () => {
    const wo = await storage.createWorkOrderFromEstimate(testEstimateId);
    testWorkOrderId = wo.id;

    const woTotal = parseFloat(wo.totalAmount ?? "0");
    assert.ok(Number.isFinite(woTotal), `WO totalAmount should be finite, got ${wo.totalAmount}`);

    const woParts = parseFloat(wo.partsSubtotal ?? "0");
    assert.ok(Number.isFinite(woParts), `WO partsSubtotal should be finite, got ${wo.partsSubtotal}`);

    const woLabor = parseFloat(wo.laborSubtotal ?? "0");
    assert.ok(Number.isFinite(woLabor), `WO laborSubtotal should be finite, got ${wo.laborSubtotal}`);

    // Total must equal parts + labor
    assert.ok(
      Math.abs(woTotal - (woParts + woLabor)) < 0.01,
      `WO total ${woTotal} should equal parts ${woParts} + labor ${woLabor}`,
    );
  });
});

// ── Integration: estimate with a stored NaN string in totalAmount ─────────────
//
// Simulates a pre-existing poisoned row: directly inserts a Postgres NaN
// decimal value into estimate_items.total_price and confirms getEstimate()
// still returns a clean $0 for that item, with a finite overall total.

let testEstimateId2: number;
let testCompanyId2: number;
let testCustomerId2: number;

describe("NaN guard — stored NaN decimal in estimate_items.total_price", () => {
  before(async () => {
    // Own company + customer so this suite is independent of suite 2's cleanup.

    const [co] = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name, is_active) VALUES ('NaN Guard Test Co 2', true) RETURNING id
    `).then(r => r.rows);
    testCompanyId2 = co.id;

    const [cu] = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${testCompanyId2}, 'NaN Guard Customer 2', 'nan-guard2@example.com')
      RETURNING id
    `).then(r => r.rows);
    testCustomerId2 = cu.id;

    const [est] = await db.execute<{ id: number }>(sql`
      INSERT INTO estimates (
        company_id, customer_id, customer_name, customer_email,
        project_name,
        status, internal_status, lifecycle,
        labor_rate, applied_labor_rate, labor_mode, total_labor_hours,
        estimate_number, parts_subtotal, labor_subtotal, total_amount
      )
      VALUES (
        ${testCompanyId2}, ${testCustomerId2}, 'NaN Guard Customer 2', 'nan-guard2@example.com',
        'NaN Guard Test Project 2',
        'pending', 'pending_approval', 'pending_review',
        80, 80, 'flat', 1,
        'TEST-NAN-002', 0.00, 0.00, 0.00
      )
      RETURNING id
    `).then(r => r.rows);
    testEstimateId2 = est.id;

    // One item with a Postgres NaN decimal in total_price
    await db.execute(sql`
      INSERT INTO estimate_items (estimate_id, part_name, part_price, quantity, labor_hours, total_price, sort_order)
      VALUES (${testEstimateId2}, 'Sprinkler Head', 'NaN', 3, 0, 'NaN', 0)
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM estimate_items WHERE estimate_id = ${testEstimateId2}`);
    await db.execute(sql`DELETE FROM estimates WHERE id = ${testEstimateId2}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${testCustomerId2}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${testCompanyId2}`);
  });

  it("getEstimate() returns finite totals even when DB stores NaN decimals", async () => {
    const est = await storage.getEstimate(testEstimateId2);
    assert.ok(est, "estimate should exist");
    const total = parseFloat(est!.totalAmount ?? "0");
    assert.ok(
      Number.isFinite(total),
      `totalAmount should be finite when items have NaN totalPrice, got ${est!.totalAmount}`,
    );
    const parts = parseFloat(est!.partsSubtotal ?? "0");
    assert.ok(Number.isFinite(parts), `partsSubtotal should be finite, got ${est!.partsSubtotal}`);
  });
});

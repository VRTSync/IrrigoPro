/**
 * wet-check-billings-list.test.ts (Task #791 — Slice 4)
 *
 * HTTP-level tests for GET /api/wet-check-billings.
 *
 * Mounts a minimal Express server with a noop auth middleware,
 * the real storage.getAllWetCheckBillingsWithCounts call, and the
 * same applyPricingVisibility strip used in production.
 *
 * Scenarios:
 *   1. Returns HTTP 200 with a JSON array
 *   2. issuesCount / zonesCount aggregates match seeded fixture data
 *   3. Results are sorted workDate DESC (newer first)
 *   4. field_tech role: pricing fields (laborRate, totalAmount) are absent
 *   5. billing_manager role: pricing fields are present
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

// ── Mirror of the route's applyPricingVisibility strip ───────────────────────

const PRICING_KEYS = [
  "laborRate",
  "laborSubtotal",
  "partsSubtotal",
  "totalAmount",
  "approvedTotal",
  "appliedLaborRate",
  "totalHours",
];

function stripPricingFromArray(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const copy = { ...row };
    for (const k of PRICING_KEYS) delete copy[k];
    return copy;
  });
}

// ── Server factory ────────────────────────────────────────────────────────────

async function startServer(role: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = express();
  app.use(express.json());

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as unknown as Record<string, unknown>).authenticatedUserId = 1;
    (req as unknown as Record<string, unknown>).authenticatedUserCompanyId = 1;
    (req as unknown as Record<string, unknown>).headerUserRole = role;
    next();
  };

  app.get("/api/wet-check-billings", noopAuth, async (req, res) => {
    try {
      const billings = await storage.getAllWetCheckBillingsWithCounts();
      const headerRole = (req as unknown as Record<string, unknown>).headerUserRole as string;
      const result =
        headerRole === "field_tech"
          ? stripPricingFromArray(billings as unknown as Record<string, unknown>[])
          : billings;
      res.json(result);
    } catch {
      res.status(500).json({ message: "error" });
    }
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ── Fixture setup ─────────────────────────────────────────────────────────────

const TAG = `wcb-list-${Date.now()}`;
let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWcId1: number;
let fixtureWcId2: number;
let wcbId1: number;
let wcbId2: number;
let fixtureZrId1: number;
let fixtureZrId2: number;
let fixtureZrId3: number;

describe("GET /api/wet-check-billings — HTTP endpoint (Task #791)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`WCB List Co ${TAG}`}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'WCB List Customer', ${`wcb-list-${TAG}@example.com`})
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`wcb-list-tech-${TAG}`}, 'hashed', 'List Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    const wc1Rows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId},
        'List Tech', 'WCB List Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    fixtureWcId1 = Number((wc1Rows.rows[0] as { id: number }).id);

    const wc2Rows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId},
        'List Tech', 'WCB List Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    fixtureWcId2 = Number((wc2Rows.rows[0] as { id: number }).id);

    // WCB 1 — older work_date
    const wcb1Rows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address,
        work_date, technician_name, technician_id, wet_check_id,
        status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
        total_amount, photos
      ) VALUES (
        ${`WC-LIST-A-${TAG}`}, ${fixtureCustomerId}, 'WCB List Customer', '1 Old St',
        '2026-01-01', 'List Tech', ${fixtureTechId}, ${fixtureWcId1},
        'submitted', '1.00', '50.00', '50.00', '0.00', '50.00', '{}'
      ) RETURNING id
    `);
    wcbId1 = Number((wcb1Rows.rows[0] as { id: number }).id);

    // WCB 2 — newer work_date
    const wcb2Rows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address,
        work_date, technician_name, technician_id, wet_check_id,
        status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
        total_amount, photos
      ) VALUES (
        ${`WC-LIST-B-${TAG}`}, ${fixtureCustomerId}, 'WCB List Customer', '2 New Ave',
        '2026-06-01', 'List Tech', ${fixtureTechId}, ${fixtureWcId2},
        'approved_passed_to_billing', '2.00', '50.00', '100.00', '30.00', '130.00', '{}'
      ) RETURNING id
    `);
    wcbId2 = Number((wcb2Rows.rows[0] as { id: number }).id);

    // 2 zone records for WCB1
    const zr1Rows = await db.execute(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, repair_labor_hours)
      VALUES (${fixtureWcId1}, 'A', 1, '0.5') RETURNING id
    `);
    fixtureZrId1 = Number((zr1Rows.rows[0] as { id: number }).id);
    const zr2Rows = await db.execute(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, repair_labor_hours)
      VALUES (${fixtureWcId1}, 'B', 2, '0.5') RETURNING id
    `);
    fixtureZrId2 = Number((zr2Rows.rows[0] as { id: number }).id);
    // 1 zone record for WCB2
    const zr3Rows = await db.execute(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, repair_labor_hours)
      VALUES (${fixtureWcId2}, 'A', 1, '1.0') RETURNING id
    `);
    fixtureZrId3 = Number((zr3Rows.rows[0] as { id: number }).id);

    // 3 findings on WCB1 (2 zones)
    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, wet_check_billing_id,
        issue_type, issue_group, quantity, labor_hours, resolution)
      VALUES (${fixtureZrId1}, ${fixtureWcId1}, ${wcbId1}, 'head_replacement', 'quick_fix', 1, '0.25', 'repaired_in_field')
    `);
    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, wet_check_billing_id,
        issue_type, issue_group, quantity, labor_hours, resolution)
      VALUES (${fixtureZrId1}, ${fixtureWcId1}, ${wcbId1}, 'valve_leak', 'advanced', 1, '0.25', 'repaired_in_field')
    `);
    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, wet_check_billing_id,
        issue_type, issue_group, quantity, labor_hours, resolution)
      VALUES (${fixtureZrId2}, ${fixtureWcId1}, ${wcbId1}, 'head_replacement', 'quick_fix', 2, '0.00', 'repaired_in_field')
    `);
    // 1 finding on WCB2
    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, wet_check_billing_id,
        issue_type, issue_group, quantity, labor_hours, resolution)
      VALUES (${fixtureZrId3}, ${fixtureWcId2}, ${wcbId2}, 'head_replacement', 'quick_fix', 1, '0.50', 'repaired_in_field')
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_billing_id IN (${wcbId1}, ${wcbId2})`);
    await db.execute(sql`DELETE FROM wet_check_billings WHERE id IN (${wcbId1}, ${wcbId2})`);
    if (fixtureZrId1) await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id = ${fixtureZrId1}`);
    if (fixtureZrId2) await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id = ${fixtureZrId2}`);
    if (fixtureZrId3) await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id = ${fixtureZrId3}`);
    await db.execute(sql`DELETE FROM wet_checks WHERE id IN (${fixtureWcId1}, ${fixtureWcId2})`);
    await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  it("returns 200 with a JSON array", async () => {
    const { baseUrl, close } = await startServer("billing_manager");
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings`);
      assert.equal(res.status, 200);
      const body = await res.json() as unknown[];
      assert.ok(Array.isArray(body), "Response body must be an array");
    } finally {
      await close();
    }
  });

  it("issuesCount and zonesCount aggregates are correct for both fixture WCBs", async () => {
    const { baseUrl, close } = await startServer("billing_manager");
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings`);
      const rows = await res.json() as Array<{ id: number; issuesCount: number; zonesCount: number }>;
      const row1 = rows.find((r) => r.id === wcbId1);
      const row2 = rows.find((r) => r.id === wcbId2);
      assert.ok(row1, "WCB1 must be in the response");
      assert.ok(row2, "WCB2 must be in the response");
      assert.equal(row1.issuesCount, 3, "WCB1 should have 3 issues");
      assert.equal(row1.zonesCount, 2, "WCB1 should span 2 zones");
      assert.equal(row2.issuesCount, 1, "WCB2 should have 1 issue");
      assert.equal(row2.zonesCount, 1, "WCB2 should span 1 zone");
    } finally {
      await close();
    }
  });

  it("workDate DESC sort — newer WCB appears before older WCB in response array", async () => {
    const { baseUrl, close } = await startServer("billing_manager");
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings`);
      const rows = await res.json() as Array<{ id: number }>;
      const idx1 = rows.findIndex((r) => r.id === wcbId1);
      const idx2 = rows.findIndex((r) => r.id === wcbId2);
      assert.ok(idx1 !== -1 && idx2 !== -1, "Both fixture WCBs must be present");
      assert.ok(idx2 < idx1, "Newer wcbId2 (2026-06-01) must precede older wcbId1 (2026-01-01)");
    } finally {
      await close();
    }
  });

  it("field_tech role: pricing fields are stripped from every row", async () => {
    const { baseUrl, close } = await startServer("field_tech");
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings`);
      const rows = await res.json() as Array<Record<string, unknown>>;
      const row = rows.find((r) => r.id === wcbId1);
      assert.ok(row, "WCB1 must be present");
      assert.ok(!("laborRate" in row), "laborRate must be absent for field_tech");
      assert.ok(!("totalAmount" in row), "totalAmount must be absent for field_tech");
      assert.ok(!("laborSubtotal" in row), "laborSubtotal must be absent for field_tech");
    } finally {
      await close();
    }
  });

  it("billing_manager role: pricing fields are present", async () => {
    const { baseUrl, close } = await startServer("billing_manager");
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings`);
      const rows = await res.json() as Array<Record<string, unknown>>;
      const row = rows.find((r) => r.id === wcbId2);
      assert.ok(row, "WCB2 must be present");
      assert.ok("laborRate" in row, "laborRate must be present for billing_manager");
      assert.ok("totalAmount" in row, "totalAmount must be present for billing_manager");
    } finally {
      await close();
    }
  });
});

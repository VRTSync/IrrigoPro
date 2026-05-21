/**
 * wet-check-billings-detail.test.ts (Task #791 — Slice 4)
 *
 * HTTP-level tests for GET /api/wet-check-billings/:id.
 *
 * Mounts a minimal Express server with a noop auth middleware and the
 * same storage calls + response shape as the production route.
 *
 * Scenarios:
 *   1. 200 with { wetCheckBilling, view } for an existing record
 *   2. view.zones is an array with the correct zone and line item count
 *   3. 404 for a missing id
 *   4. 400 for a non-numeric id
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

// ── Server factory ────────────────────────────────────────────────────────────

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = express();
  app.use(express.json());

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as unknown as Record<string, unknown>).authenticatedUserId = 1;
    (req as unknown as Record<string, unknown>).authenticatedUserCompanyId = 1;
    (req as unknown as Record<string, unknown>).headerUserRole = "billing_manager";
    next();
  };

  // Mirrors production GET /api/wet-check-billings/:id
  app.get("/api/wet-check-billings/:id", noopAuth, async (req, res) => {
    try {
      const rawId = String(req.params.id);
      const id = parseInt(rawId, 10);
      if (!Number.isFinite(id)) {
        res.status(400).json({ message: "Invalid wet check billing id" });
        return;
      }
      const wetCheckBilling = await storage.getWetCheckBillingById(id);
      if (!wetCheckBilling) {
        res.status(404).json({ message: "Wet check billing not found" });
        return;
      }
      const companyId: number | null =
        ((req as unknown as Record<string, unknown>).authenticatedUserCompanyId as number) ?? null;
      const view = await storage.getWetCheckBillingViewById(id, companyId);
      res.json({ wetCheckBilling, view });
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

const TAG = `wcb-detail-${Date.now()}`;
let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWcId: number;
let fixtureWcbId: number;
let fixtureZrId: number;

describe("GET /api/wet-check-billings/:id — HTTP endpoint (Task #791)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`WCB Detail Co ${TAG}`}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'WCB Detail Customer', ${`wcb-detail-${TAG}@example.com`})
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`wcb-detail-tech-${TAG}`}, 'hashed', 'Detail Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    const wcRows = await db.execute(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId},
        'Detail Tech', 'WCB Detail Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    fixtureWcId = Number((wcRows.rows[0] as { id: number }).id);

    const wcbRows = await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address,
        work_date, technician_name, technician_id, wet_check_id,
        status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
        total_amount, photos
      ) VALUES (
        ${`WC-DETAIL-${TAG}`}, ${fixtureCustomerId}, 'WCB Detail Customer', '99 Detail Ln',
        '2026-03-15', 'Detail Tech', ${fixtureTechId}, ${fixtureWcId},
        'approved_passed_to_billing', '2.00', '75.00', '150.00', '25.00', '175.00', '{}'
      ) RETURNING id
    `);
    fixtureWcbId = Number((wcbRows.rows[0] as { id: number }).id);

    const zrRows = await db.execute(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, repair_labor_hours)
      VALUES (${fixtureWcId}, 'A', 1, '1.5') RETURNING id
    `);
    fixtureZrId = Number((zrRows.rows[0] as { id: number }).id);

    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, wet_check_billing_id,
        issue_type, issue_group, quantity, labor_hours, resolution)
      VALUES (${fixtureZrId}, ${fixtureWcId}, ${fixtureWcbId},
        'head_replacement', 'quick_fix', 1, '0.50', 'repaired_in_field')
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_billing_id = ${fixtureWcbId}`);
    await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${fixtureWcbId}`);
    if (fixtureZrId) await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id = ${fixtureZrId}`);
    await db.execute(sql`DELETE FROM wet_checks WHERE id = ${fixtureWcId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  it("returns HTTP 200 with { wetCheckBilling, view } shape", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${fixtureWcbId}`);
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.ok("wetCheckBilling" in body, "Response must have wetCheckBilling key");
      assert.ok("view" in body, "Response must have view key");
    } finally {
      await close();
    }
  });

  it("wetCheckBilling has correct id and customerName", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${fixtureWcbId}`);
      const body = await res.json() as { wetCheckBilling: Record<string, unknown> };
      const wcb = body.wetCheckBilling;
      assert.equal(Number(wcb.id), fixtureWcbId);
      assert.equal(wcb.customerName, "WCB Detail Customer");
      assert.equal(wcb.status, "approved_passed_to_billing");
    } finally {
      await close();
    }
  });

  it("view.zones is a non-empty array and zone A-1 has 1 line item", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${fixtureWcbId}`);
      const body = await res.json() as { view: { zones: Array<{ zoneLabel: string; lineItems: unknown[] }> } };
      const view = body.view;
      assert.ok(Array.isArray(view.zones), "view.zones must be an array");
      assert.ok(view.zones.length > 0, "view.zones must be non-empty");
      const zoneA1 = view.zones.find((z) => z.zoneLabel === "A-1");
      assert.ok(zoneA1, "Zone A-1 must exist in view.zones");
      assert.equal(zoneA1.lineItems.length, 1, "Zone A-1 must have exactly 1 line item");
    } finally {
      await close();
    }
  });

  it("returns HTTP 404 for a non-existent id", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/99999999`);
      assert.equal(res.status, 404);
      const body = await res.json() as { message: string };
      assert.ok(body.message.toLowerCase().includes("not found"), "404 body should say 'not found'");
    } finally {
      await close();
    }
  });

  it("returns HTTP 400 for a non-numeric id ('abc')", async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/abc`);
      assert.equal(res.status, 400);
      const body = await res.json() as { message: string };
      assert.ok(body.message.toLowerCase().includes("invalid"), "400 body should say 'invalid'");
    } finally {
      await close();
    }
  });
});

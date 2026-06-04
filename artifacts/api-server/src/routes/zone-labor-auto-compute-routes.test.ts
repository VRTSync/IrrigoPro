/**
 * Task #893 — HTTP-level tests for the zone labor auto-compute pipeline.
 *
 * Mirrors the production route handlers from routes.ts (same role guards,
 * same Zod schemas, same storage calls, same error mapping) and runs them
 * against a real storage module backed by a real PostgreSQL connection.
 * Because `storage.*` methods are exercised for real, any regression in the
 * storage layer will also surface here.
 *
 * Three endpoints covered:
 *
 * A. POST /api/wet-checks/zone-records/:id/repair-labor/reset  (tech tier)
 *    — clears repairLaborManuallySet and reruns the issueTypeConfigs sum
 *
 * B. PATCH /api/wet-checks/zone-records/:id/repair-labor/manager  (manager tier)
 *    — sets repairLaborHours + repairLaborManuallySet=true
 *
 * C. PATCH /api/wet-check-billings/:id/zone-labor  (billing_manager tier)
 *    — edits zone hours + recomputes WCB totalHours / laborSubtotal / totalAmount
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";

// ─── Zod schemas (mirror production) ─────────────────────────────────────────

const repairLaborHoursSchema = z
  .string()
  .refine(
    (s) => { const n = parseFloat(s); return Number.isFinite(n) && n >= 0; },
    { message: "repairLaborHours must be a non-negative number" },
  )
  .refine(
    (s) => { const n = parseFloat(s); return Math.abs(Math.round(n * 4) - n * 4) < 0.0001; },
    { message: "repairLaborHours must be a multiple of 0.25" },
  );

const repairLaborPatchBody = z.object({ repairLaborHours: repairLaborHoursSchema });

const wcbZoneLaborBody = z.object({
  zoneRecordId: z.coerce.number().int().positive(),
  repairLaborHours: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Must be a non-negative decimal with up to 2 places")
    .refine((v) => parseFloat(v) >= 0, "Must be non-negative"),
});

// ─── Role predicates (mirror production) ─────────────────────────────────────

const isFieldRole = (role: string | undefined) =>
  role === "field_tech" || role === "irrigation_manager" ||
  role === "company_admin" || role === "super_admin" || role === "billing_manager";

const isWetCheckManagerRole = (role: string | undefined) =>
  role === "irrigation_manager" || role === "company_admin" ||
  role === "super_admin" || role === "billing_manager";

// ─── Server factory ───────────────────────────────────────────────────────────
//
// Builds an Express app that:
//   1. Installs a noop-auth middleware that stamps req.authenticatedUser* from
//      the `role` and `companyId` options (eliminating the real JWT/session flow)
//   2. Mounts the three mirrored production route handlers backed by real storage

interface ServerOpts {
  role: string;
  companyId: number;
}

function buildApp(opts: ServerOpts): Express {
  const app = express();
  app.use(express.json());

  // Noop auth — mirrors what requireAuthentication sets on the request object
  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserRole = opts.role;
    (req as any).authenticatedUserCompanyId = opts.companyId;
    (req as any).authenticatedUserId = 1;
    next();
  };

  // requireCompanyId inline (same logic as production)
  const requireCompanyId = (req: any, res: any): number | null => {
    const cid = req.authenticatedUserCompanyId;
    if (!cid) { res.status(403).json({ message: "Company scope required" }); return null; }
    return cid;
  };

  // ── A. POST /api/wet-checks/zone-records/:id/repair-labor/reset ─────────────
  app.post("/api/wet-checks/zone-records/:id/repair-labor/reset", noopAuth, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole((req as any).authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    try {
      const updated = await storage.resetZoneRepairLabor(parseInt(req.params.id, 10), cid);
      if (!updated) { res.status(404).json({ message: "Not found" }); return; }
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: (e as Error).message || "Couldn't reset repair labor" });
    }
  });

  // ── B. PATCH /api/wet-checks/zone-records/:id/repair-labor/manager ──────────
  app.patch("/api/wet-checks/zone-records/:id/repair-labor/manager", noopAuth, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isWetCheckManagerRole((req as any).authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    const parsed = repairLaborPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid body", issues: parsed.error.issues }); return;
    }
    try {
      const updated = await storage.setZoneRepairLaborManagerTier(
        parseInt(req.params.id, 10),
        cid,
        parsed.data.repairLaborHours,
      );
      if (!updated) { res.status(404).json({ message: "Not found" }); return; }
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: (e as Error).message || "Couldn't save repair labor" });
    }
  });

  // ── C. PATCH /api/wet-check-billings/:id/zone-labor ─────────────────────────
  app.patch("/api/wet-check-billings/:id/zone-labor", noopAuth, async (req, res) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    const role = (req as any).authenticatedUserRole;
    if (role !== "billing_manager" && role !== "company_admin" && role !== "super_admin") {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    const parsed = wcbZoneLaborBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid body", issues: parsed.error.issues }); return;
    }
    const wcbId = parseInt(req.params.id, 10);
    if (!Number.isFinite(wcbId)) {
      res.status(400).json({ message: "Invalid id" }); return;
    }
    try {
      const result = await storage.setWcbZoneRepairLabor(
        wcbId,
        parsed.data.zoneRecordId,
        parsed.data.repairLaborHours,
        cid,
      );
      if (!result) { res.status(404).json({ message: "Not found" }); return; }
      res.json(result.updated);
    } catch (e: any) {
      res.status(400).json({ message: (e as Error).message || "Couldn't save zone labor" });
    }
  });

  return app;
}

async function startServer(opts: ServerOpts): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = buildApp(opts);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── Shared fixture state ─────────────────────────────────────────────────────

const TAG = `zlr-routes-${Date.now()}`;

let cid: number;
let customerId: number;
let techId: number;
let inProgressWcId: number;
let submittedWcId: number;

const ISSUE_TYPE_X = `issue_X_${TAG}`;

// Zone / WCB ids per test are created fresh inside each test to avoid ordering
// dependencies. They are tracked so after() can clean up if a test leaks.
const createdZoneIds: number[] = [];
const createdWcbIds: number[] = [];
const createdInvoiceIds: number[] = [];

let zoneSeq = 0;
async function insertZone(
  wcId: number,
  opts?: { manuallySet?: boolean; hours?: string },
): Promise<number> {
  zoneSeq += 1;
  const letter = `R${zoneSeq}`;
  const rows = await db.execute(sql`
    INSERT INTO wet_check_zone_records
      (wet_check_id, controller_letter, zone_number, repair_labor_manually_set, repair_labor_hours)
    VALUES
      (${wcId}, ${letter}, ${zoneSeq}, ${opts?.manuallySet ?? false}, ${opts?.hours ?? "0.00"})
    RETURNING id
  `);
  const id = Number((rows.rows[0] as { id: number }).id);
  createdZoneIds.push(id);
  return id;
}

async function insertWcb(wcId: number, opts?: {
  invoiceId?: number | null;
  status?: string;
  partsSubtotal?: string;
  totalHours?: string;
  laborRate?: string;
  laborSubtotal?: string;
  totalAmount?: string;
}): Promise<number> {
  const billingNumber = `WC-ROUTE-${TAG}-${zoneSeq}-${Date.now()}`;
  const rows = await db.execute(sql`
    INSERT INTO wet_check_billings (
      billing_number, customer_id, customer_name, property_address,
      work_date, technician_name, technician_id, wet_check_id,
      status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
      total_amount, applied_labor_rate, invoice_id
    ) VALUES (
      ${billingNumber}, ${customerId}, 'Route Test Customer', '1 Route Ave',
      NOW(), 'Route Tech', ${techId}, ${wcId},
      ${opts?.status ?? "submitted"},
      ${opts?.totalHours ?? "2.00"}, ${opts?.laborRate ?? "45.00"},
      ${opts?.laborSubtotal ?? "90.00"}, ${opts?.partsSubtotal ?? "25.00"},
      ${opts?.totalAmount ?? "115.00"}, ${"45.00"},
      ${opts?.invoiceId ?? null}
    ) RETURNING id
  `);
  const id = Number((rows.rows[0] as { id: number }).id);
  createdWcbIds.push(id);
  return id;
}

async function insertInvoice(): Promise<number> {
  const invNumber = `INV-ROUTE-${TAG}-${Date.now()}`;
  const rows = await db.execute(sql`
    INSERT INTO invoices
      (invoice_number, customer_id, customer_name, customer_email,
       invoice_month, invoice_year, period_start, period_end,
       status, parts_subtotal, labor_subtotal, total_amount)
    VALUES
      (${invNumber}, ${customerId}, 'Route Test Customer', 'route@example.test',
       5, 2026, NOW(), NOW(),
       'sent', '0.00', '0.00', '0.00')
    RETURNING id
  `);
  const id = Number((rows.rows[0] as { id: number }).id);
  createdInvoiceIds.push(id);
  return id;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("zone labor route handlers — real storage integration (Task #893)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`ZoneLaborRoutesCo_${TAG}`}, 'basic', true)
      RETURNING id
    `);
    cid = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${cid}, 'Route Test Customer', ${`route-${TAG}@example.test`})
      RETURNING id
    `);
    customerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`route-tech-${TAG}`}, 'hashed', 'Route Tech', 'field_tech', ${cid}, true)
      RETURNING id
    `);
    techId = Number((userRows.rows[0] as { id: number }).id);

    const wc1 = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Route Tech', 'Route Test Customer', 1, 'in_progress', 'flat')
      RETURNING id
    `);
    inProgressWcId = Number((wc1.rows[0] as { id: number }).id);

    const wc2 = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Route Tech', 'Route Test Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    submittedWcId = Number((wc2.rows[0] as { id: number }).id);

    await db.execute(sql`
      INSERT INTO issue_type_configs
        (company_id, issue_type, issue_group, display_label, default_labor_hours)
      VALUES
        (${cid}, ${ISSUE_TYPE_X}, 'quick_fix', 'Issue X', '1.50')
    `);
  });

  after(async () => {
    // Delete findings first (FK to zones and WCBs).
    await db.execute(sql`
      DELETE FROM wet_check_findings WHERE wet_check_id IN (${inProgressWcId}, ${submittedWcId})
    `);
    // Delete WCBs tied to the test wet checks (covers all created WCBs).
    await db.execute(sql`
      DELETE FROM wet_check_billings WHERE wet_check_id IN (${inProgressWcId}, ${submittedWcId})
    `);
    // Delete invoices created by the invoiced-WCB test.
    for (const invId of createdInvoiceIds) {
      await db.execute(sql`DELETE FROM invoices WHERE id = ${invId}`);
    }
    // Delete zone records tied to the test wet checks.
    await db.execute(sql`
      DELETE FROM wet_check_zone_records WHERE wet_check_id IN (${inProgressWcId}, ${submittedWcId})
    `);
    await db.execute(sql`DELETE FROM wet_checks WHERE id IN (${inProgressWcId}, ${submittedWcId})`);
    await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id = ${cid}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${techId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${cid}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // A. POST /api/wet-checks/zone-records/:id/repair-labor/reset (tech tier)
  // ════════════════════════════════════════════════════════════════════════════

  it("A1 — 200: reset clears manuallySet and recomputes hours from issueTypeConfig sum", async () => {
    const zoneId = await insertZone(inProgressWcId, { manuallySet: true, hours: "9.00" });
    // Add a finding so the recompute produces a known value.
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_X, quantity: 1 });

    const { baseUrl, close } = await startServer({ role: "field_tech", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/reset`, {
        method: "POST",
      });
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.repairLaborManuallySet, false,
        "manuallySet must be false after reset");
      assert.equal(body.repairLaborHours, "1.50",
        "hours recomputed from ISSUE_TYPE_X defaultLaborHours=1.50");
    } finally {
      await close();
    }
  });

  it("A2 — 403: non-field role is rejected", async () => {
    const zoneId = await insertZone(inProgressWcId);
    const { baseUrl, close } = await startServer({ role: "guest", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/reset`, {
        method: "POST",
      });
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  it("A3 — 404: non-existent zone record returns 404", async () => {
    const { baseUrl, close } = await startServer({ role: "field_tech", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-checks/zone-records/99999999/repair-labor/reset`, {
        method: "POST",
      });
      assert.equal(res.status, 404);
    } finally {
      await close();
    }
  });

  it("A4 — 400: storage throws when wet check is no longer in_progress", async () => {
    // submitted WC → assertWetCheckEditableByTech throws
    const zoneId = await insertZone(submittedWcId);
    const { baseUrl, close } = await startServer({ role: "field_tech", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/reset`, {
        method: "POST",
      });
      assert.equal(res.status, 400);
      const body = await res.json() as { message: string };
      assert.ok(body.message.length > 0, "error message should be non-empty");
    } finally {
      await close();
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // B. PATCH /api/wet-checks/zone-records/:id/repair-labor/manager (manager tier)
  // ════════════════════════════════════════════════════════════════════════════

  it("B1 — 200: manager edit sets repairLaborHours and repairLaborManuallySet=true", async () => {
    const zoneId = await insertZone(submittedWcId); // submitted is within manager window
    const { baseUrl, close } = await startServer({ role: "irrigation_manager", companyId: cid });
    try {
      const res = await fetch(
        `${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/manager`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repairLaborHours: "2.25" }),
        },
      );
      assert.equal(res.status, 200);
      const body = await res.json() as Record<string, unknown>;
      assert.equal(body.repairLaborHours, "2.25");
      assert.equal(body.repairLaborManuallySet, true,
        "manager edit must stamp repairLaborManuallySet=true");
    } finally {
      await close();
    }
  });

  it("B2 — 403: field_tech is excluded from manager-tier endpoint", async () => {
    const zoneId = await insertZone(submittedWcId);
    const { baseUrl, close } = await startServer({ role: "field_tech", companyId: cid });
    try {
      const res = await fetch(
        `${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/manager`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repairLaborHours: "1.00" }),
        },
      );
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  it("B3 — 400: invalid repairLaborHours (not a multiple of 0.25) → 400", async () => {
    const zoneId = await insertZone(submittedWcId);
    const { baseUrl, close } = await startServer({ role: "irrigation_manager", companyId: cid });
    try {
      const res = await fetch(
        `${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/manager`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repairLaborHours: "0.33" }),
        },
      );
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("B4 — 400: missing repairLaborHours body field → 400", async () => {
    const zoneId = await insertZone(submittedWcId);
    const { baseUrl, close } = await startServer({ role: "irrigation_manager", companyId: cid });
    try {
      const res = await fetch(
        `${baseUrl}/api/wet-checks/zone-records/${zoneId}/repair-labor/manager`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("B5 — 404: non-existent zone record returns 404", async () => {
    const { baseUrl, close } = await startServer({ role: "irrigation_manager", companyId: cid });
    try {
      const res = await fetch(
        `${baseUrl}/api/wet-checks/zone-records/99999999/repair-labor/manager`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repairLaborHours: "1.00" }),
        },
      );
      assert.equal(res.status, 404);
    } finally {
      await close();
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C. PATCH /api/wet-check-billings/:id/zone-labor (billing_manager tier)
  // ════════════════════════════════════════════════════════════════════════════

  it("C1 — 200: edit sets zone hours, recomputes WCB totalHours / laborSubtotal / totalAmount", async () => {
    // WCB: totalHours=2.00 (wc base) + zoneRepairLabor=0.00, laborRate=45, partsSubtotal=25.00
    // After edit: zoneRepairLabor=1.50 → totalHours=3.50, laborSubtotal=157.50, totalAmount=182.50
    const zoneId = await insertZone(inProgressWcId, { hours: "0.00" });
    const wcbId = await insertWcb(inProgressWcId, {
      status: "submitted",
      totalHours: "2.00",
      laborRate: "45.00",
      laborSubtotal: "90.00",
      partsSubtotal: "25.00",
      totalAmount: "115.00",
    });
    // Link the zone to the WCB via a finding
    await db.execute(sql`
      INSERT INTO wet_check_findings
        (zone_record_id, wet_check_id, wet_check_billing_id, issue_type, issue_group, quantity)
      VALUES
        (${zoneId}, ${inProgressWcId}, ${wcbId}, ${ISSUE_TYPE_X}, 'quick_fix', 1)
    `);
    // WCB base wet check has totalLaborHours=0.00 (default); zone repair is the only variable.

    const { baseUrl, close } = await startServer({ role: "billing_manager", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneRecordId: zoneId, repairLaborHours: "1.50" }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { zoneRecord: Record<string, unknown>; wcb: Record<string, unknown> };
      assert.ok(body.zoneRecord, "response must have zoneRecord");
      assert.ok(body.wcb, "response must have wcb");
      // Zone record updated
      assert.equal(body.zoneRecord.repairLaborHours, "1.50");
      assert.equal(body.zoneRecord.repairLaborManuallySet, true);
      // WCB totals recomputed: wc.totalLaborHours=0 + zone=1.50 = 1.50h × 45 = 67.50 + parts 25 = 92.50
      assert.equal(body.wcb.totalHours, "1.50",
        "WCB totalHours = wc.totalLaborHours(0) + zoneRepairHours(1.50)");
      assert.equal(body.wcb.laborSubtotal, "67.50");
      assert.equal(body.wcb.totalAmount, "92.50");
    } finally {
      await close();
    }
  });

  it("C2 — 403: field_tech is rejected", async () => {
    const zoneId = await insertZone(inProgressWcId);
    const wcbId = await insertWcb(inProgressWcId);
    const { baseUrl, close } = await startServer({ role: "field_tech", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneRecordId: zoneId, repairLaborHours: "1.00" }),
      });
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  it("C3 — 403: irrigation_manager is rejected (only billing_manager/company_admin/super_admin allowed)", async () => {
    const zoneId = await insertZone(inProgressWcId);
    const wcbId = await insertWcb(inProgressWcId);
    const { baseUrl, close } = await startServer({ role: "irrigation_manager", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneRecordId: zoneId, repairLaborHours: "1.00" }),
      });
      assert.equal(res.status, 403);
    } finally {
      await close();
    }
  });

  it("C4 — 400: missing zoneRecordId in body → 400", async () => {
    const wcbId = await insertWcb(inProgressWcId);
    const { baseUrl, close } = await startServer({ role: "billing_manager", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repairLaborHours: "1.00" }),
      });
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("C5 — 400: repairLaborHours with 3 decimal places → 400 (route validates format)", async () => {
    const wcbId = await insertWcb(inProgressWcId);
    const { baseUrl, close } = await startServer({ role: "billing_manager", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneRecordId: 1, repairLaborHours: "1.125" }),
      });
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("C6 — 404: zone not part of this WCB returns 404", async () => {
    const zoneId = await insertZone(inProgressWcId);
    const wcbId = await insertWcb(inProgressWcId);
    // No finding linking zoneId to wcbId → storage returns undefined
    const { baseUrl, close } = await startServer({ role: "billing_manager", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneRecordId: zoneId, repairLaborHours: "1.00" }),
      });
      assert.equal(res.status, 404);
    } finally {
      await close();
    }
  });

  it("C7 — 400: WCB already invoiced → storage throws → route returns 400", async () => {
    const invoiceId = await insertInvoice();
    const zoneId = await insertZone(inProgressWcId);
    const wcbId = await insertWcb(inProgressWcId, { invoiceId });
    // Link zone to WCB via finding so the not-found guard doesn't fire first
    await db.execute(sql`
      INSERT INTO wet_check_findings
        (zone_record_id, wet_check_id, wet_check_billing_id, issue_type, issue_group, quantity)
      VALUES
        (${zoneId}, ${inProgressWcId}, ${wcbId}, ${ISSUE_TYPE_X}, 'quick_fix', 1)
    `);

    const { baseUrl, close } = await startServer({ role: "billing_manager", companyId: cid });
    try {
      const res = await fetch(`${baseUrl}/api/wet-check-billings/${wcbId}/zone-labor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneRecordId: zoneId, repairLaborHours: "1.00" }),
      });
      assert.equal(res.status, 400);
      const body = await res.json() as { message: string };
      assert.ok(
        body.message.includes("invoiced"),
        `Expected 'invoiced' in message, got: ${body.message}`,
      );
    } finally {
      await close();
    }
  });
});

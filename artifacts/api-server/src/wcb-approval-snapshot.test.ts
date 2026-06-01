// Slice 7 — WCB Approval Snapshot integration tests.
//
// Verifies that:
//  1. The auto-bill path (convertWetCheckToWetCheckBilling) creates a WCB with
//     both JSON snapshot columns populated on first conversion.
//  1b. The append path (second convertWetCheckToWetCheckBilling call with a
//      second finding) refreshes both snapshot columns to reflect updated totals.
//  2. The manager-approval endpoint (POST /api/wet-check-billings/:id/approve)
//     builds and writes both snapshot columns from the WCB's stored numeric fields.
//  3. Cross-tenant rejection: a manager from company B cannot approve company A's WCB.
//  4. Unapproved WCBs (status=submitted) keep both snapshot columns null.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import { type AddressInfo } from "node:net";

import { db } from "./db";
import { wetCheckBillings as wetCheckBillingsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { registerApproveRoutes, type ApproveRoutesStorage } from "./routes/approve-routes";
import { storage } from "./storage";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_COMPANY_ID = 2;
const SCRATCH_USER_ID = 91001;
const SCRATCH_CUSTOMER_ID = 91001;

// ── Seed / teardown ───────────────────────────────────────────────────────────

async function seedBaseFixtures() {
  const sd = new Date().toISOString();

  await db.execute(
    sql`INSERT INTO users
          (id, username, password, name, email, role, company_id,
           is_active, is_deleted, email_verified, mfa_enabled,
           created_at, updated_at)
        VALUES
          (${SCRATCH_USER_ID}, ${"wcb-snap-tech-91001"}, ${"x"}, ${"WCB Snap Tech 91001"},
           ${"wcb-snap-91001@example.test"}, ${"field_tech"}, ${TEST_COMPANY_ID},
           true, false, false, false, ${sd}, ${sd})
        ON CONFLICT (id) DO NOTHING`,
  );

  await db.execute(
    sql`INSERT INTO customers (id, company_id, name, email, labor_rate)
        VALUES (${SCRATCH_CUSTOMER_ID}, ${TEST_COMPANY_ID},
                ${"WCB Snap Customer 91001"}, ${"wcb-snap-91001@example.test"}, ${"60.00"})
        ON CONFLICT (id) DO NOTHING`,
  );
}

async function teardownBaseFixtures() {
  // Delete findings and billings created by the real storage calls
  await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_id IN (
    SELECT id FROM wet_checks WHERE customer_id = ${SCRATCH_CUSTOMER_ID}
  )`);
  await db.execute(sql`DELETE FROM wet_check_billings WHERE customer_id = ${SCRATCH_CUSTOMER_ID}`);
  await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id IN (
    SELECT id FROM wet_checks WHERE customer_id = ${SCRATCH_CUSTOMER_ID}
  )`);
  await db.execute(sql`DELETE FROM wet_checks WHERE customer_id = ${SCRATCH_CUSTOMER_ID}`);
  await db.execute(sql`DELETE FROM customers WHERE id = ${SCRATCH_CUSTOMER_ID}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${SCRATCH_USER_ID}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createSubmittedWetCheck(): Promise<number> {
  const sd = new Date().toISOString();
  const rows = await db.execute(
    sql`INSERT INTO wet_checks
          (company_id, customer_id, technician_id, technician_name,
           customer_name, num_controllers, status, labor_mode,
           total_labor_hours, started_at, created_at, updated_at)
        VALUES
          (${TEST_COMPANY_ID}, ${SCRATCH_CUSTOMER_ID}, ${SCRATCH_USER_ID},
           ${"WCB Snap Tech 91001"}, ${"WCB Snap Customer 91001"},
           2, ${"submitted"}, ${"flat"},
           ${"0.50"}, ${sd}, ${sd}, ${sd})
        RETURNING id`,
  );
  return Number((rows.rows[0] as { id: number }).id);
}

async function addZoneWithFinding(
  wcId: number,
  controllerLetter: string,
  zoneNumber: number,
  repairLaborHours: string,
): Promise<{ zoneId: number; findingId: number }> {
  // Insert zone record (no created_at/updated_at columns on this table)
  const zoneRows = await db.execute(
    sql`INSERT INTO wet_check_zone_records
          (wet_check_id, controller_letter, zone_number, status, repair_labor_hours)
        VALUES (${wcId}, ${controllerLetter}, ${zoneNumber}, ${"checked_with_issues"}, ${repairLaborHours})
        ON CONFLICT (wet_check_id, controller_letter, zone_number) DO UPDATE
          SET repair_labor_hours = EXCLUDED.repair_labor_hours
        RETURNING id`,
  );
  const zoneId = Number((zoneRows.rows[0] as { id: number }).id);

  const sd = new Date().toISOString();
  const findingRows = await db.execute(
    sql`INSERT INTO wet_check_findings
          (wet_check_id, zone_record_id, issue_type, issue_group,
           no_part_needed, quantity, labor_hours,
           resolution, resolution_decided_at,
           created_at, updated_at)
        VALUES (
          ${wcId}, ${zoneId}, ${"leak"}, ${"quick_fix"},
          true, 1, ${"0.00"},
          ${"repaired_in_field"}, ${sd},
          ${sd}, ${sd}
        ) RETURNING id`,
  );
  const findingId = Number((findingRows.rows[0] as { id: number }).id);
  return { zoneId, findingId };
}

async function addPendingFinding(
  wcId: number,
  zoneId: number,
): Promise<number> {
  const sd = new Date().toISOString();
  const rows = await db.execute(
    sql`INSERT INTO wet_check_findings
          (wet_check_id, zone_record_id, issue_type, issue_group,
           no_part_needed, quantity, labor_hours, resolution,
           created_at, updated_at)
        VALUES (
          ${wcId}, ${zoneId}, ${"broken_head"}, ${"quick_fix"},
          true, 1, ${"0.00"}, ${"pending"},
          ${sd}, ${sd}
        ) RETURNING id`,
  );
  return Number((rows.rows[0] as { id: number }).id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WCB Approval Snapshots — Slice 7", () => {
  before(seedBaseFixtures);
  after(teardownBaseFixtures);

  // ── Test 1: auto-bill path (initial + append) ────────────────────────────
  // Calls the real storage method to verify snapshot columns are written on
  // initial WCB creation and refreshed on a second (append-path) conversion.
  it("auto-bill path: convertWetCheckToWetCheckBilling writes snapshots; append refreshes them", async () => {
    // Wet check with 0.50 inspection-overhead hours.
    // Zone A: repairLaborHours=1.00 → initial totalHours = 0.50 + 1.00 = 1.50
    // Labor rate 60.00 → laborSubtotal = 90.00, partsSubtotal = 0.00, total = 90.00
    const wcId = await createSubmittedWetCheck();
    const { zoneId: zoneAId } = await addZoneWithFinding(wcId, "A", 1, "1.00");

    // Add a pending finding in zone A to keep the wet check "partially_converted"
    // after the first conversion so we can run the append path.
    const pendingFindingId = await addPendingFinding(wcId, zoneAId);

    // ── First call: initial WCB creation ──────────────────────────────────
    const mgr = { id: SCRATCH_USER_ID, name: "WCB Snap Tech 91001" };
    const result1 = await storage.convertWetCheckToWetCheckBilling(wcId, TEST_COMPANY_ID, mgr);
    assert.ok(result1.billingSheetId != null, "billingSheetId must be set after first conversion");
    const wcbId = result1.billingSheetId!;

    const [wcb1] = await db.select().from(wetCheckBillingsTable).where(eq(wetCheckBillingsTable.id, wcbId));
    assert.ok(wcb1, "WCB row must exist after first conversion");
    assert.equal(wcb1.status, "approved_passed_to_billing");

    assert.ok(wcb1.approvedLaborSnapshot != null, "approvedLaborSnapshot must be set after auto-bill");
    assert.ok(wcb1.approvedPartsSnapshot != null, "approvedPartsSnapshot must be set after auto-bill");

    const labor1 = JSON.parse(wcb1.approvedLaborSnapshot!);
    // totalHours = 0.50 (wc base) + 1.00 (zone A repair) = 1.50
    assert.equal(parseFloat(labor1.totalHours), 1.5, "totalHours must be 1.50 on first conversion");
    assert.equal(parseFloat(labor1.laborSubtotal), 90, "laborSubtotal must be 1.50 × 60 = 90 on first conversion");
    assert.equal(parseFloat(labor1.appliedLaborRate), 60, "appliedLaborRate must be 60.00");

    const parts1 = JSON.parse(wcb1.approvedPartsSnapshot!);
    assert.equal(parseFloat(parts1.partsSubtotal), 0, "partsSubtotal must be 0 (labor-only)");
    assert.equal(parseFloat(parts1.totalAmount), 90, "totalAmount must be 90 on first conversion");

    // ── Second call: append path ───────────────────────────────────────────
    // Add zone B (repairLaborHours=0.50) and route the pending finding to it.
    // We insert a second zone and a new repaired_in_field finding there.
    // totalHours (append) = 0.50 (base) + 1.00 (zone A already counted)
    //                     + 0.50 (zone B new) = 2.00 → laborSubtotal = 120.00, total = 120.00
    const { zoneId: zoneBId } = await addZoneWithFinding(wcId, "B", 1, "0.50");

    // Update the pending finding to repaired_in_field in zone B so it's eligible
    await db.execute(
      sql`UPDATE wet_check_findings
          SET zone_record_id = ${zoneBId},
              resolution = 'repaired_in_field',
              resolution_decided_at = NOW(),
              updated_at = NOW()
          WHERE id = ${pendingFindingId}`,
    );

    const result2 = await storage.convertWetCheckToWetCheckBilling(wcId, TEST_COMPANY_ID, mgr);
    assert.equal(result2.billingSheetId, wcbId, "Second call must reuse the same WCB id (append path)");

    const [wcb2] = await db.select().from(wetCheckBillingsTable).where(eq(wetCheckBillingsTable.id, wcbId));
    assert.ok(wcb2, "WCB row must exist after append");
    assert.equal(wcb2.status, "approved_passed_to_billing", "Status must stay approved after append");

    assert.ok(wcb2.approvedLaborSnapshot != null, "approvedLaborSnapshot must be refreshed on append");
    assert.ok(wcb2.approvedPartsSnapshot != null, "approvedPartsSnapshot must be refreshed on append");

    const labor2 = JSON.parse(wcb2.approvedLaborSnapshot!);
    // totalHours = 0.50 (base) + 1.00 (zone A) + 0.50 (zone B) = 2.00
    assert.equal(parseFloat(labor2.totalHours), 2.0, "totalHours must be updated to 2.00 on append");
    assert.equal(parseFloat(labor2.laborSubtotal), 120, "laborSubtotal must be updated to 2.00 × 60 = 120 on append");

    const parts2 = JSON.parse(wcb2.approvedPartsSnapshot!);
    assert.equal(parseFloat(parts2.totalAmount), 120, "totalAmount must be updated to 120 on append");
  });

  // ── Test 2: manager-approval path ─────────────────────────────────────────
  // Calls POST /api/wet-check-billings/:id/approve via a stub storage.
  // Verifies the route builds and writes both snapshots from the WCB's totals.
  it("manager-approval path: route writes both snapshot columns from WCB totals", async () => {
    const stubWcb = {
      id: 9910001,
      status: "submitted",
      totalHours: "2.00",
      laborRate: "60.00",
      appliedLaborRate: "60.00",
      laborSubtotal: "120.00",
      partsSubtotal: "0.00",
      totalAmount: "120.00",
    };

    let capturedUpdate: Record<string, unknown> | null = null;

    const stubStorage: ApproveRoutesStorage = {
      async getBillingSheetById(_id, _cid) { return undefined; },
      async updateBillingSheet(_id, _data) { return {}; },
      async getWorkOrder(_id, _cid) { return undefined; },
      async updateWorkOrder(_id, _data) { return {}; },
      async getWetCheckBillingById(id, _companyId) {
        return id === stubWcb.id ? stubWcb : undefined;
      },
      async updateWetCheckBilling(id, data) {
        capturedUpdate = data;
        return { ...stubWcb, ...data };
      },
      async getUser(_id) { return { name: "Alice Manager" }; },
    };

    const app = express();
    app.use(express.json());
    const noopAuth: RequestHandler = (_req, _res, next) => next();
    app.use((req: any, _res, next) => {
      req.authenticatedUserRole = "billing_manager";
      req.authenticatedUserId = SCRATCH_USER_ID;
      req.authenticatedUserCompanyId = TEST_COMPANY_ID;
      next();
    });
    registerApproveRoutes(app, stubStorage, noopAuth);

    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/wet-check-billings/${stubWcb.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const text = await res.text();
      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${text}`);

      const body = JSON.parse(text) as {
        wetCheckBilling: { status: string; approvedLaborSnapshot?: string; approvedPartsSnapshot?: string };
      };
      assert.equal(body.wetCheckBilling.status, "approved_passed_to_billing");

      assert.ok(capturedUpdate != null, "updateWetCheckBilling must have been called");
      const update = capturedUpdate as Record<string, unknown>;
      assert.ok(
        typeof update.approvedLaborSnapshot === "string",
        "approvedLaborSnapshot must be a string in the update payload",
      );
      assert.ok(
        typeof update.approvedPartsSnapshot === "string",
        "approvedPartsSnapshot must be a string in the update payload",
      );

      const laborSnap = JSON.parse(update.approvedLaborSnapshot as string);
      assert.equal(laborSnap.laborSubtotal, "120.00", "laborSubtotal must match WCB row");
      assert.equal(laborSnap.totalHours, "2.00", "totalHours must match WCB row");
      assert.equal(laborSnap.appliedLaborRate, "60.00", "appliedLaborRate must use appliedLaborRate field");

      const partsSnap = JSON.parse(update.approvedPartsSnapshot as string);
      assert.equal(partsSnap.partsSubtotal, "0.00", "partsSubtotal must match WCB row");
      assert.equal(partsSnap.totalAmount, "120.00", "totalAmount must match WCB row");
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  // ── Test 3: cross-tenant rejection ────────────────────────────────────────
  it("cross-tenant: manager from a different company receives 404 for another company's WCB", async () => {
    const ALIEN_COMPANY_ID = 999;
    const stubWcb = {
      id: 9910002,
      status: "submitted",
      totalHours: "1.00",
      laborRate: "60.00",
      appliedLaborRate: "60.00",
      laborSubtotal: "60.00",
      partsSubtotal: "0.00",
      totalAmount: "60.00",
    };

    const alienStorage: ApproveRoutesStorage = {
      async getBillingSheetById(_id, _cid) { return undefined; },
      async updateBillingSheet(_id, _data) { return {}; },
      async getWorkOrder(_id, _cid) { return undefined; },
      async updateWorkOrder(_id, _data) { return {}; },
      async getWetCheckBillingById(id, companyId) {
        // Simulate the company-scoped lookup: only return WCB for its own company
        if (companyId !== TEST_COMPANY_ID) return undefined;
        return id === stubWcb.id ? stubWcb : undefined;
      },
      async updateWetCheckBilling(_id, _data) {
        throw new Error("updateWetCheckBilling must not be called for cross-tenant attempt");
      },
      async getUser(_id) { return { name: "Alien Manager" }; },
    };

    const app = express();
    app.use(express.json());
    const noopAuth: RequestHandler = (_req, _res, next) => next();
    app.use((req: any, _res, next) => {
      req.authenticatedUserRole = "billing_manager";
      req.authenticatedUserId = SCRATCH_USER_ID;
      req.authenticatedUserCompanyId = ALIEN_COMPANY_ID;
      next();
    });
    registerApproveRoutes(app, alienStorage, noopAuth);

    const httpServer = createServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/wet-check-billings/${stubWcb.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 404, "Cross-tenant approval attempt must return 404, not 200");
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  // ── Test 5: approveWetCheck accepts partially_converted status ───────────
  it("approveWetCheck: partially_converted wet check transitions to approved without error", async () => {
    const sd = new Date().toISOString();
    const rows = await db.execute(
      sql`INSERT INTO wet_checks
            (company_id, customer_id, technician_id, technician_name,
             customer_name, num_controllers, status, labor_mode,
             total_labor_hours, started_at, created_at, updated_at)
          VALUES
            (${TEST_COMPANY_ID}, ${SCRATCH_CUSTOMER_ID}, ${SCRATCH_USER_ID},
             ${"WCB Snap Tech 91001"}, ${"WCB Snap Customer 91001"},
             1, ${"partially_converted"}, ${"flat"},
             ${"1.00"}, ${sd}, ${sd}, ${sd})
          RETURNING id`,
    );
    const wcId = Number((rows.rows[0] as { id: number }).id);

    const mgr = { id: SCRATCH_USER_ID, name: "WCB Snap Tech 91001" };
    const updated = await storage.approveWetCheck(wcId, TEST_COMPANY_ID, mgr);
    assert.ok(updated, "approveWetCheck must return the updated row");
    assert.equal(updated.status, "approved", "partially_converted wet check must transition to approved");
  });

  // ── Test 6: approveWetCheck still rejects converted status ───────────────
  it("approveWetCheck: converted wet check still throws (guard unchanged)", async () => {
    const sd = new Date().toISOString();
    const rows = await db.execute(
      sql`INSERT INTO wet_checks
            (company_id, customer_id, technician_id, technician_name,
             customer_name, num_controllers, status, labor_mode,
             total_labor_hours, started_at, created_at, updated_at)
          VALUES
            (${TEST_COMPANY_ID}, ${SCRATCH_CUSTOMER_ID}, ${SCRATCH_USER_ID},
             ${"WCB Snap Tech 91001"}, ${"WCB Snap Customer 91001"},
             1, ${"converted"}, ${"flat"},
             ${"1.00"}, ${sd}, ${sd}, ${sd})
          RETURNING id`,
    );
    const wcId = Number((rows.rows[0] as { id: number }).id);

    const mgr = { id: SCRATCH_USER_ID, name: "WCB Snap Tech 91001" };
    await assert.rejects(
      () => storage.approveWetCheck(wcId, TEST_COMPANY_ID, mgr),
      /Cannot approve wet check in status converted/,
      "approveWetCheck must throw for converted status",
    );
  });

  // ── Test 4: unapproved WCBs keep snapshot columns null ────────────────────
  it("unapproved WCBs (submitted status) keep both snapshot columns null", async () => {
    // Create a wet check to satisfy the FK, then insert a WCB manually
    const sd = new Date().toISOString();
    const wcRows = await db.execute(
      sql`INSERT INTO wet_checks
            (company_id, customer_id, technician_id, technician_name,
             customer_name, num_controllers, status, labor_mode,
             total_labor_hours, started_at, created_at, updated_at)
          VALUES
            (${TEST_COMPANY_ID}, ${SCRATCH_CUSTOMER_ID}, ${SCRATCH_USER_ID},
             ${"WCB Snap Tech 91001"}, ${"WCB Snap Customer 91001"},
             1, ${"in_progress"}, ${"flat"}, ${"1.00"}, ${sd}, ${sd}, ${sd})
          RETURNING id`,
    );
    const wcId = Number((wcRows.rows[0] as { id: number }).id);

    const billingRows = await db.execute(
      sql`INSERT INTO wet_check_billings (
              billing_number, customer_id, customer_name, property_address,
              work_date, technician_name, technician_id, wet_check_id,
              status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount
            ) VALUES (
              ${"WCB-SNAP-UNAPPROVED"}, ${SCRATCH_CUSTOMER_ID}, ${"WCB Snap Customer 91001"}, ${"1 Unapproved Rd"},
              ${sd}, ${"WCB Snap Tech 91001"}, ${SCRATCH_USER_ID}, ${wcId},
              ${"submitted"}, ${"1.00"}, ${"60.00"}, ${"60.00"}, ${"0.00"}, ${"60.00"}
            ) RETURNING id`,
    );
    const wcbId = Number((billingRows.rows[0] as { id: number }).id);

    const [row] = await db.select().from(wetCheckBillingsTable).where(eq(wetCheckBillingsTable.id, wcbId));
    assert.ok(row, "WCB row must exist");
    assert.equal(row.status, "submitted");
    assert.equal(row.approvedLaborSnapshot, null, "approvedLaborSnapshot must be null for unapproved WCB");
    assert.equal(row.approvedPartsSnapshot, null, "approvedPartsSnapshot must be null for unapproved WCB");
  });
});

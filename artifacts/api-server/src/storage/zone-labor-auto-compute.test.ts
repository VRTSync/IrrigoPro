/**
 * Task #893 — Unit tests for the zone labor auto-compute pipeline.
 *
 * Tests the private `_recomputeZoneRepairLaborIfAuto` helper indirectly via
 * the public storage methods that invoke it:
 *   - `resetZoneRepairLabor` (tech tier)
 *   - `resetZoneRepairLaborManagerTier` (manager tier)
 *   - `createWetCheckFinding` (auto-triggers recompute on finding add)
 *
 * All tests run against a real PostgreSQL connection (same pattern as the
 * wet-check-billings storage tests). Fixtures are isolated to a dedicated
 * test company and cleaned up in after().
 *
 * Scenarios covered:
 *   1. resetZoneRepairLabor: zero findings → repairLaborHours = "0.00"
 *   2. resetZoneRepairLabor: one finding → sum equals that type's defaultLaborHours
 *   3. resetZoneRepairLabor: multiple findings of different types → correct sum
 *   4. resetZoneRepairLabor: duplicate issue type → each finding counted separately
 *   5. resetZoneRepairLabor: unknown issue type (no config) → contributes 0, others still sum
 *   6. repairLaborManuallySet=true: _recomputeZoneRepairLaborIfAuto is a no-op
 *      (verified by calling storage.createWetCheckFinding which triggers recompute —
 *      the flag prevents the write so hours stay at the manually-set value)
 *   7. resetZoneRepairLabor clears manuallySet flag and recomputes from findings
 *   8. resetZoneRepairLaborManagerTier works on a submitted wet check
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";

const TAG = `zl-auto-${Date.now()}`;

let cid: number;
let customerId: number;
let techId: number;
let wetCheckId: number;          // status = in_progress
let submittedWetCheckId: number; // status = submitted (for manager-tier test)

const ISSUE_TYPE_A = `test_issue_A_${TAG}`;
const ISSUE_TYPE_B = `test_issue_B_${TAG}`;
const ISSUE_TYPE_UNKNOWN = `test_issue_UNKNOWN_${TAG}`;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Insert a zone record directly and return its id.
 * `controllerLetter` is made unique per call by appending a counter to avoid
 * conflicts with the `uniq_wet_check_zone` (wetCheckId, letter, zoneNumber) index.
 */
let zoneSeq = 0;
async function insertZone(
  wcId: number,
  opts?: { manuallySet?: boolean; hours?: string },
): Promise<number> {
  zoneSeq += 1;
  const letter = `T${zoneSeq}`;
  const zoneNum = zoneSeq;
  const rows = await db.execute(sql`
    INSERT INTO wet_check_zone_records
      (wet_check_id, controller_letter, zone_number, repair_labor_manually_set, repair_labor_hours)
    VALUES
      (${wcId}, ${letter}, ${zoneNum}, ${opts?.manuallySet ?? false}, ${opts?.hours ?? "0.00"})
    RETURNING id
  `);
  return Number((rows.rows[0] as { id: number }).id);
}

// --------------------------------------------------------------------------
// Fixture setup / teardown
// --------------------------------------------------------------------------

describe("_recomputeZoneRepairLaborIfAuto (via storage helpers)", () => {
  before(async () => {
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`ZoneLaborAutoComputeCo_${TAG}`}, 'basic', true)
      RETURNING id
    `);
    cid = Number((companyRows.rows[0] as { id: number }).id);

    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${cid}, 'Zone Labor Test Customer', ${`zlabor-${TAG}@example.test`})
      RETURNING id
    `);
    customerId = Number((customerRows.rows[0] as { id: number }).id);

    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`zlabor-tech-${TAG}`}, 'hashed', 'Zone Labor Tech', 'field_tech', ${cid}, true)
      RETURNING id
    `);
    techId = Number((userRows.rows[0] as { id: number }).id);

    const wcRows = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Zone Labor Tech', 'Zone Labor Test Customer', 1, 'in_progress', 'flat')
      RETURNING id
    `);
    wetCheckId = Number((wcRows.rows[0] as { id: number }).id);

    const swcRows = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Zone Labor Tech', 'Zone Labor Test Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    submittedWetCheckId = Number((swcRows.rows[0] as { id: number }).id);

    // Issue type configs for this company — two types with known defaultLaborHours.
    await db.execute(sql`
      INSERT INTO issue_type_configs
        (company_id, issue_type, issue_group, display_label, default_labor_hours)
      VALUES
        (${cid}, ${ISSUE_TYPE_A}, 'quick_fix',  'Test Issue A', '1.00'),
        (${cid}, ${ISSUE_TYPE_B}, 'zone_issue', 'Test Issue B', '0.50')
    `);
  });

  after(async () => {
    await db.execute(sql`
      DELETE FROM wet_check_findings
      WHERE wet_check_id IN (${wetCheckId}, ${submittedWetCheckId})
    `);
    await db.execute(sql`
      DELETE FROM wet_check_zone_records
      WHERE wet_check_id IN (${wetCheckId}, ${submittedWetCheckId})
    `);
    await db.execute(sql`DELETE FROM wet_checks WHERE id IN (${wetCheckId}, ${submittedWetCheckId})`);
    await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id = ${cid}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${techId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${cid}`);
  });

  // ─── Test 1: zero findings ──────────────────────────────────────────────────

  it("zero findings → repairLaborHours stays 0.00 after reset", async () => {
    const zoneId = await insertZone(wetCheckId);

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined, "resetZoneRepairLabor should return the zone record");
    assert.equal(result!.repairLaborHours, "0.00");
    assert.equal(result!.repairLaborManuallySet, false);
  });

  // ─── Test 2: single finding ────────────────────────────────────────────────

  it("one finding → repairLaborHours equals that type's defaultLaborHours after reset", async () => {
    const zoneId = await insertZone(wetCheckId);
    // Insert finding via storage so the FK chain and issueGroup derivation work.
    await storage.createWetCheckFinding(zoneId, cid, {
      issueType: ISSUE_TYPE_A,
      quantity: 1,
    });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(result!.repairLaborHours, "1.00",
      "one ISSUE_TYPE_A finding contributes defaultLaborHours=1.00");
    assert.equal(result!.repairLaborManuallySet, false);
  });

  // ─── Test 3: two findings of different types ───────────────────────────────

  it("two findings of different types → repairLaborHours = sum of both defaultLaborHours", async () => {
    const zoneId = await insertZone(wetCheckId);
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_A, quantity: 1 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_B, quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    // 1.00 (A) + 0.50 (B) = 1.50
    assert.equal(result!.repairLaborHours, "1.50");
  });

  // ─── Test 4: duplicate issue type counted separately ──────────────────────

  it("three findings including two of the same type → type counted twice in sum", async () => {
    const zoneId = await insertZone(wetCheckId);
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_A, quantity: 1 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_A, quantity: 1 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_B, quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    // 1.00 (A) + 1.00 (A) + 0.50 (B) = 2.50
    assert.equal(result!.repairLaborHours, "2.50");
  });

  // ─── Test 5: unknown issue type contributes 0 ─────────────────────────────

  it("finding with no matching issueTypeConfig entry contributes 0 hours", async () => {
    const zoneId = await insertZone(wetCheckId);
    // ISSUE_TYPE_UNKNOWN has no config entry — should contribute 0.
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_UNKNOWN, quantity: 1 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_A, quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    // Only ISSUE_TYPE_A contributes: 1.00
    assert.equal(result!.repairLaborHours, "1.00");
  });

  // ─── Test 6: manuallySet=true → recompute is a no-op ──────────────────────

  it("repairLaborManuallySet=true: _recomputeZoneRepairLaborIfAuto is skipped when createWetCheckFinding is called", async () => {
    // Start with a zone that has a manually-set value.
    const zoneId = await insertZone(wetCheckId, { manuallySet: true, hours: "5.00" });

    // Add a finding via storage (this triggers _recomputeZoneRepairLaborIfAuto internally).
    // Because repairLaborManuallySet=true, the recompute should exit early and leave
    // repairLaborHours unchanged.
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_A, quantity: 1 });

    // Re-read from DB to verify hours were NOT overwritten.
    const queryResult = await db.execute(
      sql`SELECT repair_labor_hours, repair_labor_manually_set
          FROM wet_check_zone_records WHERE id = ${zoneId}`,
    );
    const zr = queryResult.rows[0] as Record<string, unknown>;
    assert.equal(
      String(zr.repair_labor_hours),
      "5.00",
      "repairLaborHours must NOT be overwritten when repairLaborManuallySet=true",
    );
    assert.equal(zr.repair_labor_manually_set, true);
  });

  // ─── Test 7: resetZoneRepairLabor clears flag and recomputes ──────────────

  it("resetZoneRepairLabor clears manuallySet flag and recomputes from findings", async () => {
    const zoneId = await insertZone(wetCheckId, { manuallySet: true, hours: "5.00" });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: ISSUE_TYPE_B, quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(result!.repairLaborManuallySet, false,
      "resetZoneRepairLabor must clear the manuallySet flag");
    assert.equal(result!.repairLaborHours, "0.50",
      "after reset, hours should be recomputed from findings (not kept at 5.00)");
  });

  // ─── Test 8: manager-tier reset on a submitted wet check ─────────────────

  it("resetZoneRepairLaborManagerTier works on a submitted wet check", async () => {
    const zoneId = await insertZone(submittedWetCheckId, { manuallySet: true, hours: "3.00" });
    // Insert the finding directly (submitted WC can't go through tech-tier createWetCheckFinding).
    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, issue_type, issue_group, quantity)
      VALUES (${zoneId}, ${submittedWetCheckId}, ${ISSUE_TYPE_A}, 'quick_fix', 1)
    `);

    const result = await storage.resetZoneRepairLaborManagerTier(zoneId, cid);
    assert.ok(result !== undefined,
      "manager-tier reset should succeed on a submitted wet check");
    assert.equal(result!.repairLaborManuallySet, false);
    assert.equal(result!.repairLaborHours, "1.00");
  });
});

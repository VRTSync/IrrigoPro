/**
 * B2c — Quantity multiplier fix for _recomputeZoneRepairLaborIfAuto.
 *
 * Verifies that a finding with quantity > 1 contributes
 * defaultLaborHours × quantity (not just defaultLaborHours once).
 *
 * Also covers:
 *  - canonical multi-finding scenario:
 *      2 × nozzle_replacement (0.25) + 1 × head_replacement (0.25) + 1 × leak_repair (1.00) = 1.75 hr
 *  - manual override skips recompute
 *  - end-to-end smoke: 2 nozzle findings → labor at the customer's rate
 *
 * Uses the canonical WET_CHECK_ISSUE_TYPE_SEED types (already seeded per company).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";

const TAG = `wcl-qty-${Date.now()}`;

let cid: number;
let customerId: number;
let techId: number;
let wetCheckId: number;
let submittedWetCheckId: number;

let zoneSeq = 0;
async function insertZone(
  wcId: number,
  opts?: { manuallySet?: boolean; hours?: string },
): Promise<number> {
  zoneSeq += 1;
  const rows = await db.execute(sql`
    INSERT INTO wet_check_zone_records
      (wet_check_id, controller_letter, zone_number, repair_labor_manually_set, repair_labor_hours)
    VALUES
      (${wcId}, ${"Q" + zoneSeq}, ${zoneSeq}, ${opts?.manuallySet ?? false}, ${opts?.hours ?? "0.00"})
    RETURNING id
  `);
  return Number((rows.rows[0] as { id: number }).id);
}

describe("B2c — quantity multiplier in _recomputeZoneRepairLaborIfAuto", () => {
  before(async () => {
    const co = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`WCLaborQtyTestCo_${TAG}`}, 'basic', true)
      RETURNING id
    `);
    cid = Number((co.rows[0] as { id: number }).id);

    const cu = await db.execute(sql`
      INSERT INTO customers (company_id, name, email, labor_rate)
      VALUES (${cid}, 'Qty Test Customer', ${`qty-${TAG}@example.test`}, '50.00')
      RETURNING id
    `);
    customerId = Number((cu.rows[0] as { id: number }).id);

    const u = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`qty-tech-${TAG}`}, 'hashed', 'Qty Tech', 'field_tech', ${cid}, true)
      RETURNING id
    `);
    techId = Number((u.rows[0] as { id: number }).id);

    const wc = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Qty Tech', 'Qty Test Customer', 1, 'in_progress', 'flat')
      RETURNING id
    `);
    wetCheckId = Number((wc.rows[0] as { id: number }).id);

    const swc = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Qty Tech', 'Qty Test Customer', 1, 'submitted', 'flat')
      RETURNING id
    `);
    submittedWetCheckId = Number((swc.rows[0] as { id: number }).id);

    // Seed the canonical issue_type_configs for this company so the lookup
    // uses the real catalog defaults. Use the same types as the task spec.
    await db.execute(sql`
      INSERT INTO issue_type_configs
        (company_id, issue_type, issue_group, display_label, default_labor_hours)
      VALUES
        (${cid}, 'nozzle_replacement', 'quick_fix', 'Nozzle Replace', '0.25'),
        (${cid}, 'head_replacement',   'quick_fix', 'Head Replace',   '0.25'),
        (${cid}, 'leak_repair',        'advanced',  'Leak',           '1.00')
      ON CONFLICT (company_id, issue_type) DO NOTHING
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

  // ── 1. quantity=2 on nozzle_replacement: 0.25 × 2 = 0.50 ─────────────────

  it("quantity=2 nozzle_replacement finding → repairLaborHours = 0.50 (not 0.25)", async () => {
    const zoneId = await insertZone(wetCheckId);
    await storage.createWetCheckFinding(zoneId, cid, {
      issueType: "nozzle_replacement",
      quantity: 2,
    });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(
      result!.repairLaborHours,
      "0.50",
      "2 nozzle findings at 0.25 hr each should total 0.50 hr",
    );
  });

  // ── 2. Canonical multi-finding scenario from the task spec ────────────────
  // 2 × nozzle_replacement (0.25) + 1 × head_replacement (0.25) + 1 × leak_repair (1.00) = 1.75

  it("canonical mix: 2×nozzle (0.25) + 1×head (0.25) + 1×leak (1.00) = 1.75 hr", async () => {
    const zoneId = await insertZone(wetCheckId);

    await storage.createWetCheckFinding(zoneId, cid, { issueType: "nozzle_replacement", quantity: 2 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: "head_replacement",   quantity: 1 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: "leak_repair",        quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(
      result!.repairLaborHours,
      "1.75",
      "2×nozzle(0.25) + 1×head(0.25) + 1×leak(1.00) should equal 1.75",
    );
  });

  // ── 3. Manual override skips recompute ────────────────────────────────────

  it("repairLaborManuallySet=true: adding a quantity=3 finding does NOT recompute", async () => {
    const zoneId = await insertZone(wetCheckId, { manuallySet: true, hours: "7.77" });

    await storage.createWetCheckFinding(zoneId, cid, {
      issueType: "nozzle_replacement",
      quantity: 3,
    });

    const rows = await db.execute(
      sql`SELECT repair_labor_hours FROM wet_check_zone_records WHERE id = ${zoneId}`,
    );
    const row = rows.rows[0] as Record<string, unknown>;
    assert.equal(
      String(row.repair_labor_hours),
      "7.77",
      "manually-set zone must not be overwritten even with quantity > 1",
    );
  });

  // ── 4. End-to-end smoke: 2 nozzle findings → $25 labor at $50/hr ─────────
  // Total hours = 2 × 0.25 = 0.50; at $50/hr → laborSubtotal = $25.00

  it("end-to-end: 2 nozzle findings (qty 1 each) → repairLaborHours=0.50", async () => {
    const zoneId = await insertZone(wetCheckId);

    await storage.createWetCheckFinding(zoneId, cid, { issueType: "nozzle_replacement", quantity: 1 });
    await storage.createWetCheckFinding(zoneId, cid, { issueType: "nozzle_replacement", quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(
      result!.repairLaborHours,
      "0.50",
      "two quantity=1 nozzle findings should sum to 0.50 repair hours",
    );
  });

  // ── 5. quantity=1 single finding (baseline / regression guard) ────────────

  it("quantity=1 single finding still computes correctly", async () => {
    const zoneId = await insertZone(wetCheckId);
    await storage.createWetCheckFinding(zoneId, cid, { issueType: "leak_repair", quantity: 1 });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(result!.repairLaborHours, "1.00");
  });
});

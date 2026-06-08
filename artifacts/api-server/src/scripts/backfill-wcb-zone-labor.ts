/**
 * One-time backfill: re-compute repairLaborHours for every non-manually-set
 * wet_check_zone_records row, then re-derive labor totals on any uninvoiced WCBs
 * whose zones changed.
 *
 * Safe to re-run (idempotent). Only touches rows where:
 *   - repair_labor_manually_set = false  (no human override is disturbed)
 *   - invoice_id IS NULL on the WCB      (invoiced records are never repriced)
 *
 * Run:
 *   node --import tsx/esm src/scripts/backfill-wcb-zone-labor.ts [--dry-run]
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveIssueTypeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// ---------------------------------------------------------------------------
// Step 1 — re-compute repairLaborHours for all auto zones
// ---------------------------------------------------------------------------

async function recomputeZones(): Promise<Set<number>> {
  console.log("\n=== Step 1: recompute zone repair labor ===");

  // Load all issue type configs keyed by companyId
  const configRows = await db.execute<{ company_id: number; issue_type: string; default_labor_hours: string }>(
    sql`SELECT company_id, issue_type, default_labor_hours FROM issue_type_configs`
  );
  // Map: companyId → (normalizedIssueType → hours)
  const catalog = new Map<number, Map<string, number>>();
  for (const row of configRows.rows) {
    if (!catalog.has(row.company_id)) catalog.set(row.company_id, new Map());
    catalog.get(row.company_id)!.set(resolveIssueTypeKey(row.issue_type), parseFloat(String(row.default_labor_hours)) || 0);
  }

  // Fetch all auto zones
  const zoneRows = await db.execute<{
    id: number;
    wet_check_id: number;
    repair_labor_hours: string;
  }>(
    sql`SELECT id, wet_check_id, repair_labor_hours FROM wet_check_zone_records WHERE repair_labor_manually_set = false`
  );

  // Fetch company_id for each wet_check
  const wcIds = [...new Set(zoneRows.rows.map((z) => z.wet_check_id))];
  const wcRows =
    wcIds.length > 0
      ? await db.execute<{ id: number; company_id: number; total_labor_hours: string }>(
          sql`SELECT id, company_id, total_labor_hours FROM wet_checks WHERE id = ANY(${sql.param(wcIds)}::int[])`
        )
      : { rows: [] };
  const wcMap = new Map<number, { companyId: number; baseLaborHours: number }>();
  for (const w of wcRows.rows) {
    wcMap.set(w.id, { companyId: w.company_id, baseLaborHours: parseFloat(String(w.total_labor_hours ?? "0")) || 0 });
  }

  // Fetch findings grouped by zone
  const findingRows = await db.execute<{
    zone_record_id: number;
    issue_type: string;
    quantity: number;
  }>(
    sql`SELECT zone_record_id, issue_type, quantity FROM wet_check_findings`
  );
  const findingsByZone = new Map<number, Array<{ issueType: string; quantity: number }>>();
  for (const f of findingRows.rows) {
    if (!findingsByZone.has(f.zone_record_id)) findingsByZone.set(f.zone_record_id, []);
    findingsByZone.get(f.zone_record_id)!.push({ issueType: f.issue_type, quantity: f.quantity });
  }

  let updated = 0;
  let skipped = 0;
  const changedZoneIds = new Set<number>();

  for (const zone of zoneRows.rows) {
    const wc = wcMap.get(zone.wet_check_id);
    if (!wc) { skipped++; continue; }

    const companyCatalog = catalog.get(wc.companyId) ?? new Map();
    const findings = findingsByZone.get(zone.id) ?? [];

    let totalHours = 0;
    for (const f of findings) {
      const perUnit = companyCatalog.get(resolveIssueTypeKey(f.issueType)) ?? 0;
      const qty = isNaN(f.quantity) || f.quantity < 1 ? 1 : f.quantity;
      totalHours += perUnit * qty;
    }
    const newVal = totalHours.toFixed(2);
    const oldVal = parseFloat(String(zone.repair_labor_hours)).toFixed(2);

    if (newVal === oldVal) { skipped++; continue; }

    console.log(`  zone ${zone.id}: ${oldVal} → ${newVal} hrs (${findings.length} findings)`);
    if (!DRY_RUN) {
      await db.execute(
        sql`UPDATE wet_check_zone_records SET repair_labor_hours = ${newVal} WHERE id = ${zone.id}`
      );
    }
    updated++;
    changedZoneIds.add(zone.id);
  }

  console.log(`  zones scanned: ${zoneRows.rows.length}, updated: ${updated}, unchanged: ${skipped}`);
  return changedZoneIds;
}

// ---------------------------------------------------------------------------
// Step 2 — re-derive WCB totals for uninvoiced WCBs with changed zones
// ---------------------------------------------------------------------------

async function recomputeWcbTotals(changedZoneIds: Set<number>): Promise<void> {
  console.log("\n=== Step 2: recompute WCB totals ===");
  if (changedZoneIds.size === 0) {
    console.log("  No zones changed — nothing to update.");
    return;
  }

  // Find uninvoiced WCBs that have findings in any changed zone
  const affectedWcbs = await db.execute<{
    wcb_id: number;
    wet_check_id: number;
    parts_subtotal: string;
    labor_rate: string;
    applied_labor_rate: string | null;
    total_amount: string | null;
  }>(
    sql`
      SELECT DISTINCT
        wcb.id AS wcb_id,
        wcb.wet_check_id,
        wcb.parts_subtotal,
        wcb.labor_rate,
        wcb.applied_labor_rate,
        wcb.total_amount
      FROM wet_check_billings wcb
      JOIN wet_check_findings wf ON wf.wet_check_billing_id = wcb.id
      WHERE wcb.invoice_id IS NULL
        AND wf.zone_record_id = ANY(${sql.param([...changedZoneIds])}::int[])
    `
  );

  if (affectedWcbs.rows.length === 0) {
    console.log("  No uninvoiced WCBs affected.");
    return;
  }

  // For each affected WCB, compute fresh labor hours
  const wcIds = [...new Set(affectedWcbs.rows.map((r) => r.wet_check_id))];
  const wcRows = await db.execute<{ id: number; total_labor_hours: string }>(
    sql`SELECT id, total_labor_hours FROM wet_checks WHERE id = ANY(${sql.param(wcIds)}::int[])`
  );
  const wcBaseLaborMap = new Map<number, number>();
  for (const w of wcRows.rows) {
    wcBaseLaborMap.set(w.id, parseFloat(String(w.total_labor_hours ?? "0")) || 0);
  }

  for (const wcb of affectedWcbs.rows) {
    // Get unique zone IDs for this WCB's findings
    const zoneResult = await db.execute<{ zone_record_id: number }>(
      sql`SELECT DISTINCT zone_record_id FROM wet_check_findings WHERE wet_check_billing_id = ${wcb.wcb_id} AND zone_record_id IS NOT NULL`
    );
    const zoneIds = zoneResult.rows.map((r) => r.zone_record_id);

    // Sum their current (now-updated) repair_labor_hours
    let zoneRepairHours = 0;
    if (zoneIds.length > 0) {
      const zoneHrsResult = await db.execute<{ repair_labor_hours: string }>(
        sql`SELECT repair_labor_hours FROM wet_check_zone_records WHERE id = ANY(${sql.param(zoneIds)}::int[])`
      );
      for (const z of zoneHrsResult.rows) {
        zoneRepairHours += parseFloat(String(z.repair_labor_hours ?? "0")) || 0;
      }
    }

    const baseLaborHours = wcBaseLaborMap.get(wcb.wet_check_id) ?? 0;
    const totalHours = baseLaborHours + zoneRepairHours;

    // Use appliedLaborRate if set, otherwise laborRate
    const rate = parseFloat(String(wcb.applied_labor_rate ?? wcb.labor_rate)) || 0;
    const partsSubtotal = parseFloat(String(wcb.parts_subtotal ?? "0")) || 0;
    const laborSubtotal = totalHours * rate;
    const totalAmount = partsSubtotal + laborSubtotal;

    const oldTotal = parseFloat(String(wcb.total_amount ?? "0")).toFixed(2);
    console.log(`  WCB ${wcb.wcb_id}: ${totalHours.toFixed(2)} labor hrs, $${laborSubtotal.toFixed(2)} labor, $${totalAmount.toFixed(2)} total (was $${oldTotal})`);

    if (!DRY_RUN) {
      await db.execute(
        sql`
          UPDATE wet_check_billings
          SET
            total_hours    = ${totalHours.toFixed(2)},
            labor_subtotal = ${laborSubtotal.toFixed(2)},
            total_amount   = ${totalAmount.toFixed(2)},
            updated_at     = NOW()
          WHERE id = ${wcb.wcb_id}
        `
      );
    }
  }

  console.log(`  WCBs updated: ${affectedWcbs.rows.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Backfill WCB zone labor — ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

const changedZoneIds = await recomputeZones();
await recomputeWcbTotals(changedZoneIds);

console.log("\nDone.");
process.exit(0);

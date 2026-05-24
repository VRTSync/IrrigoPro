/**
 * Task #891 — Backfill zone repair labor from issueTypeConfigs.defaultLaborHours.
 *
 * Strictly targets auto-mode zones (repairLaborManuallySet=false) where
 * repairLaborHours is exactly 0.00 AND the zone has at least one finding.
 * This avoids overwriting any non-zero labor values that may have been
 * entered before the auto-compute feature shipped.
 *
 * Resumable: processed zone IDs are persisted to
 *   app_settings["zoneRepairLaborBackfill.done"]
 * Failures are appended to
 *   app_settings["zoneRepairLaborBackfill.failed"]
 *
 * Run:
 *   node --import tsx/esm artifacts/api-server/src/scripts/backfill-zone-labor-from-defaults.ts [--dry-run] [--batch=N]
 */

import { db } from "../db";
import {
  wetCheckZoneRecords,
  wetCheckFindings,
  issueTypeConfigs,
  wetChecks,
  appSettings,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const batchArg = args.find((a) => a.startsWith("--batch="));
const BATCH = batchArg ? parseInt(batchArg.split("=")[1], 10) : 50;

const DONE_KEY = "zoneRepairLaborBackfill.done";
const FAILED_KEY = "zoneRepairLaborBackfill.failed";

async function loadDoneSet(): Promise<Set<number>> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, DONE_KEY));
  if (!row?.value) return new Set();
  const ids: number[] = JSON.parse(row.value as string) ?? [];
  return new Set(ids);
}

async function saveDoneSet(done: Set<number>): Promise<void> {
  const value = JSON.stringify(Array.from(done));
  await db
    .insert(appSettings)
    .values({ key: DONE_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

async function appendFailed(id: number): Promise<void> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, FAILED_KEY));
  const existing: number[] = row?.value ? JSON.parse(row.value as string) : [];
  const next = JSON.stringify([...new Set([...existing, id])]);
  await db
    .insert(appSettings)
    .values({ key: FAILED_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next } });
}

async function run() {
  console.log(`[backfill-zone-labor] Starting — dryRun=${dryRun} batchSize=${BATCH}`);

  const doneSet = await loadDoneSet();
  console.log(`[backfill-zone-labor] Already processed: ${doneSet.size} zone IDs`);

  // Load only auto-mode zones where repairLaborHours is exactly 0.
  // Zones with non-zero values are intentionally skipped — they may have been
  // manually entered before the repairLaborManuallySet flag existed.
  const zeroAutoZones = await db
    .select({
      id: wetCheckZoneRecords.id,
      wetCheckId: wetCheckZoneRecords.wetCheckId,
    })
    .from(wetCheckZoneRecords)
    .where(
      and(
        eq(wetCheckZoneRecords.repairLaborManuallySet, false),
        sql`${wetCheckZoneRecords.repairLaborHours}::numeric = 0`,
      ),
    );

  console.log(`[backfill-zone-labor] ${zeroAutoZones.length} zero auto-mode zone records found`);

  // Filter out already-processed IDs.
  const pending = zeroAutoZones.filter((z) => !doneSet.has(z.id));
  console.log(`[backfill-zone-labor] ${pending.length} remaining after resume filter`);

  if (pending.length === 0) {
    console.log("[backfill-zone-labor] Nothing to process.");
    return;
  }

  const pendingIds = pending.map((z) => z.id);

  // Load findings only for these zones.
  const findings = await db
    .select({ zoneRecordId: wetCheckFindings.zoneRecordId, issueType: wetCheckFindings.issueType })
    .from(wetCheckFindings)
    .where(inArray(wetCheckFindings.zoneRecordId, pendingIds));

  const findingsByZone = new Map<number, string[]>();
  for (const f of findings) {
    if (f.zoneRecordId == null) continue;
    const list = findingsByZone.get(f.zoneRecordId) ?? [];
    list.push(f.issueType);
    findingsByZone.set(f.zoneRecordId, list);
  }

  // Keep only zones with at least one finding.
  const pendingWithFindings = pending.filter((z) => (findingsByZone.get(z.id) ?? []).length > 0);
  const noFindingsCount = pending.length - pendingWithFindings.length;
  console.log(
    `[backfill-zone-labor] ${pendingWithFindings.length} zones have findings (${noFindingsCount} with no findings — skipping)`,
  );

  if (pendingWithFindings.length === 0) {
    // Still mark the no-findings zones as done so they don't re-appear.
    if (!dryRun) {
      for (const z of pending) doneSet.add(z.id);
      await saveDoneSet(doneSet);
    }
    console.log("[backfill-zone-labor] Nothing to update.");
    return;
  }

  // Collect wet-check → company mapping.
  const wetCheckIds = Array.from(new Set(pendingWithFindings.map((z) => z.wetCheckId)));
  const wcRows = await db
    .select({ id: wetChecks.id, companyId: wetChecks.companyId })
    .from(wetChecks)
    .where(inArray(wetChecks.id, wetCheckIds));
  const wcCompanyMap = new Map(wcRows.map((w) => [w.id, w.companyId]));

  // Load issue type configs for all relevant companies.
  const companyIds = Array.from(new Set(wcRows.map((w) => w.companyId)));
  const configs = await db
    .select({
      companyId: issueTypeConfigs.companyId,
      issueType: issueTypeConfigs.issueType,
      defaultLaborHours: issueTypeConfigs.defaultLaborHours,
    })
    .from(issueTypeConfigs)
    .where(inArray(issueTypeConfigs.companyId, companyIds));

  const configMap = new Map<number, Map<string, number>>();
  for (const c of configs) {
    let inner = configMap.get(c.companyId);
    if (!inner) { inner = new Map(); configMap.set(c.companyId, inner); }
    inner.set(c.issueType, parseFloat(String(c.defaultLaborHours ?? "0")) || 0);
  }

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const newlyDone = new Set<number>(doneSet);

  for (let i = 0; i < pendingWithFindings.length; i += BATCH) {
    const batch = pendingWithFindings.slice(i, i + BATCH);

    for (const zone of batch) {
      scanned++;
      const zoneIssueTypes = findingsByZone.get(zone.id) ?? [];
      const companyId = wcCompanyMap.get(zone.wetCheckId);
      if (!companyId) {
        console.warn(`[backfill-zone-labor] zone ${zone.id}: no company found, skipping`);
        skipped++;
        newlyDone.add(zone.id);
        continue;
      }
      const inner = configMap.get(companyId) ?? new Map<string, number>();
      const computed = zoneIssueTypes.reduce((s, it) => s + (inner.get(it) ?? 0), 0);

      if (computed === 0) {
        // Issue types have no configured default hours — nothing to set.
        skipped++;
        newlyDone.add(zone.id);
        continue;
      }

      try {
        if (!dryRun) {
          await db
            .update(wetCheckZoneRecords)
            .set({ repairLaborHours: computed.toFixed(2) })
            .where(eq(wetCheckZoneRecords.id, zone.id));
        }
        console.log(
          `[backfill-zone-labor] zone ${zone.id}: 0.00 → ${computed.toFixed(2)}${dryRun ? " (dry)" : ""}`,
        );
        updated++;
        newlyDone.add(zone.id);
      } catch (err) {
        console.error(`[backfill-zone-labor] zone ${zone.id} FAILED:`, err);
        if (!dryRun) await appendFailed(zone.id);
        failed++;
      }
    }

    // Persist progress after each batch.
    if (!dryRun) {
      await saveDoneSet(newlyDone);
      console.log(`[backfill-zone-labor] Checkpoint: ${i + batch.length} / ${pendingWithFindings.length} processed`);
    }
  }

  console.log(
    `[backfill-zone-labor] Done — scanned=${scanned} updated=${updated} skipped=${skipped} failed=${failed}`,
  );
  if (failed > 0) {
    console.warn(`[backfill-zone-labor] ${failed} failures recorded in app_settings["${FAILED_KEY}"]`);
  }
}

run().catch((e) => {
  console.error("[backfill-zone-labor] Fatal:", e);
  process.exit(1);
});

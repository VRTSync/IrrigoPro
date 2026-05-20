// Task #753 — Slice 4 backfill: populate `wet_check_zone_records.repair_labor_hours`
// for every zone that has at least one finding already linked to a billing sheet
// (`findings.billing_sheet_id IS NOT NULL`).
//
// Formula per zone:
//   repair_labor_hours = SUM(wcf.labor_hours)
//   WHERE wcf.zone_record_id = zone.id
//     AND wcf.billing_sheet_id IS NOT NULL
//
// Zones with no billed findings are intentionally left at "0.00" — the tech
// will set the value via the new stepper in Slice 6.
//
// Resumable: processed zone record ids are persisted to
//   app_settings key `zoneRepairLabor.done`
// Failures are accumulated in
//   app_settings key `zoneRepairLabor.failed`
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-zone-repair-labor.ts \
//     [--dry-run] [--batch=500]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import { wetCheckZoneRecords, wetCheckFindings, appSettings } from "@workspace/db";
import { eq, sql, isNotNull } from "drizzle-orm";

const DONE_KEY = "zoneRepairLabor.done";
const FAIL_KEY = "zoneRepairLabor.failed";

function parseFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function loadIdSet(key: string): Promise<Set<number>> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (rows.length === 0) return new Set();
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((n) => Number.isFinite(n)),
      );
    }
  } catch {
    // Corrupt value — start fresh.
  }
  return new Set();
}

async function saveDoneSet(ids: Set<number>): Promise<void> {
  const value = JSON.stringify(Array.from(ids).sort((a, b) => a - b));
  await db
    .insert(appSettings)
    .values({ key: DONE_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

interface FailureEntry {
  id: number;
  error: string;
  at: string;
}

async function loadFailures(): Promise<FailureEntry[]> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, FAIL_KEY));
  if (rows.length === 0) return [];
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    return Array.isArray(parsed) ? (parsed as FailureEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendFailure(entry: FailureEntry): Promise<void> {
  const existing = await loadFailures();
  const value = JSON.stringify([...existing, entry]);
  await db
    .insert(appSettings)
    .values({ key: FAIL_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

async function main(): Promise<void> {
  const dryRun = parseFlag("dry-run");
  const batchSize = parseArg("batch", 500);

  console.log(
    `[backfill-zone-repair-labor] starting (dryRun=${dryRun}, batch=${batchSize})`,
  );

  const done = await loadIdSet(DONE_KEY);
  console.log(
    `[backfill-zone-repair-labor] resume — ${done.size} zone record ids already processed`,
  );

  // Collect all zone record ids that have at least one billed finding.
  // We process only those zones — zones with no billed findings are left at 0.
  const billedZoneRows = await db
    .selectDistinct({ zoneRecordId: wetCheckFindings.zoneRecordId })
    .from(wetCheckFindings)
    .where(isNotNull(wetCheckFindings.billingSheetId));

  const allCandidateIds = billedZoneRows.map((r) => r.zoneRecordId);
  console.log(
    `[backfill-zone-repair-labor] found ${allCandidateIds.length} zone records with billed findings`,
  );

  let scanned = 0;
  let updated = 0;
  let skippedAlreadyDone = 0;
  let skippedNoChange = 0;
  let failed = 0;

  // Process in batches.
  for (let offset = 0; offset < allCandidateIds.length; offset += batchSize) {
    const batch = allCandidateIds.slice(offset, offset + batchSize);

    for (const zoneRecordId of batch) {
      scanned += 1;

      if (done.has(zoneRecordId)) {
        skippedAlreadyDone += 1;
        continue;
      }

      try {
        // Sum labor_hours from billed findings for this zone.
        const findingRows = await db
          .select({ laborHours: wetCheckFindings.laborHours })
          .from(wetCheckFindings)
          .where(
            sql`${wetCheckFindings.zoneRecordId} = ${zoneRecordId}
                AND ${wetCheckFindings.billingSheetId} IS NOT NULL`,
          );

        const sumHours = findingRows.reduce((acc, f) => {
          const v = parseFloat(String(f.laborHours ?? "0")) || 0;
          return acc + v;
        }, 0);

        // Read the existing value to detect if an update is actually needed.
        const [existing] = await db
          .select({ repairLaborHours: wetCheckZoneRecords.repairLaborHours })
          .from(wetCheckZoneRecords)
          .where(eq(wetCheckZoneRecords.id, zoneRecordId));

        const existingVal = parseFloat(String(existing?.repairLaborHours ?? "0")) || 0;

        if (Math.abs(existingVal - sumHours) < 0.001) {
          // Already correct — mark done, skip write.
          done.add(zoneRecordId);
          skippedNoChange += 1;
          continue;
        }

        if (!dryRun) {
          await db
            .update(wetCheckZoneRecords)
            .set({ repairLaborHours: sumHours.toFixed(2) })
            .where(eq(wetCheckZoneRecords.id, zoneRecordId));
          done.add(zoneRecordId);
        }

        updated += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[backfill-zone-repair-labor] FAILED zone_record_id=${zoneRecordId}: ${msg}`,
        );
        if (!dryRun) {
          await appendFailure({
            id: zoneRecordId,
            error: msg,
            at: new Date().toISOString(),
          });
        }
      }
    }

    // Persist done set per batch so a mid-run timeout resumes cleanly.
    if (!dryRun) {
      await saveDoneSet(done);
    }
    console.log(
      `[backfill-zone-repair-labor] scanned=${scanned} updated=${updated} ` +
        `skippedAlreadyDone=${skippedAlreadyDone} skippedNoChange=${skippedNoChange} ` +
        `failed=${failed}`,
    );
  }

  console.log(
    `[backfill-zone-repair-labor] done. scanned=${scanned} updated=${updated} ` +
      `skippedAlreadyDone=${skippedAlreadyDone} skippedNoChange=${skippedNoChange} ` +
      `failed=${failed} dryRun=${dryRun}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-zone-repair-labor] fatal:", err);
    process.exit(1);
  });

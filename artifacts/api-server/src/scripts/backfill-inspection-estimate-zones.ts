// Task #1409 — Backfill zone data onto pre-#1385 inspection estimate line items.
//
// Inspection estimates generated before Task #1385 have controllerLetter /
// zoneNumber / issueType null on their line items, so isInspectionOriginEstimate
// returns false and the zone-grouped PDF layout never renders for them.
//
// This script re-stamps those items from the source wet-check findings — the
// same way live generation does — so older estimates get the zone-grouped PDF
// without touching any financial totals.
//
// Selection criteria:
//   - estimates.origin_wet_check_id IS NOT NULL  (inspection-origin only)
//   - none of the estimate's items have a non-null controller_letter  (pre-#1385)
//   Estimates that already have zone data on any item are automatically absent
//   from the query result ("skipped-already-zoned").
//
// Per estimate:
//   1. Load the source wet-check's findings + zone records.
//   2. Call buildInspectionEstimateItems to regenerate the item set.
//   3. Compare regenerated partsSubtotal + totalLaborHours to the stored header.
//      - MATCH: commit on --apply (delete old items, insert zone-stamped items).
//      - SKIP: log the discrepancy; persist to "seen" set so reruns skip quickly.
//
// Financial totals are NEVER mutated — only the line-item zone metadata.
//
// Resumability:
//   - Completed estimates (matched + applied):
//       app_settings["backfill.inspectionEstimateZones.done"]
//   - Seen-but-skipped estimates (totals mismatch or no findings):
//       app_settings["backfill.inspectionEstimateZones.seen"]
//       Persisted so reruns don't rescan known mismatches. Remove a key from
//       "seen" manually if source data is corrected and you want to retry.
//   - Per-estimate errors:
//       app_settings["backfill.inspectionEstimateZones.failed"]
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-inspection-estimate-zones.ts \
//     --dry-run
// Review the report, then:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/backfill-inspection-estimate-zones.ts \
//     --apply [--batch=N]

try { (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle?.setBlocking?.(true); } catch {}

import { db } from "../db";
import {
  estimates,
  estimateItems,
  wetCheckFindings,
  wetCheckZoneRecords,
  appSettings,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  buildInspectionEstimateItems,
  type FindingForEstimate,
  type ZoneForEstimate,
  type EstimateItemDraft,
} from "../inspection-estimate-items";

// ── Public types (used by tests) ─────────────────────────────────────────────

export interface CandidateRow {
  id: number;
  originWetCheckId: number;
  partsSubtotal: string | null;
  totalLaborHours: string | null;
}

export interface FailureEntry {
  id: number;
  error: string;
  at: string;
}

export interface BackfillDeps {
  loadIdSet: (key: string) => Promise<Set<number>>;
  saveIdSet: (key: string, ids: Set<number>) => Promise<void>;
  appendFailure: (entry: FailureEntry) => Promise<void>;
  /** Unzoned inspection-origin estimates only (never returns already-zoned rows). */
  getCandidates: () => Promise<CandidateRow[]>;
  /** Current item count for an estimate (before replacement). */
  getItemCount: (estimateId: number) => Promise<number>;
  getFindings: (wcId: number) => Promise<FindingForEstimate[]>;
  getZoneRecords: (zoneRecordIds: number[]) => Promise<Map<number, ZoneForEstimate>>;
  /** Delete existing items and insert zone-stamped replacements inside a transaction. */
  replaceItems: (estimateId: number, items: EstimateItemDraft[]) => Promise<void>;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

export interface BackfillResult {
  totalSelected: number;
  alreadyProcessed: number;
  matched: number;
  /** Estimates that were MATCH but not written because dryRun=true */
  matchedDryRun: number;
  skippedTotalsMismatch: number;
  skippedNoFindings: number;
  errors: number;
}

// ── Totals comparison ─────────────────────────────────────────────────────────

/** Returns true when two decimal values agree within $0.01. */
export function amountsMatch(stored: string | null | undefined, regen: number): boolean {
  const s = parseFloat(String(stored ?? "0")) || 0;
  return Math.abs(s - regen) < 0.015;
}

// ── Core backfill logic (injectable — used by both main() and tests) ──────────

export async function runBackfill(
  deps: BackfillDeps,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const log = opts.log ?? console.log;
  const logErr = opts.logError ?? console.error;
  const TAG = "[backfill-inspection-estimate-zones]";

  const done = await deps.loadIdSet("backfill.inspectionEstimateZones.done");
  const seen = await deps.loadIdSet("backfill.inspectionEstimateZones.seen");

  log(`${TAG} resume — done=${done.size} seen(skip)=${seen.size}`);

  const candidateRows = await deps.getCandidates();
  log(`${TAG} ${candidateRows.length} unzoned inspection-origin estimate(s) found`);

  // Estimates already in "done" or "seen" are skipped — no rescan.
  const pending = candidateRows.filter((r) => !done.has(r.id) && !seen.has(r.id));
  const alreadyProcessed = candidateRows.length - pending.length;
  log(`${TAG} ${pending.length} remaining after resume filter (${alreadyProcessed} already processed)`);

  let scanned = 0;
  let matched = 0;
  let matchedDryRun = 0;
  let skippedTotalsMismatch = 0;
  let skippedNoFindings = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i += opts.batchSize) {
    const batch = pending.slice(i, i + opts.batchSize);

    for (const row of batch) {
      scanned++;
      const estId = row.id;
      const wcId = row.originWetCheckId;

      try {
        const itemCountBefore = await deps.getItemCount(estId);
        const allFindings = await deps.getFindings(wcId);

        if (allFindings.length === 0) {
          log(
            `${TAG} estimate ${estId}: ` +
              `SKIP (no findings) — wet check #${wcId} has no findings; ` +
              `items before=${itemCountBefore}`,
          );
          skippedNoFindings++;
          seen.add(estId);
          continue;
        }

        const zoneRecordIds = [...new Set(allFindings.map((f) => f.zoneRecordId))];
        const zoneByRecordId = await deps.getZoneRecords(zoneRecordIds);

        const { items: drafts, totalLaborHours: regenLaborHours } =
          buildInspectionEstimateItems(allFindings, zoneByRecordId);

        const regenPartsSubtotal = drafts.reduce(
          (s, it) => s + parseFloat(String(it.totalPrice ?? "0")),
          0,
        );

        const partsMatch = amountsMatch(row.partsSubtotal, regenPartsSubtotal);
        const laborMatch = amountsMatch(row.totalLaborHours, regenLaborHours);

        if (!partsMatch || !laborMatch) {
          log(
            `${TAG} estimate ${estId}: ` +
              `SKIP (totals mismatch) — ` +
              `parts stored=${row.partsSubtotal} regen=${regenPartsSubtotal.toFixed(2)}  ` +
              `labor stored=${row.totalLaborHours} regen=${regenLaborHours.toFixed(2)}  ` +
              `items before=${itemCountBefore} regen=${drafts.length}`,
          );
          skippedTotalsMismatch++;
          seen.add(estId);
          continue;
        }

        log(
          `${TAG} estimate ${estId}: ` +
            `MATCH — ` +
            `items ${itemCountBefore} → ${drafts.length}  ` +
            `parts stored=${row.partsSubtotal} regen=${regenPartsSubtotal.toFixed(2)}  ` +
            `labor stored=${row.totalLaborHours} regen=${regenLaborHours.toFixed(2)}h` +
            (opts.dryRun ? "  (dry-run — no write)" : ""),
        );

        if (!opts.dryRun) {
          await deps.replaceItems(estId, drafts);
          done.add(estId);
          matched++;
        } else {
          matchedDryRun++;
        }
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        logErr(`${TAG} estimate ${estId} FAILED: ${msg}`);
        if (!opts.dryRun) {
          await deps.appendFailure({ id: estId, error: msg, at: new Date().toISOString() });
        }
      }
    }

    // Persist progress after each batch (apply mode only).
    if (!opts.dryRun) {
      await deps.saveIdSet("backfill.inspectionEstimateZones.done", done);
      await deps.saveIdSet("backfill.inspectionEstimateZones.seen", seen);
      log(
        `${TAG} checkpoint: ` +
          `scanned=${scanned} matched=${matched} ` +
          `skippedTotalsMismatch=${skippedTotalsMismatch} ` +
          `skippedNoFindings=${skippedNoFindings} errors=${errors}`,
      );
    }
  }

  return {
    totalSelected: candidateRows.length,
    alreadyProcessed,
    matched,
    matchedDryRun,
    skippedTotalsMismatch,
    skippedNoFindings,
    errors,
  };
}

// ── Real DB deps ──────────────────────────────────────────────────────────────

function makeDbDeps(): BackfillDeps {
  async function loadIdSet(key: string): Promise<Set<number>> {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key));
    if (rows.length === 0) return new Set();
    try {
      const parsed = JSON.parse(String(rows[0].value));
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

  async function saveIdSet(key: string, ids: Set<number>): Promise<void> {
    const value = JSON.stringify(Array.from(ids).sort((a, b) => a - b));
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async function appendFailure(entry: FailureEntry): Promise<void> {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "backfill.inspectionEstimateZones.failed"));
    let existing: FailureEntry[] = [];
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(String(rows[0].value));
        existing = Array.isArray(parsed) ? (parsed as FailureEntry[]) : [];
      } catch {
        existing = [];
      }
    }
    const value = JSON.stringify([...existing, entry]);
    await db
      .insert(appSettings)
      .values({ key: "backfill.inspectionEstimateZones.failed", value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async function getCandidates(): Promise<CandidateRow[]> {
    return db
      .select({
        id: estimates.id,
        originWetCheckId: estimates.originWetCheckId,
        partsSubtotal: estimates.partsSubtotal,
        totalLaborHours: estimates.totalLaborHours,
      })
      .from(estimates)
      .where(
        sql`
          ${estimates.originWetCheckId} IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM estimate_items ei
            WHERE ei.estimate_id = ${estimates.id}
              AND ei.controller_letter IS NOT NULL
          )
        `,
      )
      .orderBy(estimates.id) as unknown as Promise<CandidateRow[]>;
  }

  async function getItemCount(estimateId: number): Promise<number> {
    const rows = await db
      .select({ id: estimateItems.id })
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, estimateId));
    return rows.length;
  }

  async function getFindings(wcId: number): Promise<FindingForEstimate[]> {
    const rows = await db
      .select()
      .from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wcId));
    return rows.map((f) => ({
      zoneRecordId: f.zoneRecordId,
      partId: f.partId ?? null,
      partName: f.partName ?? null,
      partPrice: f.partPrice ?? null,
      quantity: f.quantity,
      laborHours: String(f.laborHours ?? "0"),
      issueType: f.issueType,
      notes: f.notes ?? null,
    }));
  }

  async function getZoneRecords(zoneRecordIds: number[]): Promise<Map<number, ZoneForEstimate>> {
    if (zoneRecordIds.length === 0) return new Map();
    const rows = await db
      .select()
      .from(wetCheckZoneRecords)
      .where(inArray(wetCheckZoneRecords.id, zoneRecordIds));
    return new Map(rows.map((z) => [z.id, z]));
  }

  async function replaceItems(estimateId: number, items: EstimateItemDraft[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(estimateItems).where(eq(estimateItems.estimateId, estimateId));
      if (items.length > 0) {
        await tx.insert(estimateItems).values(
          items.map((d) => ({
            estimateId,
            description: d.description,
            partId: d.partId,
            partName: d.partName,
            partPrice: d.partPrice,
            laborHours: d.laborHours,
            quantity: d.quantity,
            totalPrice: d.totalPrice,
            sortOrder: d.sortOrder,
            controllerLetter: d.controllerLetter,
            zoneNumber: d.zoneNumber,
            issueType: d.issueType,
          })),
        );
      }
    });
  }

  return {
    loadIdSet,
    saveIdSet,
    appendFailure,
    getCandidates,
    getItemCount,
    getFindings,
    getZoneRecords,
    replaceItems,
  };
}

// ── Argument parsing + entry point ────────────────────────────────────────────

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const apply = hasFlag("apply");
  const batchSize = parseArg("batch", 50);

  if (!dryRun && !apply) {
    console.error(
      "Usage: backfill-inspection-estimate-zones.ts --dry-run | --apply [--batch=N]",
    );
    process.exit(1);
  }

  console.log(
    `[backfill-inspection-estimate-zones] starting ` +
      `(mode=${dryRun ? "dry-run" : "apply"}, batch=${batchSize})`,
  );

  const result = await runBackfill(makeDbDeps(), { dryRun, batchSize });

  const modeLabel = dryRun ? "dry-run (no writes)" : "applied";
  console.log(
    `\n[backfill-inspection-estimate-zones] DONE\n` +
      `  total selected     : ${result.totalSelected}\n` +
      `  already processed  : ${result.alreadyProcessed}\n` +
      `  matched + applied  : ${result.matched}\n` +
      `  matched (dry-run)  : ${result.matchedDryRun}\n` +
      `  skipped (mismatch) : ${result.skippedTotalsMismatch}\n` +
      `  skipped (no finds) : ${result.skippedNoFindings}\n` +
      `  errors             : ${result.errors}\n` +
      `  mode               : ${modeLabel}`,
  );
}

// Only run when this file is the direct entry point (not when imported by tests).
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[backfill-inspection-estimate-zones] fatal:", err);
      process.exit(1);
    });
}

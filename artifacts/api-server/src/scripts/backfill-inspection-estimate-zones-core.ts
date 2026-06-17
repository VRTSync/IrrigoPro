// Task #1409 / #1412 — Inspection-estimate zone backfill core logic.
//
// Side-effect-free module: contains runBackfill, the DB deps factory, and
// the persisted-status reader. The CLI entry point lives in
// backfill-inspection-estimate-zones.ts; the Super Admin route imports from
// HERE so the bundled server never pulls in the CLI's main() guard.

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

export interface BackfillProgressSnapshot {
  scanned: number;
  matched: number;
  matchedDryRun: number;
  skippedTotalsMismatch: number;
  skippedNoFindings: number;
  errors: number;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
  /** Fired after each estimate with the running tallies (for live UI). */
  onProgress?: (snapshot: BackfillProgressSnapshot) => void;
  /** Polled at each batch boundary; return true to stop early. */
  cancelSignal?: () => boolean;
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
    if (opts.cancelSignal?.()) {
      log(`${TAG} cancel requested — stopping before batch at offset ${i}`);
      break;
    }
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
      } finally {
        // Emit progress for EVERY row, including the no-findings / mismatch
        // skip paths that `continue` out of the try block — otherwise the live
        // UI counters lag behind on runs with many skips.
        opts.onProgress?.({
          scanned,
          matched,
          matchedDryRun,
          skippedTotalsMismatch,
          skippedNoFindings,
          errors,
        });
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

export function makeDbDeps(): BackfillDeps {
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

// ── Persisted status (used by the Super Admin UI route) ───────────────────────

export interface BackfillStatus {
  /** Unzoned inspection-origin estimates currently present (pending + skipped). */
  candidateCount: number;
  /** Estimates already backfilled (app_settings done set). */
  doneCount: number;
  /** Estimates skipped (totals mismatch / no findings) and persisted to seen. */
  seenCount: number;
  /** Estimates that errored during a prior apply run. */
  failedCount: number;
}

export async function getBackfillStatus(): Promise<BackfillStatus> {
  const deps = makeDbDeps();
  const [candidates, done, seen] = await Promise.all([
    deps.getCandidates(),
    deps.loadIdSet("backfill.inspectionEstimateZones.done"),
    deps.loadIdSet("backfill.inspectionEstimateZones.seen"),
  ]);

  let failedCount = 0;
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "backfill.inspectionEstimateZones.failed"));
  if (rows.length > 0) {
    try {
      const parsed = JSON.parse(String(rows[0].value));
      if (Array.isArray(parsed)) failedCount = parsed.length;
    } catch {
      // Corrupt value — treat as none.
    }
  }

  return {
    candidateCount: candidates.length,
    doneCount: done.size,
    seenCount: seen.size,
    failedCount,
  };
}

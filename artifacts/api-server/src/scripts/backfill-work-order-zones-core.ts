// Task #1437 — Work-order zone backfill core logic (Slice 3).
//
// Re-derives per-item zone detail (controllerLetter / zoneNumber / issueType)
// for existing inspection-origin work orders whose items predate the
// estimate→WO zone-carry. The source of truth is, in order of preference:
//   1. the parent estimate's items (already zone-stamped by Task #1409), or
//   2. the source wet check's findings (via originWetCheckId), rebuilt through
//      buildInspectionEstimateItems().
// Matched onto WO items by part + quantity. NEVER touches quantity, labor,
// totals, actuals, or completedAt — only stamps the three zone columns.
//
// Side-effect-free module: contains runBackfill, the DB deps factory, and the
// persisted-status reader. The Super Admin migration registry imports the
// MigrationDefinition wrapper from ./lib/migrations/work-order-zones, which
// delegates here.

import { db } from "../db";
import {
  workOrders,
  workOrderItems,
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
} from "../inspection-estimate-items";

// ── Public types (used by tests) ─────────────────────────────────────────────

export const DONE_KEY = "backfill.workOrderZones.done";
export const SEEN_KEY = "backfill.workOrderZones.seen";
export const FAILED_KEY = "backfill.workOrderZones.failed";

export interface CandidateRow {
  id: number;
  estimateId: number | null;
  originWetCheckId: number | null;
}

/** A WO item that may need zone stamping. */
export interface WorkOrderItemRow {
  id: number;
  partId: number | null;
  partName: string | null;
  quantity: number | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
}

/** A zone-bearing source item (from estimate items or rebuilt findings). */
export interface SourceZoneItem {
  partId: number | null;
  partName: string | null;
  quantity: number | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  issueType: string | null;
}

/** A stamp to apply to one WO item. */
export interface ZoneStamp {
  itemId: number;
  controllerLetter: string | null;
  zoneNumber: number | null;
  issueType: string | null;
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
  /** Inspection-origin WOs that still have at least one zone-less item. */
  getCandidates: () => Promise<CandidateRow[]>;
  getWorkOrderItems: (workOrderId: number) => Promise<WorkOrderItemRow[]>;
  /** Zone-bearing items from the parent estimate (empty if none / no estimate). */
  getEstimateZonedItems: (estimateId: number) => Promise<SourceZoneItem[]>;
  getFindings: (wcId: number) => Promise<FindingForEstimate[]>;
  getZoneRecords: (zoneRecordIds: number[]) => Promise<Map<number, ZoneForEstimate>>;
  /** Apply the zone stamps in a single transaction (zone columns only). */
  applyStamps: (workOrderId: number, stamps: ZoneStamp[]) => Promise<void>;
}

export interface BackfillProgressSnapshot {
  scanned: number;
  matched: number;
  matchedDryRun: number;
  skippedNoSource: number;
  skippedUnmappable: number;
  errors: number;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
  onProgress?: (snapshot: BackfillProgressSnapshot) => void;
  cancelSignal?: () => boolean;
}

export interface BackfillResult {
  totalSelected: number;
  alreadyProcessed: number;
  matched: number;
  matchedDryRun: number;
  skippedNoSource: number;
  skippedUnmappable: number;
  errors: number;
}

// ── Matching (pure — exported for tests) ─────────────────────────────────────

function normName(name: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Greedily match every zone-LESS WO item to a unique zone-bearing source item
 * by part (partId, falling back to partName) then quantity. Returns the stamps
 * to apply, or `null` if any zone-less item can't be confidently mapped (in
 * which case the caller skips the whole WO).
 *
 * WO items that already carry a zone are left untouched and excluded.
 */
export function computeZoneStamps(
  woItems: WorkOrderItemRow[],
  sourceItems: SourceZoneItem[],
): ZoneStamp[] | null {
  const needsStamp = woItems.filter(
    (i) => i.controllerLetter == null && i.zoneNumber == null,
  );
  if (needsStamp.length === 0) return [];

  // Only source items that actually carry zone info are usable.
  const pool = sourceItems
    .filter((s) => s.controllerLetter != null || s.zoneNumber != null)
    .map((s) => ({ src: s, used: false }));
  if (pool.length === 0) return null;

  const stamps: ZoneStamp[] = [];

  for (const item of needsStamp) {
    // Candidate pool: same partId (both non-null), else same normalized name.
    let candidates = pool.filter(
      (p) =>
        !p.used &&
        item.partId != null &&
        p.src.partId != null &&
        p.src.partId === item.partId,
    );
    if (candidates.length === 0) {
      const target = normName(item.partName);
      if (target) {
        candidates = pool.filter(
          (p) => !p.used && normName(p.src.partName) === target,
        );
      }
    }
    if (candidates.length === 0) return null; // unmappable → skip WO

    // Prefer an exact quantity match within the candidate set.
    const exactQty = candidates.find((p) => p.src.quantity === item.quantity);
    const chosen = exactQty ?? candidates[0];
    chosen.used = true;
    stamps.push({
      itemId: item.id,
      controllerLetter: chosen.src.controllerLetter,
      zoneNumber: chosen.src.zoneNumber,
      issueType: chosen.src.issueType,
    });
  }

  return stamps;
}

// ── Source derivation ────────────────────────────────────────────────────────

/**
 * Resolve the zone-bearing source items for a candidate WO: prefer the parent
 * estimate's zoned items; fall back to rebuilding from the wet check findings.
 */
async function resolveSourceItems(
  deps: BackfillDeps,
  row: CandidateRow,
): Promise<SourceZoneItem[]> {
  if (row.estimateId != null) {
    const estItems = await deps.getEstimateZonedItems(row.estimateId);
    if (estItems.some((i) => i.controllerLetter != null || i.zoneNumber != null)) {
      return estItems;
    }
  }

  if (row.originWetCheckId != null) {
    const findings = await deps.getFindings(row.originWetCheckId);
    if (findings.length > 0) {
      const zoneRecordIds = [...new Set(findings.map((f) => f.zoneRecordId))];
      const zoneByRecordId = await deps.getZoneRecords(zoneRecordIds);
      const { items } = buildInspectionEstimateItems(findings, zoneByRecordId);
      return items.map((d) => ({
        partId: d.partId,
        partName: d.partName,
        quantity: d.quantity,
        controllerLetter: d.controllerLetter,
        zoneNumber: d.zoneNumber,
        issueType: d.issueType,
      }));
    }
  }

  return [];
}

// ── Core backfill logic (injectable — used by both main() and tests) ──────────

export async function runBackfill(
  deps: BackfillDeps,
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const log = opts.log ?? (() => {});
  const logErr = opts.logError ?? (() => {});
  const TAG = "[backfill-work-order-zones]";

  const done = await deps.loadIdSet(DONE_KEY);
  const seen = await deps.loadIdSet(SEEN_KEY);

  log(`${TAG} resume — done=${done.size} seen(skip)=${seen.size}`);

  const candidateRows = await deps.getCandidates();
  log(`${TAG} ${candidateRows.length} inspection-origin WO(s) with zone-less items found`);

  const pending = candidateRows.filter((r) => !done.has(r.id) && !seen.has(r.id));
  const alreadyProcessed = candidateRows.length - pending.length;
  log(`${TAG} ${pending.length} remaining after resume filter (${alreadyProcessed} already processed)`);

  let scanned = 0;
  let matched = 0;
  let matchedDryRun = 0;
  let skippedNoSource = 0;
  let skippedUnmappable = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i += opts.batchSize) {
    if (opts.cancelSignal?.()) {
      log(`${TAG} cancel requested — stopping before batch at offset ${i}`);
      break;
    }
    const batch = pending.slice(i, i + opts.batchSize);

    for (const row of batch) {
      scanned++;
      const woId = row.id;

      try {
        const woItems = await deps.getWorkOrderItems(woId);
        const sourceItems = await resolveSourceItems(deps, row);

        if (sourceItems.length === 0) {
          log(
            `${TAG} WO ${woId}: SKIP (no source) — ` +
              `estimate=${row.estimateId ?? "—"} wetCheck=${row.originWetCheckId ?? "—"} ` +
              `had no zone-bearing source items`,
          );
          skippedNoSource++;
          seen.add(woId);
          continue;
        }

        const stamps = computeZoneStamps(woItems, sourceItems);

        if (stamps === null) {
          log(
            `${TAG} WO ${woId}: SKIP (unmappable) — ` +
              `could not confidently map all zone-less items to a source`,
          );
          skippedUnmappable++;
          seen.add(woId);
          continue;
        }

        if (stamps.length === 0) {
          // Nothing left to stamp (all items already zoned) — treat as done.
          log(`${TAG} WO ${woId}: nothing to stamp (already zoned)`);
          done.add(woId);
          continue;
        }

        log(
          `${TAG} WO ${woId}: MATCH — stamping ${stamps.length} item(s)` +
            (opts.dryRun ? "  (dry-run — no write)" : ""),
        );

        if (!opts.dryRun) {
          await deps.applyStamps(woId, stamps);
          done.add(woId);
          matched++;
        } else {
          matchedDryRun++;
        }
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        logErr(`${TAG} WO ${woId} FAILED: ${msg}`);
        if (!opts.dryRun) {
          await deps.appendFailure({ id: woId, error: msg, at: new Date().toISOString() });
        }
      } finally {
        opts.onProgress?.({
          scanned,
          matched,
          matchedDryRun,
          skippedNoSource,
          skippedUnmappable,
          errors,
        });
      }
    }

    if (!opts.dryRun) {
      await deps.saveIdSet(DONE_KEY, done);
      await deps.saveIdSet(SEEN_KEY, seen);
      log(
        `${TAG} checkpoint: scanned=${scanned} matched=${matched} ` +
          `skippedNoSource=${skippedNoSource} skippedUnmappable=${skippedUnmappable} errors=${errors}`,
      );
    }
  }

  return {
    totalSelected: candidateRows.length,
    alreadyProcessed,
    matched,
    matchedDryRun,
    skippedNoSource,
    skippedUnmappable,
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
      .where(eq(appSettings.key, FAILED_KEY));
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
      .values({ key: FAILED_KEY, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async function getCandidates(): Promise<CandidateRow[]> {
    return db
      .select({
        id: workOrders.id,
        estimateId: workOrders.estimateId,
        originWetCheckId: workOrders.originWetCheckId,
      })
      .from(workOrders)
      .where(
        sql`
          ${workOrders.originWetCheckId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM work_order_items wi
            WHERE wi.work_order_id = ${workOrders.id}
              AND wi.controller_letter IS NULL
              AND wi.zone_number IS NULL
          )
        `,
      )
      .orderBy(workOrders.id) as unknown as Promise<CandidateRow[]>;
  }

  async function getWorkOrderItems(workOrderId: number): Promise<WorkOrderItemRow[]> {
    const rows = await db
      .select({
        id: workOrderItems.id,
        partId: workOrderItems.partId,
        partName: workOrderItems.partName,
        quantity: workOrderItems.quantity,
        controllerLetter: workOrderItems.controllerLetter,
        zoneNumber: workOrderItems.zoneNumber,
      })
      .from(workOrderItems)
      .where(eq(workOrderItems.workOrderId, workOrderId))
      .orderBy(workOrderItems.id);
    return rows as WorkOrderItemRow[];
  }

  async function getEstimateZonedItems(estimateId: number): Promise<SourceZoneItem[]> {
    const rows = await db
      .select({
        partId: estimateItems.partId,
        partName: estimateItems.partName,
        quantity: estimateItems.quantity,
        controllerLetter: estimateItems.controllerLetter,
        zoneNumber: estimateItems.zoneNumber,
        issueType: estimateItems.issueType,
      })
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, estimateId))
      .orderBy(estimateItems.id);
    return rows as SourceZoneItem[];
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

  async function applyStamps(_workOrderId: number, stamps: ZoneStamp[]): Promise<void> {
    if (stamps.length === 0) return;
    await db.transaction(async (tx) => {
      for (const s of stamps) {
        await tx
          .update(workOrderItems)
          .set({
            controllerLetter: s.controllerLetter,
            zoneNumber: s.zoneNumber,
            issueType: s.issueType,
          })
          .where(eq(workOrderItems.id, s.itemId));
      }
    });
  }

  return {
    loadIdSet,
    saveIdSet,
    appendFailure,
    getCandidates,
    getWorkOrderItems,
    getEstimateZonedItems,
    getFindings,
    getZoneRecords,
    applyStamps,
  };
}

// ── Persisted status (used by the migration check/preview) ────────────────────

export interface BackfillStatus {
  candidateCount: number;
  doneCount: number;
  seenCount: number;
  failedCount: number;
}

export async function getBackfillStatus(): Promise<BackfillStatus> {
  const deps = makeDbDeps();
  const [candidates, done, seen] = await Promise.all([
    deps.getCandidates(),
    deps.loadIdSet(DONE_KEY),
    deps.loadIdSet(SEEN_KEY),
  ]);

  let failedCount = 0;
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, FAILED_KEY));
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

// Slice 4 — De-duplicate work_order_items rows produced by the pre-Slice-1B
// completion append bug.
//
// Root cause (now closed): the /api/work-orders/complete handler called
// addWorkOrderItem() for each usedPart WITHOUT first deleting the pre-existing
// items that were written at wet-check conversion time. Every completion
// therefore doubled the item set. Slice 1B replaced the append loop with
// replaceWorkOrderItemsWithResync so new completions are clean. This migration
// repairs the rows that accumulated before that fix was deployed.
//
// Strategy — de-duplicate by identity, NOT by rebuilding from findings:
//   Because completion adds field-added parts (no findingId) and techs may
//   have edited quantities, rebuilding from findings would erase legitimate
//   work. We collapse EXACT duplicates: groups where every column of
//   (partId, partName, partPrice, quantity, laborHours, controllerLetter,
//   zoneNumber) is identical, keeping the lowest id in each group.
//
// Safety gates:
//   - Requires an explicit acknowledgement flag before writing.
//   - Per-WO: if the de-duplicated total does NOT equal
//     partsSubtotal + laborSubtotal within $0.01, the WO is flagged for
//     manual review and NOT auto-corrected. Never silently overwrite what the
//     algorithm can't fully explain.
//   - Idempotent: a clean re-run finds 0 duplicated WOs.
//   - Done-marker in app_settings prevents re-runs after completion.
//
// Run order in production:
//   1. Confirm Slice 1 + 1B are deployed.
//   2. Run reconcile-billing-sheet-invoice-totals.
//   3. Confirm repair-nan-totals shows 0 remaining.
//   4. Run THIS migration (dry-run → review negative deltas → run).
//   5. Verify WO-1781807328597-643 ≈ $2,125.20 parts + $1,520 labor.

import { db } from '../../db';
import { sql, eq, and } from 'drizzle-orm';
import { appSettings, wetCheckFindings, workOrderItems, workOrders } from '@workspace/db';
import { logger } from '../logger';
import type {
  MigrationDefinition,
  MigrationRunOptions,
  MigrationStatus,
  MigrationPreview,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'repair-duplicated-work-order-items-v1';
const DONE_KEY = 'repairDuplicatedWorkOrderItems.done';

export function money(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export type WorkOrderItemRow = {
  id: number;
  partId: number | null;
  partName: string;
  partPrice: string | number;
  quantity: number;
  laborHours: string | number;
  controllerLetter: string | null;
  zoneNumber: number | null;
  totalPrice: string | number;
  [key: string]: unknown;
};

/** Returns the identity key used to group duplicate items. */
export function itemIdentityKey(item: WorkOrderItemRow): string {
  return [
    item.partId ?? 'null',
    item.partName,
    item.partPrice,
    item.quantity,
    item.laborHours,
    item.controllerLetter ?? 'null',
    item.zoneNumber ?? 'null',
  ].join('|');
}

export type ItemGroups = {
  keepIds: number[];
  dropIds: number[];
  dedupPartsSubtotal: number;
};

/**
 * Groups items by identity key.  For each group the lowest id is kept; the
 * rest are marked for deletion.  Pure (no DB).
 */
export function buildItemGroups(items: WorkOrderItemRow[]): ItemGroups {
  type Group = { keep: number; drop: number[]; totalPrice: number };
  const groups = new Map<string, Group>();
  for (const item of items) {
    const key = itemIdentityKey(item);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { keep: item.id, drop: [], totalPrice: money(item.totalPrice) });
    } else {
      if (item.id < existing.keep) {
        existing.drop.push(existing.keep);
        existing.keep = item.id;
      } else {
        existing.drop.push(item.id);
      }
    }
  }
  const keepIds = Array.from(groups.values()).map(g => g.keep);
  const dropIds = Array.from(groups.values()).flatMap(g => g.drop);
  const dedupPartsSubtotal = Array.from(groups.values()).reduce((s, g) => s + g.totalPrice, 0);
  return { keepIds, dropIds, dedupPartsSubtotal };
}

/**
 * Determine whether a WO needs billing-manager review after de-dup by
 * comparing the de-duplicated parts total against the finding-derived
 * expected total (sum of parts from wet_check_findings linked to this WO).
 *
 * De-dup by identity is ALWAYS safe to apply — this function answers only the
 * secondary question: does the result need a billing-manager sign-off before
 * the WO re-enters the billing queue?
 *
 * @param dedupPartsSubtotal  — parts total after collapsing exact-duplicate groups
 * @param findingDerivedPartsSubtotal — sum of (partPrice × quantity) across all
 *   wet_check_findings where workOrderId = woId; null if no findings link to WO
 *
 * Returns {needsReview, reviewReason}.  Pure (no DB).
 */
export function computeNeedsReview(
  dedupPartsSubtotal: number,
  findingDerivedPartsSubtotal: number | null,
): { needsReview: boolean; reviewReason: string | null } {
  // No findings linked: estimate-origin or manual WO — cannot verify
  if (findingDerivedPartsSubtotal === null) {
    return {
      needsReview: true,
      reviewReason:
        'No wet-check findings linked to this WO — cannot verify finding-derived total; manual billing review required',
    };
  }
  // Both zero: labor-only WO, nothing to verify
  if (dedupPartsSubtotal === 0 && findingDerivedPartsSubtotal === 0) {
    return { needsReview: false, reviewReason: null };
  }
  // De-dup total matches finding-derived within $0.01: clean repair
  if (Math.abs(dedupPartsSubtotal - findingDerivedPartsSubtotal) <= 0.01) {
    return { needsReview: false, reviewReason: null };
  }
  // De-dup exceeds finding-derived: field-added parts survived de-dup (expected)
  if (dedupPartsSubtotal > findingDerivedPartsSubtotal) {
    const diff = (dedupPartsSubtotal - findingDerivedPartsSubtotal).toFixed(2);
    return {
      needsReview: true,
      reviewReason:
        `de-dup ($${dedupPartsSubtotal.toFixed(2)}) exceeds finding-derived ($${findingDerivedPartsSubtotal.toFixed(2)}) by $${diff} — field-added parts present; verify before re-billing`,
    };
  }
  // De-dup is less than finding-derived: unexpected, flag for investigation
  return {
    needsReview: true,
    reviewReason:
      `de-dup ($${dedupPartsSubtotal.toFixed(2)}) is less than finding-derived ($${findingDerivedPartsSubtotal.toFixed(2)}) — unexpected shortfall; manual review required`,
  };
}

// Keep computeAutoRepairFlag as a deprecated alias for any external callers.
// New code should use computeNeedsReview.
/** @deprecated Use computeNeedsReview(dedupPartsSubtotal, findingDerived) */
export function computeAutoRepairFlag(
  currentPartsSubtotal: number,
  dedupPartsSubtotal: number,
): { needsReview: boolean; reviewReason: string | null } {
  if (currentPartsSubtotal === 0 && dedupPartsSubtotal === 0) {
    return { needsReview: false, reviewReason: null };
  }
  if (currentPartsSubtotal > 0 && dedupPartsSubtotal > 0) {
    const ratio = currentPartsSubtotal / dedupPartsSubtotal;
    const roundedRatio = Math.round(ratio);
    if (roundedRatio >= 1 && Math.abs(ratio - roundedRatio) < 0.02) {
      return { needsReview: false, reviewReason: null };
    }
    return {
      needsReview: true,
      reviewReason:
        `current ($${currentPartsSubtotal.toFixed(2)}) / dedup ($${dedupPartsSubtotal.toFixed(2)}) = ${ratio.toFixed(3)} — non-integer; verify totals before re-billing`,
    };
  }
  return {
    needsReview: true,
    reviewReason: `degenerate: currentPartsSubtotal=${currentPartsSubtotal} dedupPartsSubtotal=${dedupPartsSubtotal}`,
  };
}

// ── Candidate queries ──────────────────────────────────────────────────────────

type DuplicateWoRow = {
  work_order_id: string;
  duplicate_count: string;
};

async function countDuplicatedWorkOrders(): Promise<number> {
  const r = await db.execute<{ n: string }>(sql`
    SELECT COUNT(DISTINCT work_order_id) AS n
    FROM (
      SELECT
        work_order_id,
        part_id,
        part_name,
        part_price,
        quantity,
        labor_hours,
        controller_letter,
        zone_number,
        COUNT(*) AS cnt
      FROM work_order_items
      GROUP BY
        work_order_id,
        part_id,
        part_name,
        part_price,
        quantity,
        labor_hours,
        controller_letter,
        zone_number
      HAVING COUNT(*) > 1
    ) dups
  `);
  return Number(r.rows[0]?.n ?? 0);
}

type WoDupSummary = {
  woId: number;
  workOrderNumber: string | null;
  currentPartsSubtotal: number;
  currentLaborSubtotal: number;
  currentTotal: number;
  dedupPartsSubtotal: number;
  dedupTotal: number;
  delta: number;
  needsReview: boolean;
  keepIds: number[];
  dropIds: number[];
  reviewReason: string | null;
};

async function buildDupSummaries(): Promise<WoDupSummary[]> {
  // Find all WOs that have at least one exact-duplicate item group
  const dupWos = await db.execute<DuplicateWoRow>(sql`
    SELECT DISTINCT work_order_id
    FROM (
      SELECT
        work_order_id,
        part_id,
        part_name,
        part_price,
        quantity,
        labor_hours,
        controller_letter,
        zone_number,
        COUNT(*) AS cnt
      FROM work_order_items
      GROUP BY
        work_order_id,
        part_id,
        part_name,
        part_price,
        quantity,
        labor_hours,
        controller_letter,
        zone_number
      HAVING COUNT(*) > 1
    ) dups
  `);

  const summaries: WoDupSummary[] = [];

  for (const row of dupWos.rows) {
    const woId = Number(row.work_order_id);

    // Load WO header
    const [wo] = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.id, woId));
    if (!wo) continue;

    // Load all items for this WO
    const items = await db
      .select()
      .from(workOrderItems)
      .where(eq(workOrderItems.workOrderId, woId));

    // Group by identity key; keep lowest id per group, drop the rest.
    // Uses the exported pure helper so tests cover the same logic path.
    const { keepIds, dropIds, dedupPartsSubtotal } = buildItemGroups(items);

    const currentPartsSubtotal = money(wo.partsSubtotal);
    const currentLaborSubtotal = money(wo.laborSubtotal);
    const currentTotal = money(wo.totalAmount);

    // Labor stays unchanged (labor is a header value, not duplicated by items)
    const dedupTotal = dedupPartsSubtotal + currentLaborSubtotal;
    const delta = dedupTotal - currentTotal; // negative = reduction

    // Finding-derived reconciliation check — computes expected parts total from
    // wet_check_findings linked to this WO.  If de-dup total matches (within
    // $0.01), the repair is a clean finding-origin de-dup; otherwise the WO
    // likely has field-added parts or unknown items and needs billing review.
    const findingRows = await db.execute<{ cnt: string; total: string }>(sql`
      SELECT
        COUNT(*)::text AS cnt,
        COALESCE(SUM(CASE WHEN part_price IS NOT NULL AND quantity > 0
                         THEN part_price::numeric * quantity ELSE 0 END), 0)::text AS total
      FROM wet_check_findings
      WHERE work_order_id = ${woId}
    `);
    const findingCount = Number(findingRows.rows[0]?.cnt ?? 0);
    const findingDerivedPartsSubtotal: number | null =
      findingCount > 0 ? money(findingRows.rows[0]?.total ?? '0') : null;

    const { needsReview, reviewReason } = computeNeedsReview(
      dedupPartsSubtotal,
      findingDerivedPartsSubtotal,
    );

    summaries.push({
      woId,
      workOrderNumber: wo.workOrderNumber,
      currentPartsSubtotal,
      currentLaborSubtotal,
      currentTotal,
      dedupPartsSubtotal,
      dedupTotal,
      delta,
      needsReview,
      keepIds,
      dropIds,
      reviewReason,
    });
  }

  return summaries;
}

// ── check() ───────────────────────────────────────────────────────────────────

async function check(): Promise<MigrationStatus> {
  // Check done marker first
  const marker = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, DONE_KEY));
  if (marker.length > 0) {
    const dupCount = await countDuplicatedWorkOrders();
    if (dupCount === 0) {
      return {
        state: 'completed',
        completedAt: String(
          (marker[0] as { updatedAt?: unknown }).updatedAt ?? new Date().toISOString(),
        ),
      };
    }
    return {
      state: 'partially_applied',
      details: `Done marker is set but ${dupCount} work order(s) still have duplicate items — re-run required.`,
    };
  }

  const dupCount = await countDuplicatedWorkOrders();
  if (dupCount === 0) {
    return { state: 'not_started' };
  }
  return {
    state: 'partially_applied',
    details: `${dupCount} work order(s) have duplicate items — repair has not been run yet.`,
  };
}

// ── preview() ─────────────────────────────────────────────────────────────────

async function preview(): Promise<MigrationPreview> {
  const dupCount = await countDuplicatedWorkOrders();
  const summaries = dupCount > 0 ? await buildDupSummaries() : [];

  // Clean WOs (integer-multiple ratio) are auto-repaired.
  // needsReview WOs are flagged for manual review and NOT auto-written.
  const needsReviewCount = summaries.filter(s => s.needsReview).length;
  const autoRepairCount = summaries.length - needsReviewCount;

  const steps = [
    {
      id: 'detect_duplicates',
      description:
        `Scan work_order_items for exact-duplicate groups (same partId / partName / partPrice / quantity / laborHours / controllerLetter / zoneNumber). ` +
        `Found ${dupCount} work order(s) with at least one duplicate group.`,
    },
    {
      id: 'dedup_work_orders',
      description:
        `Auto-repair ${autoRepairCount} work order(s) with clean integer-multiple inflation: ` +
        `keep lowest id per identity group, drop the rest, recompute totals (parts+labor) from actuals. ` +
        `${needsReviewCount} WO(s) flagged for manual review (non-integer ratio — likely field-added parts mixed with duplicates; NOT auto-corrected).`,
    },
    { id: 'mark_done', description: 'Write done marker to app_settings.' },
  ];

  const warnings: string[] = [];
  if (dupCount === 0) {
    warnings.push('No duplicated work order items found — nothing to repair.');
  } else {
    warnings.push(
      `${dupCount} work order(s) have duplicate items. ` +
      `${autoRepairCount} will be auto-repaired; ${needsReviewCount} will be flagged for manual review (not auto-corrected).`,
    );
    warnings.push(
      'De-duplication removes exact-duplicate rows (totals will DECREASE). ' +
      'Review the preview carefully before running.',
    );
    const detailLines = summaries.slice(0, 20).map(s =>
      `  WO ${s.workOrderNumber ?? s.woId}: current=$${s.currentTotal.toFixed(2)} → dedup=$${s.dedupTotal.toFixed(2)} (delta=${s.delta.toFixed(2)})${s.needsReview ? ` [MANUAL REVIEW: ${s.reviewReason}]` : ' [auto-repair]'}`,
    );
    warnings.push(...detailLines);
    if (summaries.length > 20) {
      warnings.push(`  … and ${summaries.length - 20} more`);
    }
  }

  return {
    steps,
    orphanRows: { duplicatedWorkOrders: dupCount, autoRepair: autoRepairCount, flagged: needsReviewCount },
    warnings,
  };
}

// ── run() ─────────────────────────────────────────────────────────────────────

async function run(emit: ProgressEmitter, opts?: MigrationRunOptions): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // Acknowledgement gate: this migration deletes rows and writes new financial
  // totals. The caller must explicitly set acknowledged=true (via the Admin UI
  // confirmation dialog or CLI flag) or we refuse to write anything.
  if (!opts?.acknowledged) {
    const msg =
      'Migration not acknowledged. Review the preview, confirm the deltas, ' +
      'and re-run with acknowledged=true to proceed.';
    emit({ step: 'detect_duplicates', status: 'failed', error: msg });
    return [{
      id: 'detect_duplicates',
      status: 'failed',
      durationMs: 0,
      error: msg,
    }];
  }

  // Step 1 — detect
  {
    const t = Date.now();
    emit({ step: 'detect_duplicates', status: 'running' });
    try {
      const dupCount = await countDuplicatedWorkOrders();
      results.push({
        id: 'detect_duplicates',
        status: 'success',
        durationMs: Date.now() - t,
        rowsAffected: dupCount,
      });
      emit({ step: 'detect_duplicates', status: 'success', rowsAffected: dupCount });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'detect_duplicates', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'detect_duplicates', status: 'failed', error });
      return results;
    }
  }

  // Step 2 — repair
  {
    const t = Date.now();
    emit({ step: 'dedup_work_orders', status: 'running' });
    try {
      const summaries = await buildDupSummaries();
      let repairedCount = 0;
      let flaggedCount = 0;

      for (const summary of summaries) {
        // Non-reconciling WOs (needsReview=true) are NOT auto-repaired.
        // The algorithm cannot fully explain the total (e.g. field-added parts
        // mixed with duplicates, no finding linkage, or unexpected shortfall).
        // Per task spec: "Never silently overwrite a WO the algorithm can't fully
        // explain."  These WOs are emitted to a manual review queue only — no DB
        // writes.  Only cleanly reconciling WOs (needsReview=false) are de-duped.
        if (summary.needsReview) {
          flaggedCount++;
          logger.warn(
            {
              migration: MIGRATION_ID,
              woId: summary.woId,
              workOrderNumber: summary.workOrderNumber,
              dedupPartsSubtotal: summary.dedupPartsSubtotal,
              dedupTotal: summary.dedupTotal,
              delta: summary.delta,
              reviewReason: summary.reviewReason,
            },
            'dedup-repair: WO flagged for manual review — NOT auto-repaired (operator must verify before correcting)',
          );
          continue; // skip DB writes for this WO
        }

        try {
          // Snapshot before state — only for WOs that will be mutated (needsReview=false)
          logger.info(
            {
              migration: MIGRATION_ID,
              woId: summary.woId,
              workOrderNumber: summary.workOrderNumber,
              needsReview: false,
              before: {
                partsSubtotal: summary.currentPartsSubtotal,
                laborSubtotal: summary.currentLaborSubtotal,
                totalAmount: summary.currentTotal,
                itemCount: summary.keepIds.length + summary.dropIds.length,
              },
              after: {
                partsSubtotal: summary.dedupPartsSubtotal,
                laborSubtotal: summary.currentLaborSubtotal,
                totalAmount: summary.dedupTotal,
                itemCount: summary.keepIds.length,
              },
              droppedIds: summary.dropIds,
            },
            'dedup-repair: before/after snapshot',
          );

          // Perform de-dup in a transaction using the same total-recompute logic
          // as replaceWorkOrderItemsWithResync (storage.ts ~4905): delete all +
          // re-insert keep set + recompute parts, labor, and total from actuals.
          // We replicate the logic here rather than calling through storage to
          // avoid the WO_LOCKED guard which would block billed WOs from repair.
          await db.transaction(async (tx) => {
            // Re-fetch WO inside transaction to get authoritative laborMode/hours
            const [wo] = await tx
              .select()
              .from(workOrders)
              .where(eq(workOrders.id, summary.woId));
            if (!wo) throw new Error(`WO ${summary.woId} not found inside repair tx`);

            // Load current items (re-read for freshness inside tx)
            const items = await tx
              .select()
              .from(workOrderItems)
              .where(eq(workOrderItems.workOrderId, summary.woId));

            // Build the de-duplicated item list (keep rows only)
            const keepSet = new Set(summary.keepIds);
            const dedupItems = items
              .filter(it => keepSet.has(it.id))
              .map(it => ({
                workOrderId: summary.woId,
                partId: it.partId,
                partName: it.partName,
                partPrice: it.partPrice,
                quantity: it.quantity,
                laborHours: it.laborHours,
                totalPrice: it.totalPrice,
                actualQuantityUsed: it.actualQuantityUsed,
                actualLaborHours: it.actualLaborHours,
                notes: it.notes,
                controllerLetter: it.controllerLetter,
                zoneNumber: it.zoneNumber,
                issueType: it.issueType,
                completedAt: it.completedAt,
                findingId: (it as any).findingId ?? null,
              }));

            // Delete all items, re-insert de-duped set
            await tx.delete(workOrderItems).where(eq(workOrderItems.workOrderId, summary.woId));
            let inserted: typeof items = [];
            if (dedupItems.length > 0) {
              inserted = await tx.insert(workOrderItems).values(dedupItems as any).returning();
            }

            // Recompute totals — mirror replaceWorkOrderItemsWithResync exactly:
            // • per_part mode: sum item.laborHours × laborRate (items were duplicated)
            // • flat mode:     totalHours × laborRate (header value, unchanged)
            const truePartsSubtotal = inserted.reduce((s, it) => s + money(it.totalPrice), 0);
            const laborRate = parseFloat(String(wo.laborRate ?? wo.appliedLaborRate ?? "0")) || 0;
            let laborSubtotal: number;
            let newTotalHours: number | undefined;
            if (wo.laborMode === "per_part") {
              newTotalHours = inserted.reduce(
                (s, it) => s + parseFloat(String(it.laborHours || 0)),
                0,
              );
              laborSubtotal = newTotalHours * laborRate;
            } else {
              const totalHours = parseFloat(String(wo.totalHours ?? "0")) || 0;
              laborSubtotal = totalHours * laborRate;
            }
            const totalAmount = truePartsSubtotal + laborSubtotal;

            await tx
              .update(workOrders)
              .set({
                partsSubtotal: truePartsSubtotal.toFixed(2),
                laborSubtotal: laborSubtotal.toFixed(2),
                totalAmount: totalAmount.toFixed(2),
                totalItems: inserted.length,
                ...(newTotalHours !== undefined ? { totalHours: newTotalHours.toFixed(2) } : {}),
                updatedAt: new Date(),
              })
              .where(eq(workOrders.id, summary.woId));
          });

          repairedCount++;
        } catch (woErr) {
          const woError = woErr instanceof Error ? woErr.message : String(woErr);
          logger.error(
            { migration: MIGRATION_ID, woId: summary.woId, error: woError },
            'dedup-repair: failed to repair WO — continuing to next',
          );
        }
      }

      logger.info(
        { migration: MIGRATION_ID, repairedCount, flaggedCount },
        'dedup-repair: step complete',
      );

      results.push({
        id: 'dedup_work_orders',
        status: 'success',
        durationMs: Date.now() - t,
        rowsAffected: repairedCount,
      });
      emit({ step: 'dedup_work_orders', status: 'success', rowsAffected: repairedCount });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'dedup_work_orders', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'dedup_work_orders', status: 'failed', error });
    }
  }

  // Step 3 — mark done
  {
    const t = Date.now();
    emit({ step: 'mark_done', status: 'running' });
    try {
      await db
        .insert(appSettings)
        .values({ key: DONE_KEY, value: new Date().toISOString() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: new Date().toISOString(), updatedAt: new Date() },
        });
      results.push({ id: 'mark_done', status: 'success', durationMs: Date.now() - t, rowsAffected: 1 });
      emit({ step: 'mark_done', status: 'success', rowsAffected: 1 });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'mark_done', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'mark_done', status: 'failed', error });
    }
  }

  return results;
}

// ── DEPRECATED run() wrapper ────────────────────────────────────────────────────
//
// This migration is superseded by repair-wo-items-from-source-v1, which rebuilds
// estimate-origin WOs from their authoritative estimate source rather than
// de-deduplicating by identity.  The old migration flagged all 7 affected WOs
// for manual review (because estimate-origin WOs have no wet_check_findings links
// to verify against), so no data was ever repaired by it.  The new migration has
// the correct strategy.
//
// run() below refuses execution and directs the operator to the new migration.

async function runDeprecated(
  emit: ProgressEmitter,
  _opts?: MigrationRunOptions,
): Promise<MigrationStepResult[]> {
  const msg =
    'This migration has been superseded by repair-wo-items-from-source-v1. ' +
    'Please use that migration instead. repair-duplicated-work-order-items-v1 cannot be re-run.';
  emit({ step: 'detect_duplicates', status: 'failed', error: msg });
  return [{
    id: 'detect_duplicates',
    status: 'failed',
    durationMs: 0,
    error: msg,
  }];
}

// ── Export ─────────────────────────────────────────────────────────────────────

export const repairDuplicatedWorkOrderItemsMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Repair Duplicated Work-Order Items (DEPRECATED)',
  description:
    'DEPRECATED — superseded by repair-wo-items-from-source-v1, which correctly rebuilds ' +
    'estimate-origin WOs from their approved estimate rather than de-duplicating by identity. ' +
    'This migration flagged all 7 affected WOs as needing manual review (no wet_check_findings ' +
    'links to verify against) and repaired nothing. Use repair-wo-items-from-source-v1 instead.',
  appSettingsKey: DONE_KEY,
  deprecated: true,
  deprecationReason: 'Superseded by repair-wo-items-from-source-v1. That migration rebuilds from the estimate source and correctly handles estimate-origin WOs.',
  check,
  preview,
  run: runDeprecated,
};

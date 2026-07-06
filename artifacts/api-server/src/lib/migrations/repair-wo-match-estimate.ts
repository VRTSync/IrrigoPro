// repair-wo-match-estimate.ts — Rebuilds still-flagged, non-billed estimate-origin WOs
// directly from their approved estimate, closing out the WO duplication work.
//
// Context:
//   repair-wo-items-from-source auto-repaired WOs whose de-duped item set exactly matched
//   the estimate (pure duplicate rows, no field-adds, no price drift). WOs that could NOT
//   be auto-repaired (field-adds, price drift, or non-signature-duplicate excess) were left
//   flagged for manual action. This migration provides that action for the unbilled subset:
//   rebuild every flagged, non-billed WO directly from its approved estimate.
//
// Safety gates:
//   - Requires explicit acknowledged=true before any DB writes.
//   - Billed WOs (invoiceId set) are always skipped — they must go through the invoice
//     correction/reissue flow and are excluded from the candidate query.
//   - Per-WO warning when the reduction removes items that are NOT pure duplicates
//     (field-adds or price-drifted rows) — operator must see this before running.
//   - NaN/Infinity guards via money() — any bad total aborts that WO with an error.
//   - Idempotent: after a clean run, re-run finds 0 candidates.
//   - Done-marker in app_settings.repairWoMatchEstimate.done written only when 0 remain.

import { db } from '../../db';
import { sql, eq } from 'drizzle-orm';
import { appSettings, estimateItems, workOrderItems, workOrders } from '@workspace/db';
import { storage } from '../../storage';
import { logger } from '../logger';
import type {
  MigrationDefinition,
  MigrationRunOptions,
  MigrationStatus,
  MigrationPreview,
  MigrationStepResult,
  ProgressEmitter,
} from './types';
import {
  money,
  buildRebuiltItemsFromEstimate,
  reconcileQuantitiesByPartId,
  type WoItemRow,
  type EstimateItemRow,
} from './repair-wo-items-from-source';

const MIGRATION_ID = 'repair-wo-match-estimate-v1';
const DONE_KEY = 'repairWoMatchEstimate.done';

// ── Candidate detection ────────────────────────────────────────────────────────
//
// Targets estimate-origin WOs where item count > estimate item count AND invoiceId IS NULL.
// Billed WOs are excluded at the query level so we never touch them.

type CandidateRow = {
  wo_id: string;
  work_order_number: string | null;
  estimate_id: string;
  wo_item_count: string;
  est_item_count: string;
};

async function findCandidates(): Promise<CandidateRow[]> {
  const r = await db.execute<CandidateRow>(sql`
    SELECT
      wo.id::text                                               AS wo_id,
      wo.work_order_number,
      wo.estimate_id::text,
      (SELECT COUNT(*) FROM work_order_items WHERE work_order_id = wo.id)::text AS wo_item_count,
      (SELECT COUNT(*) FROM estimate_items   WHERE estimate_id   = wo.estimate_id)::text AS est_item_count
    FROM work_orders wo
    WHERE wo.estimate_id IS NOT NULL
      AND wo.invoice_id IS NULL
      AND (
        SELECT COUNT(*) FROM work_order_items WHERE work_order_id = wo.id
      ) > (
        SELECT COUNT(*) FROM estimate_items WHERE estimate_id = wo.estimate_id
      )
    ORDER BY wo.id
  `);
  return r.rows;
}

// ── Per-WO summary ─────────────────────────────────────────────────────────────

type WoRebuildSummary = {
  woId: number;
  workOrderNumber: string | null;
  estimateId: number;
  woItemCount: number;
  estItemCount: number;
  woCurrentTotal: number;
  estTotal: number;
  /** True when the reduction removes non-duplicate items (field-adds or drifted). */
  isNonDuplicateReduction: boolean;
  /** Human-readable description of non-duplicate items being removed. */
  nonDuplicateDetail: string | null;
  estItems: EstimateItemRow[];
};

async function buildWoRebuildSummary(cand: CandidateRow): Promise<WoRebuildSummary | null> {
  const woId = Number(cand.wo_id);
  const estimateId = Number(cand.estimate_id);

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
  if (!wo) return null;

  const [items, estItemRows] = await Promise.all([
    db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, woId)),
    db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId)),
  ]);

  const typedItems = items as unknown as WoItemRow[];
  const typedEstItems = estItemRows as unknown as EstimateItemRow[];

  const qtyRecon = reconcileQuantitiesByPartId(typedItems, typedEstItems);

  const woCurrentTotal = typedItems.reduce((a, wi) => a + money(wi.totalPrice), 0);
  const estTotal = typedEstItems.reduce(
    (a, ei) => a + money(ei.partPrice) * Number(ei.quantity),
    0,
  );

  // Determine whether the reduction removes non-duplicate items.
  // canAutoRepair=false when there are field-adds, price-drifted rows, or overages.
  let isNonDuplicateReduction = false;
  let nonDuplicateDetail: string | null = null;

  if (!qtyRecon.canAutoRepair) {
    isNonDuplicateReduction = true;
    const overageItems = qtyRecon.reconciliation.filter((r) => r.overage !== 0);
    const details: string[] = [];
    if (!qtyRecon.hadDuplicates) {
      details.push('no duplicate signatures detected — item count exceeds estimate for unknown reason');
    } else {
      if (overageItems.length > 0) {
        details.push(
          `qty overages after de-dup: ${overageItems
            .map((r) => `${r.partName}(partId=${r.partId ?? 'null'}) est=${r.estimateQty} actual=${r.dedupedActualQty}`)
            .join('; ')}`,
        );
      }
    }
    nonDuplicateDetail = details.join(' | ') || 'quantity mismatch or field-adds detected';
  }

  return {
    woId,
    workOrderNumber: wo.workOrderNumber ?? null,
    estimateId,
    woItemCount: Number(cand.wo_item_count),
    estItemCount: Number(cand.est_item_count),
    woCurrentTotal,
    estTotal,
    isNonDuplicateReduction,
    nonDuplicateDetail,
    estItems: typedEstItems,
  };
}

// ── check() ───────────────────────────────────────────────────────────────────

async function check(): Promise<MigrationStatus> {
  const marker = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, DONE_KEY));

  if (marker.length > 0) {
    const remaining = await findCandidates();
    if (remaining.length === 0) {
      return {
        state: 'completed',
        completedAt: String(
          (marker[0] as { updatedAt?: unknown }).updatedAt ?? new Date().toISOString(),
        ),
      };
    }
    return {
      state: 'partially_applied',
      details:
        `Done marker is set but ${remaining.length} unbilled estimate-origin WO(s) still ` +
        `have excess items — re-run the migration to repair them.`,
    };
  }

  const candidates = await findCandidates();
  if (candidates.length === 0) {
    return { state: 'not_started' };
  }
  return {
    state: 'partially_applied',
    details:
      `${candidates.length} unbilled estimate-origin WO(s) have more items than their estimate. ` +
      `Run the migration (with acknowledged=true) to rebuild them from their approved estimate.`,
  };
}

// ── preview() ─────────────────────────────────────────────────────────────────

async function preview(): Promise<MigrationPreview> {
  const candidates = await findCandidates();

  const summaries: WoRebuildSummary[] = [];
  for (const cand of candidates) {
    const s = await buildWoRebuildSummary(cand);
    if (s) summaries.push(s);
  }

  const nonDupCount = summaries.filter((s) => s.isNonDuplicateReduction).length;
  const cleanCount = summaries.length - nonDupCount;

  const warnings: string[] = [];

  if (candidates.length === 0) {
    warnings.push('No unbilled candidate WOs found — nothing to rebuild.');
  } else {
    warnings.push(
      `${candidates.length} unbilled estimate-origin WO(s) will be rebuilt from their approved estimate.`,
    );
    warnings.push(
      `${cleanCount} WO(s) are pure-duplicate reductions (safe). ` +
      `${nonDupCount} WO(s) have non-duplicate items being removed — confirm before running.`,
    );
    warnings.push(
      'Rebuild: all current WO items deleted → one row per estimate_item inserted at snapshot price. ' +
      'Header totals resynced. Billed WOs are excluded and listed separately below.',
    );

    for (const s of summaries.slice(0, 30)) {
      const delta = s.estTotal - s.woCurrentTotal;
      const deltaStr = delta >= 0 ? `+$${delta.toFixed(2)}` : `-$${Math.abs(delta).toFixed(2)}`;
      let line =
        `  WO ${s.workOrderNumber ?? s.woId}: ` +
        `items ${s.woItemCount} → ${s.estItemCount} | ` +
        `current=$${s.woCurrentTotal.toFixed(2)} → estimate=$${s.estTotal.toFixed(2)} (${deltaStr})`;
      if (s.isNonDuplicateReduction) {
        line +=
          ` ⚠ NON-DUPLICATE REDUCTION — reduction is non-duplicate items — ` +
          `confirm you intend to bill the estimate, not the actuals. ` +
          `Detail: ${s.nonDuplicateDetail}`;
      }
      warnings.push(line);
    }
    if (summaries.length > 30) {
      warnings.push(`  … and ${summaries.length - 30} more`);
    }
  }

  return {
    steps: [
      {
        id: 'detect_candidates',
        description:
          `Scan work_orders for unbilled estimate-origin WOs where item count > estimate ` +
          `item count (found ${candidates.length}). Billed WOs (invoiceId set) are excluded.`,
      },
      {
        id: 'rebuild_from_estimate',
        description:
          `Rebuild ${candidates.length} WO(s) from their approved estimate: ` +
          `delete all work_order_items, insert one row per estimate_item at snapshot price, ` +
          `recompute header totals via replaceWorkOrderItemsWithResync. ` +
          `${nonDupCount} WO(s) have non-duplicate reductions — requires explicit acknowledgement.`,
      },
      {
        id: 'mark_done',
        description:
          'Write done marker to app_settings.repairWoMatchEstimate.done only when 0 candidates remain.',
      },
    ],
    orphanRows: {
      candidateWorkOrders: candidates.length,
      nonDuplicateReductions: nonDupCount,
    },
    warnings,
  };
}

// ── run() ─────────────────────────────────────────────────────────────────────

async function run(
  emit: ProgressEmitter,
  opts?: MigrationRunOptions,
): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  if (!opts?.acknowledged) {
    const msg =
      'Migration not acknowledged. Review the preview output — pay attention to WOs flagged ' +
      'with NON-DUPLICATE REDUCTION warnings, which indicate items will be removed that are ' +
      'not pure duplicates. Re-run with acknowledged=true once you have confirmed the rebuild ' +
      'is correct for every listed WO.';
    emit({ step: 'detect_candidates', status: 'failed', error: msg });
    return [{ id: 'detect_candidates', status: 'failed', durationMs: 0, error: msg }];
  }

  // Step 1 — detect candidates
  let summaries: WoRebuildSummary[] = [];
  {
    const t = Date.now();
    emit({ step: 'detect_candidates', status: 'running' });
    try {
      const candidates = await findCandidates();
      for (const cand of candidates) {
        const s = await buildWoRebuildSummary(cand);
        if (s) summaries.push(s);
      }
      results.push({
        id: 'detect_candidates',
        status: 'success',
        durationMs: Date.now() - t,
        rowsAffected: summaries.length,
      });
      emit({ step: 'detect_candidates', status: 'success', rowsAffected: summaries.length });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'detect_candidates', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'detect_candidates', status: 'failed', error });
      return results;
    }
  }

  // Step 2 — rebuild from estimate
  let repairedCount = 0;
  let errorCount = 0;
  {
    const t = Date.now();
    emit({ step: 'rebuild_from_estimate', status: 'running' });

    for (const s of summaries) {
      try {
        if (s.isNonDuplicateReduction) {
          logger.warn(
            {
              migration: MIGRATION_ID,
              woId: s.woId,
              workOrderNumber: s.workOrderNumber,
              estimateId: s.estimateId,
              woCurrentTotal: s.woCurrentTotal,
              estTotal: s.estTotal,
              nonDuplicateDetail: s.nonDuplicateDetail,
            },
            'repair-wo-match-estimate: NON-DUPLICATE REDUCTION — rebuilding at operator request; ' +
            'current items include non-duplicate rows beyond the estimate; operator acknowledged',
          );
        }

        logger.info(
          {
            migration: MIGRATION_ID,
            woId: s.woId,
            workOrderNumber: s.workOrderNumber,
            estimateId: s.estimateId,
            before: { itemCount: s.woItemCount, total: s.woCurrentTotal },
            after: { itemCount: s.estItemCount, total: s.estTotal },
            isNonDuplicateReduction: s.isNonDuplicateReduction,
          },
          'repair-wo-match-estimate: rebuilding WO from estimate',
        );

        // Fetch fresh estimate items for the rebuild
        const freshEstItems = await db
          .select()
          .from(estimateItems)
          .where(eq(estimateItems.estimateId, s.estimateId));
        const rebuiltItems = buildRebuiltItemsFromEstimate(
          s.woId,
          freshEstItems as unknown as EstimateItemRow[],
        );

        // null companyId = super_admin access (no company scope filter) — correct for migrations
        await storage.replaceWorkOrderItemsWithResync(s.woId, rebuiltItems as any, null);

        repairedCount++;
        logger.info(
          { migration: MIGRATION_ID, woId: s.woId, workOrderNumber: s.workOrderNumber },
          'repair-wo-match-estimate: WO successfully rebuilt from estimate',
        );
      } catch (woErr) {
        errorCount++;
        const woError = woErr instanceof Error ? woErr.message : String(woErr);
        logger.error(
          { migration: MIGRATION_ID, woId: s.woId, error: woError },
          'repair-wo-match-estimate: per-WO rebuild failed — continuing to next',
        );
      }
    }

    logger.info(
      { migration: MIGRATION_ID, repairedCount, errorCount },
      'repair-wo-match-estimate: rebuild step complete',
    );
    results.push({
      id: 'rebuild_from_estimate',
      status: errorCount > 0 && repairedCount === 0 ? 'failed' : 'success',
      durationMs: Date.now() - t,
      rowsAffected: repairedCount,
      error: errorCount > 0 ? `${errorCount} WO(s) failed — check server logs` : undefined,
    });
    emit({
      step: 'rebuild_from_estimate',
      status: errorCount > 0 && repairedCount === 0 ? 'failed' : 'success',
      rowsAffected: repairedCount,
    });
  }

  // Step 3 — mark done only when 0 candidates remain
  {
    const t = Date.now();
    emit({ step: 'mark_done', status: 'running' });
    try {
      const remaining = await findCandidates();
      if (remaining.length === 0) {
        await db
          .insert(appSettings)
          .values({ key: DONE_KEY, value: new Date().toISOString() })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: new Date().toISOString(), updatedAt: new Date() },
          });
        results.push({
          id: 'mark_done',
          status: 'success',
          durationMs: Date.now() - t,
          rowsAffected: 1,
        });
        emit({ step: 'mark_done', status: 'success', rowsAffected: 1 });
        logger.info(
          { migration: MIGRATION_ID },
          'repair-wo-match-estimate: done marker written — 0 candidates remain',
        );
      } else {
        const msg =
          `${remaining.length} WO(s) still need repair — done marker NOT written. ` +
          `Re-run after resolving the remaining WOs or investigate per-WO errors above.`;
        results.push({
          id: 'mark_done',
          status: 'skipped',
          durationMs: Date.now() - t,
          error: msg,
        });
        emit({ step: 'mark_done', status: 'skipped', error: msg });
        logger.warn({ migration: MIGRATION_ID, remaining: remaining.length }, msg);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'mark_done', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'mark_done', status: 'failed', error });
    }
  }

  return results;
}

// ── Export ────────────────────────────────────────────────────────────────────

export const repairWoMatchEstimateMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Rebuild Flagged WOs to Approved Estimate',
  description:
    'Rebuilds all still-flagged, non-billed estimate-origin work orders directly from their ' +
    'approved estimate. Deletes all current WO items and inserts one row per estimate_item at ' +
    'the snapshot price. Billed WOs (invoiceId set) are excluded. WOs with non-duplicate ' +
    'reductions (field-adds or price-drifted rows) require acknowledged=true and are logged ' +
    'with a prominent warning. Done marker written only when 0 unbilled candidates remain.',
  appSettingsKey: DONE_KEY,
  check,
  preview,
  run,
};

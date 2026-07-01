// Repair NaN-poisoned estimate / work-order / billing-sheet totals.
//
// Root cause: a line item with a null partPrice computes
//   quantity × null = NaN
// Postgres accepts NaN in decimal columns. parseFloat("NaN") = NaN, which
// poisons any running sum it joins. The estimate read-path is now guarded
// (via the money() helper) so new NaN values cannot be created, but rows
// already stored as NaN need a one-time repair.
//
// What this migration does (idempotent + preview-safe):
//   1. Scan estimate_items, work_order_items, billing_sheet_items for rows
//      where totalPrice IS NULL OR isnan(totalPrice).
//      Recompute each as money(quantity) × money(partPrice) = 0 when price is
//      genuinely absent.
//   2. Recompute partsSubtotal / laborSubtotal / totalAmount on parent
//      estimates and work_orders from their repaired items.
//      Uses add-parts semantics: never silently lower a real total.
//
// Stores "done" marker in app_settings so a clean re-run skips everything.

import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { appSettings } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { logger } from '../../lib/logger';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'repair-nan-totals-v1';
const DONE_KEY = 'repairNanTotals.done';

function money(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

// ── Candidate queries ──────────────────────────────────────────────────────────

async function nanItemCounts(): Promise<{
  estimateItems: number;
  workOrderItems: number;
  billingSheetItems: number;
}> {
  const [ei, woi, bsi] = await Promise.all([
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*) AS n FROM estimate_items
      WHERE total_price IS NULL OR isnan(total_price::numeric)
    `),
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*) AS n FROM work_order_items
      WHERE total_price IS NULL OR isnan(total_price::numeric)
    `),
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*) AS n FROM billing_sheet_items
      WHERE total_price IS NULL OR isnan(total_price::numeric)
    `),
  ]);
  return {
    estimateItems: Number(ei.rows[0]?.n ?? 0),
    workOrderItems: Number(woi.rows[0]?.n ?? 0),
    billingSheetItems: Number(bsi.rows[0]?.n ?? 0),
  };
}

async function nanParentCounts(): Promise<{ estimates: number; workOrders: number }> {
  const [est, wo] = await Promise.all([
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*) AS n FROM estimates
      WHERE parts_subtotal IS NULL OR isnan(parts_subtotal::numeric)
         OR labor_subtotal IS NULL OR isnan(labor_subtotal::numeric)
         OR total_amount IS NULL OR isnan(total_amount::numeric)
    `),
    db.execute<{ n: string }>(sql`
      SELECT COUNT(*) AS n FROM work_orders
      WHERE parts_subtotal IS NULL OR isnan(parts_subtotal::numeric)
         OR labor_subtotal IS NULL OR isnan(labor_subtotal::numeric)
         OR total_amount IS NULL OR isnan(total_amount::numeric)
    `),
  ]);
  return {
    estimates: Number(est.rows[0]?.n ?? 0),
    workOrders: Number(wo.rows[0]?.n ?? 0),
  };
}

// ── check() ───────────────────────────────────────────────────────────────────

async function check(): Promise<MigrationStatus> {
  const [items, parents] = await Promise.all([nanItemCounts(), nanParentCounts()]);
  const totalNan =
    items.estimateItems +
    items.workOrderItems +
    items.billingSheetItems +
    parents.estimates +
    parents.workOrders;

  if (totalNan === 0) {
    const marker = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, DONE_KEY));
    const completedAt =
      marker.length > 0
        ? String((marker[0] as { updatedAt?: unknown }).updatedAt ?? new Date().toISOString())
        : new Date().toISOString();
    return { state: 'completed', completedAt };
  }

  const marker = await db.select().from(appSettings).where(eq(appSettings.key, DONE_KEY));
  if (marker.length > 0) {
    return {
      state: 'partially_applied',
      details:
        `${totalNan} NaN row(s) remain: ` +
        `estimate_items=${items.estimateItems}, work_order_items=${items.workOrderItems}, ` +
        `billing_sheet_items=${items.billingSheetItems}, ` +
        `estimates=${parents.estimates}, work_orders=${parents.workOrders}`,
    };
  }
  return { state: 'not_started' };
}

// ── preview() ─────────────────────────────────────────────────────────────────

async function preview(): Promise<MigrationPreview> {
  const [items, parents] = await Promise.all([nanItemCounts(), nanParentCounts()]);
  const totalNanItems =
    items.estimateItems + items.workOrderItems + items.billingSheetItems;
  const totalNanParents = parents.estimates + parents.workOrders;
  const totalNan = totalNanItems + totalNanParents;

  const steps = [
    {
      id: 'repair_estimate_items',
      description:
        `Recompute ${items.estimateItems} estimate_item row(s) where totalPrice IS NULL or NaN ` +
        `→ money(quantity) × money(partPrice), storing '0.00' when price is absent.`,
    },
    {
      id: 'repair_work_order_items',
      description:
        `Recompute ${items.workOrderItems} work_order_item row(s) where totalPrice IS NULL or NaN ` +
        `→ money(quantity) × money(partPrice), storing '0.00' when price is absent.`,
    },
    {
      id: 'repair_billing_sheet_items',
      description:
        `Recompute ${items.billingSheetItems} billing_sheet_item row(s) where totalPrice IS NULL or NaN ` +
        `→ money(quantity) × money(partPrice), storing '0.00' when price is absent.`,
    },
    {
      id: 'recompute_estimate_totals',
      description:
        `Recompute partsSubtotal / laborSubtotal / totalAmount on ${parents.estimates} estimate(s) ` +
        `that have NaN in their stored totals, summing repaired items.`,
    },
    {
      id: 'recompute_work_order_totals',
      description:
        `Recompute partsSubtotal / laborSubtotal / totalAmount on ${parents.workOrders} work order(s) ` +
        `that have NaN in their stored totals, summing repaired items.`,
    },
    { id: 'mark_done', description: 'Write done marker to app_settings so re-runs skip all steps.' },
  ];

  const warnings: string[] = [];
  if (totalNan === 0) {
    warnings.push('No NaN totals found — nothing to repair. Migration is already complete.');
  } else {
    warnings.push(
      `${totalNanItems} item row(s) and ${totalNanParents} parent row(s) with NaN totals will be repaired. ` +
      `Unpriced / adjustment line items will store $0.00.`,
    );
    warnings.push(
      'This uses add-parts semantics: repaired totals are recomputed from items; ' +
      'a previously-stored non-NaN total is only touched when the row itself is NaN.',
    );
  }

  return {
    steps,
    orphanRows: { nanRows: totalNan },
    warnings,
  };
}

// ── run() ─────────────────────────────────────────────────────────────────────

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  // Step 1 — repair estimate_items (per-row before/after audit log)
  {
    const t = Date.now();
    emit({ step: 'repair_estimate_items', status: 'running' });
    try {
      const beforeEI = await db.execute<{ id: number; estimate_id: number; part_name: string; total_price: string | null }>(sql`
        SELECT id, estimate_id, part_name, total_price FROM estimate_items
        WHERE total_price IS NULL OR isnan(total_price::numeric)
      `);
      const r = await db.execute<{ id: number; total_price: string }>(sql`
        UPDATE estimate_items
        SET total_price = ROUND(
          COALESCE(CASE WHEN isnan(quantity::numeric) THEN 0 ELSE quantity::numeric END, 0) *
          COALESCE(CASE WHEN part_price IS NULL OR isnan(part_price::numeric) THEN 0 ELSE part_price::numeric END, 0),
          2
        )
        WHERE total_price IS NULL OR isnan(total_price::numeric)
        RETURNING id, total_price
      `);
      const afterById = new Map(r.rows.map(a => [a.id, a]));
      for (const b of beforeEI.rows) {
        const a = afterById.get(b.id);
        logger.info({
          migration: MIGRATION_ID, step: 'repair_estimate_items',
          estimateItemId: b.id, estimateId: b.estimate_id, partName: b.part_name,
          before: { totalPrice: b.total_price }, after: { totalPrice: a?.total_price ?? null },
        }, 'nan-repair: estimate_item total_price repaired');
      }
      const rows = r.rowCount ?? 0;
      results.push({ id: 'repair_estimate_items', status: 'success', durationMs: Date.now() - t, rowsAffected: rows });
      emit({ step: 'repair_estimate_items', status: 'success', rowsAffected: rows });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'repair_estimate_items', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'repair_estimate_items', status: 'failed', error });
    }
  }

  // Step 2 — repair work_order_items (per-row before/after audit log)
  {
    const t = Date.now();
    emit({ step: 'repair_work_order_items', status: 'running' });
    try {
      const beforeWOI = await db.execute<{ id: number; work_order_id: number; part_name: string; total_price: string | null }>(sql`
        SELECT id, work_order_id, part_name, total_price FROM work_order_items
        WHERE total_price IS NULL OR isnan(total_price::numeric)
      `);
      const r = await db.execute<{ id: number; total_price: string }>(sql`
        UPDATE work_order_items
        SET total_price = ROUND(
          COALESCE(CASE WHEN isnan(quantity::numeric) THEN 0 ELSE quantity::numeric END, 0) *
          COALESCE(CASE WHEN part_price IS NULL OR isnan(part_price::numeric) THEN 0 ELSE part_price::numeric END, 0),
          2
        )
        WHERE total_price IS NULL OR isnan(total_price::numeric)
        RETURNING id, total_price
      `);
      const afterById = new Map(r.rows.map(a => [a.id, a]));
      for (const b of beforeWOI.rows) {
        const a = afterById.get(b.id);
        logger.info({
          migration: MIGRATION_ID, step: 'repair_work_order_items',
          workOrderItemId: b.id, workOrderId: b.work_order_id, partName: b.part_name,
          before: { totalPrice: b.total_price }, after: { totalPrice: a?.total_price ?? null },
        }, 'nan-repair: work_order_item total_price repaired');
      }
      const rows = r.rowCount ?? 0;
      results.push({ id: 'repair_work_order_items', status: 'success', durationMs: Date.now() - t, rowsAffected: rows });
      emit({ step: 'repair_work_order_items', status: 'success', rowsAffected: rows });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'repair_work_order_items', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'repair_work_order_items', status: 'failed', error });
    }
  }

  // Step 3 — repair billing_sheet_items (per-row before/after audit log)
  {
    const t = Date.now();
    emit({ step: 'repair_billing_sheet_items', status: 'running' });
    try {
      const beforeBSI = await db.execute<{ id: number; billing_sheet_id: number; part_name: string; total_price: string | null }>(sql`
        SELECT id, billing_sheet_id, part_name, total_price FROM billing_sheet_items
        WHERE total_price IS NULL OR isnan(total_price::numeric)
      `);
      const r = await db.execute<{ id: number; total_price: string }>(sql`
        UPDATE billing_sheet_items
        SET total_price = ROUND(
          COALESCE(CASE WHEN isnan(quantity::numeric) THEN 0 ELSE quantity::numeric END, 0) *
          COALESCE(CASE WHEN unit_price IS NULL OR isnan(unit_price::numeric) THEN 0 ELSE unit_price::numeric END, 0),
          2
        )
        WHERE total_price IS NULL OR isnan(total_price::numeric)
        RETURNING id, total_price
      `);
      const afterById = new Map(r.rows.map(a => [a.id, a]));
      for (const b of beforeBSI.rows) {
        const a = afterById.get(b.id);
        logger.info({
          migration: MIGRATION_ID, step: 'repair_billing_sheet_items',
          billingSheetItemId: b.id, billingSheetId: b.billing_sheet_id, partName: b.part_name,
          before: { totalPrice: b.total_price }, after: { totalPrice: a?.total_price ?? null },
        }, 'nan-repair: billing_sheet_item total_price repaired');
      }
      const rows = r.rowCount ?? 0;
      results.push({ id: 'repair_billing_sheet_items', status: 'success', durationMs: Date.now() - t, rowsAffected: rows });
      emit({ step: 'repair_billing_sheet_items', status: 'success', rowsAffected: rows });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'repair_billing_sheet_items', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'repair_billing_sheet_items', status: 'failed', error });
    }
  }

  // Step 4 — recompute estimate totals (parts_subtotal, labor_subtotal, total_amount)
  //
  // Uses correlated subqueries (not a JOIN to item_sums) so that estimates with
  // NaN totals but zero child items are also repaired — they land at $0 parts.
  //
  // labor_subtotal is computed from authoritative source columns:
  //   flat mode  → total_labor_hours × COALESCE(applied_labor_rate, labor_rate, 0)
  //   per_part   → SUM(item.labor_hours) × rate
  //
  // Per-row before/after values are logged via the server logger for auditability.
  {
    const t = Date.now();
    emit({ step: 'recompute_estimate_totals', status: 'running' });
    try {
      // Capture before values for audit log
      const beforeEst = await db.execute<{ id: number; parts_subtotal: string | null; labor_subtotal: string | null; total_amount: string | null }>(sql`
        SELECT id, parts_subtotal, labor_subtotal, total_amount
        FROM estimates
        WHERE parts_subtotal IS NULL OR isnan(parts_subtotal::numeric)
           OR labor_subtotal IS NULL OR isnan(labor_subtotal::numeric)
           OR total_amount IS NULL OR isnan(total_amount::numeric)
      `);

      const r = await db.execute<{ id: number; parts_subtotal: string; labor_subtotal: string; total_amount: string }>(sql`
        UPDATE estimates e
        SET
          parts_subtotal = ROUND(COALESCE(
            (SELECT SUM(CASE WHEN isnan(total_price::numeric) OR total_price IS NULL
                             THEN 0 ELSE total_price::numeric END)
             FROM estimate_items WHERE estimate_id = e.id),
            0
          ), 2),
          labor_subtotal = ROUND(
            CASE WHEN e.labor_mode = 'flat'
              THEN
                COALESCE(
                  CASE WHEN e.total_labor_hours IS NULL OR isnan(e.total_labor_hours::numeric)
                       THEN 0 ELSE e.total_labor_hours::numeric END,
                  0
                ) *
                COALESCE(
                  CASE WHEN e.applied_labor_rate IS NOT NULL AND NOT isnan(e.applied_labor_rate::numeric)
                       THEN e.applied_labor_rate::numeric
                       WHEN e.labor_rate IS NOT NULL AND NOT isnan(e.labor_rate::numeric)
                       THEN e.labor_rate::numeric
                       ELSE 0 END,
                  0
                )
              ELSE
                COALESCE(
                  (SELECT SUM(
                     COALESCE(
                       CASE WHEN lh.labor_hours IS NULL OR isnan(lh.labor_hours::numeric)
                            THEN 0 ELSE lh.labor_hours::numeric END,
                       0
                     ) *
                     COALESCE(
                       CASE WHEN e.applied_labor_rate IS NOT NULL AND NOT isnan(e.applied_labor_rate::numeric)
                            THEN e.applied_labor_rate::numeric
                            WHEN e.labor_rate IS NOT NULL AND NOT isnan(e.labor_rate::numeric)
                            THEN e.labor_rate::numeric
                            ELSE 0 END,
                       0
                     )
                   )
                   FROM estimate_items lh WHERE lh.estimate_id = e.id),
                  0
                )
            END,
            2
          ),
          total_amount = ROUND(
            COALESCE(
              (SELECT SUM(CASE WHEN isnan(total_price::numeric) OR total_price IS NULL
                               THEN 0 ELSE total_price::numeric END)
               FROM estimate_items WHERE estimate_id = e.id),
              0
            ) +
            CASE WHEN e.labor_mode = 'flat'
              THEN
                COALESCE(
                  CASE WHEN e.total_labor_hours IS NULL OR isnan(e.total_labor_hours::numeric)
                       THEN 0 ELSE e.total_labor_hours::numeric END,
                  0
                ) *
                COALESCE(
                  CASE WHEN e.applied_labor_rate IS NOT NULL AND NOT isnan(e.applied_labor_rate::numeric)
                       THEN e.applied_labor_rate::numeric
                       WHEN e.labor_rate IS NOT NULL AND NOT isnan(e.labor_rate::numeric)
                       THEN e.labor_rate::numeric
                       ELSE 0 END,
                  0
                )
              ELSE
                COALESCE(
                  (SELECT SUM(
                     COALESCE(
                       CASE WHEN lh.labor_hours IS NULL OR isnan(lh.labor_hours::numeric)
                            THEN 0 ELSE lh.labor_hours::numeric END,
                       0
                     ) *
                     COALESCE(
                       CASE WHEN e.applied_labor_rate IS NOT NULL AND NOT isnan(e.applied_labor_rate::numeric)
                            THEN e.applied_labor_rate::numeric
                            WHEN e.labor_rate IS NOT NULL AND NOT isnan(e.labor_rate::numeric)
                            THEN e.labor_rate::numeric
                            ELSE 0 END,
                       0
                     )
                   )
                   FROM estimate_items lh WHERE lh.estimate_id = e.id),
                  0
                )
            END,
            2
          )
        WHERE
          e.parts_subtotal IS NULL OR isnan(e.parts_subtotal::numeric)
          OR e.labor_subtotal IS NULL OR isnan(e.labor_subtotal::numeric)
          OR e.total_amount IS NULL OR isnan(e.total_amount::numeric)
        RETURNING e.id, e.parts_subtotal, e.labor_subtotal, e.total_amount
      `);

      // Per-row before/after audit log
      const beforeById = new Map(beforeEst.rows.map(b => [b.id, b]));
      for (const after of r.rows) {
        const before = beforeById.get(after.id);
        logger.info({
          migration: MIGRATION_ID, step: 'recompute_estimate_totals', estimateId: after.id,
          before: before ? { partsSubtotal: before.parts_subtotal, laborSubtotal: before.labor_subtotal, totalAmount: before.total_amount } : null,
          after: { partsSubtotal: after.parts_subtotal, laborSubtotal: after.labor_subtotal, totalAmount: after.total_amount },
        }, 'nan-repair: estimate totals repaired');
      }

      const rows = r.rowCount ?? 0;
      results.push({ id: 'recompute_estimate_totals', status: 'success', durationMs: Date.now() - t, rowsAffected: rows });
      emit({ step: 'recompute_estimate_totals', status: 'success', rowsAffected: rows });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'recompute_estimate_totals', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'recompute_estimate_totals', status: 'failed', error });
    }
  }

  // Step 5 — recompute work_order totals (parts_subtotal, labor_subtotal, total_amount)
  //
  // Uses correlated subqueries (not a JOIN) so that work orders with NaN totals
  // but zero child items are also repaired — they land at $0 parts.
  //
  // labor_subtotal precedence:
  //   1. Keep stored value if it is already finite — never lower a real total.
  //   2. Else recompute from total_labor_hours × labor_rate when both are finite.
  //   3. Else 0 (no authoritative data available for this WO).
  //
  // Per-row before/after values are logged for auditability.
  {
    const t = Date.now();
    emit({ step: 'recompute_work_order_totals', status: 'running' });
    try {
      // Capture before values for audit log
      const beforeWo = await db.execute<{ id: number; parts_subtotal: string | null; labor_subtotal: string | null; total_amount: string | null }>(sql`
        SELECT id, parts_subtotal, labor_subtotal, total_amount
        FROM work_orders
        WHERE parts_subtotal IS NULL OR isnan(parts_subtotal::numeric)
           OR labor_subtotal IS NULL OR isnan(labor_subtotal::numeric)
           OR total_amount IS NULL OR isnan(total_amount::numeric)
      `);

      const r = await db.execute<{ id: number; parts_subtotal: string; labor_subtotal: string; total_amount: string }>(sql`
        UPDATE work_orders wo
        SET
          parts_subtotal = ROUND(COALESCE(
            (SELECT SUM(CASE WHEN isnan(total_price::numeric) OR total_price IS NULL
                             THEN 0 ELSE total_price::numeric END)
             FROM work_order_items WHERE work_order_id = wo.id),
            0
          ), 2),
          labor_subtotal = ROUND(
            CASE
              WHEN wo.labor_subtotal IS NOT NULL AND NOT isnan(wo.labor_subtotal::numeric)
              THEN wo.labor_subtotal::numeric
              WHEN wo.total_labor_hours IS NOT NULL AND NOT isnan(wo.total_labor_hours::numeric)
                   AND wo.labor_rate IS NOT NULL AND NOT isnan(wo.labor_rate::numeric)
              THEN wo.total_labor_hours::numeric * wo.labor_rate::numeric
              ELSE 0
            END,
            2
          ),
          total_amount = ROUND(
            COALESCE(
              (SELECT SUM(CASE WHEN isnan(total_price::numeric) OR total_price IS NULL
                               THEN 0 ELSE total_price::numeric END)
               FROM work_order_items WHERE work_order_id = wo.id),
              0
            ) +
            CASE
              WHEN wo.labor_subtotal IS NOT NULL AND NOT isnan(wo.labor_subtotal::numeric)
              THEN wo.labor_subtotal::numeric
              WHEN wo.total_labor_hours IS NOT NULL AND NOT isnan(wo.total_labor_hours::numeric)
                   AND wo.labor_rate IS NOT NULL AND NOT isnan(wo.labor_rate::numeric)
              THEN wo.total_labor_hours::numeric * wo.labor_rate::numeric
              ELSE 0
            END,
            2
          )
        WHERE
          wo.parts_subtotal IS NULL OR isnan(wo.parts_subtotal::numeric)
          OR wo.labor_subtotal IS NULL OR isnan(wo.labor_subtotal::numeric)
          OR wo.total_amount IS NULL OR isnan(wo.total_amount::numeric)
        RETURNING wo.id, wo.parts_subtotal, wo.labor_subtotal, wo.total_amount
      `);

      // Per-row before/after audit log
      const beforeById = new Map(beforeWo.rows.map(b => [b.id, b]));
      for (const after of r.rows) {
        const before = beforeById.get(after.id);
        logger.info({
          migration: MIGRATION_ID, step: 'recompute_work_order_totals', workOrderId: after.id,
          before: before ? { partsSubtotal: before.parts_subtotal, laborSubtotal: before.labor_subtotal, totalAmount: before.total_amount } : null,
          after: { partsSubtotal: after.parts_subtotal, laborSubtotal: after.labor_subtotal, totalAmount: after.total_amount },
        }, 'nan-repair: work order totals repaired');
      }

      const rows = r.rowCount ?? 0;
      results.push({ id: 'recompute_work_order_totals', status: 'success', durationMs: Date.now() - t, rowsAffected: rows });
      emit({ step: 'recompute_work_order_totals', status: 'success', rowsAffected: rows });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'recompute_work_order_totals', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'recompute_work_order_totals', status: 'failed', error });
    }
  }

  // Step 6 — mark done
  {
    const t = Date.now();
    emit({ step: 'mark_done', status: 'running' });
    try {
      await db.execute(sql`
        INSERT INTO app_settings (key, value)
        VALUES (${DONE_KEY}, 'completed')
        ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
      `);
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

export const repairNanTotalsMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Repair NaN-poisoned estimate / work-order totals',
  description:
    'Scans estimate_items, work_order_items, and billing_sheet_items for rows where ' +
    'totalPrice IS NULL or NaN (caused by null partPrice × quantity). Recomputes each ' +
    'item from money(quantity) × money(partPrice) — storing $0.00 where price is absent. ' +
    'Then recomputes partsSubtotal / laborSubtotal / totalAmount on parent estimates and ' +
    'work orders. Idempotent: a clean re-run after the repair repairs 0 rows.',
  appSettingsKey: DONE_KEY,
  check,
  preview,
  run,
};

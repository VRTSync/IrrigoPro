// Task #1434 — Run the billing-sheet / invoice total reconcile from Super Admin.
//
// Wires the existing reconcile core (Task #1422) into the admin migrations
// framework so a super admin can preview the drift set and run the repair
// from /admin/migrations. The repair math + orchestration live in
// scripts/reconcile-billing-sheet-invoice-totals-core.ts and the Postgres
// deps in scripts/reconcile-billing-sheet-invoice-totals-db.ts — this module
// only adapts them into the MigrationDefinition contract. The standalone CLI
// (scripts/reconcile-billing-sheet-invoice-totals.ts) still works and shares
// the same core + deps.
//
// IMPORTANT — this changes money. The reconcile uses add-parts semantics:
// when a sheet's stored total is too low, the missing-parts delta is folded
// into the parent invoice's total — i.e. the customer is billed more. The
// preview surfaces this via the framework's acknowledgement gate (orphanRows
// > 0 forces the operator to acknowledge before Run is enabled).

import { db } from '../../db';
import { eq, sql } from 'drizzle-orm';
import { appSettings } from '@workspace/db';
import {
  runReconciliation,
  computeSheetRepair,
  RECONCILE_DONE_KEY,
  type DriftedSheetRow,
  type ReconciliationDeps,
  type SheetRepair,
} from '../../scripts/reconcile-billing-sheet-invoice-totals-core';
import { createReconcileDbDeps, getReconcileCandidates } from '../../scripts/reconcile-billing-sheet-invoice-totals-db';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStep,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

const MIGRATION_ID = 'reconcile-billing-sheet-invoice-totals-v1';

function money(val: string | null): string {
  const n = parseFloat(String(val ?? 0));
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

async function check(): Promise<MigrationStatus> {
  // The drift query is the source of truth: zero drifted sheets means the
  // repair is complete (or was never needed). A non-empty done set with
  // remaining drift means a prior run is partially applied.
  const candidates = await getReconcileCandidates();
  if (candidates.length === 0) {
    const marker = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, RECONCILE_DONE_KEY));
    const completedAt = marker.length > 0 ? String((marker[0] as { updatedAt?: unknown }).updatedAt ?? '') : '';
    return { state: 'completed', completedAt };
  }

  const marker = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, RECONCILE_DONE_KEY));
  if (marker.length > 0) {
    return {
      state: 'partially_applied',
      details: `${candidates.length} invoiced billing sheet(s) still drift from their stored total`,
    };
  }
  return { state: 'not_started' };
}

async function preview(): Promise<MigrationPreview> {
  const candidates = await getReconcileCandidates();
  // We need the current invoice totals to show the post-repair "new total".
  // Read them read-only (no mutation) for each affected invoice.
  const invoiceTotals = await loadInvoiceTotals(candidates);
  return buildReconcilePreview(candidates, invoiceTotals);
}

/**
 * Pure preview mapping (no DB) — given the drifted candidate set and the
 * current invoice totals, produce the framework `MigrationPreview`: one step
 * per repairable sheet (with delta + new invoice total), a summary warning,
 * the money-change acknowledgement warning, and the orphan/ack count set to
 * the number of invoices whose total will change. Mutates nothing.
 */
export function buildReconcilePreview(
  candidates: DriftedSheetRow[],
  invoiceTotals: Map<number, number>,
): MigrationPreview {
  const steps: MigrationStep[] = [];
  const affectedInvoices = new Set<number>();
  let totalDelta = 0;

  for (const row of candidates) {
    const repair = computeSheetRepair(row);
    if (!repair) continue; // reconciles within tolerance — not a real candidate
    affectedInvoices.add(row.invoiceId);
    totalDelta += repair.delta;
    const oldInvTotal = invoiceTotals.get(row.invoiceId) ?? 0;
    const newInvTotal = oldInvTotal + repair.delta;
    steps.push({
      id: `sheet_${row.id}`,
      description:
        `Billing sheet #${row.id} → invoice #${row.invoiceId}: ` +
        `parts + labor = $${money(row.partsSubtotal)} + $${money(row.laborSubtotal)} ` +
        `= $${repair.newSheetTotal.toFixed(2)} (stored $${money(row.totalAmount)}, ` +
        `delta +$${repair.delta.toFixed(2)}). ` +
        `Invoice total $${oldInvTotal.toFixed(2)} → $${newInvTotal.toFixed(2)}.`,
    });
  }

  const warnings: string[] = [];
  const repairCount = steps.length;
  if (repairCount === 0) {
    warnings.push('No invoiced billing sheets drift from their stored total — nothing to repair.');
  } else {
    warnings.push(
      `${repairCount} billing sheet(s) · ${affectedInvoices.size} invoice(s) · ` +
      `total +$${totalDelta.toFixed(2)} to customers.`,
    );
    warnings.push(
      'Add-parts semantics: each missing-parts delta is folded into the parent ' +
      'invoice total — these customers will be billed MORE. Acknowledge to proceed.',
    );
  }

  // The framework forces acknowledgement when any orphanRows value > 0. We
  // repurpose it as the "invoices that will change total" count so Run stays
  // disabled until the operator acknowledges the money change.
  return {
    steps,
    orphanRows: { invoicesAffected: affectedInvoices.size },
    warnings,
  };
}

/**
 * Read-only fetch of current `totalAmount` for every invoice referenced by the
 * candidate set, so the preview can show the post-repair invoice total without
 * mutating anything.
 */
async function loadInvoiceTotals(candidates: DriftedSheetRow[]): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  const ids = Array.from(new Set(candidates.map((c) => c.invoiceId))).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return totals;
  const rows = await db.execute<{ id: number; total_amount: string | null }>(sql`
    SELECT id, total_amount FROM invoices WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  for (const r of rows.rows) {
    const n = parseFloat(String(r.total_amount ?? 0));
    totals.set(Number(r.id), Number.isFinite(n) ? n : 0);
  }
  return totals;
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  return runReconcileMigration(createReconcileDbDeps(), emit);
}

/**
 * Deps-injectable runner (no hard DB binding) — drives the reconcile core in
 * apply mode and translates its per-sheet work into `emit(...)` progress events
 * plus the returned `MigrationStepResult[]`. The production `run()` injects the
 * Postgres deps; tests inject in-memory deps. Re-throwing inside the wrapped
 * `applyRepair` lets the core record the failure and continue with remaining
 * sheets (partial-failure surfaces as a failed step).
 */
export async function runReconcileMigration(
  baseDeps: ReconciliationDeps,
  emit: ProgressEmitter,
): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];

  const deps: ReconciliationDeps = {
    ...baseDeps,
    applyRepair: async (row: DriftedSheetRow, repair: SheetRepair) => {
      const t = Date.now();
      emit({ step: `sheet_${row.id}`, status: 'running' });
      try {
        await baseDeps.applyRepair(row, repair);
        results.push({ id: `sheet_${row.id}`, status: 'success', durationMs: Date.now() - t, rowsAffected: 1 });
        emit({ step: `sheet_${row.id}`, status: 'success', rowsAffected: 1 });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({ id: `sheet_${row.id}`, status: 'failed', durationMs: Date.now() - t, error });
        emit({ step: `sheet_${row.id}`, status: 'failed', error });
        throw err;
      }
    },
  };

  const t = Date.now();
  emit({ step: 'reconcile', status: 'running' });
  const summary = await runReconciliation(deps, {
    dryRun: false,
    batchSize: 500,
    log: () => {},
    logError: () => {},
  });

  results.push({
    id: 'reconcile_summary',
    status: summary.errors > 0 ? 'failed' : 'success',
    durationMs: Date.now() - t,
    rowsAffected: summary.repaired,
    error:
      summary.errors > 0
        ? `${summary.errors} sheet(s) failed to repair — see app_settings failure log`
        : undefined,
  });
  emit({
    step: 'reconcile',
    status: summary.errors > 0 ? 'failed' : 'success',
    rowsAffected: summary.repaired,
  });

  return results;
}

export const reconcileBillingSheetInvoiceTotalsMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Reconcile billing-sheet / invoice totals',
  description:
    'Repairs invoiced billing sheets whose parts + labor disagree with the ' +
    'stored total. Uses add-parts semantics: the missing-parts delta is folded ' +
    'into the parent invoice total — affected customers are billed MORE. ' +
    'Unblocks the Invoice Detail Report PDF (which refuses to render on drift). ' +
    'Idempotent + resumable — a clean re-run repairs 0.',
  appSettingsKey: RECONCILE_DONE_KEY,
  check,
  preview,
  run,
};

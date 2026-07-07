// Task #1752 — Comprehensive ticket-total drift repair.
//
// Replaces the narrow `reconcile-billing-sheet-invoice-totals-v1` migration
// which only repaired INVOICED billing sheets. This migration repairs ALL
// drifted billing sheets, work orders, and wet-check billings regardless of
// invoice status. It also propagates the corrected totals back to any parent
// invoice that holds the now-repaired tickets.
//
// Safety contract (add-parts semantics):
//   – Never lowers a total that is already correct.
//   – Idempotent: a zero-drift row is skipped, not touched.
//   – Company-scoped: companyId is included in every candidate row so audit
//     events are correctly attributed and per-company filtering is possible.

import { db } from '../../db';
import { eq, sql } from 'drizzle-orm';
import { billingSheets, workOrders, wetCheckBillings, invoices, appSettings } from '@workspace/db/schema';
import { recordAuditEvent } from '../../routes/audit-log';
import { money } from '../money';
import type {
  MigrationDefinition,
  MigrationStatus,
  MigrationPreview,
  MigrationStep,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

export const REPAIR_DRIFT_DONE_KEY = 'repairTicketTotalDrift.done';
const MIGRATION_ID = 'repair-ticket-total-drift-v1';
const TOLERANCE = 0.01;

export type DriftedTicket = {
  tableType: 'billing_sheet' | 'work_order' | 'wet_check_billing';
  id: number;
  companyId: number;
  partsSubtotal: string | null;
  laborSubtotal: string | null;
  totalAmount: string | null;
  invoiceId: number | null;
};

// ── Deps injectable interface (allows pure in-memory testing) ──────────────

export type RepairDeps = {
  getCandidates(companyId?: number): Promise<DriftedTicket[]>;
  applyTicketRepair(ticket: DriftedTicket, newTotal: string): Promise<void>;
  recomputeInvoice(invoiceId: number): Promise<void>;
  markDone(): Promise<void>;
};

// ── DB-backed deps (production) ────────────────────────────────────────────

async function queryDriftedTickets(companyId?: number): Promise<DriftedTicket[]> {
  const companyFilter = companyId != null ? sql`AND company_id = ${companyId}` : sql``;

  const bsRows = await db.execute<{
    id: number; company_id: number; parts_subtotal: string | null;
    labor_subtotal: string | null; total_amount: string | null; invoice_id: number | null;
  }>(sql`
    SELECT id, company_id, parts_subtotal, labor_subtotal, total_amount, invoice_id
    FROM billing_sheets
    WHERE ABS(
      (COALESCE(parts_subtotal::numeric, 0) + COALESCE(labor_subtotal::numeric, 0)) -
      COALESCE(total_amount::numeric, 0)
    ) > ${TOLERANCE}
    ${companyFilter}
  `);

  const woRows = await db.execute<{
    id: number; company_id: number; parts_subtotal: string | null;
    labor_subtotal: string | null; total_amount: string | null; invoice_id: number | null;
  }>(sql`
    SELECT id, company_id, parts_subtotal, labor_subtotal, total_amount, invoice_id
    FROM work_orders
    WHERE ABS(
      (COALESCE(parts_subtotal::numeric, 0) + COALESCE(labor_subtotal::numeric, 0)) -
      COALESCE(total_amount::numeric, 0)
    ) > ${TOLERANCE}
    ${companyFilter}
  `);

  const wcbRows = await db.execute<{
    id: number; customer_id: number; parts_subtotal: string | null;
    labor_subtotal: string | null; total_amount: string | null; invoice_id: number | null;
  }>(sql`
    SELECT wcb.id,
           c.company_id,
           wcb.parts_subtotal, wcb.labor_subtotal, wcb.total_amount, wcb.invoice_id
    FROM wet_check_billings wcb
    JOIN customers c ON c.id = wcb.customer_id
    WHERE ABS(
      (COALESCE(wcb.parts_subtotal::numeric, 0) + COALESCE(wcb.labor_subtotal::numeric, 0)) -
      COALESCE(wcb.total_amount::numeric, 0)
    ) > ${TOLERANCE}
    ${companyId != null ? sql`AND c.company_id = ${companyId}` : sql``}
  `);

  const out: DriftedTicket[] = [];
  for (const r of bsRows.rows) {
    out.push({ tableType: 'billing_sheet', id: r.id, companyId: r.company_id, partsSubtotal: r.parts_subtotal, laborSubtotal: r.labor_subtotal, totalAmount: r.total_amount, invoiceId: r.invoice_id });
  }
  for (const r of woRows.rows) {
    out.push({ tableType: 'work_order', id: r.id, companyId: r.company_id, partsSubtotal: r.parts_subtotal, laborSubtotal: r.labor_subtotal, totalAmount: r.total_amount, invoiceId: r.invoice_id });
  }
  for (const r of wcbRows.rows) {
    out.push({ tableType: 'wet_check_billing', id: r.id, companyId: (r as any).company_id, partsSubtotal: r.parts_subtotal, laborSubtotal: r.labor_subtotal, totalAmount: r.total_amount, invoiceId: r.invoice_id });
  }
  return out;
}

async function applyTicketRepairDb(ticket: DriftedTicket, newTotal: string): Promise<void> {
  if (ticket.tableType === 'billing_sheet') {
    await db.update(billingSheets).set({ totalAmount: newTotal }).where(eq(billingSheets.id, ticket.id));
  } else if (ticket.tableType === 'work_order') {
    await db.update(workOrders).set({ totalAmount: newTotal }).where(eq(workOrders.id, ticket.id));
  } else {
    await db.update(wetCheckBillings).set({ totalAmount: newTotal }).where(eq(wetCheckBillings.id, ticket.id));
  }
}

async function recomputeInvoiceDb(invoiceId: number): Promise<void> {
  // Use independent scalar subqueries per ticket table to avoid cartesian row
  // multiplication when an invoice has rows in more than one ticket table.
  const result = await db.execute<{
    parts_sum: string; labor_sum: string; total_sum: string;
  }>(sql`
    SELECT
      (
        COALESCE((SELECT SUM(parts_subtotal::numeric) FROM billing_sheets WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(parts_subtotal::numeric) FROM work_orders    WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(parts_subtotal::numeric) FROM wet_check_billings WHERE invoice_id = ${invoiceId}), 0)
      ) AS parts_sum,
      (
        COALESCE((SELECT SUM(labor_subtotal::numeric) FROM billing_sheets WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(labor_subtotal::numeric) FROM work_orders    WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(labor_subtotal::numeric) FROM wet_check_billings WHERE invoice_id = ${invoiceId}), 0)
      ) AS labor_sum,
      (
        COALESCE((SELECT SUM(total_amount::numeric) FROM billing_sheets WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(total_amount::numeric) FROM work_orders    WHERE invoice_id = ${invoiceId}), 0) +
        COALESCE((SELECT SUM(total_amount::numeric) FROM wet_check_billings WHERE invoice_id = ${invoiceId}), 0)
      ) AS total_sum
  `);

  const row = result.rows[0];
  if (!row) return;

  const newParts = parseFloat(String(row.parts_sum ?? 0));
  const newLabor = parseFloat(String(row.labor_sum ?? 0));
  const newTotal = parseFloat(String(row.total_sum ?? 0));

  await db.update(invoices).set({
    partsSubtotal: newParts.toFixed(2),
    laborSubtotal: newLabor.toFixed(2),
    totalAmount: newTotal.toFixed(2),
  }).where(eq(invoices.id, invoiceId));
}

async function markDoneDb(): Promise<void> {
  await db.insert(appSettings).values({
    key: REPAIR_DRIFT_DONE_KEY,
    value: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: new Date().toISOString() },
  });
}

function createDbDeps(): RepairDeps {
  return {
    getCandidates: queryDriftedTickets,
    applyTicketRepair: applyTicketRepairDb,
    recomputeInvoice: recomputeInvoiceDb,
    markDone: markDoneDb,
  };
}

// ── Pure check/preview/run helpers (deps-injectable) ──────────────────────

async function check(): Promise<MigrationStatus> {
  const candidates = await queryDriftedTickets();
  if (candidates.length === 0) {
    const marker = await db.select().from(appSettings).where(eq(appSettings.key, REPAIR_DRIFT_DONE_KEY));
    const completedAt = marker.length > 0 ? String((marker[0] as any).updatedAt ?? marker[0].value ?? '') : '';
    return { state: 'completed', completedAt };
  }

  const marker = await db.select().from(appSettings).where(eq(appSettings.key, REPAIR_DRIFT_DONE_KEY));
  if (marker.length > 0) {
    return {
      state: 'partially_applied',
      details: `${candidates.length} ticket(s) still drift from their stored total`,
    };
  }
  return { state: 'not_started' };
}

async function preview(): Promise<MigrationPreview> {
  const candidates = await queryDriftedTickets();
  return buildRepairPreview(candidates);
}

/**
 * Pure preview builder (no DB) — given the candidate set, produce the
 * framework MigrationPreview. Exported for unit tests.
 */
export function buildRepairPreview(candidates: DriftedTicket[]): MigrationPreview {
  const steps: MigrationStep[] = [];
  const affectedInvoices = new Set<number>();
  let totalDelta = 0;
  let bsCount = 0;
  let woCount = 0;
  let wcbCount = 0;

  for (const t of candidates) {
    const parts = money(t.partsSubtotal);
    const labor = money(t.laborSubtotal);
    const stored = money(t.totalAmount);
    const newTotal = parts + labor;
    const delta = newTotal - stored;

    // Add-parts-only: only repair (and only show in preview) when the canonical
    // total EXCEEDS the stored total. Negative-delta rows (stored > canonical)
    // are not touched — they are not repair candidates.
    if (delta <= TOLERANCE) continue;

    totalDelta += delta;
    if (t.tableType === 'billing_sheet') bsCount++;
    else if (t.tableType === 'work_order') woCount++;
    else wcbCount++;

    if (t.invoiceId) affectedInvoices.add(t.invoiceId);

    const invoiceNote = t.invoiceId
      ? ` (invoice #${t.invoiceId} will be recomputed)`
      : ' (un-invoiced)';

    steps.push({
      id: `${t.tableType}_${t.id}`,
      description:
        `${t.tableType.replace(/_/g, ' ')} #${t.id}: ` +
        `parts=$${parts.toFixed(2)} + labor=$${labor.toFixed(2)} ` +
        `= $${newTotal.toFixed(2)} (stored $${stored.toFixed(2)}, delta ${delta >= 0 ? '+' : ''}$${delta.toFixed(2)})` +
        invoiceNote,
    });
  }

  const warnings: string[] = [];
  const repairCount = steps.length;

  if (repairCount === 0) {
    warnings.push('No drifted tickets found — nothing to repair.');
  } else {
    const breakdown: string[] = [];
    if (bsCount > 0) breakdown.push(`${bsCount} billing sheet(s)`);
    if (woCount > 0) breakdown.push(`${woCount} work order(s)`);
    if (wcbCount > 0) breakdown.push(`${wcbCount} wet-check billing(s)`);
    warnings.push(
      `${breakdown.join(', ')} · ${affectedInvoices.size} invoice(s) recomputed · ` +
      `total delta ${totalDelta >= 0 ? '+' : ''}$${totalDelta.toFixed(2)}.`,
    );
    warnings.push(
      'Add-parts semantics: each corrected total is folded back into the parent invoice — ' +
      'invoiced amounts will change. Acknowledge to proceed.',
    );
  }

  return {
    steps,
    orphanRows: { invoicesAffected: affectedInvoices.size },
    warnings,
  };
}

/**
 * Deps-injectable runner. Exported for unit tests.
 */
export async function runRepairMigration(
  deps: RepairDeps,
  emit: ProgressEmitter,
): Promise<MigrationStepResult[]> {
  const results: MigrationStepResult[] = [];
  const candidates = await deps.getCandidates();
  const affectedInvoiceIds = new Set<number>();
  let errors = 0;

  for (const ticket of candidates) {
    const stepId = `${ticket.tableType}_${ticket.id}`;
    const parts = money(ticket.partsSubtotal);
    const labor = money(ticket.laborSubtotal);
    const stored = money(ticket.totalAmount);
    const newTotal = parts + labor;

    // Add-parts-only semantics: only repair when canonical total (parts + labor)
    // EXCEEDS the stored total. Never lower a total that is already correct —
    // a stored total that is already >= canonical is not a repair candidate.
    if (newTotal <= stored + TOLERANCE) {
      results.push({ id: stepId, status: 'skipped', durationMs: 0 });
      emit({ step: stepId, status: 'skipped' });
      continue;
    }

    const t0 = Date.now();
    emit({ step: stepId, status: 'running' });

    try {
      await deps.applyTicketRepair(ticket, newTotal.toFixed(2));

      await recordAuditEvent(null, {
        action: 'total_drift_repair',
        actionType: 'data_repair',
        targetType: ticket.tableType,
        targetId: String(ticket.id),
        summary: `Drift repaired: $${stored.toFixed(2)} → $${newTotal.toFixed(2)} (delta ${(newTotal - stored) >= 0 ? '+' : ''}$${(newTotal - stored).toFixed(2)})`,
        details: {
          before: stored,
          after: newTotal,
          partsSubtotal: parts,
          laborSubtotal: labor,
          migrationId: MIGRATION_ID,
        },
        actorLabel: 'super_admin_migration',
        severity: 'info',
      });

      if (ticket.invoiceId) {
        affectedInvoiceIds.add(ticket.invoiceId);
      }

      results.push({ id: stepId, status: 'success', durationMs: Date.now() - t0, rowsAffected: 1 });
      emit({ step: stepId, status: 'success', rowsAffected: 1 });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t0, error });
      emit({ step: stepId, status: 'failed', error });
      errors++;
    }
  }

  for (const invoiceId of affectedInvoiceIds) {
    const t0 = Date.now();
    const stepId = `invoice_recompute_${invoiceId}`;
    emit({ step: stepId, status: 'running' });
    try {
      await deps.recomputeInvoice(invoiceId);
      results.push({ id: stepId, status: 'success', durationMs: Date.now() - t0, rowsAffected: 1 });
      emit({ step: stepId, status: 'success', rowsAffected: 1 });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: stepId, status: 'failed', durationMs: Date.now() - t0, error });
      emit({ step: stepId, status: 'failed', error });
      errors++;
    }
  }

  const ticketsRepaired = results.filter(r => r.id.includes('_') && !r.id.startsWith('invoice_') && r.status === 'success').length;
  const summaryStatus = errors > 0 ? 'failed' : 'success';

  if (errors === 0) {
    await deps.markDone();
  }

  const summaryId = 'repair_summary';
  results.push({
    id: summaryId,
    status: summaryStatus,
    durationMs: 0,
    rowsAffected: ticketsRepaired,
    error: errors > 0 ? `${errors} step(s) failed — review individual step errors above` : undefined,
  });
  emit({ step: summaryId, status: summaryStatus, rowsAffected: ticketsRepaired });

  return results;
}

async function run(emit: ProgressEmitter): Promise<MigrationStepResult[]> {
  return runRepairMigration(createDbDeps(), emit);
}

export const repairTicketTotalDriftMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Repair Ticket Total Drift (Billing Sheets, Work Orders, WCBs)',
  description:
    'Repairs ALL drifted billing sheets, work orders, and wet-check billings where ' +
    'partsSubtotal + laborSubtotal disagrees with the stored totalAmount. ' +
    'Covers both invoiced and un-invoiced tickets. When a repaired ticket is attached ' +
    'to an invoice, that invoice\'s totals are recomputed from its now-corrected member ' +
    'tickets. Uses add-parts semantics; idempotent (zero-drift rows are skipped). ' +
    'Supersedes reconcile-billing-sheet-invoice-totals-v1.',
  appSettingsKey: REPAIR_DRIFT_DONE_KEY,
  check,
  preview,
  run,
};

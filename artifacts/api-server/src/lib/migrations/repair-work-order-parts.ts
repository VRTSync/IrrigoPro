import { db } from '../../db';
import { appSettings, pricingAuditEvents, workOrders } from '@workspace/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type {
  MigrationDefinition,
  MigrationPreview,
  MigrationRunOptions,
  MigrationStatus,
  MigrationStepResult,
  ProgressEmitter,
} from './types';

export const REPAIR_WORK_ORDER_PARTS_DONE_KEY = 'repairWorkOrderParts.done';
export const REPAIR_WORK_ORDER_PARTS_ID = 'repair-work-order-parts-v1';
const TOLERANCE = 0.01;

export type WorkOrderPartsCandidate = {
  id: number;
  companyId: number;
  workOrderNumber: string;
  partsSubtotal: string | null;
  totalPartsCost: string | null;
  laborSubtotal: string | null;
  totalAmount: string | null;
  itemsTotal: string;
  itemCount: number;
};

export type RepairWorkOrderPartsDeps = {
  getCandidates(): Promise<WorkOrderPartsCandidate[]>;
  applyRepair(candidate: WorkOrderPartsCandidate): Promise<'repaired' | 'skipped_total_mismatch' | 'already_current'>;
  markDone(): Promise<void>;
};

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyWorkOrderPartsCandidate(row: WorkOrderPartsCandidate) {
  const itemsTotal = amount(row.itemsTotal);
  const partsSubtotal = amount(row.partsSubtotal);
  const totalPartsCost = amount(row.totalPartsCost);
  const drifted =
    Math.abs(partsSubtotal - itemsTotal) > TOLERANCE ||
    Math.abs(totalPartsCost - itemsTotal) > TOLERANCE;
  const reconciles =
    Math.abs(amount(row.totalAmount) - (amount(row.laborSubtotal) + itemsTotal)) <= TOLERANCE;
  return { itemsTotal, partsSubtotal, totalPartsCost, drifted, reconciles };
}

async function queryCandidates(): Promise<WorkOrderPartsCandidate[]> {
  const result = await db.execute<{
    id: number; company_id: number; work_order_number: string;
    parts_subtotal: string | null; total_parts_cost: string | null;
    labor_subtotal: string | null; total_amount: string | null;
    items_total: string; item_count: number;
  }>(sql`
    SELECT wo.id, wo.company_id, wo.work_order_number,
           wo.parts_subtotal, wo.total_parts_cost, wo.labor_subtotal, wo.total_amount,
           COALESCE(SUM(woi.total_price::numeric), 0)::text AS items_total,
           COUNT(woi.id)::int AS item_count
    FROM work_orders wo
    LEFT JOIN work_order_items woi
      ON woi.work_order_id = wo.id
    GROUP BY wo.id, wo.company_id, wo.work_order_number, wo.parts_subtotal,
             wo.total_parts_cost, wo.labor_subtotal, wo.total_amount
    HAVING ABS(COALESCE(wo.parts_subtotal::numeric, 0) - COALESCE(SUM(woi.total_price::numeric), 0)) > ${TOLERANCE}
        OR ABS(COALESCE(wo.total_parts_cost::numeric, 0) - COALESCE(SUM(woi.total_price::numeric), 0)) > ${TOLERANCE}
  `);
  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    workOrderNumber: row.work_order_number,
    partsSubtotal: row.parts_subtotal,
    totalPartsCost: row.total_parts_cost,
    laborSubtotal: row.labor_subtotal,
    totalAmount: row.total_amount,
    itemsTotal: row.items_total,
    itemCount: row.item_count,
  }));
}

async function applyRepairDb(candidate: WorkOrderPartsCandidate) {
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{
      parts_subtotal: string | null; total_parts_cost: string | null;
      labor_subtotal: string | null; total_amount: string | null;
    }>(sql`
      SELECT parts_subtotal, total_parts_cost, labor_subtotal, total_amount
      FROM work_orders
      WHERE id = ${candidate.id} AND company_id = ${candidate.companyId}
      FOR UPDATE
    `);
    const current = locked.rows[0];
    if (!current) throw new Error(`Work order ${candidate.id} was not found in company ${candidate.companyId}`);
    const itemSummary = await tx.execute<{ items_total: string; item_count: number }>(sql`
      SELECT COALESCE(SUM(total_price::numeric), 0)::text AS items_total,
             COUNT(id)::int AS item_count
      FROM work_order_items
      WHERE work_order_id = ${candidate.id}
    `);
    const liveItems = itemSummary.rows[0] ?? { items_total: '0', item_count: 0 };
    const live: WorkOrderPartsCandidate = {
      ...candidate,
      partsSubtotal: current.parts_subtotal,
      totalPartsCost: current.total_parts_cost,
      laborSubtotal: current.labor_subtotal,
      totalAmount: current.total_amount,
      itemsTotal: liveItems.items_total,
      itemCount: liveItems.item_count,
    };
    const classified = classifyWorkOrderPartsCandidate(live);
    if (!classified.drifted) return 'already_current' as const;
    if (!classified.reconciles) return 'skipped_total_mismatch' as const;

    const repaired = classified.itemsTotal.toFixed(2);
    const updateResult = await tx.update(workOrders)
      .set({ partsSubtotal: repaired, totalPartsCost: repaired })
      .where(and(eq(workOrders.id, candidate.id), eq(workOrders.companyId, candidate.companyId)))
      .returning({ id: workOrders.id });
    if (updateResult.length !== 1) throw new Error(`Tenant-scoped update matched ${updateResult.length} rows`);

    await tx.insert(pricingAuditEvents).values({
      companyId: candidate.companyId,
      source: 'work_order',
      parentId: candidate.id,
      parentNumber: candidate.workOrderNumber,
      kind: 'parts_subtotal_repair',
      delta: (classified.itemsTotal - classified.partsSubtotal).toFixed(2),
      itemCount: liveItems.item_count,
      actorName: 'super_admin_migration',
      details: {
        migrationId: REPAIR_WORK_ORDER_PARTS_ID,
        beforePartsSubtotal: current.parts_subtotal,
        beforeTotalPartsCost: current.total_parts_cost,
        after: repaired,
        laborSubtotal: current.labor_subtotal,
        totalAmount: current.total_amount,
      },
    });
    return 'repaired' as const;
  });
}

async function markDoneDb() {
  const value = new Date().toISOString();
  await db.insert(appSettings).values({ key: REPAIR_WORK_ORDER_PARTS_DONE_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export async function runRepairWorkOrderParts(
  deps: RepairWorkOrderPartsDeps,
  emit: ProgressEmitter,
  opts?: MigrationRunOptions,
): Promise<MigrationStepResult[]> {
  if (!opts?.acknowledged) {
    const error = 'This migration repairs financial work-order parts columns. Set acknowledged=true to proceed.';
    emit({ step: 'acknowledge_gate', status: 'failed', error });
    return [{ id: 'acknowledge_gate', status: 'failed', durationMs: 0, error }];
  }
  const rows = await deps.getCandidates();
  const results: MigrationStepResult[] = [];
  for (const row of rows) {
    const id = `work_order_${row.id}`;
    emit({ step: id, status: 'running' });
    try {
      const outcome = await deps.applyRepair(row);
      const status = outcome === 'repaired' ? 'success' : 'skipped';
      emit({ step: id, status, rowsAffected: outcome === 'repaired' ? 1 : 0 });
      results.push({ id, status, durationMs: 0, rowsAffected: outcome === 'repaired' ? 1 : 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ step: id, status: 'failed', error: message });
      results.push({ id, status: 'failed', durationMs: 0, error: message });
    }
  }
  if (results.every((result) => result.status !== 'failed')) await deps.markDone();
  return results;
}

export function buildWorkOrderPartsPreview(rows: WorkOrderPartsCandidate[]): MigrationPreview {
  const repairable = rows.filter((row) => classifyWorkOrderPartsCandidate(row).reconciles);
  const skipped = rows.filter((row) => !classifyWorkOrderPartsCandidate(row).reconciles);
  const describe = (row: WorkOrderPartsCandidate, label: string) => {
    const c = classifyWorkOrderPartsCandidate(row);
    return {
      id: `${label}_${row.id}`,
      description:
        `${label.toUpperCase()} company=${row.companyId} WO=${row.workOrderNumber}: ` +
        `parts_subtotal=$${c.partsSubtotal.toFixed(2)}, total_parts_cost=$${c.totalPartsCost.toFixed(2)}, ` +
        `items=$${c.itemsTotal.toFixed(2)}, delta=$${(c.itemsTotal - c.partsSubtotal).toFixed(2)}`,
    };
  };
  return {
    steps: [
      ...repairable.map((row) => describe(row, 'repairable')),
      ...skipped.map((row) => describe(row, 'skipped_total_mismatch')),
    ],
    orphanRows: { repairable: repairable.length, skippedTotalMismatch: skipped.length },
    warnings: [
      'Skipped total-mismatch rows could otherwise become ticket-total-drift candidates; they will remain untouched.',
      'This migration changes only work_orders.parts_subtotal and total_parts_cost. It never changes labor, ticket totals, invoice columns, line items, or notes.',
      'Set acknowledged=true to proceed.',
    ],
  };
}

export function resolveWorkOrderPartsCheckState(
  rows: WorkOrderPartsCandidate[],
  completedAt: string | null,
): MigrationStatus {
  const repairablePending = rows.filter(
    (row) => classifyWorkOrderPartsCandidate(row).reconciles,
  ).length;
  if (repairablePending === 0 && completedAt !== null) {
    return { state: 'completed', completedAt };
  }
  if (repairablePending === 0 && rows.length === 0) {
    return { state: 'completed', completedAt: '' };
  }
  if (completedAt !== null) {
    return {
      state: 'partially_applied',
      details: `${repairablePending} safely repairable work order(s) still have stale parts columns`,
    };
  }
  return { state: 'not_started' };
}

async function check(): Promise<MigrationStatus> {
  try {
    const candidates = await queryCandidates();
    const marker = await db.select().from(appSettings)
      .where(eq(appSettings.key, REPAIR_WORK_ORDER_PARTS_DONE_KEY)).limit(1);
    return resolveWorkOrderPartsCheckState(
      candidates,
      marker.length ? String(marker[0].value ?? '') : null,
    );
  } catch (error) {
    return { state: 'error', details: error instanceof Error ? error.message : String(error) };
  }
}

async function preview() {
  return buildWorkOrderPartsPreview(await queryCandidates());
}

async function run(emit: ProgressEmitter, opts?: MigrationRunOptions) {
  return runRepairWorkOrderParts(
    { getCandidates: queryCandidates, applyRepair: applyRepairDb, markDone: markDoneDb },
    emit,
    opts,
  );
}

export const repairWorkOrderPartsMigration: MigrationDefinition = {
  id: REPAIR_WORK_ORDER_PARTS_ID,
  title: 'Repair stale work-order parts columns',
  description: 'Repairs both work-order parts columns from line items only when the existing ticket total already equals labor plus item parts. Ticket and invoice totals remain unchanged.',
  appSettingsKey: REPAIR_WORK_ORDER_PARTS_DONE_KEY,
  check,
  preview,
  run,
};
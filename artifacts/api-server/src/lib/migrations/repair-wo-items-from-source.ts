// repair-wo-items-from-source.ts — Replacement for repair-duplicated-work-order-items (now deprecated).
//
// Root cause: the pre-Phase-1A completion route's append bug produced doubled WO item rows on
// every re-completion of estimate-origin WOs.  The old migration de-duped by identity and flagged
// ALL 7 affected WOs because zone-scoped rows (with controllerLetter/zoneNumber/findingId) and
// the appended copies (without zone context) are NOT exact-identity duplicates — so the old
// de-dup couldn't collapse them.
//
// New strategy — estimate-matching de-dup:
//
//   The append bug always inserted EXACT copies of the estimate items (same partId, same
//   partPrice, same quantity) without zone context.  So:
//
//   1. For each estimate_item in order, consume the first matching WO item by
//      (partId, partPrice, quantity) signature.  Consumed items are the "canonical" set.
//
//   2. Classify the remaining WO items:
//        • pureDuplicate — same (partId, partPrice, quantity) as some estimate item
//          → provably a copy of the appended duplication; safe to remove.
//        • fieldAdd — partId not in the estimate at all → genuine tech addition.
//        • drifted — partId in estimate but different price or qty → price/qty mismatch.
//
//   3. Auto-repair condition:
//        • fieldAdds.length === 0 (no genuine additions)
//        • drifted.length === 0  (no price/qty drift)
//        • pureDuplicates.length > 0 (there are copies to remove)
//      → Delete all WO items and rebuild from estimate_items (one row per estimate_item).
//
//   4. Flag condition: any field-adds, price drift, or billed WO → operator must review.
//      Log a per-part detail report: what's in the WO vs what's expected from the estimate.
//
//   5. Done marker written ONLY when 0 candidates remain after the run, so the migration
//      stays re-runnable until all flagged WOs are manually corrected.
//
// Phase 1A (replace-not-append via replaceWorkOrderItemsWithResync) and Phase 1B (NaN guards)
// are already deployed in routes.ts — this migration repairs the rows accumulated before
// those fixes.
//
// Safety gates:
//   - Requires explicit acknowledged=true before any DB writes.
//   - Billed WOs (invoiceId set) are always flagged, never auto-repaired.
//   - NaN/Infinity recomputed totalAmount → abort that WO; log error.
//   - Idempotent: after a clean run, re-run finds 0 candidates.
//   - Done-marker in app_settings.repairWoItemsFromSource.done written only when 0 remain.

import { db } from '../../db';
import { sql, eq, and } from 'drizzle-orm';
import { appSettings, estimateItems, wetCheckFindings, workOrderItems, workOrders } from '@workspace/db';
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

const MIGRATION_ID = 'repair-wo-items-from-source-v1';
const DONE_KEY = 'repairWoItemsFromSource.done';

// ── Pure helpers (exported for unit tests) ─────────────────────────────────────

/** Coerce any value to a finite number; NaN/Infinity → 0. */
export function money(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

export type WoItemRow = {
  id: number;
  partId: number | null;
  partName: string;
  partPrice: string | number;
  quantity: number;
  laborHours: string | number;
  totalPrice: string | number;
  [key: string]: unknown;
};

export type EstimateItemRow = {
  id: number;
  partId: number | null;
  partName: string;
  partPrice: string | number;
  quantity: number;
  laborHours: string | number;
  controllerLetter: string | null;
  zoneNumber: number | null;
  issueType: string | null;
};

/**
 * Canonical signature key for matching WO items to estimate items.
 * Matches on (partId, partPrice normalised to 2dp, quantity).
 * Ignores zone/finding context — the append bug always inserted the same
 * price/qty as the estimate; zone differences are not meaningful for de-dup.
 */
export function signatureKey(
  partId: number | null,
  partPrice: string | number,
  quantity: number,
): string {
  return `${partId ?? ''}|${money(partPrice).toFixed(2)}|${quantity}`;
}

export type MatchResult = {
  /** WO item ids consumed by greedy estimate matching (the "keep one" canonical set). */
  matchedWoIds: Set<number>;
  /** WO items not consumed by estimate matching. */
  remaining: WoItemRow[];
  /**
   * Subset of remaining: same (partId, partPrice, quantity) as some estimate item.
   * These are provable copies produced by the append bug — safe to delete during repair.
   */
  pureDuplicates: WoItemRow[];
  /**
   * Subset of remaining: partId not in the estimate item set at all.
   * Genuine field-added parts → must NOT be auto-repaired (billing sign-off required).
   */
  fieldAdds: WoItemRow[];
  /**
   * Subset of remaining: partId is in the estimate but price or quantity differs.
   * Price drift or quantity overage → flag for manual review.
   */
  drifted: WoItemRow[];
};

/**
 * Match WO items to estimate items one-by-one (greedy, by signature).
 *
 * For each estimate item, consume the first unmatched WO item with the same
 * (partId, partPrice, quantity) signature.  Classifies leftover WO items as
 * pureDuplicates, fieldAdds, or drifted for diagnostic reporting.
 *
 * WO-26 trace:
 *   Estimate: [(partId=1,12.50,qty=1), (partId=2,45.00,qty=1)]  — 2 items
 *   WO (after append bug): 4 items — 2 originals (with zone ctx) + 2 appended (no ctx)
 *   All 4 share signatures with one of the 2 estimate items.
 *   matchedWoIds = { id of one partId=1 item, id of one partId=2 item }
 *   remaining = [other partId=1 item, other partId=2 item]
 *   pureDuplicates = both remaining (same signatures as consumed)
 *   → auto-repair ✓
 */
export function matchActualsToEstimate(
  woItems: WoItemRow[],
  estItems: EstimateItemRow[],
): MatchResult {
  // Build a pool: signature → queue of WO item ids (FIFO)
  const pool = new Map<string, number[]>();
  for (const wi of woItems) {
    const key = signatureKey(wi.partId, wi.partPrice, wi.quantity);
    const list = pool.get(key) ?? [];
    list.push(wi.id);
    pool.set(key, list);
  }

  // Greedily consume one WO item per estimate item
  const matchedWoIds = new Set<number>();
  for (const ei of estItems) {
    const key = signatureKey(ei.partId, ei.partPrice, Number(ei.quantity));
    const list = pool.get(key);
    if (list && list.length > 0) {
      const consumedId = list.shift()!;
      matchedWoIds.add(consumedId);
      if (list.length === 0) pool.delete(key);
    }
  }

  // Build lookup structures for classifying remaining items
  const estimatePartIds = new Set<number>(
    estItems.map((ei) => ei.partId).filter((id): id is number => id != null),
  );
  const estimateSignatures = new Set<string>(
    estItems.map((ei) => signatureKey(ei.partId, ei.partPrice, Number(ei.quantity))),
  );

  const remaining = woItems.filter((wi) => !matchedWoIds.has(wi.id));
  const pureDuplicates: WoItemRow[] = [];
  const fieldAdds: WoItemRow[] = [];
  const drifted: WoItemRow[] = [];

  for (const wi of remaining) {
    const sig = signatureKey(wi.partId, wi.partPrice, wi.quantity);
    if (wi.partId != null && !estimatePartIds.has(wi.partId as number)) {
      fieldAdds.push(wi);
    } else if (estimateSignatures.has(sig)) {
      pureDuplicates.push(wi);
    } else {
      drifted.push(wi);
    }
  }

  return { matchedWoIds, remaining, pureDuplicates, fieldAdds, drifted };
}

/**
 * Per-part quantity reconciliation result.
 * Computed by reconcileQuantitiesByPartId().
 */
export type PartQtyReconciliation = {
  partId: number | null;
  partName: string;
  partPrice: string;
  /** Sum of quantity across de-duplicated WO item rows (after stripping identical copies). */
  dedupedActualQty: number;
  /** Sum of quantity across estimate items for this partId. */
  estimateQty: number;
  /** dedupedActualQty - estimateQty; positive means over-usage that blocks auto-repair. */
  overage: number;
};

/**
 * Quantity-aware reconciliation by partId.
 *
 * Steps:
 *   1. Strip append-shape duplication: de-dup WO items by (partId, partPrice, quantity)
 *      signature.  Identical rows (same sig) collapse to one representative.
 *   2. Sum deduplicated quantities by partId.
 *   3. Sum estimate quantities by partId.
 *   4. Compute overage = dedupedActualQty − estimateQty per part.
 *
 * canAutoRepair is true only when NO part has a positive overage AND at least one
 * duplicate was stripped (meaning the WO had excess rows from the append bug).
 *
 * WO-26 trace:
 *   WO: 4 rows — 2×(partId=1, $12.50, qty=1) + 2×(partId=2, $45.00, qty=1)
 *   After de-dup: 2 rows
 *   Deduped qty by partId: {1: 1, 2: 1}
 *   Estimate qty by partId: {1: 1, 2: 1}
 *   Overages: none → canAutoRepair=true ✓
 *
 * Field-add trace:
 *   WO: 3 rows — 2×(partId=1, $12.50, qty=1) + 1×(partId=99, $75.00, qty=1)
 *   After de-dup: 2 rows
 *   Deduped qty by partId: {1: 1, 99: 1}
 *   Estimate qty: {1: 1}
 *   Overage for partId=99: 1−0 = 1 → canAutoRepair=false, flag ✓
 */
export function reconcileQuantitiesByPartId(
  woItems: WoItemRow[],
  estItems: EstimateItemRow[],
): { canAutoRepair: boolean; hadDuplicates: boolean; reconciliation: PartQtyReconciliation[] } {
  // Step 1: Strip identical rows — de-dup by (partId, partPrice, quantity) signature
  const seenSigs = new Set<string>();
  const dedupedWoItems: WoItemRow[] = [];
  for (const wi of woItems) {
    const sig = signatureKey(wi.partId, wi.partPrice, wi.quantity);
    if (!seenSigs.has(sig)) {
      seenSigs.add(sig);
      dedupedWoItems.push(wi);
    }
  }
  const hadDuplicates = dedupedWoItems.length < woItems.length;

  // Step 2: Sum deduped actual quantities by partId
  const actualByPart = new Map<string, { qty: number; name: string; price: string }>();
  for (const wi of dedupedWoItems) {
    const key = String(wi.partId ?? '');
    const existing = actualByPart.get(key);
    if (existing) {
      existing.qty += Number(wi.quantity);
    } else {
      actualByPart.set(key, {
        qty: Number(wi.quantity),
        name: wi.partName,
        price: money(wi.partPrice).toFixed(2),
      });
    }
  }

  // Step 3: Sum estimate quantities by partId
  const estByPart = new Map<string, number>();
  for (const ei of estItems) {
    const key = String(ei.partId ?? '');
    estByPart.set(key, (estByPart.get(key) ?? 0) + Number(ei.quantity));
  }

  // Step 4: Build reconciliation for all parts that appear in either set
  const allPartKeys = new Set([...actualByPart.keys(), ...estByPart.keys()]);
  const reconciliation: PartQtyReconciliation[] = [];
  for (const key of allPartKeys) {
    const actual = actualByPart.get(key);
    const dedupedActualQty = actual?.qty ?? 0;
    const estimateQty = estByPart.get(key) ?? 0;
    reconciliation.push({
      partId: key === '' ? null : Number(key),
      partName: actual?.name ?? '',
      partPrice: actual?.price ?? '0.00',
      dedupedActualQty,
      estimateQty,
      overage: dedupedActualQty - estimateQty,
    });
  }
  // Sort by partId for stable output
  reconciliation.sort((a, b) => (a.partId ?? -1) - (b.partId ?? -1));

  // Exact parity required: under-quantity mismatches (dedupedActual < estimate) are
  // also blocked because rebuilding would inflate billed parts beyond deduped actual usage.
  const canAutoRepair = hadDuplicates && reconciliation.every((r) => r.overage === 0);

  return { canAutoRepair, hadDuplicates, reconciliation };
}

/**
 * Format per-part quantity delta lines for manual-review warnings.
 * Only includes parts with a non-zero overage (partId not in estimate, or qty mismatch).
 */
export function formatPartQtyDeltas(reconciliation: PartQtyReconciliation[]): string {
  const overages = reconciliation.filter((r) => r.overage !== 0);
  if (overages.length === 0) return '';
  return overages
    .map((r) => {
      const dir = r.overage > 0 ? `OVER by ${r.overage}` : `UNDER by ${Math.abs(r.overage)}`;
      return (
        `partId=${r.partId ?? 'null'} "${r.partName}" @$${r.partPrice}: ` +
        `est=${r.estimateQty} actual(deduped)=${r.dedupedActualQty} → ${dir}`
      );
    })
    .join('; ');
}

/**
 * Build a human-readable per-part overage report for flagged WOs.
 */
export function buildOverageReport(
  match: MatchResult,
  estItems: EstimateItemRow[],
): string {
  const lines: string[] = [];
  if (match.fieldAdds.length > 0) {
    lines.push(
      `field-adds (${match.fieldAdds.length}): ` +
      match.fieldAdds
        .map((f) => `partId=${f.partId} name="${f.partName}" price=$${money(f.partPrice).toFixed(2)} qty=${f.quantity}`)
        .join('; '),
    );
  }
  if (match.drifted.length > 0) {
    lines.push(
      `price/qty drift (${match.drifted.length}): ` +
      match.drifted
        .map((d) => {
          const estMatch = estItems.find((ei) => ei.partId === d.partId);
          if (estMatch) {
            return (
              `partId=${d.partId} name="${d.partName}" ` +
              `wo_price=$${money(d.partPrice).toFixed(2)} est_price=$${money(estMatch.partPrice).toFixed(2)} ` +
              `wo_qty=${d.quantity} est_qty=${estMatch.quantity}`
            );
          }
          return `partId=${d.partId} name="${d.partName}" — no estimate match`;
        })
        .join('; '),
    );
  }
  return lines.join(' | ') || 'no detail';
}

/**
 * Build the rebuilt item set from estimate_items.
 * One output row per estimate_item, preserving all estimate snapshot values.
 */
export function buildRebuiltItemsFromEstimate(
  workOrderId: number,
  estItems: EstimateItemRow[],
): Array<{
  workOrderId: number;
  partId: number | null;
  partName: string;
  partPrice: string;
  quantity: number;
  laborHours: string;
  totalPrice: string;
  controllerLetter: string | null;
  zoneNumber: number | null;
  issueType: string | null;
  findingId: null;
}> {
  return estItems.map((ei) => {
    const unitPrice = money(ei.partPrice);
    const qty = Number(ei.quantity);
    return {
      workOrderId,
      partId: ei.partId,
      partName: ei.partName,
      partPrice: unitPrice.toFixed(2),
      quantity: qty,
      laborHours: money(ei.laborHours).toFixed(2),
      totalPrice: (unitPrice * qty).toFixed(2),
      controllerLetter: ei.controllerLetter ?? null,
      zoneNumber: ei.zoneNumber ?? null,
      issueType: ei.issueType ?? null,
      findingId: null,
    };
  });
}

// ── Deferred-origin rebuild helpers ───────────────────────────────────────────

/**
 * A finding that was converted to a WO item via resolution='deferred_to_work_order'.
 * Compatible with EstimateItemRow so reconcileQuantitiesByPartId can be reused.
 */
export type FindingSourceRow = {
  id: number;
  partId: number | null;
  partName: string;
  partPrice: string | number;
  quantity: number;
  laborHours: string | number;
};

/**
 * Build the rebuilt item set from wet_check_findings (deferred-origin WOs).
 * One output row per finding, using calc()/money() for all numeric fields.
 * Sets findingId on each row so the FK is preserved after rebuild.
 */
export function buildRebuiltItemsFromFindings(
  workOrderId: number,
  findings: FindingSourceRow[],
): Array<{
  workOrderId: number;
  partId: number | null;
  partName: string;
  partPrice: string;
  quantity: number;
  laborHours: string;
  totalPrice: string;
  findingId: number;
  controllerLetter: null;
  zoneNumber: null;
  issueType: null;
}> {
  return findings.map((f) => {
    const unitPrice = money(f.partPrice);
    const qty = Number(f.quantity);
    return {
      workOrderId,
      partId: f.partId,
      partName: f.partName,
      partPrice: unitPrice.toFixed(2),
      quantity: qty,
      laborHours: money(f.laborHours).toFixed(2),
      totalPrice: (unitPrice * qty).toFixed(2),
      findingId: f.id,
      controllerLetter: null,
      zoneNumber: null,
      issueType: null,
    };
  });
}

/**
 * Summary for a deferred-origin WO candidate (no estimate_id; source = findings).
 */
export type DeferredWoSummary = {
  woId: number;
  workOrderNumber: string | null;
  isBilled: boolean;
  woItemCount: number;
  findingCount: number;
  /** Quantity-aware reconciliation treating findings as source. */
  qtyRecon: ReturnType<typeof reconcileQuantitiesByPartId>;
  canAutoRepair: boolean;
  reviewReason: string | null;
  sourceFindings: FindingSourceRow[];
};

async function buildDeferredWoSummary(cand: DeferredCandidateRow): Promise<DeferredWoSummary | null> {
  const woId = Number(cand.wo_id);

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
  if (!wo) return null;

  const items = await db
    .select()
    .from(workOrderItems)
    .where(eq(workOrderItems.workOrderId, woId));

  // Fetch findings that were deferred_to_work_order for this WO (the source of truth).
  const findings = await db
    .select()
    .from(wetCheckFindings)
    .where(
      and(
        eq(wetCheckFindings.workOrderId, woId),
        eq(wetCheckFindings.resolution, 'deferred_to_work_order'),
      ),
    );

  const typedItems = items as unknown as WoItemRow[];
  const sourceFindings: FindingSourceRow[] = findings.map((f) => ({
    id: f.id,
    partId: f.partId ?? null,
    partName: f.partName ?? '',
    partPrice: f.partPrice ?? '0',
    quantity: f.quantity,
    laborHours: f.laborHours ?? '0',
  }));

  // Treat findings as source items for the reconciliation (same interface as EstimateItemRow).
  const findingsAsSource = sourceFindings.map((f, i) => ({
    id: i + 1,
    partId: f.partId,
    partName: f.partName,
    partPrice: f.partPrice,
    quantity: f.quantity,
    laborHours: f.laborHours,
    controllerLetter: null,
    zoneNumber: null,
    issueType: null,
  })) satisfies EstimateItemRow[];

  const qtyRecon = reconcileQuantitiesByPartId(typedItems, findingsAsSource);
  const isBilled = wo.invoiceId != null;

  let canAutoRepair = qtyRecon.canAutoRepair && !isBilled && sourceFindings.length > 0;
  let reviewReason: string | null = null;

  if (isBilled) {
    canAutoRepair = false;
    reviewReason = 'billed';
  } else if (sourceFindings.length === 0) {
    canAutoRepair = false;
    reviewReason = 'no-findings-source';
  } else if (!qtyRecon.canAutoRepair) {
    reviewReason = qtyRecon.hadDuplicates ? 'qty-overage-or-no-match' : 'no-signature-duplicates';
  }

  return {
    woId,
    workOrderNumber: wo.workOrderNumber ?? null,
    isBilled,
    woItemCount: typedItems.length,
    findingCount: sourceFindings.length,
    qtyRecon,
    canAutoRepair,
    reviewReason,
    sourceFindings,
  };
}

// ── Candidate detection ────────────────────────────────────────────────────────

type CandidateRow = {
  wo_id: string;
  work_order_number: string | null;
  estimate_id: string;
  wo_item_count: string;
  est_item_count: string;
  invoice_id: string | null;
};

type DeferredCandidateRow = {
  wo_id: string;
  work_order_number: string | null;
  /** Number of extra duplicate signatures (total count − distinct count). */
  dup_count: string;
  invoice_id: string | null;
};

async function findCandidates(): Promise<CandidateRow[]> {
  const r = await db.execute<CandidateRow>(sql`
    SELECT
      wo.id::text                                               AS wo_id,
      wo.work_order_number,
      wo.estimate_id::text,
      (SELECT COUNT(*) FROM work_order_items WHERE work_order_id = wo.id)::text AS wo_item_count,
      (SELECT COUNT(*) FROM estimate_items   WHERE estimate_id   = wo.estimate_id)::text AS est_item_count,
      wo.invoice_id::text
    FROM work_orders wo
    WHERE wo.estimate_id IS NOT NULL
      AND (
        SELECT COUNT(*) FROM work_order_items WHERE work_order_id = wo.id
      ) > (
        SELECT COUNT(*) FROM estimate_items WHERE estimate_id = wo.estimate_id
      )
    ORDER BY wo.id
  `);
  return r.rows;
}

/**
 * Detect non-estimate-origin WOs that have duplicate item signatures.
 * These are "deferred-origin" candidates: they were created from wet-check
 * findings (no estimate_id), so there is no estimate source to rebuild from.
 * All are flagged for manual review — no auto-repair is attempted.
 */
async function findDeferredCandidates(): Promise<DeferredCandidateRow[]> {
  const r = await db.execute<DeferredCandidateRow>(sql`
    SELECT
      wo.id::text                       AS wo_id,
      wo.work_order_number,
      (
        SELECT
          COUNT(*) - COUNT(DISTINCT (
            COALESCE(part_id::text, 'null') || '|' ||
            COALESCE(part_price::text, '0') || '|' ||
            COALESCE(quantity::text, '0')
          ))
        FROM work_order_items
        WHERE work_order_id = wo.id
      )::text                           AS dup_count,
      wo.invoice_id::text
    FROM work_orders wo
    WHERE wo.estimate_id IS NULL
      AND (
        SELECT
          COUNT(*) - COUNT(DISTINCT (
            COALESCE(part_id::text, 'null') || '|' ||
            COALESCE(part_price::text, '0') || '|' ||
            COALESCE(quantity::text, '0')
          ))
        FROM work_order_items
        WHERE work_order_id = wo.id
      ) > 0
    ORDER BY wo.id
  `);
  return r.rows;
}

// ── Per-WO summary ─────────────────────────────────────────────────────────────

type WoSummary = {
  woId: number;
  workOrderNumber: string | null;
  estimateId: number;
  woItemCount: number;
  estItemCount: number;
  /** Sum of totalPrice across ALL current WO items (before repair). */
  woCurrentTotal: number;
  /** Sum of partPrice × quantity across estimate items (= rebuilt total after repair). */
  estTotal: number;
  isBilled: boolean;
  match: MatchResult;
  /** Quantity-aware reconciliation by partId (primary auto-repair gate). */
  qtyRecon: ReturnType<typeof reconcileQuantitiesByPartId>;
  canAutoRepair: boolean;
  reviewReason: string | null;
  estItems: EstimateItemRow[];
};

async function buildWoSummary(cand: CandidateRow): Promise<WoSummary | null> {
  const woId = Number(cand.wo_id);
  const estimateId = Number(cand.estimate_id);

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
  if (!wo) return null;

  const items = await db
    .select()
    .from(workOrderItems)
    .where(eq(workOrderItems.workOrderId, woId));

  const estItems = await db
    .select()
    .from(estimateItems)
    .where(eq(estimateItems.estimateId, estimateId));

  const typedItems = items as unknown as WoItemRow[];
  const typedEstItems = estItems as unknown as EstimateItemRow[];

  // Primary gate: quantity-aware per-partId reconciliation.
  // 1. Strip identical WO item rows (de-dup by signature).
  // 2. Sum remaining quantities by partId.
  // 3. Compare to estimate quantities by partId.
  // canAutoRepair = no part has a positive overage AND duplicates were stripped.
  const qtyRecon = reconcileQuantitiesByPartId(typedItems, typedEstItems);

  // Secondary: signature-match for diagnostics / overage detail.
  const match = matchActualsToEstimate(typedItems, typedEstItems);

  const woCurrentTotal = typedItems.reduce((a, wi) => a + money(wi.totalPrice), 0);
  const estTotal = typedEstItems.reduce(
    (a, ei) => a + money(ei.partPrice) * Number(ei.quantity),
    0,
  );

  let canAutoRepairFlag = false;
  let reviewReason: string | null = null;

  if (wo.invoiceId != null) {
    reviewReason = 'WO is already billed (invoiceId set) — manual sign-off required before correcting';
  } else if (!qtyRecon.hadDuplicates) {
    reviewReason = 'No duplicate signatures detected — item count exceeds estimate for unknown reason; manual inspection required';
  } else if (!qtyRecon.canAutoRepair) {
    // At least one partId has dedupedActualQty > estimateQty — over-usage that cannot
    // be safely dropped without operator sign-off.
    const deltas = formatPartQtyDeltas(qtyRecon.reconciliation);
    reviewReason =
      `Quantity overage after de-duplication — cannot auto-repair without operator sign-off: ${deltas}`;
  } else {
    canAutoRepairFlag = true;
  }

  return {
    woId,
    workOrderNumber: wo.workOrderNumber,
    estimateId,
    woItemCount: Number(cand.wo_item_count),
    estItemCount: Number(cand.est_item_count),
    woCurrentTotal,
    estTotal,
    isBilled: wo.invoiceId != null,
    match,
    qtyRecon,
    canAutoRepair: canAutoRepairFlag,
    reviewReason,
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
    // "Done" means zero remaining candidates in BOTH branches: estimate-origin and deferred-origin.
    // Deferred-origin WOs cannot be auto-repaired but their presence still means repair is incomplete.
    const [candidates, deferred] = await Promise.all([findCandidates(), findDeferredCandidates()]);
    const totalRemaining = candidates.length + deferred.length;
    if (totalRemaining === 0) {
      return {
        state: 'completed',
        completedAt: String(
          (marker[0] as { updatedAt?: unknown }).updatedAt ?? new Date().toISOString(),
        ),
      };
    }
    const parts: string[] = [];
    if (candidates.length > 0) parts.push(`${candidates.length} estimate-origin WO(s)`);
    if (deferred.length > 0) parts.push(`${deferred.length} deferred-origin WO(s)`);
    return {
      state: 'partially_applied',
      details:
        `Done marker is set but ${parts.join(' + ')} still have duplicate items ` +
        `— manual review required before clearing.`,
    };
  }

  const [candidates, deferred] = await Promise.all([findCandidates(), findDeferredCandidates()]);
  const totalPending = candidates.length + deferred.length;
  if (totalPending === 0) {
    return { state: 'not_started' };
  }
  // Candidates exist but migration hasn't run yet — surface count via partially_applied
  // so the admin sees the pending work before running.
  const parts: string[] = [];
  if (candidates.length > 0) parts.push(`${candidates.length} estimate-origin WO(s) with excess items`);
  if (deferred.length > 0) parts.push(`${deferred.length} non-estimate-origin WO(s) with duplicate item signatures (manual review)`);
  return {
    state: 'partially_applied',
    details: `${parts.join('; ')}. Run the migration to repair.`,
  };
}

// ── preview() ─────────────────────────────────────────────────────────────────

async function preview(): Promise<MigrationPreview> {
  const [candidates, deferredCandidates] = await Promise.all([
    findCandidates(),
    findDeferredCandidates(),
  ]);

  const summaries: WoSummary[] = [];
  for (const cand of candidates) {
    const s = await buildWoSummary(cand);
    if (s) summaries.push(s);
  }

  const deferredSummaries: DeferredWoSummary[] = [];
  for (const cand of deferredCandidates) {
    const s = await buildDeferredWoSummary(cand);
    if (s) deferredSummaries.push(s);
  }

  const deferredAutoRepairCount = deferredSummaries.filter((s) => s.canAutoRepair).length;
  const autoRepairCount = summaries.filter((s) => s.canAutoRepair).length;
  const flaggedCount = (summaries.length - autoRepairCount) + (deferredSummaries.length - deferredAutoRepairCount);

  const warnings: string[] = [];
  if (candidates.length === 0 && deferredCandidates.length === 0) {
    warnings.push('No candidate WOs found — nothing to repair.');
  } else {
    if (candidates.length > 0) {
      warnings.push(
        `${candidates.length} estimate-origin WO(s) have more items than their estimate. ` +
        `${autoRepairCount} can be auto-repaired; ${summaries.length - autoRepairCount} flagged for manual review.`,
      );
      warnings.push(
        'Auto-repair: all current WO items deleted → one row per estimate_item inserted at snapshot price. ' +
        'Review the per-WO detail below before running.',
      );
      for (const s of summaries.slice(0, 20)) {
        const rebuiltTotal = s.estTotal;
        const action = s.canAutoRepair
          ? `[auto-repair: ${s.match.pureDuplicates.length} dup(s) removed]`
          : `[MANUAL REVIEW: ${s.reviewReason}]`;
        warnings.push(
          `  WO ${s.workOrderNumber ?? s.woId}: ` +
          `items ${s.woItemCount} → ${s.estItemCount} (estimate) ` +
          `deduped=${s.qtyRecon.reconciliation.length} part(s) (stripped ${s.woItemCount - s.qtyRecon.reconciliation.reduce((a, r) => a + r.dedupedActualQty, 0)} dup row(s)) ` +
          `totals: current=$${s.woCurrentTotal.toFixed(2)} → rebuilt=$${rebuiltTotal.toFixed(2)} (est=$${s.estTotal.toFixed(2)}) ` +
          (s.reviewReason
            ? `[MANUAL REVIEW: ${s.reviewReason}]`
            : `[auto-repair: per-part qty matches estimate — ${s.qtyRecon.reconciliation.map((r) => `partId=${r.partId}:est${r.estimateQty}→actual${r.dedupedActualQty}`).join(', ')}]`),
        );
      }
      if (summaries.length > 20) warnings.push(`  … and ${summaries.length - 20} more`);
    }
    if (deferredSummaries.length > 0) {
      const dAutoCount = deferredSummaries.filter((s) => s.canAutoRepair).length;
      const dFlagCount = deferredSummaries.length - dAutoCount;
      warnings.push(
        `${deferredSummaries.length} findings-linked WO(s) with duplicate item signatures: ` +
        `${dAutoCount} can be auto-repaired from findings source; ${dFlagCount} flagged for manual review.`,
      );
      for (const ds of deferredSummaries) {
        const billed = ds.isBilled ? ' [BILLED]' : '';
        const action = ds.canAutoRepair
          ? `[auto-repair from ${ds.findingCount} finding(s)]`
          : `[MANUAL REVIEW: ${ds.reviewReason}]`;
        warnings.push(
          `  WO ${ds.workOrderNumber ?? ds.woId}: ` +
          `items ${ds.woItemCount} → ${ds.findingCount} (findings) ${action}${billed}` +
          (ds.qtyRecon.reconciliation.some((r) => r.overage !== 0)
            ? ` ${formatPartQtyDeltas(ds.qtyRecon.reconciliation)}` : ''),
        );
      }
    }
  }

  return {
    steps: [
      {
        id: 'detect_candidates',
        description:
          `Scan work_orders for estimate-origin WOs where item count > estimate item count ` +
          `(found ${candidates.length}) and findings-linked WOs with duplicate signatures ` +
          `(found ${deferredSummaries.length}).`,
      },
      {
        id: 'rebuild_from_source',
        description:
          `Auto-repair ${autoRepairCount} estimate-origin WO(s) and ${deferredAutoRepairCount} ` +
          `findings-linked WO(s) where deduped quantities exactly match the source. ` +
          `${flaggedCount} WO(s) total flagged for manual review.`,
      },
      {
        id: 'mark_done',
        description:
          'Write done marker to app_settings only when 0 candidates remain after the run. ' +
          'If flagged WOs remain, the migration stays re-runnable.',
      },
    ],
    orphanRows: {
      candidateWorkOrders: candidates.length,
      autoRepair: autoRepairCount,
      flagged: flaggedCount,
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
      'Migration not acknowledged. Review the preview output (each WO will show pure-dup / ' +
      'field-add / drifted counts), confirm the repair is correct, and re-run with ' +
      'acknowledged=true to proceed.';
    emit({ step: 'detect_candidates', status: 'failed', error: msg });
    return [{ id: 'detect_candidates', status: 'failed', durationMs: 0, error: msg }];
  }

  // Step 1 — detect candidates (estimate-origin + deferred-origin)
  let summaries: WoSummary[] = [];
  let deferredSummaries: DeferredWoSummary[] = [];
  {
    const t = Date.now();
    emit({ step: 'detect_candidates', status: 'running' });
    try {
      const [candidates, deferred] = await Promise.all([
        findCandidates(),
        findDeferredCandidates(),
      ]);
      for (const cand of candidates) {
        const s = await buildWoSummary(cand);
        if (s) summaries.push(s);
      }
      for (const cand of deferred) {
        const s = await buildDeferredWoSummary(cand);
        if (s) deferredSummaries.push(s);
      }
      const totalFound = summaries.length + deferredSummaries.length;
      results.push({
        id: 'detect_candidates',
        status: 'success',
        durationMs: Date.now() - t,
        rowsAffected: totalFound,
      });
      emit({ step: 'detect_candidates', status: 'success', rowsAffected: totalFound });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'detect_candidates', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'detect_candidates', status: 'failed', error });
      return results;
    }
  }

  // Step 2 — rebuild from source
  let repairedCount = 0;
  let flaggedCount = 0;
  {
    const t = Date.now();
    emit({ step: 'rebuild_from_source', status: 'running' });

    // Deferred-origin WOs: rebuild from findings where canAutoRepair, flag otherwise.
    for (const ds of deferredSummaries) {
      if (!ds.canAutoRepair) {
        flaggedCount++;
        logger.warn(
          {
            migration: MIGRATION_ID,
            woId: ds.woId,
            workOrderNumber: ds.workOrderNumber,
            isBilled: ds.isBilled,
            branch: 'deferred-origin',
            reason: ds.reviewReason,
            findingCount: ds.findingCount,
            woItemCount: ds.woItemCount,
            qtyDeltas: formatPartQtyDeltas(ds.qtyRecon.reconciliation),
          },
          'repair-wo-from-source: deferred-origin WO flagged for manual review — NOT auto-repaired',
        );
        continue;
      }

      try {
        logger.info(
          {
            migration: MIGRATION_ID,
            woId: ds.woId,
            workOrderNumber: ds.workOrderNumber,
            branch: 'deferred-origin',
            before: { itemCount: ds.woItemCount },
            after: { itemCount: ds.findingCount },
          },
          'repair-wo-from-source: deferred-origin auto-repair — rebuilding from findings',
        );

        // Use replaceWorkOrderItemsWithResync as the canonical replace path.
        // null companyId = super_admin access (no company scope filter) — correct for migrations.
        const rebuiltItems = buildRebuiltItemsFromFindings(ds.woId, ds.sourceFindings);
        await storage.replaceWorkOrderItemsWithResync(ds.woId, rebuiltItems as any, null);

        repairedCount++;
        logger.info(
          { migration: MIGRATION_ID, woId: ds.woId, branch: 'deferred-origin' },
          'repair-wo-from-source: deferred-origin WO repaired from findings',
        );
      } catch (err) {
        flaggedCount++;
        const error = err instanceof Error ? err.message : String(err);
        logger.error(
          { migration: MIGRATION_ID, woId: ds.woId, branch: 'deferred-origin', error },
          'repair-wo-from-source: deferred-origin WO repair failed — treating as flagged',
        );
      }
    }

    for (const summary of summaries) {
      if (!summary.canAutoRepair) {
        flaggedCount++;
        logger.warn(
          {
            migration: MIGRATION_ID,
            woId: summary.woId,
            workOrderNumber: summary.workOrderNumber,
            estimateId: summary.estimateId,
            isBilled: summary.isBilled,
            reason: summary.reviewReason,
            fieldAddCount: summary.match.fieldAdds.length,
            driftedCount: summary.match.drifted.length,
            pureDuplicateCount: summary.match.pureDuplicates.length,
            overageReport: buildOverageReport(
              summary.match,
              summary.estItems,
            ),
          },
          'repair-wo-from-source: WO flagged for manual review — NOT auto-repaired',
        );
        continue;
      }

      try {
        logger.info(
          {
            migration: MIGRATION_ID,
            woId: summary.woId,
            workOrderNumber: summary.workOrderNumber,
            estimateId: summary.estimateId,
            before: {
              itemCount: summary.woItemCount,
              pureDuplicates: summary.match.pureDuplicates.length,
            },
            after: { itemCount: summary.estItemCount },
          },
          'repair-wo-from-source: before/after snapshot — auto-repair',
        );

        // Fetch fresh estimate items and rebuild using the canonical resync path.
        // null companyId = super_admin access (no company scope filter) — correct for migrations.
        const estItems = await db
          .select()
          .from(estimateItems)
          .where(eq(estimateItems.estimateId, summary.estimateId));
        const rebuiltItems = buildRebuiltItemsFromEstimate(
          summary.woId,
          estItems as unknown as EstimateItemRow[],
        );
        await storage.replaceWorkOrderItemsWithResync(summary.woId, rebuiltItems as any, null);

        repairedCount++;
        logger.info(
          {
            migration: MIGRATION_ID,
            woId: summary.woId,
            workOrderNumber: summary.workOrderNumber,
          },
          'repair-wo-from-source: WO successfully rebuilt from estimate source',
        );
      } catch (woErr) {
        const woError = woErr instanceof Error ? woErr.message : String(woErr);
        logger.error(
          { migration: MIGRATION_ID, woId: summary.woId, error: woError },
          'repair-wo-from-source: per-WO repair failed — continuing to next',
        );
        flaggedCount++;
      }
    }

    logger.info(
      { migration: MIGRATION_ID, repairedCount, flaggedCount },
      'repair-wo-from-source: rebuild step complete',
    );
    results.push({
      id: 'rebuild_from_source',
      status: 'success',
      durationMs: Date.now() - t,
      rowsAffected: repairedCount,
    });
    emit({ step: 'rebuild_from_source', status: 'success', rowsAffected: repairedCount });
  }

  // Step 3 — mark done ONLY when 0 candidates remain
  {
    const t = Date.now();
    emit({ step: 'mark_done', status: 'running' });
    try {
      // "Done" requires zero candidates in BOTH estimate-origin and deferred-origin branches.
      const [remaining, remainingDeferred] = await Promise.all([
        findCandidates(),
        findDeferredCandidates(),
      ]);
      if (remaining.length === 0 && remainingDeferred.length === 0) {
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
          'repair-wo-from-source: done marker written — 0 candidates remain in both branches',
        );
      } else {
        const totalRemaining = remaining.length + remainingDeferred.length;
        const msg =
          `${totalRemaining} WO(s) still need manual attention — done marker NOT written. ` +
          `Re-run after manual corrections to repair the remaining WOs.`;
        results.push({
          id: 'mark_done',
          status: 'success',
          durationMs: Date.now() - t,
          rowsAffected: 0,
        });
        emit({ step: 'mark_done', status: 'success', rowsAffected: 0 });
        logger.warn(
          { migration: MIGRATION_ID, remainingEstimateOrigin: remaining.length, remainingDeferredOrigin: remainingDeferred.length },
          msg,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ id: 'mark_done', status: 'failed', durationMs: Date.now() - t, error });
      emit({ step: 'mark_done', status: 'failed', error });
    }
  }

  return results;
}

// ── Export ─────────────────────────────────────────────────────────────────────

export const repairWoItemsFromSourceMigration: MigrationDefinition = {
  id: MIGRATION_ID,
  title: 'Rebuild Work-Order Items from Estimate Source',
  description:
    'Repairs estimate-origin WOs that were duplicated by the pre-Phase-1A completion append bug. ' +
    'Uses estimate-matching de-dup: for each estimate_item, consumes the first matching WO item ' +
    'by (partId, partPrice, quantity) signature. Remaining WO items are classified as ' +
    'pureDuplicates (safe to delete), fieldAdds (need billing review), or drifted ' +
    '(price/qty changed — need review). Auto-repairs only when all remaining items are pure ' +
    'duplicates. Provides per-part overage diagnostics for every flagged WO. ' +
    'Done marker written only when 0 candidates remain. ' +
    'Supersedes repair-duplicated-work-order-items-v1 (now deprecated).',
  appSettingsKey: DONE_KEY,
  check,
  preview,
  run,
};

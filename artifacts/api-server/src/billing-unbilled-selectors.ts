// Canonical "unbilled work" selector for the Command Center.
//
// Both /api/customers/billing-preview and /api/customers/:id/billing
// source their unbilled partition from here so the two headline numbers
// are guaranteed to agree under the same selectedMonth / asOfCutoff.
//
// Decision: cutoff is an UPPER BOUND only (open start).
// A record dated on or before the end of the billing month is included.
// A null work-date is always included (and flagged as undated).
// There is no lower-bound floor — aging unbilled work from prior months
// always appears as long as it falls before the cutoff.

import { logger } from './lib/logger.js';

// ── Status constants ─────────────────────────────────────────────────────────

const WO_APPROVED = 'approved_passed_to_billing';
const WO_PENDING = new Set(['pending_manager_review', 'work_completed']);
const WO_EXCLUDED = new Set(['pending', 'assigned', 'in_progress', 'draft', 'cancelled', 'billed']);

// BS schema documents 'approved' as a legacy alias for 'approved_passed_to_billing'.
// Normalize before partitioning.
const BS_APPROVED = 'approved_passed_to_billing';
const BS_PENDING = new Set(['pending_manager_review', 'completed', 'submitted']);
const BS_EXCLUDED = new Set(['pending', 'assigned', 'in_progress', 'draft', 'cancelled', 'billed']);

const WCB_APPROVED = 'approved_passed_to_billing';
const WCB_PENDING = new Set(['submitted', 'pending_manager_review']);
const WCB_EXCLUDED = new Set(['pending', 'draft', 'cancelled', 'billed', 'converted']);

// ── safeAmount ────────────────────────────────────────────────────────────────
// Coerce Drizzle's decimal strings / numeric values to a finite JS number.
export function safeAmount(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : 0;
}

// ── Cutoff helpers ────────────────────────────────────────────────────────────

/**
 * Derive asOfCutoff (= last instant of the selected billing month) from a
 * YYYY-MM string.  Returns null for the "all open / no cutoff" view.
 *
 * The cutoff is computed in server-local time:
 *   new Date(year, month, 0, 23, 59, 59, 999)
 * gives 23:59:59.999 on the last calendar day of the requested month.
 * A record dated 10 pm local on the last day lands in that month, not the next.
 */
export function resolveAsOfCutoff(selectedMonth: string | undefined | null): Date | null {
  if (!selectedMonth || selectedMonth === 'all') return null;
  const parts = selectedMonth.split('-');
  if (parts.length < 2) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10); // 1-based
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  // day 0 of the following month = last day of this month
  return new Date(year, month, 0, 23, 59, 59, 999);
}

/**
 * Returns the previous calendar month as YYYY-MM relative to today.
 * On June 4 → "2026-05";  on July 10 → "2026-06".
 */
export function previousCalendarMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  const prevY = m === 0 ? y - 1 : y;
  const prevM = m === 0 ? 12 : m; // 1-based previous month
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

/**
 * Human-readable label for a billing month value.
 * "2026-05" → "May 2026"; "all" → "All open unbilled"
 */
export function billingMonthLabel(selectedMonth: string | null | undefined): string {
  if (!selectedMonth || selectedMonth === 'all') return 'All open unbilled';
  const cutoff = resolveAsOfCutoff(selectedMonth);
  if (!cutoff) return selectedMonth;
  return cutoff.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── Record shapes (minimal; selectors are generic) ───────────────────────────

export type WorkOrderLike = {
  id: number | string;
  status: string;
  invoiceId?: number | string | null;
  totalAmount?: string | number | null;
  completedAt?: string | Date | null;
};

export type BillingSheetLike = {
  id: number | string;
  status: string;
  invoiceId?: number | string | null;
  totalAmount?: string | number | null;
  workDate?: string | Date | null;
};

export type WetCheckBillingLike = {
  id: number | string;
  status: string;
  invoiceId?: number | string | null;
  totalAmount?: string | number | null;
  workDate?: string | Date | null;
};

export type PartitionedRecord<T> = T & { undated: boolean };

export interface UnbilledPartition<WO, BS, WCB> {
  approvedWorkOrders: PartitionedRecord<WO>[];
  approvedBillingSheets: PartitionedRecord<BS>[];
  approvedWetCheckBillings: PartitionedRecord<WCB>[];
  pendingWorkOrders: PartitionedRecord<WO>[];
  pendingBillingSheets: PartitionedRecord<BS>[];
  pendingWetCheckBillings: PartitionedRecord<WCB>[];
  approvedTotal: number;
  unapprovedTotal: number;
  total: number;
  allOpenTotal: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Parse a work/completion date to a local JS Date.
 *
 * Date-only strings from Drizzle ("2025-06-01") are parsed by `new Date()` as
 * UTC midnight, which shifts them to the prior local day in any negative-UTC
 * offset timezone (e.g. 10 pm May 31 in UTC-6 for "2025-06-01").  That would
 * cause a June record to pass a May cutoff — wrong.
 *
 * Fix: detect "YYYY-MM-DD"-shape strings and construct via local Date parts so
 * the date always resolves to local midnight regardless of server TZ offset.
 * Full ISO-8601 timestamps (contain "T") are left to the native parser since
 * they encode the offset explicitly.
 */
function parseDate(raw: string | Date | null | undefined): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  // Date-only: "YYYY-MM-DD" — parse as local midnight to avoid UTC shift.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0); // local midnight
  }
  return new Date(raw);
}

function passesDateCutoff(
  date: Date | null,
  asOfCutoff: Date | null,
): { included: boolean; undated: boolean } {
  if (date === null) return { included: true, undated: true }; // null → always include, flagged
  if (asOfCutoff === null) return { included: true, undated: false }; // no cutoff → include all
  return { included: date <= asOfCutoff, undated: false };
}

function normalizeBS(status: string): string {
  return status === 'approved' ? 'approved_passed_to_billing' : status;
}

/** All-open total (no date cutoff) — used for allOpenTotal when asOfCutoff is set */
function openTotal(
  wos: WorkOrderLike[],
  bss: BillingSheetLike[],
  wcbs: WetCheckBillingLike[],
): number {
  let t = 0;
  for (const wo of wos) {
    if (wo.invoiceId) continue;
    if (wo.status === WO_APPROVED || WO_PENDING.has(wo.status)) t += safeAmount(wo.totalAmount);
  }
  for (const bs of bss) {
    if (bs.invoiceId) continue;
    const ns = normalizeBS(bs.status);
    if (ns === BS_APPROVED || BS_PENDING.has(ns)) t += safeAmount(bs.totalAmount);
  }
  for (const wcb of wcbs) {
    if (wcb.invoiceId) continue;
    if (wcb.status === WCB_APPROVED || WCB_PENDING.has(wcb.status)) t += safeAmount(wcb.totalAmount);
  }
  return t;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Partition unbilled records across WO / BS / WCB into approved / pending
 * buckets, filtered by an as-of date cutoff.
 *
 * @param workOrders      All WOs for the customer (already fetched)
 * @param billingSheets   All BSs for the customer
 * @param wetCheckBillings All WCBs for the customer
 * @param asOfCutoff      End-of-last-day of the selected billing month (local tz),
 *                        or null for the "All open / no cutoff" view.
 */
export function computeUnbilledPartition<
  WO extends WorkOrderLike,
  BS extends BillingSheetLike,
  WCB extends WetCheckBillingLike,
>(
  workOrders: WO[],
  billingSheets: BS[],
  wetCheckBillings: WCB[],
  asOfCutoff: Date | null,
): UnbilledPartition<WO, BS, WCB> {

  const approvedWOs: PartitionedRecord<WO>[] = [];
  const pendingWOs: PartitionedRecord<WO>[] = [];
  for (const wo of workOrders) {
    if (wo.invoiceId) continue;
    const { included, undated } = passesDateCutoff(parseDate(wo.completedAt), asOfCutoff);
    if (!included) continue;
    if (wo.status === WO_APPROVED) {
      approvedWOs.push({ ...wo, undated });
    } else if (WO_PENDING.has(wo.status)) {
      pendingWOs.push({ ...wo, undated });
    } else if (!WO_EXCLUDED.has(wo.status)) {
      // Unknown status — likely a new status added to the schema without updating these sets.
      logger.warn({ type: 'work_order', id: wo.id, status: wo.status }, 'floating-billable');
    }
  }

  const approvedBSs: PartitionedRecord<BS>[] = [];
  const pendingBSs: PartitionedRecord<BS>[] = [];
  for (const bs of billingSheets) {
    if (bs.invoiceId) continue;
    const ns = normalizeBS(bs.status); // 'approved' → 'approved_passed_to_billing'
    const { included, undated } = passesDateCutoff(parseDate((bs as BillingSheetLike).workDate), asOfCutoff);
    if (!included) continue;
    if (ns === BS_APPROVED) {
      approvedBSs.push({ ...bs, undated });
    } else if (BS_PENDING.has(ns)) {
      pendingBSs.push({ ...bs, undated });
    } else if (!BS_EXCLUDED.has(ns)) {
      logger.warn({ type: 'billing_sheet', id: bs.id, status: ns }, 'floating-billable');
    }
  }

  const approvedWCBs: PartitionedRecord<WCB>[] = [];
  const pendingWCBs: PartitionedRecord<WCB>[] = [];
  for (const wcb of wetCheckBillings) {
    if (wcb.invoiceId) continue;
    const { included, undated } = passesDateCutoff(parseDate((wcb as WetCheckBillingLike).workDate), asOfCutoff);
    if (!included) continue;
    if (wcb.status === WCB_APPROVED) {
      approvedWCBs.push({ ...wcb, undated });
    } else if (WCB_PENDING.has(wcb.status)) {
      pendingWCBs.push({ ...wcb, undated });
    } else if (!WCB_EXCLUDED.has(wcb.status)) {
      logger.warn({ type: 'wet_check_billing', id: wcb.id, status: wcb.status }, 'floating-billable');
    }
  }

  const approvedTotal =
    approvedWOs.reduce((s, wo) => s + safeAmount(wo.totalAmount), 0) +
    approvedBSs.reduce((s, bs) => s + safeAmount(bs.totalAmount), 0) +
    approvedWCBs.reduce((s, wcb) => s + safeAmount(wcb.totalAmount), 0);

  const unapprovedTotal =
    pendingWOs.reduce((s, wo) => s + safeAmount(wo.totalAmount), 0) +
    pendingBSs.reduce((s, bs) => s + safeAmount(bs.totalAmount), 0) +
    pendingWCBs.reduce((s, wcb) => s + safeAmount(wcb.totalAmount), 0);

  const total = approvedTotal + unapprovedTotal;

  // allOpenTotal: no date cutoff — the full all-time unbilled exposure.
  // When asOfCutoff is null we already computed this above (total === allOpenTotal).
  const allOpenTotal = asOfCutoff === null ? total : openTotal(workOrders, billingSheets, wetCheckBillings);

  return {
    approvedWorkOrders: approvedWOs,
    approvedBillingSheets: approvedBSs,
    approvedWetCheckBillings: approvedWCBs,
    pendingWorkOrders: pendingWOs,
    pendingBillingSheets: pendingBSs,
    pendingWetCheckBillings: pendingWCBs,
    approvedTotal,
    unapprovedTotal,
    total,
    allOpenTotal,
  };
}

// Task #688 — Financial Pulse Slice 2.
//
// Pure math helpers for the /api/financial-pulse/* endpoints. These are
// extracted from the route module so the KPI math can be exercised in a
// vanilla node:test fixture without spinning up Express or Postgres.

// Task #1890 — the due-date / aging rules are shared with the invoice list
// route and the web app. See lib/shared/src/invoice-aging.ts; the boundaries
// there are frozen because every aging total below depends on them.
import {
  AGING_BUCKET_KEYS,
  AGING_BUCKET_LABELS,
  agingBucketRank,
  classifyAgingBucket,
  classifyBudgetPercent,
  computeEffectiveDueDate,
  daysOverdue,
  resolveBalanceDue,
  type AgingBucketKey,
  type BudgetStatus,
} from "@workspace/shared";

export interface InvoiceLike {
  id: number;
  customerId: number;
  totalAmount: string | number;
  partsSubtotal?: string | number | null;
  laborSubtotal?: string | number | null;
  status: string;
  createdAt: Date | string;
  paidAt?: Date | string | null;
  // Task #726 — billing-cycle fields for computeBilledForCycle / computeInvoicedYtd.
  // Optional so existing fixtures without these fields keep compiling.
  invoiceMonth?: number | null;
  invoiceYear?: number | null;
  // Task #1831 — QBO payment-status sync fields.
  // `paymentStatus` is the 3-tier state: unpaid | partially_paid | paid.
  // `balance` is the remaining owed (null = not yet synced).
  // `dueDate` is used for overdue bucketing in AR aging.
  // `paymentTerms` is the customer's terms (net_30 / net_15 / due_on_receipt)
  // used as the fallback when `dueDate` is absent.
  paymentStatus?: string | null;
  balance?: string | number | null;
  dueDate?: Date | string | null;
  paymentTerms?: string | null;
  // Task #2013 — `resolveBalanceDue` reads this to decide whether `balance` is
  // a real synced figure or the invoice total standing in for one. Optional so
  // existing fixtures keep compiling; absent degrades to the invoice total.
  paymentSyncedAt?: Date | string | null;
}

// Task #726 — lightweight billable-row shapes so the YTD helpers stay pure
// (no Drizzle / Postgres dependency).
export interface WorkOrderBillableLike {
  invoiceId?: number | null;
  totalAmount?: string | number | null;
  status: string;
  createdAt?: Date | string | null;
}

export interface BillingSheetBillableLike {
  invoiceId?: number | null;
  totalAmount?: string | number | null;
  status: string;
  createdAt?: Date | string | null;
}

// Task #814 — wet_check_billings shape for the YTD helpers.
// Uses workDate (logical work date) for year bucketing, parallel to
// billing_sheets.createdAt / work_orders.createdAt patterns.
export interface WetCheckBillingBillableLike {
  invoiceId?: number | null;
  totalAmount?: string | number | null;
  status: string;
  workDate?: Date | string | null;
}

// Task #814 — wet_check_billings shape for computeGrossMargin and
// computeByTechnician.
//
// Task #2014 — `partsSubtotal` / `laborSubtotal` are BILLED PRICES and are no
// longer read by computeGrossMargin. Wet-check labor cost now runs through the
// same technicianId × totalHours × wage path as work orders and billing
// sheets, and wet-check parts cost comes from the invoice's own line items.
// The two subtotal fields stay on the shape only because other (revenue-side)
// callers and fixtures still carry them; nothing on the cost side may read
// them again.
export interface WetCheckBillingLike {
  invoiceId?: number | null;
  /** @deprecated billed price — never a cost input. */
  partsSubtotal?: string | number | null;
  /** @deprecated billed price — never a cost input. */
  laborSubtotal?: string | number | null;
  technicianId?: number | null;
  totalHours?: string | number | null;
}

export interface InvoiceItemLike {
  invoiceId: number | null;
  laborRate?: string | number | null;
  laborTotal?: string | number | null;
  totalPrice?: string | number | null;
}

export interface CustomerLike {
  id: number;
  companyId: number;
  contractType?: string | null;
  emergencyLaborRate?: string | number | null;
}

export interface WorkOrderLike {
  invoiceId?: number | null;
  totalHours?: string | number | null;
  /**
   * @deprecated Task #2014 — a real cost, but a sheet-level snapshot rather
   * than a line-level one. Parts cost is now derived line by line from the
   * invoice's own items, one rule for all three source types, so this is no
   * longer read by computeGrossMargin.
   */
  totalPartsCost?: string | number | null;
  assignedTechnicianId?: number | null;
  completedByUserId?: number | null;
}

export interface BillingSheetLike {
  invoiceId?: number | null;
  totalHours?: string | number | null;
  /** @deprecated billed price — never a cost input (Task #2014). */
  partsSubtotal?: string | number | null;
  technicianId?: number | null;
}

export interface InvoiceLineCostLike {
  invoiceId: number | null;
  partId?: number | null;
  quantity?: string | number | null;
  /** Billed total for the line (parts + labor for ticket-level summary rows). */
  totalPrice?: string | number | null;
  /** Billed labor portion of the line; excluded from the parts estimate. */
  laborTotal?: string | number | null;
  /** Catalog `parts.cost`, or null when no usable cost could be resolved. */
  partCost?: string | number | null;
}
export interface UserLike {
  id: number;
  hourlyWage?: string | number | null;
}

export function toNum(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function inWindow(d: Date | null, start: Date, end: Date): boolean {
  if (!d) return false;
  return d >= start && d < end;
}

// Windows are inclusive of `start` and exclusive of `end` (`d >= start
// && d < end`). MTD / YTD are intentionally "to-date" — the end is
// pinned to the millisecond AFTER `now`, NOT the start of the next
// month / year — so future-dated invoices never bleed into the rollup
// and the prior-period comparators line up calendar-day for
// calendar-day. See Task #688 review note.
export function getMtdWindow(now: Date) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getTime() + 1),
  };
}
export function getYtdWindow(now: Date) {
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getTime() + 1),
  };
}
export function getPrevMonthWindow(now: Date) {
  // Same calendar slice in the previous month: from the 1st of last
  // month through `now`'s day-of-month, so MoM comparison is
  // calendar-day aligned (not full prior month vs partial current
  // month).
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds() + 1,
  );
  return { start, end };
}
export function getPrevFullMonthWindow(now: Date) {
  // Full prior calendar month: [first day of prev month, first day of
  // current month). Used by the "Billed Last Cycle" tile so it shows
  // the closed prior month total regardless of where we are in the
  // current month.
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start, end };
}
export function getPrevYearYtdWindow(now: Date) {
  // Same calendar slice in previous year — Jan 1 of last year through
  // `now`'s month/day, aligned to the millisecond after the matching
  // day-of-year. Calendar-day parity with `getYtdWindow`.
  const start = new Date(now.getFullYear() - 1, 0, 1);
  const end = new Date(
    now.getFullYear() - 1,
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds() + 1,
  );
  return { start, end };
}

// Task #1756 — canonical set of terminal/excluded statuses for every financial
// rollup. Extend this constant rather than duplicating the tuple.
export const INVOICE_EXCLUDED_STATUSES = new Set([
  "draft", "cancelled", "superseded", "merged", "failed",
]);

export function computeBilled(
  invoices: InvoiceLike[],
  start: Date,
  end: Date,
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!inWindow(d, start, end)) continue;
    sum += toNum(inv.totalAmount);
  }
  return sum;
}

export function computeCollected(
  invoices: InvoiceLike[],
  start: Date,
  end: Date,
): number {
  // Task #720 — defend the tile against stale status: a row with a
  // non-null `paidAt` inside the window but still marked `draft` or
  // `cancelled` is a data bug, and must not inflate Collected MTD.
  // Reconciliation contract is in docs/financial-metrics.md.
  let sum = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.paidAt ?? null);
    if (!inWindow(d, start, end)) continue;
    sum += toNum(inv.totalAmount);
  }
  return sum;
}

/**
 * Task #2013 — what one outstanding invoice contributes to A/R, under the one
 * balance rule the invoice list already uses: the balance QuickBooks last
 * reported when a payment sync has run, otherwise the invoice total. Clamped
 * at zero so a credit-memo overpayment never subtracts from the total.
 *
 * `computeOutstandingAr` and `computeArAging` both call this, which is what
 * makes the four buckets sum to the Money Owed tile.
 */
export function arAmountDue(inv: InvoiceLike): number {
  return Math.max(0, resolveBalanceDue(inv));
}

export function computeOutstandingAr(invoices: InvoiceLike[]): number {
  let sum = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status) || inv.status === "paid")
      continue;
    if (inv.paidAt) continue;
    const ps = inv.paymentStatus ?? "unpaid";
    if (ps === "paid") continue;
    sum += arAmountDue(inv);
  }
  return sum;
}

export function computeAvgDaysToPay(
  invoices: InvoiceLike[],
  now: Date,
): number | null {
  const ninetyAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  let total = 0;
  let n = 0;
  for (const inv of invoices) {
    const paid = toDate(inv.paidAt ?? null);
    if (!paid || paid < ninetyAgo || paid > now) continue;
    const created = toDate(inv.createdAt);
    if (!created) continue;
    const days = (paid.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(days) || days < 0) continue;
    total += days;
    n++;
  }
  return n === 0 ? null : total / n;
}

// Month-end run-rate projection: billed month-to-date extrapolated at the
// current daily pace. `billedToDate` is always a billed figure — never the
// uninvoiced pipeline, which is a point-in-time balance and cannot be
// extrapolated by the day of the month.
export function computeProjectedMonthEnd(
  billedToDate: number,
  now: Date,
): number {
  const day = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  return (billedToDate / day) * daysInMonth;
}

// Task #726 — Tile 1: Billed Last Cycle.
// Returns all distinct billing cycles (non-draft, non-cancelled) sorted
// most-recent-first. Each entry is { year, month } matching the invoice
// invoiceYear / invoiceMonth columns. Invoices missing these columns are
// skipped.
//
// Task #2012 — pass `closedAsOf` to drop the current (in-progress) calendar
// month and anything after it. A single standalone invoice stamped with
// current-month work otherwise becomes "the most recent cycle", and a partial
// September gets presented as a closed cycle and compared against the whole of
// August. "Last cycle" must mean a cycle that has finished.
export function getDistinctBillingCycles(
  invoices: InvoiceLike[],
  opts?: { closedAsOf?: Date | null },
): Array<{ year: number; month: number }> {
  const closedAsOf = opts?.closedAsOf ?? null;
  const cutoffKey = closedAsOf
    ? closedAsOf.getFullYear() * 100 + (closedAsOf.getMonth() + 1)
    : null;
  const seen = new Map<number, { year: number; month: number }>();
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    if (inv.invoiceMonth == null || inv.invoiceYear == null) continue;
    const key = inv.invoiceYear * 100 + inv.invoiceMonth;
    if (cutoffKey != null && key >= cutoffKey) continue;
    if (!seen.has(key)) {
      seen.set(key, { year: inv.invoiceYear, month: inv.invoiceMonth });
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month),
  );
}

// Task #2012 — how many invoices make up one billing cycle. Shares the
// excluded-status rule with computeBilledForCycle so the count on the tile and
// the dollars on the tile always describe the same rows.
export function countInvoicesForCycle(
  invoices: InvoiceLike[],
  cycle: { year: number; month: number },
): number {
  let n = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    if (inv.invoiceYear === cycle.year && inv.invoiceMonth === cycle.month) n++;
  }
  return n;
}

// Sums non-draft, non-cancelled invoices that belong to the given
// invoiceYear / invoiceMonth billing cycle.
export function computeBilledForCycle(
  invoices: InvoiceLike[],
  cycle: { year: number; month: number },
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    if (inv.invoiceYear === cycle.year && inv.invoiceMonth === cycle.month) {
      sum += toNum(inv.totalAmount);
    }
  }
  return sum;
}

// Task #2012 — Invoiced YTD: realised revenue for the current billing year.
//
// Invoices at `year` on their invoiceYear column (so a December cycle invoiced
// in January still belongs to December's year), excluded statuses applied.
//
// `createdOnOrBefore` exists for the year-over-year comparator: passing the
// same calendar instant one year back turns this into the prior year's
// invoices through the same day, which is the only like-for-like comparison
// available for a partial year. Invoices for the current year are always
// created on or before now, so the current-year call needs no bound.
export function computeInvoicedYtd(
  invoices: InvoiceLike[],
  year: number,
  createdOnOrBefore?: Date | null,
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    if (inv.invoiceYear !== year) continue;
    if (createdOnOrBefore) {
      const created = toDate(inv.createdAt);
      if (!created || created > createdOnOrBefore) continue;
    }
    sum += toNum(inv.totalAmount);
  }
  return sum;
}

/** A billable row carrying the customer it belongs to, so hidden-from-billing
 *  customers can be excluded from the uninvoiced legs. */
type WithCustomer<T> = T & { customerId?: number | null };

export interface WorkBookedYtdInput {
  invoices: InvoiceLike[];
  workOrders: Array<WithCustomer<WorkOrderBillableLike>>;
  billingSheets: Array<WithCustomer<BillingSheetBillableLike>>;
  wetCheckBillings?: Array<WithCustomer<WetCheckBillingBillableLike>>;
  currentYear: number;
  /**
   * Customers flagged `hiddenFromBilling`. The UNINVOICED legs exclude them,
   * matching In-Flight and Work Not Yet Billed; the invoiced leg filters
   * nobody, matching every other invoiced figure on the page. Both the
   * Accounting tab and the Pulse tab hand in the same set — that is what lets
   * the two tiles agree on a company that uses the flag.
   */
  hiddenCustomerIds?: ReadonlySet<number>;
}

// Task #2012 — Work Booked YTD: invoiced this year, plus work booked this year
// that has not been invoiced yet. Every row is counted once.
//
// Formula:
//   computeInvoicedYtd(invoices, currentYear)
//   + work_orders with no invoice, not cancelled, createdAt year = currentYear
//   + billing_sheets with no invoice, not cancelled, createdAt year = currentYear
//   + wet_check_billings with no invoice, workDate year = currentYear
//
// This replaces `computeAllBillableYtd`, which added ALL non-cancelled work
// orders and billing sheets on top of the invoices that already contained
// them — roughly doubling a tile named "Billed". The uninvoiced legs reuse
// `isUnbilledWorkRow`, so "not billed yet" stays defined in exactly one place.
//
// Rows with no customerId are skipped on the uninvoiced legs: they cannot be
// checked against the hidden-from-billing set, and the Pulse tab's loaders
// drop them outright, so counting them here would make the two tabs disagree.
export function computeWorkBookedYtd(input: WorkBookedYtdInput): number {
  const {
    invoices,
    workOrders,
    billingSheets,
    wetCheckBillings = [],
    currentYear,
    hiddenCustomerIds,
  } = input;

  const visible = (row: { customerId?: number | null }): boolean => {
    if (row.customerId == null) return false;
    return !hiddenCustomerIds?.has(row.customerId);
  };
  const bookedThisYear = (d: Date | string | null | undefined): boolean => {
    const parsed = toDate(d ?? null);
    return parsed != null && parsed.getFullYear() === currentYear;
  };

  let sum = computeInvoicedYtd(invoices, currentYear);

  for (const wo of workOrders) {
    if (!visible(wo) || !isUnbilledWorkRow(wo)) continue;
    if (!bookedThisYear(wo.createdAt)) continue;
    sum += toNum(wo.totalAmount);
  }
  for (const bs of billingSheets) {
    if (!visible(bs) || !isUnbilledWorkRow(bs)) continue;
    if (!bookedThisYear(bs.createdAt)) continue;
    sum += toNum(bs.totalAmount);
  }
  // wet_check_billings has no cancelled status, so the invoiceId check is the
  // whole "not billed yet" rule here; bucketed by workDate, not createdAt.
  for (const wcb of wetCheckBillings) {
    if (!visible(wcb) || wcb.invoiceId != null) continue;
    if (!bookedThisYear(wcb.workDate)) continue;
    sum += toNum(wcb.totalAmount);
  }
  return sum;
}

// Task #730 — shared predicate for "is this row part of the unbilled pipeline?"
// Used by computeUnbilledExposure (global tile) and the per-customer summary
// endpoint so both surfaces apply exactly the same rule. A row is unbilled when
// it has no invoice yet AND was not explicitly cancelled.
export function isUnbilledWorkRow(row: {
  invoiceId?: number | null | undefined;
  status: string;
}): boolean {
  return row.invoiceId == null && row.status !== "cancelled";
}

export interface GrossMarginResult {
  pct: number | null;
  revenue: number;
  partsCost: number;
  laborCost: number;
  missingWageTechCount: number;
  /** Task #730 — total dollar amount of labor cost computed using the fallback
   * wage (both missing-wage techs and unknown techs). Exposed on the tile
   * warning so users understand the magnitude of the estimate. */
  estimatedLaborCostShortfall: number;
  /** Task #2014 — total dollar amount of parts cost charged as a percentage of
   * the billed price because no catalog cost could be resolved for the line. */
  estimatedPartsCostShortfall: number;
  /** Task #2014 — how many invoice line items carried billed parts dollars but
   * no usable catalog cost. */
  missingCostPartLineCount: number;
}

/**
 * Task #2014 — one cost rule behind all three legs.
 *
 * Parts cost is the sum over the in-window invoices' OWN line items of
 * `quantity × parts.cost`. It is never a `partsSubtotal`, a `totalPartsCost`
 * snapshot, or any other billed-price column, and there is deliberately no
 * fallback chain back to one: when a line has no usable catalog cost the line
 * is charged `partsCostPct` of its billed parts price and the estimate is
 * reported separately so the tile can flag it.
 *
 * Labor cost is technician hours × wage for all three legs — work orders,
 * billing sheets and wet checks alike — so wet-check labor participates in the
 * missing-wage count and the labor shortfall like everything else.
 */
export function computeGrossMargin(input: {
  invoices: InvoiceLike[];
  workOrders: WorkOrderLike[];
  billingSheets: BillingSheetLike[];
  // Task #814 — wet check billings linked to invoices in the window.
  // Task #2014 — contribute labor HOURS only; their billed subtotals are
  // prices and never enter the cost base.
  wetCheckBillings?: WetCheckBillingLike[];
  // Task #2014 — line items of the invoices in the window, each carrying the
  // catalog cost of its part (null when unresolvable). The sole source of
  // parts cost.
  invoiceLineItems?: InvoiceLineCostLike[];
  usersById: Map<number, UserLike>;
  fallbackHourlyWage: number;
  /** Percent of billed parts price charged when catalog cost is unknown. */
  partsCostPct?: number;
  window: { start: Date; end: Date };
}): GrossMarginResult {
  const {
    invoices,
    workOrders,
    billingSheets,
    wetCheckBillings = [],
    invoiceLineItems = [],
    usersById,
    fallbackHourlyWage,
    window,
  } = input;
  const partsCostPct =
    Number.isFinite(input.partsCostPct) && (input.partsCostPct as number) >= 0
      ? (input.partsCostPct as number)
      : DEFAULT_PARTS_COST_PCT;
  const invoiceIdsInWindow = new Set<number>();
  let revenue = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!inWindow(d, window.start, window.end)) continue;
    invoiceIdsInWindow.add(inv.id);
    revenue += toNum(inv.totalAmount);
  }

  let partsCost = 0;
  let laborCost = 0;
  let estimatedLaborCostShortfall = 0;
  let estimatedPartsCostShortfall = 0;
  let missingCostPartLineCount = 0;
  const missingWageTechs = new Set<number>();
  const usedFallbackForUnknownTech = { flag: false };

  const tally = (techId: number | null | undefined, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    let wage = fallbackHourlyWage;
    let usedFallback = false;
    if (techId != null) {
      const u = usersById.get(techId);
      const w = toNum(u?.hourlyWage, NaN);
      if (Number.isFinite(w) && w > 0) {
        wage = w;
      } else {
        missingWageTechs.add(techId);
        usedFallback = true;
      }
    } else {
      usedFallbackForUnknownTech.flag = true;
      usedFallback = true;
    }
    const cost = hours * wage;
    laborCost += cost;
    if (usedFallback) {
      estimatedLaborCostShortfall += cost;
    }
  };

  // ── Labor cost: hours × wage, identically for all three legs ─────────────
  for (const wo of workOrders) {
    if (wo.invoiceId == null || !invoiceIdsInWindow.has(wo.invoiceId)) continue;
    tally(
      wo.assignedTechnicianId ?? wo.completedByUserId ?? null,
      toNum(wo.totalHours),
    );
  }
  for (const bs of billingSheets) {
    if (bs.invoiceId == null || !invoiceIdsInWindow.has(bs.invoiceId)) continue;
    tally(bs.technicianId ?? null, toNum(bs.totalHours));
  }
  // Task #2014 — wet checks used to add their billed `laborSubtotal`
  // (hours × the CUSTOMER's labor rate) straight to labor cost. That is a
  // price. They now go through the same wage path as everything else.
  for (const wcb of wetCheckBillings) {
    if (wcb.invoiceId == null || !invoiceIdsInWindow.has(wcb.invoiceId)) continue;
    tally(wcb.technicianId ?? null, toNum(wcb.totalHours));
  }

  // ── Parts cost: quantity × catalog cost, line by line ────────────────────
  //
  // A line's billed PARTS price is its total less its billed labor, so a
  // ticket-level summary line (one row carrying a whole work order's labor and
  // parts) cannot have its labor charged a second time here — that labor is
  // already priced above through the wage path. For a real part line
  // `laborTotal` is zero and this is simply the line total.
  for (const li of invoiceLineItems) {
    if (li.invoiceId == null || !invoiceIdsInWindow.has(li.invoiceId)) continue;
    const catalogCost = toNum(li.partCost, NaN);
    if (li.partId != null && Number.isFinite(catalogCost) && catalogCost >= 0) {
      partsCost += toNum(li.quantity) * catalogCost;
      continue;
    }
    const billedParts = toNum(li.totalPrice) - toNum(li.laborTotal);
    if (!(billedParts > 0)) continue;
    const estimated = billedParts * (partsCostPct / 100);
    partsCost += estimated;
    estimatedPartsCostShortfall += estimated;
    missingCostPartLineCount += 1;
  }

  const pct =
    revenue > 0 ? ((revenue - partsCost - laborCost) / revenue) * 100 : null;
  return {
    pct,
    revenue,
    partsCost,
    laborCost,
    missingWageTechCount: missingWageTechs.size,
    estimatedLaborCostShortfall,
    estimatedPartsCostShortfall,
    missingCostPartLineCount,
  };
}

export function pctDelta(curr: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export interface MonthBucket {
  month: string; // YYYY-MM
  revenue: number;
  partsRevenue: number;
  laborRevenue: number;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthStarts(now: Date, count: number): Date[] {
  // `count` first-of-month dates ending with the current month, ascending.
  const out: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  }
  return out;
}

export function bucketMonthlyRevenue(
  invoices: InvoiceLike[],
  monthStarts: Date[],
): MonthBucket[] {
  const buckets = monthStarts.map((d) => ({
    month: monthKey(d),
    revenue: 0,
    partsRevenue: 0,
    laborRevenue: 0,
  }));
  const idx = new Map(buckets.map((b, i) => [b.month, i]));
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!d) continue;
    const i = idx.get(monthKey(d));
    if (i == null) continue;
    buckets[i].revenue += toNum(inv.totalAmount);
    buckets[i].partsRevenue += toNum(inv.partsSubtotal);
    buckets[i].laborRevenue += toNum(inv.laborSubtotal);
  }
  return buckets;
}

export interface RevenueMixResult {
  partsVsLabor: { parts: number; labor: number };
  emergencyVsStandard: { emergency: number; standard: number };
  contractVsAdhoc: { contract: number; adhoc: number };
}

// ─── Slice 3 helpers (Task #692) ────────────────────────────────────────────

// Task #1890 — the bucket keys, labels and boundary rule now come from the
// shared module so this computation, the invoice list route and the invoice
// page's client-side matcher cannot drift apart. The key type is re-exported
// under its original name for existing importers.
export type { AgingBucketKey };
export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

/**
 * A/R aging buckets, keyed off how far past its effective due date each
 * outstanding invoice is: Current (not yet due), 0–29, 30–59, 60+ days
 * overdue. Uses the same outstanding-invoice filter as `computeOutstandingAr`
 * so the four bucket amounts sum to the Outstanding A/R KPI within rounding.
 */
export function computeArAging(
  invoices: InvoiceLike[],
  now: Date,
): AgingBucket[] {
  const buckets: AgingBucket[] = AGING_BUCKET_KEYS.map((key) => ({
    key,
    label: AGING_BUCKET_LABELS[key],
    amount: 0,
    count: 0,
  }));
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status) || inv.status === "paid")
      continue;
    if (inv.paidAt) continue;
    // Task #1831 — skip fully-paid rows.
    const ps = inv.paymentStatus ?? "unpaid";
    if (ps === "paid") continue;
    // Task #2013 — an unparseable `createdAt` must NOT drop the row: it is in
    // the Money Owed tile, so it has to be in a bucket. The effective-due-date
    // helper yields an invalid date, daysOverdue yields NaN, and the frozen
    // NaN fallthrough puts the row in the oldest bucket.
    const created = toDate(inv.createdAt) ?? new Date(NaN);
    // Bucket by effective due date: dueDate if set, else createdAt + customer
    // payment terms (net_30=30d, net_15=15d, due_on_receipt=0d; default net_30).
    const due = computeEffectiveDueDate(inv.dueDate, created, inv.paymentTerms);
    const bucket = classifyAgingBucket(daysOverdue(due, now));
    const i = agingBucketRank(bucket);
    const amount = arAmountDue(inv);
    // Task #2013 — count only the rows whose dollars this bucket reports, so a
    // bucket's count and its amount describe the same set of invoices.
    if (amount <= 0) continue;
    buckets[i].amount += amount;
    buckets[i].count += 1;
  }
  return buckets;
}

export interface BudgetFields {
  monthlyAllocation?: number | null;
  annualBudgetGoal?: string | number | null;
  /** Compatibility-only inputs for historical pure-math callers. Live routes never select these retired columns. */
  monthlyBudgetCap?: string | number | null;
  annualBudgetCap?: string | number | null;
  budgetSoftThresholdPercent?: number | null;
  budgetHardThresholdPercent?: number | null;
}

// Task #2008 — the budget classifier and the BudgetStatus union live in
// lib/shared/src/budget-status.ts (imported at the top of this file). The
// local copies that used to sit here are gone; re-exported so existing
// importers of this module keep working. `classifyBudgetPercent` takes
// spend / cap as a RATIO (null when there is no usable cap) and thresholds as
// 0-to-100 percentages — the same convention the deleted local copy used.
export type { BudgetStatus } from "@workspace/shared";

export interface TopCustomerRow {
  customerId: number;
  name: string;
  revenue: number;
  monthlyCap: number | null;
  monthlySpend: number;
  monthlyUsedPct: number | null;
  monthlyStatus: BudgetStatus;
  annualCap: number | null;
  annualSpend: number;
  annualUsedPct: number | null;
  annualStatus: BudgetStatus;
  avgDaysToPay: number | null;
  lastInvoiceAt: string | null;
  monthlySpark: { month: string; revenue: number }[];
}

export interface CustomerWithBudget extends CustomerLike, BudgetFields {
  name?: string | null;
  hiddenFromBilling?: boolean | null;
}

/**
 * Task #2017 — `monthSpendByCustomer` / `yearSpendByCustomer` are the canonical
 * spend totals from `computeCustomerSpendBatch`, keyed by customer id. This
 * helper no longer accumulates budget spend itself: it used to sum invoices
 * only, so uninvoiced wet-check work was invisible here while it counted on the
 * customer's own profile, and it used its own `now + 1ms` windows instead of
 * the full calendar month / year every other surface uses. Missing ids mean
 * zero spend. `revenue` is NOT budget spend — it keeps following the caller's
 * MTD/YTD period selector on the invoice creation date.
 */
export function computeTopCustomers(input: {
  customers: CustomerWithBudget[];
  invoices: InvoiceLike[];
  window: { start: Date; end: Date };
  now: Date;
  monthSpendByCustomer: Map<number, number>;
  yearSpendByCustomer: Map<number, number>;
}): TopCustomerRow[] {
  const {
    customers: custs,
    invoices,
    window,
    now,
    monthSpendByCustomer,
    yearSpendByCustomer,
  } = input;
  const sparkStarts = getMonthStarts(now, 7);
  const sparkKeys = sparkStarts.map(
    (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
  );
  const sparkIdx = new Map(sparkKeys.map((k, i) => [k, i]));

  const byCust = new Map<
    number,
    {
      revenue: number;
      spark: number[];
      lastInvoiceAt: Date | null;
      payDays: { sum: number; n: number };
    }
  >();
  const ninetyAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!d) continue;
    const total = toNum(inv.totalAmount);
    let row = byCust.get(inv.customerId);
    if (!row) {
      row = {
        revenue: 0,
        spark: new Array(sparkStarts.length).fill(0),
        lastInvoiceAt: null,
        payDays: { sum: 0, n: 0 },
      };
      byCust.set(inv.customerId, row);
    }
    if (d >= window.start && d < window.end) row.revenue += total;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = sparkIdx.get(k);
    if (idx != null) row.spark[idx] += total;
    if (!row.lastInvoiceAt || d > row.lastInvoiceAt) row.lastInvoiceAt = d;
    const paid = toDate(inv.paidAt ?? null);
    if (paid && paid >= ninetyAgo && paid <= now) {
      const days = (paid.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      if (Number.isFinite(days) && days >= 0) {
        row.payDays.sum += days;
        row.payDays.n += 1;
      }
    }
  }

  const out: TopCustomerRow[] = [];
  for (const c of custs) {
    if (c.hiddenFromBilling) continue;
    const r = byCust.get(c.id);
    // Task #2017 — the one shared spend number, handed in by the endpoint.
    const monthSpend = monthSpendByCustomer.get(c.id) ?? 0;
    const yearSpend = yearSpendByCustomer.get(c.id) ?? 0;
    const mCap = c.monthlyAllocation ??
      (c.monthlyBudgetCap == null || c.monthlyBudgetCap === "" ? null : toNum(c.monthlyBudgetCap));
    const annualRaw = c.annualBudgetGoal ?? c.annualBudgetCap;
    const aCap = annualRaw == null || annualRaw === ""
      ? null
      : toNum(annualRaw);
    const soft = c.budgetSoftThresholdPercent ?? 75;
    const hard = c.budgetHardThresholdPercent ?? 100;
    const mPct = mCap != null && mCap > 0 ? monthSpend / mCap : null;
    const aPct = aCap != null && aCap > 0 ? yearSpend / aCap : null;
    out.push({
      customerId: c.id,
      name: c.name ?? `Customer #${c.id}`,
      revenue: r?.revenue ?? 0,
      monthlyCap: mCap,
      monthlySpend: monthSpend,
      monthlyUsedPct: mPct,
      monthlyStatus: classifyBudgetPercent(mPct, soft, hard),
      annualCap: aCap,
      annualSpend: yearSpend,
      annualUsedPct: aPct,
      annualStatus: classifyBudgetPercent(aPct, soft, hard),
      avgDaysToPay:
        r && r.payDays.n > 0 ? r.payDays.sum / r.payDays.n : null,
      lastInvoiceAt: r?.lastInvoiceAt ? r.lastInvoiceAt.toISOString() : null,
      monthlySpark: sparkKeys.map((m, i) => ({
        month: m,
        revenue: r?.spark[i] ?? 0,
      })),
    });
  }
  return out;
}

/**
 * Rank rows by `revenue` (desc) or `budget_risk`. Budget-risk ordering:
 * customers over 100% (status='over') come first, then 'approaching',
 * then 'healthy', then 'unset', and within each band by `monthlyUsedPct`
 * descending. Customers with no cap have `monthlyUsedPct = null` and
 * sort last.
 */
export function sortTopCustomers(
  rows: TopCustomerRow[],
  sort: "revenue" | "budget_risk",
): TopCustomerRow[] {
  const copy = rows.slice();
  if (sort === "revenue") {
    copy.sort((a, b) => b.revenue - a.revenue);
    return copy;
  }
  const rank: Record<BudgetStatus, number> = {
    over: 0,
    approaching: 1,
    healthy: 2,
    unset: 3,
  };
  copy.sort((a, b) => {
    const r = rank[a.monthlyStatus] - rank[b.monthlyStatus];
    if (r !== 0) return r;
    const ap = a.monthlyUsedPct ?? -1;
    const bp = b.monthlyUsedPct ?? -1;
    if (bp !== ap) return bp - ap;
    return b.revenue - a.revenue;
  });
  return copy;
}

export interface TechnicianRow {
  technicianId: number;
  name: string;
  hoursBilled: number;
  revenue: number;
  laborCost: number | null;
  marginPct: number | null;
  avgTicket: number | null;
  billingSheetCount: number;
  workOrderCount: number;
  partsRevenue: number;
  hasWageSet: boolean;
}

export interface UserWithName extends UserLike {
  name?: string | null;
  role?: string | null;
}

export function computeByTechnician(input: {
  techs: UserWithName[];
  invoices: InvoiceLike[];
  workOrders: WorkOrderLike[];
  billingSheets: BillingSheetLike[];
  // Task #814 — wet check billings linked to invoices in the window,
  // attributed by technicianId. Hours tallied for margin; invoice revenue
  // and partsRevenue come from the invoice (no double-count).
  wetCheckBillings?: WetCheckBillingLike[];
  window: { start: Date; end: Date };
}): TechnicianRow[] {
  const { techs, invoices, workOrders, billingSheets, wetCheckBillings = [], window } = input;
  const invoiceIdsInWindow = new Set<number>();
  const invoiceById = new Map<number, InvoiceLike>();
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!inWindow(d, window.start, window.end)) continue;
    invoiceIdsInWindow.add(inv.id);
    invoiceById.set(inv.id, inv);
  }

  interface Acc {
    hours: number;
    invoiceIds: Set<number>;
    woCount: number;
    bsCount: number;
    wcbCount: number;
  }
  const acc = new Map<number, Acc>();
  const ensure = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { hours: 0, invoiceIds: new Set(), woCount: 0, bsCount: 0, wcbCount: 0 };
      acc.set(id, a);
    }
    return a;
  };

  for (const wo of workOrders) {
    if (wo.invoiceId == null || !invoiceIdsInWindow.has(wo.invoiceId)) continue;
    const techId = wo.assignedTechnicianId ?? wo.completedByUserId ?? null;
    if (techId == null) continue;
    const a = ensure(techId);
    a.hours += toNum(wo.totalHours);
    a.invoiceIds.add(wo.invoiceId);
    a.woCount += 1;
  }
  for (const bs of billingSheets) {
    if (bs.invoiceId == null || !invoiceIdsInWindow.has(bs.invoiceId)) continue;
    if (bs.technicianId == null) continue;
    const a = ensure(bs.technicianId);
    a.hours += toNum(bs.totalHours);
    a.invoiceIds.add(bs.invoiceId);
    a.bsCount += 1;
  }
  // Task #814 — wet check billings attributed to technician for hours + invoice.
  for (const wcb of wetCheckBillings) {
    if (wcb.invoiceId == null || !invoiceIdsInWindow.has(wcb.invoiceId)) continue;
    if (wcb.technicianId == null) continue;
    const a = ensure(wcb.technicianId);
    a.hours += toNum(wcb.totalHours);
    a.invoiceIds.add(wcb.invoiceId);
    a.wcbCount += 1;
  }

  const techById = new Map(techs.map((t) => [t.id, t]));
  const out: TechnicianRow[] = [];
  for (const [techId, a] of acc) {
    const tech = techById.get(techId);
    if (!tech) continue;
    let revenue = 0;
    let partsRevenue = 0;
    for (const iid of a.invoiceIds) {
      const inv = invoiceById.get(iid);
      if (!inv) continue;
      revenue += toNum(inv.totalAmount);
      partsRevenue += toNum(inv.partsSubtotal);
    }
    const wage = toNum(tech.hourlyWage, NaN);
    const hasWage = Number.isFinite(wage) && wage > 0;
    const laborCost = hasWage ? a.hours * wage : null;
    const marginPct =
      hasWage && revenue > 0 ? ((revenue - laborCost!) / revenue) * 100 : null;
    out.push({
      technicianId: techId,
      name: tech.name ?? `Tech #${techId}`,
      hoursBilled: a.hours,
      revenue,
      laborCost,
      marginPct,
      avgTicket: a.invoiceIds.size > 0 ? revenue / a.invoiceIds.size : null,
      billingSheetCount: a.bsCount,
      workOrderCount: a.woCount,
      partsRevenue,
      hasWageSet: hasWage,
    });
  }
  out.sort((a, b) => b.revenue - a.revenue);
  return out;
}

export interface ServiceTypeRow {
  key: "emergency" | "standard" | "contract" | "adhoc";
  label: string;
  revenue: number;
  pctOfTotal: number | null;
  invoiceCount: number;
  avgTicket: number | null;
}

/**
 * Four-row service-type breakdown. emergency/standard split is per
 * invoice (an invoice is "emergency" if it has at least one line item
 * priced at the customer's emergencyLaborRate). contract/adhoc split is
 * by `customer.contractType != null && != ''`.
 */
export function computeByServiceType(input: {
  invoices: InvoiceLike[];
  items: InvoiceItemLike[];
  customersById: Map<number, CustomerLike>;
  window: { start: Date; end: Date };
}): ServiceTypeRow[] {
  const { invoices, items, customersById, window } = input;
  const inWin: InvoiceLike[] = [];
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!inWindow(d, window.start, window.end)) continue;
    inWin.push(inv);
  }
  const itemsByInvoice = new Map<number, InvoiceItemLike[]>();
  for (const it of items) {
    if (it.invoiceId == null) continue;
    const arr = itemsByInvoice.get(it.invoiceId) ?? [];
    arr.push(it);
    itemsByInvoice.set(it.invoiceId, arr);
  }
  const buckets = {
    emergency: { revenue: 0, count: 0 },
    standard: { revenue: 0, count: 0 },
    contract: { revenue: 0, count: 0 },
    adhoc: { revenue: 0, count: 0 },
  };
  for (const inv of inWin) {
    const total = toNum(inv.totalAmount);
    const c = customersById.get(inv.customerId);
    const emergencyRate =
      c?.emergencyLaborRate == null || c?.emergencyLaborRate === ""
        ? null
        : toNum(c.emergencyLaborRate);
    const lines = itemsByInvoice.get(inv.id) ?? [];
    let isEmergency = false;
    if (emergencyRate != null) {
      for (const it of lines) {
        const rate = it.laborRate == null ? null : toNum(it.laborRate);
        if (rate != null && Math.abs(rate - emergencyRate) < 0.005) {
          isEmergency = true;
          break;
        }
      }
    }
    if (isEmergency) {
      buckets.emergency.revenue += total;
      buckets.emergency.count += 1;
    } else {
      buckets.standard.revenue += total;
      buckets.standard.count += 1;
    }
    const ctype = c?.contractType;
    if (ctype != null && ctype !== "") {
      buckets.contract.revenue += total;
      buckets.contract.count += 1;
    } else {
      buckets.adhoc.revenue += total;
      buckets.adhoc.count += 1;
    }
  }
  const total = inWin.reduce((s, inv) => s + toNum(inv.totalAmount), 0);
  const mk = (
    key: ServiceTypeRow["key"],
    label: string,
    b: { revenue: number; count: number },
  ): ServiceTypeRow => ({
    key,
    label,
    revenue: b.revenue,
    pctOfTotal: total > 0 ? (b.revenue / total) * 100 : null,
    invoiceCount: b.count,
    avgTicket: b.count > 0 ? b.revenue / b.count : null,
  });
  return [
    mk("emergency", "Emergency", buckets.emergency),
    mk("standard", "Standard", buckets.standard),
    mk("contract", "Contract", buckets.contract),
    mk("adhoc", "Ad-hoc", buckets.adhoc),
  ];
}

export function computeRevenueMix(input: {
  invoices: InvoiceLike[];
  items: InvoiceItemLike[];
  customersById: Map<number, CustomerLike>;
  window: { start: Date; end: Date };
  // Task #814 — uninvoiced wet check billings add their parts/labor
  // directly to the mix since they're not yet captured in any invoice.
  uninvoicedWetCheckBillings?: WetCheckBillingLike[];
  // Task #814 — WCBs linked to invoices in the window contribute
  // parts/labor costs that may not be reflected in invoice subtotals.
  invoicedWetCheckBillings?: WetCheckBillingLike[];
}): RevenueMixResult {
  const {
    invoices, items, customersById, window,
    uninvoicedWetCheckBillings = [],
    invoicedWetCheckBillings = [],
  } = input;
  const invoiceIdsInWindow = new Set<number>();
  let parts = 0;
  let labor = 0;
  let contract = 0;
  let adhoc = 0;
  for (const inv of invoices) {
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const d = toDate(inv.createdAt);
    if (!inWindow(d, window.start, window.end)) continue;
    invoiceIdsInWindow.add(inv.id);
    parts += toNum(inv.partsSubtotal);
    labor += toNum(inv.laborSubtotal);
    const c = customersById.get(inv.customerId);
    const total = toNum(inv.totalAmount);
    if (c?.contractType != null && c.contractType !== "") {
      contract += total;
    } else {
      adhoc += total;
    }
  }
  // Task #814 — uninvoiced WCBs contribute parts/labor to the mix.
  for (const wcb of uninvoicedWetCheckBillings) {
    parts += toNum(wcb.partsSubtotal);
    labor += toNum(wcb.laborSubtotal);
  }
  // Task #814 — invoiced WCBs linked to invoices in the window contribute
  // their parts/labor subtotals (contract/adhoc split stays at invoice level).
  for (const wcb of invoicedWetCheckBillings) {
    parts += toNum(wcb.partsSubtotal);
    labor += toNum(wcb.laborSubtotal);
  }

  // Emergency vs standard — bucket per invoice item, comparing each
  // item's laborRate to the parent customer's emergencyLaborRate. If
  // a single invoice spans both, both buckets collect their slice.
  let emergency = 0;
  let standard = 0;
  // Quick lookup invoice -> customer.emergencyLaborRate
  const emergencyRateByInvoice = new Map<number, number | null>();
  const customerByInvoice = new Map<number, CustomerLike | undefined>();
  for (const inv of invoices) {
    if (!invoiceIdsInWindow.has(inv.id)) continue;
    const c = customersById.get(inv.customerId);
    customerByInvoice.set(inv.id, c);
    const rate = c?.emergencyLaborRate;
    emergencyRateByInvoice.set(
      inv.id,
      rate == null || rate === "" ? null : toNum(rate),
    );
  }
  for (const it of items) {
    if (it.invoiceId == null || !invoiceIdsInWindow.has(it.invoiceId)) continue;
    const lineLabor = toNum(it.laborTotal);
    const lineParts = toNum(it.totalPrice);
    const lineRev = lineLabor + lineParts;
    if (lineRev <= 0) continue;
    const emergencyRate = emergencyRateByInvoice.get(it.invoiceId);
    const itemRate = it.laborRate == null ? null : toNum(it.laborRate);
    const isEmergency =
      emergencyRate != null &&
      itemRate != null &&
      Math.abs(itemRate - emergencyRate) < 0.005;
    if (isEmergency) emergency += lineRev;
    else standard += lineRev;
  }

  return {
    partsVsLabor: { parts, labor },
    emergencyVsStandard: { emergency, standard },
    contractVsAdhoc: { contract, adhoc },
  };
}

// ─── Slice 5.3: Pulse-tab helpers (Task #731) ─────────────────────────────
// isUnbilledWorkRow is defined in Task #730 above (line ~314) — shared with
// computeUnbilledExposure. These interfaces extend it for per-customer/tech
// attribution in the pulse-summary endpoint.

/**
 * Extended WO shape used by the pulse-summary endpoint to enable
 * per-customer and per-tech attribution without extra round-trips.
 */
export interface PulseWorkOrderLike extends WorkOrderBillableLike {
  customerId: number;
  assignedTechnicianId?: number | null;
}

/**
 * Extended BS shape used by the pulse-summary endpoint.
 */
export interface PulseBillingSheetLike extends BillingSheetBillableLike {
  customerId: number;
  technicianId?: number | null;
}

/**
 * Task #814 — Extended WCB shape used by the pulse-summary endpoint.
 * Uses workDate for bucketing (logical work date).
 */
export interface PulseWetCheckBillingLike extends WetCheckBillingBillableLike {
  customerId: number;
  technicianId?: number | null;
}

export interface PulseCustomerRow {
  customerId: number;
  name: string;
  inFlight: number;
  ytd: number;
  budgetStatus: BudgetStatus;
  monthlyCap: number | null;
  monthlySpend: number;
}

export interface PulseTechRow {
  technicianId: number;
  name: string;
  inFlight: number;
  ytd: number;
}

/**
 * Compute per-customer in-flight + YTD rows for the Pulse tab.
 * Customers flagged hiddenFromBilling are excluded.
 *
 * - inFlight: sum of uninvoiced non-cancelled WOs + BSs for this customer
 * - ytd:      sum of invoices in the current calendar year (by invoiceYear)
 * - budgetStatus: classified from monthly spend / cap (same logic as budget-usage)
 */
export function computePulseCustomers(input: {
  customers: CustomerWithBudget[];
  invoices: InvoiceLike[];
  workOrders: PulseWorkOrderLike[];
  billingSheets: PulseBillingSheetLike[];
  // Task #814 — uninvoiced WCBs contribute to inFlight per customer.
  wetCheckBillings?: PulseWetCheckBillingLike[];
  currentYear: number;
  /**
   * Task #2017 — `now` is no longer read here: monthly spend arrives already
   * computed for the canonical calendar-month window. Kept on the input so the
   * Pulse and Accounting call sites stay symmetrical.
   */
  now: Date;
  /**
   * Task #2017 — canonical monthly spend per customer from
   * `computeCustomerSpendBatch`. This helper no longer accumulates it: the
   * loop it replaces summed invoices only (so uninvoiced wet-check work was
   * invisible) over a month window with no upper bound (so a future-dated
   * invoice counted against the current month). Missing ids mean zero spend.
   */
  monthSpendByCustomer: Map<number, number>;
}): PulseCustomerRow[] {
  const {
    customers: custs,
    invoices,
    workOrders,
    billingSheets,
    wetCheckBillings = [],
    currentYear,
    monthSpendByCustomer,
  } = input;

  const ytdByCust = new Map<number, number>();

  for (const inv of invoices) {
    // Task #2013 — one excluded-status set, shared with the Accounting tab.
    // `merged` and `failed` were missing here, so merged invoices were counted
    // twice: once on themselves, once on the surviving invoice.
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    const amt = toNum(inv.totalAmount);
    if ((inv.invoiceYear ?? 0) === currentYear) {
      ytdByCust.set(inv.customerId, (ytdByCust.get(inv.customerId) ?? 0) + amt);
    }
  }

  const inFlightByCust = new Map<number, number>();
  for (const wo of workOrders) {
    if (!isUnbilledWorkRow(wo)) continue;
    inFlightByCust.set(wo.customerId, (inFlightByCust.get(wo.customerId) ?? 0) + toNum(wo.totalAmount));
  }
  for (const bs of billingSheets) {
    if (!isUnbilledWorkRow(bs)) continue;
    inFlightByCust.set(bs.customerId, (inFlightByCust.get(bs.customerId) ?? 0) + toNum(bs.totalAmount));
  }
  // Task #814 — uninvoiced WCBs (no cancelled status, so only invoiceId check).
  for (const wcb of wetCheckBillings) {
    if (wcb.invoiceId != null) continue;
    inFlightByCust.set(wcb.customerId, (inFlightByCust.get(wcb.customerId) ?? 0) + toNum(wcb.totalAmount));
  }

  const out: PulseCustomerRow[] = [];
  for (const c of custs) {
    if (c.hiddenFromBilling) continue;
    const capN = c.monthlyAllocation ??
      (c.monthlyBudgetCap == null || c.monthlyBudgetCap === "" ? null : toNum(c.monthlyBudgetCap));
    // Task #2017 — the one shared spend number, handed in by the endpoint.
    const monthlySpend = monthSpendByCustomer.get(c.id) ?? 0;
    const mPct = capN != null && capN > 0 ? monthlySpend / capN : null;
    const soft = c.budgetSoftThresholdPercent ?? 75;
    const hard = c.budgetHardThresholdPercent ?? 100;
    out.push({
      customerId: c.id,
      name: c.name ?? `Customer #${c.id}`,
      inFlight: inFlightByCust.get(c.id) ?? 0,
      ytd: ytdByCust.get(c.id) ?? 0,
      budgetStatus: classifyBudgetPercent(mPct, soft, hard),
      monthlyCap: capN,
      monthlySpend,
    });
  }
  return out;
}

/**
 * Compute per-technician in-flight + YTD rows for the Pulse tab.
 *
 * - inFlight: sum of uninvoiced non-cancelled WOs (via assignedTechnicianId)
 *             + BSs (via technicianId)
 * - ytd:      revenue from invoices this year whose linked WOs/BSs attribute
 *             to this tech. Each invoice counted at most once per tech to
 *             avoid double-counting when a WO and BS both link to the same
 *             invoice for the same technician.
 */
export function computePulseTechnicians(input: {
  techs: UserWithName[];
  invoices: InvoiceLike[];
  workOrders: PulseWorkOrderLike[];
  billingSheets: PulseBillingSheetLike[];
  // Task #814 — WCBs: invoiced ones credit the invoice amount to technician;
  // uninvoiced ones contribute directly to inFlight.
  wetCheckBillings?: PulseWetCheckBillingLike[];
  currentYear: number;
}): PulseTechRow[] {
  const { techs, invoices, workOrders, billingSheets, wetCheckBillings = [], currentYear } = input;

  const ytdInvoiceAmount = new Map<number, number>();
  for (const inv of invoices) {
    // Task #2013 — one excluded-status set, shared with the Accounting tab.
    if (INVOICE_EXCLUDED_STATUSES.has(inv.status)) continue;
    if ((inv.invoiceYear ?? 0) !== currentYear) continue;
    ytdInvoiceAmount.set(inv.id, toNum(inv.totalAmount));
  }

  const ytdByTech = new Map<number, number>();
  const seenByTech = new Map<number, Set<number>>();

  const creditInvoice = (techId: number, invoiceId: number | null | undefined) => {
    if (invoiceId == null) return;
    const amount = ytdInvoiceAmount.get(invoiceId);
    if (amount == null) return;
    let seen = seenByTech.get(techId);
    if (!seen) { seen = new Set(); seenByTech.set(techId, seen); }
    if (seen.has(invoiceId)) return;
    seen.add(invoiceId);
    ytdByTech.set(techId, (ytdByTech.get(techId) ?? 0) + amount);
  };

  for (const wo of workOrders) {
    if (wo.assignedTechnicianId == null) continue;
    creditInvoice(wo.assignedTechnicianId, wo.invoiceId);
  }
  for (const bs of billingSheets) {
    if (bs.technicianId == null) continue;
    creditInvoice(bs.technicianId, bs.invoiceId);
  }
  // Task #814 — invoiced WCBs credit the invoice to the technician.
  for (const wcb of wetCheckBillings) {
    if (wcb.technicianId == null) continue;
    creditInvoice(wcb.technicianId, wcb.invoiceId);
  }

  const inFlightByTech = new Map<number, number>();
  for (const wo of workOrders) {
    if (!isUnbilledWorkRow(wo) || wo.assignedTechnicianId == null) continue;
    inFlightByTech.set(
      wo.assignedTechnicianId,
      (inFlightByTech.get(wo.assignedTechnicianId) ?? 0) + toNum(wo.totalAmount),
    );
  }
  for (const bs of billingSheets) {
    if (!isUnbilledWorkRow(bs) || bs.technicianId == null) continue;
    inFlightByTech.set(
      bs.technicianId,
      (inFlightByTech.get(bs.technicianId) ?? 0) + toNum(bs.totalAmount),
    );
  }
  // Task #814 — uninvoiced WCBs contribute to technician in-flight.
  for (const wcb of wetCheckBillings) {
    if (wcb.invoiceId != null || wcb.technicianId == null) continue;
    inFlightByTech.set(
      wcb.technicianId,
      (inFlightByTech.get(wcb.technicianId) ?? 0) + toNum(wcb.totalAmount),
    );
  }

  const techById = new Map(techs.map((t) => [t.id, t]));
  const allIds = new Set([...ytdByTech.keys(), ...inFlightByTech.keys()]);
  const out: PulseTechRow[] = [];
  for (const id of allIds) {
    const t = techById.get(id);
    if (!t) continue;
    out.push({
      technicianId: id,
      name: t.name ?? `Tech #${id}`,
      inFlight: inFlightByTech.get(id) ?? 0,
      ytd: ytdByTech.get(id) ?? 0,
    });
  }
  out.sort((a, b) => b.inFlight - a.inFlight);
  return out;
}

/**
 * Task #2014 — percentage of a line's billed parts price charged as cost when
 * the catalog cost is unknown. Overridable with the `DEFAULT_PARTS_COST_PCT`
 * env var, mirroring `DEFAULT_HOURLY_WAGE`. Every dollar estimated this way is
 * reported back on the margin result so the tile can flag it.
 */
export const DEFAULT_PARTS_COST_PCT = 65;

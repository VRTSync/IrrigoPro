// Task #688 — Financial Pulse Slice 2.
//
// Pure math helpers for the /api/financial-pulse/* endpoints. These are
// extracted from the route module so the KPI math can be exercised in a
// vanilla node:test fixture without spinning up Express or Postgres.

export interface InvoiceLike {
  id: number;
  customerId: number;
  totalAmount: string | number;
  partsSubtotal?: string | number | null;
  laborSubtotal?: string | number | null;
  status: string;
  createdAt: Date | string;
  paidAt?: Date | string | null;
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
  totalPartsCost?: string | number | null;
  assignedTechnicianId?: number | null;
  completedByUserId?: number | null;
}

export interface BillingSheetLike {
  invoiceId?: number | null;
  totalHours?: string | number | null;
  partsSubtotal?: string | number | null;
  technicianId?: number | null;
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

export function computeBilled(
  invoices: InvoiceLike[],
  start: Date,
  end: Date,
): number {
  let sum = 0;
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
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
    if (inv.status === "draft" || inv.status === "cancelled") continue;
    const d = toDate(inv.paidAt ?? null);
    if (!inWindow(d, start, end)) continue;
    sum += toNum(inv.totalAmount);
  }
  return sum;
}

export function computeOutstandingAr(invoices: InvoiceLike[]): number {
  let sum = 0;
  for (const inv of invoices) {
    if (
      inv.status === "draft" ||
      inv.status === "cancelled" ||
      inv.status === "paid"
    )
      continue;
    if (inv.paidAt) continue;
    sum += toNum(inv.totalAmount);
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

export function computeProjectedMonthEnd(
  billedMtd: number,
  now: Date,
): number {
  const day = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  if (day <= 0) return billedMtd;
  return (billedMtd / day) * daysInMonth;
}

export interface GrossMarginResult {
  pct: number | null;
  revenue: number;
  partsCost: number;
  laborCost: number;
  missingWageTechCount: number;
}

export function computeGrossMargin(input: {
  invoices: InvoiceLike[];
  workOrders: WorkOrderLike[];
  billingSheets: BillingSheetLike[];
  usersById: Map<number, UserLike>;
  fallbackHourlyWage: number;
  window: { start: Date; end: Date };
}): GrossMarginResult {
  const {
    invoices,
    workOrders,
    billingSheets,
    usersById,
    fallbackHourlyWage,
    window,
  } = input;
  const invoiceIdsInWindow = new Set<number>();
  let revenue = 0;
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
    const d = toDate(inv.createdAt);
    if (!inWindow(d, window.start, window.end)) continue;
    invoiceIdsInWindow.add(inv.id);
    revenue += toNum(inv.totalAmount);
  }

  let partsCost = 0;
  let laborCost = 0;
  const missingWageTechs = new Set<number>();
  const usedFallbackForUnknownTech = { flag: false };

  const tally = (techId: number | null | undefined, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    let wage = fallbackHourlyWage;
    if (techId != null) {
      const u = usersById.get(techId);
      const w = toNum(u?.hourlyWage, NaN);
      if (Number.isFinite(w) && w > 0) {
        wage = w;
      } else {
        missingWageTechs.add(techId);
      }
    } else {
      usedFallbackForUnknownTech.flag = true;
    }
    laborCost += hours * wage;
  };

  for (const wo of workOrders) {
    if (wo.invoiceId == null || !invoiceIdsInWindow.has(wo.invoiceId)) continue;
    partsCost += toNum(wo.totalPartsCost);
    tally(
      wo.assignedTechnicianId ?? wo.completedByUserId ?? null,
      toNum(wo.totalHours),
    );
  }
  for (const bs of billingSheets) {
    if (bs.invoiceId == null || !invoiceIdsInWindow.has(bs.invoiceId)) continue;
    partsCost += toNum(bs.partsSubtotal);
    tally(bs.technicianId ?? null, toNum(bs.totalHours));
  }

  const pct =
    revenue > 0 ? ((revenue - partsCost - laborCost) / revenue) * 100 : null;
  return {
    pct,
    revenue,
    partsCost,
    laborCost,
    missingWageTechCount: missingWageTechs.size,
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
    if (inv.status === "draft" || inv.status === "cancelled") continue;
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

export type AgingBucketKey = "current" | "days30" | "days60" | "days90";
export interface AgingBucket {
  key: AgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

/**
 * A/R aging buckets — Current (<30d), 30 (30–59), 60 (60–89), 90+ (≥90).
 * Uses the same outstanding-invoice filter as `computeOutstandingAr` so
 * the four bucket amounts sum to the Outstanding A/R KPI within
 * rounding. Age is calendar days since `createdAt`.
 */
export function computeArAging(
  invoices: InvoiceLike[],
  now: Date,
): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: "current", label: "Current", amount: 0, count: 0 },
    { key: "days30", label: "30 days", amount: 0, count: 0 },
    { key: "days60", label: "60 days", amount: 0, count: 0 },
    { key: "days90", label: "90+ days", amount: 0, count: 0 },
  ];
  const MS = 24 * 60 * 60 * 1000;
  for (const inv of invoices) {
    if (
      inv.status === "draft" ||
      inv.status === "cancelled" ||
      inv.status === "paid"
    )
      continue;
    if (inv.paidAt) continue;
    const created = toDate(inv.createdAt);
    if (!created) continue;
    const age = (now.getTime() - created.getTime()) / MS;
    const i = age < 30 ? 0 : age < 60 ? 1 : age < 90 ? 2 : 3;
    buckets[i].amount += toNum(inv.totalAmount);
    buckets[i].count += 1;
  }
  return buckets;
}

export interface BudgetFields {
  monthlyBudgetCap?: string | number | null;
  annualBudgetCap?: string | number | null;
  budgetSoftThresholdPercent?: number | null;
  budgetHardThresholdPercent?: number | null;
}

export type BudgetStatus = "unset" | "healthy" | "approaching" | "over";

export function classifyStatus(
  percent: number | null,
  soft: number,
  hard: number,
): BudgetStatus {
  if (percent == null) return "unset";
  const p = percent * 100;
  if (p >= hard) return "over";
  if (p >= soft) return "approaching";
  return "healthy";
}

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

export function computeTopCustomers(input: {
  customers: CustomerWithBudget[];
  invoices: InvoiceLike[];
  window: { start: Date; end: Date };
  now: Date;
}): TopCustomerRow[] {
  const { customers: custs, invoices, window, now } = input;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getTime() + 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getTime() + 1);
  const sparkStarts = getMonthStarts(now, 7);
  const sparkKeys = sparkStarts.map(
    (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
  );
  const sparkIdx = new Map(sparkKeys.map((k, i) => [k, i]));

  const byCust = new Map<
    number,
    {
      revenue: number;
      monthSpend: number;
      yearSpend: number;
      spark: number[];
      lastInvoiceAt: Date | null;
      payDays: { sum: number; n: number };
    }
  >();
  const ninetyAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
    const d = toDate(inv.createdAt);
    if (!d) continue;
    const total = toNum(inv.totalAmount);
    let row = byCust.get(inv.customerId);
    if (!row) {
      row = {
        revenue: 0,
        monthSpend: 0,
        yearSpend: 0,
        spark: new Array(sparkStarts.length).fill(0),
        lastInvoiceAt: null,
        payDays: { sum: 0, n: 0 },
      };
      byCust.set(inv.customerId, row);
    }
    if (d >= window.start && d < window.end) row.revenue += total;
    if (d >= monthStart && d < monthEnd) row.monthSpend += total;
    if (d >= yearStart && d < yearEnd) row.yearSpend += total;
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
    const monthSpend = r?.monthSpend ?? 0;
    const yearSpend = r?.yearSpend ?? 0;
    const mCap = c.monthlyBudgetCap == null || c.monthlyBudgetCap === ""
      ? null
      : toNum(c.monthlyBudgetCap);
    const aCap = c.annualBudgetCap == null || c.annualBudgetCap === ""
      ? null
      : toNum(c.annualBudgetCap);
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
      monthlyStatus: classifyStatus(mPct, soft, hard),
      annualCap: aCap,
      annualSpend: yearSpend,
      annualUsedPct: aPct,
      annualStatus: classifyStatus(aPct, soft, hard),
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
  window: { start: Date; end: Date };
}): TechnicianRow[] {
  const { techs, invoices, workOrders, billingSheets, window } = input;
  const invoiceIdsInWindow = new Set<number>();
  const invoiceById = new Map<number, InvoiceLike>();
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
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
  }
  const acc = new Map<number, Acc>();
  const ensure = (id: number): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { hours: 0, invoiceIds: new Set(), woCount: 0, bsCount: 0 };
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
    if (inv.status === "draft" || inv.status === "cancelled") continue;
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
}): RevenueMixResult {
  const { invoices, items, customersById, window } = input;
  const invoiceIdsInWindow = new Set<number>();
  let parts = 0;
  let labor = 0;
  let contract = 0;
  let adhoc = 0;
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
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

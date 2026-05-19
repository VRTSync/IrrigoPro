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
  let sum = 0;
  for (const inv of invoices) {
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

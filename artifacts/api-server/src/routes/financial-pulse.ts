// Task #688 — Financial Pulse Slice 2.
//
// Three read-only endpoints under /api/financial-pulse/* powering the
// /financial-pulse dashboard for company_admin / billing_manager /
// super_admin. Field techs and irrigation managers get a hard 403 —
// these tiles surface money, margin, and per-tech wage info that must
// not leak to roles whose UI strips pricing.

import type { Express, Request, RequestHandler } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  billingSheets,
  customers,
  invoiceItems,
  invoices,
  users,
  workOrders,
} from "@workspace/db/schema";
import {
  bucketMonthlyRevenue,
  computeAllBillableYtd,
  computeArAging,
  computeAvgDaysToPay,
  computeBilled,
  computeBilledForCycle,
  computeByServiceType,
  computeByTechnician,
  computeCollected,
  computeGrossMargin,
  computeOutstandingAr,
  computeProjectedMonthEnd,
  computeRevenueMix,
  computeTopCustomers,
  getDistinctBillingCycles,
  getMonthStarts,
  getMtdWindow,
  getPrevMonthWindow,
  getPrevFullMonthWindow,
  getPrevYearYtdWindow,
  getYtdWindow,
  pctDelta,
  sortTopCustomers,
  type BillingSheetBillableLike,
  type CustomerWithBudget,
  type InvoiceLike,
  type UserLike,
  type UserWithName,
  type WorkOrderBillableLike,
  type WorkOrderLike,
  type BillingSheetLike,
  type CustomerLike,
  type InvoiceItemLike,
  type TopCustomerRow,
  type TechnicianRow,
  type ServiceTypeRow,
} from "../financial-pulse-math";

const ALLOWED_ROLES = new Set([
  "super_admin",
  "company_admin",
  "billing_manager",
]);

const DEFAULT_FALLBACK_HOURLY_WAGE = 25;

function fallbackHourlyWage(): number {
  const raw = process.env.DEFAULT_HOURLY_WAGE;
  if (!raw) return DEFAULT_FALLBACK_HOURLY_WAGE;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FALLBACK_HOURLY_WAGE;
}

export interface ResolvedScope {
  status: 200 | 400 | 403;
  body?: { message: string };
  companyId: number | null; // null = global (super_admin)
}

// `?asOf=YYYY-MM-DD` — optional, accepted by all three endpoints. v1
// ignores the value for computation (everything anchors to "now"); we
// still validate the shape so a future slice can light it up without
// breaking client contracts. Returns { ok: true } when the param is
// either absent or a well-formed date, and { ok: false } when the
// caller sent something non-conforming.
export function parseAsOfParam(
  raw: string | undefined,
): { ok: true } | { ok: false; message: string } {
  if (raw == null || raw === "") return { ok: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return { ok: false, message: "asOf must be YYYY-MM-DD" };
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()))
    return { ok: false, message: "asOf is not a valid date" };
  return { ok: true };
}

// Strict period validation. KPIs + revenue-mix accept exactly "mtd"
// or "ytd". An absent param defaults to "mtd". Anything else is a
// 400 — we intentionally do NOT silently coerce so client / server
// stay in sync on the contract.
export type FinancialPulsePeriod = "mtd" | "ytd";
export function parsePeriodParam(
  raw: string | undefined,
):
  | { ok: true; value: FinancialPulsePeriod }
  | { ok: false; message: string } {
  if (raw == null || raw === "") return { ok: true, value: "mtd" };
  if (raw === "mtd" || raw === "ytd") return { ok: true, value: raw };
  return { ok: false, message: "period must be 'mtd' or 'ytd'" };
}

export function resolveFinancialPulseScope(
  role: string | undefined,
  callerCompanyId: number | null | undefined,
  queryCompanyId: string | undefined,
): ResolvedScope {
  if (!role || !ALLOWED_ROLES.has(role)) {
    return { status: 403, body: { message: "Forbidden" }, companyId: -1 };
  }
  if (role === "super_admin") {
    if (queryCompanyId != null && queryCompanyId !== "") {
      const n = parseInt(String(queryCompanyId), 10);
      if (!Number.isFinite(n) || n <= 0) {
        return {
          status: 400,
          body: { message: "Invalid companyId" },
          companyId: -1,
        };
      }
      return { status: 200, companyId: n };
    }
    return { status: 200, companyId: null };
  }
  if (callerCompanyId == null) {
    return {
      status: 403,
      body: { message: "User is not associated with a company" },
      companyId: -1,
    };
  }
  return { status: 200, companyId: callerCompanyId };
}

async function loadCustomers(
  companyId: number | null,
): Promise<CustomerWithBudget[]> {
  const rows = companyId == null
    ? await db.select().from(customers)
    : await db.select().from(customers).where(eq(customers.companyId, companyId));
  return rows.map((c) => ({
    id: c.id,
    companyId: c.companyId,
    contractType: c.contractType ?? null,
    emergencyLaborRate: c.emergencyLaborRate ?? null,
    name: c.name ?? null,
    hiddenFromBilling: c.hiddenFromBilling ?? false,
    monthlyBudgetCap: c.monthlyBudgetCap ?? null,
    annualBudgetCap: c.annualBudgetCap ?? null,
    budgetSoftThresholdPercent: c.budgetSoftThresholdPercent ?? null,
    budgetHardThresholdPercent: c.budgetHardThresholdPercent ?? null,
  }));
}

async function loadInvoicesForCustomers(
  customerIds: number[],
): Promise<InvoiceLike[]> {
  if (customerIds.length === 0) return [];
  const rows = await db
    .select()
    .from(invoices)
    .where(inArray(invoices.customerId, customerIds));
  return rows.map((i) => ({
    id: i.id,
    customerId: i.customerId,
    totalAmount: i.totalAmount,
    partsSubtotal: i.partsSubtotal,
    laborSubtotal: i.laborSubtotal,
    status: i.status,
    createdAt: i.createdAt,
    paidAt: i.paidAt,
    // Task #726 — needed for cycle-based billing period lookups.
    invoiceMonth: i.invoiceMonth,
    invoiceYear: i.invoiceYear,
  }));
}

// Task #726 — load all work orders / billing sheets for a customer scope so
// computeAllBillableYtd can include uninvoiced pipeline in the YTD tile.
async function loadAllWorkOrdersForCustomers(
  customerIds: number[],
): Promise<WorkOrderBillableLike[]> {
  if (customerIds.length === 0) return [];
  const rows = await db
    .select({
      invoiceId: workOrders.invoiceId,
      totalAmount: workOrders.totalAmount,
      status: workOrders.status,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .where(inArray(workOrders.customerId, customerIds));
  return rows.map((w) => ({
    invoiceId: w.invoiceId,
    totalAmount: w.totalAmount,
    status: w.status,
    createdAt: w.createdAt,
  }));
}

async function loadAllBillingSheetsForCustomers(
  customerIds: number[],
): Promise<BillingSheetBillableLike[]> {
  if (customerIds.length === 0) return [];
  const rows = await db
    .select({
      invoiceId: billingSheets.invoiceId,
      totalAmount: billingSheets.totalAmount,
      status: billingSheets.status,
      createdAt: billingSheets.createdAt,
    })
    .from(billingSheets)
    .where(inArray(billingSheets.customerId, customerIds));
  return rows.map((b) => ({
    invoiceId: b.invoiceId,
    totalAmount: b.totalAmount,
    status: b.status,
    createdAt: b.createdAt,
  }));
}

async function loadInvoiceItemsForInvoices(
  invoiceIds: number[],
): Promise<InvoiceItemLike[]> {
  if (invoiceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(invoiceItems)
    .where(inArray(invoiceItems.invoiceId, invoiceIds));
  return rows.map((it) => ({
    invoiceId: it.invoiceId,
    laborRate: it.laborRate ?? null,
    laborTotal: it.laborTotal ?? null,
    totalPrice: it.totalPrice ?? null,
  }));
}

async function loadWorkOrdersForInvoices(
  invoiceIds: number[],
): Promise<WorkOrderLike[]> {
  if (invoiceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(workOrders)
    .where(inArray(workOrders.invoiceId, invoiceIds));
  return rows.map((w) => ({
    invoiceId: w.invoiceId,
    totalHours: w.totalHours ?? null,
    totalPartsCost: w.totalPartsCost ?? null,
    assignedTechnicianId: w.assignedTechnicianId ?? null,
    completedByUserId: w.completedByUserId ?? null,
  }));
}

async function loadBillingSheetsForInvoices(
  invoiceIds: number[],
): Promise<BillingSheetLike[]> {
  if (invoiceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(billingSheets)
    .where(inArray(billingSheets.invoiceId, invoiceIds));
  return rows.map((b) => ({
    invoiceId: b.invoiceId,
    totalHours: b.totalHours ?? null,
    partsSubtotal: b.partsSubtotal ?? null,
    technicianId: b.technicianId ?? null,
  }));
}

async function loadTechs(companyId: number | null): Promise<UserWithName[]> {
  const rows = companyId == null
    ? await db.select().from(users)
    : await db.select().from(users).where(eq(users.companyId, companyId));
  return rows.map((u) => ({
    id: u.id,
    hourlyWage: u.hourlyWage ?? null,
    name: u.name ?? null,
    role: u.role ?? null,
  }));
}

// Unbilled exposure — mirrors the billing-preview rollup
// (`/api/customers/billing-preview` in routes.ts, lines ~6014-6128):
// `approvedTotal` (status=`approved_passed_to_billing`, no invoiceId)
// plus `unapprovedTotal` (work orders pending review / completed and
// billing sheets pending review / completed / submitted, no invoiceId).
// Critically, customers with `hiddenFromBilling=true` are excluded
// from the scope so a long-tail of suppressed customers can't inflate
// the KPI.
async function computeUnbilledExposure(
  companyId: number | null,
): Promise<number> {
  // Get all customer ids in scope, then sum totalAmount on work_orders /
  // billing_sheets that are in an unbilled status and have no invoice id.
  // EXCLUDE customers flagged hiddenFromBilling — parity with the
  // `/api/customers/billing-preview` rollup which filters the same way.
  const cidRows = companyId == null
    ? await db
        .select({ id: customers.id, hiddenFromBilling: customers.hiddenFromBilling })
        .from(customers)
    : await db
        .select({ id: customers.id, hiddenFromBilling: customers.hiddenFromBilling })
        .from(customers)
        .where(eq(customers.companyId, companyId));
  const customerIds = cidRows
    .filter((r) => !r.hiddenFromBilling)
    .map((r) => r.id);
  if (customerIds.length === 0) return 0;

  const woRows = await db
    .select({ total: workOrders.totalAmount, status: workOrders.status, invoiceId: workOrders.invoiceId })
    .from(workOrders)
    .where(inArray(workOrders.customerId, customerIds));
  const bsRows = await db
    .select({ total: billingSheets.totalAmount, status: billingSheets.status, invoiceId: billingSheets.invoiceId })
    .from(billingSheets)
    .where(inArray(billingSheets.customerId, customerIds));

  // Task #726 — Tile 6 "Unbilled Pipeline": include ALL uninvoiced rows
  // except cancelled. The prior narrow status allowlist
  // (approved_passed_to_billing / pending_manager_review / work_completed /
  // submitted / completed) significantly undercounted the pipeline by
  // excluding in-progress, draft, assigned, and other active statuses.
  // The only exclusion is invoiceId IS NOT NULL (already billed) and
  // status = 'cancelled' (explicitly abandoned). Hidden-from-billing
  // customers are still excluded so suppressed accounts don't inflate KPIs.

  let sum = 0;
  const toN = (v: unknown) => {
    if (v == null) return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  };
  for (const w of woRows) {
    if (w.invoiceId != null) continue;
    if (w.status === "cancelled") continue;
    sum += toN(w.total);
  }
  for (const b of bsRows) {
    if (b.invoiceId != null) continue;
    if (b.status === "cancelled") continue;
    sum += toN(b.total);
  }
  return sum;
}

export interface RegisterFinancialPulseDeps {
  requireAuthentication: RequestHandler;
}

export function registerFinancialPulseRoutes(
  app: Express,
  { requireAuthentication }: RegisterFinancialPulseDeps,
): void {
  // ─── KPIs ────────────────────────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/kpis",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const role = (req as any).authenticatedUserRole as string | undefined;
        const callerCompanyId = (req as any).authenticatedUserCompanyId as
          | number
          | null
          | undefined;
        const scope = resolveFinancialPulseScope(
          role,
          callerCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const period = periodParsed.value;
        const now = new Date();

        const cust = await loadCustomers(scope.companyId);
        const customerIds = cust.map((c) => c.id);

        // Load invoices + all WOs/BSs in parallel.
        const [allInvoices, allWos, allBss] = await Promise.all([
          loadInvoicesForCustomers(customerIds),
          loadAllWorkOrdersForCustomers(customerIds),
          loadAllBillingSheetsForCustomers(customerIds),
        ]);

        const mtd = getMtdWindow(now);
        const ytd = getYtdWindow(now);
        const prevMonth = getPrevMonthWindow(now);
        const prevYearYtd = getPrevYearYtdWindow(now);

        const billedMtd = computeBilled(allInvoices, mtd.start, mtd.end);
        const billedPrevMonth = computeBilled(
          allInvoices,
          prevMonth.start,
          prevMonth.end,
        );

        // Task #726 — Tile 1: Billed Last Cycle.
        // Uses invoiceMonth/invoiceYear (billing period) instead of createdAt so
        // April invoices created in early May are attributed to the April cycle.
        // Fallback to the previous calendar month is provided so monthLabel /
        // monthIso are always non-empty strings (required by the HTTP contract).
        const prevFullMonth = getPrevFullMonthWindow(now);
        const cycles = getDistinctBillingCycles(allInvoices);
        const lastCycle = cycles[0] ?? null;
        const prevCycle = cycles[1] ?? null;
        const billedLastCycle = lastCycle
          ? computeBilledForCycle(allInvoices, lastCycle)
          : 0;
        const billedCycleBeforeLast = prevCycle
          ? computeBilledForCycle(allInvoices, prevCycle)
          : 0;
        // Resolve the date used for the month label: prefer the actual
        // billing cycle when one exists; fall back to the previous calendar
        // month so the field is always a non-empty string.
        const lastCycleDate = lastCycle
          ? new Date(lastCycle.year, lastCycle.month - 1, 1)
          : prevFullMonth.start;
        const lastCycleMonthLabel = lastCycleDate.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });
        const lastCycleMonthIso = `${lastCycleDate.getFullYear()}-${String(
          lastCycleDate.getMonth() + 1,
        ).padStart(2, "0")}`;

        // Task #726 — Tile 5: Billed YTD.
        // Sums all invoiced revenue (by invoiceYear) + uninvoiced WO/BS pipeline
        // created this year, so the tile captures all billable work regardless of
        // whether an invoice has been issued yet.
        const billedYtd = computeAllBillableYtd(
          allInvoices,
          allWos,
          allBss,
          now.getFullYear(),
        );
        const billedPrevYearYtd = computeBilled(
          allInvoices,
          prevYearYtd.start,
          prevYearYtd.end,
        );
        const collectedMtd = computeCollected(allInvoices, mtd.start, mtd.end);
        const collectedPrevMonth = computeCollected(
          allInvoices,
          prevMonth.start,
          prevMonth.end,
        );
        const outstandingAr = computeOutstandingAr(allInvoices);
        const avgDaysToPay = computeAvgDaysToPay(allInvoices, now);

        // Task #726 — unbilledExposure must be computed BEFORE projectedMonthEnd
        // because projection now uses the unbilled pipeline as the forecast base
        // instead of billedMtd run-rate.
        const unbilledExposure = await computeUnbilledExposure(
          scope.companyId,
        );

        // Task #726 — Tile 4: Projected Month-End now uses unbilled pipeline
        // (uninvoiced work ÷ days elapsed × days in month) rather than billed
        // invoice run-rate.
        const projectedMonthEnd = computeProjectedMonthEnd(unbilledExposure, now);

        // Gross margin scope follows the period selector.
        const marginWindow = period === "ytd" ? ytd : mtd;
        const invoiceIdsInWindow = allInvoices
          .filter((inv) => {
            if (inv.status === "draft" || inv.status === "cancelled")
              return false;
            const d = inv.createdAt instanceof Date
              ? inv.createdAt
              : new Date(inv.createdAt as unknown as string);
            return d >= marginWindow.start && d < marginWindow.end;
          })
          .map((i) => i.id);
        const wos = await loadWorkOrdersForInvoices(invoiceIdsInWindow);
        const bss = await loadBillingSheetsForInvoices(invoiceIdsInWindow);
        const techs = await loadTechs(scope.companyId);
        const usersById = new Map(techs.map((u) => [u.id, u]));
        const margin = computeGrossMargin({
          invoices: allInvoices,
          workOrders: wos,
          billingSheets: bss,
          usersById,
          fallbackHourlyWage: fallbackHourlyWage(),
          window: marginWindow,
        });

        res.json({
          billedMtd: {
            value: billedMtd,
            deltaPct: pctDelta(billedMtd, billedPrevMonth),
            comparedTo: "prevMonth",
          },
          billedLastCycle: {
            value: billedLastCycle,
            deltaPct: pctDelta(billedLastCycle, billedCycleBeforeLast),
            comparedTo: "prevCycle",
            // Task #726 — label derived from actual billing cycle
            // (invoiceMonth/invoiceYear); falls back to previous calendar
            // month when no invoices exist so the field is always a
            // non-empty string (HTTP contract, see financial-pulse-http.test.ts).
            monthLabel: lastCycleMonthLabel,
            monthIso: lastCycleMonthIso,
          },
          billedYtd: {
            value: billedYtd,
            deltaPct: pctDelta(billedYtd, billedPrevYearYtd),
            comparedTo: "prevYearYtd",
          },
          collectedMtd: {
            value: collectedMtd,
            deltaPct: pctDelta(collectedMtd, collectedPrevMonth),
            comparedTo: "prevMonth",
          },
          outstandingAr: {
            value: outstandingAr,
            deltaPct: null,
            comparedTo: "prevMonth",
          },
          unbilledExposure: {
            value: unbilledExposure,
            deltaPct: null,
            comparedTo: "prevMonth",
          },
          projectedMonthEnd: {
            value: projectedMonthEnd,
            method: "runRate",
          },
          avgDaysToPay: {
            value: avgDaysToPay,
            deltaPct: null,
            comparedTo: "prev90Days",
          },
          grossMarginPct: {
            value: margin.pct,
            deltaPct: null,
            comparedTo: "prevMonth",
            missingWageTechCount: margin.missingWageTechCount,
            revenue: margin.revenue,
            partsCost: margin.partsCost,
            laborCost: margin.laborCost,
          },
          period,
          asOf: now.toISOString(),
        });
      } catch (err) {
        console.error("financial-pulse/kpis error", err);
        res.status(500).json({ message: "Failed to compute KPIs" });
      }
    },
  );

  // ─── Revenue trend ──────────────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/revenue-trend",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const role = (req as any).authenticatedUserRole as string | undefined;
        const callerCompanyId = (req as any).authenticatedUserCompanyId as
          | number
          | null
          | undefined;
        const scope = resolveFinancialPulseScope(
          role,
          callerCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        const months = Math.max(
          1,
          Math.min(36, parseInt(String(req.query.months ?? "13"), 10) || 13),
        );
        const now = new Date();
        const cust = await loadCustomers(scope.companyId);
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);

        const currentStarts = getMonthStarts(now, months);
        const earliest = currentStarts[0];
        const prevYearAnchor = new Date(
          earliest.getFullYear() - 1,
          earliest.getMonth(),
          1,
        );
        const prevStarts = getMonthStarts(
          new Date(now.getFullYear() - 1, now.getMonth(), 1),
          months,
        );

        const current = bucketMonthlyRevenue(allInvoices, currentStarts);
        const prev = bucketMonthlyRevenue(allInvoices, prevStarts);

        const series = current.map((row, i) => ({
          month: row.month,
          revenue: row.revenue,
          partsRevenue: row.partsRevenue,
          laborRevenue: row.laborRevenue,
          prevYearRevenue: prev[i]?.revenue ?? 0,
        }));
        // Touch unused var to satisfy strict TS w/o adding @ts-ignore
        void prevYearAnchor;

        res.json({ series });
      } catch (err) {
        console.error("financial-pulse/revenue-trend error", err);
        res.status(500).json({ message: "Failed to compute revenue trend" });
      }
    },
  );

  // ─── Revenue mix ────────────────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/revenue-mix",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const role = (req as any).authenticatedUserRole as string | undefined;
        const callerCompanyId = (req as any).authenticatedUserCompanyId as
          | number
          | null
          | undefined;
        const scope = resolveFinancialPulseScope(
          role,
          callerCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const period = periodParsed.value;
        const now = new Date();
        const window = period === "ytd" ? getYtdWindow(now) : getMtdWindow(now);

        const cust = await loadCustomers(scope.companyId);
        const customersById = new Map(cust.map((c) => [c.id, c]));
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);
        const invoiceIdsInWindow = allInvoices
          .filter((inv) => {
            if (inv.status === "draft" || inv.status === "cancelled")
              return false;
            const d = inv.createdAt instanceof Date
              ? inv.createdAt
              : new Date(inv.createdAt as unknown as string);
            return d >= window.start && d < window.end;
          })
          .map((i) => i.id);
        const items = await loadInvoiceItemsForInvoices(invoiceIdsInWindow);

        const mix = computeRevenueMix({
          invoices: allInvoices,
          items,
          customersById,
          window,
        });
        res.json({ ...mix, period, asOf: now.toISOString() });
      } catch (err) {
        console.error("financial-pulse/revenue-mix error", err);
        res.status(500).json({ message: "Failed to compute revenue mix" });
      }
    },
  );

  // ─── Slice 3: top-customers ─────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/top-customers",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const scope = resolveFinancialPulseScope(
          (req as any).authenticatedUserRole,
          (req as any).authenticatedUserCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const period = periodParsed.value;
        const sort: "revenue" | "budget_risk" =
          req.query.sort === "budget_risk" ? "budget_risk" : "revenue";
        const limit = Math.max(
          1,
          Math.min(500, parseInt(String(req.query.limit ?? "25"), 10) || 25),
        );
        const now = new Date();
        const window = period === "ytd" ? getYtdWindow(now) : getMtdWindow(now);

        const cust = await loadCustomers(scope.companyId);
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);
        const rows = computeTopCustomers({
          customers: cust,
          invoices: allInvoices,
          window,
          now,
        });
        const sorted = sortTopCustomers(rows, sort).slice(0, limit);

        if (wantsCsv(req)) {
          const filename = `financial-pulse-customers-${csvDateSuffix(period, now)}.csv`;
          sendCsv(res, filename, customersCsv(sorted));
          return;
        }
        res.json({
          rows: sorted,
          total: rows.length,
          period,
          sort,
          asOf: now.toISOString(),
        });
      } catch (err) {
        req.log?.error?.({ err }, "financial-pulse/top-customers error");
        res.status(500).json({ message: "Failed to compute top customers" });
      }
    },
  );

  // ─── Slice 3: by-technician ─────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/by-technician",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const scope = resolveFinancialPulseScope(
          (req as any).authenticatedUserRole,
          (req as any).authenticatedUserCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const period = periodParsed.value;
        const now = new Date();
        const window = period === "ytd" ? getYtdWindow(now) : getMtdWindow(now);

        const cust = await loadCustomers(scope.companyId);
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);
        const invoiceIdsInWindow = allInvoices
          .filter((inv) => {
            if (inv.status === "draft" || inv.status === "cancelled")
              return false;
            const d = inv.createdAt instanceof Date
              ? inv.createdAt
              : new Date(inv.createdAt as unknown as string);
            return d >= window.start && d < window.end;
          })
          .map((i) => i.id);
        const wos = await loadWorkOrdersForInvoices(invoiceIdsInWindow);
        const bss = await loadBillingSheetsForInvoices(invoiceIdsInWindow);
        const techs = await loadTechs(scope.companyId);
        const rows = computeByTechnician({
          techs,
          invoices: allInvoices,
          workOrders: wos,
          billingSheets: bss,
          window,
        });

        if (wantsCsv(req)) {
          const filename = `financial-pulse-technicians-${csvDateSuffix(period, now)}.csv`;
          sendCsv(res, filename, techniciansCsv(rows));
          return;
        }
        res.json({
          rows,
          period,
          asOf: now.toISOString(),
        });
      } catch (err) {
        req.log?.error?.({ err }, "financial-pulse/by-technician error");
        res.status(500).json({ message: "Failed to compute by-technician" });
      }
    },
  );

  // ─── Slice 3: by-service-type ───────────────────────────────────────────
  app.get(
    "/api/financial-pulse/by-service-type",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const scope = resolveFinancialPulseScope(
          (req as any).authenticatedUserRole,
          (req as any).authenticatedUserCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const period = periodParsed.value;
        const now = new Date();
        const window = period === "ytd" ? getYtdWindow(now) : getMtdWindow(now);

        const cust = await loadCustomers(scope.companyId);
        const customersById = new Map(cust.map((c) => [c.id, c]));
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);
        const invoiceIdsInWindow = allInvoices
          .filter((inv) => {
            if (inv.status === "draft" || inv.status === "cancelled")
              return false;
            const d = inv.createdAt instanceof Date
              ? inv.createdAt
              : new Date(inv.createdAt as unknown as string);
            return d >= window.start && d < window.end;
          })
          .map((i) => i.id);
        const items = await loadInvoiceItemsForInvoices(invoiceIdsInWindow);
        const rows = computeByServiceType({
          invoices: allInvoices,
          items,
          customersById,
          window,
        });

        if (wantsCsv(req)) {
          const filename = `financial-pulse-service-type-${csvDateSuffix(period, now)}.csv`;
          sendCsv(res, filename, serviceTypeCsv(rows));
          return;
        }
        res.json({
          rows,
          period,
          asOf: now.toISOString(),
        });
      } catch (err) {
        req.log?.error?.({ err }, "financial-pulse/by-service-type error");
        res.status(500).json({ message: "Failed to compute by-service-type" });
      }
    },
  );

  // ─── Slice 3: A/R aging ─────────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/ar-aging",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const scope = resolveFinancialPulseScope(
          (req as any).authenticatedUserRole,
          (req as any).authenticatedUserCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        // A/R aging is intrinsically a snapshot ("everything currently
        // outstanding"), so `period` doesn't change the math — but we
        // validate and echo it so the Slice 2 period toggle can drive
        // a consistent URL/query key across all five endpoints.
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const now = new Date();
        const cust = await loadCustomers(scope.companyId);
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);
        const buckets = computeArAging(allInvoices, now);
        const total = buckets.reduce((s, b) => s + b.amount, 0);
        res.json({
          buckets,
          total,
          asOf: now.toISOString(),
          period: periodParsed.value,
        });
      } catch (err) {
        req.log?.error?.({ err }, "financial-pulse/ar-aging error");
        res.status(500).json({ message: "Failed to compute A/R aging" });
      }
    },
  );

  // ─── Slice 3: projections ───────────────────────────────────────────────
  app.get(
    "/api/financial-pulse/projections",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const scope = resolveFinancialPulseScope(
          (req as any).authenticatedUserRole,
          (req as any).authenticatedUserCompanyId,
          req.query.companyId as string | undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const asOf = parseAsOfParam(req.query.asOf as string | undefined);
        if (!asOf.ok) {
          res.status(400).json({ message: asOf.message });
          return;
        }
        // Projection math anchors on the current month (run-rate vs prev
        // month at the same day). `period=ytd` additionally surfaces a
        // year-end projection. We still parse and validate the param so
        // the Slice 2 period toggle threads through consistently.
        const periodParsed = parsePeriodParam(
          req.query.period as string | undefined,
        );
        if (!periodParsed.ok) {
          res.status(400).json({ message: periodParsed.message });
          return;
        }
        const now = new Date();
        const cust = await loadCustomers(scope.companyId);
        const customerIds = cust.map((c) => c.id);
        const allInvoices = await loadInvoicesForCustomers(customerIds);
        const mtd = getMtdWindow(now);
        const prevMonth = getPrevMonthWindow(now);
        // Prev month full actual = the entire previous calendar month.
        const prevMonthFullStart = new Date(
          now.getFullYear(),
          now.getMonth() - 1,
          1,
        );
        const prevMonthFullEnd = new Date(
          now.getFullYear(),
          now.getMonth(),
          1,
        );
        const billedMtd = computeBilled(allInvoices, mtd.start, mtd.end);
        const prevMonthActual = computeBilled(
          allInvoices,
          prevMonthFullStart,
          prevMonthFullEnd,
        );
        const prevMonthSameDay = computeBilled(
          allInvoices,
          prevMonth.start,
          prevMonth.end,
        );
        const projected = computeProjectedMonthEnd(billedMtd, now);
        const daysElapsed = now.getDate();
        const daysInMonth = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
        ).getDate();
        res.json({
          mtd: billedMtd,
          projectedMonthEnd: projected,
          prevMonthActual,
          prevMonthSameDay,
          daysElapsed,
          daysInMonth,
          method: "runRate",
          asOf: now.toISOString(),
        });
      } catch (err) {
        req.log?.error?.({ err }, "financial-pulse/projections error");
        res.status(500).json({ message: "Failed to compute projections" });
      }
    },
  );

  // ─── Slice 5: per-customer summary (Task #708) ──────────────────────────
  //
  // Single per-customer slice of Financial Pulse, used by the
  // <FinancialPulseWidget variant="customer-detail" /> on Customer
  // Profile and Customer Billing. Numbers are computed by reusing the
  // existing By Customer logic filtered to a single id — no parallel
  // math. Role guard matches the rest of FP (super_admin /
  // company_admin / billing_manager); company scoping happens through
  // customers.companyId so a non-super-admin cannot pull a customer
  // outside their own tenant.
  app.get(
    "/api/financial-pulse/customer/:id/summary",
    requireAuthentication,
    async (req: Request, res) => {
      try {
        const scope = resolveFinancialPulseScope(
          (req as any).authenticatedUserRole,
          (req as any).authenticatedUserCompanyId,
          undefined,
        );
        if (scope.status !== 200) {
          res.status(scope.status).json(scope.body);
          return;
        }
        const customerId = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(customerId) || customerId <= 0) {
          res.status(400).json({ message: "Invalid customer id" });
          return;
        }
        const custRow = await db
          .select()
          .from(customers)
          .where(eq(customers.id, customerId))
          .limit(1);
        const c = custRow[0];
        if (!c) {
          res.status(404).json({ message: "Customer not found" });
          return;
        }
        // Non-super-admin must own the customer's tenant.
        if (scope.companyId != null && c.companyId !== scope.companyId) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }

        const now = new Date();
        const mtd = getMtdWindow(now);
        const ytd = getYtdWindow(now);
        const allInvoices = await loadInvoicesForCustomers([customerId]);

        const billedMtd = computeBilled(allInvoices, mtd.start, mtd.end);
        const billedYtd = computeBilled(allInvoices, ytd.start, ytd.end);
        const outstandingAr = computeOutstandingAr(allInvoices);
        const avgDaysToPay = computeAvgDaysToPay(allInvoices, now);

        // Unbilled exposure scoped to this customer only — same
        // status sets as `computeUnbilledExposure` above.
        const woRows = await db
          .select({
            total: workOrders.totalAmount,
            status: workOrders.status,
            invoiceId: workOrders.invoiceId,
          })
          .from(workOrders)
          .where(eq(workOrders.customerId, customerId));
        const bsRows = await db
          .select({
            total: billingSheets.totalAmount,
            status: billingSheets.status,
            invoiceId: billingSheets.invoiceId,
          })
          .from(billingSheets)
          .where(eq(billingSheets.customerId, customerId));
        const unbilledWoStatuses = new Set([
          "approved_passed_to_billing",
          "pending_manager_review",
          "work_completed",
        ]);
        const unbilledBsStatuses = new Set([
          "approved_passed_to_billing",
          "pending_manager_review",
          "completed",
          "submitted",
        ]);
        const toN = (v: unknown) => {
          if (v == null) return 0;
          const n = typeof v === "number" ? v : parseFloat(String(v));
          return Number.isFinite(n) ? n : 0;
        };
        let unbilledExposure = 0;
        if (!c.hiddenFromBilling) {
          for (const w of woRows) {
            if (w.invoiceId != null) continue;
            if (!unbilledWoStatuses.has(w.status)) continue;
            unbilledExposure += toN(w.total);
          }
          for (const b of bsRows) {
            if (b.invoiceId != null) continue;
            if (!unbilledBsStatuses.has(b.status)) continue;
            unbilledExposure += toN(b.total);
          }
        }

        // Last invoice date — most recent createdAt across any
        // non-draft/cancelled invoice for this customer.
        let lastInvoiceAt: string | null = null;
        for (const inv of allInvoices) {
          if (inv.status === "draft" || inv.status === "cancelled") continue;
          const d = inv.createdAt instanceof Date
            ? inv.createdAt
            : new Date(inv.createdAt as unknown as string);
          if (Number.isNaN(d.getTime())) continue;
          if (!lastInvoiceAt || d > new Date(lastInvoiceAt)) {
            lastInvoiceAt = d.toISOString();
          }
        }

        // Budget objects — mirror /api/customers/:id/budget-usage
        // shape (monthlyCap/monthlySpend/monthlyPercent/monthlyStatus,
        // same annual). spend is current-month/current-year, same as
        // the Slice 1 BudgetCard.
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const yearStart = new Date(now.getFullYear(), 0, 1);
        let monthSpend = 0;
        let yearSpend = 0;
        for (const inv of allInvoices) {
          if (inv.status === "draft" || inv.status === "cancelled") continue;
          const d = inv.createdAt instanceof Date
            ? inv.createdAt
            : new Date(inv.createdAt as unknown as string);
          if (Number.isNaN(d.getTime())) continue;
          const total = typeof inv.totalAmount === "number"
            ? inv.totalAmount
            : parseFloat(String(inv.totalAmount));
          if (!Number.isFinite(total)) continue;
          if (d >= monthStart) monthSpend += total;
          if (d >= yearStart) yearSpend += total;
        }
        const parseCap = (v: unknown): number | null => {
          if (v == null || v === "") return null;
          const n = typeof v === "number" ? v : parseFloat(String(v));
          return Number.isFinite(n) && n > 0 ? n : null;
        };
        const monthlyCap = parseCap(c.monthlyBudgetCap);
        const annualCap = parseCap(c.annualBudgetCap);
        const soft = c.budgetSoftThresholdPercent ?? 75;
        const hard = c.budgetHardThresholdPercent ?? 100;
        const classify = (
          cap: number | null,
          spend: number,
        ): {
          cap: number | null;
          spend: number;
          percent: number | null;
          status: "unset" | "healthy" | "approaching" | "over";
        } => {
          if (cap == null) {
            return { cap: null, spend, percent: null, status: "unset" };
          }
          const pct = spend / cap;
          const p = pct * 100;
          const status: "healthy" | "approaching" | "over" =
            p >= hard ? "over" : p >= soft ? "approaching" : "healthy";
          return { cap, spend, percent: pct, status };
        };

        res.json({
          customerId,
          name: c.name,
          billedMtd,
          billedYtd,
          outstandingAr,
          unbilledExposure,
          avgDaysToPay,
          lastInvoiceAt,
          monthly: classify(monthlyCap, monthSpend),
          annual: classify(annualCap, yearSpend),
          asOf: now.toISOString(),
        });
      } catch (err) {
        req.log?.error?.({ err }, "financial-pulse/customer-summary error");
        res.status(500).json({ message: "Failed to compute customer summary" });
      }
    },
  );

  // Mark sql import as used to keep the strict-mode lint happy in
  // environments that whine about unused named imports.
  void sql;
  void and;
}

// ─── CSV helpers (Slice 3) ────────────────────────────────────────────────

function wantsCsv(req: Request): boolean {
  const accept = String(req.headers["accept"] ?? "");
  return accept.includes("text/csv") || req.query.format === "csv";
}

function csvDateSuffix(period: "mtd" | "ytd", now: Date): string {
  const y = now.getFullYear();
  if (period === "ytd") return String(y);
  return `${y}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  // Guard against CSV formula injection.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function sendCsv(res: import("express").Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

function customersCsv(rows: TopCustomerRow[]): string {
  const header = csvRow([
    "Customer ID",
    "Name",
    "Revenue",
    "Monthly Cap",
    "Monthly Spend",
    "Monthly Used %",
    "Monthly Status",
    "Annual Cap",
    "Annual Spend",
    "Annual Used %",
    "Annual Status",
    "Avg Days to Pay",
    "Last Invoice At",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.customerId,
      r.name,
      fmtNum(r.revenue),
      fmtNum(r.monthlyCap),
      fmtNum(r.monthlySpend),
      r.monthlyUsedPct == null ? "" : fmtNum(r.monthlyUsedPct * 100, 1),
      r.monthlyStatus,
      fmtNum(r.annualCap),
      fmtNum(r.annualSpend),
      r.annualUsedPct == null ? "" : fmtNum(r.annualUsedPct * 100, 1),
      r.annualStatus,
      fmtNum(r.avgDaysToPay, 1),
      r.lastInvoiceAt ?? "",
    ]),
  );
  return [header, ...body].join("\n") + "\n";
}

function techniciansCsv(rows: TechnicianRow[]): string {
  const header = csvRow([
    "Technician ID",
    "Name",
    "Hours Billed",
    "Revenue",
    "Labor Cost",
    "Margin %",
    "Avg Ticket",
    "# Billing Sheets",
    "# Work Orders",
    "Parts Revenue",
    "Has Wage Set",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.technicianId,
      r.name,
      fmtNum(r.hoursBilled),
      fmtNum(r.revenue),
      r.laborCost == null ? "" : fmtNum(r.laborCost),
      r.marginPct == null ? "" : fmtNum(r.marginPct, 1),
      r.avgTicket == null ? "" : fmtNum(r.avgTicket),
      r.billingSheetCount,
      r.workOrderCount,
      fmtNum(r.partsRevenue),
      r.hasWageSet ? "true" : "false",
    ]),
  );
  return [header, ...body].join("\n") + "\n";
}

function serviceTypeCsv(rows: ServiceTypeRow[]): string {
  const header = csvRow([
    "Key",
    "Label",
    "Revenue",
    "% of Total",
    "# Invoices",
    "Avg Ticket",
  ]);
  const body = rows.map((r) =>
    csvRow([
      r.key,
      r.label,
      fmtNum(r.revenue),
      r.pctOfTotal == null ? "" : fmtNum(r.pctOfTotal, 1),
      r.invoiceCount,
      r.avgTicket == null ? "" : fmtNum(r.avgTicket),
    ]),
  );
  return [header, ...body].join("\n") + "\n";
}

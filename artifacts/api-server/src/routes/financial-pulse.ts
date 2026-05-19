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
  computeAvgDaysToPay,
  computeBilled,
  computeCollected,
  computeGrossMargin,
  computeOutstandingAr,
  computeProjectedMonthEnd,
  computeRevenueMix,
  getMonthStarts,
  getMtdWindow,
  getPrevMonthWindow,
  getPrevYearYtdWindow,
  getYtdWindow,
  pctDelta,
  type InvoiceLike,
  type UserLike,
  type WorkOrderLike,
  type BillingSheetLike,
  type CustomerLike,
  type InvoiceItemLike,
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
): Promise<CustomerLike[]> {
  const rows = companyId == null
    ? await db.select().from(customers)
    : await db.select().from(customers).where(eq(customers.companyId, companyId));
  return rows.map((c) => ({
    id: c.id,
    companyId: c.companyId,
    contractType: c.contractType ?? null,
    emergencyLaborRate: c.emergencyLaborRate ?? null,
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

async function loadTechs(companyId: number | null): Promise<UserLike[]> {
  const rows = companyId == null
    ? await db.select().from(users)
    : await db.select().from(users).where(eq(users.companyId, companyId));
  return rows.map((u) => ({ id: u.id, hourlyWage: u.hourlyWage ?? null }));
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

  let sum = 0;
  const toN = (v: unknown) => {
    if (v == null) return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  };
  for (const w of woRows) {
    if (w.invoiceId != null) continue;
    if (!unbilledWoStatuses.has(w.status)) continue;
    sum += toN(w.total);
  }
  for (const b of bsRows) {
    if (b.invoiceId != null) continue;
    if (!unbilledBsStatuses.has(b.status)) continue;
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
        const allInvoices = await loadInvoicesForCustomers(customerIds);

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
        const billedYtd = computeBilled(allInvoices, ytd.start, ytd.end);
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
        const projectedMonthEnd = computeProjectedMonthEnd(billedMtd, now);
        const avgDaysToPay = computeAvgDaysToPay(allInvoices, now);

        const unbilledExposure = await computeUnbilledExposure(
          scope.companyId,
        );

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

  // Mark sql import as used to keep the strict-mode lint happy in
  // environments that whine about unused named imports.
  void sql;
  void and;
}

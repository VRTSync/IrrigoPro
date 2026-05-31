// Task #1005 — Manager Workspace endpoints.
//
// Contract endpoints that back /manager-workspace:
//   GET /api/manager-workspace/queue
//   GET /api/manager-workspace/status-strip
//
// All endpoints are gated to irrigation_manager / company_admin /
// super_admin; billing_manager receives 403.
// Non-super_admin callers see only their own company's data.

import type { Express, RequestHandler } from "express";
import { and, eq, isNull, isNotNull, inArray } from "drizzle-orm";
import {
  wetChecks,
  wetCheckFindings,
  workOrders,
  billingSheets,
} from "@workspace/db/schema";
import { db } from "../db";
import { storage } from "../storage";

export interface RegisterManagerWorkspaceRoutesDeps {
  requireAuthentication: RequestHandler;
}

const MW_ROLES = new Set([
  "irrigation_manager",
  "company_admin",
  "super_admin",
]);

function isManagerAllowed(req: any): boolean {
  return MW_ROLES.has(String(req.authenticatedUserRole || ""));
}

// Statuses considered "active" for wet checks awaiting manager review.
const ACTIVE_WC = new Set(["submitted", "pending_manager_review"]);
// Work-order statuses manager must act on.
const ACTIVE_WO_FOR_MANAGER = new Set(["pending_manager_review", "work_completed"]);
// Approved status sets for the "approved this week" tile.
const APPROVED_WC = new Set(["approved", "partially_converted", "converted"]);
const APPROVED_WO = new Set([
  "approved",
  "approved_passed_to_billing",
  "billed",
  "completed_approved",
]);
const APPROVED_BS = new Set(["approved", "approved_passed_to_billing", "billed"]);

// A finding is pending routing when none of its three target columns are set.
function isFindingPendingRouting(f: {
  billingSheetId: number | null;
  estimateId: number | null;
  workOrderId: number | null;
}): boolean {
  return f.billingSheetId == null && f.estimateId == null && f.workOrderId == null;
}

function numOr0(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseIntOr(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

// -----------------------------------------------------------------------
// Test override slots — allow unit tests to inject fixtures without a
// live database.  Mirror the _resetFlagsForTests pattern from billing-
// workspace-routes.ts.
// -----------------------------------------------------------------------
let _wetCheckOverride: (() => Promise<any[]>) | null = null;
let _workOrderOverride: (() => Promise<any[]>) | null = null;
let _findingOverride: (() => Promise<any[]>) | null = null;
let _billingSheetOverride: (() => Promise<any[]>) | null = null;

export function _setWetChecksForTests(fn: () => Promise<any[]>): void {
  _wetCheckOverride = fn;
}
export function _setWorkOrdersForTests(fn: () => Promise<any[]>): void {
  _workOrderOverride = fn;
}
export function _setFindingsForTests(fn: () => Promise<any[]>): void {
  _findingOverride = fn;
}
export function _setBilingSheetsForTests(fn: () => Promise<any[]>): void {
  _billingSheetOverride = fn;
}
export function _resetManagerWorkspaceOverridesForTests(): void {
  _wetCheckOverride = null;
  _workOrderOverride = null;
  _findingOverride = null;
  _billingSheetOverride = null;
}

// -----------------------------------------------------------------------
// Scoping helpers
// -----------------------------------------------------------------------

async function scopedWetChecks(req: any): Promise<any[]> {
  if (_wetCheckOverride) return _wetCheckOverride();
  const role = req.authenticatedUserRole;
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  if (role === "super_admin") {
    return await db.select().from(wetChecks);
  }
  if (cid == null) return [];
  return await db
    .select()
    .from(wetChecks)
    .where(eq(wetChecks.companyId, cid));
}

async function scopedWorkOrdersForManager(req: any): Promise<any[]> {
  if (_workOrderOverride) return _workOrderOverride();
  const role = req.authenticatedUserRole;
  const cid0: number | null = req.authenticatedUserCompanyId ?? null;
  const all = await storage.getWorkOrders(role === "super_admin" ? null : cid0);
  if (role === "super_admin") return all as any[];
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  if (cid == null) return [];
  const cache = new Map<number, number | null>();
  const techCid = async (id: number | null | undefined) => {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id) ?? null;
    const u = await storage.getUser(id);
    const c = u?.companyId ?? null;
    cache.set(id, c);
    return c;
  };
  const out: any[] = [];
  for (const w of all as any[]) {
    const c = await techCid(w.assignedTechnicianId);
    if (c === cid) out.push(w);
  }
  return out;
}

async function scopedFindingsNeedingRouting(req: any): Promise<any[]> {
  if (_findingOverride) return _findingOverride();
  const role = req.authenticatedUserRole;
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  if (role !== "super_admin" && cid == null) return [];
  const rows = await db
    .select({
      id: wetCheckFindings.id,
      wetCheckId: wetCheckFindings.wetCheckId,
      issueType: wetCheckFindings.issueType,
      issueGroup: wetCheckFindings.issueGroup,
      severity: wetCheckFindings.severity,
      partPrice: wetCheckFindings.partPrice,
      quantity: wetCheckFindings.quantity,
      resolution: wetCheckFindings.resolution,
      billingSheetId: wetCheckFindings.billingSheetId,
      estimateId: wetCheckFindings.estimateId,
      workOrderId: wetCheckFindings.workOrderId,
      createdAt: wetCheckFindings.createdAt,
      wcCompanyId: wetChecks.companyId,
      customerId: wetChecks.customerId,
      customerName: wetChecks.customerName,
      technicianId: wetChecks.technicianId,
      technicianName: wetChecks.technicianName,
      wcStatus: wetChecks.status,
    })
    .from(wetCheckFindings)
    .innerJoin(wetChecks, eq(wetCheckFindings.wetCheckId, wetChecks.id))
    .where(
      and(
        isNull(wetCheckFindings.billingSheetId),
        isNull(wetCheckFindings.estimateId),
        isNull(wetCheckFindings.workOrderId),
        role !== "super_admin" && cid != null
          ? eq(wetChecks.companyId, cid)
          : undefined,
      ),
    );
  return rows;
}

async function scopedBillingSheets(req: any): Promise<any[]> {
  if (_billingSheetOverride) return _billingSheetOverride();
  const role = req.authenticatedUserRole;
  const cid0: number | null = req.authenticatedUserCompanyId ?? null;
  const all = await storage.getAllBillingSheets(role === "super_admin" ? null : cid0);
  if (role === "super_admin") return all as any[];
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  if (cid == null) return [];
  const cache = new Map<number, number | null>();
  const techCid = async (id: number | null | undefined) => {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id) ?? null;
    const u = await storage.getUser(id);
    const c = u?.companyId ?? null;
    cache.set(id, c);
    return c;
  };
  const out: any[] = [];
  for (const s of all as any[]) {
    const c = await techCid(s.technicianId);
    if (c === cid) out.push(s);
  }
  return out;
}

interface ManagerQueueItem {
  id: string;
  type: "wet_check" | "work_order" | "finding";
  refId: number;
  number: string | null;
  customerId: number | null;
  customerName: string | null;
  technicianId: number | null;
  technicianName: string | null;
  total: number;
  status: string;
  hasPhotos: boolean | null;
  flags: string[];
  ageDays: number | null;
  createdAt: string | null;
  href: string;
  wetCheckId?: number | null;
}

export function registerManagerWorkspaceRoutes(
  app: Express,
  { requireAuthentication }: RegisterManagerWorkspaceRoutesDeps,
): void {
  // -------------------------------------------------------------------
  // GET /api/manager-workspace/queue
  //
  // Query params:
  //   type     : all | wc | wo | finding              (default all)
  //   q        : free-text (number / customer / tech)
  //   customer : numeric customer id
  //   tech     : numeric technician id
  //   age      : <1 | 1-3 | 3-7 | 7+                  (days)
  //   status   : exact status string
  //   sort     : age_desc | age_asc | total_desc | total_asc
  //              | customer | tech                     (default age_desc)
  //   page     : 1-based page number                   (default 1)
  //   pageSize : rows per page                         (default 50, max 200)
  //
  // Response: { items: ManagerQueueItem[], page, pageSize, total }
  // Also sets X-Total-Count.
  // -------------------------------------------------------------------
  app.get(
    "/api/manager-workspace/queue",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isManagerAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }

        const type = String(req.query.type ?? "all").toLowerCase();
        const q = String(req.query.q ?? "").trim().toLowerCase();
        const customerFilter =
          req.query.customer != null && req.query.customer !== ""
            ? parseIntOr(req.query.customer, NaN)
            : NaN;
        const techFilter =
          req.query.tech != null && req.query.tech !== ""
            ? parseIntOr(req.query.tech, NaN)
            : NaN;
        const ageFilter = String(req.query.age ?? "").trim();
        const statusFilter = String(req.query.status ?? "").trim();
        const sort = String(req.query.sort ?? "age_desc").trim();
        const page = Math.max(1, parseIntOr(req.query.page, 1));
        const pageSize = Math.min(200, Math.max(1, parseIntOr(req.query.pageSize, 50)));

        const wantWc = type === "all" || type === "wc";
        const wantWo = type === "all" || type === "wo";
        const wantFinding = type === "all" || type === "finding";

        const now = Date.now();
        const ageDays = (iso: string | null | undefined): number | null => {
          if (!iso) return null;
          const t = new Date(iso).getTime();
          if (!Number.isFinite(t)) return null;
          return Math.floor((now - t) / 86_400_000);
        };

        const items: ManagerQueueItem[] = [];

        if (wantWc) {
          for (const wc of await scopedWetChecks(req)) {
            if (!ACTIVE_WC.has(wc.status)) continue;
            const created = wc.createdAt
              ? new Date(wc.createdAt).toISOString()
              : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (age != null && age > 7) flags.push("stale");
            const wcNumber = wc.workOrderNumber ?? wc.checkNumber ?? null;
            items.push({
              id: `wc-${wc.id}`,
              type: "wet_check",
              refId: wc.id,
              number: wcNumber,
              customerId: wc.customerId ?? null,
              customerName: wc.customerName ?? null,
              technicianId: wc.technicianId ?? null,
              technicianName: wc.technicianName ?? null,
              total: 0,
              status: wc.status,
              hasPhotos: null,
              flags,
              ageDays: age,
              createdAt: created,
              href: `/wet-checks/${wc.id}`,
            });
          }
        }

        if (wantWo) {
          for (const w of await scopedWorkOrdersForManager(req)) {
            if (!ACTIVE_WO_FOR_MANAGER.has(w.status)) continue;
            const photos = Array.isArray(w.photos) ? w.photos : [];
            const created = w.createdAt
              ? new Date(w.createdAt).toISOString()
              : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (photos.length === 0) flags.push("missing_photos");
            if (age != null && age > 7) flags.push("stale");
            items.push({
              id: `wo-${w.id}`,
              type: "work_order",
              refId: w.id,
              number: w.workOrderNumber ?? null,
              customerId: w.customerId ?? null,
              customerName: w.customerName ?? null,
              technicianId: w.assignedTechnicianId ?? null,
              technicianName: w.assignedTechnicianName ?? null,
              total: numOr0(w.totalAmount),
              status: w.status,
              hasPhotos: photos.length > 0,
              flags,
              ageDays: age,
              createdAt: created,
              href: `/work-orders?id=${w.id}`,
            });
          }
        }

        if (wantFinding) {
          for (const f of await scopedFindingsNeedingRouting(req)) {
            if (!isFindingPendingRouting(f)) continue;
            const created = f.createdAt
              ? new Date(f.createdAt).toISOString()
              : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (age != null && age > 7) flags.push("stale");
            const total = numOr0(f.partPrice) * numOr0(f.quantity);
            items.push({
              id: `finding-${f.id}`,
              type: "finding",
              refId: f.id,
              number: null,
              customerId: f.customerId ?? null,
              customerName: f.customerName ?? null,
              technicianId: f.technicianId ?? null,
              technicianName: f.technicianName ?? null,
              total,
              status: f.resolution ?? "pending",
              hasPhotos: null,
              flags,
              ageDays: age,
              createdAt: created,
              href: `/wet-checks/${f.wetCheckId}#finding-${f.id}`,
              wetCheckId: f.wetCheckId ?? null,
            });
          }
        }

        // ---- Filters --------------------------------------------------
        let filtered = items;
        if (q) {
          filtered = filtered.filter((it) => {
            const hay = [it.number, it.customerName, it.technicianName]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          });
        }
        if (Number.isFinite(customerFilter)) {
          filtered = filtered.filter((it) => it.customerId === customerFilter);
        }
        if (Number.isFinite(techFilter)) {
          filtered = filtered.filter(
            (it) => it.technicianId === techFilter,
          );
        }
        if (statusFilter) {
          filtered = filtered.filter((it) => it.status === statusFilter);
        }
        if (ageFilter) {
          filtered = filtered.filter((it) => {
            const a = it.ageDays;
            if (a == null) return false;
            if (ageFilter === "<1") return a < 1;
            if (ageFilter === "1-3") return a >= 1 && a < 3;
            if (ageFilter === "3-7") return a >= 3 && a < 7;
            if (ageFilter === "7+") return a >= 7;
            return true;
          });
        }

        // ---- Sort -----------------------------------------------------
        const cmpStr = (a: string | null, b: string | null) =>
          (a ?? "").localeCompare(b ?? "");
        filtered.sort((a, b) => {
          switch (sort) {
            case "age_asc":
              return (a.ageDays ?? -1) - (b.ageDays ?? -1);
            case "total_desc":
              return b.total - a.total;
            case "total_asc":
              return a.total - b.total;
            case "customer":
              return cmpStr(a.customerName, b.customerName);
            case "tech":
              return cmpStr(a.technicianName, b.technicianName);
            case "age_desc":
            default:
              return (b.ageDays ?? -1) - (a.ageDays ?? -1);
          }
        });

        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const slice = filtered.slice(start, start + pageSize);

        res.setHeader("X-Total-Count", String(total));
        res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
        res.json({ items: slice, page, pageSize, total });
      } catch (error) {
        req.log?.error?.({ err: error }, "manager-workspace queue failed");
        res.status(500).json({ message: "Failed to load manager queue" });
      }
    },
  );

  // -------------------------------------------------------------------
  // GET /api/manager-workspace/status-strip
  //
  // Four indicators:
  //   wcsPendingReview     — WCs in ACTIVE_WC statuses
  //   wosAwaitingApproval  — WOs in ACTIVE_WO_FOR_MANAGER statuses
  //   findingsNeedingRouting — unrouted findings (no target set)
  //   approvedThisWeek     — WCs + WOs + BSs approved since Monday 00:00 UTC
  //                          of the current ISO week
  // -------------------------------------------------------------------
  app.get(
    "/api/manager-workspace/status-strip",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isManagerAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }

        const [wcs, wos, findings, bss] = await Promise.all([
          scopedWetChecks(req),
          scopedWorkOrdersForManager(req),
          scopedFindingsNeedingRouting(req),
          scopedBillingSheets(req),
        ]);

        const now = Date.now();
        // ISO week boundary: Monday 00:00:00 UTC of the current week.
        const isoWeekStart = (() => {
          const d = new Date(now);
          const day = d.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
          const daysToMonday = day === 0 ? 6 : day - 1;
          d.setUTCDate(d.getUTCDate() - daysToMonday);
          d.setUTCHours(0, 0, 0, 0);
          return d.getTime();
        })();
        const tsOf = (v: any): number => {
          if (!v) return NaN;
          const t = new Date(v).getTime();
          return Number.isFinite(t) ? t : NaN;
        };

        const activeWcs = wcs.filter((w) => ACTIVE_WC.has(w.status));
        const activeWos = wos.filter((w) => ACTIVE_WO_FOR_MANAGER.has(w.status));
        const activeFindings = findings.filter((f) => isFindingPendingRouting(f));

        const wcsPendingReview = activeWcs.length;
        const wosAwaitingApproval = activeWos.length;
        const findingsNeedingRouting = activeFindings.length;

        const approvedThisWeek =
          wcs.filter(
            (w) =>
              APPROVED_WC.has(w.status) &&
              tsOf(w.approvedAt ?? w.updatedAt) >= isoWeekStart,
          ).length +
          wos.filter(
            (w) =>
              APPROVED_WO.has(w.status) &&
              tsOf(w.approvedAt ?? w.updatedAt) >= isoWeekStart,
          ).length +
          bss.filter(
            (s) =>
              APPROVED_BS.has(s.status) &&
              tsOf(s.approvedAt ?? s.updatedAt) >= isoWeekStart,
          ).length;

        // Compute oldest createdAt for each active indicator bucket,
        // expressed as fractional hours ago.  null means no rows.
        const oldestHours = (rows: any[]): number | null => {
          let oldest: number | null = null;
          for (const r of rows) {
            const t = tsOf(r.createdAt);
            if (!Number.isFinite(t)) continue;
            if (oldest === null || t < oldest) oldest = t;
          }
          if (oldest === null) return null;
          return (now - oldest) / 3_600_000;
        };

        res.json({
          indicators: {
            wcsPendingReview,
            wosAwaitingApproval,
            findingsNeedingRouting,
            approvedThisWeek,
          },
          oldestAgeHours: {
            wcsPendingReview: oldestHours(activeWcs),
            wosAwaitingApproval: oldestHours(activeWos),
            findingsNeedingRouting: oldestHours(activeFindings),
          },
        });
      } catch (error) {
        req.log?.error?.({ err: error }, "manager-workspace status-strip failed");
        res.status(500).json({ message: "Failed to load manager status strip" });
      }
    },
  );
}

// Task #709 — Billing Workspace endpoints.
//
// Contract endpoints that back /billing-workspace:
//   GET /api/billing-workspace/queue
//   GET /api/billing-workspace/status-strip
//   GET /api/quickbooks/overdue-summary
//
// All endpoints are gated to billing_manager / company_admin /
// super_admin and tenant-scoped through the authenticated user's
// company id (super_admin gets the global view).

import type { Express, RequestHandler } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  customers,
  estimates,
  invoices,
  quickbooksIntegration,
  quickbooksSync,
} from "@workspace/db/schema";
import { db } from "../db";
import { storage } from "../storage";
// Task #2027 — one QuickBooks verdict for every surface. This file renders it.
import {
  getScopedSyncRows,
  loadQbSyncStatus,
  loadQuickBooksHealth,
  resolveQbScope,
  type QuickBooksHealth,
} from "./quickbooks-health";

export interface RegisterBillingWorkspaceRoutesDeps {
  requireAuthentication: RequestHandler;
}

// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
const BW_ROLES = new Set([
  "billing_manager",
  "company_admin",
  "super_admin",
  "irrigation_manager",
]);

function isAllowed(req: any): boolean {
  return BW_ROLES.has(String(req.authenticatedUserRole || ""));
}

// Statuses considered "active" / awaiting approval.
export const ACTIVE_BS = new Set([
  "pending_manager_review",
  "submitted",
  "completed",
]);
export const ACTIVE_WO = new Set([
  "pending_manager_review",
  "work_completed",
]);
export const ACTIVE_WCB = new Set([
  "submitted",
  "pending_manager_review",
  // WCBs are born at approved_passed_to_billing (no separate approval step),
  // so this is where they live until invoiced — they still need billing action.
  "approved_passed_to_billing",
]);
// Snapshot states that still need MANAGER APPROVAL (pre-approval only).
// Distinct from ACTIVE_WCB, which also includes approved_passed_to_billing
// (approved, awaiting invoicing — a billing concern, not a review concern).
export const PENDING_REVIEW_WCB = new Set(["submitted", "pending_manager_review"]);
// Approved (this week tile).
export const APPROVED_BS = new Set(["approved", "billed", "invoiced"]);
export const APPROVED_WO = new Set(["approved", "billed", "invoiced", "completed_approved"]);
// NOTE: approved_passed_to_billing is intentionally absent here — it lives in
// ACTIVE_WCB above. ACTIVE_* and APPROVED_* must remain disjoint per tile.
export const APPROVED_WCB = new Set(["billed"]);
// Draft states (last 24h tile).
export const DRAFT_BS = new Set(["draft", "in_progress"]);
export const DRAFT_WO = new Set(["draft", "scheduled", "in_progress"]);

function numOr0(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseIntOr(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

export async function scopedWetCheckBillings(req: any): Promise<any[]> {
  const role = req.authenticatedUserRole;
  const all = await storage.getAllWetCheckBillingsWithCounts();
  if (role === "super_admin") return all as any[];
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  if (cid == null) return [];
  const cache = new Map<number, number | null>();
  const custCid = async (id: number | null | undefined) => {
    if (!id) return null;
    if (cache.has(id)) return cache.get(id) ?? null;
    const c = await storage.getCustomer(id);
    const companyId = c?.companyId ?? null;
    cache.set(id, companyId);
    return companyId;
  };
  const out: any[] = [];
  for (const w of all as any[]) {
    const c = await custCid(w.customerId);
    if (c === cid) out.push(w);
  }
  return out;
}

export async function scopedBillingSheets(req: any): Promise<any[]> {
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

export async function scopedWorkOrders(req: any): Promise<any[]> {
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

interface QueueItem {
  id: string;
  type: "billing_sheet" | "work_order" | "wet_check_billing" | "part" | "manual_review";
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

// ---------------------------------------------------------------
// Overdue-summary 15-minute in-process cache
// ---------------------------------------------------------------
interface OverdueCacheEntry {
  expiresAt: number;
  body: { overdueCount: number; overdueAmount: number; agingReportUrl: string; asOf: string };
}
const OVERDUE_CACHE = new Map<string, OverdueCacheEntry>();
const OVERDUE_TTL_MS = 15 * 60 * 1000;

// In-memory follow-up flag store. Best-effort, per-process.
interface FlagEntry {
  id: string;
  type: string;
  refId: number;
  note: string | null;
  flaggedAt: string;
  flaggedBy: number | null;
}
const BW_FLAGS = new Map<string, FlagEntry>();
export function _resetFlagsForTests(): void { BW_FLAGS.clear(); }

export function _resetOverdueCacheForTests(): void {
  OVERDUE_CACHE.clear();
}

// ---------------------------------------------------------------
// QuickBooks sync status — Task #715, consolidated by Task #2027.
//
// The derivation moved to ./quickbooks-health, which is now the one
// place any surface decides whether QuickBooks is healthy. This file
// only renders it.
// ---------------------------------------------------------------

export function registerBillingWorkspaceRoutes(
  app: Express,
  { requireAuthentication }: RegisterBillingWorkspaceRoutesDeps,
): void {
  // -------------------------------------------------------------
  // 301 redirects from legacy paths.
  //
  // The task requires HTTP 301s so any bookmark / external link
  // lands on the new workspace. Mounted before the SPA's catch-all
  // so they fire even though the same paths also exist as client
  // routes (the client redirects are kept as a safety net for
  // SPAs that bypass the server, e.g. cached HTML).
  // -------------------------------------------------------------
  for (const legacy of ["/billing-dashboard", "/billing", "/billing/dashboard"]) {
    app.get(legacy, (_req, res) => {
      res.redirect(301, "/billing-workspace");
    });
  }

  // -------------------------------------------------------------
  // GET /api/billing-workspace/queue
  //
  // Query params:
  //   type      : all | bs | wo | part | review            (default all)
  //   q         : free-text substring (number / customer / tech)
  //   customer  : numeric customer id
  //   tech      : numeric technician id
  //   age       : <1 | 1-3 | 3-7 | 7+                       (days)
  //   status    : exact status string (filters by row.status)
  //   sort      : age_desc | age_asc | total_desc | total_asc
  //               | customer | tech                        (default age_desc)
  //   page      : 1-based page number                       (default 1)
  //   pageSize  : rows per page                             (default 50, max 200)
  //
  // Response: { items: QueueItem[], page, pageSize, total }
  // Also sets X-Total-Count for clients using useInfiniteQuery.
  // -------------------------------------------------------------
  app.get(
    "/api/billing-workspace/queue",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }
        const type = String(req.query.type ?? "all").toLowerCase();
        const q = String(req.query.q ?? "").trim().toLowerCase();
        const customerFilter = req.query.customer != null && req.query.customer !== ""
          ? parseIntOr(req.query.customer, NaN) : NaN;
        const techFilter = req.query.tech != null && req.query.tech !== ""
          ? parseIntOr(req.query.tech, NaN) : NaN;
        const ageFilter = String(req.query.age ?? "").trim();
        const statusFilter = String(req.query.status ?? "").trim();
        const sort = String(req.query.sort ?? "age_desc").trim();
        const page = Math.max(1, parseIntOr(req.query.page, 1));
        const pageSize = Math.min(200, Math.max(1, parseIntOr(req.query.pageSize, 50)));

        const wantBs = type === "all" || type === "bs";
        const wantWcb = type === "all" || type === "wcb";
        const wantWo = type === "all" || type === "wo";
        const wantParts = type === "all" || type === "part";
        const wantReview = type === "all" || type === "review";

        const now = Date.now();
        const ageDays = (iso: string | null | undefined): number | null => {
          if (!iso) return null;
          const t = new Date(iso).getTime();
          if (!Number.isFinite(t)) return null;
          return Math.floor((now - t) / 86_400_000);
        };

        const items: QueueItem[] = [];

        if (wantBs) {
          for (const s of await scopedBillingSheets(req)) {
            // When an explicit status filter is requested (e.g. drill-down to
            // approved items from Customer Billing), include rows that match
            // it even if they are outside the default ACTIVE set.
            if (!ACTIVE_BS.has(s.status) && !(statusFilter && s.status === statusFilter)) continue;
            const photos = Array.isArray(s.photos) ? s.photos : [];
            const flags: string[] = [];
            if (photos.length === 0) flags.push("missing_photos");
            const created = s.createdAt ? new Date(s.createdAt).toISOString() : null;
            const age = ageDays(created);
            if (age != null && age > 7) flags.push("stale");
            items.push({
              id: `bs-${s.id}`,
              type: "billing_sheet",
              refId: s.id,
              number: s.billingNumber ?? s.billingSheetNumber ?? null,
              customerId: s.customerId ?? null,
              customerName: s.customerName ?? null,
              technicianId: s.technicianId ?? null,
              technicianName: s.technicianName ?? null,
              total: numOr0(s.totalAmount ?? s.grandTotal),
              status: s.status,
              hasPhotos: photos.length > 0,
              flags,
              ageDays: age,
              createdAt: created,
              href: `/billing-sheets?id=${s.id}`,
            });
          }
        }

        if (wantWcb) {
          for (const w of await scopedWetCheckBillings(req)) {
            if (!ACTIVE_WCB.has(w.status) && !(statusFilter && w.status === statusFilter)) continue;
            const created = w.createdAt ? new Date(w.createdAt).toISOString() : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (age != null && age > 7) flags.push("stale");
            items.push({
              id: `wcb-${w.id}`,
              type: "wet_check_billing",
              refId: w.id,
              number: w.billingNumber ?? null,
              customerId: w.customerId ?? null,
              customerName: w.customerName ?? null,
              technicianId: w.technicianId ?? null,
              technicianName: w.technicianName ?? null,
              total: numOr0(w.totalAmount),
              status: w.status,
              hasPhotos: null,
              flags,
              ageDays: age,
              createdAt: created,
              href: `/wet-check-billings/${w.id}`,
              wetCheckId: w.wetCheckId ?? null,
            });
          }
        }

        if (wantWo) {
          for (const w of await scopedWorkOrders(req)) {
            if (!ACTIVE_WO.has(w.status) && !(statusFilter && w.status === statusFilter)) continue;
            const photos = Array.isArray(w.photos) ? w.photos : [];
            const flags: string[] = [];
            if (photos.length === 0) flags.push("missing_photos");
            const created = w.createdAt ? new Date(w.createdAt).toISOString() : null;
            const age = ageDays(created);
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

        const cid: number | null = req.authenticatedUserCompanyId ?? null;
        if (wantParts && (cid != null || req.authenticatedUserRole === "super_admin")) {
          const pending = await storage.getPendingParts(cid ?? 0);
          for (const p of (pending as any[]) ?? []) {
            const created = p.createdAt ? new Date(p.createdAt).toISOString() : null;
            items.push({
              id: `part-${p.id}`,
              type: "part",
              refId: p.id,
              number: p.sku ?? p.partNumber ?? null,
              customerId: null,
              customerName: null,
              technicianId: null,
              technicianName: null,
              total: numOr0(p.price),
              status: "pending_approval",
              hasPhotos: null,
              flags: ["unpriced"],
              ageDays: ageDays(created),
              createdAt: created,
              href: `/parts-pending-approval`,
            });
          }
        }

        if (wantReview && (cid != null || req.authenticatedUserRole === "super_admin")) {
          const reviews = await storage.getManualPartReviews(cid ?? 0);
          for (const r of (reviews as any[]) ?? []) {
            const created = r.createdAt ? new Date(r.createdAt).toISOString() : null;
            items.push({
              id: `review-${r.id}`,
              type: "manual_review",
              refId: r.id,
              number: r.partSku ?? r.partName ?? null,
              customerId: r.customerId ?? null,
              customerName: r.customerName ?? null,
              technicianId: null,
              technicianName: null,
              total: numOr0(r.submittedPrice ?? r.suggestedPrice),
              status: "pending_review",
              hasPhotos: null,
              flags: ["unpriced"],
              ageDays: ageDays(created),
              createdAt: created,
              href: `/parts-pending-approval`,
            });
          }
        }

        // ---- Filters ------------------------------------------
        let filtered = items;
        if (q) {
          filtered = filtered.filter((it) => {
            const hay = [it.number, it.customerName, it.technicianName]
              .filter(Boolean).join(" ").toLowerCase();
            return hay.includes(q);
          });
        }
        if (Number.isFinite(customerFilter)) {
          filtered = filtered.filter((it) => it.customerId === customerFilter);
        }
        if (Number.isFinite(techFilter)) {
          filtered = filtered.filter((it) => it.technicianId === techFilter);
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

        // ---- Sort ---------------------------------------------
        const cmpStr = (a: string | null, b: string | null) =>
          (a ?? "").localeCompare(b ?? "");
        filtered.sort((a, b) => {
          switch (sort) {
            case "age_asc": return (a.ageDays ?? -1) - (b.ageDays ?? -1);
            case "total_desc": return b.total - a.total;
            case "total_asc": return a.total - b.total;
            case "customer": return cmpStr(a.customerName, b.customerName);
            case "tech": return cmpStr(a.technicianName, b.technicianName);
            case "age_desc":
            default: return (b.ageDays ?? -1) - (a.ageDays ?? -1);
          }
        });

        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const slice = filtered.slice(start, start + pageSize);

        res.setHeader("X-Total-Count", String(total));
        res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
        res.json({ items: slice, page, pageSize, total });
      } catch (error) {
        req.log?.error?.({ err: error }, "billing-workspace queue failed");
        res.status(500).json({ message: "Failed to load queue" });
      }
    },
  );

  // -------------------------------------------------------------
  // GET /api/billing-workspace/status-strip
  //
  // Four indicators for Zone A (per spec):
  //   awaitingApproval  — open BS+WO awaiting manager review
  //   approvedThisWeek  — BS/WO approved in the current ISO week
  //   draftsLast24h     — draft/in-progress rows created in last 24h
  //   quickbooks        — { state, lastSyncAt, pendingSync, overdueCount }
  // -------------------------------------------------------------
  app.get(
    "/api/billing-workspace/status-strip",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }
        const [sheets, orders, wcbs] = await Promise.all([
          scopedBillingSheets(req),
          scopedWorkOrders(req),
          scopedWetCheckBillings(req),
        ]);

        const now = Date.now();
        const weekAgo = now - 7 * 86_400_000;
        const dayAgo = now - 86_400_000;
        const tsOf = (v: any): number => {
          if (!v) return NaN;
          const t = new Date(v).getTime();
          return Number.isFinite(t) ? t : NaN;
        };

        const awaitingApproval =
          sheets.filter((s) => ACTIVE_BS.has(s.status)).length +
          orders.filter((w) => ACTIVE_WO.has(w.status)).length +
          wcbs.filter((w) => ACTIVE_WCB.has(w.status)).length;

        const approvedThisWeek =
          sheets.filter((s) =>
            APPROVED_BS.has(s.status) && tsOf(s.approvedAt ?? s.updatedAt) >= weekAgo,
          ).length +
          orders.filter((w) =>
            APPROVED_WO.has(w.status) && tsOf(w.approvedAt ?? w.updatedAt) >= weekAgo,
          ).length +
          wcbs.filter((w) =>
            APPROVED_WCB.has(w.status) && tsOf(w.updatedAt ?? w.createdAt) >= weekAgo,
          ).length;

        const draftsLast24h =
          sheets.filter((s) =>
            DRAFT_BS.has(s.status) && tsOf(s.createdAt) >= dayAgo,
          ).length +
          orders.filter((w) =>
            DRAFT_WO.has(w.status) && tsOf(w.createdAt) >= dayAgo,
          ).length;

        // QuickBooks indicator — the shared verdict from
        // ./quickbooks-health, rendered, never re-derived (Task #2027).
        const qbHealth: QuickBooksHealth = (await loadQuickBooksHealth(req)) ?? {
          state: "unknown",
          reason: "not_configured",
          connectionStatus: null,
          reconnectRequiredReason: null,
          lastSyncAt: null,
          lastPaymentSyncAt: null,
          pendingSync: 0,
          recentErrorCount: 0,
        };
        let overdueCount = 0;
        try {
          const od = await overdueSummary(req);
          overdueCount = od.overdueCount;
        } catch {
          overdueCount = 0;
        }

        res.json({
          awaitingApproval,
          approvedThisWeek,
          draftsLast24h,
          // The shared verdict, spread whole, plus this tile's own extra.
          quickbooks: { ...qbHealth, overdueCount },
        });
      } catch (error) {
        req.log?.error?.({ err: error }, "billing-workspace status-strip failed");
        res.status(500).json({ message: "Failed to load status strip" });
      }
    },
  );

  // -------------------------------------------------------------
  // POST /api/billing-workspace/flag
  //
  // Lightweight in-memory flag store so the workspace can mark
  // items for follow-up review without depending on a new schema.
  // The flag is best-effort and resets on process restart — a
  // future task will persist this to `app_settings`.
  // -------------------------------------------------------------
  app.post(
    "/api/billing-workspace/flag",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }
        const { id, type, refId, note } = req.body ?? {};
        if (!id || !type || refId == null) {
          res.status(400).json({ message: "id, type, refId required" });
          return;
        }
        const cid: number | null = req.authenticatedUserCompanyId ?? null;
        const key = `${cid ?? "*"}:${id}`;
        BW_FLAGS.set(key, {
          id: String(id),
          type: String(type),
          refId: Number(refId),
          note: typeof note === "string" ? note : null,
          flaggedAt: new Date().toISOString(),
          flaggedBy: req.authenticatedUserId ?? null,
        });
        res.json({ ok: true, flaggedAt: BW_FLAGS.get(key)?.flaggedAt });
      } catch (error) {
        req.log?.error?.({ err: error }, "billing-workspace flag failed");
        res.status(500).json({ message: "Failed to flag item" });
      }
    },
  );

  // -------------------------------------------------------------
  // GET /api/billing-workspace/quickbooks-sync
  //
  // Detail payload for the QB status tile drawer (Task #715).
  // Returns the same shape as the tile's nested quickbooks block
  // plus the full recentErrors[] array.
  // -------------------------------------------------------------
  app.get(
    "/api/billing-workspace/quickbooks-sync",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }
        const status = await loadQbSyncStatus(req);
        res.json(status);
      } catch (error) {
        req.log?.error?.({ err: error }, "quickbooks-sync detail failed");
        res.status(500).json({ message: "Failed to load QuickBooks sync status" });
      }
    },
  );

  // -------------------------------------------------------------
  // POST /api/billing-workspace/quickbooks-sync/retry
  //
  // Flips every failed quickbooks_sync row in scope back to
  // 'pending' so the next sync run picks them up. The actual
  // re-push is handled by the existing QuickBooks worker — this
  // route is the "Retry sync" button on the tile drawer.
  // -------------------------------------------------------------
  app.post(
    "/api/billing-workspace/quickbooks-sync/retry",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }
        const failed = await getScopedSyncRows(resolveQbScope(req), "failed");
        if (failed.length === 0) {
          res.json({ requeued: 0 });
          return;
        }
        const ids = failed.map((r) => r.id);
        await db
          .update(quickbooksSync)
          .set({ syncStatus: "pending", errorMessage: null })
          .where(inArray(quickbooksSync.id, ids));
        res.json({ requeued: ids.length });
      } catch (error) {
        req.log?.error?.({ err: error }, "quickbooks-sync retry failed");
        res.status(500).json({ message: "Failed to retry QuickBooks sync" });
      }
    },
  );

  // -------------------------------------------------------------
  // GET /api/quickbooks/overdue-summary
  //
  // { overdueCount, overdueAmount, agingReportUrl }
  // 15-minute in-process cache keyed by role+companyId.
  // -------------------------------------------------------------
  app.get(
    "/api/quickbooks/overdue-summary",
    requireAuthentication,
    async (req: any, res) => {
      try {
        if (!isAllowed(req)) {
          res.status(403).json({ message: "Access denied." });
          return;
        }
        const body = await overdueSummary(req);
        res.json(body);
      } catch (error) {
        req.log?.error?.(
          { err: error },
          "quickbooks overdue-summary failed",
        );
        res.status(500).json({ message: "Failed to load overdue summary" });
      }
    },
  );
}

async function overdueSummary(req: any): Promise<{
  overdueCount: number;
  overdueAmount: number;
  agingReportUrl: string;
  asOf: string;
}> {
  const role = req.authenticatedUserRole;
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  const cacheKey = `${role}:${cid ?? "*"}`;
  const now = Date.now();
  const cached = OVERDUE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.body;

  const allInvoices: any[] = (await (storage as any).getAllInvoices?.()) ?? [];
  const custCompany = new Map<number, number | null>();
  for (const inv of allInvoices) {
    if (inv.customerId == null) continue;
    if (!custCompany.has(inv.customerId)) {
      try {
        const c: any = await storage.getCustomer(inv.customerId);
        custCompany.set(inv.customerId, c?.companyId ?? null);
      } catch {
        custCompany.set(inv.customerId, null);
      }
    }
  }
  const scoped = allInvoices.filter((inv) => {
    if (role === "super_admin") return true;
    if (cid == null || inv.customerId == null) return false;
    return custCompany.get(inv.customerId) === cid;
  });
  let overdueCount = 0;
  let overdueAmount = 0;
  for (const inv of scoped) {
    const status = String(inv.status ?? "").toLowerCase();
    if (status === "draft" || status === "cancelled" || status === "paid" || status === "superseded") continue;
    const due = inv.dueDate ? new Date(inv.dueDate).getTime() : NaN;
    if (!Number.isFinite(due) || due >= now) continue;
    overdueCount += 1;
    overdueAmount += numOr0(inv.totalAmount);
  }
  // Task #720 — surface the snapshot freshness so the UI can render
  // "as of HH:MM" beside the overdue tile (this endpoint is cached
  // for 15 minutes per role+companyId, so the displayed number can
  // legitimately lag wall-clock).
  const body = {
    overdueCount,
    overdueAmount,
    agingReportUrl: "/financial-pulse/ar-aging",
    asOf: new Date(now).toISOString(),
  };
  OVERDUE_CACHE.set(cacheKey, { expiresAt: now + OVERDUE_TTL_MS, body });
  return body;
}

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
import { storage } from "../storage";

export interface RegisterBillingWorkspaceRoutesDeps {
  requireAuthentication: RequestHandler;
}

const BW_ROLES = new Set([
  "billing_manager",
  "company_admin",
  "super_admin",
]);

function isAllowed(req: any): boolean {
  return BW_ROLES.has(String(req.authenticatedUserRole || ""));
}

// Statuses considered "active" / awaiting approval.
const ACTIVE_BS = new Set([
  "pending_manager_review",
  "submitted",
  "completed",
]);
const ACTIVE_WO = new Set([
  "pending_manager_review",
  "work_completed",
]);
// Approved (this week tile).
const APPROVED_BS = new Set(["approved", "billed", "invoiced"]);
const APPROVED_WO = new Set(["approved", "billed", "invoiced", "completed_approved"]);
// Draft states (last 24h tile).
const DRAFT_BS = new Set(["draft", "in_progress"]);
const DRAFT_WO = new Set(["draft", "scheduled", "in_progress"]);

function numOr0(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseIntOr(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

async function scopedBillingSheets(req: any): Promise<any[]> {
  const all = await storage.getAllBillingSheets();
  const role = req.authenticatedUserRole;
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

async function scopedWorkOrders(req: any): Promise<any[]> {
  const all = await storage.getWorkOrders();
  const role = req.authenticatedUserRole;
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
  type: "billing_sheet" | "work_order" | "part" | "manual_review";
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
}

// ---------------------------------------------------------------
// Overdue-summary 15-minute in-process cache
// ---------------------------------------------------------------
interface OverdueCacheEntry {
  expiresAt: number;
  body: { overdueCount: number; overdueAmount: number; agingReportUrl: string };
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
            if (!ACTIVE_BS.has(s.status)) continue;
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

        if (wantWo) {
          for (const w of await scopedWorkOrders(req)) {
            if (!ACTIVE_WO.has(w.status)) continue;
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
        const [sheets, orders] = await Promise.all([
          scopedBillingSheets(req),
          scopedWorkOrders(req),
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
          orders.filter((w) => ACTIVE_WO.has(w.status)).length;

        const approvedThisWeek =
          sheets.filter((s) =>
            APPROVED_BS.has(s.status) && tsOf(s.approvedAt ?? s.updatedAt) >= weekAgo,
          ).length +
          orders.filter((w) =>
            APPROVED_WO.has(w.status) && tsOf(w.approvedAt ?? w.updatedAt) >= weekAgo,
          ).length;

        const draftsLast24h =
          sheets.filter((s) =>
            DRAFT_BS.has(s.status) && tsOf(s.createdAt) >= dayAgo,
          ).length +
          orders.filter((w) =>
            DRAFT_WO.has(w.status) && tsOf(w.createdAt) >= dayAgo,
          ).length;

        // QuickBooks indicator — synthesizes the most useful signal
        // we can derive without a connector-status table: last sync
        // attempt, count of finalized BS/WO not yet pushed, and the
        // current overdue invoice count piped through the cached
        // summary helper (so the tile shows the overdue pill).
        const billed = sheets.filter((s: any) => s.status === "billed");
        const pendingSync = billed.filter(
          (s: any) => !s.quickbooksInvoiceId && s.invoiceId,
        ).length;
        const lastSyncAt = sheets.reduce<number | null>((acc, s: any) => {
          const t = tsOf(s.quickbooksSyncedAt);
          if (!Number.isFinite(t)) return acc;
          if (acc == null || t > acc) return t;
          return acc;
        }, null);
        let qbState: "ok" | "degraded" | "down" | "unknown" = "unknown";
        if (lastSyncAt != null) {
          if (pendingSync === 0) qbState = "ok";
          else if (pendingSync < 5) qbState = "degraded";
          else qbState = "down";
        } else if (pendingSync > 0) {
          qbState = "degraded";
        } else {
          qbState = "ok";
        }
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
          quickbooks: {
            state: qbState,
            lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
            pendingSync,
            overdueCount,
          },
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
    if (status === "draft" || status === "cancelled" || status === "paid") continue;
    const due = inv.dueDate ? new Date(inv.dueDate).getTime() : NaN;
    if (!Number.isFinite(due) || due >= now) continue;
    overdueCount += 1;
    overdueAmount += numOr0(inv.totalAmount);
  }
  const body = {
    overdueCount,
    overdueAmount,
    agingReportUrl: "/financial-pulse/ar-aging",
  };
  OVERDUE_CACHE.set(cacheKey, { expiresAt: now + OVERDUE_TTL_MS, body });
  return body;
}

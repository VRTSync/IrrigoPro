// Task #1005 / #1238 — Manager Workspace endpoints (merged).
//
// Contract endpoints that back /manager-workspace (Slice 1 merge):
//   GET /api/manager-workspace/queue
//   GET /api/manager-workspace/status-strip
//
// All endpoints are gated to irrigation_manager / company_admin /
// super_admin / billing_manager; all four roles see the same page.
// billing_manager gets 200 but never receives wet_check or finding items.
// Non-super_admin callers see only their own company's data.

import type { Express, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  wetChecks,
  wetCheckFindings,
  workOrders,
  billingSheets,
} from "@workspace/db/schema";
import { db } from "../db";
import { storage } from "../storage";
import {
  scopedWetCheckBillings,
  loadQbSyncStatus,
  ACTIVE_WCB,
  APPROVED_WCB,
  APPROVED_BS,
  APPROVED_WO,
  DRAFT_BS,
  DRAFT_WO,
} from "./billing-workspace-routes";

export interface RegisterManagerWorkspaceRoutesDeps {
  requireAuthentication: RequestHandler;
}

const MW_ROLES = new Set([
  "irrigation_manager",
  "company_admin",
  "super_admin",
  "billing_manager",
]);

function isManagerAllowed(req: any): boolean {
  return MW_ROLES.has(String(req.authenticatedUserRole || ""));
}

// Statuses considered "active" for wet checks awaiting manager review.
const ACTIVE_WC = new Set(["submitted", "pending_manager_review"]);
// Work-order statuses manager must act on (needs_review).
const ACTIVE_WO_FOR_MANAGER = new Set(["pending_manager_review", "work_completed"]);
// Work-order statuses that appear in the merged queue.
const ALL_WO_STAGES = new Set([
  "pending_manager_review",
  "work_completed",
  "in_progress",
  "approved_passed_to_billing",
  "billed",
]);
// Billing-sheet statuses that appear in the merged queue.
const ALL_BS_STAGES = new Set([
  "pending_manager_review",
  "submitted",
  "completed",
  "draft",
  "approved_passed_to_billing",
  "billed",
]);
// WCB statuses that appear in the merged queue.
const ALL_WCB_STAGES = new Set([
  "submitted",
  "pending_manager_review",
  "approved_passed_to_billing",
  "billed",
]);
// Approved status sets for the "approved this week" tile.
const APPROVED_WC = new Set(["approved", "partially_converted", "converted"]);

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
// live database.
// -----------------------------------------------------------------------
let _wetCheckOverride: (() => Promise<any[]>) | null = null;
let _workOrderOverride: (() => Promise<any[]>) | null = null;
let _findingOverride: (() => Promise<any[]>) | null = null;
let _billingSheetOverride: (() => Promise<any[]>) | null = null;
let _wcbOverride: (() => Promise<any[]>) | null = null;
let _partsOverride: (() => Promise<any[]>) | null = null;
let _reviewsOverride: (() => Promise<any[]>) | null = null;

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
export function _setWcbForTests(fn: () => Promise<any[]>): void {
  _wcbOverride = fn;
}
export function _setPartsForTests(fn: () => Promise<any[]>): void {
  _partsOverride = fn;
}
export function _setReviewsForTests(fn: () => Promise<any[]>): void {
  _reviewsOverride = fn;
}
export function _resetManagerWorkspaceOverridesForTests(): void {
  _wetCheckOverride = null;
  _workOrderOverride = null;
  _findingOverride = null;
  _billingSheetOverride = null;
  _wcbOverride = null;
  _partsOverride = null;
  _reviewsOverride = null;
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

async function scopedWcb(req: any): Promise<any[]> {
  if (_wcbOverride) return _wcbOverride();
  return scopedWetCheckBillings(req);
}

async function scopedParts(req: any): Promise<any[]> {
  if (_partsOverride) return _partsOverride();
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  const role = req.authenticatedUserRole;
  if (cid == null && role !== "super_admin") return [];
  return (await storage.getPendingParts(cid ?? 0)) as any[];
}

async function scopedManualReviews(req: any): Promise<any[]> {
  if (_reviewsOverride) return _reviewsOverride();
  const cid: number | null = req.authenticatedUserCompanyId ?? null;
  const role = req.authenticatedUserRole;
  if (cid == null && role !== "super_admin") return [];
  return (await storage.getManualPartReviews(cid ?? 0)) as any[];
}

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type Stage =
  | "needs_review"
  | "waiting_on_tech"
  | "findings_to_route"
  | "passed_to_billing"
  | "billed_7d";

export interface ManagerQueueItem {
  id: string;
  type:
    | "wet_check"
    | "work_order"
    | "finding"
    | "billing_sheet"
    | "wet_check_billing"
    | "part"
    | "manual_review";
  stage: Stage;
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
  returnedForCorrectionAt?: string | null;
  invoiceId?: number | null;
}

// -----------------------------------------------------------------------
// Stage assignment
// -----------------------------------------------------------------------

function assignStage(
  type: ManagerQueueItem["type"],
  status: string,
  returnedForCorrectionAt: string | null | undefined,
  invoiceId: number | null | undefined,
  ageDays: number | null,
  now: number,
  billedAt?: string | null,
): Stage {
  // findings always go to their own stage
  if (type === "finding") return "findings_to_route";

  // Kicked-back items — returnedForCorrectionAt is set and status is
  // the "returned" status (in_progress for WO, draft for BS).
  if (returnedForCorrectionAt) return "waiting_on_tech";

  // Billed within 7 days (use billedAt if available, else updatedAt proxy)
  if (status === "billed") return "billed_7d";

  // Passed to billing — approved but not yet invoiced
  if (status === "approved_passed_to_billing") {
    return !invoiceId ? "passed_to_billing" : "billed_7d";
  }

  // Everything else is needs_review
  return "needs_review";
}

// -----------------------------------------------------------------------
// Route registration
// -----------------------------------------------------------------------

export function registerManagerWorkspaceRoutes(
  app: Express,
  { requireAuthentication }: RegisterManagerWorkspaceRoutesDeps,
): void {
  // -------------------------------------------------------------------
  // GET /api/manager-workspace/queue
  //
  // Query params:
  //   type     : all | wc | wo | finding | bs | wcb | part | manual (default all)
  //   stage    : all | needs_review | waiting_on_tech | findings_to_route
  //              | passed_to_billing | billed_7d                    (default all)
  //   q        : free-text (number / customer / tech)
  //   customer : numeric customer id
  //   tech     : numeric technician id
  //   age      : <1 | 1-3 | 3-7 | 7+                               (days)
  //   status   : exact status string
  //   sort     : age_desc | age_asc | total_desc | total_asc
  //              | customer | tech                                   (default age_desc)
  //   page     : 1-based page number                                (default 1)
  //   pageSize : rows per page                                       (default 200, max 500)
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

        const role = req.authenticatedUserRole;
        const isBillingManager = role === "billing_manager";

        const type = String(req.query.type ?? "all").toLowerCase();
        const stageFilter = String(req.query.stage ?? "all").toLowerCase();
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
        const pageSize = Math.min(500, Math.max(1, parseIntOr(req.query.pageSize, 200)));

        const wantWc = !isBillingManager && (type === "all" || type === "wc");
        const wantWo = type === "all" || type === "wo";
        const wantFinding = !isBillingManager && (type === "all" || type === "finding");
        const wantBs = type === "all" || type === "bs";
        const wantWcb = type === "all" || type === "wcb";
        const wantPart = type === "all" || type === "part";
        const wantManual = type === "all" || type === "manual";

        const now = Date.now();
        const SEVEN_DAYS_MS = 7 * 86_400_000;

        const ageDays = (iso: string | null | undefined): number | null => {
          if (!iso) return null;
          const t = new Date(iso).getTime();
          if (!Number.isFinite(t)) return null;
          return Math.floor((now - t) / 86_400_000);
        };

        const items: ManagerQueueItem[] = [];

        // ── Wet checks (irrigation_manager / company_admin / super_admin only) ──
        if (wantWc) {
          for (const wc of await scopedWetChecks(req)) {
            if (!ACTIVE_WC.has(wc.status)) continue;
            const created = wc.createdAt
              ? new Date(wc.createdAt).toISOString()
              : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (age != null && age > 7) flags.push("stale");
            items.push({
              id: `wc-${wc.id}`,
              type: "wet_check",
              stage: "needs_review",
              refId: wc.id,
              number: wc.workOrderNumber ?? wc.checkNumber ?? null,
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

        // ── Work orders ───────────────────────────────────────────────────────
        if (wantWo) {
          for (const w of await scopedWorkOrdersForManager(req)) {
            if (!ALL_WO_STAGES.has(w.status)) continue;
            const photos = Array.isArray(w.photos) ? w.photos : [];
            const created = w.createdAt
              ? new Date(w.createdAt).toISOString()
              : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (photos.length === 0) flags.push("missing_photos");
            if (age != null && age > 7) flags.push("stale");

            const rfcAt: string | null = w.returnedForCorrectionAt
              ? new Date(w.returnedForCorrectionAt).toISOString()
              : null;

            const stage = assignStage(
              "work_order",
              w.status,
              rfcAt,
              w.invoiceId ?? null,
              age,
              now,
              w.billedAt ? new Date(w.billedAt).toISOString() : null,
            );

            // billed_7d: only include if within 7 days
            if (stage === "billed_7d") {
              const billedTs = w.billedAt
                ? new Date(w.billedAt).getTime()
                : w.updatedAt
                ? new Date(w.updatedAt).getTime()
                : NaN;
              if (!Number.isFinite(billedTs) || now - billedTs > SEVEN_DAYS_MS) continue;
            }

            if (rfcAt) flags.push("kicked_back");

            items.push({
              id: `wo-${w.id}`,
              type: "work_order",
              stage,
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
              returnedForCorrectionAt: rfcAt,
              invoiceId: w.invoiceId ?? null,
            });
          }
        }

        // ── Findings (irrigation_manager / company_admin / super_admin only) ──
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
              stage: "findings_to_route",
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

        // ── Billing sheets ────────────────────────────────────────────────────
        if (wantBs) {
          for (const s of await scopedBillingSheets(req)) {
            if (!ALL_BS_STAGES.has(s.status)) continue;
            const photos = Array.isArray(s.photos) ? s.photos : [];
            const flags: string[] = [];
            if (photos.length === 0) flags.push("missing_photos");
            const created = s.createdAt ? new Date(s.createdAt).toISOString() : null;
            const age = ageDays(created);
            if (age != null && age > 7) flags.push("stale");

            const rfcAt: string | null = s.returnedForCorrectionAt
              ? new Date(s.returnedForCorrectionAt).toISOString()
              : null;

            const stage = assignStage(
              "billing_sheet",
              s.status,
              rfcAt,
              s.invoiceId ?? null,
              age,
              now,
              s.billedAt ? new Date(s.billedAt).toISOString() : null,
            );

            // billed_7d: only include if within 7 days
            if (stage === "billed_7d") {
              const billedTs = s.billedAt
                ? new Date(s.billedAt).getTime()
                : s.updatedAt
                ? new Date(s.updatedAt).getTime()
                : NaN;
              if (!Number.isFinite(billedTs) || now - billedTs > SEVEN_DAYS_MS) continue;
            }

            // draft without returnedForCorrectionAt → skip (not a stage we show)
            if (s.status === "draft" && !rfcAt) continue;

            if (rfcAt) flags.push("kicked_back");

            items.push({
              id: `bs-${s.id}`,
              type: "billing_sheet",
              stage,
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
              returnedForCorrectionAt: rfcAt,
              invoiceId: s.invoiceId ?? null,
            });
          }
        }

        // ── Wet-check billings ────────────────────────────────────────────────
        if (wantWcb) {
          for (const w of await scopedWcb(req)) {
            if (!ALL_WCB_STAGES.has(w.status)) continue;
            const created = w.createdAt ? new Date(w.createdAt).toISOString() : null;
            const age = ageDays(created);
            const flags: string[] = [];
            if (age != null && age > 7) flags.push("stale");

            const stage = assignStage(
              "wet_check_billing",
              w.status,
              null,
              w.invoiceId ?? null,
              age,
              now,
              w.updatedAt ? new Date(w.updatedAt).toISOString() : null,
            );

            // billed_7d: only include if within 7 days
            if (stage === "billed_7d") {
              const billedTs = w.updatedAt
                ? new Date(w.updatedAt).getTime()
                : NaN;
              if (!Number.isFinite(billedTs) || now - billedTs > SEVEN_DAYS_MS) continue;
            }

            items.push({
              id: `wcb-${w.id}`,
              type: "wet_check_billing",
              stage,
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
              invoiceId: w.invoiceId ?? null,
            });
          }
        }

        // ── Parts pending approval ────────────────────────────────────────────
        if (wantPart) {
          for (const p of await scopedParts(req)) {
            const created = p.createdAt ? new Date(p.createdAt).toISOString() : null;
            items.push({
              id: `part-${p.id}`,
              type: "part",
              stage: "needs_review",
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

        // ── Manual part reviews ───────────────────────────────────────────────
        if (wantManual) {
          for (const r of await scopedManualReviews(req)) {
            const created = r.createdAt ? new Date(r.createdAt).toISOString() : null;
            items.push({
              id: `review-${r.id}`,
              type: "manual_review",
              stage: "needs_review",
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

        // ---- Stage filter -----------------------------------------------
        let filtered = items;
        if (stageFilter && stageFilter !== "all") {
          filtered = filtered.filter((it) => it.stage === stageFilter);
        }

        // ---- Text / field filters ----------------------------------------
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

        // ---- Sort -------------------------------------------------------
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
  // Returns:
  //   indicators  — legacy 4-tile indicators (preserved for back-compat)
  //   stageCounts — per-stage item counts for all roles
  //   oldestAgeHours — oldest item in each active bucket
  //   quickbooks  — QB sync status (from billing-workspace)
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

        const role = req.authenticatedUserRole;
        const isBillingManager = role === "billing_manager";

        const now = Date.now();
        // ISO week boundary: Monday 00:00:00 UTC of the current week.
        const isoWeekStart = (() => {
          const d = new Date(now);
          const day = d.getUTCDay();
          const daysToMonday = day === 0 ? 6 : day - 1;
          d.setUTCDate(d.getUTCDate() - daysToMonday);
          d.setUTCHours(0, 0, 0, 0);
          return d.getTime();
        })();
        const SEVEN_DAYS_MS = 7 * 86_400_000;

        const tsOf = (v: any): number => {
          if (!v) return NaN;
          const t = new Date(v).getTime();
          return Number.isFinite(t) ? t : NaN;
        };

        // Fetch all data in parallel
        const [wos, bss, wcbs] = await Promise.all([
          scopedWorkOrdersForManager(req),
          scopedBillingSheets(req),
          scopedWcb(req),
        ]);

        const [wcs, findings] = isBillingManager
          ? [[], []]
          : await Promise.all([
              scopedWetChecks(req),
              scopedFindingsNeedingRouting(req),
            ]);

        // ── Legacy indicators ──
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

        // ── Stage counts ──
        let needsReview = 0;
        let waitingOnTech = 0;
        let findingsToRoute = isBillingManager ? undefined : activeFindings.length;
        let passedToBilling = 0;
        let billed7d = 0;

        // WCs
        if (!isBillingManager) {
          needsReview += activeWcs.length;
        }

        // WOs — mirror assignStage catch-all so strip agrees with queue
        for (const w of wos) {
          if (w.returnedForCorrectionAt) {
            waitingOnTech++;
          } else if (w.status === "billed") {
            const billedTs = tsOf(w.billedAt ?? w.updatedAt);
            if (Number.isFinite(billedTs) && now - billedTs <= SEVEN_DAYS_MS) billed7d++;
          } else if (w.status === "approved_passed_to_billing") {
            if (!w.invoiceId) passedToBilling++;
            else {
              const billedTs = tsOf(w.billedAt ?? w.updatedAt);
              if (Number.isFinite(billedTs) && now - billedTs <= SEVEN_DAYS_MS) billed7d++;
            }
          } else {
            needsReview++; // catch-all — same as assignStage
          }
        }

        // BSs — mirror assignStage catch-all so strip agrees with queue
        for (const s of bss) {
          if (s.returnedForCorrectionAt) {
            waitingOnTech++;
          } else if (s.status === "billed") {
            const billedTs = tsOf(s.billedAt ?? s.updatedAt);
            if (Number.isFinite(billedTs) && now - billedTs <= SEVEN_DAYS_MS) billed7d++;
          } else if (s.status === "approved_passed_to_billing") {
            if (!s.invoiceId) passedToBilling++;
            else {
              const billedTs = tsOf(s.billedAt ?? s.updatedAt);
              if (Number.isFinite(billedTs) && now - billedTs <= SEVEN_DAYS_MS) billed7d++;
            }
          } else if (s.status === "draft" && !s.returnedForCorrectionAt) {
            // draft without kickback — not shown in queue, skip
          } else {
            needsReview++; // pending_manager_review, submitted, completed, etc.
          }
        }

        // WCBs — mirror assignStage catch-all
        for (const w of wcbs) {
          if (w.status === "billed") {
            const billedTs = tsOf(w.updatedAt ?? w.createdAt);
            if (Number.isFinite(billedTs) && now - billedTs <= SEVEN_DAYS_MS) billed7d++;
          } else if (w.status === "approved_passed_to_billing") {
            if (!w.invoiceId) passedToBilling++;
            else {
              const billedTs = tsOf(w.updatedAt ?? w.createdAt);
              if (Number.isFinite(billedTs) && now - billedTs <= SEVEN_DAYS_MS) billed7d++;
            }
          } else {
            needsReview++; // submitted, pending_manager_review, etc.
          }
        }

        // Compute oldest createdAt for each active indicator bucket.
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

        // QuickBooks status (best-effort)
        let qbStatus: Awaited<ReturnType<typeof loadQbSyncStatus>> | null = null;
        try {
          qbStatus = await loadQbSyncStatus(req);
        } catch {
          qbStatus = null;
        }

        const stageCounts: Record<string, number | undefined> = {
          needsReview,
          waitingOnTech,
          passedToBilling,
          billed7d,
        };
        if (!isBillingManager) {
          stageCounts.findingsToRoute = findingsToRoute as number;
        }

        res.json({
          indicators: {
            wcsPendingReview,
            wosAwaitingApproval,
            findingsNeedingRouting,
            approvedThisWeek,
          },
          stageCounts,
          oldestAgeHours: {
            wcsPendingReview: oldestHours(activeWcs),
            wosAwaitingApproval: oldestHours(activeWos),
            findingsNeedingRouting: oldestHours(activeFindings),
          },
          quickbooks: qbStatus
            ? {
                state: qbStatus.state,
                lastSyncAt: qbStatus.lastSyncAt,
                pendingSync: qbStatus.pendingSync,
                connectionStatus: qbStatus.connectionStatus,
                recentErrorCount: qbStatus.recentErrors.length,
              }
            : null,
        });
      } catch (error) {
        req.log?.error?.({ err: error }, "manager-workspace status-strip failed");
        res.status(500).json({ message: "Failed to load manager status strip" });
      }
    },
  );
}

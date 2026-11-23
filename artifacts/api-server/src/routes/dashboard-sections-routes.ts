import type { Express, RequestHandler } from "express";
import {
  DASHBOARD_OVERDUE_DAYS,
  DASHBOARD_ROLES,
  DASHBOARD_TILE_ORDER,
  DASHBOARD_TILE_ROLES,
  type DashboardOldestVerb,
  type DashboardSectionsResponse,
  type DashboardTile,
  type DashboardTileKey,
} from "@workspace/shared";
import { storage } from "../storage";
import { isAwaitingApprovalBs, isAwaitingApprovalWo } from "./billing-workspace-routes";
import { ACTION_BOARD_OPEN_WO_STATUSES, isPassedToBilling } from "./manager-workspace-routes";
import {
  agingBalanceDue,
  loadAnnotatedInvoices,
  summarizeAging,
  type AgingSummary,
  type AnnotatedInvoice,
} from "./invoice-list-routes";

type Timestamp = Date | string;
type CreatedRow = { createdAt: Timestamp };
type CustomerRow = { customerName: string };
type ApprovalRow = CustomerRow & Parameters<typeof isPassedToBilling>[0];

export interface DashboardData {
  wetChecksPendingReview: readonly (CreatedRow & CustomerRow & { customerId: number; submittedAt?: Timestamp | null })[];
  customers: ReadonlyMap<number, string>;
  estimates: readonly (CreatedRow & CustomerRow & { estimateNumber: string; approvalSentAt?: Timestamp | null })[];
  workOrders: readonly (CreatedRow & ApprovalRow & {
    workOrderNumber: string;
    assignedTechnicianId?: number | null;
    completedAt?: Timestamp | null;
    updatedAt: Timestamp;
  })[];
  billingSheets: readonly (CreatedRow & ApprovalRow & { updatedAt: Timestamp; workDate: Timestamp })[];
  wetCheckBillings: readonly (ApprovalRow & { workDate: Timestamp })[];
  wetChecksInProgress: readonly { technicianId: number | null; count: number }[];
  invoices: { rows: AnnotatedInvoice[]; agingSummary: AgingSummary } | null;
  parts: readonly (CreatedRow & { name: string })[];
  manualPartReviews: readonly (CreatedRow & { partName: string })[];
}

type Candidate = { label: string; verb: DashboardOldestVerb; at: Timestamp };
type DayTileKey = keyof typeof DASHBOARD_OVERDUE_DAYS;
const DAY_MS = 86_400_000;
const FIELD_ROLES: readonly string[] = ["company_admin", "irrigation_manager"];
const canSeeTile = (role: string, key: DashboardTileKey) => DASHBOARD_TILE_ROLES[key].includes(role);

function oldestCandidate(rows: readonly Candidate[]): DashboardTile["oldest"] {
  let earliest = Infinity;
  let oldest: DashboardTile["oldest"] = null;
  for (const { label, verb, at } of rows) {
    const time = new Date(at).getTime();
    if (time < earliest) {
      earliest = time;
      oldest = { label, verb, at: new Date(time).toISOString() };
    }
  }
  return oldest;
}

function summarizeTile(key: DashboardTileKey, rows: readonly Candidate[], overdueBefore: number): DashboardTile {
  return {
    key,
    total: rows.length,
    overdue: rows.filter(({ at }) => new Date(at).getTime() < overdueBefore).length,
    oldest: oldestCandidate(rows),
  };
}

export function buildDashboardSections(role: string, data: DashboardData, now: Date): DashboardSectionsResponse {
  const dayTile = (key: DayTileKey, rows: readonly Candidate[]) =>
    summarizeTile(key, rows, now.getTime() - DASHBOARD_OVERDUE_DAYS[key] * DAY_MS);

  const { workOrders, billingSheets, wetChecksInProgress } = data;
  const wosInProgress = FIELD_ROLES.includes(role) ? workOrders.filter((w) => w.status === "in_progress") : [];
  const techIds = new Set<number>();
  if (FIELD_ROLES.includes(role)) {
    for (const { assignedTechnicianId } of wosInProgress) {
      if (assignedTechnicianId != null) techIds.add(assignedTechnicianId);
    }
    for (const { technicianId } of wetChecksInProgress) {
      if (technicianId != null) techIds.add(technicianId);
    }
  }

  const aging = canSeeTile(role, "invoices") ? data.invoices : null;
  // The only non-current buckets in the shared aging summary are days30/60/90.
  const pastDueBuckets = aging?.agingSummary.buckets.filter(({ key }) => key !== "current") ?? [];

  const tiles = DASHBOARD_TILE_ORDER.filter((key) => canSeeTile(role, key)).map((key): DashboardTile => {
    switch (key) {
      case "wet-checks":
        return dayTile(key, data.wetChecksPendingReview.map((w) => ({
          label: data.customers.get(w.customerId) ?? w.customerName,
          verb: "Submitted",
          at: w.submittedAt ?? w.createdAt,
        })));
      case "estimates":
        return dayTile(key, data.estimates.map((e) => ({
          label: `${e.estimateNumber} · ${e.customerName}`,
          verb: e.approvalSentAt != null ? "Sent" : "Created",
          at: e.approvalSentAt ?? e.createdAt,
        })));
      case "work-orders":
        return dayTile(key, workOrders.filter((w) => ACTION_BOARD_OPEN_WO_STATUSES.has(w.status)).map((w) => ({
          label: `${w.workOrderNumber} · ${w.customerName}`,
          verb: "Opened",
          at: w.createdAt,
        })));
      case "billing-sheets":
        return dayTile(key, billingSheets.filter((s) => s.status === "draft").map((s) => ({
          label: s.customerName, verb: "Started", at: s.createdAt,
        })));
      case "approvals":
        return dayTile(key, [
          ...workOrders.filter(isAwaitingApprovalWo).map((w): Candidate => ({
            label: w.customerName, verb: "Waiting since", at: w.completedAt ?? w.updatedAt,
          })),
          ...billingSheets.filter(isAwaitingApprovalBs).map((s): Candidate => ({
            label: s.customerName, verb: "Waiting since", at: s.updatedAt,
          })),
        ]);
      case "ready-to-bill": {
        const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
        return summarizeTile(key, [
          ...workOrders.filter(isPassedToBilling).map((w): Candidate => ({
            label: w.customerName, verb: "Worked", at: w.completedAt ?? w.createdAt,
          })),
          ...[...billingSheets, ...data.wetCheckBillings].filter(isPassedToBilling).map((row): Candidate => ({
            label: row.customerName, verb: "Worked", at: row.workDate,
          })),
        ], monthStart);
      }
      case "invoices":
        if (!aging) throw new Error("Missing dashboard invoice aging data");
        return {
          key,
          total: aging.agingSummary.overall.count,
          overdue: pastDueBuckets.reduce((sum, bucket) => sum + bucket.count, 0),
          oldest: oldestCandidate(aging.rows.filter((row) => agingBalanceDue(row) > 0).map((row) => ({
            label: `${row.invoiceNumber} · ${row.customerName}`, verb: "Due", at: row.effectiveDueDate,
          }))),
        };
      case "parts":
        return dayTile(key, [
          ...data.parts.map((p): Candidate => ({ label: p.name, verb: "Added", at: p.createdAt })),
          ...data.manualPartReviews.map((r): Candidate => ({ label: r.partName, verb: "Added", at: r.createdAt })),
        ]);
    }
  });

  return {
    generatedAt: now.toISOString(),
    tiles,
    field: FIELD_ROLES.includes(role) ? {
      workOrdersInProgress: wosInProgress.length,
      wetChecksInProgress: wetChecksInProgress.reduce((sum, { count }) => sum + count, 0),
      techsOnActiveWork: techIds.size,
    } : null,
    money: aging ? {
      openInvoiceBalance: aging.agingSummary.overall.balanceDue,
      pastDueBalance: pastDueBuckets.reduce((sum, bucket) => sum + Number(bucket.balanceDue), 0).toFixed(2),
      readyToBillCount: tiles.find(({ key }) => key === "ready-to-bill")?.total ?? null,
    } : null,
  };
}

async function loadDashboardData(role: string, cid: number, now: Date): Promise<DashboardData> {
  const [wetChecksPendingReview, customers, estimates, workOrders, billingSheets, wetCheckBillings,
    wetChecksInProgress, invoiceRows, parts, manualPartReviews] = await Promise.all([
    // Keep the existing 200-row candidate cap: the review tile must match the nav badge.
    canSeeTile(role, "wet-checks") ? storage.listWetChecksPendingReview(cid) : [],
    canSeeTile(role, "wet-checks") ? storage.getCustomers(cid) : [],
    canSeeTile(role, "estimates") ? storage.getEstimatesPendingApproval(cid) : [],
    canSeeTile(role, "work-orders") ? storage.getWorkOrders(cid) : [],
    canSeeTile(role, "billing-sheets") ? storage.getAllBillingSheets(cid) : [],
    // Scope at the storage boundary rather than loading all snapshots and filtering afterward.
    canSeeTile(role, "ready-to-bill") ? storage.getAllWetCheckBillingsWithCounts(cid) : [],
    FIELD_ROLES.includes(role) ? storage.getInProgressWetCheckCounts(cid) : [],
    canSeeTile(role, "invoices") ? loadAnnotatedInvoices(cid, now) : null,
    canSeeTile(role, "parts") ? storage.getPendingParts(cid) : [],
    canSeeTile(role, "parts") ? storage.getManualPartReviews(cid) : [],
  ]);
  return {
    wetChecksPendingReview,
    customers: new Map(customers.map(({ id, name }) => [id, name])),
    estimates,
    workOrders,
    billingSheets,
    wetCheckBillings,
    wetChecksInProgress,
    invoices: invoiceRows ? { rows: invoiceRows, agingSummary: summarizeAging(invoiceRows) } : null,
    parts,
    manualPartReviews,
  };
}

export function registerDashboardSectionsRoutes(
  app: Express,
  { requireAuthentication }: { requireAuthentication: RequestHandler },
): void {
  app.get("/api/dashboard/sections", requireAuthentication, async (req, res) => {
    const role = req.authenticatedUserRole ?? "";
    if (!(DASHBOARD_ROLES as readonly string[]).includes(role)) {
      res.status(403).json({ message: "No dashboard for this role" });
      return;
    }
    const cid = req.authenticatedUserCompanyId;
    if (cid == null) {
      res.status(403).json({ message: "No company context" });
      return;
    }
    try {
      const now = new Date();
      const data = await loadDashboardData(role, cid, now);
      res.json(buildDashboardSections(role, data, now));
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load dashboard");
      res.status(500).json({ message: "Failed to load dashboard" });
    }
  });
}

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useArrayQuery } from "@/lib/queryClient";
import { safeGet } from "@/utils/safeStorage";

import { HeaderStrip, type Health } from "@/components/admin-dashboard/header-strip";
import { QuickActions } from "@/components/admin-dashboard/quick-actions";
import { KpiTile } from "@/components/admin-dashboard/kpi-tile";
import { AttentionPanel, AttentionIcons, type AttentionRow } from "@/components/admin-dashboard/attention-panel";
import { OperationsPipeline } from "@/components/admin-dashboard/operations-pipeline";
import { FinancialExposure } from "@/components/admin-dashboard/financial-exposure";
import { ActivityFeed, ActivityIcons, type ActivityItem } from "@/components/admin-dashboard/activity-feed";
import { TopLists, type TopCustomer, type TopTechnician } from "@/components/admin-dashboard/top-lists";

import {
  Users, UserCheck, Wrench, FileText, Receipt, DollarSign,
} from "lucide-react";

interface User { id: number; companyId?: number; name: string; role: string; }
interface DashboardStats { activeUsers: number; openWorkOrders: number; activeCustomers: number; }

interface BillingPreviewRow {
  id: number;
  name: string;
  approvedTotal: number;
  unapprovedTotal: number;
  totalUnbilled: number;
  currentMonthUnbilled: number;
}

interface WorkOrderLite {
  id: number;
  status: string;
  customerId?: number | null;
  technicianId?: number | null;
  assignedTechnicianId?: number | null;
  totalAmount?: string | number | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  invoiceId?: number | null;
  customerName?: string | null;
  description?: string | null;
}

interface BillingSheetLite {
  id: number;
  status: string;
  technicianId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  totalAmount?: string | number | null;
  createdAt?: string;
  updatedAt?: string;
  invoiceId?: number | null;
  description?: string | null;
}

interface EstimateLite {
  id: number;
  status?: string;
  customerName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface InvoiceLite {
  id: number;
  invoiceNumber: string;
  customerName: string;
  totalAmount: string | number;
  status: string;
  createdAt: string;
  periodStart?: string;
  periodEnd?: string;
}

interface FieldTech { id: number; name: string; isActive?: boolean; }

interface CountResp { count?: number; rows?: unknown[]; }
interface MissingPhotosResp { count?: number; sheets?: unknown[]; workOrders?: unknown[]; }

const DAY_MS = 86_400_000;

function toNumber(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string") {
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default function AdminDashboard() {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const saved = safeGet("user");
    if (saved) {
      try { setUser(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  // Each card has its own query so a single failure does not block the rest.
  const statsQ = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    enabled: !!user?.companyId,
  });
  const billingPreviewQ = useArrayQuery<BillingPreviewRow>({
    queryKey: ["/api/customers/billing-preview", { dateFilter: "all" }],
    queryFn: async () => {
      const res = await fetch("/api/customers/billing-preview?dateFilter=all", { credentials: "include" });
      if (!res.ok) throw new Error("billing-preview failed");
      return res.json();
    },
    enabled: !!user?.companyId,
  });
  const workOrdersQ = useArrayQuery<WorkOrderLite>({ queryKey: ["/api/work-orders"], enabled: !!user?.companyId });
  const billingSheetsQ = useArrayQuery<BillingSheetLite>({ queryKey: ["/api/billing-sheets"], enabled: !!user?.companyId });
  const estimatesQ = useArrayQuery<EstimateLite>({ queryKey: ["/api/estimates"], enabled: !!user?.companyId });
  const invoicesQ = useArrayQuery<InvoiceLite>({
    queryKey: ["/api/invoices", { limit: 25 }],
    queryFn: async () => {
      const res = await fetch("/api/invoices?limit=25", { credentials: "include" });
      if (!res.ok) throw new Error("invoices failed");
      return res.json();
    },
    enabled: !!user?.companyId,
  });
  const techsQ = useArrayQuery<FieldTech>({ queryKey: ["/api/users/field-techs"], enabled: !!user?.companyId });

  // Company profile (for logo + name in header)
  const companyQ = useQuery<{ logo?: string | null; name?: string | null }>({
    queryKey: [`/api/company/${user?.companyId}/profile`],
    enabled: !!user?.companyId,
    retry: false,
  });
  const companyLogoUrl = useMemo(() => {
    const logo = companyQ.data?.logo;
    if (!logo || logo.trim() === "" || logo === "null") return null;
    const m = logo.match(/company-logos\/([^?]+)/);
    return m ? `/api/company-logo/${m[1]}` : logo;
  }, [companyQ.data?.logo]);

  // Attention queries — each isolated.
  const partsApprovalQ = useArrayQuery<unknown>({ queryKey: ["/api/parts/pending-approval"], enabled: !!user?.companyId });
  const manualPartReviewsQ = useArrayQuery<unknown>({ queryKey: ["/api/manual-part-reviews"], enabled: !!user?.companyId });
  const bsMissingPhotosQ = useQuery<MissingPhotosResp>({ queryKey: ["/api/billing-sheets/missing-photos"], enabled: !!user?.companyId });
  const woMissingPhotosQ = useQuery<MissingPhotosResp>({ queryKey: ["/api/work-orders/missing-photos"], enabled: !!user?.companyId });
  const zeroPriceAuditQ = useQuery<CountResp>({ queryKey: ["/api/admin/billing-sheets/zero-price-audit"], enabled: !!user?.companyId });
  const laborRateAuditQ = useQuery<CountResp>({ queryKey: ["/api/admin/labor-rate-audit"], enabled: !!user?.companyId });
  const wetCheckPendingQ = useArrayQuery<unknown>({ queryKey: ["/api/wet-checks/pending-review"], enabled: !!user?.companyId });
  // Task #630 — read the same endpoint the /estimates/pending-approval
  // page reads, so the tile count and the list length cannot drift.
  // Previously this number was derived by filtering /api/estimates
  // client-side on `status === pending|sent`, which used a different
  // filter (customer-facing status) than the server's pending-approval
  // query (internalStatus in pending_approval, approved_internal) and
  // produced different numbers (e.g. 6 in the list vs 4 in the tile).
  const estimatesPendingApprovalQ = useArrayQuery<unknown>({
    queryKey: ["/api/estimates/pending-approval"],
    enabled: !!user?.companyId,
  });

  // ----- Derived metrics -----

  const activeTechCount = useMemo(() => {
    const wos = workOrdersQ.data ?? [];
    const bss = billingSheetsQ.data ?? [];
    const cutoff = Date.now() - 30 * DAY_MS;
    const ids = new Set<number>();
    for (const wo of wos) {
      const t = wo.assignedTechnicianId ?? wo.technicianId;
      if (!t) continue;
      const d = new Date(wo.updatedAt ?? wo.createdAt ?? 0).getTime();
      if (d >= cutoff) ids.add(t);
    }
    for (const bs of bss) {
      const t = bs.technicianId;
      if (!t) continue;
      const d = new Date(bs.updatedAt ?? bs.createdAt ?? 0).getTime();
      if (d >= cutoff) ids.add(t);
    }
    return ids.size;
  }, [workOrdersQ.data, billingSheetsQ.data]);

  // Pipeline counts
  const pipeline = useMemo(() => {
    const wos = workOrdersQ.data ?? [];
    const bss = billingSheetsQ.data ?? [];
    const ests = estimatesQ.data ?? [];
    const invs = invoicesQ.data ?? [];

    const estimatesOpen = ests.filter(
      (e) => e.status === "pending" || e.status === "sent" || e.status === "draft"
    ).length;

    const woOpen = wos.filter((w) => w.status === "pending" || w.status === "assigned").length;
    const woInProgress = wos.filter((w) => w.status === "in_progress").length;
    const woCompleted = wos.filter((w) => w.status === "work_completed" || w.status === "completed").length;

    const billingActive = bss.filter(
      (b) =>
        b.status === "draft" ||
        b.status === "submitted" ||
        b.status === "pending_manager_review" ||
        b.status === "approved_passed_to_billing"
    ).length;

    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();
    const invoicesThisMonth = invs.filter((i) => {
      const d = new Date(i.createdAt);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;

    return { estimatesOpen, woOpen, woInProgress, woCompleted, billingActive, invoicesThisMonth };
  }, [workOrdersQ.data, billingSheetsQ.data, estimatesQ.data, invoicesQ.data]);

  // Financial exposure rollup from billing-preview
  const financial = useMemo(() => {
    const rows = billingPreviewQ.data ?? [];
    let approved = 0, unapproved = 0, totalUnbilled = 0, currentMonth = 0;
    for (const r of rows) {
      approved += toNumber(r.approvedTotal);
      unapproved += toNumber(r.unapprovedTotal);
      totalUnbilled += toNumber(r.totalUnbilled);
      currentMonth += toNumber(r.currentMonthUnbilled);
    }
    // "This Month Billed" = sum of invoice totals created this month
    const invs = invoicesQ.data ?? [];
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();
    let thisMonthBilled = 0;
    for (const i of invs) {
      const d = new Date(i.createdAt);
      if (d.getMonth() === m && d.getFullYear() === y) thisMonthBilled += toNumber(i.totalAmount);
    }
    return { approved, unapproved, totalUnbilled, currentMonth, thisMonthBilled };
  }, [billingPreviewQ.data, invoicesQ.data]);

  // Attention rows
  const attentionRows: AttentionRow[] = useMemo(() => {
    const partsCount =
      (Array.isArray(partsApprovalQ.data) ? partsApprovalQ.data.length : 0) +
      (Array.isArray(manualPartReviewsQ.data) ? manualPartReviewsQ.data.length : 0);
    const bsMissing = bsMissingPhotosQ.data?.count ?? bsMissingPhotosQ.data?.sheets?.length ?? 0;
    const woMissing = woMissingPhotosQ.data?.count ?? woMissingPhotosQ.data?.workOrders?.length ?? 0;
    const photosTotal = bsMissing + woMissing;
    const zeroPrice = zeroPriceAuditQ.data?.count ?? 0;
    const laborMismatch = laborRateAuditQ.data?.count ?? 0;
    const pendingMgrReview = (billingSheetsQ.data ?? []).filter(
      (b) => b.status === "submitted" || b.status === "pending_manager_review"
    ).length;
    // Task #630 — equals the row count on /estimates/pending-approval
    // (same endpoint, same role/company scope). Use the wrapper's
    // resolved `.data` (always an array) directly so a 401 collapses
    // to 0 instead of crashing on `.length`.
    const estimatesPending = (estimatesPendingApprovalQ.data ?? []).length;
    const wetChecksPending = Array.isArray(wetCheckPendingQ.data) ? wetCheckPendingQ.data.length : 0;

    // Customer rollups derived from billing-preview (same definitions used by /billing-dashboard)
    const previews = billingPreviewQ.data ?? [];
    const customersReadyToBill = previews.filter((c) => toNumber(c.approvedTotal) > 0).length;
    const customersPendingApproval = previews.filter(
      (c) => toNumber(c.unapprovedTotal) > 0 && toNumber(c.approvedTotal) === 0
    ).length;

    // Operations-centric "tickets pending review" — work orders + billing sheets
    // sitting in pending_manager_review/work_completed/submitted, mirroring the
    // billing-dashboard active-status set.
    const ticketsPendingReview = pendingMgrReview + (workOrdersQ.data ?? []).filter(
      (w) => w.status === "work_completed" || w.status === "pending_manager_review"
    ).length;

    return [
      { key: "tickets-review",  label: "Tickets pending review",         count: ticketsPendingReview, href: "/operations",                     icon: AttentionIcons.Clock,       tone: "orange" },
      { key: "ready-to-bill",   label: "Customers ready to bill",        count: customersReadyToBill, href: "/billing/command-center",         icon: AttentionIcons.DollarSign,  tone: "amber" },
      { key: "cust-pending",    label: "Customers pending approval",     count: customersPendingApproval, href: "/billing/command-center",     icon: AttentionIcons.Users,       tone: "amber" },
      { key: "missing-photos",  label: "Missing photos (billing sheets)",count: bsMissing,            href: "/billing-sheets/missing-photos",  icon: AttentionIcons.Camera,      tone: "amber" },
      { key: "missing-photos-wo",label: "Missing photos (work orders)",  count: woMissing,            href: "/work-orders/missing-photos",     icon: AttentionIcons.Camera,      tone: "amber" },
      { key: "parts-approval",  label: "Parts pending approval",         count: partsCount,           href: "/parts-pending-approval",         icon: AttentionIcons.Package,     tone: "blue" },
      { key: "estimates-pend",  label: "Estimates pending approval",     count: estimatesPending,     href: "/estimates/pending-approval",     icon: AttentionIcons.FileWarning, tone: "blue" },
      { key: "zero-price",      label: "Zero-price catalog items",       count: zeroPrice,            href: "/billing-sheets/zero-price-audit",icon: AttentionIcons.DollarSign,  tone: "red" },
      { key: "labor-rate",      label: "Labor-rate mismatches",          count: laborMismatch,        href: "/billing-sheets/labor-rate-audit",icon: AttentionIcons.Wrench,      tone: "red" },
      { key: "wet-checks",      label: "Wet checks pending review",      count: wetChecksPending,     href: "/wet-checks/pending-review",      icon: AttentionIcons.Droplets,    tone: "amber" },
    ];
  }, [
    // Task #630 — `estimatesQ.data` is intentionally NOT in this list:
    // the estimates tile now derives from `estimatesPendingApprovalQ`,
    // and the full estimates list still feeds other panels below
    // (charts / drill-ins), which have their own memos/effects.
    partsApprovalQ.data, manualPartReviewsQ.data, bsMissingPhotosQ.data, woMissingPhotosQ.data,
    zeroPriceAuditQ.data, laborRateAuditQ.data, billingSheetsQ.data, wetCheckPendingQ.data,
    workOrdersQ.data, billingPreviewQ.data, estimatesPendingApprovalQ.data,
  ]);

  // System health
  const attentionLoading =
    partsApprovalQ.isLoading || manualPartReviewsQ.isLoading || bsMissingPhotosQ.isLoading ||
    woMissingPhotosQ.isLoading || zeroPriceAuditQ.isLoading || laborRateAuditQ.isLoading ||
    billingSheetsQ.isLoading || estimatesPendingApprovalQ.isLoading || wetCheckPendingQ.isLoading;

  const { health, healthLabel } = useMemo<{ health: Health; healthLabel: string }>(() => {
    const visible = attentionRows.filter((r) => r.count > 0);
    const redCount = visible.filter((r) => r.tone === "red").reduce((s, r) => s + r.count, 0);
    const totalCount = visible.reduce((s, r) => s + r.count, 0);
    if (redCount > 0) return { health: "red", healthLabel: `${redCount} critical item(s)` };
    if (totalCount > 0) return { health: "amber", healthLabel: `${totalCount} items need attention` };
    return { health: "green", healthLabel: "All systems clear" };
  }, [attentionRows]);

  // Top lists
  const topCustomers: TopCustomer[] = useMemo(() => {
    const rows = billingPreviewQ.data ?? [];
    return rows
      .map((r) => ({ id: r.id, name: r.name, unbilledTotal: toNumber(r.totalUnbilled) }))
      .filter((r) => r.unbilledTotal > 0)
      .sort((a, b) => b.unbilledTotal - a.unbilledTotal)
      .slice(0, 5);
  }, [billingPreviewQ.data]);

  const topTechnicians: TopTechnician[] = useMemo(() => {
    const techs = techsQ.data ?? [];
    const wos = workOrdersQ.data ?? [];
    const bss = billingSheetsQ.data ?? [];
    const counts = new Map<number, number>();
    for (const wo of wos) {
      if (wo.status === "pending" || wo.status === "assigned" || wo.status === "in_progress") {
        const t = wo.assignedTechnicianId ?? wo.technicianId;
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    for (const bs of bss) {
      if (bs.status === "draft" || bs.status === "submitted" || bs.status === "pending_manager_review") {
        const t = bs.technicianId;
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return techs
      .map((t) => ({ id: t.id, name: t.name, openTickets: counts.get(t.id) ?? 0 }))
      .filter((t) => t.openTickets > 0)
      .sort((a, b) => b.openTickets - a.openTickets)
      .slice(0, 5);
  }, [techsQ.data, workOrdersQ.data, billingSheetsQ.data]);

  // Activity feed
  const activityItems: ActivityItem[] = useMemo(() => {
    const items: ActivityItem[] = [];
    for (const inv of invoicesQ.data ?? []) {
      items.push({
        key: `inv-${inv.id}`,
        label: `Invoice ${inv.invoiceNumber} created`,
        detail: inv.customerName,
        href: "/invoices",
        date: new Date(inv.createdAt),
        icon: ActivityIcons.Receipt,
        iconClass: "bg-purple-50 text-purple-600",
      });
    }
    for (const wo of workOrdersQ.data ?? []) {
      if (wo.status === "work_completed" || wo.status === "completed" || wo.status === "approved_passed_to_billing") {
        const d = wo.completedAt ?? wo.updatedAt ?? wo.createdAt;
        if (!d) continue;
        items.push({
          key: `wo-${wo.id}`,
          label: `Work order #${wo.id} ${wo.status === "approved_passed_to_billing" ? "approved" : "completed"}`,
          detail: wo.customerName ?? wo.description ?? undefined,
          href: "/work-orders",
          date: new Date(d),
          icon: ActivityIcons.Wrench,
          iconClass: "bg-amber-50 text-amber-600",
        });
      }
    }
    for (const bs of billingSheetsQ.data ?? []) {
      if (bs.status === "approved_passed_to_billing" || bs.status === "approved" || bs.status === "submitted") {
        const d = bs.updatedAt ?? bs.createdAt;
        if (!d) continue;
        items.push({
          key: `bs-${bs.id}`,
          label: `Billing sheet #${bs.id} ${bs.status === "submitted" ? "submitted" : "approved"}`,
          detail: bs.customerName ?? undefined,
          href: "/billing-sheets",
          date: new Date(d),
          icon: ActivityIcons.ClipboardList,
          iconClass: "bg-teal-50 text-teal-600",
        });
      }
    }
    for (const est of estimatesQ.data ?? []) {
      if (est.status === "approved" || est.status === "rejected") {
        const d = est.updatedAt ?? est.createdAt;
        if (!d) continue;
        items.push({
          key: `est-${est.id}`,
          label: `Estimate #${est.id} ${est.status}`,
          detail: est.customerName ?? undefined,
          href: "/operations",
          date: new Date(d),
          icon: ActivityIcons.FileText,
          iconClass: "bg-blue-50 text-blue-600",
        });
      }
    }
    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    return items;
  }, [invoicesQ.data, workOrdersQ.data, billingSheetsQ.data, estimatesQ.data]);

  const activityLoading =
    invoicesQ.isLoading || workOrdersQ.isLoading || billingSheetsQ.isLoading || estimatesQ.isLoading;

  return (
    <div className="max-w-7xl mx-auto pt-4 pb-8 px-2 sm:px-4 space-y-5">
      <HeaderStrip
        name={user?.name}
        health={health}
        healthLabel={healthLabel}
        companyLogoUrl={companyLogoUrl}
        companyName={companyQ.data?.name ?? null}
      />

      <QuickActions />

      {/* KPI Row — 6 tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile
          label="Active Customers"
          value={statsQ.data?.activeCustomers ?? 0}
          icon={UserCheck}
          accent="purple"
          href="/customers"
          isLoading={statsQ.isLoading}
          isError={statsQ.isError}
          testId="kpi-active-customers"
        />
        <KpiTile
          label="Active Technicians"
          value={activeTechCount}
          icon={Users}
          accent="teal"
          href="/users"
          isLoading={techsQ.isLoading || workOrdersQ.isLoading}
          isError={techsQ.isError}
          helper="Last 30 days"
          testId="kpi-active-techs"
        />
        <KpiTile
          label="Open Work Orders"
          value={statsQ.data?.openWorkOrders ?? 0}
          icon={Wrench}
          accent="amber"
          href="/work-orders"
          isLoading={statsQ.isLoading}
          isError={statsQ.isError}
          testId="kpi-open-wo"
        />
        <KpiTile
          label="Active Estimates"
          value={pipeline.estimatesOpen}
          icon={FileText}
          accent="green"
          href="/operations"
          isLoading={estimatesQ.isLoading}
          isError={estimatesQ.isError}
          testId="kpi-active-estimates"
        />
        <KpiTile
          label="Invoices This Month"
          value={pipeline.invoicesThisMonth}
          icon={Receipt}
          accent="blue"
          href="/invoices"
          isLoading={invoicesQ.isLoading}
          isError={invoicesQ.isError}
          testId="kpi-invoices-month"
        />
        <KpiTile
          label="Unbilled Revenue"
          value={
            new Intl.NumberFormat("en-US", {
              style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
            }).format(financial.totalUnbilled)
          }
          icon={DollarSign}
          accent="rose"
          href="/billing/dashboard"
          isLoading={billingPreviewQ.isLoading}
          isError={billingPreviewQ.isError}
          helper="Approved + unapproved"
          testId="kpi-unbilled-revenue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <OperationsPipeline
            estimates={pipeline.estimatesOpen}
            workOrdersOpen={pipeline.woOpen}
            workOrdersInProgress={pipeline.woInProgress}
            workOrdersCompleted={pipeline.woCompleted}
            billingSheets={pipeline.billingActive}
            invoicesThisMonth={pipeline.invoicesThisMonth}
            isLoading={workOrdersQ.isLoading || billingSheetsQ.isLoading || estimatesQ.isLoading || invoicesQ.isLoading}
          />
          <FinancialExposure
            approvedUnbilled={financial.approved}
            unapprovedUnbilled={financial.unapproved}
            totalUnbilled={financial.totalUnbilled}
            thisMonthBilled={financial.thisMonthBilled}
            isLoading={billingPreviewQ.isLoading}
          />
          <TopLists
            customers={topCustomers}
            technicians={topTechnicians}
            isLoading={billingPreviewQ.isLoading || techsQ.isLoading}
          />
        </div>

        <div className="space-y-5">
          <AttentionPanel rows={attentionRows} isLoading={attentionLoading} />
          <ActivityFeed items={activityItems} isLoading={activityLoading} />
        </div>
      </div>
    </div>
  );
}

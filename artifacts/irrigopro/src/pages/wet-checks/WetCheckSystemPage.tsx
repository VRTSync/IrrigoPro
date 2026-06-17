import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Droplets, Loader2, Eye, FileText, CheckCircle2, User, Clock, AlertTriangle, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useArrayQuery, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WetCheckBillingViewModal } from "@/components/wet-check-billings/wet-check-billing-view-modal";
import { SnapshotQuickViewModal } from "@/components/wet-check-billings/snapshot-quick-view-modal";
import { ListPageEmptyState } from "@/components/shared/list-page-empty-state";
import type { WetCheckBillingListItem, WetCheck } from "@workspace/db/schema";
import WetChecksListPage, { type WcbMapEntry } from "./WetChecksListPage";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "all" | "needs-review" | "approved";

// ─── Tab parsing ──────────────────────────────────────────────────────────────

function parseTab(raw: string | null): Tab {
  if (raw === "needs-review" || raw === "approved") return raw;
  return "all";
}

// ─── Tab nav button ───────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
  testId,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      }`}
      data-testid={testId}
    >
      {label}
      {count != null && count > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full text-xs font-semibold px-1.5 py-0.5 min-w-[1.25rem] leading-none ${
            active
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-600"
          }`}
          data-testid={`${testId}-count`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── All Wet Checks tab ───────────────────────────────────────────────────────

function AllWetChecksTab() {
  const [snapshotModalId, setSnapshotModalId] = useState<number | null>(null);

  const { data: wcbs = [], isLoading: wcbsLoading } = useArrayQuery<WetCheckBillingListItem>({
    queryKey: ["/api/wet-check-billings"],
  });

  const wcbStatusMap = useMemo(() => {
    const map = new Map<number, WcbMapEntry>();
    for (const wcb of wcbs) {
      if (wcb.wetCheckId != null) {
        map.set(wcb.wetCheckId, {
          status: wcb.status ?? "",
          totalAmount: String(wcb.totalAmount ?? "0"),
          billingId: wcb.id,
          invoiceId: wcb.invoiceId ?? null,
        });
      }
    }
    return map;
  }, [wcbs]);

  return (
    <>
      <div>
        {wcbsLoading && (
          <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading WC snapshot statuses…
          </div>
        )}
        <WetChecksListPage
          asTab
          wcbStatusMap={wcbStatusMap}
          onViewSnapshot={setSnapshotModalId}
        />
      </div>

      {/* SnapshotQuickViewModal — compact glance view for rows that have a WCB.
          Reuses WetCheckBillingViewModal (no editor logic is duplicated).
          Edit gating is state-driven inside the modal:
            - Pre-approval: rate/hours editable; approve action not present here.
            - Approved-not-invoiced: fully editable.
            - Invoiced/billed: read-only. */}
      {snapshotModalId != null && (
        <SnapshotQuickViewModal
          wetCheckBillingId={snapshotModalId}
          open={snapshotModalId != null}
          onOpenChange={(open) => {
            if (!open) setSnapshotModalId(null);
          }}
        />
      )}
    </>
  );
}

// ─── Needs Review tab ─────────────────────────────────────────────────────────

type ReviewType = "triage" | "snapshot" | "inspection_estimate";

type NeedsReviewItem = WetCheck & {
  outstandingWork: {
    unroutedFindings: number;
    snapshotPending: boolean;
    inspectionEstimatePending?: boolean;
  };
  // Computed by the API. May be absent on older cached responses; fall back
  // to re-deriving from outstandingWork flags in that case.
  reviewType?: ReviewType;
};

type NeedsReviewResponse = { count: number; items: NeedsReviewItem[] };

function deriveReviewType(item: NeedsReviewItem): ReviewType {
  if (item.reviewType) return item.reviewType;
  // Fallback derivation from outstandingWork flags (same priority order as API).
  if (item.outstandingWork.unroutedFindings > 0) return "triage";
  if (item.outstandingWork.snapshotPending) return "snapshot";
  return "inspection_estimate";
}

function timeAgoNR(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NRStatusBadge({ status }: { status: string }) {
  if (status === "submitted") return <Badge variant="info">Submitted</Badge>;
  if (status === "pending_manager_review") return <Badge variant="warning">Pending Review</Badge>;
  if (status === "partially_converted") return <Badge variant="secondary">Partial</Badge>;
  return (
    <Badge variant="secondary">
      {status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
    </Badge>
  );
}

function NRCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-40" />
      </CardContent>
      <CardFooter className="border-t border-slate-100 pt-2 pb-3 justify-end">
        <Skeleton className="h-8 w-28" />
      </CardFooter>
    </Card>
  );
}

const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
  triage: "Route findings",
  snapshot: "Approve snapshot",
  inspection_estimate: "Review estimate",
};

function NRCard({ item, onReview }: { item: NeedsReviewItem; onReview: () => void }) {
  const { unroutedFindings, snapshotPending } = item.outstandingWork;
  const hasWork = unroutedFindings > 0 || snapshotPending;
  const reviewType = deriveReviewType(item);
  const actionLabel = REVIEW_TYPE_LABELS[reviewType];

  return (
    <Card
      className="border-l-4 border-l-cyan-500 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onReview}
      data-testid={`nr-row-${item.id}`}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 truncate">
                {item.customerName ?? "Unknown Customer"}
              </span>
              <NRStatusBadge status={item.status ?? "submitted"} />
              {item.mode === "inspection" && (
                <Badge
                  className="text-xs border bg-violet-100 text-violet-800 border-violet-300"
                  variant="outline"
                  data-testid={`badge-nr-mode-inspection-${item.id}`}
                >
                  Inspection
                </Badge>
              )}
              {item.mode === "service" && (
                <Badge
                  className="text-xs border bg-blue-100 text-blue-800 border-blue-300"
                  variant="outline"
                  data-testid={`badge-nr-mode-service-${item.id}`}
                >
                  Service
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
              {item.technicianName && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {item.technicianName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeAgoNR(item.submittedAt)}
              </span>
            </div>

            {hasWork && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {unroutedFindings > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                    data-testid={`nr-row-${item.id}-unrouted`}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Triage: {unroutedFindings} finding{unroutedFindings !== 1 ? "s" : ""}
                  </span>
                )}
                {snapshotPending && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                    data-testid={`nr-row-${item.id}-snapshot`}
                  >
                    Snapshot: pending
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>

      <CardFooter className="border-t border-slate-100 pt-2 pb-3 flex items-center justify-between">
        <span
          className="text-xs text-slate-500 font-medium"
          data-testid={`nr-row-${item.id}-action-label`}
        >
          {actionLabel}
        </span>
        <Button
          size="sm"
          className="bg-cyan-600 hover:bg-cyan-700 text-white"
          onClick={e => {
            e.stopPropagation();
            onReview();
          }}
          data-testid={`nr-row-${item.id}-review`}
        >
          Review
          <ArrowRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </CardFooter>
    </Card>
  );
}

// Section metadata in display order (display order ≠ deduplication priority).
const NR_SECTIONS: Array<{
  type: ReviewType;
  heading: string;
  testId: string;
}> = [
  { type: "snapshot",            heading: "Snapshot Pending Approval", testId: "nr-section-snapshot" },
  { type: "triage",              heading: "Findings to Triage",        testId: "nr-section-triage" },
  { type: "inspection_estimate", heading: "Inspection Estimate Pending", testId: "nr-section-inspection" },
];

function NRSectionHeading({ heading, count, testId }: { heading: string; count: number; testId: string }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-2 first:mt-0" data-testid={testId}>
      <h3 className="text-sm font-semibold text-slate-700">{heading}</h3>
      <span className="inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 min-w-[1.5rem]">
        {count}
      </span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

function NeedsReviewTab({ data, isLoading }: { data: NeedsReviewResponse | undefined; isLoading: boolean }) {
  const [, navigate] = useLocation();

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <NRCardSkeleton key={i} />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6" data-testid="nr-empty">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center mb-5">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">No wet checks need review</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          New submissions will appear here automatically as technicians complete their checks.
        </p>
      </div>
    );
  }

  // Partition items into sections by reviewType.
  // Each item appears in exactly one section (API already deduplicates by priority).
  const sectionItems: Record<ReviewType, NeedsReviewItem[]> = {
    snapshot: [],
    triage: [],
    inspection_estimate: [],
  };
  for (const item of items) {
    sectionItems[deriveReviewType(item)].push(item);
  }

  const handleReview = (item: NeedsReviewItem) => navigate(`/manager/wet-checks/${item.id}`);

  return (
    <div data-testid="nr-list">
      <p className="text-sm text-slate-500 mb-4">
        {items.length} wet check{items.length !== 1 ? "s" : ""} awaiting review
      </p>
      {NR_SECTIONS.map(({ type, heading, testId }) => {
        const group = sectionItems[type];
        if (group.length === 0) return null;
        return (
          <div key={type}>
            <NRSectionHeading heading={heading} count={group.length} testId={testId} />
            <div className="space-y-3">
              {group.map(item => (
                <NRCard
                  key={item.id}
                  item={item}
                  onReview={() => handleReview(item)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Approved tab ─────────────────────────────────────────────────────────────

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrency(val: string | number | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    parseFloat(String(val ?? "0")) || 0,
  );
}

function ApprovedSnapshotChip({ status }: { status: string }) {
  if (status === "billed") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-300">
        Billed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-300">
      Approved
    </span>
  );
}

function ApprovedRow({
  item,
  onOpen,
}: {
  item: WetCheckBillingListItem;
  onOpen: (id: number) => void;
}) {
  const isLocked = item.status === "billed" || item.invoiceId != null;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onOpen(item.id)}
      data-testid={`approved-row-${item.id}`}
    >
      <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{item.customerName}</span>
            <ApprovedSnapshotChip status={item.status ?? ""} />
            {item.wetCheckMode === "inspection" && (
              <Badge
                className="text-xs border bg-violet-100 text-violet-800 border-violet-300"
                variant="outline"
                data-testid={`badge-approved-mode-inspection-${item.id}`}
              >
                Inspection
              </Badge>
            )}
            {item.wetCheckMode === "service" && (
              <Badge
                className="text-xs border bg-blue-100 text-blue-800 border-blue-300"
                variant="outline"
                data-testid={`badge-approved-mode-service-${item.id}`}
              >
                Service
              </Badge>
            )}
            <span className="text-xs text-gray-500">WC-{item.wetCheckId}</span>
          </div>
          <div className="text-sm text-gray-600 truncate mt-0.5">
            {item.propertyAddress ?? "No address"} · Tech: {item.technicianName}
          </div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
            <span>Work date: {formatDate(item.workDate)}</span>
            {item.billingNumber && (
              <span>· WC Snapshot {item.billingNumber}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-base font-semibold text-gray-900 tabular-nums">
            {formatCurrency(item.totalAmount)}
          </span>
          <button
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border font-medium ${
              isLocked
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-default"
                : "border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(item.id);
            }}
            data-testid={`approved-row-action-${item.id}`}
          >
            <Eye className="h-3 w-3" />
            {isLocked ? "View" : "View / Edit"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovedTab() {
  const [modalId, setModalId] = useState<number | null>(null);

  const { data: allBillings = [], isLoading } = useArrayQuery<WetCheckBillingListItem>({
    queryKey: ["/api/wet-check-billings"],
  });

  const approvedBillings = useMemo(
    () =>
      allBillings.filter(
        (b) =>
          b.status === "approved_passed_to_billing" || b.status === "billed",
      ),
    [allBillings],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-5 w-1/3 mb-2" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (approvedBillings.length === 0) {
    return (
      <ListPageEmptyState
        icon={FileText}
        title="No approved WC snapshots"
        description="Wet check snapshots that have been approved for billing will appear here."
        testId="approved-tab-empty"
      />
    );
  }

  return (
    <>
      <div className="space-y-2" data-testid="approved-tab-list">
        {approvedBillings.map((item) => (
          <ApprovedRow key={item.id} item={item} onOpen={setModalId} />
        ))}
      </div>

      {modalId != null && (
        <WetCheckBillingViewModal
          wetCheckBillingId={modalId}
          open={modalId != null}
          onOpenChange={(open) => {
            if (!open) setModalId(null);
          }}
        />
      )}
    </>
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────────

export default function WetCheckSystemPage() {
  const [, navigate] = useLocation();
  const search = useSearch();

  const params = new URLSearchParams(search);
  const tab = parseTab(params.get("tab"));

  const { data: needsReviewData, isLoading: needsReviewLoading } = useQuery<NeedsReviewResponse>({
    queryKey: ["/api/wet-checks/needs-review"],
    queryFn: () => apiRequest("/api/wet-checks/needs-review"),
    refetchInterval: 30_000,
  });

  const needsReviewCount = needsReviewData?.count ?? needsReviewData?.items?.length ?? 0;

  function setTab(t: Tab) {
    navigate(`/wet-checks?tab=${t}`, { replace: true });
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4" data-testid="page-wet-check-system">
      <div className="flex items-center gap-2 mb-4">
        <Droplets className="h-6 w-6 text-blue-600" />
        <h1 className="text-2xl font-semibold">Wet Checks</h1>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-0 -mb-px overflow-x-auto" aria-label="Wet Checks tabs">
          <TabButton
            label="All Wet Checks"
            active={tab === "all"}
            onClick={() => setTab("all")}
            testId="tab-all"
          />
          <TabButton
            label="Needs Review"
            active={tab === "needs-review"}
            onClick={() => setTab("needs-review")}
            testId="tab-needs-review"
            count={needsReviewCount}
          />
          <TabButton
            label="Approved"
            active={tab === "approved"}
            onClick={() => setTab("approved")}
            testId="tab-approved"
          />
        </nav>
      </div>

      {tab === "all" && <AllWetChecksTab />}
      {tab === "needs-review" && <NeedsReviewTab data={needsReviewData} isLoading={needsReviewLoading} />}
      {tab === "approved" && <ApprovedTab />}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Droplets, Loader2, Eye, FileText } from "lucide-react";
import { useArrayQuery } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WetCheckBillingViewModal } from "@/components/wet-check-billings/wet-check-billing-view-modal";
import { ListPageEmptyState } from "@/components/shared/list-page-empty-state";
import type { WetCheckBillingListItem } from "@workspace/db/schema";
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      }`}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

// ─── All Wet Checks tab ───────────────────────────────────────────────────────

function AllWetChecksTab() {
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
      />
    </div>
  );
}

// ─── Needs Review tab (Slice 2 stub) ─────────────────────────────────────────

function NeedsReviewTab() {
  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-center px-6"
      data-testid="needs-review-tab-stub"
    >
      <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-5">
        <div className="animate-pulse w-8 h-8 rounded-full bg-blue-200" />
      </div>
      <h2 className="text-lg font-semibold text-slate-800 mb-1">Loading review queue…</h2>
      <p className="text-sm text-slate-500 max-w-xs">
        The Needs Review tab is coming soon. Check back shortly.
      </p>
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
  const [location, navigate] = useLocation();

  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const tab = parseTab(params.get("tab"));

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
      {tab === "needs-review" && <NeedsReviewTab />}
      {tab === "approved" && <ApprovedTab />}
    </div>
  );
}

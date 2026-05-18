// Task #683 — Estimate Command Center for company_admin.
//
// One-stop dashboard for estimates: 6 KPI tiles, attention strip,
// lifecycle kanban, and a filterable table. Replaces the old
// /estimates/pending-approval page for company admins.
//
// URL state contract:
//   ?lifecycle=draft,sent              — kanban "View all" + chip filter
//   ?attention=expiring_soon|...       — attention reason filter
//   ?sort=total_desc|age_desc|lifecycle (default `total_desc`)

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useArrayQuery, apiRequest } from "@/lib/queryClient";
import { sendEstimateEmail } from "@/lib/email";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard,
  FileText,
  Send,
  ShieldCheck,
  TrendingUp,
  CalendarClock,
} from "lucide-react";
import { KpiTile } from "@/components/admin-dashboard/kpi-tile";
import {
  AttentionStrip,
  type AttentionReason,
} from "@/components/estimates/command-center/attention-strip";
import { LifecycleKanban } from "@/components/estimates/command-center/lifecycle-kanban";
import {
  EstimateTable,
  type EstimateTableSort,
} from "@/components/estimates/command-center/estimate-table";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { EstimateWizard } from "@/components/estimates/estimate-wizard";
import { LIFECYCLE_STATUSES, type LifecycleStatus } from "@/lib/lifecycle";
import type { Estimate } from "@workspace/db/schema";
import type { EstimateSummary } from "@workspace/db";

const ATTENTION_REASONS: AttentionReason[] = [
  "expiring_soon",
  "stuck_in_review",
  "high_value_silent",
];
const SORT_KEYS: EstimateTableSort[] = ["total_desc", "age_desc", "lifecycle"];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function readSearch(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function EstimateCommandCenter() {
  const [location, navigate] = useLocation();
  const [, setSearchTick] = useState(0);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    const tick = () => setSearchTick((n) => n + 1);
    window.addEventListener("popstate", tick);
    return () => window.removeEventListener("popstate", tick);
  }, []);

  const params = readSearch();
  const lifecycleParam = params.get("lifecycle");
  const attentionParam = params.get("attention");
  const sortParam = params.get("sort") ?? "";

  const lifecycleFilter: LifecycleStatus[] = useMemo(() => {
    if (!lifecycleParam) return [];
    return lifecycleParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is LifecycleStatus =>
        (LIFECYCLE_STATUSES as readonly string[]).includes(s),
      );
  }, [lifecycleParam]);

  const attentionFilter: AttentionReason | null = useMemo(() => {
    if (!attentionParam) return null;
    return (ATTENTION_REASONS as readonly string[]).includes(attentionParam)
      ? (attentionParam as AttentionReason)
      : null;
  }, [attentionParam]);

  const sort: EstimateTableSort = useMemo(() => {
    return (SORT_KEYS as readonly string[]).includes(sortParam)
      ? (sortParam as EstimateTableSort)
      : "total_desc";
  }, [sortParam]);

  const updateUrl = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const p = readSearch();
      mutator(p);
      const qs = p.toString();
      const path = location.split("?")[0];
      navigate(qs ? `${path}?${qs}` : path);
      setSearchTick((n) => n + 1);
    },
    [location, navigate],
  );

  const onLifecycleFilterChange = useCallback(
    (next: LifecycleStatus[]) => {
      updateUrl((p) => {
        if (next.length === 0) p.delete("lifecycle");
        else p.set("lifecycle", next.join(","));
      });
    },
    [updateUrl],
  );

  const onClearAttention = useCallback(() => {
    updateUrl((p) => p.delete("attention"));
  }, [updateUrl]);

  const onPinAttention = useCallback(
    (reason: AttentionReason) => {
      updateUrl((p) => p.set("attention", reason));
    },
    [updateUrl],
  );

  const onSortChange = useCallback(
    (next: EstimateTableSort) => {
      updateUrl((p) => {
        if (next === "total_desc") p.delete("sort");
        else p.set("sort", next);
      });
    },
    [updateUrl],
  );

  // Anchor href for "View all →" links and KPI tiles. Preserves the
  // current path + querystring and overlays one new param so users can
  // right-click → open in new tab and the destination loads with the
  // pre-applied filter (the click handler intercepts plain clicks and
  // pushes the URL via wouter so the rest of the page state survives).
  const buildHref = useCallback(
    (mutator: (p: URLSearchParams) => void): string => {
      const p = readSearch();
      mutator(p);
      const qs = p.toString();
      const path = location.split("?")[0];
      return qs ? `${path}?${qs}` : path;
    },
    [location],
  );
  const buildLifecycleHref = useCallback(
    (lc: LifecycleStatus) =>
      buildHref((p) => {
        p.set("lifecycle", lc);
        p.delete("attention");
      }),
    [buildHref],
  );
  const buildAttentionHref = useCallback(
    (reason: AttentionReason) =>
      buildHref((p) => {
        p.set("attention", reason);
        p.delete("lifecycle");
      }),
    [buildHref],
  );

  // Polling: every 60s so the page stays fresh on a long-open tab
  // without hammering the API.
  const { data: summary, isLoading: summaryLoading } = useQuery<EstimateSummary>({
    queryKey: ["/api/estimates/summary"],
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Fetch the full page cap (500) so kanban/table operate on the
  // same dataset basis as the server-side summary aggregator (which
  // is unpaginated). Without this the list response defaults to 100
  // rows and the tile / kanban / table counts can drift.
  const { data: estimates = [], isLoading: estimatesLoading } = useArrayQuery<Estimate>({
    queryKey: ["/api/estimates?limit=500"],
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // --- Detail modal ---
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const openEstimate = useCallback((id: number) => setSelectedEstimateId(id), []);

  // --- Edit (EstimateWizard) ---
  const [editingEstimateId, setEditingEstimateId] = useState<number | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const onEditEstimate = useCallback((id: number) => {
    setSelectedEstimateId(null);
    setEditingEstimateId(id);
    setWizardOpen(true);
  }, []);

  // --- Approve & Send mutation — chains internal approve + email send
  // so the row action matches the "Approve & Send" semantics from the
  // existing estimate detail flow (estimate is marked ready to send,
  // then the customer email is delivered).
  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest(`/api/estimates/${id}/internal-approve`, "PATCH", {});
      await sendEstimateEmail(id);
    },
    onSuccess: () => {
      toast({
        title: "Approved & sent",
        description: "Estimate approved and emailed to the customer.",
      });
      qc.invalidateQueries({ queryKey: ["/api/estimates?limit=500"] });
      qc.invalidateQueries({ queryKey: ["/api/estimates"] });
      qc.invalidateQueries({ queryKey: ["/api/estimates/summary"] });
    },
    onError: () => {
      toast({
        title: "Failed to approve & send",
        description: "Please try again, or use the detail view to send manually.",
        variant: "destructive",
      });
    },
  });
  const onApproveAndSend = useCallback(
    (id: number) => approveMutation.mutate(id),
    [approveMutation],
  );

  // --- Convert to work order mutation ---
  const convertMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/estimates/${id}/convert-to-work-order`, "POST"),
    onSuccess: () => {
      toast({
        title: "Converted",
        description: "Estimate converted to work order.",
      });
      qc.invalidateQueries({ queryKey: ["/api/estimates?limit=500"] });
      qc.invalidateQueries({ queryKey: ["/api/estimates"] });
      qc.invalidateQueries({ queryKey: ["/api/work-orders"] });
      qc.invalidateQueries({ queryKey: ["/api/estimates/summary"] });
    },
    onError: () => {
      toast({
        title: "Failed to convert",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });
  const onConvertToWorkOrder = useCallback(
    (id: number) => convertMutation.mutate(id),
    [convertMutation],
  );

  const attentionIds: number[] | null = useMemo(() => {
    if (!attentionFilter) return null;
    if (!summary) return [];
    const out: number[] = [];
    for (const a of summary.attention) {
      if (a.reason === attentionFilter) out.push(a.estimateId);
    }
    return out;
  }, [attentionFilter, summary]);

  const tiles = useMemo(() => {
    const w = summary?.windows;
    const winRate = summary ? Math.round((summary.winRate90d || 0) * 100) : 0;
    return [
      {
        label: "Open pipeline",
        value: w ? w.openPipeline.count : 0,
        helper: w ? formatCurrency(w.openPipeline.totalAmount) : "—",
        icon: FileText,
        accent: "blue" as const,
        testId: "kpi-open-pipeline",
        href: buildHref((p) => {
          p.set("lifecycle", "pending_review,sent");
          p.delete("attention");
        }),
      },
      {
        label: "Awaiting review",
        value: w ? w.awaitingReview.count : 0,
        helper: w ? formatCurrency(w.awaitingReview.totalAmount) : "—",
        icon: ShieldCheck,
        accent: "amber" as const,
        testId: "kpi-awaiting-review",
        href: buildLifecycleHref("pending_review"),
      },
      {
        label: "Awaiting customer",
        value: w ? w.awaitingCustomer.count : 0,
        helper: w ? formatCurrency(w.awaitingCustomer.totalAmount) : "—",
        icon: Send,
        accent: "teal" as const,
        testId: "kpi-awaiting-customer",
        href: buildLifecycleHref("sent"),
      },
      {
        label: "Expiring this week",
        value: w ? w.expiringNext7Days.count : 0,
        helper: w ? formatCurrency(w.expiringNext7Days.totalAmount) : "—",
        icon: CalendarClock,
        accent: "rose" as const,
        testId: "kpi-expiring-week",
        href: buildAttentionHref("expiring_soon"),
      },
      {
        label: "Approved (30d)",
        value: w ? w.approvedLast30Days.count : 0,
        helper: w ? formatCurrency(w.approvedLast30Days.totalAmount) : "—",
        icon: LayoutDashboard,
        accent: "green" as const,
        testId: "kpi-approved-30d",
        href: buildLifecycleHref("approved"),
      },
      {
        label: "Win rate (90d)",
        value: `${winRate}%`,
        helper: "approved / decided",
        icon: TrendingUp,
        accent: "purple" as const,
        testId: "kpi-win-rate",
        href: undefined,
      },
    ];
  }, [summary, buildHref, buildLifecycleHref, buildAttentionHref]);

  return (
    <div className="py-6 max-w-[1400px] mx-auto space-y-6" data-testid="estimate-command-center">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estimate Command Center</h1>
          <p className="text-sm text-gray-500">
            Pipeline, attention, and lifecycle for every estimate.
          </p>
        </div>
      </header>

      <section
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
        data-testid="cc-kpi-tiles"
      >
        {tiles.map((t) => (
          <KpiTile
            key={t.label}
            label={t.label}
            value={t.value}
            helper={t.helper}
            icon={t.icon}
            accent={t.accent}
            isLoading={summaryLoading}
            testId={t.testId}
            href={t.href}
          />
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Needs attention</h2>
          {attentionFilter && (
            <button
              type="button"
              onClick={onClearAttention}
              className="text-xs text-blue-600 hover:underline"
              data-testid="attention-clear"
            >
              Clear "{attentionFilter.replace(/_/g, " ")}" filter
            </button>
          )}
        </div>
        <AttentionStrip
          items={summary?.attention ?? []}
          isLoading={summaryLoading}
          onOpenEstimate={openEstimate}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Lifecycle board</h2>
        <LifecycleKanban
          estimates={estimatesLoading ? [] : estimates}
          summary={summary}
          onOpenEstimate={openEstimate}
          onViewAll={(lc) => onLifecycleFilterChange([lc])}
          buildViewAllHref={buildLifecycleHref}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">All estimates</h2>
        <EstimateTable
          estimates={estimatesLoading ? [] : estimates}
          lifecycleFilter={lifecycleFilter}
          onLifecycleFilterChange={onLifecycleFilterChange}
          attentionEstimateIds={attentionIds}
          onClearAttention={onClearAttention}
          sort={sort}
          onSortChange={onSortChange}
          onOpenEstimate={openEstimate}
          onEditEstimate={onEditEstimate}
          onApproveAndSend={onApproveAndSend}
          onConvertToWorkOrder={onConvertToWorkOrder}
        />
      </section>

      <EstimateDetailModal
        open={selectedEstimateId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEstimateId(null);
        }}
        estimateId={selectedEstimateId}
        onEdit={(id) => {
          setSelectedEstimateId(null);
          setEditingEstimateId(id);
          setWizardOpen(true);
        }}
      />

      <EstimateWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) setEditingEstimateId(null);
        }}
        estimateId={editingEstimateId}
      />
    </div>
  );
}

import { useMemo } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  MapPin,
  Cpu,
  Droplets,
  ClipboardList,
  Loader2,
  AlertTriangle,
  ChevronDown,
  PlayCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest, useArrayQuery } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Customer, WetCheck } from "@workspace/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

type WetCheckRow = WetCheck & { zoneCount: number; processedCount: number; failedCount: number; workOrderIds: number[] };

interface PropertyController {
  id: number;
  controllerLetter: string;
  zoneCount: number;
}

interface WetCheckPage {
  rows: WetCheckRow[];
  total: number;
  nextOffset: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;

function formatDate(raw: string | Date): string {
  const d = new Date(raw);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type WetCheckStatus = WetCheck["status"];

function StatusBadge({ status }: { status: WetCheckStatus }) {
  const base = "text-xs font-medium shrink-0";
  switch (status) {
    case "in_progress":
      return <Badge className={`${base} bg-blue-600 text-white`}>In Progress</Badge>;
    case "submitted":
      return <Badge className={`${base} bg-amber-500 text-white`}>Submitted</Badge>;
    case "approved":
      return <Badge className={`${base} bg-green-600 text-white`}>Approved</Badge>;
    case "partially_converted":
      return <Badge className={`${base} bg-teal-600 text-white`}>Partial</Badge>;
    case "converted":
      return <Badge className={`${base} bg-purple-600 text-white`}>Converted</Badge>;
    default:
      return <Badge variant="secondary" className={base}>{status}</Badge>;
  }
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ icon: Icon, value, label }: { icon: React.ElementType; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
      <Icon className="h-4 w-4 text-blue-500 shrink-0" />
      <span className="text-sm font-semibold text-gray-900">{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({ wc, onClick }: { wc: WetCheckRow; onClick: () => void }) {
  const hasZones = wc.zoneCount > 0;
  const hasResults = wc.processedCount > 0 || wc.failedCount > 0;

  return (
    <button
      className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
      onClick={onClick}
      data-testid={`history-row-${wc.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">
              {formatDate(wc.startedAt)}
            </span>
            <StatusBadge status={wc.status} />
            {wc.mode === "inspection" && (
              <Badge
                className="text-[10px] border bg-violet-100 text-violet-800 border-violet-300"
                variant="outline"
                data-testid={`badge-wc-mode-inspection-${wc.id}`}
              >
                Inspection
              </Badge>
            )}
            {wc.mode === "service" && (
              <Badge
                className="text-[10px] border bg-blue-100 text-blue-800 border-blue-300"
                variant="outline"
                data-testid={`badge-wc-mode-service-${wc.id}`}
              >
                Service
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-gray-500">
            <span>{wc.technicianName}</span>
            {hasZones && !hasResults && (
              <>
                <span className="text-gray-300">·</span>
                <span>{wc.zoneCount} zone{wc.zoneCount !== 1 ? "s" : ""}</span>
              </>
            )}
            {hasResults && (
              <>
                <span className="text-gray-300">·</span>
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle2 className="h-3 w-3" />
                  {wc.processedCount} ok
                </span>
                {wc.failedCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600">
                    <XCircle className="h-3 w-3" />
                    {wc.failedCount} failed
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <span className="text-xs text-blue-600 font-medium shrink-0 mt-0.5">View →</span>
      </div>
    </button>
  );
}

// ─── Main hub ─────────────────────────────────────────────────────────────────

interface CustomerHubProps {
  customerId: number;
}

export function CustomerHub({ customerId }: CustomerHubProps) {
  const [, navigate] = useLocation();

  const { data: customer, isLoading: loadingCustomer } = useQuery<Customer>({
    queryKey: ["/api/customers", customerId],
    queryFn: () => apiRequest(`/api/customers/${customerId}`),
  });

  // ── Infinite-scrolling history — API-backed offset pagination ──────────────
  const {
    data: historyPages,
    isLoading: loadingWcs,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<WetCheckPage>({
    queryKey: ["/api/wet-checks", { customerId, paginated: true }],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      const offset = Number(pageParam) || 0;
      const res = await fetch(
        `/api/wet-checks?customerId=${customerId}&limit=${PAGE_SIZE}&offset=${offset}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch wet checks");
      const rows = (await res.json()) as WetCheckRow[];
      const total = Number(res.headers.get("X-Total-Count") ?? rows.length);
      const consumed = offset + rows.length;
      return { rows, total, nextOffset: consumed < total ? consumed : null };
    },
    getNextPageParam: (last) => last.nextOffset,
  });

  const allChecks = useMemo<WetCheckRow[]>(
    () => historyPages?.pages.flatMap((p) => p.rows) ?? [],
    [historyPages],
  );

  const totalCount = historyPages?.pages[0]?.total ?? 0;

  const { data: controllers = [], isLoading: loadingControllers } = useArrayQuery<PropertyController>({
    queryKey: ["/api/properties", customerId, "controllers"],
    queryFn: () => apiRequest(`/api/properties/${customerId}/controllers`),
  });

  // ── Derived stats ──────────────────────────────────────────────────────────
  const controllerCount = controllers.length;
  const totalZones = useMemo(
    () => controllers.reduce((sum, c) => sum + (c.zoneCount ?? 0), 0),
    [controllers],
  );

  // In-progress check: check first page only (newest first) — in_progress
  // checks will always appear near the top since they're the most recent.
  const inProgressCheck = useMemo(
    () => allChecks.find((wc) => wc.status === "in_progress") ?? null,
    [allChecks],
  );

  const isInitialLoading = loadingCustomer || loadingControllers || loadingWcs;

  // ── Navigation helpers ──
  function resumeCheck(wc: WetCheckRow) {
    if (wc.id != null) navigate(`/wet-checks/${wc.id}`);
    else if (wc.clientId) navigate(`/wet-checks/c/${wc.clientId}`);
  }

  function goToDetail(wc: WetCheckRow) {
    if (wc.id != null) navigate(`/wet-checks/${wc.id}`);
    else if (wc.clientId) navigate(`/wet-checks/c/${wc.clientId}`);
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isInitialLoading) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-3 sm:px-4 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-3 sm:px-4">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-gray-300" />
          <p className="text-gray-600 font-medium">Customer not found</p>
          <Button variant="outline" size="sm" onClick={() => navigate("/wet-checks")}>
            Back to Wet Checks
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">

      {/* ── Back breadcrumb ── */}
      <button
        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 -mb-1"
        onClick={() => navigate("/wet-checks")}
        data-testid="back-to-picker"
      >
        <ArrowLeft className="h-4 w-4" />
        All Customers
      </button>

      {/* ── Property header ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-gray-900 truncate" data-testid="hub-customer-name">
              {customer.name}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500 flex items-start gap-1.5" data-testid="hub-address">
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gray-400" />
              <span>{customer.address ?? "No address on file"}</span>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => navigate(`/customers/${customerId}/site-maps`)}
            data-testid="btn-view-map"
          >
            View Map
          </Button>
        </div>

        {/* Stat chips */}
        <div className="flex flex-wrap gap-2" data-testid="hub-stats">
          <StatChip icon={Cpu} value={controllerCount} label={controllerCount === 1 ? "controller" : "controllers"} />
          <StatChip icon={Droplets} value={totalZones} label={totalZones === 1 ? "zone" : "zones"} />
          <StatChip icon={ClipboardList} value={totalCount} label={totalCount === 1 ? "wet check" : "wet checks"} />
        </div>
      </div>

      {/* ── Resume banner ── */}
      {inProgressCheck && (
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3"
          data-testid="resume-banner"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <PlayCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">Inspection in progress</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Started {formatDate(inProgressCheck.startedAt)} · {inProgressCheck.technicianName}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 w-full sm:w-auto"
            onClick={() => resumeCheck(inProgressCheck)}
            data-testid="btn-resume"
          >
            Resume Inspection
          </Button>
        </div>
      )}

      {/* ── Start New Wet Check ── */}
      <div>
        <Button
          className="w-full h-12 text-base font-semibold"
          disabled={!!inProgressCheck}
          onClick={() => {
            try {
              sessionStorage.setItem("wc_pending_customer_id", String(customerId));
            } catch {
              // sessionStorage unavailable — fall back to direct navigation
              navigate(`/wet-checks/c/${customerId}/new`);
              return;
            }
            navigate("/wet-checks/new");
          }}
          data-testid="btn-start-new"
          title={inProgressCheck ? "Finish the current inspection before starting a new one" : undefined}
        >
          <Droplets className="h-5 w-5 mr-2" />
          Start New Wet Check
        </Button>
        {inProgressCheck && (
          <p className="mt-1.5 text-xs text-center text-gray-400">
            Finish or submit the current inspection before starting a new one.
          </p>
        )}
      </div>

      {/* ── History ── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-600 mb-2">
          Inspection History
          {totalCount > 0 && (
            <span className="ml-1.5 font-normal text-gray-400">({totalCount})</span>
          )}
        </h2>

        {allChecks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-gray-500 text-sm">
              No wet checks on record for this property.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {allChecks.map((wc) => (
              <HistoryRow key={wc.id ?? wc.clientId} wc={wc} onClick={() => goToDetail(wc)} />
            ))}
            {hasNextPage && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="btn-load-more"
              >
                {isFetchingNextPage ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <ChevronDown className="h-4 w-4 mr-1.5" />
                )}
                {isFetchingNextPage ? "Loading…" : `Load more (${totalCount - allChecks.length} remaining)`}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

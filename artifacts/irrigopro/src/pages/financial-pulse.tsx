// Task #688 — Financial Pulse Slice 2.
//
// /financial-pulse page for company_admin, billing_manager, super_admin.
// Two bands in this slice (KPI snapshot, Revenue trends + mix donut)
// plus two placeholder cards for Slice 3 (drill-downs and forward look).

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { MetricTile } from "@/components/financial-pulse/metric-tile";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Period = "mtd" | "ytd";

interface KpiTile {
  value: number | null;
  deltaPct?: number | null;
  comparedTo?: string;
}
interface MarginTile extends KpiTile {
  missingWageTechCount?: number;
}
interface KpisResponse {
  billedMtd: KpiTile;
  billedYtd: KpiTile;
  collectedMtd: KpiTile;
  outstandingAr: KpiTile;
  unbilledExposure: KpiTile;
  projectedMonthEnd: KpiTile & { method: string };
  avgDaysToPay: KpiTile;
  grossMarginPct: MarginTile;
  period: Period;
  asOf: string;
}
interface TrendPoint {
  month: string;
  revenue: number;
  partsRevenue: number;
  laborRevenue: number;
  prevYearRevenue: number;
}
interface TrendResponse {
  series: TrendPoint[];
}
interface MixResponse {
  partsVsLabor: { parts: number; labor: number };
  emergencyVsStandard: { emergency: number; standard: number };
  contractVsAdhoc: { contract: number; adhoc: number };
}

// QuickBooks connection-status payload shape. Matches the existing
// `/api/quickbooks/connection-status` contract used by
// `components/quickbooks/quickbooks-integration.tsx` — see
// `QbConnectionStatus` there. We treat the response as a partial
// payload because the endpoint can return `{}` on transient failures
// (queryFn catches the error above) and we don't want banner state
// to flip when a field is missing.
export interface QbStatusPayload {
  isConnected?: boolean;
  connectionStatus?: string;
  reconnectRequiredReason?: string;
}

// Statuses that indicate sync is NOT healthy and the banner must show.
// Mirrors the backend semantics in routes.ts where token-refresh
// failures persist `reconnect_required`, and the integration UI which
// treats `error` as a degraded state. `disconnected` / `expired` are
// kept for back-compat with older responses.
const QB_BAD_STATUSES = new Set([
  "disconnected",
  "error",
  "expired",
  "reconnect_required",
]);

// Pure helper so the banner logic is unit-testable. Exported for the
// banner-visibility test below in
// `pages/financial-pulse-qb-banner.test.tsx`.
export function isQbUnhealthy(payload: QbStatusPayload | undefined): boolean {
  if (!payload) return false;
  if (payload.isConnected === false) return true;
  if (payload.connectionStatus && QB_BAD_STATUSES.has(payload.connectionStatus))
    return true;
  return false;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

const ALLOWED_ROLES = new Set([
  "super_admin",
  "company_admin",
  "billing_manager",
]);

function useUserRole(): string | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return typeof u?.role === "string" ? u.role : null;
  } catch {
    return null;
  }
}

export default function FinancialPulsePage() {
  const role = useUserRole();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("mtd");
  // Slice-3 custom date-range scaffold. Held here so the wiring exists
  // in-component; the input is disabled until Slice 3 enables it.
  const [customRange, setCustomRange] = useState<{ asOf: string | null }>({
    asOf: null,
  });

  if (!role || !ALLOWED_ROLES.has(role)) {
    return (
      <div className="py-10">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-gray-900">
              Not authorized
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              You don't have access to the Financial Pulse dashboard.
            </p>
            <Button className="mt-4" onClick={() => navigate("/")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const kpis = useQuery<KpisResponse>({
    queryKey: ["/api/financial-pulse/kpis", period],
    queryFn: () =>
      apiRequest(`/api/financial-pulse/kpis?period=${period}`, "GET"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const trend = useQuery<TrendResponse>({
    queryKey: ["/api/financial-pulse/revenue-trend", 13],
    queryFn: () =>
      apiRequest(`/api/financial-pulse/revenue-trend?months=13`, "GET"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const mix = useQuery<MixResponse>({
    queryKey: ["/api/financial-pulse/revenue-mix", period],
    queryFn: () =>
      apiRequest(`/api/financial-pulse/revenue-mix?period=${period}`, "GET"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const qb = useQuery<QbStatusPayload>({
    queryKey: ["/api/quickbooks/connection-status"],
    queryFn: async () => {
      try {
        return await apiRequest("/api/quickbooks/connection-status", "GET");
      } catch {
        return {};
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const lastRefreshed = kpis.dataUpdatedAt
    ? new Date(kpis.dataUpdatedAt).toISOString()
    : null;

  const refresh = () => {
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/financial-pulse/"),
    });
  };

  const qbUnhealthy = isQbUnhealthy(qb.data);

  return (
    <div className="py-6 space-y-6" data-testid="financial-pulse-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financial Pulse</h1>
          <p className="text-sm text-gray-500 mt-1">
            Live financial picture across all customers and techs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => v && setPeriod(v as Period)}
            data-testid="period-toggle"
          >
            <ToggleGroupItem value="mtd" data-testid="period-mtd">
              MTD
            </ToggleGroupItem>
            <ToggleGroupItem value="ytd" data-testid="period-ytd">
              YTD
            </ToggleGroupItem>
          </ToggleGroup>
          {/*
            Slice-3 placeholder: custom date-range hook lives here but is
            intentionally disabled in this slice. The endpoints already
            accept an optional ?asOf=YYYY-MM-DD parameter; wiring this
            control to it is a future slice. Rendered as a disabled input
            so the affordance is visible (and the hook stays in-component)
            without being interactive.
          */}
          <input
            type="date"
            value={customRange.asOf ?? ""}
            onChange={(e) =>
              setCustomRange((r) => ({ ...r, asOf: e.target.value }))
            }
            disabled
            aria-label="Custom date range (coming soon)"
            title="Custom date range — coming in Slice 3"
            className="hidden sm:inline-block h-9 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs text-gray-400 cursor-not-allowed"
            data-testid="custom-range-asof"
          />
          <span className="text-xs text-gray-500 hidden sm:inline">
            Last refreshed {formatRelative(lastRefreshed)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            data-testid="refresh-button"
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* QB health banner */}
      {qbUnhealthy && (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 text-sm flex items-center gap-2"
          data-testid="qb-health-banner"
        >
          <AlertTriangle className="w-4 h-4" />
          QuickBooks sync is unhealthy — invoice totals may be out of date.
        </div>
      )}

      {/* Band 1 — KPI snapshot */}
      <KpiBand data={kpis.data} isLoading={kpis.isLoading} isError={kpis.isError} />

      {/* Band 2 — Revenue trends */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue trends</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RevenueTrendChart data={trend.data?.series ?? []} isLoading={trend.isLoading} />
            <PartsVsLaborChart data={trend.data?.series ?? []} isLoading={trend.isLoading} />
          </div>
        </CardContent>
      </Card>

      {/* Revenue mix donut */}
      <RevenueMixCard data={mix.data} isLoading={mix.isLoading} />

      {/* Slice 3 placeholders */}
      <Card data-testid="slice3-placeholder-drilldown">
        <CardContent className="py-10 text-center text-sm text-gray-500">
          Drill-down tables coming in next release
        </CardContent>
      </Card>
      <Card data-testid="slice3-placeholder-aging">
        <CardContent className="py-10 text-center text-sm text-gray-500">
          A/R aging and projections coming in next release
        </CardContent>
      </Card>
    </div>
  );
}

function KpiBand({
  data,
  isLoading,
  isError,
}: {
  data: KpisResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <MetricTile
        testId="kpi-billed-mtd"
        label="Billed MTD"
        value={data?.billedMtd.value ?? null}
        format="currency"
        deltaPct={data?.billedMtd.deltaPct ?? null}
        deltaLabel="vs last month"
        deltaGoodDirection="up"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-collected-mtd"
        label="Collected MTD"
        value={data?.collectedMtd.value ?? null}
        format="currency"
        deltaPct={data?.collectedMtd.deltaPct ?? null}
        deltaLabel="vs last month"
        deltaGoodDirection="up"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-outstanding-ar"
        label="Outstanding A/R"
        value={data?.outstandingAr.value ?? null}
        format="currency"
        deltaGoodDirection="down"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-projected-month-end"
        label="Projected Month-End"
        value={data?.projectedMonthEnd.value ?? null}
        format="currency"
        helper="Run-rate projection"
        deltaGoodDirection="up"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-billed-ytd"
        label="Billed YTD"
        value={data?.billedYtd.value ?? null}
        format="currency"
        deltaPct={data?.billedYtd.deltaPct ?? null}
        deltaLabel="vs last year"
        deltaGoodDirection="up"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-unbilled-exposure"
        label="Unbilled Exposure"
        value={data?.unbilledExposure.value ?? null}
        format="currency"
        deltaGoodDirection="down"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-avg-days-to-pay"
        label="Avg Days to Pay"
        value={data?.avgDaysToPay.value ?? null}
        format="days"
        deltaGoodDirection="down"
        isLoading={isLoading}
        isError={isError}
      />
      <MetricTile
        testId="kpi-gross-margin"
        label="Gross Margin"
        value={data?.grossMarginPct.value ?? null}
        format="percent"
        deltaGoodDirection="up"
        isLoading={isLoading}
        isError={isError}
        warning={
          data?.grossMarginPct.missingWageTechCount &&
          data.grossMarginPct.missingWageTechCount > 0
            ? `${data.grossMarginPct.missingWageTechCount} technician${
                data.grossMarginPct.missingWageTechCount === 1 ? "" : "s"
              } have no hourly wage set — margin uses fallback rate.`
            : undefined
        }
      />
    </div>
  );
}

function RevenueTrendChart({
  data,
  isLoading,
}: {
  data: TrendPoint[];
  isLoading: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">
        Revenue (13 months, with year-over-year)
      </h3>
      <div className="h-72" data-testid="revenue-trend-chart">
        {isLoading ? (
          <ChartSkeleton />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) => CURRENCY.format(v)}
                tick={{ fontSize: 11 }}
                width={70}
              />
              <ReTooltip
                formatter={(value: number, name: string) => [
                  CURRENCY.format(value),
                  name === "revenue" ? "This year" : "Last year",
                ]}
                labelFormatter={(l, payload) => {
                  if (Array.isArray(payload) && payload.length >= 2) {
                    const curr = Number(payload[0]?.value ?? 0);
                    const prev = Number(payload[1]?.value ?? 0);
                    const yoy = prev > 0 ? ((curr - prev) / prev) * 100 : null;
                    return `${l}${yoy != null ? ` · YoY ${yoy.toFixed(1)}%` : ""}`;
                  }
                  return String(l);
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="revenue"
                name="This year"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="prevYearRevenue"
                name="Last year"
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function PartsVsLaborChart({
  data,
  isLoading,
}: {
  data: TrendPoint[];
  isLoading: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 mb-2">
        Parts vs labor by month
      </h3>
      <div className="h-72" data-testid="parts-vs-labor-chart">
        {isLoading ? (
          <ChartSkeleton />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) => CURRENCY.format(v)}
                tick={{ fontSize: 11 }}
                width={70}
              />
              <ReTooltip formatter={(v: number) => CURRENCY.format(v)} />
              <Legend />
              <Bar
                dataKey="partsRevenue"
                name="Parts"
                stackId="rev"
                fill="#0ea5e9"
              />
              <Bar
                dataKey="laborRevenue"
                name="Labor"
                stackId="rev"
                fill="#22c55e"
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

type MixTab = "partsLabor" | "emergency" | "contract";

function RevenueMixCard({
  data,
  isLoading,
}: {
  data: MixResponse | undefined;
  isLoading: boolean;
}) {
  const [tab, setTab] = useState<MixTab>("partsLabor");

  const slices = useMemo(() => {
    if (!data) return [];
    if (tab === "partsLabor") {
      return [
        { name: "Parts", value: data.partsVsLabor.parts, fill: "#0ea5e9" },
        { name: "Labor", value: data.partsVsLabor.labor, fill: "#22c55e" },
      ];
    }
    if (tab === "emergency") {
      return [
        {
          name: "Emergency",
          value: data.emergencyVsStandard.emergency,
          fill: "#ef4444",
        },
        {
          name: "Standard",
          value: data.emergencyVsStandard.standard,
          fill: "#6366f1",
        },
      ];
    }
    return [
      { name: "Contract", value: data.contractVsAdhoc.contract, fill: "#8b5cf6" },
      { name: "Ad-hoc", value: data.contractVsAdhoc.adhoc, fill: "#f59e0b" },
    ];
  }, [data, tab]);

  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <Card data-testid="revenue-mix-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Revenue mix</CardTitle>
        <Tabs value={tab} onValueChange={(v) => setTab(v as MixTab)}>
          <TabsList>
            <TabsTrigger value="partsLabor" data-testid="mix-tab-parts-labor">
              Parts vs Labor
            </TabsTrigger>
            <TabsTrigger value="emergency" data-testid="mix-tab-emergency">
              Emergency vs Standard
            </TabsTrigger>
            <TabsTrigger value="contract" data-testid="mix-tab-contract">
              Contract vs Ad-hoc
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="h-72 relative" data-testid="revenue-mix-donut">
          {isLoading ? (
            <ChartSkeleton />
          ) : total === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              No revenue in this period.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={2}
                  >
                    {slices.map((s, i) => (
                      <Cell key={i} fill={s.fill} />
                    ))}
                  </Pie>
                  <ReTooltip formatter={(v: number) => CURRENCY.format(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <div className="text-xs text-gray-500">Total</div>
                  <div className="text-xl font-semibold text-gray-900">
                    {CURRENCY.format(total)}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-full w-full rounded-md bg-gray-50 animate-pulse" />
  );
}

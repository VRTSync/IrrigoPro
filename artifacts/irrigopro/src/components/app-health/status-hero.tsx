import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Activity, AlertTriangle, Clock, CheckCircle2, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildAuthHeaders } from "./shared";

type Summary = {
  window: string;
  status: "ok" | "warn" | "crit";
  uptimePct: number;
  uptimeSloPct: number;
  activeUsers: number;
  activeUsersBreakdown: { web: number; mobile: number; total: number };
  errors: number;
  errorsPrev: number;
  apiP95Ms: number;
  apiP95Prev: number;
  syncQueueDepth: number;
  syncQueueStuck: number;
  incidentsOpen: number;
  kpisDelta: {
    activeUsers: number | null;
    errors: number | null;
    apiP95: number | null;
    syncQueue: number | null;
    uptime: number | null;
  };
};

const STATUS_BG: Record<Summary["status"], string> = {
  ok: "bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200",
  warn: "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-300",
  crit: "bg-gradient-to-r from-red-50 to-rose-50 border-red-300",
};
const STATUS_DOT: Record<Summary["status"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-red-600",
};
const STATUS_LABEL: Record<Summary["status"], string> = {
  ok: "All systems operational",
  warn: "Degraded — investigating",
  crit: "Major incident",
};

export function StatusHero({ windowKey }: { windowKey: string }) {
  const { data, isLoading, isError } = useQuery<Summary>({
    queryKey: ["/api/admin/app-health/summary", windowKey],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/app-health/summary?window=${encodeURIComponent(windowKey)}`,
        { credentials: "include", headers: buildAuthHeaders() },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 flex items-center gap-3 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading status…</span>
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-6 flex items-center gap-3 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">Couldn't load status. Will retry shortly.</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border", STATUS_BG[data.status])}>
      <CardContent className="py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="relative inline-flex h-3 w-3">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
                  STATUS_DOT[data.status],
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-3 w-3 rounded-full ring-4 ring-white/60",
                  STATUS_DOT[data.status],
                )}
                data-testid="status-pulse"
              />
            </span>
            <div>
              <div className="text-base font-semibold text-gray-900" data-testid="hero-status-label">
                {STATUS_LABEL[data.status]}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                Last {windowKey} • {data.incidentsOpen} open incident{data.incidentsOpen === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 flex-1 max-w-3xl">
            <Kpi
              icon={CheckCircle2}
              label="Uptime"
              value={`${data.uptimePct.toFixed(2)}%`}
              sub={formatDelta(data.kpisDelta.uptime, false) + ` · SLO ${data.uptimeSloPct}%`}
              tone={data.uptimePct >= data.uptimeSloPct ? "ok" : "warn"}
              testId="kpi-uptime"
            />
            <Kpi
              icon={Users}
              label="Active users"
              value={data.activeUsers.toLocaleString()}
              sub={formatDelta(data.kpisDelta.activeUsers, false) + ` · ${data.activeUsersBreakdown.mobile} mobile`}
              tone="info"
              testId="kpi-active-users"
            />
            <Kpi
              icon={AlertTriangle}
              label="Errors"
              value={data.errors.toLocaleString()}
              sub={formatDelta(data.kpisDelta.errors, true)}
              tone={data.errors > 0 ? (data.kpisDelta.errors != null && data.kpisDelta.errors > 0 ? "warn" : "info") : "ok"}
              testId="kpi-errors"
            />
            <Kpi
              icon={Clock}
              label="API p95"
              value={data.apiP95Ms ? `${data.apiP95Ms} ms` : "—"}
              sub={formatDelta(data.kpisDelta.apiP95, true)}
              tone={data.apiP95Ms > 1500 ? "warn" : "info"}
              testId="kpi-p95"
            />
            <Kpi
              icon={Zap}
              label="Sync queue"
              value={data.syncQueueDepth.toString()}
              sub={
                formatDelta(data.kpisDelta.syncQueue, true) +
                (data.syncQueueStuck > 0 ? ` · ${data.syncQueueStuck} stuck >1h` : "")
              }
              tone={data.syncQueueStuck > 0 ? "warn" : "ok"}
              testId="kpi-sync"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDelta(delta: number | null, lowerIsBetter: boolean): string {
  if (delta == null) return "—";
  if (delta === 0) return "no change";
  const sign = delta > 0 ? "▲" : "▼";
  const word = (delta > 0) === lowerIsBetter ? "worse" : "better";
  return `${sign} ${Math.abs(delta).toFixed(1)}% ${word}`;
}

function Kpi({
  icon: Icon, label, value, sub, tone, testId,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "info";
  testId?: string;
}) {
  const toneText: Record<typeof tone, string> = {
    ok: "text-emerald-700",
    warn: "text-amber-700",
    info: "text-gray-700",
  };
  return (
    <div className="rounded-md bg-white/70 backdrop-blur-sm border border-white px-3 py-2 shadow-sm" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-gray-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("text-base font-semibold mt-0.5 tabular-nums", toneText[tone])}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

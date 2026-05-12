import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ChevronRight, AlertTriangle, Building2,
  Activity, Cloud, Image as ImageIcon, FileText, Receipt, WifiOff, MapPin,
} from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";
import { HealthScoreBar, bucketLabel, type HealthBucket } from "./health-score-bar";

type TimeseriesResponse = {
  window: string;
  bucket: string;
  buckets: Array<{ ts: string; requests: number; errors: number; warnings: number; fatal: number }>;
};

type CrashGroupRow = {
  fingerprint: string;
  name: string;
  sampleMessage: string | null;
  severity: string;
  eventCount: number;
  userCount: number;
  lastSeenAt: string;
  isRegression: boolean;
};
type CrashListResponse = { groups: CrashGroupRow[] };

type CompanyAttention = {
  id: number;
  name: string;
  healthScore: number;
  healthBucket: HealthBucket;
  errors24h: number;
  syncQueue: number | null;
  activeNow: number;
};

type AuditEvent = {
  id: number;
  occurredAt: string;
  actorLabel: string | null;
  actorRole: string | null;
  actionType: string;
  action: string;
  severity: "info" | "warning" | "error" | "critical";
  summary: string | null;
};
type AuditListResponse = { events: AuditEvent[]; total: number };

export function OverviewTab({
  windowKey,
  onOpenCrash,
}: {
  windowKey: string;
  onOpenCrash?: (fingerprint: string) => void;
}) {
  const { data, isLoading, isError } = useQuery<TimeseriesResponse>({
    queryKey: ["/api/admin/app-health/timeseries", windowKey],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/app-health/timeseries?window=${encodeURIComponent(windowKey)}`,
        { credentials: "include", headers: buildAuthHeaders() },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const topErrors = useQuery<CrashListResponse>({
    // Spec: "Top errors today" — hard-scope to the last 24h regardless
    // of the page-level window selector.
    queryKey: ["/api/admin/app-health/crashes", "overview-top-24h"],
    queryFn: async () => {
      const usp = new URLSearchParams({ status: "open", window: "24h", limit: "4" });
      const res = await fetch(`/api/admin/app-health/crashes?${usp}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const companies = useQuery<{ companies: CompanyAttention[] }>({
    queryKey: ["/api/admin/app-health/companies", "overview-attention"],
    queryFn: async () => {
      const res = await fetch("/api/admin/app-health/companies", {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  // Critical / error events feed — uses the same audit endpoint that
  // backs the Audit Log tab so the data is already filtered for
  // operationally-meaningful events.
  const criticalEvents = useQuery<AuditListResponse>({
    queryKey: ["/api/admin/app-health/audit", "overview-critical", windowKey],
    queryFn: async () => {
      const usp = new URLSearchParams({ severity: "warning,error,critical", limit: "6" });
      const ms: Record<string, number> = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        "90d": 90 * 24 * 60 * 60 * 1000,
      };
      if (ms[windowKey]) {
        usp.set("from", new Date(Date.now() - ms[windowKey]).toISOString());
      }
      const res = await fetch(`/api/admin/app-health/audit?${usp}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const chartData = useMemo(() => {
    return (data?.buckets ?? []).map((b) => ({
      ...b,
      label: formatBucket(b.ts, data?.bucket ?? "1 hour"),
    }));
  }, [data]);

  const totals = useMemo(() => {
    const out = { requests: 0, errors: 0, warnings: 0, fatal: 0 };
    for (const b of chartData) {
      out.requests += b.requests;
      out.errors += b.errors;
      out.warnings += b.warnings;
      out.fatal += b.fatal;
    }
    return out;
  }, [chartData]);

  const attention = useMemo(() => {
    const list = companies.data?.companies ?? [];
    return list
      // Spec: always show the lowest 4 tenants by health score
      // (don't bucket-filter — even an "ok" tenant lands here if it
      // happens to be the worst-scoring one).
      .slice(0, 4);
  }, [companies.data]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Requests" value={totals.requests.toLocaleString()} sub={`across ${chartData.length} buckets`} />
        <Tile label="Errors (5xx + app)" value={totals.errors.toLocaleString()} tone={totals.errors > 0 ? "warn" : "ok"} />
        <Tile label="Warnings" value={totals.warnings.toLocaleString()} />
        <Tile label="Fatals" value={totals.fatal.toLocaleString()} tone={totals.fatal > 0 ? "crit" : "ok"} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Requests &amp; events — last {windowKey}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="h-72 flex items-center justify-center text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <div className="h-72 flex items-center justify-center text-sm text-red-600">
              Couldn't load chart.
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-gray-500">
              No data in this window yet.
            </div>
          ) : (
            <div className="h-72" data-testid="overview-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* Errors / warnings / fatal — stacked bars per spec. */}
                  <Bar yAxisId="left" dataKey="warnings" stackId="sev" fill="#f59e0b" name="Warnings" />
                  <Bar yAxisId="left" dataKey="errors" stackId="sev" fill="#ef4444" name="Errors" />
                  <Bar yAxisId="left" dataKey="fatal" stackId="sev" fill="#7f1d1d" name="Fatal" radius={[2, 2, 0, 0]} />
                  {/* Requests overlay as a secondary line on the right axis. */}
                  <Line yAxisId="right" type="monotone" dataKey="requests" stroke="#3b82f6" strokeWidth={2} name="Requests" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Top errors — last 24h
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {topErrors.isLoading ? (
              <PanelLoading />
            ) : topErrors.isError ? (
              <PanelError />
            ) : (topErrors.data?.groups ?? []).length === 0 ? (
              <PanelEmpty text="No open errors. Quiet shift." />
            ) : (
              <ul className="divide-y rounded-md border" data-testid="top-errors-list">
                {(topErrors.data?.groups ?? []).map((g) => (
                  <li
                    key={g.fingerprint}
                    onClick={onOpenCrash ? () => onOpenCrash(g.fingerprint) : undefined}
                    className={`px-3 py-2.5 flex items-center justify-between gap-3 text-sm ${
                      onOpenCrash ? "cursor-pointer hover:bg-gray-50" : ""
                    }`}
                    data-testid={`top-error-${g.fingerprint}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate" title={g.name}>{g.name}</div>
                      <div className="text-[11px] text-gray-500 truncate" title={g.sampleMessage ?? ""}>
                        {g.sampleMessage ?? "—"}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2">
                        <span>{g.userCount} user{g.userCount === 1 ? "" : "s"}</span>
                        <span>•</span>
                        <span>{formatRelative(g.lastSeenAt)}</span>
                        {g.isRegression && (
                          <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-[10px] py-0 px-1.5">REGRESSION</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={g.severity === "fatal" || g.severity === "error" ? "destructive" : "secondary"} className="text-[10px]">
                        {g.severity}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums w-10 text-right">{g.eventCount}</span>
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[11px] text-gray-500 mt-2 italic">
              Open the Crashes &amp; Errors tab for full triage and bulk actions.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-500" />
              Companies needing attention
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {companies.isLoading ? (
              <PanelLoading />
            ) : companies.isError ? (
              <PanelError />
            ) : attention.length === 0 ? (
              <PanelEmpty text="Every tenant healthy. ✨" />
            ) : (
              <ul className="divide-y rounded-md border" data-testid="companies-attention-list">
                {attention.map((c) => (
                  <li key={c.id} className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{c.name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {c.errors24h} errors • {c.syncQueue == null ? "—" : c.syncQueue} queued • {c.activeNow} active
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 min-w-[180px]">
                      <HealthScoreBar score={c.healthScore} bucket={c.healthBucket} />
                      <span className="text-[10px] uppercase tracking-wide text-gray-500 w-14 text-right">
                        {bucketLabel(c.healthBucket)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[11px] text-gray-500 mt-2 italic">
              Open the Companies tab to drill into any tenant.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operational health strip — six spec domains. Wired tiles light
          up; the rest show "—" until later phases instrument them. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">IrrigoPro operational health</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <OpsTilesRow />

          <div className="text-[10px] text-gray-500 mt-2 italic">
            Uptime and request-rate KPIs above are process-local
            approximations until persistent telemetry ships.
          </div>
        </CardContent>
      </Card>

      {/* Recent critical / elevated audit events feed. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent critical events</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {criticalEvents.isLoading ? (
            <PanelLoading />
          ) : criticalEvents.isError ? (
            <PanelError />
          ) : (criticalEvents.data?.events ?? []).length === 0 ? (
            <PanelEmpty text="No elevated events in this window." />
          ) : (
            <ul className="divide-y rounded-md border" data-testid="critical-events-list">
              {(criticalEvents.data?.events ?? []).map((e) => (
                <li key={e.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {e.summary ?? e.action}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {e.actorLabel ?? "system"} • {e.actionType} • {formatRelative(e.occurredAt)}
                    </div>
                  </div>
                  <Badge
                    variant={e.severity === "critical" || e.severity === "error" ? "destructive" : "secondary"}
                    className="text-[10px] shrink-0"
                  >
                    {e.severity}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[11px] text-gray-500 mt-2 italic">
            Open the Audit Log tab for full filters and pagination.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type OpsResponse = {
  photoUpload: { successPct: number | null; attempts: number; ok: number; failed: number };
  wetCheckSync: { successPct: number | null; attempts: number };
  stuckEvents: number;
  offlineSessions: number;
  pdfRenderP95Ms: number | null;
  invoiceFailures: number | null;
  mapTileErrors: number | null;
};

function OpsTilesRow() {
  const { data } = useQuery<OpsResponse>({
    queryKey: ["/api/admin/app-health/ops", "24h"],
    queryFn: async () => {
      const res = await fetch("/api/admin/app-health/ops?window=24h", {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const photoTone: "ok" | "warn" | "bad" | "muted" =
    data?.photoUpload?.successPct == null
      ? "muted"
      : data.photoUpload.successPct >= 95 ? "ok"
      : data.photoUpload.successPct >= 85 ? "warn"
      : "bad";
  const photoVal = data?.photoUpload?.successPct != null
    ? `${data.photoUpload.successPct}%` : "—";
  const photoHint = data?.photoUpload?.attempts != null
    ? `${data.photoUpload.ok}/${data.photoUpload.attempts} ok` : "no data";

  const wcTone: "ok" | "warn" | "bad" | "muted" =
    data?.wetCheckSync?.successPct == null
      ? "muted"
      : data.wetCheckSync.successPct >= 95 ? "ok"
      : data.wetCheckSync.successPct >= 85 ? "warn"
      : "bad";
  const wcVal = data?.wetCheckSync?.successPct != null
    ? `${data.wetCheckSync.successPct}%` : "—";
  const wcHint = data?.wetCheckSync?.attempts != null
    ? `${data.wetCheckSync.attempts} attempts` : "no data";

  const offlineTone: "ok" | "warn" | "bad" | "muted" =
    !data ? "muted"
    : data.offlineSessions === 0 ? "ok"
    : data.offlineSessions < 5 ? "warn"
    : "bad";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <OpsTile icon={ImageIcon} label="Photo upload" value={photoVal} tone={photoTone} hint={photoHint} />
      <OpsTile icon={Cloud} label="Wet checks synced" value={wcVal} tone={wcTone} hint={wcHint} />
      <OpsTile
        icon={FileText}
        label="PDF render p95"
        value={data?.pdfRenderP95Ms != null ? `${data.pdfRenderP95Ms.toLocaleString()}ms` : "—"}
        tone={
          data?.pdfRenderP95Ms == null ? "muted"
          : data.pdfRenderP95Ms < 3000 ? "ok"
          : data.pdfRenderP95Ms < 8000 ? "warn"
          : "bad"
        }
        hint={data?.pdfRenderP95Ms == null ? "no data" : "24h"}
      />
      <OpsTile
        icon={Receipt}
        label="Invoice gen failures"
        value={data?.invoiceFailures != null ? data.invoiceFailures.toLocaleString() : "—"}
        tone={
          data?.invoiceFailures == null ? "muted"
          : data.invoiceFailures === 0 ? "ok"
          : data.invoiceFailures < 5 ? "warn"
          : "bad"
        }
        hint={data?.invoiceFailures == null ? "no data" : "24h"}
      />
      <OpsTile icon={WifiOff} label="Offline sessions" value={data?.offlineSessions?.toLocaleString() ?? "—"} tone={offlineTone} hint={data ? `${data.stuckEvents} stuck` : "no data"} />
      <OpsTile
        icon={MapPin}
        label="Map tile errors"
        value={data?.mapTileErrors != null ? data.mapTileErrors.toLocaleString() : "—"}
        tone={
          data?.mapTileErrors == null ? "muted"
          : data.mapTileErrors === 0 ? "ok"
          : data.mapTileErrors < 50 ? "warn"
          : "bad"
        }
        hint={data?.mapTileErrors == null ? "no data" : "24h"}
      />
    </div>
  );
}

function OpsTile({
  icon: Icon, label, value, tone, hint,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad" | "muted";
  hint?: string;
}) {
  const colors: Record<typeof tone, string> = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    bad: "border-red-200 bg-red-50 text-red-900",
    muted: "border-gray-200 bg-gray-50 text-gray-500",
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${colors[tone]}`} data-testid={`ops-tile-${label.toLowerCase()}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-80">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-sm font-semibold mt-0.5 tabular-nums">{value}</div>
      {hint && <div className="text-[9px] opacity-60 mt-0.5">{hint}</div>}
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="h-32 flex items-center justify-center text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}
function PanelError() {
  return <div className="h-32 flex items-center justify-center text-sm text-red-600">Couldn't load.</div>;
}
function PanelEmpty({ text }: { text: string }) {
  return <div className="h-32 flex items-center justify-center text-sm text-gray-500">{text}</div>;
}

function formatBucket(iso: string, bucket: string): string {
  const d = new Date(iso);
  if (bucket === "1 day") return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

function Tile({ label, value, sub, tone = "info" }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "crit" | "info" }) {
  const toneClass = {
    ok: "text-emerald-700",
    warn: "text-amber-700",
    crit: "text-red-700",
    info: "text-gray-900",
  }[tone];
  return (
    <div className="rounded-md border bg-white px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

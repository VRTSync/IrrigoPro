import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, WifiOff, ImageIcon, AlertTriangle, Users, ServerCrash, CloudOff,
} from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";

type StuckItem = {
  kind: string;
  userId: number | null;
  userName: string | null;
  companyName: string | null;
  ageMinutes: number;
  status: string;
};
type SyncQueueResponse = {
  window: string;
  queueDepth: number;
  queueStuck: number;
  conflicts: number;
  avgAgeMinutes: number | null;
  stuckEvents: number;
  stuckItems: StuckItem[];
  topUsers: Array<{
    userId: number; name: string | null;
    companyId: number | null; companyName: string | null;
    events: number;
  }>;
};

type StepRate = { ok: number; failed: number; total: number; successRate: number | null };
type PhotoUploadsResponse = {
  window: string;
  totalAttempts: number;
  ok: number;
  failed: number;
  successRate: number | null;
  steps: { sign: StepRate; put: StepRate; finalize: StepRate; metadata: StepRate };
  s3Degraded: boolean;
  topFailures: Array<{ message: string; c: number }>;
};

const S3_DEGRADED_THRESHOLD = 90; // success% below this lights the inline notice.

export function SyncTab({ windowKey }: { windowKey: string }) {
  const sync = useQuery<SyncQueueResponse>({
    queryKey: ["/api/admin/app-health/sync/queue", windowKey],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/app-health/sync/queue?window=${encodeURIComponent(windowKey)}`,
        { credentials: "include", headers: buildAuthHeaders() },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const uploads = useQuery<PhotoUploadsResponse>({
    // Photo pipeline is always last-1h per spec (regardless of the
    // page-level window selector), so the queryKey is fixed.
    queryKey: ["/api/admin/app-health/uploads/photos", "1h"],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/app-health/uploads/photos?window=1h`,
        { credentials: "include", headers: buildAuthHeaders() },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const stuckItems = useMemo(() => sync.data?.stuckItems ?? [], [sync.data]);

  return (
    <div className="space-y-4">
      {/* ─── Card 1: Offline queue health ───────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <WifiOff className="h-4 w-4 text-amber-500" />
            Offline queue health
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile
              label="Queued (now)"
              value={sync.data?.queueDepth?.toLocaleString() ?? "—"}
              tone={sync.data && sync.data.queueDepth > 100 ? "warn" : "ok"}
            />
            <Tile
              label="Stuck > 1h"
              value={sync.data?.queueStuck?.toLocaleString() ?? "—"}
              tone={sync.data && sync.data.queueStuck > 0 ? "warn" : "ok"}
            />
            <Tile
              label="Conflicts (24h)"
              value={sync.data?.conflicts?.toLocaleString() ?? "—"}
              tone={sync.data && sync.data.conflicts > 0 ? "warn" : "ok"}
            />
            <Tile
              label="Avg age"
              value={
                sync.data?.avgAgeMinutes != null
                  ? `${formatMinutes(sync.data.avgAgeMinutes)}`
                  : "—"
              }
              tone={sync.data && (sync.data.avgAgeMinutes ?? 0) > 30 ? "warn" : "ok"}
            />
          </div>

          {/* Stuck items table */}
          <div>
            <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-gray-400" />
              Stuck items — {windowKey}
            </div>
            {sync.isLoading ? (
              <PanelLoading />
            ) : sync.isError ? (
              <PanelError />
            ) : stuckItems.length === 0 ? (
              <PanelEmpty text="No stuck items in this window. All clear." />
            ) : (
              <div className="overflow-x-auto rounded-md border" data-testid="stuck-items-table">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Type</th>
                      <th className="text-left font-medium px-3 py-2">User</th>
                      <th className="text-left font-medium px-3 py-2">Company</th>
                      <th className="text-right font-medium px-3 py-2">Age</th>
                      <th className="text-left font-medium px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stuckItems.map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2 font-mono text-[12px] text-gray-700">{item.kind}</td>
                        <td className="px-3 py-2 text-gray-900">{item.userName ?? `User #${item.userId ?? "?"}`}</td>
                        <td className="px-3 py-2 text-gray-600">{item.companyName ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                          {formatMinutes(item.ageMinutes)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={item.status === "failed" ? "destructive" : "secondary"}>
                            {item.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {(sync.data?.topUsers ?? []).length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1.5">Top stuck-sync users</div>
              <ul className="divide-y rounded-md border" data-testid="top-stuck-users">
                {(sync.data?.topUsers ?? []).map((u) => (
                  <li key={u.userId} className="px-3 py-2 flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{u.name ?? `User #${u.userId}`}</div>
                      <div className="text-[11px] text-gray-500 truncate">{u.companyName ?? "—"}</div>
                    </div>
                    <Badge variant="secondary" className="tabular-nums">{u.events}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Card 2: Photo upload pipeline rates ───────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-blue-500" />
            Photo upload pipeline — last 1h
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {uploads.data?.s3Degraded && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              data-testid="s3-degraded-notice"
            >
              <CloudOff className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">S3 uploads degraded</div>
                <div className="text-[12px] text-amber-700">
                  Object-storage PUT success has fallen below {S3_DEGRADED_THRESHOLD}%.
                  Photos are being re-queued client-side and will catch up when storage recovers.
                </div>
              </div>
            </div>
          )}

          {uploads.isLoading ? (
            <PanelLoading />
          ) : uploads.isError ? (
            <PanelError />
          ) : uploads.data && uploads.data.totalAttempts === 0 ? (
            <PanelEmpty text="No photo uploads in this window." />
          ) : uploads.data ? (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="upload-pipeline-steps">
              <StepTile
                label="Captured"
                value={uploads.data.totalAttempts.toLocaleString()}
                sub="captures attempted"
                tone="info"
              />
              <StepTile
                label="DB (sign)"
                value={pct(uploads.data.steps.sign.successRate)}
                sub={`${uploads.data.steps.sign.ok}/${uploads.data.steps.sign.total}`}
                tone={toneFor(uploads.data.steps.sign.successRate)}
              />
              <StepTile
                label="S3 (put)"
                value={pct(uploads.data.steps.put.successRate)}
                sub={`${uploads.data.steps.put.ok}/${uploads.data.steps.put.total}`}
                tone={toneFor(uploads.data.steps.put.successRate)}
              />
              <StepTile
                label="CDN (finalize)"
                value={pct(uploads.data.steps.finalize.successRate)}
                sub={`${uploads.data.steps.finalize.ok}/${uploads.data.steps.finalize.total}`}
                tone={toneFor(uploads.data.steps.finalize.successRate)}
              />
              <StepTile
                label="EXIF / metadata"
                value={pct(uploads.data.steps.metadata.successRate)}
                sub={`${uploads.data.steps.metadata.ok}/${uploads.data.steps.metadata.total}`}
                tone={toneFor(uploads.data.steps.metadata.successRate)}
              />
            </div>
          ) : null}

          <div>
            <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              Top upload failures
            </div>
            {uploads.isLoading ? (
              <PanelLoading />
            ) : uploads.isError ? (
              <PanelError />
            ) : (uploads.data?.topFailures ?? []).length === 0 ? (
              <PanelEmpty text="No failed uploads in this window." />
            ) : (
              <ul className="divide-y rounded-md border" data-testid="top-upload-failures">
                {(uploads.data?.topFailures ?? []).map((f, idx) => (
                  <li key={idx} className="px-3 py-2 flex items-center justify-between text-sm gap-3">
                    <div className="min-w-0 truncate text-gray-700" title={f.message}>{f.message}</div>
                    <Badge variant="destructive" className="tabular-nums shrink-0">{f.c}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {sync.data && sync.data.stuckEvents > 0 && (
        <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <ServerCrash className="h-3 w-3" />
          {sync.data.stuckEvents.toLocaleString()} sync.stuck events recorded across this window.
          Last data refresh {formatRelative(new Date().toISOString())}.
        </div>
      )}
    </div>
  );
}

function formatMinutes(min: number): string {
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
function pct(v: number | null): string {
  return v == null ? "—" : `${v}%`;
}
function toneFor(v: number | null): "ok" | "warn" | "crit" | "info" {
  if (v == null) return "info";
  if (v >= 95) return "ok";
  if (v >= 85) return "warn";
  return "crit";
}

function PanelLoading() {
  return (
    <div className="h-24 flex items-center justify-center text-gray-400">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
function PanelError() {
  return <div className="h-20 flex items-center justify-center text-sm text-red-600">Couldn't load.</div>;
}
function PanelEmpty({ text }: { text: string }) {
  return <div className="h-20 flex items-center justify-center text-sm text-gray-500">{text}</div>;
}
function Tile({ label, value, sub, tone = "info" }: {
  label: string; value: string; sub?: string; tone?: "ok" | "warn" | "crit" | "info";
}) {
  const toneClass =
    tone === "ok" ? "text-emerald-700"
    : tone === "warn" ? "text-amber-700"
    : tone === "crit" ? "text-red-700"
    : "text-gray-900";
  return (
    <div className="rounded-md border bg-white py-3 px-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-0.5 ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function StepTile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone: "ok" | "warn" | "crit" | "info";
}) {
  const toneClass =
    tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800"
    : tone === "crit" ? "border-red-200 bg-red-50 text-red-800"
    : "border-gray-200 bg-white text-gray-900";
  return (
    <div className={`rounded-md border py-2 px-3 ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}

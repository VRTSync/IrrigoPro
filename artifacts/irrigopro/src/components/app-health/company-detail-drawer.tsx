import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Building2, RefreshCw, UserCog, PauseCircle, FileDown, KeyRound } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";
import { HealthScoreBar, bucketLabel, type HealthBucket } from "./health-score-bar";
import type { CompanyHealth } from "./companies-tab";

type DetailResponse = {
  company: CompanyHealth;
  users: Array<{ id: number; name: string; username: string; role: string; lastSeenAt: string | null; isActive: boolean }>;
  topIssues: Array<{ fingerprint: string; name: string; sampleMessage: string | null; severity: string; eventCount: number; lastSeenAt: string }>;
  resources: { storageBytes: number | null; monthlyApiCalls: number | null; syncQueueDepth: number | null; photoUploadPct: number | null };
};

export function CompanyDetailDrawer({
  companyId,
  onClose,
  onOpenCrash,
}: {
  companyId: number | null;
  onClose: () => void;
  onOpenCrash?: (fingerprint: string) => void;
}) {
  const open = companyId != null;
  const { data, isLoading, isError, isFetching, refetch } = useQuery<DetailResponse>({
    queryKey: ["/api/admin/app-health/companies", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/app-health/companies/${companyId}?refresh=1`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: open,
    // Aligns with the page-wide 10s staleness convention; the drawer
    // intentionally does not poll, so manual reload is the only way
    // to refresh after the first 10s window.
    staleTime: 10_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="company-drawer"
      >
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {data?.company?.name ?? "Company detail"}
            </SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="company-drawer-reload"
              title="Reload"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : isError || !data ? (
          <div className="py-12 text-center text-sm text-gray-600">Couldn't load detail.</div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="rounded-md border bg-gray-50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">Health score</div>
                  <div className="text-2xl font-semibold tabular-nums">{data.company.healthScore}</div>
                </div>
                <div className="flex-1 max-w-[240px]">
                  <HealthScoreBar score={data.company.healthScore} bucket={data.company.healthBucket as HealthBucket} />
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-1 text-right">
                    {bucketLabel(data.company.healthBucket as HealthBucket)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <KV k="Plan" v={data.company.plan ?? "—"} />
                <KV k="Users" v={String(data.company.totalUsers)} />
                <KV k="Active now" v={String(data.company.activeNow)} />
                <KV k="App version" v={data.company.appVersion ? data.company.appVersion.slice(0, 10) : "—"} />
              </div>
            </div>

            <Section title="Resource usage">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <KV k="Errors 24h" v={String(data.company.errors24h)} />
                <KV k="Sync queue" v={data.resources.syncQueueDepth == null ? "—" : String(data.resources.syncQueueDepth)} />
                <KV
                  k="Photo upload"
                  v={data.resources.photoUploadPct == null ? "—" : `${data.resources.photoUploadPct.toFixed(1)}%`}
                />
                <KV k="Storage" v={data.resources.storageBytes == null ? "—" : formatBytes(data.resources.storageBytes)} />
              </div>
            </Section>

            <Section title="Top issues (last 7 days)">
              {data.topIssues.length === 0 ? (
                <div className="text-xs text-gray-500 italic">No issues — nice.</div>
              ) : (
                <div className="divide-y rounded-md border">
                  {data.topIssues.map((iss) => {
                    const clickable = !!onOpenCrash;
                    return (
                      <button
                        key={iss.fingerprint}
                        type="button"
                        onClick={() => {
                          if (onOpenCrash) {
                            onOpenCrash(iss.fingerprint);
                            onClose();
                          }
                        }}
                        disabled={!clickable}
                        className={
                          "w-full text-left px-3 py-2 flex items-center justify-between gap-3 " +
                          (clickable ? "hover:bg-gray-50 cursor-pointer" : "cursor-default")
                        }
                        data-testid={`drawer-issue-${iss.fingerprint}`}
                        title={clickable ? "Open crash details" : undefined}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate" title={iss.name}>{iss.name}</div>
                          {iss.sampleMessage && (
                            <div className="text-[11px] text-gray-500 truncate" title={iss.sampleMessage}>
                              {iss.sampleMessage}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant={iss.severity === "fatal" || iss.severity === "error" ? "destructive" : "secondary"} className="text-[10px]">
                            {iss.severity}
                          </Badge>
                          <span className="text-xs tabular-nums text-gray-700">{iss.eventCount}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Admin actions">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled title="Coming in Phase 5" data-testid="action-impersonate">
                  <UserCog className="h-4 w-4 mr-2" /> Impersonate
                </Button>
                <Button variant="outline" size="sm" disabled title="Coming in Phase 5" data-testid="action-suspend">
                  <PauseCircle className="h-4 w-4 mr-2" /> Suspend tenant
                </Button>
                <Button variant="outline" size="sm" disabled title="Coming in Phase 5" data-testid="action-export-tenant">
                  <FileDown className="h-4 w-4 mr-2" /> Export data
                </Button>
                <Button variant="outline" size="sm" disabled title="Coming in Phase 5" data-testid="action-reset-2fa">
                  <KeyRound className="h-4 w-4 mr-2" /> Reset 2FA
                </Button>
              </div>
              <div className="text-[10px] text-gray-500 mt-2 italic">Live admin actions arrive in Phase 5.</div>
            </Section>

            <Section title="Users">
              <div className="divide-y rounded-md border max-h-72 overflow-y-auto">
                {data.users.map((u) => (
                  <div key={u.id} className="px-3 py-1.5 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{u.name}</div>
                      <div className="text-[11px] text-gray-500">{u.username} • {u.role}</div>
                    </div>
                    <div className="text-[11px] text-gray-500 shrink-0">
                      {u.isActive ? formatRelative(u.lastSeenAt) : <span className="text-amber-700">inactive</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{k}</div>
      <div className="text-sm font-medium text-gray-900">{v}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";
import { asArray } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

// Task #545 — Crash report dashboard. Surfaces what `/api/client-errors`
// has been collecting so admins can answer "is this getting worse?" or
// "which build hash is responsible?" without grepping log files.

type CrashGroup = {
  buildHash: string;
  name: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sampleMessage: string | null;
  sampleStack: string | null;
  sampleUrl: string | null;
  sampleComponentStack: string | null;
};

type CrashReport = {
  windowDays: number;
  total: number;
  groups: CrashGroup[];
};

function readUserRole(): string | undefined {
  try {
    return JSON.parse(safeGet("user") || "{}").role as string | undefined;
  } catch {
    return undefined;
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function shortHash(h: string): string {
  if (!h) return "(unknown)";
  return h.length > 10 ? `${h.slice(0, 10)}…` : h;
}

export default function AdminClientErrorsPage() {
  const role = readUserRole();
  const allowed = role === "super_admin" || role === "company_admin";
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CrashReport>({
    queryKey: ["/api/admin/client-errors"],
    enabled: allowed,
  });

  const groups = useMemo(() => asArray<CrashGroup>(data?.groups), [data]);

  const buildTotals = useMemo(() => {
    const byBuild = new Map<string, number>();
    for (const g of groups) {
      byBuild.set(g.buildHash, (byBuild.get(g.buildHash) ?? 0) + g.count);
    }
    return Array.from(byBuild.entries()).sort((a, b) => b[1] - a[1]);
  }, [groups]);
  const buildSummary = useMemo(() => buildTotals.slice(0, 6), [buildTotals]);

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Admin access required</h1>
        <p className="text-gray-600">You don't have permission to view crash reports.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Crash reports</h1>
          <p className="text-sm text-gray-600 mt-1">
            Client-side errors caught by the app over the last{" "}
            {data?.windowDays ?? 30} days, grouped by build and error type.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-red-600">
            Couldn't load crash reports{error instanceof Error ? `: ${error.message}` : ""}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-medium">Total reports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{data?.total ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">last {data?.windowDays ?? 30} days</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-medium">Distinct error groups</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{groups.length}</div>
                <div className="text-xs text-gray-500 mt-1">build × error name</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-medium">Builds with reports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{buildTotals.length}</div>
                <div className="text-xs text-gray-500 mt-1">distinct buildHash values</div>
              </CardContent>
            </Card>
          </div>

          {buildSummary.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top builds by report volume</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {buildSummary.map(([hash, count]) => (
                    <Badge key={hash} variant="secondary" className="font-mono text-xs">
                      {shortHash(hash)} · {count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent error groups</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {groups.length === 0 ? (
                <div className="py-12 text-center text-gray-500 text-sm">
                  No crash reports in the last {data?.windowDays ?? 30} days.
                </div>
              ) : (
                <div className="divide-y">
                  {groups.map((g) => {
                    const key = `${g.buildHash}::${g.name}`;
                    const open = !!expanded[key];
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          onClick={() => setExpanded((s) => ({ ...s, [key]: !open }))}
                          className="w-full flex items-start gap-3 text-left px-4 py-3 hover:bg-gray-50"
                        >
                          <span className="mt-0.5 text-gray-400">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-900">{g.name || "Error"}</span>
                              <Badge variant="secondary" className="font-mono text-[11px]">
                                build {shortHash(g.buildHash)}
                              </Badge>
                              <Badge variant="default">{g.count}</Badge>
                            </div>
                            {g.sampleMessage && (
                              <div className="text-sm text-gray-600 mt-1 truncate">
                                {g.sampleMessage}
                              </div>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                              First seen {formatRelative(g.firstSeen)} · last seen {formatRelative(g.lastSeen)}
                            </div>
                          </div>
                        </button>
                        {open && (
                          <div className="px-4 pb-4 pl-11 space-y-3 bg-gray-50">
                            {g.sampleUrl && (
                              <div className="text-xs">
                                <span className="font-semibold text-gray-700">URL: </span>
                                <span className="text-gray-600 break-all">{g.sampleUrl}</span>
                              </div>
                            )}
                            {g.sampleStack && (
                              <div>
                                <div className="text-xs font-semibold text-gray-700 mb-1">Sample stack</div>
                                <pre className="text-[11px] bg-white border rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap break-words">
{g.sampleStack}
                                </pre>
                              </div>
                            )}
                            {g.sampleComponentStack && (
                              <div>
                                <div className="text-xs font-semibold text-gray-700 mb-1">Component stack</div>
                                <pre className="text-[11px] bg-white border rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-words">
{g.sampleComponentStack}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Activity,
  Bug,
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plug,
  RefreshCw,
  ShieldOff,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { StatusHero } from "@/components/app-health/status-hero";
import { OverviewTab } from "@/components/app-health/overview-tab";
import { CompaniesTab } from "@/components/app-health/companies-tab";
import { AuditTab } from "@/components/app-health/audit-tab";
import { SyncTab } from "@/components/app-health/sync-tab";
import { UsersTab } from "@/components/app-health/users-tab";

// Task #550 — Super Admin App Health page (Phase 1).
// Phase 1 ships the page chrome and the working Crashes tab. The other
// six tabs render a "Coming soon" placeholder so the chrome reads
// complete; subsequent phases (System status, Companies, Users, Sync &
// Uploads, Integrations, Audit Log) replace those placeholders.

type CrashGroup = {
  id: number;
  fingerprint: string;
  name: string;
  sampleMessage: string | null;
  severity: "info" | "warning" | "error" | "fatal";
  type: string;
  source: string;
  component: string | null;
  appVersion: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventCount: number;
  userCount: number;
  companyCount: number;
  status: "open" | "muted" | "resolved" | "snoozed";
  isRegression: boolean;
  latestUrl: string | null;
};

type CrashListResponse = {
  groups: CrashGroup[];
  total: number;
  window: string;
};

type Breadcrumb = {
  t?: number;
  kind?: string;
  url?: string;
  [key: string]: unknown;
};

type CrashEvent = {
  id: number;
  name: string;
  message: string;
  stack: string | null;
  componentStack: string | null;
  url: string | null;
  userAgent: string | null;
  buildHash: string | null;
  appVersion: string | null;
  userId: number | null;
  companyId: number | null;
  sessionId: string | null;
  severity: string;
  type: string;
  source: string;
  component: string | null;
  breadcrumbs: Breadcrumb[] | null;
  context: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
};

type CrashDetailResponse = {
  group: CrashGroup;
  events: CrashEvent[];
  breadcrumbs: Breadcrumb[] | null;
};

type WindowKey = "24h" | "7d" | "30d" | "90d";
type StatusKey = "open" | "muted" | "resolved" | "snoozed";
type TabKey =
  | "crashes"
  | "system"
  | "companies"
  | "users"
  | "sync"
  | "integrations"
  | "audit";

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

function severityClasses(sev: string): { bar: string; text: string; bg: string } {
  switch (sev) {
    case "fatal":
      return { bar: "bg-red-700", text: "text-red-800", bg: "bg-red-50" };
    case "error":
      return { bar: "bg-red-500", text: "text-red-700", bg: "bg-red-50" };
    case "warning":
      return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" };
    default:
      return { bar: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" };
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "open":
      return <Badge variant="destructive">Open</Badge>;
    case "muted":
      return <Badge variant="secondary">Muted</Badge>;
    case "resolved":
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Resolved</Badge>;
    case "snoozed":
      return <Badge variant="outline">Snoozed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

type LucideIconLike = typeof Bug;
const TABS: Array<{ key: TabKey; label: string; icon: LucideIconLike; phase: number }> = [
  { key: "crashes", label: "Crashes & Errors", icon: Bug, phase: 1 },
  { key: "system", label: "System Status", icon: Activity, phase: 2 },
  { key: "companies", label: "Companies", icon: Building2, phase: 2 },
  { key: "users", label: "Users", icon: Users, phase: 3 },
  { key: "sync", label: "Sync & Uploads", icon: Zap, phase: 3 },
  { key: "integrations", label: "Integrations", icon: Plug, phase: 5 },
  { key: "audit", label: "Audit Log", icon: ShieldOff, phase: 2 },
];

export default function SuperAdminAppHealthPage() {
  const role = readUserRole();
  const allowed = role === "super_admin";
  const [activeTab, setActiveTab] = useState<TabKey>("crashes");
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [drawerFingerprint, setDrawerFingerprint] = useState<string | null>(null);
  const [auditActor, setAuditActor] = useState<string | null>(null);

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Super admin access required</h1>
        <p className="text-gray-600">
          You don't have permission to view the App Health dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">App Health</h1>
          <p className="text-sm text-gray-600 mt-1">
            One pane of glass for crashes, system status, sync health, and audit signals
            across every tenant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={windowKey} onValueChange={(v) => setWindowKey(v as WindowKey)}>
            <SelectTrigger className="w-32" data-testid="select-window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled>
            Export
          </Button>
        </div>
      </div>

      {/* Status hero — Task #550 Phase 2. */}
      <StatusHero windowKey={windowKey} />

      {/* Tab nav */}
      <div className="border-b">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                data-testid={`tab-${t.key}`}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors ${
                  isActive
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {t.key !== "crashes" && (
                  <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-400">
                    P{t.phase}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab body */}
      {activeTab === "crashes" ? (
        <CrashesTab
          windowKey={windowKey}
          drawerFingerprint={drawerFingerprint}
          setDrawerFingerprint={setDrawerFingerprint}
        />
      ) : activeTab === "system" ? (
        <OverviewTab
          windowKey={windowKey}
          onOpenCrash={(fp) => {
            setActiveTab("crashes");
            setDrawerFingerprint(fp);
          }}
        />
      ) : activeTab === "companies" ? (
        <CompaniesTab
          windowKey={windowKey}
          onOpenCrash={(fp) => {
            setActiveTab("crashes");
            setDrawerFingerprint(fp);
          }}
        />
      ) : activeTab === "audit" ? (
        <AuditTab windowKey={windowKey} initialActor={auditActor} />
      ) : activeTab === "sync" ? (
        <SyncTab windowKey={windowKey} />
      ) : activeTab === "users" ? (
        <UsersTab
          onOpenCrash={(fp) => { setActiveTab("crashes"); setDrawerFingerprint(fp); }}
          onOpenAudit={(uid) => { setAuditActor(String(uid)); setActiveTab("audit"); }}
        />
      ) : (
        <ComingSoonTab tabKey={activeTab} />
      )}
    </div>
  );
}

function ComingSoonTab({ tabKey }: { tabKey: TabKey }) {
  const meta = TABS.find((t) => t.key === tabKey);
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <Sparkles className="h-6 w-6 text-gray-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-800">
          {meta?.label} — coming in Phase {meta?.phase}
        </h3>
        <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
          This tab is part of the next phase of the App Health rollout. Phase 1 ships the
          working Crashes tab plus the page chrome.
        </p>
      </CardContent>
    </Card>
  );
}

function CrashesTab({
  windowKey,
  drawerFingerprint,
  setDrawerFingerprint,
}: {
  windowKey: WindowKey;
  drawerFingerprint: string | null;
  setDrawerFingerprint: (v: string | null) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusKey>("open");
  const [severity, setSeverity] = useState<string>("all");
  const [version, setVersion] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const params = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("status", status);
    usp.set("window", windowKey);
    if (severity !== "all") usp.set("severity", severity);
    if (version.trim()) usp.set("version", version.trim());
    if (q.trim()) usp.set("q", q.trim());
    if (companyId.trim()) usp.set("company_id", companyId.trim());
    usp.set("limit", "100");
    return usp.toString();
  }, [status, severity, version, q, companyId, windowKey]);

  const queryKey = ["/api/admin/app-health/crashes", params];
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<CrashListResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/admin/app-health/crashes?${params}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const groups = data?.groups ?? [];

  const bulkMutation = useMutation({
    mutationFn: async (payload: { fingerprints: string[]; status: StatusKey }) =>
      apiRequest("/api/admin/app-health/crashes/bulk-status", "POST", payload),
    onSuccess: (_, vars) => {
      toast({
        title: "Updated",
        description: `${vars.fingerprints.length} crash group${
          vars.fingerprints.length === 1 ? "" : "s"
        } marked ${vars.status}.`,
      });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/crashes"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't update",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const allSelectedOnPage =
    groups.length > 0 && groups.every((g) => selected.has(g.fingerprint));
  const toggleAll = () => {
    if (allSelectedOnPage) {
      setSelected(new Set());
    } else {
      setSelected(new Set(groups.map((g) => g.fingerprint)));
    }
  };
  const toggleOne = (fp: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const runBulk = (next: StatusKey) => {
    if (selected.size === 0) return;
    bulkMutation.mutate({ fingerprints: Array.from(selected), status: next });
  };

  return (
    <div className="space-y-4">
      {/* Filter strip */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-md border bg-gray-50 p-1">
            {(["open", "muted", "snoozed", "resolved"] as StatusKey[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                data-testid={`filter-status-${s}`}
                className={`px-3 py-1.5 text-xs font-medium rounded ${
                  status === s
                    ? "bg-white shadow-sm text-gray-900"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-36" data-testid="filter-severity">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severity</SelectItem>
              <SelectItem value="fatal">Fatal</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="App version (build hash)"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-48"
            data-testid="filter-version"
          />
          <Input
            placeholder="Company ID"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-32"
            data-testid="filter-company"
          />
          <Input
            placeholder="Search message / file"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56 flex-1 min-w-[14rem]"
            data-testid="filter-q"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Bulk action strip */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-md border bg-blue-50 border-blue-200">
          <div className="text-sm font-medium text-blue-900">
            {selected.size} selected
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runBulk("muted")}
              disabled={bulkMutation.isPending}
              data-testid="bulk-mute"
            >
              <VolumeX className="h-4 w-4 mr-2" /> Mute
            </Button>
            <Button
              size="sm"
              onClick={() => runBulk("resolved")}
              disabled={bulkMutation.isPending}
              data-testid="bulk-resolve"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" /> Resolve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              <X className="h-4 w-4 mr-2" /> Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-red-600 text-sm">
              Couldn't load crashes
              {error instanceof Error ? `: ${error.message}` : ""}
            </div>
          ) : groups.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              No {status} crash groups in the last {windowKey}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 w-8">
                      <Checkbox
                        checked={allSelectedOnPage}
                        onCheckedChange={() => toggleAll()}
                        data-testid="select-all"
                      />
                    </th>
                    <th className="px-2 py-2 w-2"></th>
                    <th className="px-4 py-2 text-left">Error</th>
                    <th className="px-4 py-2 text-left">Component / Version</th>
                    <th className="px-4 py-2 text-right">Companies</th>
                    <th className="px-4 py-2 text-right">Events</th>
                    <th className="px-4 py-2 text-right">Users</th>
                    <th className="px-4 py-2 text-left">First seen</th>
                    <th className="px-4 py-2 text-left">Last seen</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {groups.map((g) => {
                    const sev = severityClasses(g.severity);
                    const isSelected = selected.has(g.fingerprint);
                    return (
                      <tr
                        key={g.fingerprint}
                        className={`hover:bg-gray-50 ${isSelected ? "bg-blue-50/30" : ""}`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleOne(g.fingerprint)}
                            data-testid={`row-select-${g.fingerprint}`}
                          />
                        </td>
                        <td className="px-0 py-3">
                          <div className={`w-1 h-10 ${sev.bar} rounded`} title={g.severity} />
                        </td>
                        <td
                          className="px-4 py-3 cursor-pointer"
                          onClick={() => setDrawerFingerprint(g.fingerprint)}
                          data-testid={`row-${g.fingerprint}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{g.name}</span>
                            {g.isRegression && (
                              <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-[10px]">
                                REGRESSION
                              </Badge>
                            )}
                          </div>
                          {g.sampleMessage && (
                            <div className="text-xs text-gray-500 mt-0.5 truncate max-w-md">
                              {g.sampleMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <div className="font-mono truncate max-w-[14rem]">
                            {g.component || "—"}
                          </div>
                          <div className="text-gray-400 mt-0.5">
                            {g.appVersion ? shortHash(g.appVersion) : "no version"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{g.companyCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {g.eventCount}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{g.userCount}</td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                          {formatRelative(g.firstSeenAt)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                          {formatRelative(g.lastSeenAt)}
                        </td>
                        <td className="px-4 py-3">{statusBadge(g.status)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CrashDetailDrawer
        fingerprint={drawerFingerprint}
        onClose={() => setDrawerFingerprint(null)}
        onStatusChange={() => {
          setDrawerFingerprint(null);
          qc.invalidateQueries({ queryKey: ["/api/admin/app-health/crashes"] });
        }}
      />
    </div>
  );
}

function CrashDetailDrawer({
  fingerprint,
  onClose,
  onStatusChange,
}: {
  fingerprint: string | null;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const { toast } = useToast();
  const open = !!fingerprint;
  const { data, isLoading, isError } = useQuery<CrashDetailResponse>({
    queryKey: ["/api/admin/app-health/crashes", fingerprint],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/app-health/crashes/${encodeURIComponent(fingerprint!)}`,
        { credentials: "include", headers: buildAuthHeaders() },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: open,
    staleTime: 10_000,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: StatusKey) =>
      apiRequest(
        `/api/admin/app-health/crashes/${encodeURIComponent(fingerprint!)}/status`,
        "POST",
        { status },
      ),
    onSuccess: (_, status) => {
      toast({ title: `Marked ${status}` });
      onStatusChange();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't update",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const group = data?.group;
  const latest = data?.events?.[0];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="crash-drawer"
      >
        <SheetHeader>
          <SheetTitle className="text-base flex items-center gap-2">
            <Bug className="h-4 w-4" />
            Crash detail
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : isError || !group ? (
          <div className="py-12 text-center text-sm text-gray-600">
            Couldn't load detail.
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {group.eventCount === 1 && (
                  <Badge className="bg-blue-600 hover:bg-blue-600 text-[10px]">NEW</Badge>
                )}
                {group.isRegression && (
                  <Badge className="bg-amber-500 hover:bg-amber-500 text-white text-[10px]">
                    REGRESSION
                  </Badge>
                )}
                {group.appVersion && (
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    v {shortHash(group.appVersion)}
                  </Badge>
                )}
                {group.component && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {group.component}
                  </Badge>
                )}
              </div>
              <div className="text-base font-semibold text-gray-900">{group.name}</div>
              {group.sampleMessage && (
                <div className="text-sm text-gray-600 mt-1">{group.sampleMessage}</div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <Stat label="Events" value={group.eventCount} />
              <Stat label="Users" value={group.userCount} />
              <Stat label="First seen" value={formatRelative(group.firstSeenAt)} />
              <Stat label="Last seen" value={formatRelative(group.lastSeenAt)} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => statusMutation.mutate("muted")}
                disabled={statusMutation.isPending}
                data-testid="action-mute"
              >
                <VolumeX className="h-4 w-4 mr-2" /> Mute
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => statusMutation.mutate("snoozed")}
                disabled={statusMutation.isPending}
                data-testid="action-snooze"
              >
                <Volume2 className="h-4 w-4 mr-2" /> Snooze
              </Button>
              <Button
                size="sm"
                onClick={() => statusMutation.mutate("resolved")}
                disabled={statusMutation.isPending}
                data-testid="action-resolve"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Resolve
              </Button>
              {group.status !== "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => statusMutation.mutate("open")}
                  disabled={statusMutation.isPending}
                >
                  Reopen
                </Button>
              )}
            </div>

            {latest?.stack ? (
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                  Stack trace
                </div>
                <pre
                  className="text-[11px] bg-gray-900 text-gray-100 rounded-md p-3 overflow-auto max-h-96 whitespace-pre-wrap break-words font-mono"
                  data-testid="stack-trace"
                >
                  {latest.stack}
                </pre>
              </div>
            ) : null}

            {latest?.componentStack ? (
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                  Component stack
                </div>
                <pre className="text-[11px] bg-gray-100 rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap break-words font-mono">
                  {latest.componentStack}
                </pre>
              </div>
            ) : null}

            {data?.breadcrumbs && Array.isArray(data.breadcrumbs) && data.breadcrumbs.length > 0 ? (
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                  Breadcrumbs
                </div>
                <div className="text-[11px] bg-gray-50 rounded-md border divide-y">
                  {data.breadcrumbs.slice(-15).map((b: Breadcrumb, idx: number) => (
                    <div key={idx} className="px-3 py-1.5 flex items-center gap-2">
                      <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-gray-700">
                        {b?.kind ? `${b.kind}: ` : ""}
                        {b?.url ?? JSON.stringify(b)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {latest && (
              <div className="text-[11px] text-gray-500 grid grid-cols-2 gap-2 border-t pt-3">
                <div>URL: <span className="text-gray-700 break-all">{latest.url ?? "—"}</span></div>
                <div>Session: <span className="font-mono text-gray-700">{latest.sessionId ?? "—"}</span></div>
                <div>User: <span className="text-gray-700">{latest.userId ?? "—"}</span></div>
                <div>Company: <span className="text-gray-700">{latest.companyId ?? "—"}</span></div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-gray-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}

function shortHash(h: string | null | undefined): string {
  if (!h) return "—";
  return h.length > 10 ? `${h.slice(0, 10)}…` : h;
}

function buildAuthHeaders(): Record<string, string> {
  try {
    const raw = safeGet("user");
    if (!raw) return {};
    const u = JSON.parse(raw) as { id?: number; role?: string; companyId?: number; name?: string };
    const headers: Record<string, string> = {};
    if (u?.role) headers["x-user-role"] = u.role;
    if (u?.id != null) headers["x-user-id"] = String(u.id);
    if (u?.companyId != null) headers["x-user-company-id"] = String(u.companyId);
    if (u?.name) headers["x-user-name"] = u.name;
    return headers;
  } catch {
    return {};
  }
}

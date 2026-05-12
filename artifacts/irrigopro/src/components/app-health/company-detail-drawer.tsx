import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2, RefreshCw, Gauge, Rocket, X, Mail, UserCog } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";
import { HealthScoreBar, bucketLabel, type HealthBucket } from "./health-score-bar";
import type { CompanyHealth } from "./companies-tab";
import { beginImpersonation } from "@/lib/impersonation";

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

            <CompanyAdminActions companyId={data.company.id} appVersion={data.company.appVersion ?? null} />

            <CompanyContactActions companyId={data.company.id} companyName={data.company.name} />

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

type ConfirmKind = "throttle-set" | "throttle-clear" | "force-upgrade" | null;

function CompanyAdminActions({ companyId, appVersion }: { companyId: number; appVersion: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rateLimit, setRateLimit] = useState<string>("60");
  const [duration, setDuration] = useState<string>("30");
  const [pinVersion, setPinVersion] = useState<string>(appVersion ?? "");
  const [scope, setScope] = useState<"company" | "global">("company");
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  const throttleQuery = useQuery<{ throttles: Array<{ companyId: number; rateLimit: number; expiresAt: string }> }>({
    queryKey: ["/api/admin/app-health/throttles"],
    queryFn: async () => {
      const res = await fetch("/api/admin/app-health/throttles", {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 15_000,
  });
  const activeThrottle = (throttleQuery.data?.throttles ?? []).find((t) => t.companyId === companyId) ?? null;

  const setThrottle = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/app-health/companies/${companyId}/throttle`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ rateLimit: Number(rateLimit), durationMinutes: Number(duration) }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Throttle applied", description: `${rateLimit} req/min for ${duration}m.` });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/throttles"] });
    },
    onError: (e) => toast({ title: "Couldn't throttle", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  const clearThrottle = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/app-health/companies/${companyId}/throttle`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ clear: true }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Throttle cleared" });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/throttles"] });
    },
    onError: (e) => toast({ title: "Couldn't clear throttle", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  const forceUpgrade = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/app-health/companies/${companyId}/force-upgrade`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ minAppVersion: pinVersion.trim(), scope }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Force-upgrade pinned",
        description: `Clients on older builds will hard-reload within 5 minutes (${scope}).`,
      });
    },
    onError: (e) => toast({ title: "Couldn't force upgrade", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide flex items-center justify-between">
        <span>Admin actions</span>
        {activeThrottle ? (
          <Badge variant="destructive" className="text-[10px]">
            Throttled · {activeThrottle.rateLimit}/min · expires {formatRelative(activeThrottle.expiresAt)}
          </Badge>
        ) : null}
      </div>
      <div className="space-y-3 rounded-md border bg-gray-50 p-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
            <Gauge className="h-4 w-4 text-amber-600" /> Throttle tenant
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`rl-${companyId}`} className="text-[11px] text-gray-600">Requests / minute</Label>
              <Input
                id={`rl-${companyId}`}
                type="number"
                min={1}
                max={100000}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                data-testid="throttle-rate"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor={`dur-${companyId}`} className="text-[11px] text-gray-600">Duration (min)</Label>
              <Input
                id={`dur-${companyId}`}
                type="number"
                min={1}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                data-testid="throttle-duration"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm("throttle-set")}
              disabled={setThrottle.isPending || !rateLimit || !duration}
              data-testid="throttle-apply"
            >
              {setThrottle.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Gauge className="h-3 w-3 mr-2" />}
              Apply throttle
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirm("throttle-clear")}
              disabled={!activeThrottle || clearThrottle.isPending}
              data-testid="throttle-clear"
            >
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800 mb-2">
            <Rocket className="h-4 w-4 text-blue-600" /> Force minimum app version
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              placeholder="Build hash to require"
              value={pinVersion}
              onChange={(e) => setPinVersion(e.target.value)}
              data-testid="force-version"
              className="h-8 text-sm font-mono"
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "company" | "global")}
              data-testid="force-scope"
              className="h-8 text-xs border rounded px-2 bg-white"
            >
              <option value="company">This company</option>
              <option value="global">Global</option>
            </select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setConfirm("force-upgrade")}
            disabled={forceUpgrade.isPending || !pinVersion.trim()}
            data-testid="force-apply"
          >
            {forceUpgrade.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Rocket className="h-3 w-3 mr-2" />}
            Force upgrade
          </Button>
          <div className="text-[10px] text-gray-500 mt-1">
            Clients on older builds will unregister their service worker, clear caches, and reload within ~5 minutes.
          </div>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "throttle-set" && `Throttle this tenant to ${rateLimit} req/min?`}
              {confirm === "throttle-clear" && "Clear the active throttle?"}
              {confirm === "force-upgrade" && `Force ${scope === "global" ? "all tenants" : "this company"} to upgrade?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "throttle-set" && (
                <>Every API request from this tenant beyond the cap will return 429 for the next {duration} minutes. Field techs may temporarily lose write capability. Logged in the audit trail.</>
              )}
              {confirm === "throttle-clear" && (
                <>The tenant will return to unthrottled traffic immediately. Logged in the audit trail.</>
              )}
              {confirm === "force-upgrade" && (
                <>Clients on a different build hash will hard-reload to pick up the deployed bundle within ~5 minutes. Use sparingly — every active session will lose unsaved local state. Logged in the audit trail.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-go"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c === "throttle-set") setThrottle.mutate();
                else if (c === "throttle-clear") clearThrottle.mutate();
                else if (c === "force-upgrade") forceUpgrade.mutate();
              }}
            >
              Yes, continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Task #554 — "Email admin" opens a mailto: composer to the company's
// primary admin (audited server-side). "Open as company admin" mints
// a server-issued impersonation token for that admin and hard-reloads
// into their dashboard.
function CompanyContactActions({ companyId, companyName }: { companyId: number; companyName: string }) {
  const { toast } = useToast();
  const [confirmOpenAs, setConfirmOpenAs] = useState(false);
  const adminsQuery = useQuery<{
    admins: Array<{ id: number; name: string; username: string; email: string | null; role: string }>;
    primary: { id: number; name: string; username: string; email: string | null; role: string } | null;
  }>({
    queryKey: ["/api/admin/app-health/companies", companyId, "admins"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/app-health/companies/${companyId}/admins`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const primary = adminsQuery.data?.primary ?? null;

  const emailAdmin = useMutation({
    mutationFn: async () => {
      if (!primary?.email) throw new Error("This company has no admin email on file");
      const subject = `[IrrigoPro] Re: ${companyName}`;
      // Audit (best-effort) before opening the composer.
      try {
        await fetch(`/api/admin/app-health/companies/${companyId}/email-admin`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
          body: JSON.stringify({ recipientUserId: primary.id, subject }),
        });
      } catch { /* non-blocking */ }
      const href = `mailto:${encodeURIComponent(primary.email)}?subject=${encodeURIComponent(subject)}`;
      window.location.href = href;
      return true;
    },
    onError: (e) => toast({ title: "Couldn't open email", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  const openAsAdmin = useMutation({
    mutationFn: async () => {
      if (!primary) throw new Error("This company has no active admin to open as");
      const res = await fetch(`/api/admin/app-health/impersonate/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...buildAuthHeaders() },
        body: JSON.stringify({ userId: primary.id, reason: `Open as company admin (${companyName})` }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json() as Promise<{
        ok: boolean;
        target: { id: number; username: string; name: string; role: string; email: string | null; companyId: number | null };
        impersonationToken: string;
        expiresAt: string;
      }>;
    },
    onSuccess: (resp) => {
      try {
        if (!resp.impersonationToken) throw new Error("Server did not issue an impersonation token");
        beginImpersonation(
          {
            id: resp.target.id,
            username: resp.target.username,
            name: resp.target.name,
            role: resp.target.role,
            companyId: resp.target.companyId,
            email: resp.target.email,
          },
          resp.impersonationToken,
          resp.expiresAt,
        );
        window.location.href = "/";
      } catch (e) {
        toast({ title: "Couldn't open as admin", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
      }
    },
    onError: (e) => toast({ title: "Couldn't open as admin", description: e instanceof Error ? e.message : "Try again", variant: "destructive" }),
  });

  return (
    <div>
      <div className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Tenant outreach</div>
      <div className="rounded-md border bg-gray-50 p-3 space-y-2">
        <div className="text-xs text-gray-600">
          {adminsQuery.isLoading
            ? "Looking up admin…"
            : primary
            ? <>Primary admin: <span className="font-medium text-gray-900">{primary.name}</span> <span className="text-gray-500">({primary.role.replace(/_/g, " ")}{primary.email ? ` · ${primary.email}` : ""})</span></>
            : <span className="text-amber-700">No active company_admin or manager on file.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!primary?.email || emailAdmin.isPending}
            onClick={() => emailAdmin.mutate()}
            data-testid="company-email-admin"
            title={primary?.email ? `mailto:${primary.email}` : "No admin email on file"}
          >
            {emailAdmin.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <Mail className="h-3 w-3 mr-2" />}
            Email admin
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!primary || openAsAdmin.isPending}
            onClick={() => setConfirmOpenAs(true)}
            data-testid="company-open-as-admin"
          >
            {openAsAdmin.isPending ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <UserCog className="h-3 w-3 mr-2" />}
            Open as company admin
          </Button>
        </div>
        <div className="text-[10px] text-gray-500">
          Both actions are recorded in the audit log. Impersonation expires automatically and can be revoked from the banner.
        </div>
      </div>

      <AlertDialog open={confirmOpenAs} onOpenChange={(v) => !v && setConfirmOpenAs(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Open IrrigoPro as {primary?.name ?? "this admin"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You'll be signed in as <span className="font-medium">{primary?.username ?? "—"}</span>{primary?.role ? ` (${primary.role.replace(/_/g, " ")})` : ""} of <span className="font-medium">{companyName}</span> until you click "Return to super admin" in the impersonation banner. Every action you take will be attributed to that user in their company's data, and bracketed by an audit-log row tying it back to you. Use this only when you genuinely need to reproduce what the customer sees.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="open-as-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="open-as-go"
              onClick={() => {
                setConfirmOpenAs(false);
                openAsAdmin.mutate();
              }}
            >
              Yes, open as this admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

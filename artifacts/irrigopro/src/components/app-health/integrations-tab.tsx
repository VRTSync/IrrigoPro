import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Send,
  Plug,
  Slack,
  Bell,
  RefreshCw,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";

// Task #554 — Phase 5 monitoring dashboard for the integrations we
// depend on (QuickBooks, Twilio, SendGrid, object storage, …) plus
// Task #569 — alert-routing config (PagerDuty / Slack) so a P1/P2
// incident actually pages on-call. Both halves live in the same tab
// so a super admin has a single screen for "is it broken?" and "do
// we get told when it breaks?".

type IntegrationRow = {
  service: string;
  label: string;
  purpose: string;
  runbookUrl: string;
  status: "healthy" | "degraded" | "down";
  ok10m: number;
  fail10m: number;
  ok1h: number;
  fail1h: number;
  ok24h: number;
  fail24h: number;
  successRate24h: number | null;
  p95Ms: number | null;
  lastEventAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
};

type IntegrationsResponse = {
  services: IntegrationRow[];
  statusRule: { ruleId: string; windowMin: number; failThreshold: number; summary: string };
};

type FailureRow = {
  id: number;
  name: string;
  message: string;
  component: string | null;
  statusCode: number | null;
  durationMs: number | null;
  occurredAt: string;
};

function statusBadge(s: IntegrationRow["status"]) {
  if (s === "down") return <Badge variant="destructive" data-testid={`integration-status-${s}`}>Down</Badge>;
  if (s === "degraded") return <Badge data-testid={`integration-status-${s}`} className="bg-amber-500 hover:bg-amber-500 text-white">Degraded</Badge>;
  return <Badge data-testid={`integration-status-${s}`} className="bg-emerald-600 hover:bg-emerald-600">Healthy</Badge>;
}

export function IntegrationsTab() {
  return (
    <div className="space-y-8" data-testid="integrations-tab">
      <MonitoringPanel />
      <ConfigPanel />
    </div>
  );
}

function MonitoringPanel() {
  const [openService, setOpenService] = useState<string | null>(null);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<IntegrationsResponse>({
    queryKey: ["/api/admin/app-health/integrations/health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/app-health/integrations/health", {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const services = data?.services ?? [];
  const rule = data?.statusRule;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Plug className="h-4 w-4" />
            <span>
              External services we depend on. Status rule:{" "}
              <code className="text-[11px] bg-gray-100 px-1 rounded">
                {rule?.summary ?? "loading…"}
              </code>{" "}
              <span className="text-gray-400">
                (matches the <code className="text-[11px]">{rule?.ruleId ?? "integration_down"}</code> active-incident rule).
              </span>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="integrations-reload">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="py-16 flex items-center justify-center text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : isError ? (
        <Card><CardContent className="py-12 text-center text-sm text-red-600">Couldn't load integrations.</CardContent></Card>
      ) : services.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-gray-500">
            No integration telemetry in the last 24 hours.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm" data-testid="integrations-table">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Service</th>
                <th className="text-left px-3 py-2">Purpose</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Success 24h</th>
                <th className="text-right px-3 py-2">p95 (1h)</th>
                <th className="text-left px-3 py-2">Last failure</th>
                <th className="text-right px-3 py-2">Runbook</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {services.map((s) => (
                <tr
                  key={s.service}
                  data-testid={`integration-row-${s.service}`}
                  className="hover:bg-blue-50/30 cursor-pointer"
                  onClick={() => setOpenService(s.service)}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-900">{s.label}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{s.service}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-700 max-w-[260px]">{s.purpose}</td>
                  <td className="px-3 py-2">{statusBadge(s.status)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.successRate24h == null ? <span className="text-gray-400">—</span> : `${s.successRate24h.toFixed(1)}%`}
                    <div className="text-[10px] text-gray-400">{s.ok24h + s.fail24h} events</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.p95Ms == null ? <span className="text-gray-400">—</span> : `${s.p95Ms} ms`}
                  </td>
                  <td className="px-3 py-2 max-w-[280px]">
                    {s.lastFailureAt ? (
                      <>
                        <div className="text-[11px] text-gray-700 truncate" title={s.lastFailureMessage ?? ""}>
                          {s.lastFailureMessage ?? <span className="text-gray-400 italic">no message</span>}
                        </div>
                        <div className="text-[10px] text-gray-500">{formatRelative(s.lastFailureAt)}</div>
                      </>
                    ) : (
                      <span className="text-gray-400 italic text-[11px]">no failures in 24h</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={s.runbookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900"
                      data-testid={`integration-runbook-${s.service}`}
                    >
                      <BookOpen className="h-3 w-3" />
                      Runbook
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecentFailuresDrawer service={openService} onClose={() => setOpenService(null)} />
    </div>
  );
}

function RecentFailuresDrawer({
  service,
  onClose,
}: {
  service: string | null;
  onClose: () => void;
}) {
  const open = service != null;
  const { data, isLoading, isError } = useQuery<{
    service: string;
    label: string;
    purpose: string | null;
    runbookUrl: string;
    failures: FailureRow[];
  }>({
    queryKey: ["/api/admin/app-health/integrations", service, "recent-failures"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/app-health/integrations/${service}/recent-failures`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: open,
    staleTime: 15_000,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="integration-failures-drawer">
        <SheetHeader>
          <SheetTitle className="text-base">
            Recent failures · {data?.label ?? service}
          </SheetTitle>
          {data?.purpose ? (
            <div className="text-[11px] text-gray-500">{data.purpose}</div>
          ) : null}
        </SheetHeader>
        {data?.runbookUrl ? (
          <a
            href={data.runbookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-blue-700 hover:text-blue-900"
            data-testid="integration-drawer-runbook"
          >
            <BookOpen className="h-3 w-3" />
            Open runbook
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        {isLoading ? (
          <div className="py-16 flex items-center justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-red-600">Couldn't load failures.</div>
        ) : (data?.failures ?? []).length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">No failures in the last 24h.</div>
        ) : (
          <ul className="divide-y rounded-md border mt-4">
            {(data?.failures ?? []).map((f) => (
              <li key={f.id} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate" title={f.name}>{f.name}</div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px] text-gray-500 tabular-nums">
                    {f.statusCode != null ? <Badge variant="destructive" className="text-[10px]">{f.statusCode}</Badge> : null}
                    {f.durationMs != null ? <span>{f.durationMs}ms</span> : null}
                  </div>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 break-words">{f.message}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {formatRelative(f.occurredAt)} · {f.component ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Task #569 — On-call paging config (PagerDuty / Slack)
// ---------------------------------------------------------------------------

type Severity = "P1" | "P2" | "P3" | "P4";

type IntegrationsConfig = {
  pagerDutyEnabled: boolean;
  pagerDutyRoutingKeyMasked: string;
  pagerDutyRoutingKeyConfigured: boolean;
  slackEnabled: boolean;
  slackWebhookConfigured: boolean;
  pageSeverities: Severity[];
  updatedAt?: string;
  updatedBy?: string | null;
};

const ALL_SEVERITIES: Severity[] = ["P1", "P2", "P3", "P4"];

function ConfigPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<{ config: IntegrationsConfig }>({
    queryKey: ["/api/admin/app-health/integrations"],
    queryFn: async () => {
      const res = await fetch("/api/admin/app-health/integrations", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const [pdEnabled, setPdEnabled] = useState(false);
  const [pdKey, setPdKey] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState("");
  const [severities, setSeverities] = useState<Severity[]>(["P1", "P2"]);

  useEffect(() => {
    if (data?.config) {
      setPdEnabled(data.config.pagerDutyEnabled);
      setSlackEnabled(data.config.slackEnabled);
      setSeverities(data.config.pageSeverities);
    }
  }, [data?.config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        pagerDutyEnabled: pdEnabled,
        slackEnabled,
        pageSeverities: severities,
      };
      if (pdKey.trim()) body.pagerDutyRoutingKey = pdKey.trim();
      if (slackUrl.trim()) body.slackWebhookUrl = slackUrl.trim();
      return apiRequest("/api/admin/app-health/integrations", "POST", body);
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "On-call paging settings updated." });
      setPdKey("");
      setSlackUrl("");
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/integrations"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't save",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const testMutation = useMutation({
    mutationFn: async () => apiRequest("/api/admin/app-health/integrations/test", "POST", {}),
    onSuccess: (resp) => {
      const sent = (resp as { sentTo?: { pagerDuty?: boolean; slack?: boolean } } | null)?.sentTo;
      const channels = [
        sent?.pagerDuty ? "PagerDuty" : null,
        sent?.slack ? "Slack" : null,
      ].filter(Boolean);
      toast({
        title: channels.length > 0 ? "Test page sent" : "Nothing to send",
        description:
          channels.length > 0
            ? `Delivered to ${channels.join(" + ")}. Check the channel for the synthetic alert.`
            : "Enable PagerDuty or Slack and add a credential first.",
      });
    },
    onError: (e: unknown) =>
      toast({
        title: "Test failed",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  const toggleSeverity = (s: Severity) => {
    setSeverities((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].sort(),
    );
  };

  if (isLoading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="py-12 text-center text-red-600 text-sm">
        Couldn't load integrations
        {error instanceof Error ? `: ${error.message}` : ""}
      </div>
    );
  }

  const cfg = data!.config;

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardContent className="py-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-purple-50 p-2">
              <Bell className="h-5 w-5 text-purple-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">Page on-call when an incident fires</h3>
              <p className="text-sm text-gray-600 mt-1">
                When the rule runner opens a new incident at one of the severities below,
                the configured channels receive a message with the rule, summary, runbook,
                and a deep link back to App Health. Acknowledging an incident here resolves
                the page in PagerDuty as well.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PagerDuty card */}
      <Card>
        <CardContent className="py-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-orange-500" />
              <h4 className="font-semibold">PagerDuty</h4>
              {cfg.pagerDutyRoutingKeyConfigured && (
                <Badge variant="outline" className="text-xs">
                  Key on file: {cfg.pagerDutyRoutingKeyMasked}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="pd-enabled" className="text-sm">
                Enabled
              </Label>
              <Switch
                id="pd-enabled"
                checked={pdEnabled}
                onCheckedChange={setPdEnabled}
                data-testid="switch-pagerduty"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pd-key" className="text-sm">
              Events API v2 integration (routing) key
            </Label>
            <Input
              id="pd-key"
              type="password"
              placeholder={
                cfg.pagerDutyRoutingKeyConfigured
                  ? "Leave blank to keep the existing key"
                  : "32-character routing key from a PagerDuty service"
              }
              value={pdKey}
              onChange={(e) => setPdKey(e.target.value)}
              data-testid="input-pagerduty-key"
            />
            <p className="text-xs text-gray-500">
              Found under <span className="font-mono">Service → Integrations</span> in PagerDuty.
              Required when "Enabled" is on.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Slack card */}
      <Card>
        <CardContent className="py-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Slack className="h-5 w-5 text-pink-600" />
              <h4 className="font-semibold">Slack</h4>
              {cfg.slackWebhookConfigured && (
                <Badge variant="outline" className="text-xs">
                  Webhook on file
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="slack-enabled" className="text-sm">
                Enabled
              </Label>
              <Switch
                id="slack-enabled"
                checked={slackEnabled}
                onCheckedChange={setSlackEnabled}
                data-testid="switch-slack"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slack-url" className="text-sm">
              Incoming webhook URL
            </Label>
            <Input
              id="slack-url"
              type="password"
              placeholder={
                cfg.slackWebhookConfigured
                  ? "Leave blank to keep the existing webhook"
                  : "https://hooks.slack.com/services/…"
              }
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              data-testid="input-slack-url"
            />
            <p className="text-xs text-gray-500">
              Create one at <span className="font-mono">api.slack.com/messaging/webhooks</span>.
              We post a single message per state change (open / ack / resolve).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Severity routing */}
      <Card>
        <CardContent className="py-5 space-y-3">
          <h4 className="font-semibold">Severities that page</h4>
          <p className="text-sm text-gray-600">
            Only incidents at these severities will trigger PagerDuty / Slack. Lower
            severities still appear on the dashboard but won't wake anyone up.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {ALL_SEVERITIES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer hover:bg-gray-50"
              >
                <Checkbox
                  checked={severities.includes(s)}
                  onCheckedChange={() => toggleSeverity(s)}
                  data-testid={`severity-${s}`}
                />
                <span className="text-sm font-medium">{s}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {cfg.updatedAt
            ? `Last updated ${new Date(cfg.updatedAt).toLocaleString()}${
                cfg.updatedBy ? ` by ${cfg.updatedBy}` : ""
              }`
            : "Never configured."}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            data-testid="button-test-page"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send test page
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-integrations"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Plug, Slack, Bell } from "lucide-react";

// Task #569 — App Health > Integrations tab.
// Lets a super admin store the PagerDuty Events API v2 routing key
// and/or a Slack incoming-webhook URL so a P1 / P2 incident actually
// pages on-call. The credential is never returned over the wire — the
// API masks it on GET so a session hijack of this page can't lift it.

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

export function IntegrationsTab() {
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

  // Local form state — initialised from server config; the routing
  // key / webhook URL inputs are blank by default so the user has to
  // re-enter them to change. Submitting blank values keeps the
  // existing credential.
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
      // Only send credentials when the user typed something — submitting
      // an empty string would otherwise overwrite an existing key.
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

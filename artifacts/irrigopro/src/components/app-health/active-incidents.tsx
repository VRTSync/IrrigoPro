import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { AlertTriangle, ExternalLink, ShieldCheck, Loader2 } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";

// Task #553 — Active incident banner. Renders one gradient red card per
// open incident, plus a slim mitigated banner for incidents currently
// in cooldown. Clicking "Acknowledge" assigns the current super admin
// as the owner and flips the row to mitigated.

export type IncidentRow = {
  id: number;
  ruleId: string;
  severity: "P1" | "P2" | "P3" | "P4";
  status: "open" | "mitigated" | "resolved";
  trigger: "auto" | "manual";
  summary: string;
  runbookUrl: string | null;
  ownerUserId: number | null;
  ownerLabel: string | null;
  startedAt: string;
  lastFiringAt: string;
  cleanSinceAt: string | null;
  mitigatedAt: string | null;
  resolvedAt: string | null;
  ackedAt: string | null;
  affectedCompanies: number[] | null;
  affectedUsers: number[] | null;
  details: Record<string, unknown> | null;
  fireCount: number;
};

type IncidentsResponse = { incidents: IncidentRow[] };

const SEV_BG: Record<IncidentRow["severity"], string> = {
  P1: "bg-gradient-to-r from-red-100 to-rose-100 border-red-400",
  P2: "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-400",
  P3: "bg-gradient-to-r from-yellow-50 to-amber-50 border-yellow-300",
  P4: "bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300",
};
const SEV_TEXT: Record<IncidentRow["severity"], string> = {
  P1: "text-red-900",
  P2: "text-amber-900",
  P3: "text-yellow-900",
  P4: "text-blue-900",
};
const SEV_BADGE: Record<IncidentRow["severity"], string> = {
  P1: "bg-red-700 hover:bg-red-700",
  P2: "bg-amber-600 hover:bg-amber-600",
  P3: "bg-yellow-600 hover:bg-yellow-600",
  P4: "bg-blue-600 hover:bg-blue-600",
};

export function useIncidents(statusFilter: string = "open,mitigated") {
  return useQuery<IncidentsResponse>({
    queryKey: ["/api/admin/app-health/incidents", statusFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/app-health/incidents?status=${encodeURIComponent(statusFilter)}`,
        { credentials: "include", headers: buildAuthHeaders() },
      );
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function ActiveIncidents() {
  const qc = useQueryClient();
  const { toast } = useToast();
  // Banner only renders open + cooling-down (mitigated) incidents —
  // resolved rows belong in the Overview feed, not the top banner.
  const { data, isLoading } = useIncidents("open,mitigated");

  const incidents = useMemo(() => data?.incidents ?? [], [data]);
  const open = incidents.filter((i) => i.status === "open");
  const mitigated = incidents.filter((i) => i.status === "mitigated");

  const ackMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/admin/app-health/incidents/${id}/ack`, "POST", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/summary"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't acknowledge",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  if (isLoading) return null;
  if (open.length === 0 && mitigated.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="active-incidents">
      {open.map((inc) => (
        <Card
          key={inc.id}
          className={`border-2 ${SEV_BG[inc.severity]}`}
          data-testid={`incident-banner-${inc.id}`}
        >
          <CardContent className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span className="relative inline-flex h-3 w-3 mt-1.5 shrink-0">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${SEV_BADGE[inc.severity]}`} />
                  <span className={`relative inline-flex h-3 w-3 rounded-full ${SEV_BADGE[inc.severity]}`} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`${SEV_BADGE[inc.severity]} text-white text-[10px]`}>
                      {inc.severity}
                    </Badge>
                    <span className={`font-semibold ${SEV_TEXT[inc.severity]}`}>
                      {inc.summary}
                    </span>
                    <code className="text-[10px] text-gray-600 bg-white/60 px-1.5 py-0.5 rounded">
                      {inc.ruleId}
                    </code>
                  </div>
                  <div className="text-[11px] text-gray-700 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Started {formatRelative(inc.startedAt)}</span>
                    {inc.fireCount > 1 && <span>· {inc.fireCount} ticks</span>}
                    {inc.affectedCompanies && inc.affectedCompanies.length > 0 && (
                      <span>· {inc.affectedCompanies.length} compan{inc.affectedCompanies.length === 1 ? "y" : "ies"}</span>
                    )}
                    {inc.affectedUsers && inc.affectedUsers.length > 0 && (
                      <span>· {inc.affectedUsers.length} user{inc.affectedUsers.length === 1 ? "" : "s"}</span>
                    )}
                    {inc.ownerLabel && <span>· owner {inc.ownerLabel}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {inc.runbookUrl && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="bg-white/70"
                  >
                    <a
                      href={inc.runbookUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      data-testid={`incident-runbook-${inc.id}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Runbook
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => ackMutation.mutate(inc.id)}
                  disabled={ackMutation.isPending}
                  data-testid={`incident-ack-${inc.id}`}
                >
                  {ackMutation.isPending && ackMutation.variables === inc.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Acknowledge
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {mitigated.length > 0 && (
        <Card className="border bg-amber-50/50 border-amber-200">
          <CardContent className="py-2 flex items-center gap-2 text-xs text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>
              {mitigated.length} incident{mitigated.length === 1 ? "" : "s"} cooling
              down — auto-resolves after 30 minutes clean
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function AcknowledgeAllButton() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useIncidents("open,mitigated");
  const openCount = (data?.incidents ?? []).filter((i) => i.status === "open").length;

  const bulkMutation = useMutation({
    mutationFn: () => apiRequest("/api/admin/app-health/incidents/bulk-ack", "POST", { all: true }),
    onSuccess: (resp: unknown) => {
      const acked = (resp as { acked?: number } | null)?.acked ?? 0;
      toast({
        title: "Acknowledged",
        description: `${acked} incident${acked === 1 ? "" : "s"} marked mitigated`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/incidents"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/app-health/summary"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't acknowledge",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      }),
  });

  if (openCount === 0) return null;
  return (
    <Button
      size="sm"
      onClick={() => bulkMutation.mutate()}
      disabled={bulkMutation.isPending}
      data-testid="ack-all-incidents"
    >
      {bulkMutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : (
        <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
      )}
      Acknowledge all ({openCount})
    </Button>
  );
}

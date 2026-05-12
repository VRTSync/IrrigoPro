import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldOff, Search } from "lucide-react";
import { buildAuthHeaders, formatRelative } from "./shared";

type AuditEvent = {
  id: number;
  occurredAt: string;
  actorUserId: number | null;
  actorLabel: string | null;
  actorRole: string | null;
  actorCompanyId: number | null;
  actionType: string;
  action: string;
  severity: "info" | "warning" | "error" | "critical";
  targetType: string | null;
  targetId: string | null;
  summary: string | null;
  details: unknown;
  ip: string | null;
};

type ListResponse = { events: AuditEvent[]; total: number };

const ACTION_TYPES = ["", "auth", "admin", "data", "deploy", "integration", "impersonation", "export", "role_change", "other"];
const SEVERITIES = ["", "info", "warning", "error", "critical"];

export function AuditTab({
  windowKey,
  initialActor,
}: {
  windowKey: string;
  initialActor?: string | null;
}) {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState(initialActor ?? "");
  const [actionType, setActionType] = useState("");
  const [severity, setSeverity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  // Drill-through from the Users drawer pushes a new initialActor;
  // adopt it so the table re-filters in place.
  useEffect(() => {
    if (initialActor != null) {
      setActor(initialActor);
      setPage(0);
    }
  }, [initialActor]);
  const limit = 50;

  const params = useMemo(() => {
    const usp = new URLSearchParams();
    if (q.trim()) usp.set("q", q.trim());
    if (actor.trim()) usp.set("actor", actor.trim());
    if (actionType) usp.set("action_type", actionType);
    if (severity) usp.set("severity", severity);
    if (from) {
      usp.set("from", new Date(from).toISOString());
    } else {
      // No explicit from — derive from the global window selector.
      const ms: Record<string, number> = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        "90d": 90 * 24 * 60 * 60 * 1000,
      };
      if (ms[windowKey]) {
        usp.set("from", new Date(Date.now() - ms[windowKey]).toISOString());
      }
    }
    if (to) usp.set("to", new Date(to).toISOString());
    usp.set("limit", String(limit));
    usp.set("offset", String(page * limit));
    return usp.toString();
  }, [q, actor, actionType, severity, from, to, page, windowKey]);

  const { data, isLoading, isError } = useQuery<ListResponse>({
    queryKey: ["/api/admin/app-health/audit", params],
    queryFn: async () => {
      const res = await fetch(`/api/admin/app-health/audit?${params}`, {
        credentials: "include",
        headers: buildAuthHeaders(),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / limit) - 1);

  const reset = () => {
    setQ(""); setActor(""); setActionType(""); setSeverity("");
    setFrom(""); setTo(""); setPage(0);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search action, summary, actor"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              className="pl-8"
              data-testid="audit-search"
            />
          </div>
          <Input
            placeholder="Actor"
            value={actor}
            onChange={(e) => { setActor(e.target.value); setPage(0); }}
            className="w-40"
            data-testid="audit-actor"
          />
          <Select value={actionType || "all"} onValueChange={(v) => { setActionType(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-40" data-testid="audit-action-type">
              <SelectValue placeholder="Action type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ACTION_TYPES.filter(Boolean).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity || "all"} onValueChange={(v) => { setSeverity(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-36" data-testid="audit-severity">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severity</SelectItem>
              {SEVERITIES.filter(Boolean).map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">From</span>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(0); }}
              className="w-44"
              data-testid="audit-from"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">To</span>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(0); }}
              className="w-44"
              data-testid="audit-to"
            />
          </div>
          <Button variant="outline" size="sm" onClick={reset}>Reset</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-red-600">Couldn't load audit events.</div>
          ) : events.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              <ShieldOff className="h-6 w-6 text-gray-300 mx-auto mb-2" />
              No matching audit events in this window.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">Summary</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b last:border-b-0 hover:bg-gray-50" data-testid={`audit-row-${e.id}`}>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatRelative(e.occurredAt)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{e.actorLabel ?? "—"}</div>
                      <div className="text-[11px] text-gray-500">
                        {e.actorRole ?? "—"}
                        {e.actorCompanyId != null ? ` • co#${e.actorCompanyId}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11px]">{e.action}</div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{e.actionType}</div>
                    </td>
                    <td className="px-3 py-2">
                      <SeverityBadge sev={e.severity} />
                    </td>
                    <td className="px-3 py-2 text-gray-700 max-w-md truncate" title={e.summary ?? ""}>
                      {e.summary ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px] font-mono text-gray-500">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {total > limit && (
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div>
            Page {page + 1} of {lastPage + 1} • {total.toLocaleString()} events
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              Prev
            </Button>
            <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => Math.min(lastPage, p + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  if (sev === "critical") return <Badge variant="destructive">critical</Badge>;
  if (sev === "error") return <Badge variant="destructive">error</Badge>;
  if (sev === "warning") return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">warning</Badge>;
  return <Badge variant="secondary">info</Badge>;
}

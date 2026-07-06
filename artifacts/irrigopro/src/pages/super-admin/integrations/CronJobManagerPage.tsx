// =============================================================================
// Super Admin — Cron Job Manager
// /super-admin/integrations/cron
// =============================================================================

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2,
  Clock, Loader2, Play, RefreshCw, XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn, parseApiError } from "@/lib/queryClient";
import { safeGet } from "@/utils/safeStorage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CronJob {
  id: number;
  companyId: number | null;
  jobType: string;
  triggeredBy: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  recordsProcessed: number | null;
  recordsFailed: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface CronJobsResponse { cronJobs: CronJob[] }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readUserRole(): string | undefined {
  try { return JSON.parse(safeGet("user") || "{}").role; } catch { return undefined; }
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    running: "bg-blue-100 text-blue-700 animate-pulse",
    pending: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Schedule Card — static display of known cron schedules
// ---------------------------------------------------------------------------
const KNOWN_SCHEDULES = [
  {
    jobType: "full_sync",
    schedule: "0 */6 * * *",
    description: "Full Aspire→IrrigoPro sync for all connected tenants",
    icon: RefreshCw,
  },
  {
    jobType: "health_check",
    schedule: "*/15 * * * *",
    description: "Connection health ping for all Aspire tenants",
    icon: CheckCircle2,
  },
];

function ScheduleCard({
  job,
  onTrigger,
  isTriggerPending,
}: {
  job: typeof KNOWN_SCHEDULES[0];
  onTrigger: (jobType: string, companyId: number | null) => void;
  isTriggerPending: boolean;
}) {
  const [companyId, setCompanyId] = useState("");
  const Icon = job.icon;

  return (
    <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50">
        <Icon className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-medium text-sm text-gray-900">{job.jobType}</span>
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-600">
            {job.schedule}
          </code>
        </div>
        <p className="text-xs text-gray-500">{job.description}</p>
        <div className="mt-3 flex items-center gap-2">
          <Input
            placeholder="Company ID (blank = all)"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="h-8 w-44 text-xs"
            id={`cron-company-${job.jobType}`}
          />
          <Button
            id={`cron-run-${job.jobType}`}
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={isTriggerPending}
            onClick={() => {
              const parsed = companyId.trim() ? parseInt(companyId.trim(), 10) : null;
              onTrigger(job.jobType, parsed && Number.isFinite(parsed) ? parsed : null);
            }}
          >
            {isTriggerPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run Now
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function CronJobManagerPage() {
  const role = readUserRole();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<CronJobsResponse>({
    queryKey: ["/api/super-admin/integrations/cron-jobs"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const triggerMutation = useMutation({
    mutationFn: ({ jobType, companyId }: { jobType: string; companyId: number | null }) =>
      apiRequest("/api/super-admin/integrations/cron-jobs/trigger", "POST", { jobType, companyId }),
    onSuccess: (_, vars) => {
      const target = vars.companyId != null ? `company #${vars.companyId}` : "all tenants";
      toast({
        title: "Job triggered",
        description: `${vars.jobType} queued for ${target}. See run history below.`,
      });
      setTimeout(() => refetch(), 2000);
    },
    onError: (err) =>
      toast({ title: "Error", description: parseApiError(err, "Failed to trigger job"), variant: "destructive" }),
  });

  const allJobs = data?.cronJobs ?? [];

  const filtered = allJobs.filter((j) => {
    if (typeFilter !== "all" && j.jobType !== typeFilter) return false;
    if (companyFilter.trim()) {
      const id = parseInt(companyFilter.trim(), 10);
      if (!Number.isFinite(id)) return true;
      if (j.companyId !== id) return false;
    }
    return true;
  });

  if (role !== "super_admin") {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Super admin access required</h1>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate("/super-admin/integrations")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> All Integrations
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Clock className="h-6 w-6 text-blue-600" />
              Cron Job Manager
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Read-only schedule display, run history across all tenants, and manual triggers.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Schedule Display */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {KNOWN_SCHEDULES.map((job) => (
            <ScheduleCard
              key={job.jobType}
              job={job}
              onTrigger={(jobType, companyId) => triggerMutation.mutate({ jobType, companyId })}
              isTriggerPending={triggerMutation.isPending}
            />
          ))}
        </CardContent>
      </Card>

      {/* Run History */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Run History (all tenants)</CardTitle>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Company ID"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="h-8 w-36 text-xs"
                data-testid="filter-company"
              />
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-36 text-xs" data-testid="filter-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="full_sync">full_sync</SelectItem>
                  <SelectItem value="health_check">health_check</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-sm text-red-600">Failed to load run history.</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              <Clock className="mx-auto h-8 w-8 text-gray-200 mb-2" />
              No runs match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="cron-history-table">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Job Type</th>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Triggered By</th>
                    <th className="px-4 py-3 text-right">Processed</th>
                    <th className="px-4 py-3 text-right">Failed</th>
                    <th className="px-4 py-3 text-left">Started</th>
                    <th className="px-4 py-3 text-left">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50" data-testid={`cron-row-${job.id}`}>
                      <td className="px-4 py-3 font-mono text-gray-800">{job.jobType}</td>
                      <td className="px-4 py-3">
                        {job.companyId != null ? (
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            <Building2 className="h-3 w-3" /> #{job.companyId}
                          </span>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">All tenants</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={job.status} /></td>
                      <td className="px-4 py-3 text-gray-500">{job.triggeredBy}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{job.recordsProcessed ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {job.recordsFailed
                          ? <span className="text-red-600 font-medium">{job.recordsFailed}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(job.startedAt)}</td>
                      <td className="px-4 py-3 text-gray-500">{duration(job.startedAt, job.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400 text-right">
        Showing {filtered.length} of {allJobs.length} runs
      </p>
    </div>
  );
}

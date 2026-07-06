// =============================================================================
// Super Admin — Global Conflicts View
// /super-admin/integrations/conflicts
// =============================================================================
//
// Mirror of the Manager Workspace queue UI pattern: aggregated list,
// sortable by age, filterable by company.

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, Clock,
  Loader2, RefreshCw, Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
interface Conflict {
  id: number;
  companyId: number;
  aspireEntity: string;
  aspireJobId: number | null;
  fieldName: string;
  aspireValue: string | null;
  irrigoValue: string | null;
  status: string;
  detectedAt: string;
  resolvedBy: number | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

interface ConflictsResponse {
  conflicts: Conflict[];
  filter: { companyId: number | null; status: string };
}

type SortKey = "detectedAt" | "companyId" | "aspireEntity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readUserRole(): string | undefined {
  try { return JSON.parse(safeGet("user") || "{}").role; } catch { return undefined; }
}

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const QUICK_RESOLUTIONS_GLOBAL = [
  { value: "use_aspire", label: "Use Aspire" },
  { value: "use_irrigo", label: "Use IrrigoPro" },
  { value: "dismissed", label: "Dismiss" },
] as const;

// ---------------------------------------------------------------------------
// Conflict Row
// ---------------------------------------------------------------------------
function ConflictRow({ conflict, onResolved }: { conflict: Conflict; onResolved: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState(conflict.irrigoValue ?? "");

  const resolveMutation = useMutation({
    mutationFn: ({ resolution, manualValue }: { resolution: string; manualValue?: string }) =>
      apiRequest(
        `/api/super-admin/integrations/conflicts/${conflict.id}/resolve`,
        "POST",
        {
          resolution,
          resolutionNote: note.trim() || undefined,
          manualValue: manualValue ?? undefined,
        },
      ),
    onSuccess: (_, vars) => {
      toast({ title: "Conflict resolved", description: vars.resolution === "dismissed" ? "Conflict dismissed." : "Live record updated." });
      onResolved();
    },
    onError: (err) => {
      const msg = parseApiError(err, "Failed to resolve");
      const isValidationError = msg.toLowerCase().includes("not a valid irrigopro estimate lifecycle status");
      toast({
        title: isValidationError ? "Invalid lifecycle status" : "Error",
        description: isValidationError
          ? `${msg}. Valid values: draft, pending_review, sent, approved, rejected.`
          : msg,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-mono font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
              <Building2 className="h-3 w-3" /> Co #{conflict.companyId}
            </span>
            <Badge variant="secondary" className="text-xs font-mono">{conflict.aspireEntity}</Badge>
            <span className="text-xs font-medium text-gray-800">{conflict.fieldName}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Detected {new Date(conflict.detectedAt).toLocaleString()} · {age(conflict.detectedAt)} ago
            {conflict.aspireJobId != null && ` · Job #${conflict.aspireJobId}`}
          </p>
        </div>
        <span className="shrink-0">
          <Clock className="h-4 w-4 text-amber-400" title={`${age(conflict.detectedAt)} old`} />
        </span>
      </div>

      {/* Side-by-side values */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs font-medium text-emerald-700 mb-0.5">Aspire value</p>
          <p className="text-sm text-gray-800 break-all">{conflict.aspireValue ?? <em className="text-gray-400">empty</em>}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-xs font-medium text-blue-700 mb-0.5">IrrigoPro value</p>
          <p className="text-sm text-gray-800 break-all">{conflict.irrigoValue ?? <em className="text-gray-400">empty</em>}</p>
        </div>
      </div>

      {/* Resolution actions */}
      <div className="space-y-2">
        <Input
          placeholder="Resolution note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 text-xs"
          id={`conflict-note-${conflict.id}`}
        />
        <div className="flex flex-wrap gap-2">
          {QUICK_RESOLUTIONS_GLOBAL.map((opt) => (
            <button
              key={opt.value}
              id={`resolve-${conflict.id}-${opt.value}`}
              type="button"
              onClick={() => resolveMutation.mutate({ resolution: opt.value })}
              disabled={resolveMutation.isPending}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {resolveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {opt.label}
            </button>
          ))}
          <button
            id={`resolve-${conflict.id}-manual_edit`}
            type="button"
            onClick={() => setShowManual((v) => !v)}
            disabled={resolveMutation.isPending}
            className="flex items-center gap-1 rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
          >
            Edit Manually
          </button>
        </div>

        {showManual && (
          <div className="flex items-center gap-2 mt-1">
            <input
              id={`manual-value-${conflict.id}`}
              type="text"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="Enter corrected value"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button
              id={`manual-submit-${conflict.id}`}
              type="button"
              disabled={!manualValue.trim() || resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ resolution: "manual_edit", manualValue: manualValue.trim() })}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowManual(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function GlobalConflictsPage() {
  const role = readUserRole();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [entityFilter, setEntityFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("detectedAt");

  const params = new URLSearchParams();
  if (companyFilter.trim()) params.set("companyId", companyFilter.trim());
  params.set("status", statusFilter);
  params.set("limit", "100");

  const queryKey = [`/api/super-admin/integrations/conflicts`, params.toString()];

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ConflictsResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/integrations/conflicts?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const conflicts = data?.conflicts ?? [];

  const filtered = useMemo(() => {
    let rows = conflicts;
    if (entityFilter !== "all") rows = rows.filter((c) => c.aspireEntity === entityFilter);
    return [...rows].sort((a, b) => {
      if (sortKey === "companyId") return a.companyId - b.companyId;
      if (sortKey === "aspireEntity") return a.aspireEntity.localeCompare(b.aspireEntity);
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });
  }, [conflicts, entityFilter, sortKey]);

  const entities = Array.from(new Set(conflicts.map((c) => c.aspireEntity))).sort();

  if (role !== "super_admin") {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Super admin access required</h1>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-6 space-y-6">
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
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              Sync Conflicts
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Cross-tenant conflict queue — all tenants, filterable by company.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="btn-refresh">
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="relative w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Company ID"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="pl-9"
              data-testid="filter-company"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40" data-testid="filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="resolved_use_aspire">Resolved (Aspire)</SelectItem>
              <SelectItem value="resolved_use_irrigo">Resolved (IrrigoPro)</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-44" data-testid="filter-entity">
              <SelectValue placeholder="All entities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="w-44" data-testid="filter-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="detectedAt">Sort: Age (newest)</SelectItem>
              <SelectItem value="companyId">Sort: Company ID</SelectItem>
              <SelectItem value="aspireEntity">Sort: Entity</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Count badge */}
      {!isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium">{filtered.length}</span> conflict{filtered.length !== 1 ? "s" : ""}
          {statusFilter === "pending" && filtered.length > 0 && (
            <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
              Action needed
            </Badge>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : isError ? (
        <div className="py-12 text-center text-red-600 text-sm">Failed to load conflicts.</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mb-3" />
          <p className="text-sm text-gray-500">
            {statusFilter === "pending"
              ? "No pending conflicts — all synced data is in agreement."
              : "No conflicts match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ConflictRow
              key={c.id}
              conflict={c}
              onResolved={() =>
                qc.invalidateQueries({ queryKey: ["/api/super-admin/integrations/conflicts"] })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Super Admin — Integrations Overview
// /super-admin/integrations
// =============================================================================
//
// Sortable/filterable table: all tenants, integration type, connection
// status, last sync, error count. Links drill into AspireTenantDetailPage.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getQueryFn } from "@/lib/queryClient";
import { safeGet } from "@/utils/safeStorage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Integration {
  id: number;
  companyId: number;
  integrationType: string;
  connectionStatus: string;
  connectedAt: string | null;
  lastHealthCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AspireCredentials {
  companyId: number;
  connectionStatus: string;
  syncEnabled: boolean;
  throttleUntil: string | null;
  errorMessage: string | null;
  updatedAt: string;
  clientIdSet: boolean;
  clientSecretSet: boolean;
  accessTokenSet: boolean;
}

interface OverviewResponse {
  integrations: Integration[];
}

interface AspireListResponse {
  companies: AspireCredentials[];
}

type SortField = "companyId" | "connectionStatus" | "updatedAt";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function ConnectionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <CheckCircle2 className="h-3 w-3" />
          Connected
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
          <XCircle className="h-3 w-3" />
          Error
        </span>
      );
    case "reconnect_required":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
          <AlertTriangle className="h-3 w-3" />
          Reconnect
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/20">
          <Clock className="h-3 w-3" />
          Disconnected
        </span>
      );
  }
}

function SortButton({
  field,
  sort,
  onSort,
}: {
  field: SortField;
  sort: { field: SortField; dir: SortDir };
  onSort: (f: SortField) => void;
}) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1 ${active ? "text-blue-700 font-semibold" : "text-gray-500"}`}
    >
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function IntegrationsOverviewPage() {
  const role = readUserRole();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "updatedAt",
    dir: "desc",
  });

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<OverviewResponse>({
      queryKey: ["/api/super-admin/integrations"],
      queryFn: getQueryFn({ on401: "returnNull" }),
      staleTime: 20_000,
      refetchInterval: 30_000,
    });

  const { data: aspireData } = useQuery<AspireListResponse>({
    queryKey: ["/api/super-admin/integrations/aspire"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 20_000,
  });

  // Build an error-count map from Aspire credentials (error status = 1)
  const aspireErrorMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of aspireData?.companies ?? []) {
      m.set(c.companyId, c.connectionStatus === "error" ? 1 : 0);
    }
    return m;
  }, [aspireData]);

  const integrations = data?.integrations ?? [];

  const filtered = useMemo(() => {
    let rows = integrations;
    if (q.trim()) {
      const lq = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          String(r.companyId).includes(lq) ||
          r.integrationType.toLowerCase().includes(lq),
      );
    }
    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.connectionStatus === statusFilter);
    }
    if (typeFilter !== "all") {
      rows = rows.filter((r) => r.integrationType === typeFilter);
    }
    return [...rows].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sort.field) {
        case "companyId":
          av = a.companyId;
          bv = b.companyId;
          break;
        case "connectionStatus":
          av = a.connectionStatus;
          bv = b.connectionStatus;
          break;
        case "updatedAt":
        default:
          av = a.updatedAt ?? "";
          bv = b.updatedAt ?? "";
          break;
      }
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [integrations, q, statusFilter, typeFilter, sort]);

  const toggleSort = (field: SortField) => {
    setSort((s) =>
      s.field === field
        ? { field, dir: s.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" },
    );
  };

  if (role !== "super_admin") {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Super admin access required</h1>
        <p className="text-gray-600">
          You don't have permission to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Plug className="h-6 w-6 text-blue-600" />
            Integrations
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            All tenants with active or pending integrations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/super-admin/integrations/cron")}
            data-testid="nav-cron"
          >
            Cron Manager
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/super-admin/integrations/conflicts")}
            data-testid="nav-conflicts"
          >
            All Conflicts
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by company ID or type…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
              data-testid="filter-q"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="filter-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="connected">Connected</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="reconnect_required">Reconnect Required</SelectItem>
              <SelectItem value="disconnected">Disconnected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40" data-testid="filter-type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="aspire">Aspire</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-red-600 text-sm">
              Failed to load integrations. Check your connection and try again.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-500 text-sm">
              <Building2 className="mx-auto h-8 w-8 text-gray-300 mb-3" />
              No integrations match your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <span className="flex items-center gap-1">
                        Company ID
                        <SortButton field="companyId" sort={sort} onSort={toggleSort} />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">
                      <span className="flex items-center gap-1">
                        Status
                        <SortButton
                          field="connectionStatus"
                          sort={sort}
                          onSort={toggleSort}
                        />
                      </span>
                    </th>
                    <th className="px-4 py-3 text-left">Last Health Check</th>
                    <th className="px-4 py-3 text-right">Errors</th>
                    <th className="px-4 py-3 text-left">
                      <span className="flex items-center gap-1">
                        Last Updated
                        <SortButton field="updatedAt" sort={sort} onSort={toggleSort} />
                      </span>
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((row) => {
                    const errorCount = aspireErrorMap.get(row.companyId) ?? 0;
                    return (
                      <tr
                        key={row.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() =>
                          row.integrationType === "aspire" &&
                          navigate(
                            `/super-admin/integrations/aspire/${row.companyId}`,
                          )
                        }
                        data-testid={`row-company-${row.companyId}`}
                      >
                        <td className="px-4 py-3 font-mono font-medium text-gray-900">
                          #{row.companyId}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="font-mono text-xs capitalize">
                            {row.integrationType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <ConnectionStatusBadge status={row.connectionStatus} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {formatRelative(row.lastHealthCheckAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {errorCount > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              {errorCount}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {formatRelative(row.updatedAt)}
                        </td>
                        <td className="px-4 py-3">
                          {row.integrationType === "aspire" && (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400 text-right">
        {filtered.length} of {integrations.length} tenant integration
        {integrations.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// =============================================================================
// Super Admin — Aspire Tenant Detail
// /super-admin/integrations/aspire/:companyId
// =============================================================================

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Loader2, Plus, RefreshCw, Save, Trash2, XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn, parseApiError } from "@/lib/queryClient";
import { safeGet } from "@/utils/safeStorage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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
  accessTokenExpiresAt: string | null;
}

interface DetailResponse {
  credentials: AspireCredentials | null;
  integration: { connectionStatus: string; connectedAt: string | null } | null;
}

interface SyncLog {
  id: number;
  jobType: string;
  triggeredBy: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  recordsProcessed: number | null;
  recordsFailed: number | null;
  errorMessage: string | null;
  logData: unknown;
  createdAt: string;
}

interface FieldMapping {
  id: number;
  aspireEntity: string;
  aspireField: string;
  irrigoField: string;
  transformFn: string | null;
  isActive: boolean;
}

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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: typeof CheckCircle2; label: string }> = {
    connected: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", icon: CheckCircle2, label: "Connected" },
    error: { cls: "bg-red-50 text-red-700 ring-red-600/20", icon: XCircle, label: "Error" },
    reconnect_required: { cls: "bg-amber-50 text-amber-700 ring-amber-600/20", icon: AlertTriangle, label: "Reconnect Required" },
  };
  const cfg = map[status] ?? { cls: "bg-gray-50 text-gray-600 ring-gray-500/20", icon: Clock, label: "Disconnected" };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.cls}`}>
      <Icon className="h-3 w-3" />{cfg.label}
    </span>
  );
}

function SyncStatusPill({ status }: { status: string }) {
  const cls = status === "completed" ? "bg-emerald-100 text-emerald-700"
    : status === "failed" ? "bg-red-100 text-red-700"
    : status === "running" ? "bg-blue-100 text-blue-700"
    : "bg-gray-100 text-gray-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

// ---------------------------------------------------------------------------
// Credentials Override (write-only)
// ---------------------------------------------------------------------------
function CredentialsOverride({ companyId }: { companyId: number }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/super-admin/integrations/aspire/${companyId}/credentials`, "PUT", {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      }),
    onSuccess: () => {
      toast({ title: "Credentials updated", description: "New credentials saved. Run a connection test to verify." });
      setClientId("");
      setClientSecret("");
      qc.invalidateQueries({ queryKey: [`/api/super-admin/integrations/aspire/${companyId}`] });
    },
    onError: (err) =>
      toast({ title: "Save failed", description: parseApiError(err, "Failed to save credentials"), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Credentials are write-only — current values are never shown. Leave fields blank to skip update.
      </p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">New Client ID</label>
        <Input
          id="sa-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Enter new Client ID"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">New Client Secret</label>
        <Input
          id="sa-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="Enter new Client Secret"
          autoComplete="off"
        />
      </div>
      <Button
        id="sa-save-creds"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!clientId.trim() || !clientSecret.trim() || mutation.isPending}
      >
        {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save Credentials
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field Mapping Sandbox
// ---------------------------------------------------------------------------
function FieldMappingSandbox({ companyId }: { companyId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ fieldMappings: FieldMapping[] }>({
    queryKey: [`/api/super-admin/integrations/aspire/${companyId}/field-mappings`],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const [mappings, setMappings] = useState<FieldMapping[] | null>(null);
  const rows: FieldMapping[] = mappings ?? data?.fieldMappings ?? [];

  const saveMutation = useMutation({
    mutationFn: (m: FieldMapping[]) =>
      apiRequest(`/api/super-admin/integrations/aspire/${companyId}/field-mappings`, "PUT", { mappings: m }),
    onSuccess: () => {
      toast({ title: "Field mappings saved" });
      qc.invalidateQueries({ queryKey: [`/api/super-admin/integrations/aspire/${companyId}/field-mappings`] });
      setMappings(null);
    },
    onError: (err) =>
      toast({ title: "Save failed", description: parseApiError(err, "Failed to save mappings"), variant: "destructive" }),
  });

  const update = (idx: number, patch: Partial<FieldMapping>) => {
    const next = [...rows];
    next[idx] = { ...next[idx], ...patch };
    setMappings(next);
  };

  const remove = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    setMappings(next);
  };

  const addRow = () => {
    setMappings([...rows, { id: Date.now(), aspireEntity: "", aspireField: "", irrigoField: "", transformFn: null, isActive: true }]);
  };

  if (isLoading) return <div className="text-sm text-gray-400 py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              {["Aspire Entity", "Aspire Field", "IrrigoPro Field", "Transform Fn", "Active", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">No mappings yet. Add one below.</td></tr>
            )}
            {rows.map((m, i) => (
              <tr key={m.id}>
                <td className="px-2 py-1.5">
                  <Input value={m.aspireEntity} onChange={(e) => update(i, { aspireEntity: e.target.value })} className="h-7 text-xs" placeholder="e.g. Opportunity" />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={m.aspireField} onChange={(e) => update(i, { aspireField: e.target.value })} className="h-7 text-xs" placeholder="e.g. totalPrice" />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={m.irrigoField} onChange={(e) => update(i, { irrigoField: e.target.value })} className="h-7 text-xs" placeholder="e.g. totalAmount" />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={m.transformFn ?? ""} onChange={(e) => update(i, { transformFn: e.target.value || null })} className="h-7 text-xs font-mono" placeholder="optional" />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" checked={m.isActive} onChange={(e) => update(i, { isActive: e.target.checked })} className="h-3.5 w-3.5" />
                </td>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4 mr-1" /> Add Row
        </Button>
        <Button
          id="sa-save-mappings"
          size="sm"
          onClick={() => saveMutation.mutate(rows)}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          <Save className="h-4 w-4 mr-1" /> Save Mappings
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync Job History
// ---------------------------------------------------------------------------
function SyncJobHistory({ companyId }: { companyId: number }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ syncLogs: SyncLog[] }>({
    queryKey: [`/api/super-admin/integrations/aspire/${companyId}/sync-logs`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  const logs = data?.syncLogs ?? [];

  if (isLoading) return <div className="py-6 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin inline" /></div>;
  if (!logs.length) return <div className="py-6 text-center text-sm text-gray-400">No sync runs yet.</div>;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {["Type", "Status", "Triggered by", "Processed", "Failed", "Started", ""].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {logs.map((log) => (
            <>
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-gray-700">{log.jobType}</td>
                <td className="px-3 py-2"><SyncStatusPill status={log.status} /></td>
                <td className="px-3 py-2 text-gray-500">{log.triggeredBy}</td>
                <td className="px-3 py-2 text-gray-700">{log.recordsProcessed ?? "—"}</td>
                <td className="px-3 py-2">
                  {log.recordsFailed ? <span className="text-red-600 font-medium">{log.recordsFailed}</span> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{log.startedAt ? new Date(log.startedAt).toLocaleString() : "—"}</td>
                <td className="px-3 py-2">
                  {log.logData && (
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                      className="text-blue-600 hover:underline"
                    >
                      {expanded === log.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  )}
                </td>
              </tr>
              {expanded === log.id && log.logData && (
                <tr key={`${log.id}-expand`}>
                  <td colSpan={7} className="px-3 py-2 bg-gray-50">
                    <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-gray-700 max-h-48 overflow-y-auto">
                      {JSON.stringify(log.logData, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Throttle Controls
// ---------------------------------------------------------------------------
function ThrottleControls({ companyId, throttleUntil }: { companyId: number; throttleUntil: string | null }) {
  const [value, setValue] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (throttleUntil: string | null) =>
      apiRequest(`/api/super-admin/integrations/aspire/${companyId}/throttle`, "POST", { throttleUntil }),
    onSuccess: () => {
      toast({ title: "Throttle updated" });
      qc.invalidateQueries({ queryKey: [`/api/super-admin/integrations/aspire/${companyId}`] });
      setValue("");
    },
    onError: (err) =>
      toast({ title: "Error", description: parseApiError(err, "Failed to set throttle"), variant: "destructive" }),
  });

  const isThrottled = throttleUntil ? new Date(throttleUntil) > new Date() : false;

  return (
    <div className="space-y-3">
      {isThrottled && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Throttled until {fmt(throttleUntil)}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1"
          id="sa-throttle-until"
        />
        <Button
          size="sm"
          onClick={() => mutation.mutate(value ? new Date(value).toISOString() : null)}
          disabled={mutation.isPending}
        >
          Set Throttle
        </Button>
        {isThrottled && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutation.mutate(null)}
            disabled={mutation.isPending}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function AspireTenantDetailPage() {
  const role = readUserRole();
  const [, navigate] = useLocation();
  const params = useParams<{ companyId: string }>();
  const companyId = parseInt(params.companyId ?? "", 10);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showCreds, setShowCreds] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [showThrottle, setShowThrottle] = useState(false);

  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: [`/api/super-admin/integrations/aspire/${companyId}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: Number.isFinite(companyId) && companyId > 0,
    staleTime: 20_000,
  });

  const testMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/super-admin/integrations/aspire/${companyId}/test`, "POST"),
    onSuccess: (result) =>
      toast({
        title: result.success ? "Connection OK" : "Connection failed",
        description: result.errorMessage ?? (result.success ? "Aspire responded successfully." : "Check credentials."),
        variant: result.success ? "default" : "destructive",
      }),
    onError: (err) =>
      toast({ title: "Test error", description: parseApiError(err, "Connection test failed"), variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/super-admin/integrations/aspire/${companyId}/sync`, "POST"),
    onSuccess: () => {
      toast({ title: "Sync triggered", description: "Full sync queued. See history below." });
      setTimeout(() =>
        qc.invalidateQueries({ queryKey: [`/api/super-admin/integrations/aspire/${companyId}/sync-logs`] }),
      2000);
    },
    onError: (err) =>
      toast({ title: "Error", description: parseApiError(err, "Failed to trigger sync"), variant: "destructive" }),
  });

  if (role !== "super_admin") {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500 mb-3" />
        <h1 className="text-xl font-semibold mb-2">Super admin access required</h1>
      </div>
    );
  }

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <div className="py-12 text-center text-red-600 text-sm">Invalid company ID.</div>;
  }

  const creds = data?.credentials;
  const connectionStatus = creds?.connectionStatus ?? "disconnected";

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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">
              Aspire — Company #{companyId}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Tenant-level Aspire CRM integration management.
            </p>
          </div>
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : (
            <StatusBadge status={connectionStatus} />
          )}
        </div>
      </div>

      {isError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Failed to load integration detail.
        </div>
      )}

      {/* Connection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connection Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {creds ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <Stat label="Client ID" value={creds.clientIdSet ? "••••••••" : "Not set"} />
              <Stat label="Client Secret" value={creds.clientSecretSet ? "••••••••" : "Not set"} />
              <Stat label="Access Token" value={creds.accessTokenSet ? "••••••••" : "Not set"} />
              <Stat label="Token Expires" value={fmt(creds.accessTokenExpiresAt)} />
              <Stat label="Sync Enabled" value={creds.syncEnabled ? "Yes" : "No"} />
              <Stat label="Throttled Until" value={creds.throttleUntil ? fmt(creds.throttleUntil) : "—"} />
              {creds.errorMessage && (
                <div className="col-span-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  Error: {creds.errorMessage}
                </div>
              )}
            </div>
          ) : (
            !isLoading && (
              <p className="text-sm text-gray-500">No Aspire credentials configured for this tenant.</p>
            )
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              id="sa-test-connection"
              variant="outline"
              size="sm"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Test Connection
            </Button>
            <Button
              id="sa-trigger-sync"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Manual Sync
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Credentials Override */}
      <Collapsible
        title="Credentials Override (Write-only)"
        open={showCreds}
        onToggle={() => setShowCreds((v) => !v)}
        id="sa-toggle-creds"
      >
        <CredentialsOverride companyId={companyId} />
      </Collapsible>

      {/* Field Mapping Sandbox */}
      <Collapsible
        title="Field Mapping Sandbox"
        open={showMappings}
        onToggle={() => setShowMappings((v) => !v)}
        id="sa-toggle-mappings"
      >
        <FieldMappingSandbox companyId={companyId} />
      </Collapsible>

      {/* Sync History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync Job History</CardTitle>
        </CardHeader>
        <CardContent>
          <SyncJobHistory companyId={companyId} />
        </CardContent>
      </Card>

      {/* Throttle Controls */}
      <Collapsible
        title="Throttle Controls"
        open={showThrottle}
        onToggle={() => setShowThrottle((v) => !v)}
        id="sa-toggle-throttle"
      >
        <ThrottleControls companyId={companyId} throttleUntil={creds?.throttleUntil ?? null} />
      </Collapsible>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm text-gray-900">{value}</p>
    </div>
  );
}

function Collapsible({
  title,
  open,
  onToggle,
  children,
  id,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <Card>
      <button
        id={id}
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-4 text-sm font-semibold text-gray-800"
      >
        <span>{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <CardContent className="border-t border-gray-100">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

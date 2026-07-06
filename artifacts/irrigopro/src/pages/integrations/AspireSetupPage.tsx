import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest, parseApiError } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  CheckCircle2, XCircle, AlertCircle, Clock, ArrowLeft,
  RefreshCw, Unplug, Eye, EyeOff, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AspireDetail {
  credentials: {
    companyId: number;
    connectionStatus: "disconnected" | "connected" | "error" | "reconnect_required";
    syncEnabled: boolean;
    lastHealthCheckAt?: string | null;
    accessTokenExpiresAt?: string | null;
    clientIdSet?: boolean;
    clientSecretSet?: boolean;
  } | null;
  integration: {
    connectionStatus: string;
    connectedAt?: string | null;
    lastHealthCheckAt?: string | null;
  } | null;
}

interface SyncLog {
  id: number;
  jobType: string;
  triggeredBy: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  recordsProcessed?: number | null;
  recordsFailed?: number | null;
  errorMessage?: string | null;
  createdAt: string;
}

interface Conflict {
  id: number;
  aspireEntity: string;
  fieldName: string;
  aspireValue?: string | null;
  irrigoValue?: string | null;
  status: string;
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
    connected: { icon: CheckCircle2, cls: "bg-green-50 text-green-700 ring-green-600/20", label: "Connected" },
    error: { icon: XCircle, cls: "bg-red-50 text-red-700 ring-red-600/20", label: "Error" },
    reconnect_required: { icon: AlertCircle, cls: "bg-amber-50 text-amber-700 ring-amber-600/20", label: "Reconnect Required" },
  };
  const cfg = map[status] ?? { icon: Clock, cls: "bg-gray-50 text-gray-600 ring-gray-500/20", label: "Disconnected" };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.cls}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function SyncStatusPill({ status }: { status: string }) {
  const cls = status === "completed" ? "bg-green-100 text-green-700"
    : status === "failed" ? "bg-red-100 text-red-700"
    : status === "running" ? "bg-blue-100 text-blue-700"
    : "bg-gray-100 text-gray-600";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

// ---------------------------------------------------------------------------
// Credentials form
// ---------------------------------------------------------------------------
function CredentialsForm({
  companyId,
  connectionStatus,
  onSaved,
}: {
  companyId: number;
  connectionStatus: string;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/company/${companyId}/integrations/aspire`, "PUT", { clientId, clientSecret }),
    onSuccess: async () => {
      // Immediately test the connection after saving
      try {
        const result = await apiRequest(`/api/company/${companyId}/integrations/aspire/test`, "POST");
        setTestResult({ success: result.success, message: result.errorMessage });
        if (result.success) {
          toast({ title: "Connected!", description: "Aspire credentials verified and saved." });
        } else {
          toast({ title: "Credentials saved", description: "Connection test failed — check your credentials.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Credentials saved", description: "Could not run connection test." });
      }
      qc.invalidateQueries({ queryKey: [`/api/company/${companyId}/integrations/aspire`] });
      onSaved();
    },
    onError: (err) => {
      toast({ title: "Save failed", description: parseApiError(err, "Failed to save credentials"), variant: "destructive" });
    },
  });

  const isConnected = connectionStatus === "connected";

  return (
    <div className="space-y-4">
      {isConnected && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Aspire is connected. Enter new credentials below to rotate them.
        </div>
      )}

      {testResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${testResult.success ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          {testResult.success ? "✓ Connection verified successfully." : `✗ ${testResult.message ?? "Connection failed."}`}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
        <input
          id="aspire-client-id"
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="Enter Aspire Client ID"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
        <div className="relative">
          <input
            id="aspire-client-secret"
            type={showSecret ? "text" : "password"}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Enter Aspire Client Secret"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <button
        id="aspire-save-connect-btn"
        onClick={() => saveMutation.mutate()}
        disabled={!clientId.trim() || !clientSecret.trim() || saveMutation.isPending}
        className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {saveMutation.isPending ? "Saving & Testing…" : "Save & Connect"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disconnect button
// ---------------------------------------------------------------------------
function DisconnectButton({ companyId }: { companyId: number }) {
  const [confirming, setConfirming] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiRequest(`/api/company/${companyId}/integrations/aspire`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Aspire integration has been disconnected." });
      qc.invalidateQueries({ queryKey: [`/api/company/${companyId}/integrations/aspire`] });
      setConfirming(false);
    },
    onError: (err) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to disconnect"), variant: "destructive" });
    },
  });

  if (!confirming) {
    return (
      <button
        id="aspire-disconnect-btn"
        onClick={() => setConfirming(true)}
        className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
      >
        <Unplug className="h-4 w-4" />
        Disconnect
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
      <p className="text-sm text-red-700 font-medium">Disconnect Aspire integration?</p>
      <p className="text-xs text-red-600">This will revoke credentials and stop all syncing. Existing synced data remains.</p>
      <div className="flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {mutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Yes, disconnect
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync logs table
// ---------------------------------------------------------------------------
function SyncLogsTable({ companyId }: { companyId: number }) {
  const { data, isLoading } = useQuery<{ syncLogs: SyncLog[] }>({
    queryKey: [`/api/company/${companyId}/integrations/aspire/sync-logs`],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const logs = data?.syncLogs ?? [];

  if (isLoading) {
    return <div className="text-sm text-gray-500 py-4 text-center">Loading sync logs…</div>;
  }

  if (!logs.length) {
    return <div className="text-sm text-gray-400 py-4 text-center">No sync runs yet.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Type</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Triggered</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Processed</th>
            <th className="px-3 py-2 text-left font-medium text-gray-500">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {logs.slice(0, 10).map((log) => (
            <tr key={log.id} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-mono text-gray-700">{log.jobType}</td>
              <td className="px-3 py-2"><SyncStatusPill status={log.status} /></td>
              <td className="px-3 py-2 text-gray-500">{log.triggeredBy}</td>
              <td className="px-3 py-2 text-gray-700">
                {log.recordsProcessed ?? "–"}
                {log.recordsFailed ? <span className="text-red-500 ml-1">({log.recordsFailed} failed)</span> : null}
              </td>
              <td className="px-3 py-2 text-gray-400">
                {log.startedAt ? new Date(log.startedAt).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflicts panel
// ---------------------------------------------------------------------------
const QUICK_RESOLUTIONS = [
  { value: "use_aspire", label: "Use Aspire" },
  { value: "use_irrigo", label: "Use IrrigoPro" },
  { value: "dismissed", label: "Dismiss" },
] as const;

function ConflictItem({
  c,
  companyId,
  onResolved,
}: {
  c: Conflict;
  companyId: number;
  onResolved: () => void;
}) {
  const { toast } = useToast();
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState(c.irrigoValue ?? "");

  const resolveMutation = useMutation({
    mutationFn: ({ resolution, manualValue }: { resolution: string; manualValue?: string }) =>
      apiRequest(
        `/api/company/${companyId}/integrations/aspire/conflicts/${c.id}/resolve`,
        "POST",
        { resolution, manualValue: manualValue ?? undefined },
      ),
    onSuccess: (_, vars) => {
      toast({ title: "Conflict resolved", description: vars.resolution === "dismissed" ? "Conflict dismissed." : "Live record updated." });
      onResolved();
    },
    onError: (err) => {
      const msg = parseApiError(err, "Failed to resolve conflict");
      // Surface invalid-estimate-status validation errors clearly
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800">
            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1.5">{c.aspireEntity}</span>
            {c.fieldName}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Detected {new Date(c.detectedAt).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Side-by-side values */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs font-medium text-emerald-700 mb-0.5">Aspire value</p>
          <p className="text-sm text-gray-800 break-all">{c.aspireValue ?? <em className="text-gray-400">empty</em>}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-xs font-medium text-blue-700 mb-0.5">IrrigoPro value</p>
          <p className="text-sm text-gray-800 break-all">{c.irrigoValue ?? <em className="text-gray-400">empty</em>}</p>
        </div>
      </div>

      {/* Resolution actions */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {QUICK_RESOLUTIONS.map((res) => (
            <button
              key={res.value}
              id={`resolve-conflict-${c.id}-${res.value}`}
              type="button"
              onClick={() => resolveMutation.mutate({ resolution: res.value })}
              disabled={resolveMutation.isPending}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {res.label}
            </button>
          ))}
          <button
            id={`resolve-conflict-${c.id}-manual_edit`}
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
              id={`manual-value-${c.id}`}
              type="text"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="Enter corrected value"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <button
              id={`manual-submit-${c.id}`}
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

function ConflictsPanel({ companyId, canResolve }: { companyId: number; canResolve: boolean }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ conflicts: Conflict[] }>({
    queryKey: [`/api/company/${companyId}/integrations/aspire/conflicts`],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const conflicts = (data?.conflicts ?? []).filter((c) => c.status === "pending");

  const handleResolved = () => {
    qc.invalidateQueries({ queryKey: [`/api/company/${companyId}/integrations/aspire/conflicts`] });
  };

  if (isLoading) return <div className="text-sm text-gray-400 py-4 text-center">Loading conflicts…</div>;

  if (!conflicts.length) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-400 mb-2" />
        <p className="text-sm text-gray-500">No pending conflicts — all synced data is in agreement.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {conflicts.map((c) => (
        canResolve
          ? <ConflictItem key={c.id} c={c} companyId={companyId} onResolved={handleResolved} />
          : (
            <div key={c.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-gray-800">
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1.5">{c.aspireEntity}</span>
                {c.fieldName}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Detected {new Date(c.detectedAt).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-2">Resolution requires company admin access.</p>
            </div>
          )
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function AspireSetupPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [showLogs, setShowLogs] = useState(false);
  const [showConflicts, setShowConflicts] = useState(true);
  const qc = useQueryClient();

  const companyId = user?.companyId;
  const isReadOnly = user?.role !== "company_admin";

  const { data, isLoading, refetch } = useQuery<AspireDetail>({
    queryKey: [`/api/company/${companyId}/integrations/aspire`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: Boolean(companyId),
    refetchInterval: 30_000,
  });

  const { toast } = useToast();

  const syncMutation = useMutation({
    mutationFn: () => apiRequest(`/api/company/${companyId}/integrations/aspire/sync`, "POST"),
    onSuccess: () => {
      toast({ title: "Sync started", description: "A full sync has been queued." });
      setTimeout(() => qc.invalidateQueries({ queryKey: [`/api/company/${companyId}/integrations/aspire/sync-logs`] }), 2000);
    },
    onError: (err) => {
      toast({ title: "Error", description: parseApiError(err, "Failed to trigger sync"), variant: "destructive" });
    },
  });

  if (!companyId) return null;

  const creds = data?.credentials;
  const connectionStatus = creds?.connectionStatus ?? "disconnected";
  const isConnected = connectionStatus === "connected";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-6 space-y-6">

        {/* Back + header */}
        <div>
          <button
            onClick={() => navigate("/integrations")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Integrations
          </button>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Aspire CRM</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Sync customers, properties, work orders, and more between IrrigoPro and Aspire.
              </p>
            </div>
            {!isLoading && <StatusBadge status={connectionStatus} />}
          </div>
        </div>

        {/* Connection info (when connected) */}
        {isConnected && creds && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-800">Connection Details</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-gray-600">
              <div>
                <span className="font-medium text-gray-500 block mb-0.5">Client ID</span>
                {creds.clientIdSet ? "••••••••" : <span className="text-gray-300">Not set</span>}
              </div>
              <div>
                <span className="font-medium text-gray-500 block mb-0.5">Client Secret</span>
                {creds.clientSecretSet ? "••••••••" : <span className="text-gray-300">Not set</span>}
              </div>
              <div>
                <span className="font-medium text-gray-500 block mb-0.5">Sync Enabled</span>
                {creds.syncEnabled ? "Yes" : "No"}
              </div>
              {creds.lastHealthCheckAt && (
                <div>
                  <span className="font-medium text-gray-500 block mb-0.5">Last Health Check</span>
                  {new Date(creds.lastHealthCheckAt).toLocaleString()}
                </div>
              )}
            </div>

            {!isReadOnly && (
              <div className="flex items-center gap-3 pt-1">
                <button
                  id="aspire-trigger-sync-btn"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {syncMutation.isPending
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <RefreshCw className="h-3 w-3" />}
                  Sync Now
                </button>
                <DisconnectButton companyId={companyId} />
              </div>
            )}
          </div>
        )}

        {/* Credentials form — always shown so connected admins can rotate, read-only roles never see it */}
        {!isReadOnly && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              {isConnected ? "Rotate Credentials" : "Connect Aspire"}
            </h2>
            <CredentialsForm
              companyId={companyId}
              connectionStatus={connectionStatus}
              onSaved={() => refetch()}
            />
          </div>
        )}

        {/* Sync conflicts */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            id="aspire-toggle-conflicts"
            onClick={() => setShowConflicts((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-gray-800"
          >
            <span>Sync Conflicts</span>
            {showConflicts ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {showConflicts && (
            <div className="border-t border-gray-100 px-5 py-4">
              <ConflictsPanel companyId={companyId} canResolve={!isReadOnly} />
            </div>
          )}
        </div>

        {/* Sync logs */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            id="aspire-toggle-sync-logs"
            onClick={() => setShowLogs((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-gray-800"
          >
            <span>Sync History</span>
            {showLogs ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </button>
          {showLogs && (
            <div className="border-t border-gray-100 px-5 py-4">
              <SyncLogsTable companyId={companyId} />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

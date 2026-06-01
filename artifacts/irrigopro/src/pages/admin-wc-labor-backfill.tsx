import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Shield,
  Droplets,
  Play,
  Square,
  RefreshCw,
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BackfillProgress {
  state: "idle" | "running" | "done" | "cancelled" | "error";
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  invoicedReport?: InvoicedWcbReport[];
}

interface InvoicedWcbReport {
  wcbId: number;
  billingNumber: string;
  customerName: string;
  wetCheckId: number;
  invoiceId: number;
  laborRate: string;
  computedLaborHours: string;
  computedLaborSubtotal: string;
  storedLaborSubtotal: string;
  storedTotalAmount: string;
  computedTotalAmount: string;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

function useCurrentUser() {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Progress card ─────────────────────────────────────────────────────────────

function StateIcon({ state }: { state: BackfillProgress["state"] }) {
  if (state === "running") return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
  if (state === "done") return <CheckCircle className="w-5 h-5 text-green-600" />;
  if (state === "cancelled") return <Square className="w-5 h-5 text-yellow-500" />;
  if (state === "error") return <XCircle className="w-5 h-5 text-red-600" />;
  return <Droplets className="w-5 h-5 text-gray-400" />;
}

function ProgressCard({
  progress,
  onCancel,
  onReset,
}: {
  progress: BackfillProgress;
  onCancel: () => void;
  onReset: () => void;
}) {
  const isRunning = progress.state === "running";
  const isTerminal = ["done", "cancelled", "error"].includes(progress.state);

  return (
    <Card className="border border-gray-200">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <StateIcon state={progress.state} />
          <CardTitle className="text-sm font-semibold text-gray-900">
            Backfill Progress
          </CardTitle>
          <span className="ml-auto text-xs text-gray-500 uppercase tracking-wide font-medium">
            {progress.dryRun ? "DRY RUN" : "LIVE"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            { label: "Scanned", value: progress.scanned },
            { label: "Updated", value: progress.updated, color: "text-green-700" },
            { label: "Skipped", value: progress.skipped, color: "text-gray-500" },
            { label: "Failed", value: progress.failed, color: progress.failed > 0 ? "text-red-600" : undefined },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-50 rounded-lg p-2">
              <p className={`text-lg font-bold ${color ?? "text-gray-900"}`}>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </div>
          ))}
        </div>

        {progress.errorMessage && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {progress.errorMessage}
          </div>
        )}

        {progress.finishedAt && (
          <p className="text-xs text-gray-400">
            Finished at {new Date(progress.finishedAt).toLocaleTimeString()}
          </p>
        )}

        <div className="flex gap-2">
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 border-yellow-300 text-yellow-700 hover:bg-yellow-50"
              onClick={onCancel}
            >
              <Square className="w-3.5 h-3.5" />
              Cancel
            </Button>
          )}
          {isTerminal && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5"
              onClick={onReset}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset checkpoint
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Reconciliation card ────────────────────────────────────────────────────────

function ReconciliationCard({ progress }: { progress: BackfillProgress }) {
  if (progress.state !== "done") return null;

  const residualZero = progress.updated === 0 && progress.scanned > 0
    ? progress.scanned - progress.skipped - progress.failed
    : 0;

  return (
    <Card className="border border-green-200 bg-green-50">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm text-green-800 space-y-1">
            <p className="font-semibold">Reconciliation</p>
            <p>
              {progress.dryRun
                ? `Dry run complete. ${progress.updated} WCBs would be updated.`
                : `Backfill complete. ${progress.updated} WCBs updated.`}
            </p>
            {residualZero === 0 && !progress.dryRun && (
              <p className="text-green-700">
                ✓ No residual zero-labor unbilled WCBs remain.
              </p>
            )}
            {progress.failed > 0 && (
              <p className="text-yellow-700">
                ⚠ {progress.failed} WCBs could not be processed (no companyId). Check logs.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Invoiced report table ─────────────────────────────────────────────────────

function InvoicedReportTab({ report }: { report: InvoicedWcbReport[] }) {
  const [notes, setNotes] = useState<Record<number, string>>({});

  function exportCsv() {
    const header = [
      "WCB ID",
      "Billing Number",
      "Customer",
      "Wet Check ID",
      "Invoice ID",
      "Labor Rate",
      "Computed Hours",
      "Computed Subtotal",
      "Stored Subtotal",
      "Stored Total",
      "Computed Total",
      "Notes",
    ].join(",");

    const rows = report.map((r) =>
      [
        r.wcbId,
        `"${r.billingNumber}"`,
        `"${r.customerName.replace(/"/g, '""')}"`,
        r.wetCheckId,
        r.invoiceId,
        r.laborRate,
        r.computedLaborHours,
        r.computedLaborSubtotal,
        r.storedLaborSubtotal,
        r.storedTotalAmount,
        r.computedTotalAmount,
        `"${(notes[r.wcbId] ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wc-labor-invoiced-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (report.length === 0) {
    return (
      <div className="py-10 text-center text-gray-500 text-sm">
        No invoiced WCBs with zero labor found. Nothing to report.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {report.length} invoiced WCB{report.length !== 1 ? "s" : ""} with zero labor.{" "}
          <span className="font-medium text-amber-700">
            No DB writes — pass the CSV to accounting.
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-1.5"
          onClick={exportCsv}
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-xs divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {[
                "WCB",
                "Customer",
                "Invoice",
                "Labor Rate",
                "Computed Hours",
                "Computed Subtotal",
                "Stored Subtotal",
                "Δ Total",
                "Notes",
              ].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {report.map((r) => {
              const delta = (
                parseFloat(r.computedTotalAmount) - parseFloat(r.storedTotalAmount)
              ).toFixed(2);
              const hasGap = Math.abs(parseFloat(delta)) > 0.01;

              return (
                <tr key={r.wcbId} className={hasGap ? "bg-amber-50" : undefined}>
                  <td className="px-3 py-2 font-mono text-gray-700">{r.billingNumber}</td>
                  <td className="px-3 py-2 text-gray-700">{r.customerName}</td>
                  <td className="px-3 py-2 text-gray-500">{r.invoiceId}</td>
                  <td className="px-3 py-2 text-gray-500">${r.laborRate}/hr</td>
                  <td className="px-3 py-2 text-gray-700">{r.computedLaborHours} hr</td>
                  <td className="px-3 py-2 text-green-700">${r.computedLaborSubtotal}</td>
                  <td className="px-3 py-2 text-gray-500">${r.storedLaborSubtotal}</td>
                  <td className={`px-3 py-2 font-medium ${hasGap ? "text-amber-700" : "text-gray-400"}`}>
                    {hasGap ? `+$${delta}` : "—"}
                  </td>
                  <td className="px-3 py-2 min-w-[180px]">
                    <Textarea
                      value={notes[r.wcbId] ?? ""}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [r.wcbId]: e.target.value }))
                      }
                      placeholder="Accounting notes…"
                      rows={1}
                      className="text-xs resize-none"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const TABS = ["Recompute unbilled", "Invoiced WCBs report"] as const;
type Tab = (typeof TABS)[number];

export default function AdminWcLaborBackfillPage() {
  const [, navigate] = useLocation();
  const user = useCurrentUser();

  const [activeTab, setActiveTab] = useState<Tab>("Recompute unbilled");
  const [dryRun, setDryRun] = useState(true);
  const [progress, setProgress] = useState<BackfillProgress>({
    state: "idle",
    scanned: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    dryRun: true,
  });
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (!user || user.role !== "super_admin") {
    navigate("/", { replace: true });
    return null;
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await apiRequest("/api/admin/wc-labor-backfill/status", "GET");
        const data: BackfillProgress = await resp.json();
        setProgress(data);
        if (data.state !== "running") stopPolling();
      } catch {
        // Ignore transient errors.
      }
    }, 800);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => {
    // Load initial status on mount.
    apiRequest("/api/admin/wc-labor-backfill/status", "GET")
      .then((r) => r.json())
      .then((data: BackfillProgress) => {
        setProgress(data);
        if (data.state === "running") startPolling();
      })
      .catch(() => {});

    return () => stopPolling();
  }, []);

  async function handleStart() {
    setError(null);
    setIsStarting(true);
    try {
      const resp = await apiRequest("/api/admin/wc-labor-backfill/start", "POST", {
        dryRun,
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError((body as any).message ?? "Failed to start backfill");
        return;
      }
      startPolling();
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleCancel() {
    try {
      await apiRequest("/api/admin/wc-labor-backfill/cancel", "POST");
    } catch {
      // Ignore.
    }
  }

  async function handleReset() {
    setError(null);
    try {
      const resp = await apiRequest("/api/admin/wc-labor-backfill/reset", "POST");
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError((body as any).message ?? "Reset failed");
        return;
      }
      setProgress({
        state: "idle",
        scanned: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        dryRun: true,
      });
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    }
  }

  const isRunning = progress.state === "running";
  const canStart = !isRunning;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Droplets className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">WC Labor Backfill</h1>
          <p className="text-sm text-gray-500">
            Recover missing repair labor hours on wet check billings created before Slice 2.
          </p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
          <Shield className="w-3 h-3" />
          Super Admin
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={[
                "pb-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab: Recompute unbilled */}
      {activeTab === "Recompute unbilled" && (
        <div className="space-y-4">
          <Card className="border border-gray-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-900">Run options</CardTitle>
              <CardDescription className="text-xs text-gray-500">
                Recomputes zone repair labor for all unbilled WCBs with zero totalHours.
                Manually-overridden zones are never touched.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={dryRun}
                  onCheckedChange={(v) => setDryRun(Boolean(v))}
                  disabled={isRunning}
                  className="mt-0.5"
                />
                <span className="text-sm text-gray-700">
                  <span className="font-medium">Dry run</span> — show what would change without
                  writing to the database.
                </span>
              </label>

              {!dryRun && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Live mode:</strong> Zone records and WCB totals will be updated in the
                    database. Invoiced WCBs are never modified.
                  </span>
                </div>
              )}

              <Button
                onClick={handleStart}
                disabled={!canStart || isStarting}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {dryRun ? "Run dry run" : "Run backfill"}
              </Button>
            </CardContent>
          </Card>

          {progress.state !== "idle" && (
            <ProgressCard
              progress={progress}
              onCancel={handleCancel}
              onReset={handleReset}
            />
          )}

          {progress.state === "done" && (
            <ReconciliationCard progress={progress} />
          )}
        </div>
      )}

      {/* Tab: Invoiced WCBs report */}
      {activeTab === "Invoiced WCBs report" && (
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <strong>Read-only.</strong> This report shows invoiced WCBs with zero labor and
            what their labor subtotal would have been. No database writes ever occur here.
            Pass the exported CSV to accounting.
          </div>

          {progress.invoicedReport ? (
            <InvoicedReportTab report={progress.invoicedReport} />
          ) : (
            <div className="py-10 text-center text-gray-500 text-sm">
              {progress.state === "idle"
                ? "Run the backfill (Bucket A tab) to generate the invoiced WCBs report."
                : progress.state === "running"
                ? "Report will appear when the backfill finishes…"
                : "No invoiced report available. Run a full backfill to generate it."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

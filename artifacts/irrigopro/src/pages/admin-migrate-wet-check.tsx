import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  StopCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Database,
  AlertTriangle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ReconciliationReport {
  bsWcCount: number;
  bsWcDistinctCustomers: number;
  bsWcTotalValue: number;
  bsWcAlreadyBilled: number;
  findingsLinkedToBsWc: number;
  invoiceItemsLinkedToBsWc: number;
  wcbCount: number;
  danglingFindingsBsWcId: number;
  danglingInvoiceItemsBsWcId: number;
}

interface MigrationResult {
  migrated: number;
  skippedAlreadyDone: number;
  failed: number;
  failedIds: number[];
  preReport: ReconciliationReport;
  postReport?: ReconciliationReport;
  assertionsPassed: boolean;
  cancelledEarly?: boolean;
}

interface FailureDetail {
  id: number;
  error: string;
  stage: string;
  at: string;
}

interface JobSnapshot {
  state: "idle" | "running" | "completed" | "failed" | "cancelled";
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  processed: number;
  total: number;
  failed: number;
  currentBsId: number | null;
  lastError: string | null;
  result: MigrationResult | null;
  preReport: ReconciliationReport | null;
  postReport: ReconciliationReport | null;
  cancelRequested: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StateBadge({ state }: { state: JobSnapshot["state"] }) {
  switch (state) {
    case "idle":
      return <Badge variant="secondary">Idle</Badge>;
    case "running":
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-800 border-green-200">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    case "cancelled":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
          <StopCircle className="w-3 h-3 mr-1" />
          Cancelled
        </Badge>
      );
  }
}

function ReportTable({
  pre,
  post,
}: {
  pre: ReconciliationReport;
  post?: ReconciliationReport;
}) {
  const rows: Array<{
    label: string;
    key: keyof ReconciliationReport;
    lowerIsBetter?: boolean;
  }> = [
    { label: "BS-WC rows remaining", key: "bsWcCount", lowerIsBetter: true },
    { label: "Distinct customers affected", key: "bsWcDistinctCustomers" },
    { label: "Total value ($)", key: "bsWcTotalValue" },
    { label: "Already billed rows", key: "bsWcAlreadyBilled" },
    { label: "Findings linked to BS-WC", key: "findingsLinkedToBsWc", lowerIsBetter: true },
    { label: "Invoice items linked to BS-WC", key: "invoiceItemsLinkedToBsWc", lowerIsBetter: true },
    { label: "wet_check_billings count", key: "wcbCount" },
    { label: "Dangling findings FK", key: "danglingFindingsBsWcId", lowerIsBetter: true },
    { label: "Dangling invoice_items FK", key: "danglingInvoiceItemsBsWcId", lowerIsBetter: true },
  ];

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-gray-500">
          <th className="py-1 pr-4 font-medium">Metric</th>
          <th className="py-1 pr-4 font-medium">Pre-migration</th>
          {post && <th className="py-1 pr-4 font-medium">Post-migration</th>}
          {post && <th className="py-1 font-medium">Pass?</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, key, lowerIsBetter }) => {
          const preVal = pre[key];
          const postVal = post?.[key];
          let pass: boolean | null = null;
          if (post !== undefined && postVal !== undefined) {
            if (lowerIsBetter) {
              pass = (postVal as number) <= (preVal as number);
            } else {
              pass = true;
            }
            if (key === "danglingFindingsBsWcId" || key === "danglingInvoiceItemsBsWcId") {
              pass = (postVal as number) === 0;
            }
          }
          return (
            <tr key={key} className="border-b last:border-0">
              <td className="py-1.5 pr-4 text-gray-700">{label}</td>
              <td className="py-1.5 pr-4 font-mono">
                {typeof preVal === "number" && key === "bsWcTotalValue"
                  ? `$${preVal.toFixed(2)}`
                  : String(preVal)}
              </td>
              {post && (
                <td className="py-1.5 pr-4 font-mono">
                  {postVal !== undefined
                    ? typeof postVal === "number" && key === "bsWcTotalValue"
                      ? `$${postVal.toFixed(2)}`
                      : String(postVal)
                    : "—"}
                </td>
              )}
              {post && (
                <td className="py-1.5">
                  {pass === null ? null : pass ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminMigrateWetCheckPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDryRun, setIsDryRun] = useState(false);
  const [showReport, setShowReport] = useState(true);
  const [showFailures, setShowFailures] = useState(true);
  const [failures, setFailures] = useState<FailureDetail[]>([]);

  const { data: snapshot } = useQuery<JobSnapshot>({
    queryKey: ["/api/admin/migrate-bs-wc/status"],
    queryFn: async () => {
      const res = await apiRequest("/api/admin/migrate-bs-wc/status", "GET");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as JobSnapshot | undefined;
      return data?.state === "running" ? 2000 : false;
    },
    staleTime: 1000,
  });

  const prevStateRef = useRef<JobSnapshot["state"] | undefined>(undefined);
  useEffect(() => {
    if (!snapshot) return;
    const prev = prevStateRef.current;
    prevStateRef.current = snapshot.state;
    if (prev === "running" && snapshot.state !== "running") {
      qc.invalidateQueries({ queryKey: ["/api/admin/migrate-bs-wc/status"] });
      if (snapshot.state === "completed") {
        toast({ title: "Migration completed", description: "All assertions passed." });
      } else if (snapshot.state === "failed") {
        toast({ title: "Migration finished with failures", variant: "destructive" });
      } else if (snapshot.state === "cancelled") {
        toast({ title: "Migration cancelled" });
      }
    }
  }, [snapshot, toast, qc]);

  const startMutation = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const res = await apiRequest("/api/admin/migrate-bs-wc/start", "POST", { dryRun });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body?.message ?? "Failed to start migration");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/migrate-bs-wc/status"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not start migration", description: e.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/migrate-bs-wc/cancel", "POST");
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body?.message ?? "Failed to cancel");
      }
    },
    onSuccess: () => {
      toast({ title: "Cancel requested — the current row will finish first" });
      qc.invalidateQueries({ queryKey: ["/api/admin/migrate-bs-wc/status"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not cancel", description: e.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/migrate-bs-wc/reset", "POST");
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body?.message ?? "Failed to reset");
      }
    },
    onSuccess: () => {
      toast({ title: "Job state reset to idle" });
      setFailures([]);
      qc.invalidateQueries({ queryKey: ["/api/admin/migrate-bs-wc/status"] });
    },
    onError: (e: Error) => {
      toast({ title: "Could not reset", description: e.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!snapshot) return;
    const failedIds = snapshot.result?.failedIds ?? [];
    if (failedIds.length === 0) return;
    apiRequest("/api/admin/migrate-bs-wc/status", "GET")
      .then((r) => r.json())
      .then((s: JobSnapshot) => {
        if (s.result?.failedIds?.length) {
          setFailures(
            s.result.failedIds.map((id) => ({
              id,
              error: s.lastError ?? "unknown error",
              stage: "unknown",
              at: s.completedAt ?? "",
            })),
          );
        }
      })
      .catch(() => {});
  }, [snapshot?.state]);

  const state = snapshot?.state ?? "idle";
  const isRunning = state === "running";
  const isTerminal = state === "completed" || state === "failed" || state === "cancelled";
  const isIdle = state === "idle";

  const progressPct =
    snapshot && snapshot.total > 0
      ? Math.round((snapshot.processed / snapshot.total) * 100)
      : 0;

  function openRunModal(dryRun: boolean) {
    setIsDryRun(dryRun);
    setConfirmText("");
    if (dryRun) {
      startMutation.mutate(true);
      return;
    }
    setShowConfirmModal(true);
  }

  function handleConfirmStart() {
    if (confirmText !== "MIGRATE") return;
    setShowConfirmModal(false);
    startMutation.mutate(false);
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database className="w-5 h-5 text-gray-600" />
            <h1 className="text-xl font-semibold text-gray-900">BS-WC Migration</h1>
            {snapshot && <StateBadge state={state} />}
          </div>
          <p className="text-sm text-gray-500">
            Migrates legacy <code className="bg-gray-100 px-1 rounded text-xs">billing_sheets</code>{" "}
            rows with <code className="bg-gray-100 px-1 rounded text-xs">billing_number LIKE 'BS-WC-%'</code>{" "}
            into <code className="bg-gray-100 px-1 rounded text-xs">wet_check_billings</code>.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isIdle && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openRunModal(true)}
                disabled={startMutation.isPending}
              >
                Dry Run
              </Button>
              <Button
                size="sm"
                onClick={() => openRunModal(false)}
                disabled={startMutation.isPending}
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                Run Migration
              </Button>
            </>
          )}
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending || snapshot?.cancelRequested}
            >
              <StopCircle className="w-3.5 h-3.5 mr-1" />
              {snapshot?.cancelRequested ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {isTerminal && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Status Panel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-700">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshot ? (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {snapshot.startedAt && (
                  <>
                    <span className="text-gray-500">Started</span>
                    <span>{new Date(snapshot.startedAt).toLocaleString()}</span>
                  </>
                )}
                {snapshot.completedAt && (
                  <>
                    <span className="text-gray-500">Finished</span>
                    <span>{new Date(snapshot.completedAt).toLocaleString()}</span>
                  </>
                )}
                {snapshot.jobId && (
                  <>
                    <span className="text-gray-500">Job ID</span>
                    <span className="font-mono text-xs">{snapshot.jobId}</span>
                  </>
                )}
                {isRunning && snapshot.currentBsId && (
                  <>
                    <span className="text-gray-500">Current BS ID</span>
                    <span className="font-mono">{snapshot.currentBsId}</span>
                  </>
                )}
                {(isRunning || isTerminal) && (
                  <>
                    <span className="text-gray-500">Processed</span>
                    <span>
                      {snapshot.processed}
                      {snapshot.total > 0 ? ` / ${snapshot.total}` : ""}
                    </span>
                    <span className="text-gray-500">Failed rows</span>
                    <span className={snapshot.failed > 0 ? "text-red-600 font-medium" : ""}>
                      {snapshot.failed}
                    </span>
                  </>
                )}
              </div>

              {isRunning && snapshot.total > 0 && (
                <div className="space-y-1">
                  <Progress value={progressPct} className="h-2" />
                  <p className="text-xs text-gray-500 text-right">{progressPct}%</p>
                </div>
              )}

              {snapshot.lastError && (
                <div className="flex items-start gap-2 rounded bg-red-50 border border-red-200 p-2 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{snapshot.lastError}</span>
                </div>
              )}

              {isIdle && !snapshot.startedAt && (
                <p className="text-sm text-gray-500">No migration has run yet in this session.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Loading…</p>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation Report */}
      {(snapshot?.preReport || snapshot?.postReport) && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer select-none"
            onClick={() => setShowReport((v) => !v)}
          >
            <CardTitle className="text-sm font-medium text-gray-700 flex items-center gap-2">
              {showReport ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Reconciliation Report
            </CardTitle>
          </CardHeader>
          {showReport && (
            <CardContent>
              {snapshot.preReport && (
                <ReportTable pre={snapshot.preReport} post={snapshot.postReport ?? undefined} />
              )}
              {snapshot.result && (
                <div className="mt-3 pt-3 border-t flex items-center gap-2 text-sm">
                  {snapshot.result.assertionsPassed ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-green-700">All assertions passed</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-500" />
                      <span className="text-red-600">One or more assertions failed</span>
                    </>
                  )}
                  {snapshot.result.cancelledEarly && (
                    <span className="text-yellow-700 ml-2">(cancelled early — partial results)</span>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Recent Failures */}
      {(failures.length > 0 || (snapshot?.result?.failedIds ?? []).length > 0) && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer select-none"
            onClick={() => setShowFailures((v) => !v)}
          >
            <CardTitle className="text-sm font-medium text-red-700 flex items-center gap-2">
              {showFailures ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Failed Rows ({snapshot?.result?.failedIds?.length ?? failures.length})
            </CardTitle>
          </CardHeader>
          {showFailures && (
            <CardContent>
              {snapshot?.result?.failedIds && snapshot.result.failedIds.length > 0 ? (
                <div className="space-y-1">
                  {snapshot.result.failedIds.map((id) => (
                    <div key={id} className="font-mono text-sm text-red-700 bg-red-50 rounded px-2 py-1">
                      BS ID {id}
                    </div>
                  ))}
                  {snapshot.lastError && (
                    <p className="text-xs text-gray-500 mt-2">{snapshot.lastError}</p>
                  )}
                </div>
              ) : (
                failures.map((f) => (
                  <div key={f.id} className="border rounded p-2 mb-2 text-sm">
                    <p className="font-medium text-red-700">BS ID {f.id} — stage: {f.stage}</p>
                    <p className="text-gray-600 mt-0.5">{f.error}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{f.at}</p>
                  </div>
                ))
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Confirmation Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Migration</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              This will move all <strong>BS-WC-*</strong> billing sheets into{" "}
              <code className="bg-gray-100 px-1 rounded text-xs">wet_check_billings</code> and delete
              the original rows. This action cannot be undone without a database restore.
            </p>
            <div className="space-y-1">
              <Label htmlFor="confirm-input" className="text-sm">
                Type <strong>MIGRATE</strong> to confirm
              </Label>
              <Input
                id="confirm-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="MIGRATE"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "MIGRATE" || startMutation.isPending}
              onClick={handleConfirmStart}
            >
              {startMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-1" />
              )}
              Run Migration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

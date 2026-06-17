import { useState, useEffect, useRef, useCallback } from "react";
import {
  Wrench,
  Play,
  Square,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";

// ── Types (mirror of the API route shapes) ──────────────────────────────────

interface ProgressSnapshot {
  scanned: number;
  matched: number;
  matchedDryRun: number;
  skippedTotalsMismatch: number;
  skippedNoFindings: number;
  errors: number;
}

interface BackfillResult extends ProgressSnapshot {
  totalSelected: number;
  alreadyProcessed: number;
}

type JobStateName = "idle" | "running" | "done" | "cancelled" | "error";

interface JobStatus {
  state: JobStateName;
  dryRun: boolean;
  progress: ProgressSnapshot;
  result: BackfillResult | null;
  logLines: string[];
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface PersistedStatus {
  candidateCount: number;
  doneCount: number;
  seenCount: number;
  failedCount: number;
}

interface StatusResponse {
  job: JobStatus;
  persisted: PersistedStatus | { error: string } | null;
}

const EMPTY_PROGRESS: ProgressSnapshot = {
  scanned: 0,
  matched: 0,
  matchedDryRun: 0,
  skippedTotalsMismatch: 0,
  skippedNoFindings: 0,
  errors: 0,
};

const IDLE_JOB: JobStatus = {
  state: "idle",
  dryRun: true,
  progress: EMPTY_PROGRESS,
  result: null,
  logLines: [],
};

function isPersisted(
  p: StatusResponse["persisted"],
): p is PersistedStatus {
  return !!p && typeof (p as PersistedStatus).candidateCount === "number";
}

// ── Component ────────────────────────────────────────────────────────────────

export function MaintenanceTab() {
  const [job, setJob] = useState<JobStatus>(IDLE_JOB);
  const [persisted, setPersisted] = useState<PersistedStatus | null>(null);
  const [persistedError, setPersistedError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDryRunMatched, setLastDryRunMatched] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data: StatusResponse = await apiRequest(
        "/api/admin/inspection-zone-backfill/status",
        "GET",
      );
      setJob(data.job ?? IDLE_JOB);
      if (isPersisted(data.persisted)) {
        setPersisted(data.persisted);
        setPersistedError(null);
      } else if (data.persisted && "error" in data.persisted) {
        setPersistedError(data.persisted.error);
      }
      if (
        data.job?.state === "done" &&
        data.job.dryRun &&
        data.job.result
      ) {
        setLastDryRunMatched(data.job.result.matchedDryRun);
      }
      if (data.job?.state !== "running") stopPolling();
    } catch {
      // Transient — keep last known state.
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(fetchStatus, 2000);
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    // Slow refresh of persisted counts while no job is actively polling.
    const idlePoll = setInterval(() => {
      if (!pollRef.current) fetchStatus();
    }, 5000);
    return () => {
      stopPolling();
      clearInterval(idlePoll);
    };
  }, [fetchStatus, stopPolling]);

  // Resume fast polling if the page mounts mid-run.
  useEffect(() => {
    if (job.state === "running" && !pollRef.current) startPolling();
  }, [job.state, startPolling]);

  async function start(dryRun: boolean) {
    setError(null);
    setIsStarting(true);
    if (dryRun) setLastDryRunMatched(null);
    try {
      await apiRequest("/api/admin/inspection-zone-backfill/start", "POST", {
        dryRun,
      });
      await fetchStatus();
      startPolling();
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    } finally {
      setIsStarting(false);
    }
  }

  async function cancel() {
    try {
      await apiRequest("/api/admin/inspection-zone-backfill/cancel", "POST");
    } catch {
      // Ignore — status poll will reflect the result.
    }
  }

  async function reset() {
    setError(null);
    try {
      await apiRequest("/api/admin/inspection-zone-backfill/reset", "POST");
      setJob(IDLE_JOB);
      setLastDryRunMatched(null);
      await fetchStatus();
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    }
  }

  const isRunning = job.state === "running";
  const isTerminal = ["done", "cancelled", "error"].includes(job.state);
  const live = job.result ?? job.progress;
  const skippedTotal =
    live.skippedTotalsMismatch + live.skippedNoFindings;
  const canApply =
    !isRunning && lastDryRunMatched !== null && lastDryRunMatched > 0;

  return (
    <div className="space-y-4">
      {/* Intro */}
      <Card className="border border-gray-200">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-blue-600" />
            <CardTitle className="text-sm font-semibold text-gray-900">
              Inspection Estimate Zone Backfill
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-gray-500">
            Re-stamps controller / zone metadata onto line items of older
            inspection-origin estimates (created before zone-grouped PDFs) so they
            render the zone-grouped layout. Financial totals are never changed —
            estimates whose regenerated totals don't match are skipped.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Error banner */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Persisted status */}
      <Card className="border border-gray-200">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-gray-500" />
            <CardTitle className="text-sm font-semibold text-gray-900">
              Current state
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {persistedError ? (
            <p className="text-sm text-red-600">{persistedError}</p>
          ) : persisted ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              {[
                { label: "Candidates (unzoned)", value: persisted.candidateCount },
                { label: "Backfilled", value: persisted.doneCount, color: "text-green-700" },
                { label: "Skipped", value: persisted.seenCount, color: "text-gray-500" },
                { label: "Failed", value: persisted.failedCount, color: persisted.failedCount > 0 ? "text-red-600" : undefined },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-3">
                  <p className={`text-xl font-bold ${color ?? "text-gray-900"}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 flex items-center justify-center text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="border border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-900">Run</CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Start with a dry run to preview exactly which estimates would change.
            Apply commits those changes — it only enables after a dry run finds
            matches.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => start(true)}
              disabled={isRunning || isStarting}
              variant="outline"
              className="flex items-center gap-2"
            >
              {isStarting && job.dryRun ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Dry Run
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={!canApply || isStarting}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Apply
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apply zone backfill?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will re-stamp zone metadata on{" "}
                    <strong>{lastDryRunMatched ?? 0}</strong> estimate
                    {lastDryRunMatched === 1 ? "" : "s"} that matched the last dry
                    run. Line items are replaced inside a transaction; financial
                    totals are never modified. This runs against the live database.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => start(false)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Apply now
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {isRunning && (
              <Button
                onClick={cancel}
                variant="outline"
                className="flex items-center gap-2 border-yellow-300 text-yellow-700 hover:bg-yellow-50"
              >
                <Square className="w-4 h-4" />
                Cancel
              </Button>
            )}

            {isTerminal && (
              <Button
                onClick={reset}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </Button>
            )}
          </div>

          {!canApply && lastDryRunMatched === 0 && !isRunning && (
            <p className="text-xs text-gray-500">
              The last dry run found no estimates to update — nothing to apply.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Progress / results */}
      {job.state !== "idle" && (
        <Card className="border border-gray-200">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              {job.state === "running" ? (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              ) : job.state === "done" ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : job.state === "cancelled" ? (
                <Square className="w-5 h-5 text-yellow-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-600" />
              )}
              <CardTitle className="text-sm font-semibold text-gray-900">
                {job.state === "running"
                  ? `Running ${job.dryRun ? "dry run" : "apply"}…`
                  : job.state === "done"
                  ? job.dryRun
                    ? "Dry run complete"
                    : "Apply complete"
                  : job.state === "cancelled"
                  ? "Cancelled"
                  : "Failed"}
              </CardTitle>
              <span className="ml-auto text-xs text-gray-500 uppercase tracking-wide font-medium">
                {job.dryRun ? "DRY RUN" : "LIVE"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              {[
                { label: "Scanned", value: live.scanned },
                {
                  label: job.dryRun ? "Would match" : "Matched",
                  value: job.dryRun ? live.matchedDryRun : live.matched,
                  color: "text-green-700",
                },
                { label: "Skipped", value: skippedTotal, color: "text-gray-500" },
                {
                  label: "Errors",
                  value: live.errors,
                  color: live.errors > 0 ? "text-red-600" : undefined,
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-2">
                  <p className={`text-lg font-bold ${color ?? "text-gray-900"}`}>{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>

            {job.errorMessage && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {job.errorMessage}
              </div>
            )}

            {job.result && (
              <p className="text-xs text-gray-500">
                Total candidates {job.result.totalSelected} · already processed{" "}
                {job.result.alreadyProcessed} · skipped (totals mismatch){" "}
                {job.result.skippedTotalsMismatch} · skipped (no findings){" "}
                {job.result.skippedNoFindings}
              </p>
            )}

            {job.finishedAt && (
              <p className="text-xs text-gray-400">
                Finished at {new Date(job.finishedAt).toLocaleTimeString()}
              </p>
            )}

            {job.logLines.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-gray-500 mb-1">Log</p>
                <pre className="max-h-64 overflow-auto rounded-lg bg-gray-900 text-gray-100 text-[11px] leading-relaxed p-3 whitespace-pre-wrap">
                  {job.logLines.join("\n")}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

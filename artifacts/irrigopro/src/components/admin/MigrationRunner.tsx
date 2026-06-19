import { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import type { MigrationProgress, MigrationStepResult } from "@/types/migrations";

interface MigrationRunnerProps {
  migrationId: string;
  onComplete?: (progress: MigrationProgress) => void;
}

function StepIcon({ status }: { status: MigrationStepResult["status"] | "pending" }) {
  if (status === "success") return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === "failed") return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  if (status === "running") return <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />;
  if (status === "skipped") return <CheckCircle className="w-4 h-4 text-gray-400 shrink-0" />;
  return <Clock className="w-4 h-4 text-gray-300 shrink-0" />;
}

export function MigrationRunner({ migrationId, onComplete }: MigrationRunnerProps) {
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);

  function stopPolling() {
    if (pollingRef.current != null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  async function startRun() {
    setError(null);
    setProgress(null);
    stopPolling();

    try {
      const data = await apiRequest(`/api/admin/migrations/${migrationId}/run`, "POST") as { jobId: string };
      jobIdRef.current = data.jobId;

      pollingRef.current = setInterval(async () => {
        try {
          const prog = await apiRequest(
            `/api/admin/migrations/${migrationId}/status?jobId=${data.jobId}`,
            "GET",
          ) as MigrationProgress;
          setProgress(prog);
          if (prog.state === "succeeded" || prog.state === "failed" || prog.state === "aborted") {
            stopPolling();
            onComplete?.(prog);
          }
        } catch (pollErr) {
          setError("Failed to poll migration status");
          stopPolling();
        }
      }, 500);
    } catch (runErr: any) {
      setError(runErr?.message ?? "Failed to start migration");
    }
  }

  useEffect(() => {
    return () => { stopPolling(); };
  }, []);

  if (!progress && !error) {
    return (
      <Button onClick={startRun} className="bg-blue-600 hover:bg-blue-700 text-white">
        Run Migration
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {progress && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {progress.steps.map((step) => (
              <div key={step.id} className="flex items-start gap-2 text-sm">
                <StepIcon status={step.status} />
                <div className="flex-1 min-w-0">
                  <span className={
                    step.status === "success" ? "text-green-700" :
                    step.status === "failed" ? "text-red-700" :
                    step.status === "running" ? "text-blue-700 font-medium" :
                    "text-gray-500"
                  }>
                    {step.id.replace(/_/g, " ").replace(/^step\d+ /, "")}
                  </span>
                  {step.error && (
                    <p className="text-red-600 text-xs mt-0.5 break-words">{step.error}</p>
                  )}
                  {step.rowsAffected != null && step.rowsAffected > 0 && (
                    <p className="text-gray-400 text-xs">{step.rowsAffected} rows affected</p>
                  )}
                </div>
                {step.durationMs > 0 && (
                  <span className="text-gray-400 text-xs shrink-0">{step.durationMs}ms</span>
                )}
              </div>
            ))}
            {progress.state === "running" && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                Running…
              </div>
            )}
          </div>

          {progress.state === "succeeded" && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-medium">
              <CheckCircle className="w-4 h-4" />
              Migration completed successfully
            </div>
          )}

          {(progress.state === "failed" || progress.state === "aborted") && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Migration failed</p>
                  {progress.errorMessage && (
                    <p className="text-xs mt-0.5">{progress.errorMessage}</p>
                  )}
                </div>
              </div>
              <Button
                onClick={startRun}
                variant="outline"
                className="text-red-600 border-red-300 hover:bg-red-50"
              >
                Re-run Migration
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

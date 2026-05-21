// Task #808 — In-process job state tracker for the BS-WC migration.
// Module-level singleton — state resets on Node process restart (intentional;
// DB checkpoint handles resumability across restarts).

import type { MigrationResult, ReconciliationReport } from "../migrations/bs-wc-migration";

export type JobState = "idle" | "running" | "completed" | "failed" | "cancelled";

export interface JobSnapshot {
  state: JobState;
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

const initialSnapshot = (): JobSnapshot => ({
  state: "idle",
  jobId: null,
  startedAt: null,
  completedAt: null,
  processed: 0,
  total: 0,
  failed: 0,
  currentBsId: null,
  lastError: null,
  result: null,
  preReport: null,
  postReport: null,
  cancelRequested: false,
});

let _snapshot: JobSnapshot = initialSnapshot();

export function getJobSnapshot(): JobSnapshot {
  return { ..._snapshot };
}

/**
 * Transition to "running". Throws if not currently idle.
 */
export function startJob(jobId: string): void {
  if (_snapshot.state !== "idle") {
    throw new Error(`Cannot start job: state is '${_snapshot.state}', expected 'idle'`);
  }
  _snapshot = {
    ...initialSnapshot(),
    state: "running",
    jobId,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Update progress counters during a run.
 */
export function updateProgress(progress: {
  processed: number;
  total: number;
  failed: number;
  currentBsId: number;
}): void {
  if (_snapshot.state !== "running") return;
  _snapshot = {
    ..._snapshot,
    processed: progress.processed,
    total: progress.total,
    failed: progress.failed,
    currentBsId: progress.currentBsId,
  };
}

/**
 * Transition to "completed" or "failed" depending on result.assertionsPassed.
 */
export function completeJob(result: MigrationResult): void {
  const nextState: JobState =
    result.cancelledEarly
      ? "cancelled"
      : result.assertionsPassed && result.failed === 0
        ? "completed"
        : "failed";

  _snapshot = {
    ..._snapshot,
    state: nextState,
    completedAt: new Date().toISOString(),
    processed: result.migrated,
    failed: result.failed,
    currentBsId: null,
    lastError:
      result.failed > 0 ? `${result.failed} row(s) failed — see reconciliation report` : null,
    result,
    preReport: result.preReport,
    postReport: result.postReport ?? null,
  };
}

/**
 * Set the cancel flag. The running loop checks shouldCancel() each iteration.
 * Throws if state is not "running".
 */
export function requestCancel(): void {
  if (_snapshot.state !== "running") {
    throw new Error(`Cannot cancel: state is '${_snapshot.state}', expected 'running'`);
  }
  _snapshot = { ..._snapshot, cancelRequested: true };
}

/**
 * Returns true when cancel has been requested. Called by the migration runner.
 */
export function shouldCancel(): boolean {
  return _snapshot.cancelRequested;
}

/**
 * Reset to idle. Only allowed from terminal states (completed / failed / cancelled).
 * Throws otherwise.
 */
export function resetJob(): void {
  const terminal: JobState[] = ["completed", "failed", "cancelled"];
  if (!terminal.includes(_snapshot.state)) {
    throw new Error(
      `Cannot reset: state is '${_snapshot.state}', must be one of: ${terminal.join(", ")}`,
    );
  }
  _snapshot = initialSnapshot();
}

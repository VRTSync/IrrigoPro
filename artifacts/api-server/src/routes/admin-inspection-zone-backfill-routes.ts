// Admin routes for the Inspection Estimate Zone Backfill (Task #1412).
// Super-admin only. Runs the Task #1409 backfill as a background job and
// exposes start / status / cancel / reset endpoints. The client polls /status.
//
// The heavy lifting lives in scripts/backfill-inspection-estimate-zones.ts —
// this module only owns the in-process job lifecycle so a super admin can run
// the backfill against production without shell access.

import type { Express } from "express";
import {
  runBackfill,
  makeDbDeps,
  getBackfillStatus,
  type BackfillResult,
  type BackfillProgressSnapshot,
  type BackfillStatus,
} from "../scripts/backfill-inspection-estimate-zones-core";

// ── In-process job state ────────────────────────────────────────────────────

type JobStateName = "idle" | "running" | "done" | "cancelled" | "error";

interface JobState {
  state: JobStateName;
  dryRun: boolean;
  progress: BackfillProgressSnapshot;
  result: BackfillResult | null;
  logLines: string[];
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  cancelRequested: boolean;
}

const MAX_LOG_LINES = 2000;
const BATCH_SIZE = 50;

let currentJob: JobState | null = null;

function emptyProgress(): BackfillProgressSnapshot {
  return {
    scanned: 0,
    matched: 0,
    matchedDryRun: 0,
    skippedTotalsMismatch: 0,
    skippedNoFindings: 0,
    errors: 0,
  };
}

function publicJob(job: JobState | null) {
  if (!job) {
    return {
      state: "idle" as JobStateName,
      dryRun: true,
      progress: emptyProgress(),
      result: null,
      logLines: [] as string[],
    };
  }
  return {
    state: job.state,
    dryRun: job.dryRun,
    progress: job.progress,
    result: job.result,
    logLines: job.logLines,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function requireSuperAdmin(req: any, res: any): boolean {
  if (req.authenticatedUserRole !== "super_admin") {
    res.status(403).json({ message: "Super admin only" });
    return false;
  }
  return true;
}

// ── Route registration ──────────────────────────────────────────────────────

export function registerInspectionZoneBackfillRoutes(
  app: Express,
  requireAuthentication: any,
): void {
  // POST /api/admin/inspection-zone-backfill/start  Body: { dryRun?: boolean }
  app.post(
    "/api/admin/inspection-zone-backfill/start",
    requireAuthentication,
    (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (currentJob?.state === "running") {
        res.status(409).json({ message: "A backfill job is already running." });
        return;
      }

      // Default to dry-run unless the caller explicitly opts into a live write.
      const dryRun: boolean = req.body?.dryRun !== false;

      const job: JobState = {
        state: "running",
        dryRun,
        progress: emptyProgress(),
        result: null,
        logLines: [],
        startedAt: new Date().toISOString(),
        cancelRequested: false,
      };
      currentJob = job;

      const pushLog = (msg: string) => {
        job.logLines.push(msg);
        if (job.logLines.length > MAX_LOG_LINES) {
          job.logLines.splice(0, job.logLines.length - MAX_LOG_LINES);
        }
      };

      void (async () => {
        try {
          const result = await runBackfill(makeDbDeps(), {
            dryRun,
            batchSize: BATCH_SIZE,
            log: pushLog,
            logError: pushLog,
            onProgress: (snapshot) => {
              job.progress = snapshot;
            },
            cancelSignal: () => job.cancelRequested,
          });
          job.result = result;
          job.state = job.cancelRequested ? "cancelled" : "done";
          job.finishedAt = new Date().toISOString();
        } catch (err: any) {
          job.state = "error";
          job.errorMessage = err?.message ?? String(err);
          job.finishedAt = new Date().toISOString();
        }
      })();

      res.json({ started: true, dryRun });
    },
  );

  // GET /api/admin/inspection-zone-backfill/status
  app.get(
    "/api/admin/inspection-zone-backfill/status",
    requireAuthentication,
    async (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      let persisted: BackfillStatus | { error: string } | null = null;
      try {
        persisted = await getBackfillStatus();
      } catch (err: any) {
        persisted = { error: err?.message ?? "Failed to load persisted status" };
      }

      res.json({ job: publicJob(currentJob), persisted });
    },
  );

  // POST /api/admin/inspection-zone-backfill/cancel
  app.post(
    "/api/admin/inspection-zone-backfill/cancel",
    requireAuthentication,
    (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (!currentJob || currentJob.state !== "running") {
        res.status(409).json({ message: "No running job to cancel." });
        return;
      }

      currentJob.cancelRequested = true;
      res.json({ cancelled: true });
    },
  );

  // POST /api/admin/inspection-zone-backfill/reset
  // Clears the in-process job state (not the persisted done/seen checkpoint)
  // so a new run can start after a crash or a finished run.
  app.post(
    "/api/admin/inspection-zone-backfill/reset",
    requireAuthentication,
    (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (currentJob?.state === "running") {
        res
          .status(409)
          .json({ message: "Cannot reset while a job is running. Cancel it first." });
        return;
      }

      currentJob = null;
      res.json({ reset: true });
    },
  );
}

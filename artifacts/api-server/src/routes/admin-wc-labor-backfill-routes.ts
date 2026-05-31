// Admin routes for WC Labor Backfill (Slice 3).
// Super-admin only. Provides start / status / cancel / reset endpoints.
// The backfill job runs in the background; the client polls /status.

import type { Express } from "express";
import {
  runUnbilledBackfill,
  runInvoicedReport,
  clearCheckpoint,
  type BackfillProgress,
  type InvoicedWcbReport,
} from "../migrations/wc-labor-backfill";

// ── In-process job state ────────────────────────────────────────────────────

interface JobState {
  progress: BackfillProgress;
  cancelRequested: boolean;
  invoicedReport: InvoicedWcbReport[] | null;
}

let currentJob: JobState | null = null;

function requireSuperAdmin(req: any, res: any): boolean {
  if (req.authenticatedUserRole !== "super_admin") {
    res.status(403).json({ message: "Super admin only" });
    return false;
  }
  return true;
}

// ── Route registration ──────────────────────────────────────────────────────

export function registerWcLaborBackfillRoutes(app: Express, requireAuthentication: any): void {
  // POST /api/admin/wc-labor-backfill/start
  // Body: { dryRun?: boolean }
  app.post(
    "/api/admin/wc-labor-backfill/start",
    requireAuthentication,
    (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (currentJob?.progress.state === "running") {
        res.status(409).json({ message: "A backfill job is already running." });
        return;
      }

      const dryRun: boolean = req.body?.dryRun !== false;

      const job: JobState = {
        progress: {
          state: "running",
          scanned: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          dryRun,
          startedAt: new Date().toISOString(),
        },
        cancelRequested: false,
        invoicedReport: null,
      };
      currentJob = job;

      void (async () => {
        try {
          const result = await runUnbilledBackfill({
            dryRun,
            cancelSignal: () => job.cancelRequested,
            onProgress(p) {
              Object.assign(job.progress, p);
            },
          });
          Object.assign(job.progress, result);

          // After Bucket A finishes (unless cancelled), run Bucket B report.
          if (result.state === "done") {
            const invoicedReport = await runInvoicedReport();
            job.invoicedReport = invoicedReport;
            job.progress.invoicedReport = invoicedReport;
          }
        } catch (err: any) {
          job.progress.state = "error";
          job.progress.errorMessage = err?.message ?? String(err);
          job.progress.finishedAt = new Date().toISOString();
        }
      })();

      res.json({ started: true, dryRun });
    },
  );

  // GET /api/admin/wc-labor-backfill/status
  app.get(
    "/api/admin/wc-labor-backfill/status",
    requireAuthentication,
    (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (!currentJob) {
        res.json({
          state: "idle",
          scanned: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          dryRun: true,
        } satisfies BackfillProgress);
        return;
      }

      res.json(currentJob.progress);
    },
  );

  // POST /api/admin/wc-labor-backfill/cancel
  app.post(
    "/api/admin/wc-labor-backfill/cancel",
    requireAuthentication,
    (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (!currentJob || currentJob.progress.state !== "running") {
        res.status(409).json({ message: "No running job to cancel." });
        return;
      }

      currentJob.cancelRequested = true;
      res.json({ cancelled: true });
    },
  );

  // POST /api/admin/wc-labor-backfill/reset
  // Clears the checkpoint so the next run processes all WCBs again.
  app.post(
    "/api/admin/wc-labor-backfill/reset",
    requireAuthentication,
    async (req: any, res: any) => {
      if (!requireSuperAdmin(req, res)) return;

      if (currentJob?.progress.state === "running") {
        res.status(409).json({ message: "Cannot reset while a job is running. Cancel it first." });
        return;
      }

      try {
        await clearCheckpoint();
        currentJob = null;
        res.json({ reset: true });
      } catch (err: any) {
        res.status(500).json({ message: err?.message ?? "Reset failed" });
      }
    },
  );
}

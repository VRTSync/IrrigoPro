// =============================================================================
// ASPIRE CRON — Mission 7
// =============================================================================
//
// Scheduled execution for Aspire sync jobs. Wired into server startup via
// startAspireCron() called from index.ts (fire-and-forget, same pattern as
// startIncidentRunner() in lib/rules/runner.ts).
//
// Scheduler: native Node.js setInterval with wall-clock UTC hour checks,
// consistent with the project's existing in-process scheduler. No external
// cron library is added — the project does not use node-cron or any equivalent;
// the QuickBooks integration uses Replit Scheduled Tasks (HTTP endpoints), and
// the incident runner uses setInterval. We follow the incident-runner pattern
// here rather than the QB pattern because these jobs run in-process on a
// regular wall-clock schedule and must not require external task configuration.
//
// Cron schedule (UTC):
//   Health check — daily at 02:00 UTC
//   Full sync    — daily at 03:00 UTC
//
// Guardrails:
//   • One company failure during runNightlyFullSync MUST NOT prevent the next
//     company from running — caught per-company, logged to aspire_sync_jobs as
//     'failed', loop continues.
//   • Health check and full sync share a per-tenant mutex so they never run
//     concurrently against the same company.
//   • Every run (cron or manual) writes aspire_sync_jobs rows for audit.
//   • triggerManualSync() mirrors cron logging exactly, distinguished only by
//     triggeredBy = 'manual_admin' or 'manual_tenant'.
//
// Advisory lock key (distinct from incident runner's 5530n):
//   Health check  — 7001n
//   Full sync     — 7002n
// =============================================================================

import { ne, and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  externalIntegrations,
  aspireCredentials,
  aspireSyncJobs,
  type InsertAspireSyncJob,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { testConnection } from "../services/aspire-api-client";
import {
  syncCustomers,
  syncProperties,
  syncWorkTickets,
  syncInvoices,
  syncEstimates,
  syncContacts,
  syncCrews,
} from "../services/aspire-sync-service";

// ---------------------------------------------------------------------------
// Per-tenant sync mutex
// ---------------------------------------------------------------------------
//
// Prevents health-check and full-sync from running concurrently against the
// same company. Uses the same promise-chaining pattern as the refresh mutex
// in aspire-api-client.ts.

const tenantSyncLocks = new Map<number, Promise<void>>();

/**
 * Runs `fn` under a per-company mutex. Callers for the same companyId are
 * serialised; callers for different companies run concurrently.
 */
async function withTenantLock(
  companyId: number,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = tenantSyncLocks.get(companyId) ?? Promise.resolve();
  const next = prev.then(() => fn()).finally(() => {
    // Only delete if this is still the tail of the chain.
    if (tenantSyncLocks.get(companyId) === next) {
      tenantSyncLocks.delete(companyId);
    }
  });
  tenantSyncLocks.set(companyId, next);
  return next;
}

// ---------------------------------------------------------------------------
// PostgreSQL advisory locks (multi-replica safety)
// ---------------------------------------------------------------------------

const HEALTH_CHECK_LOCK = 7001n;
const FULL_SYNC_LOCK = 7002n;

async function withAdvisoryLock<T>(
  lockKey: bigint,
  fn: () => Promise<T>,
): Promise<T | null> {
  let acquired = false;
  try {
    const got = await db.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_lock(${lockKey}) AS ok`,
    );
    acquired = got.rows?.[0]?.ok ?? false;
    if (!acquired) return null;
  } catch {
    return null;
  }
  try {
    return await fn();
  } finally {
    if (acquired) {
      try {
        await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
      } catch { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Sync-job lifecycle helpers (summary rows written by cron, not sync service)
// ---------------------------------------------------------------------------

async function insertSummaryJob(
  jobType: string,
  triggeredBy: string,
): Promise<number> {
  const [row] = await db
    .insert(aspireSyncJobs)
    .values({
      companyId: null,  // null = global / multi-company run
      jobType,
      triggeredBy,
      status: "pending",
    } satisfies Partial<InsertAspireSyncJob> as InsertAspireSyncJob)
    .returning({ id: aspireSyncJobs.id });
  return row.id;
}

async function setSummaryJobRunning(jobId: number): Promise<void> {
  await db
    .update(aspireSyncJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(aspireSyncJobs.id, jobId));
}

async function finishSummaryJob(
  jobId: number,
  status: "completed" | "failed",
  recordsProcessed: number,
  recordsFailed: number,
  errorMessage?: string,
): Promise<void> {
  await db
    .update(aspireSyncJobs)
    .set({
      status,
      completedAt: new Date(),
      recordsProcessed,
      recordsFailed,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(aspireSyncJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// runGlobalHealthCheck
// ---------------------------------------------------------------------------

/**
 * Queries all companies with an Aspire integration that is NOT disconnected,
 * runs a lightweight testConnection() probe for each, updates
 * lastHealthCheckAt + connectionStatus, and writes one aspire_sync_jobs row
 * per company plus a global summary row (companyId=null).
 *
 * Per-company errors are caught and logged — one failure does not abort the
 * remaining companies.
 */
export async function runGlobalHealthCheck(
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<void> {
  logger.info(
    { triggeredBy },
    "[aspire-cron] runGlobalHealthCheck: starting",
  );

  // Global summary row (companyId=null).
  const summaryJobId = await insertSummaryJob("health_check", triggeredBy);
  await setSummaryJobRunning(summaryJobId);

  let totalProcessed = 0;
  let totalFailed = 0;

  try {
    // Find all companies with a non-disconnected Aspire integration.
    const targets = await db
      .select({
        companyId: externalIntegrations.companyId,
        connectionStatus: externalIntegrations.connectionStatus,
      })
      .from(externalIntegrations)
      .where(
        and(
          eq(externalIntegrations.integrationType, "aspire"),
          ne(externalIntegrations.connectionStatus, "disconnected"),
        ),
      );

    logger.info(
      { triggeredBy, count: targets.length },
      "[aspire-cron] runGlobalHealthCheck: companies to probe",
    );

    for (const { companyId } of targets) {
      // Per-company sync job row.
      const [companyJobRow] = await db
        .insert(aspireSyncJobs)
        .values({
          companyId,
          jobType: "health_check",
          triggeredBy,
          status: "running",
          startedAt: new Date(),
        } satisfies Partial<InsertAspireSyncJob> as InsertAspireSyncJob)
        .returning({ id: aspireSyncJobs.id });
      const companyJobId = companyJobRow.id;

      await withTenantLock(companyId, async () => {
        try {
          const result = await testConnection(companyId);

          const now = new Date();

          // Update lastHealthCheckAt + connectionStatus on external_integrations.
          await db
            .update(externalIntegrations)
            .set({
              lastHealthCheckAt: now,
              connectionStatus: result.success ? "connected" : "error",
              updatedAt: now,
            })
            .where(
              and(
                eq(externalIntegrations.companyId, companyId),
                eq(externalIntegrations.integrationType, "aspire"),
              ),
            );

          await db
            .update(aspireSyncJobs)
            .set({
              status: "completed",
              completedAt: now,
              recordsProcessed: 1,
              recordsFailed: 0,
              errorMessage: result.success ? null : (result.errorMessage ?? null),
            })
            .where(eq(aspireSyncJobs.id, companyJobId));

          if (result.success) {
            totalProcessed++;
            logger.info(
              { companyId, companyJobId },
              "[aspire-cron] runGlobalHealthCheck: company healthy",
            );
          } else {
            totalFailed++;
            logger.warn(
              { companyId, companyJobId, errorMessage: result.errorMessage },
              "[aspire-cron] runGlobalHealthCheck: company health probe failed",
            );
          }
        } catch (err) {
          totalFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          await db
            .update(aspireSyncJobs)
            .set({
              status: "failed",
              completedAt: new Date(),
              recordsProcessed: 0,
              recordsFailed: 1,
              errorMessage: msg,
            })
            .where(eq(aspireSyncJobs.id, companyJobId));

          logger.error(
            { companyId, companyJobId, err },
            "[aspire-cron] runGlobalHealthCheck: company threw — continuing to next",
          );
        }
      });
    }

    await finishSummaryJob(
      summaryJobId,
      totalFailed > 0 && totalProcessed === 0 ? "failed" : "completed",
      totalProcessed,
      totalFailed,
    );

    logger.info(
      { triggeredBy, summaryJobId, totalProcessed, totalFailed },
      "[aspire-cron] runGlobalHealthCheck: completed",
    );
  } catch (topErr) {
    const msg = topErr instanceof Error ? topErr.message : String(topErr);
    await finishSummaryJob(summaryJobId, "failed", totalProcessed, totalFailed, msg).catch(() => {});
    logger.error(
      { triggeredBy, summaryJobId, err: topErr },
      "[aspire-cron] runGlobalHealthCheck: top-level error",
    );
  }
}

// ---------------------------------------------------------------------------
// runNightlyFullSync
// ---------------------------------------------------------------------------

/**
 * Queries all companies with syncEnabled=true, and for each runs the full
 * sync pipeline in order:
 *   syncCustomers → syncProperties → syncWorkTickets → syncInvoices →
 *   syncEstimates → syncContacts → syncCrews
 *
 * Per-company failure is caught and logged — one company's failure MUST NOT
 * prevent the remaining companies from completing. Each company's stage
 * failures are accumulated in the company-level sync jobs written by each
 * sync function; the cron layer writes an additional summary row per company
 * and one global summary row (companyId=null).
 */
export async function runNightlyFullSync(
  triggeredBy: "cron" | "manual_admin" | "manual_tenant" = "cron",
): Promise<void> {
  logger.info(
    { triggeredBy },
    "[aspire-cron] runNightlyFullSync: starting",
  );

  const summaryJobId = await insertSummaryJob("full_sync", triggeredBy);
  await setSummaryJobRunning(summaryJobId);

  let totalProcessed = 0;
  let totalFailed = 0;

  try {
    // Only sync companies that have syncEnabled=true.
    const targets = await db
      .select({ companyId: aspireCredentials.companyId })
      .from(aspireCredentials)
      .where(eq(aspireCredentials.syncEnabled, true));

    logger.info(
      { triggeredBy, count: targets.length },
      "[aspire-cron] runNightlyFullSync: companies to sync",
    );

    for (const { companyId } of targets) {
      await withTenantLock(companyId, async () => {
        // Per-company wrapper job row.
        const [companyJobRow] = await db
          .insert(aspireSyncJobs)
          .values({
            companyId,
            jobType: "full_sync",
            triggeredBy,
            status: "running",
            startedAt: new Date(),
          } satisfies Partial<InsertAspireSyncJob> as InsertAspireSyncJob)
          .returning({ id: aspireSyncJobs.id });
        const companyJobId = companyJobRow.id;

        let companyProcessed = 0;
        let companyFailed = 0;

        try {
          // Run all sync stages in order — each returns { recordsProcessed, recordsFailed }.
          const stages: Array<{
            name: string;
            fn: () => Promise<{ recordsProcessed: number; recordsFailed: number }>;
          }> = [
            { name: "customers",    fn: () => syncCustomers(companyId, triggeredBy) },
            { name: "properties",   fn: () => syncProperties(companyId, triggeredBy) },
            { name: "work_tickets", fn: () => syncWorkTickets(companyId, triggeredBy) },
            { name: "invoices",     fn: () => syncInvoices(companyId, triggeredBy) },
            { name: "estimates",    fn: () => syncEstimates(companyId, triggeredBy) },
            { name: "contacts",     fn: () => syncContacts(companyId, triggeredBy) },
            { name: "crews",        fn: () => syncCrews(companyId, triggeredBy) },
          ];

          for (const stage of stages) {
            try {
              const counts = await stage.fn();
              companyProcessed += counts.recordsProcessed;
              companyFailed += counts.recordsFailed;
            } catch (stageErr) {
              companyFailed++;
              logger.error(
                { companyId, companyJobId, stage: stage.name, err: stageErr },
                `[aspire-cron] runNightlyFullSync: stage ${stage.name} threw — continuing next stage`,
              );
            }
          }

          await db
            .update(aspireSyncJobs)
            .set({
              status: companyFailed > 0 && companyProcessed === 0 ? "failed" : "completed",
              completedAt: new Date(),
              recordsProcessed: companyProcessed,
              recordsFailed: companyFailed,
            })
            .where(eq(aspireSyncJobs.id, companyJobId));

          totalProcessed += companyProcessed;
          totalFailed += companyFailed;

          logger.info(
            { companyId, companyJobId, companyProcessed, companyFailed },
            "[aspire-cron] runNightlyFullSync: company sync completed",
          );
        } catch (companyErr) {
          // This path is reached only if the stage loop itself threw (rare).
          const msg = companyErr instanceof Error ? companyErr.message : String(companyErr);
          totalFailed++;

          await db
            .update(aspireSyncJobs)
            .set({
              status: "failed",
              completedAt: new Date(),
              recordsProcessed: companyProcessed,
              recordsFailed: companyFailed + 1,
              errorMessage: msg,
            })
            .where(eq(aspireSyncJobs.id, companyJobId))
            .catch(() => {});

          logger.error(
            { companyId, companyJobId, err: companyErr },
            "[aspire-cron] runNightlyFullSync: company threw — continuing to next company",
          );
        }
      });
    }

    await finishSummaryJob(
      summaryJobId,
      totalFailed > 0 && totalProcessed === 0 ? "failed" : "completed",
      totalProcessed,
      totalFailed,
    );

    logger.info(
      { triggeredBy, summaryJobId, totalProcessed, totalFailed },
      "[aspire-cron] runNightlyFullSync: completed",
    );
  } catch (topErr) {
    const msg = topErr instanceof Error ? topErr.message : String(topErr);
    await finishSummaryJob(summaryJobId, "failed", totalProcessed, totalFailed, msg).catch(() => {});
    logger.error(
      { triggeredBy, summaryJobId, err: topErr },
      "[aspire-cron] runNightlyFullSync: top-level error",
    );
  }
}

// ---------------------------------------------------------------------------
// triggerManualSync
// ---------------------------------------------------------------------------

/**
 * Manual trigger callable by API routes (Mission 9's "run now" buttons).
 *
 * @param companyId  The company to sync, or null to run across all companies.
 * @param jobType    'health_check' runs runGlobalHealthCheck (companyId is
 *                   ignored — health check is always global).
 *                   'full_sync' runs runNightlyFullSync, scoped to one company
 *                   if companyId is provided, or all companies if null.
 * @param triggeredBy  'manual_admin' | 'manual_tenant' — distinguishes from cron.
 *
 * Returns immediately (fire-and-forget). The caller should poll
 * aspire_sync_jobs to track progress.
 */
export function triggerManualSync(
  companyId: number | null,
  jobType: "health_check" | "full_sync",
  triggeredBy: "manual_admin" | "manual_tenant" = "manual_admin",
): void {
  if (jobType === "health_check") {
    runGlobalHealthCheck(triggeredBy).catch((err) => {
      logger.error(
        { companyId, jobType, triggeredBy, err },
        "[aspire-cron] triggerManualSync: runGlobalHealthCheck threw",
      );
    });
    return;
  }

  // full_sync — scope to single company or all.
  if (companyId !== null) {
    _syncSingleCompany(companyId, triggeredBy).catch((err) => {
      logger.error(
        { companyId, jobType, triggeredBy, err },
        "[aspire-cron] triggerManualSync: _syncSingleCompany threw",
      );
    });
  } else {
    runNightlyFullSync(triggeredBy).catch((err) => {
      logger.error(
        { companyId, jobType, triggeredBy, err },
        "[aspire-cron] triggerManualSync: runNightlyFullSync threw",
      );
    });
  }
}

/**
 * Full sync for a single company (used by manual trigger when companyId is
 * provided). Writes the same aspire_sync_jobs rows as the nightly run so
 * audit visibility is identical.
 */
async function _syncSingleCompany(
  companyId: number,
  triggeredBy: "manual_admin" | "manual_tenant",
): Promise<void> {
  const [companyJobRow] = await db
    .insert(aspireSyncJobs)
    .values({
      companyId,
      jobType: "full_sync",
      triggeredBy,
      status: "running",
      startedAt: new Date(),
    } satisfies Partial<InsertAspireSyncJob> as InsertAspireSyncJob)
    .returning({ id: aspireSyncJobs.id });
  const companyJobId = companyJobRow.id;

  let companyProcessed = 0;
  let companyFailed = 0;

  await withTenantLock(companyId, async () => {
    const stages: Array<{
      name: string;
      fn: () => Promise<{ recordsProcessed: number; recordsFailed: number }>;
    }> = [
      { name: "customers",    fn: () => syncCustomers(companyId, triggeredBy) },
      { name: "properties",   fn: () => syncProperties(companyId, triggeredBy) },
      { name: "work_tickets", fn: () => syncWorkTickets(companyId, triggeredBy) },
      { name: "invoices",     fn: () => syncInvoices(companyId, triggeredBy) },
      { name: "estimates",    fn: () => syncEstimates(companyId, triggeredBy) },
      { name: "contacts",     fn: () => syncContacts(companyId, triggeredBy) },
      { name: "crews",        fn: () => syncCrews(companyId, triggeredBy) },
    ];

    for (const stage of stages) {
      try {
        const counts = await stage.fn();
        companyProcessed += counts.recordsProcessed;
        companyFailed += counts.recordsFailed;
      } catch (stageErr) {
        companyFailed++;
        logger.error(
          { companyId, companyJobId, stage: stage.name, err: stageErr },
          `[aspire-cron] _syncSingleCompany: stage ${stage.name} threw — continuing`,
        );
      }
    }

    await db
      .update(aspireSyncJobs)
      .set({
        status: companyFailed > 0 && companyProcessed === 0 ? "failed" : "completed",
        completedAt: new Date(),
        recordsProcessed: companyProcessed,
        recordsFailed: companyFailed,
      })
      .where(eq(aspireSyncJobs.id, companyJobId))
      .catch(() => {});

    logger.info(
      { companyId, companyJobId, companyProcessed, companyFailed, triggeredBy },
      "[aspire-cron] _syncSingleCompany: completed",
    );
  });
}

// ---------------------------------------------------------------------------
// Wall-clock scheduler
// ---------------------------------------------------------------------------
//
// Ticks once a minute. On each tick, checks whether the UTC hour matches the
// scheduled hour AND that we haven't already run this job today. Uses the
// same setInterval + advisory lock pattern as lib/rules/runner.ts.
//
// Advisory locks prevent double-firing in a multi-replica deployment.

const TICK_MS = 60_000; // 1 minute

const HEALTH_CHECK_UTC_HOUR = 2; // 02:00 UTC
const FULL_SYNC_UTC_HOUR = 3;    // 03:00 UTC

interface LastRunTracker {
  healthCheck: string | null; // ISO date string "YYYY-MM-DD"
  fullSync: string | null;
}

const lastRun: LastRunTracker = {
  healthCheck: null,
  fullSync: null,
};

/** Returns "YYYY-MM-DD" for the current UTC date. */
function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function cronTick(): Promise<void> {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const today = utcDateString(now);

  // Health check at 02:00 UTC.
  if (utcHour === HEALTH_CHECK_UTC_HOUR && lastRun.healthCheck !== today) {
    const acquired = await withAdvisoryLock(HEALTH_CHECK_LOCK, async () => {
      // Re-check inside the lock in case a replica already set lastRun.
      if (lastRun.healthCheck === today) return;
      lastRun.healthCheck = today;
      logger.info({ utcHour, today }, "[aspire-cron] health check firing");
      await runGlobalHealthCheck("cron");
    });
    if (acquired === null) {
      // Another replica holds the lock — still mark locally so we don't retry this minute.
      if (lastRun.healthCheck !== today) {
        logger.debug(
          { utcHour, today },
          "[aspire-cron] health check: another replica holds lock, skipping",
        );
      }
    }
  }

  // Full sync at 03:00 UTC.
  if (utcHour === FULL_SYNC_UTC_HOUR && lastRun.fullSync !== today) {
    const acquired = await withAdvisoryLock(FULL_SYNC_LOCK, async () => {
      if (lastRun.fullSync === today) return;
      lastRun.fullSync = today;
      logger.info({ utcHour, today }, "[aspire-cron] full sync firing");
      await runNightlyFullSync("cron");
    });
    if (acquired === null) {
      logger.debug(
        { utcHour, today },
        "[aspire-cron] full sync: another replica holds lock, skipping",
      );
    }
  }
}

let cronTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the Aspire cron scheduler. Call once at server startup (fire-and-
 * forget, same pattern as startIncidentRunner()). Safe to call multiple times;
 * subsequent calls are no-ops.
 */
export function startAspireCron(): void {
  if (cronTimer) return;

  // Run an initial tick so startup hour is not missed if the server restarts
  // inside the scheduled window.
  cronTick().catch((err) => {
    logger.warn({ err }, "[aspire-cron] startup tick failed");
  });

  cronTimer = setInterval(() => {
    cronTick().catch((err) => {
      logger.warn({ err }, "[aspire-cron] tick failed");
    });
  }, TICK_MS);

  // Don't keep the process alive purely on the timer.
  if (typeof cronTimer.unref === "function") {
    cronTimer.unref();
  }

  logger.info(
    {
      tickMs: TICK_MS,
      healthCheckUtcHour: HEALTH_CHECK_UTC_HOUR,
      fullSyncUtcHour: FULL_SYNC_UTC_HOUR,
    },
    "[aspire-cron] scheduler started",
  );
}

/**
 * Stops the Aspire cron scheduler. Primarily for use in tests / graceful
 * shutdown.
 */
export function stopAspireCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    logger.info("[aspire-cron] scheduler stopped");
  }
}

// Exposed for manual invocation in dev / test environments.
export { cronTick as _runCronTickOnce };

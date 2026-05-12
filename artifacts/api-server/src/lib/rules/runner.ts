import { sql } from "drizzle-orm";
import { db } from "../../db";
import { incidents, auditLog, type IncidentRow } from "@workspace/db/schema";
import { logger } from "../../logger";
import { ALL_RULES, type Rule, type RuleEvalResult } from "./index";
import { notifyIncidentOpened, notifyIncidentResolved } from "./paging";

// The local Logger uses (message, context, metadata) — adapt to a
// pino-ish shape so the call sites here stay readable.
const log = {
  info(meta: Record<string, unknown>, msg: string) {
    logger.info(msg, "incident-runner", meta);
  },
  warn(meta: Record<string, unknown>, msg: string) {
    logger.warn(msg, "incident-runner", meta);
  },
  debug(msg: string) {
    logger.info(msg, "incident-runner");
  },
};

// Task #553 — App Health Phase 4: Incidents detection engine.
//
// The runner ticks once a minute. For each rule:
//   - Look up the most recent open or mitigated incident keyed by
//     `rule_id`.
//   - If `firing` and no live incident → INSERT a new one + audit
//     `incident.opened`.
//   - If `firing` and a live one exists → bump last_firing_at /
//     fire_count, refresh affected scope; if it was mitigated, flip
//     it back to open with audit `incident.reopened`.
//   - If not firing and an open incident exists:
//       * Set clean_since_at if not already set.
//       * If clean for >= 10m → status='mitigated' + audit
//         `incident.mitigated`.
//   - If not firing and a mitigated incident exists:
//       * If mitigated for >= 30m total → status='resolved' +
//         audit `incident.resolved`.
//
// All evaluations are wrapped in pg_try_advisory_lock so a multi-
// replica deployment doesn't double-fire.

const TICK_MS = 60_000;
const MITIGATE_AFTER_MS = 10 * 60_000;
const RESOLVE_AFTER_MS = 30 * 60_000;
// Distinct from the Phase 1 rollup lock (4242 4242 in routes.ts).
const ADVISORY_LOCK_KEY = 5530n;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let lastDeployHash: string | null = null;

async function withAdvisoryLock<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    const got = await db.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS ok`,
    );
    if (!got.rows?.[0]?.ok) return null;
  } catch {
    return null;
  }
  try {
    return await fn();
  } finally {
    try { await db.execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`); } catch { /* ignore */ }
  }
}

async function recordTransition(
  incident: IncidentRow,
  action: "incident.opened" | "incident.mitigated" | "incident.resolved" | "incident.reopened",
  severity: "info" | "warning" | "error" | "critical",
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actionType: "system",
      action,
      severity,
      targetType: "incident",
      targetId: String(incident.id),
      summary: `${action.replace("incident.", "")}: ${incident.summary}`,
      details: {
        ruleId: incident.ruleId,
        severity: incident.severity,
        incidentId: incident.id,
      },
    });
  } catch (err) {
    log.warn({ err, incidentId: incident.id, action }, "incident audit write failed");
  }
}

async function evaluateRule(rule: Rule, now: Date): Promise<void> {
  let result: RuleEvalResult;
  try {
    result = await rule.evaluate(now);
  } catch (err) {
    log.warn({ err, ruleId: rule.id }, "rule evaluation threw");
    return;
  }

  // Look up the active (open or mitigated) incident for this rule.
  // NOTE: raw `db.execute` returns column names as-is from Postgres (snake_case),
  // so we must alias every camelCase field the state machine reads below —
  // otherwise `live.cleanSinceAt` / `live.fireCount` / etc. silently come back
  // as `undefined` and the open→mitigated→resolved transitions never fire.
  const liveRes = await db.execute<IncidentRow>(sql`
    SELECT id,
           rule_id          AS "ruleId",
           severity,
           status,
           summary,
           started_at       AS "startedAt",
           last_firing_at   AS "lastFiringAt",
           clean_since_at   AS "cleanSinceAt",
           mitigated_at     AS "mitigatedAt",
           resolved_at      AS "resolvedAt",
           affected_companies AS "affectedCompanies",
           affected_users     AS "affectedUsers",
           details,
           fire_count       AS "fireCount"
    FROM incidents
    WHERE rule_id = ${rule.id} AND status IN ('open','mitigated')
    ORDER BY started_at DESC
    LIMIT 1
  `);
  // Raw `db.execute` skips drizzle/pg-types parsers, so timestamp columns
  // arrive as strings. Re-hydrate them so the comparisons below
  // (`cleanSince.getTime()` etc.) don't blow up.
  const liveRaw = liveRes.rows?.[0] ?? null;
  const live: IncidentRow | null = liveRaw
    ? {
        ...(liveRaw as IncidentRow),
        startedAt: liveRaw.startedAt ? new Date(liveRaw.startedAt as unknown as string) : liveRaw.startedAt,
        lastFiringAt: liveRaw.lastFiringAt ? new Date(liveRaw.lastFiringAt as unknown as string) : liveRaw.lastFiringAt,
        cleanSinceAt: liveRaw.cleanSinceAt ? new Date(liveRaw.cleanSinceAt as unknown as string) : null,
        mitigatedAt: liveRaw.mitigatedAt ? new Date(liveRaw.mitigatedAt as unknown as string) : null,
        resolvedAt: liveRaw.resolvedAt ? new Date(liveRaw.resolvedAt as unknown as string) : null,
      }
    : null;

  if (result.firing) {
    // Side-effects (e.g. lockout) before the state machine — they
    // must run on every tick that the rule is firing, regardless of
    // whether we just opened the incident.
    if (rule.onFire) {
      try { await rule.onFire(result); }
      catch (err) { log.warn({ err, ruleId: rule.id }, "rule onFire threw"); }
    }

    if (!live) {
      const inserted = await db
        .insert(incidents)
        .values({
          ruleId: rule.id,
          severity: rule.severity,
          status: "open",
          trigger: "auto",
          summary: result.summary,
          // Per-instance runbook (e.g. service-specific for
          // integration_down) takes precedence over the rule-level
          // fallback so the banner's "Runbook" link is meaningful.
          runbookUrl: result.runbookUrl ?? rule.runbookUrl,
          startedAt: now,
          lastFiringAt: now,
          affectedCompanies: result.affectedCompanies ?? [],
          affectedUsers: result.affectedUsers ?? [],
          details: result.details ?? null,
          fireCount: 1,
        })
        .returning();
      const row = inserted[0];
      if (row) {
        await recordTransition(row, "incident.opened",
          rule.severity === "P1" ? "critical" : rule.severity === "P2" ? "error" : "warning");
        log.warn({ ruleId: rule.id, incidentId: row.id, severity: rule.severity }, "incident opened");
        // Task #569 — page on-call (PagerDuty / Slack) when a fresh
        // incident opens. Severity gating + integration enablement
        // are handled inside notifyIncidentOpened.
        try { await notifyIncidentOpened(row, rule); }
        catch (err) { log.warn({ err, incidentId: row.id }, "paging on open failed"); }
      }
    } else if (live.status === "mitigated") {
      // Re-fire — flip back to open.
      const updated = await db
        .update(incidents)
        .set({
          status: "open",
          summary: result.summary,
          runbookUrl: result.runbookUrl ?? live.runbookUrl ?? rule.runbookUrl,
          lastFiringAt: now,
          cleanSinceAt: null,
          mitigatedAt: null,
          fireCount: (live.fireCount ?? 1) + 1,
          affectedCompanies: result.affectedCompanies ?? live.affectedCompanies ?? [],
          affectedUsers: result.affectedUsers ?? live.affectedUsers ?? [],
          details: result.details ?? live.details ?? null,
        })
        .where(sql`id = ${live.id}`)
        .returning();
      const row = updated[0];
      if (row) {
        await recordTransition(row, "incident.reopened", "warning");
        // Task #569 — a reopened incident needs to re-page on-call.
        // PagerDuty's Events API is idempotent on dedup_key, so a
        // trigger after a manual resolve will create a fresh alert.
        try { await notifyIncidentOpened(row, rule); }
        catch (err) { log.warn({ err, incidentId: row.id }, "paging on reopen failed"); }
      }
    } else {
      // Still open — refresh in place.
      await db
        .update(incidents)
        .set({
          summary: result.summary,
          runbookUrl: result.runbookUrl ?? live.runbookUrl ?? rule.runbookUrl,
          lastFiringAt: now,
          cleanSinceAt: null,
          fireCount: (live.fireCount ?? 1) + 1,
          affectedCompanies: result.affectedCompanies ?? live.affectedCompanies ?? [],
          affectedUsers: result.affectedUsers ?? live.affectedUsers ?? [],
          details: result.details ?? live.details ?? null,
        })
        .where(sql`id = ${live.id}`);
    }
  } else {
    // Not firing — cooldown / state transitions only.
    if (!live) return;

    if (live.status === "open") {
      const cleanSince = live.cleanSinceAt ?? now;
      const cleanForMs = now.getTime() - cleanSince.getTime();
      if (live.cleanSinceAt == null) {
        await db
          .update(incidents)
          .set({ cleanSinceAt: now })
          .where(sql`id = ${live.id}`);
      } else if (cleanForMs >= MITIGATE_AFTER_MS) {
        const updated = await db
          .update(incidents)
          .set({ status: "mitigated", mitigatedAt: now })
          .where(sql`id = ${live.id}`)
          .returning();
        const row = updated[0];
        if (row) await recordTransition(row, "incident.mitigated", "info");
      }
    } else if (live.status === "mitigated") {
      const mitigatedAt = live.mitigatedAt ?? now;
      const mitigatedForMs = now.getTime() - mitigatedAt.getTime();
      if (mitigatedForMs >= RESOLVE_AFTER_MS - MITIGATE_AFTER_MS) {
        // Total clean window = MITIGATE + this extra is RESOLVE_AFTER.
        const updated = await db
          .update(incidents)
          .set({ status: "resolved", resolvedAt: now })
          .where(sql`id = ${live.id}`)
          .returning();
        const row = updated[0];
        if (row) {
          await recordTransition(row, "incident.resolved", "info");
          // Task #569 — close the page in PagerDuty / Slack once
          // the incident has stayed clean through the cooldown.
          try { await notifyIncidentResolved(row, rule); }
          catch (err) { log.warn({ err, incidentId: row.id }, "paging on resolve failed"); }
        }
      }
    }
  }
}

// --------------------------------------------------------------------
// Deploy detection. We don't have a hard deploy hook, so we treat the
// app_version reported on the very first incoming client error of a
// boot/build as the deploy event. Persisted in app_settings so we
// don't re-fire on every restart of the same build.
// --------------------------------------------------------------------
async function maybeRecordDeploy(now: Date): Promise<void> {
  // Look for any app_version that first appeared in client_errors in
  // the last 10 minutes and that we haven't audited yet.
  try {
    const r = await db.execute<{ appVersion: string; firstSeen: string }>(sql`
      SELECT app_version AS "appVersion", MIN(occurred_at)::text AS "firstSeen"
      FROM client_errors
      WHERE app_version IS NOT NULL
      GROUP BY app_version
      HAVING MIN(occurred_at) >= now() - interval '10 minutes'
      ORDER BY MIN(occurred_at) DESC
      LIMIT 5
    `);
    const candidates = r.rows ?? [];
    for (const cand of candidates) {
      if (cand.appVersion === lastDeployHash) continue;
      // Has this version already been recorded as a deploy?
      const existing = await db.execute<{ c: number }>(sql`
        SELECT COUNT(*)::int AS c FROM audit_log
        WHERE action = 'deploy.production'
          AND details->>'appVersion' = ${cand.appVersion}
      `);
      if ((existing.rows?.[0]?.c ?? 0) > 0) {
        lastDeployHash = cand.appVersion;
        continue;
      }
      await db.insert(auditLog).values({
        occurredAt: new Date(cand.firstSeen),
        actionType: "system",
        action: "deploy.production",
        severity: "info",
        summary: `Production deploy detected — build ${cand.appVersion.slice(0, 10)}`,
        details: { appVersion: cand.appVersion, detectedAt: now.toISOString() },
      });
      lastDeployHash = cand.appVersion;
      log.info({ appVersion: cand.appVersion }, "deploy.production audit row written");
    }
  } catch (err) {
    log.warn({ err }, "deploy detection failed");
  }
}

async function tick(): Promise<void> {
  const result = await withAdvisoryLock(async () => {
    const now = new Date();
    await maybeRecordDeploy(now);
    for (const rule of ALL_RULES) {
      await evaluateRule(rule, now);
    }
    return true;
  });
  if (result == null) {
    log.debug("incident-runner: another replica holds the advisory lock");
  }
}

export function startIncidentRunner(): void {
  if (tickTimer) return;
  // Run a tick on boot, then every minute.
  tick().catch((err) => log.warn({ err }, "incident runner first tick failed"));
  tickTimer = setInterval(() => {
    tick().catch((err) => log.warn({ err }, "incident runner tick failed"));
  }, TICK_MS);
  // Don't keep the process alive purely on the timer.
  if (typeof tickTimer.unref === "function") tickTimer.unref();
  log.info({ tickMs: TICK_MS, ruleCount: ALL_RULES.length }, "incident runner started");
}

export function stopIncidentRunner(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// Exposed for tests / manual ad-hoc evaluation.
export { tick as runIncidentRunnerOnce };
export {
  evaluateRule,
  withAdvisoryLock,
  ADVISORY_LOCK_KEY,
  MITIGATE_AFTER_MS,
  RESOLVE_AFTER_MS,
};

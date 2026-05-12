import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// Folds in Task #548: when a `deploy.production` audit row appears,
// watch for any new fingerprint reaching > 5 distinct users within
// the next 30 minutes. Mark the matching `app_event_groups` rows
// `is_regression=true` so the Phase 1 Crashes table renders the
// REGRESSION badge, and open a P2 incident.
const DEPLOY_WINDOW_MIN = 30;
const USER_THRESHOLD = 5;

export const regressionAfterDeployRule: Rule = {
  id: "regression_after_deploy",
  severity: "P2",
  runbookUrl: runbook("regression_after_deploy"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    try {
      // Most recent production deploy in the last 30m, if any.
      const deployRes = await db.execute<{ occurredAt: string; details: unknown }>(sql`
        SELECT occurred_at::text AS "occurredAt", details
        FROM audit_log
        WHERE action = 'deploy.production'
          AND occurred_at >= now() - interval '${sql.raw(String(DEPLOY_WINDOW_MIN))} minutes'
        ORDER BY occurred_at DESC
        LIMIT 1
      `);
      const deploy = deployRes.rows?.[0];
      if (!deploy) {
        return { firing: false, summary: "No recent production deploy" };
      }
      const deployedAt = new Date(deploy.occurredAt);

      // Fingerprints whose first_seen_at is after the deploy and have
      // already crossed the user threshold. These are the regressions.
      const regs = await db.execute<{
        fingerprint: string; name: string; sampleMessage: string | null; userCount: number; eventCount: number;
      }>(sql`
        SELECT g.fingerprint, g.name, g.sample_message AS "sampleMessage",
               g.user_count AS "userCount", g.event_count AS "eventCount"
        FROM app_event_groups g
        WHERE g.first_seen_at >= ${deployedAt}
          AND g.user_count > ${USER_THRESHOLD}
          AND g.severity IN ('error','fatal')
        ORDER BY g.user_count DESC, g.event_count DESC
        LIMIT 10
      `);
      const rows = regs.rows ?? [];
      const firing = rows.length > 0;

      if (firing) {
        // Flag every regression group so the Crashes badge lights up.
        // NOTE: drizzle's sql template expands a JS array as a list of
        // placeholders (`$1, $2, ...`), so `ANY($1::text[])` doesn't work
        // here — we have to build an `IN (...)` list with sql.join instead.
        const fingerprints = rows.map((r) => r.fingerprint);
        try {
          await db.execute(sql`
            UPDATE app_event_groups
            SET is_regression = true, updated_at = now()
            WHERE fingerprint IN (${sql.join(fingerprints.map((f) => sql`${f}`), sql`, `)})
              AND is_regression = false
          `);
        } catch { /* best-effort */ }
      }

      const top = rows[0];
      return {
        firing,
        summary: firing
          ? `Regression after deploy — ${rows.length} new fingerprint${rows.length === 1 ? "" : "s"} (top: "${top.name}" ${top.userCount} users)`
          : "No regressions detected post-deploy",
        details: {
          deployedAt: deploy.occurredAt,
          deployDetails: deploy.details,
          regressions: rows.map((r) => ({
            fingerprint: r.fingerprint,
            name: r.name,
            sampleMessage: r.sampleMessage,
            userCount: r.userCount,
            eventCount: r.eventCount,
          })),
          userThreshold: USER_THRESHOLD,
          windowMin: DEPLOY_WINDOW_MIN,
        },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

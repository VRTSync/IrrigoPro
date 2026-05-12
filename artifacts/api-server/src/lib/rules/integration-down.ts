import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// > 5 integration failure events in the last 10 minutes for any
// single integration (QuickBooks, email, Twilio, object storage, …).
// Backed by `integration.<name>.failed` events emitted by withTelemetry
// and the QuickBooks token utils.
const WINDOW_MIN = 10;
const FAIL_THRESHOLD = 5;

export const integrationDownRule: Rule = {
  id: "integration_down",
  severity: "P2",
  runbookUrl: runbook("integration_down"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      const r = await db.execute<{ name: string; c: number }>(sql`
        SELECT name, COUNT(*)::int AS c
        FROM client_errors
        WHERE occurred_at >= ${since}
          AND source = 'integration'
          AND (severity IN ('error','fatal') OR name LIKE '%.failed')
        GROUP BY name
        HAVING COUNT(*) > ${FAIL_THRESHOLD}
        ORDER BY c DESC
        LIMIT 5
      `);
      const breaches = r.rows ?? [];
      const firing = breaches.length > 0;
      const top = breaches[0];
      return {
        firing,
        summary: firing
          ? `Integration ${top.name} failing — ${top.c} errors in ${WINDOW_MIN}m`
          : "Integrations healthy",
        details: {
          breaches: breaches.map((b) => ({ name: b.name, count: b.c })),
          threshold: FAIL_THRESHOLD,
          windowMin: WINDOW_MIN,
        },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

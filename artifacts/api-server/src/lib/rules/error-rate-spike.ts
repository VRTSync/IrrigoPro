import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// 5xx error rate above 2% over the last 10 minutes, with at least
// 50 sampled requests. We have two independent signals:
//   - access-log buffer (process-local, freshest data)
//   - http.5xx events emitted to client_errors by withTelemetry
// We use the persistent client_errors signal here so the rule survives
// process restarts and works across replicas.
const WINDOW_MIN = 10;
const MIN_REQUESTS = 50;
const THRESHOLD_PCT = 2;

export const errorRateSpikeRule: Rule = {
  id: "error_rate_spike",
  severity: "P2",
  runbookUrl: runbook("error_rate_spike"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      const r = await db.execute<{ requests: number; errors: number }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE name IN ('http.ok','http.5xx','http.4xx','http.slow'))::int AS requests,
          COUNT(*) FILTER (WHERE name = 'http.5xx')::int AS errors
        FROM client_errors WHERE occurred_at >= ${since}
      `);
      const requests = r.rows?.[0]?.requests ?? 0;
      const errors = r.rows?.[0]?.errors ?? 0;
      if (requests < MIN_REQUESTS) {
        return { firing: false, summary: "API error rate within bounds" };
      }
      const pct = (errors / requests) * 100;
      const firing = pct > THRESHOLD_PCT;
      return {
        firing,
        summary: firing
          ? `API 5xx rate at ${pct.toFixed(2)}% (${errors}/${requests}, threshold ${THRESHOLD_PCT}%)`
          : "API error rate within bounds",
        details: { requests, errors, pct: Math.round(pct * 100) / 100, thresholdPct: THRESHOLD_PCT, windowMin: WINDOW_MIN },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

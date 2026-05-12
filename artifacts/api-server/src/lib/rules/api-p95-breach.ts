import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// API p95 > 2000ms over the last 10 minutes. Backed by the
// `http.slow` events emitted by the request telemetry middleware.
// We require at least 20 slow samples to call it a breach so a
// single one-off doesn't trip us.
const WINDOW_MIN = 10;
const MIN_SAMPLES = 20;
const THRESHOLD_MS = 2000;

export const apiP95BreachRule: Rule = {
  id: "api_p95_breach",
  severity: "P2",
  runbookUrl: runbook("api_p95_breach"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      const r = await db.execute<{ p95: number | null; samples: number }>(sql`
        SELECT
          percentile_disc(0.95) WITHIN GROUP (
            ORDER BY (context->>'duration_ms')::int
          )::int AS p95,
          COUNT(*)::int AS samples
        FROM client_errors
        WHERE name = 'http.slow'
          AND occurred_at >= ${since}
          AND (context->>'duration_ms') ~ '^\\d+$'
      `);
      const p95 = r.rows?.[0]?.p95 ?? null;
      const samples = r.rows?.[0]?.samples ?? 0;
      if (samples < MIN_SAMPLES || p95 == null) {
        return { firing: false, summary: "API latency within SLO" };
      }
      const firing = p95 > THRESHOLD_MS;
      return {
        firing,
        summary: firing
          ? `API p95 at ${p95}ms (threshold ${THRESHOLD_MS}ms, ${samples} slow samples)`
          : "API latency within SLO",
        details: { p95Ms: p95, samples, thresholdMs: THRESHOLD_MS, windowMin: WINDOW_MIN },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

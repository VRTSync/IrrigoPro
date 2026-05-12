import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";
import { getIntegrationMeta, serviceFromEventName } from "../integration-catalog";

// > 5 integration failure events in the last 10 minutes for any
// single integration (QuickBooks, email, Twilio, object storage, …).
// Backed by `integration.<name>.failed` events emitted by withTelemetry
// and the QuickBooks token utils.
const WINDOW_MIN = 10;
const FAIL_THRESHOLD = 5;

export const integrationDownRule: Rule = {
  id: "integration_down",
  severity: "P2",
  // Rule-level fallback runbook only — the per-instance incident
  // surfaces the *service-specific* runbook URL via
  // `RuleEvalResult.runbookUrl` (Task #554 — review fix).
  runbookUrl: runbook("integration_down"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      const r = await db.execute<{ name: string; component: string | null; c: number }>(sql`
        SELECT name,
               MAX(component) AS component,
               COUNT(*)::int AS c
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
      if (!firing) {
        return { firing: false, summary: "Integrations healthy" };
      }
      const top = breaches[0];
      // Prefer the leading segment of `component` (the structured
      // service tag we stamp on telemetry events) and fall back to
      // the event name when `component` is null on legacy rows.
      const topService = top.component
        ? serviceFromEventName(top.component)
        : serviceFromEventName(top.name);
      const meta = getIntegrationMeta(topService);
      const enriched = breaches.map((b) => {
        const svc = b.component ? serviceFromEventName(b.component) : serviceFromEventName(b.name);
        const m = getIntegrationMeta(svc);
        return { name: b.name, service: svc, label: m.label, runbookUrl: m.runbookUrl, count: b.c };
      });
      return {
        firing,
        // Service-first summary so the active-incidents banner is
        // immediately actionable without expanding the row.
        summary: `${meta.label} integration failing — ${top.c} ${top.name} errors in ${WINDOW_MIN}m`,
        // Per-instance runbook URL the runner persists onto the
        // incident row (instead of the rule-level fallback). The
        // banner's "Runbook" link now goes straight to the failing
        // service's playbook.
        runbookUrl: meta.runbookUrl,
        details: {
          service: topService,
          serviceLabel: meta.label,
          breaches: enriched,
          threshold: FAIL_THRESHOLD,
          windowMin: WINDOW_MIN,
        },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

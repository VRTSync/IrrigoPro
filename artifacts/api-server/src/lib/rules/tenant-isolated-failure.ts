import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// One tenant's error rate is more than 5x the cross-tenant average,
// with at least 20 errors in the last 30 minutes from that tenant.
const WINDOW_MIN = 30;
const MIN_TENANT_ERRORS = 20;
const RATIO_THRESHOLD = 5;

export const tenantIsolatedFailureRule: Rule = {
  id: "tenant_isolated_failure",
  severity: "P3",
  runbookUrl: runbook("tenant_isolated_failure"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      const r = await db.execute<{ companyId: number | null; c: number }>(sql`
        SELECT company_id AS "companyId", COUNT(*)::int AS c
        FROM client_errors
        WHERE occurred_at >= ${since}
          AND severity IN ('error','fatal')
          AND company_id IS NOT NULL
        GROUP BY company_id
        ORDER BY c DESC
      `);
      const rows = r.rows ?? [];
      if (rows.length < 2) {
        return { firing: false, summary: "Errors evenly distributed across tenants" };
      }
      const totals = rows.map((x) => x.c);
      const sum = totals.reduce((a, b) => a + b, 0);
      const tenantCount = rows.length;
      const avg = sum / tenantCount;
      // Find tenants whose volume is both well above the floor and a
      // multiple of the cross-tenant average.
      const breaches = rows
        .filter((x) => x.c >= MIN_TENANT_ERRORS && avg > 0 && x.c >= RATIO_THRESHOLD * avg)
        .slice(0, 5);
      const firing = breaches.length > 0;
      const companies = breaches.map((b) => b.companyId).filter((n): n is number => n != null);
      const top = breaches[0];
      return {
        firing,
        summary: firing
          ? `Tenant ${top.companyId} producing ${top.c} errors (${(top.c / avg).toFixed(1)}x cross-tenant avg)`
          : "Errors evenly distributed across tenants",
        affectedCompanies: companies,
        details: {
          breaches: breaches.map((b) => ({ companyId: b.companyId, errors: b.c, ratio: Math.round((b.c / avg) * 10) / 10 })),
          avgPerTenant: Math.round(avg * 10) / 10,
          ratioThreshold: RATIO_THRESHOLD,
          minErrors: MIN_TENANT_ERRORS,
          windowMin: WINDOW_MIN,
        },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

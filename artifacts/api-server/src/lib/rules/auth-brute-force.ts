import { sql } from "drizzle-orm";
import { db } from "../../db";
import { auditLog } from "@workspace/db/schema";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// > 10 failed logins for a single user in the last 10 minutes. We
// also auto-lock the user via an `auth.lockout` audit row — the
// existing Users tab already reads that as the "locked" status.
const WINDOW_MIN = 10;
const FAIL_THRESHOLD = 10;

export const authBruteForceRule: Rule = {
  id: "auth_brute_force",
  severity: "P3",
  runbookUrl: runbook("auth_brute_force"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      // Group failed logins by the actor (preferring user_id, falling
      // back to actor_label for unknown-username attempts).
      const r = await db.execute<{
        actorUserId: number | null; actorLabel: string | null; companyId: number | null; c: number;
      }>(sql`
        SELECT actor_user_id AS "actorUserId",
               actor_label AS "actorLabel",
               actor_company_id AS "companyId",
               COUNT(*)::int AS c
        FROM audit_log
        WHERE action = 'auth.login_failed'
          AND occurred_at >= ${since}
        GROUP BY actor_user_id, actor_label, actor_company_id
        HAVING COUNT(*) > ${FAIL_THRESHOLD}
        ORDER BY c DESC
        LIMIT 25
      `);
      const breaches = r.rows ?? [];
      const firing = breaches.length > 0;
      const users = breaches.map((b) => b.actorUserId).filter((n): n is number => n != null);
      const companies = Array.from(new Set(breaches.map((b) => b.companyId).filter((n): n is number => n != null)));
      const top = breaches[0];
      return {
        firing,
        summary: firing
          ? `Brute-force suspected — ${breaches.length} account(s) over ${FAIL_THRESHOLD} fails (top: ${top.actorLabel ?? `user ${top.actorUserId}`} ${top.c}x)`
          : "No brute-force activity",
        affectedUsers: users,
        affectedCompanies: companies,
        details: {
          breaches: breaches.map((b) => ({
            userId: b.actorUserId,
            label: b.actorLabel,
            failedCount: b.c,
          })),
          threshold: FAIL_THRESHOLD,
          windowMin: WINDOW_MIN,
        },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
  async onFire(result): Promise<void> {
    // Lock every account that crossed the threshold by writing the
    // `auth.lockout` audit row the Users tab already reads. We dedupe
    // on a 10-minute window so we don't spam the log every tick the
    // rule keeps firing.
    const breaches = (result.details?.breaches ?? []) as Array<{
      userId: number | null; label: string | null; failedCount: number;
    }>;
    if (breaches.length === 0) return;
    for (const b of breaches) {
      try {
        const existing = await db.execute<{ c: number }>(sql`
          SELECT COUNT(*)::int AS c FROM audit_log
          WHERE action = 'auth.lockout'
            AND occurred_at >= now() - interval '10 minutes'
            AND ${b.userId == null
              ? sql`actor_label = ${b.label ?? ""}`
              : sql`actor_user_id = ${b.userId}`}
        `);
        if ((existing.rows?.[0]?.c ?? 0) > 0) continue;
        await db.insert(auditLog).values({
          actorUserId: b.userId ?? null,
          actorLabel: b.label ?? null,
          actionType: "auth",
          action: "auth.lockout",
          severity: "warning",
          summary: `Auto-locked after ${b.failedCount} failed logins in 10m`,
          details: { ruleId: "auth_brute_force", failedCount: b.failedCount },
        });
      } catch { /* best-effort lockout */ }
    }
  },
};

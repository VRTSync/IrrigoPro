import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// More than 5 in-progress field work sessions older than 1h means the
// offline queue isn't draining for some techs.
const STUCK_THRESHOLD = 5;

export const syncQueueStuckRule: Rule = {
  id: "sync_queue_stuck",
  severity: "P3",
  runbookUrl: runbook("sync_queue_stuck"),
  async evaluate(): Promise<RuleEvalResult> {
    try {
      const r = await db.execute<{ stuck: number }>(sql`
        SELECT COUNT(*) FILTER (
          WHERE status = 'in-progress' AND start_time < now() - interval '1 hour'
        )::int AS stuck
        FROM field_work_sessions
      `);
      const stuck = r.rows?.[0]?.stuck ?? 0;
      const firing = stuck > STUCK_THRESHOLD;
      let users: number[] = [];
      if (firing) {
        const u = await db.execute<{ userId: number | null }>(sql`
          SELECT DISTINCT u.id AS "userId"
          FROM field_work_sessions s
          LEFT JOIN users u ON u.username = s.clock_number OR CAST(u.id AS text) = s.clock_number
          WHERE s.status = 'in-progress' AND s.start_time < now() - interval '1 hour'
          LIMIT 100
        `);
        users = Array.from(new Set((u.rows ?? []).map((r) => r.userId).filter((n): n is number => n != null)));
      }
      return {
        firing,
        summary: firing
          ? `${stuck} sync sessions stuck > 1h (threshold ${STUCK_THRESHOLD})`
          : "Sync queue draining normally",
        affectedUsers: users,
        details: { stuck, threshold: STUCK_THRESHOLD },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

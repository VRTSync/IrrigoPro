import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { Rule, RuleEvalResult } from "./types";
import { runbook } from "./types";

// > 5% upload-failure rate over the last 10 minutes (provided we have
// at least 20 attempts to keep the signal-to-noise sane). The
// threshold is overridable through APP_HEALTH_PHOTO_FAIL_PCT for the
// spec smoke-test (Phase 4, step 7).
const WINDOW_MIN = 10;
const MIN_ATTEMPTS = 20;
function thresholdPct(): number {
  const raw = process.env.APP_HEALTH_PHOTO_FAIL_PCT;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 5;
}

export const photoUploadFailureRateRule: Rule = {
  id: "photo_upload_failure_rate",
  severity: "P2",
  runbookUrl: runbook("photo_upload_failure_rate"),
  async evaluate(now: Date): Promise<RuleEvalResult> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60_000);
    try {
      // Prefer per-step events — they're the authoritative pipeline
      // signal. Fall back to the legacy `photo.upload.{ok,failed}`
      // rollups when no step events have fired (older clients).
      const r = await db.execute<{ ok: number; failed: number }>(sql`
        WITH steps AS (
          SELECT
            COUNT(*) FILTER (WHERE name LIKE 'photo.upload.%.ok' AND name <> 'photo.upload.ok')::int AS ok,
            COUNT(*) FILTER (WHERE name LIKE 'photo.upload.%.failed' AND name <> 'photo.upload.failed')::int AS failed
          FROM client_errors WHERE occurred_at >= ${since}
            AND name LIKE 'photo.upload.%'
        ),
        legacy AS (
          SELECT
            COUNT(*) FILTER (WHERE name = 'photo.upload.ok')::int AS ok,
            COUNT(*) FILTER (WHERE name = 'photo.upload.failed')::int AS failed
          FROM client_errors WHERE occurred_at >= ${since}
        )
        SELECT
          CASE WHEN (SELECT ok+failed FROM steps) > 0 THEN (SELECT ok FROM steps) ELSE (SELECT ok FROM legacy) END AS ok,
          CASE WHEN (SELECT ok+failed FROM steps) > 0 THEN (SELECT failed FROM steps) ELSE (SELECT failed FROM legacy) END AS failed
      `);
      const ok = r.rows?.[0]?.ok ?? 0;
      const failed = r.rows?.[0]?.failed ?? 0;
      const total = ok + failed;
      if (total < MIN_ATTEMPTS) {
        return { firing: false, summary: "Photo upload pipeline healthy" };
      }
      const failPct = (failed / total) * 100;
      const threshold = thresholdPct();
      const firing = failPct > threshold;

      let companies: number[] = [];
      let users: number[] = [];
      if (firing) {
        const scope = await db.execute<{ companyId: number | null; userId: number | null }>(sql`
          SELECT DISTINCT company_id AS "companyId", user_id AS "userId"
          FROM client_errors
          WHERE occurred_at >= ${since}
            AND name LIKE 'photo.upload.%.failed'
          LIMIT 200
        `);
        companies = Array.from(new Set((scope.rows ?? []).map((r) => r.companyId).filter((n): n is number => n != null)));
        users = Array.from(new Set((scope.rows ?? []).map((r) => r.userId).filter((n): n is number => n != null)));
      }

      return {
        firing,
        summary: firing
          ? `Photo upload failures at ${failPct.toFixed(1)}% (${failed}/${total}, threshold ${threshold}%)`
          : "Photo upload pipeline healthy",
        affectedCompanies: companies,
        affectedUsers: users,
        details: { ok, failed, total, failPct: Math.round(failPct * 10) / 10, thresholdPct: threshold, windowMin: WINDOW_MIN },
      };
    } catch {
      return { firing: false, summary: "" };
    }
  },
};

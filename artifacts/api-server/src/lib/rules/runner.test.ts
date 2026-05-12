// Task #571 — runner state-machine coverage. Drives the real
// `evaluateRule` against the dev DB with a stub Rule whose firing
// state we control tick-by-tick, asserting:
//   1. firing & no live incident       → INSERT open + audit `incident.opened`
//   2. clean → cleanSinceAt set        (no transition yet)
//   3. clean ≥ 10m                      → status=mitigated + audit `incident.mitigated`
//   4. firing while mitigated           → status=open  + audit `incident.reopened`
//   5. clean ≥ 30m total                → status=resolved + audit `incident.resolved`
//   6. fires again after resolved       → fresh open incident (resolved row left alone)
//   7. withAdvisoryLock — second caller (separate connection) gets null
//
// Each transition is observable through the `audit_log` action_type='system'
// rows that recordTransition() writes, so the test asserts both the
// `incidents` row state AND that the audit trail was emitted.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { db } from "../../db";
import {
  evaluateRule,
  withAdvisoryLock,
  ADVISORY_LOCK_KEY,
  MITIGATE_AFTER_MS,
  RESOLVE_AFTER_MS,
} from "./runner";
import type { Rule, RuleEvalResult } from "./types";

const TAG = `t571r-${randomUUID()}`;
const RULE_ID = `__test_rule_${TAG}`;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM incidents WHERE rule_id = ${RULE_ID}`);
  await db.execute(sql`
    DELETE FROM audit_log WHERE target_type = 'incident'
      AND details->>'ruleId' = ${RULE_ID}
  `);
}

before(cleanup);
after(cleanup);

function stubRule(state: { firing: boolean; summary?: string }): Rule {
  return {
    id: RULE_ID,
    severity: "P3",
    runbookUrl: "https://example.test/runbook",
    async evaluate(): Promise<RuleEvalResult> {
      return {
        firing: state.firing,
        summary: state.summary ?? (state.firing ? "stub firing" : "stub clean"),
      };
    },
  };
}

async function liveIncident() {
  const r = await db.execute<{
    id: number;
    status: string;
    cleanSinceAt: Date | null;
    mitigatedAt: Date | null;
    resolvedAt: Date | null;
    fireCount: number;
  }>(sql`
    SELECT id, status,
           clean_since_at AS "cleanSinceAt",
           mitigated_at AS "mitigatedAt",
           resolved_at AS "resolvedAt",
           fire_count AS "fireCount"
    FROM incidents
    WHERE rule_id = ${RULE_ID}
    ORDER BY started_at DESC
    LIMIT 1
  `);
  return r.rows?.[0] ?? null;
}

async function auditActions(): Promise<string[]> {
  const r = await db.execute<{ action: string }>(sql`
    SELECT action FROM audit_log
    WHERE target_type = 'incident'
      AND details->>'ruleId' = ${RULE_ID}
    ORDER BY id ASC
  `);
  return (r.rows ?? []).map((x) => x.action);
}

describe("incident runner state machine", () => {
  it("walks open → mitigated → resolved and re-opens cleanly on a new fire", async () => {
    const state = { firing: true };
    const rule = stubRule(state);

    const T0 = new Date("2200-06-01T12:00:00Z");

    // Tick 1: rule fires from cold → opens an incident.
    await evaluateRule(rule, T0);
    let live = await liveIncident();
    assert.ok(live, "incident should have been opened");
    assert.equal(live!.status, "open");
    assert.equal(live!.fireCount, 1);
    assert.deepEqual(await auditActions(), ["incident.opened"]);

    // Tick 2: still firing → fireCount bumps in place.
    await evaluateRule(rule, new Date(T0.getTime() + 60_000));
    live = await liveIncident();
    assert.equal(live!.status, "open");
    assert.equal(live!.fireCount, 2);

    // Tick 3: rule goes clean → cleanSinceAt is stamped, no transition.
    state.firing = false;
    const cleanStart = new Date(T0.getTime() + 2 * 60_000);
    await evaluateRule(rule, cleanStart);
    live = await liveIncident();
    assert.equal(live!.status, "open");
    assert.ok(live!.cleanSinceAt, "cleanSinceAt must be set on first clean tick");
    assert.deepEqual(await auditActions(), ["incident.opened"], "no transition yet");

    // Tick 4: still clean, but only 1 minute later → still open.
    await evaluateRule(rule, new Date(cleanStart.getTime() + 60_000));
    live = await liveIncident();
    assert.equal(live!.status, "open", "must not flip to mitigated before 10m");

    // Tick 5: clean for >= MITIGATE_AFTER_MS → mitigated.
    await evaluateRule(rule, new Date(cleanStart.getTime() + MITIGATE_AFTER_MS + 1000));
    live = await liveIncident();
    assert.equal(live!.status, "mitigated");
    assert.ok(live!.mitigatedAt, "mitigatedAt must be set");
    assert.deepEqual(await auditActions(), ["incident.opened", "incident.mitigated"]);

    // Tick 6: rule fires again while mitigated → flips back to open
    // (audit `incident.reopened`), fireCount bumps, cleanSinceAt /
    // mitigatedAt cleared.
    state.firing = true;
    const refireAt = new Date(cleanStart.getTime() + MITIGATE_AFTER_MS + 60_000);
    await evaluateRule(rule, refireAt);
    live = await liveIncident();
    assert.equal(live!.status, "open");
    assert.equal(live!.cleanSinceAt, null);
    assert.equal(live!.mitigatedAt, null);
    assert.ok(live!.fireCount >= 3);
    assert.deepEqual(
      await auditActions(),
      ["incident.opened", "incident.mitigated", "incident.reopened"],
    );

    // Now drive it all the way through to resolved.
    state.firing = false;
    const cleanAgain = new Date(refireAt.getTime() + 60_000);
    // First clean tick — stamp cleanSinceAt.
    await evaluateRule(rule, cleanAgain);
    // 10m later → mitigated.
    const mitigateAt = new Date(cleanAgain.getTime() + MITIGATE_AFTER_MS + 1000);
    await evaluateRule(rule, mitigateAt);
    live = await liveIncident();
    assert.equal(live!.status, "mitigated");
    // mitigated for an additional (RESOLVE_AFTER - MITIGATE_AFTER) → resolved.
    const resolveAt = new Date(
      mitigateAt.getTime() + (RESOLVE_AFTER_MS - MITIGATE_AFTER_MS) + 1000,
    );
    await evaluateRule(rule, resolveAt);
    live = await liveIncident();
    assert.equal(live!.status, "resolved");
    assert.ok(live!.resolvedAt, "resolvedAt must be set");
    const audits = await auditActions();
    assert.equal(audits[audits.length - 1], "incident.resolved");

    // Tick after resolved with rule firing again — runner should NOT
    // touch the resolved row (the live query filters status IN
    // ('open','mitigated')) and instead INSERT a brand-new open
    // incident. This is the "fresh incident after a resolved one"
    // path — equivalent to the regression-after-resolve flag.
    state.firing = true;
    await evaluateRule(rule, new Date(resolveAt.getTime() + 60_000));
    const all = await db.execute<{ id: number; status: string; fireCount: number }>(sql`
      SELECT id, status, fire_count AS "fireCount"
      FROM incidents WHERE rule_id = ${RULE_ID} ORDER BY id ASC
    `);
    assert.equal(all.rows!.length, 2, "a second incident row must exist after re-fire");
    assert.equal(all.rows![0].status, "resolved");
    assert.equal(all.rows![1].status, "open");
    assert.equal(all.rows![1].fireCount, 1, "fresh incident starts at fireCount=1");
  });

  it("rule.evaluate() throwing does not corrupt state or open an incident", async () => {
    // Use a never-seen rule_id so we don't pollute the previous test's rows.
    const id = `__throw_${RULE_ID}`;
    const throwing: Rule = {
      id,
      severity: "P4",
      runbookUrl: "x",
      evaluate: async () => { throw new Error("boom"); },
    };
    await evaluateRule(throwing, new Date());
    const r = await db.execute(sql`SELECT id FROM incidents WHERE rule_id = ${id}`);
    assert.equal(r.rows?.length ?? 0, 0);
    await db.execute(sql`DELETE FROM incidents WHERE rule_id = ${id}`);
  });
});

describe("withAdvisoryLock — guards against double-runs across replicas", () => {
  it("returns null when another connection holds the same lock", async () => {
    if (!process.env.DATABASE_URL) {
      // Defensive — db.ts already throws if missing, but keep the
      // test resilient if someone runs it in isolation.
      return;
    }
    // Hold the same advisory lock from a separate pg session — this
    // is what a sibling replica's tick would look like.
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      const got = await holder.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock($1::bigint) AS ok`,
        [String(ADVISORY_LOCK_KEY)],
      );
      assert.equal(got.rows[0].ok, true, "external session must acquire the lock");

      let invoked = false;
      const result = await withAdvisoryLock(async () => {
        invoked = true;
        return "should-not-run";
      });
      assert.equal(result, null, "withAdvisoryLock must return null when contended");
      assert.equal(invoked, false, "the inner fn must NOT execute when contended");
    } finally {
      await holder.query(`SELECT pg_advisory_unlock($1::bigint)`, [String(ADVISORY_LOCK_KEY)]);
      await holder.end();
    }

    // After the external holder releases, our pool can grab + run it.
    let ran = false;
    const result = await withAdvisoryLock(async () => {
      ran = true;
      return 42;
    });
    assert.equal(ran, true);
    assert.equal(result, 42);
  });
});

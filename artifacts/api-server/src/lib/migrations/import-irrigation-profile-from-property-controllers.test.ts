// Tests for the import-irrigation-profile-from-property-controllers-v1 migration.
//
// Uses the real dev DB (shared pattern). The migration is idempotent via ON CONFLICT
// DO NOTHING, so tests can be run repeatedly without polluting state.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getMigration } from "./registry";

const MIGRATION_KEY = "import-irrigation-profile-from-property-controllers-v1";
const MIGRATION_ID = MIGRATION_KEY;

// ── Static shape ──────────────────────────────────────────────────────────────

describe("import-irrigation-profile migration — static shape", () => {
  it("getMigration returns a valid definition", () => {
    const m = getMigration(MIGRATION_ID);
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, MIGRATION_ID);
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
  });
});

// ── check() ───────────────────────────────────────────────────────────────────

describe("import-irrigation-profile migration — check()", () => {
  before(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  it("check() returns a valid state (not error)", async () => {
    const m = getMigration(MIGRATION_ID)!;
    const status = await m.check();
    assert.ok(
      ["not_started", "partially_applied", "completed"].includes(status.state),
      `Unexpected state: ${status.state}`,
    );
  });

  it("check() returns completed when marker is set", async () => {
    await db.execute(sql`
      INSERT INTO app_settings (key, value)
      VALUES (${MIGRATION_KEY}, 'completed')
      ON CONFLICT (key) DO UPDATE SET value = 'completed'
    `);
    const m = getMigration(MIGRATION_ID)!;
    // Mark the DB as having all property_controllers covered (or none pending).
    // We only test the marker-present path here; the DB may or may not have
    // property_controllers without matching irrigation_controllers rows.
    const status = await m.check();
    // If there are still un-seeded candidates the state is partially_applied;
    // if there are none it's completed. Both are valid after setting the marker.
    assert.ok(
      ["completed", "partially_applied"].includes(status.state),
      `Expected completed or partially_applied after setting marker, got: ${status.state}`,
    );
  });
});

// ── preview() ─────────────────────────────────────────────────────────────────

describe("import-irrigation-profile migration — preview()", () => {
  it("returns a valid MigrationPreview shape", async () => {
    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();
    assert.ok(Array.isArray(preview.steps), "steps should be an array");
    assert.ok(
      typeof preview.orphanRows === "object" && preview.orphanRows !== null,
      "orphanRows should be an object",
    );
    assert.ok(Array.isArray(preview.warnings), "warnings should be an array");
    assert.ok(
      Object.hasOwn(preview.orphanRows, "customersWithoutProfile"),
      "orphanRows should have customersWithoutProfile key",
    );
    assert.equal(
      typeof preview.orphanRows.customersWithoutProfile,
      "number",
      "customersWithoutProfile should be a number",
    );
  });

  it("each step has a non-empty id and description", async () => {
    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();
    for (const step of preview.steps) {
      assert.equal(typeof step.id, "string");
      assert.ok(step.id.length > 0, "step id should be non-empty");
      assert.equal(typeof step.description, "string");
      assert.ok(step.description.length > 0, "step description should be non-empty");
    }
  });

  it("step count equals customersWithoutProfile when each tuple is one step", async () => {
    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();
    const total = preview.orphanRows.customersWithoutProfile as number;
    assert.equal(
      preview.steps.length,
      total,
      `Expected ${total} steps (one per customer/branch tuple), got ${preview.steps.length}`,
    );
  });
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe("import-irrigation-profile migration — run()", () => {
  before(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  it("run() completes with no failed steps", async () => {
    const m = getMigration(MIGRATION_ID)!;
    const results = await m.run(() => {});
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(
      failed.length,
      0,
      `Steps failed: ${failed.map((r) => `${r.id}: ${r.error}`).join(", ")}`,
    );
  });

  it("after run(), every property_controllers tuple has at least one irrigation_controllers row", async () => {
    const orphans = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*) AS cnt
      FROM (
        SELECT DISTINCT pc.company_id, pc.customer_id, pc.branch_name
        FROM property_controllers pc
        WHERE NOT EXISTS (
          SELECT 1
          FROM irrigation_controllers ic
          WHERE ic.company_id  = pc.company_id
            AND ic.customer_id = pc.customer_id
            AND ic.branch_name = pc.branch_name
        )
      ) AS orphan_tuples
    `);
    const remaining = Number(orphans.rows[0]?.cnt ?? 0);
    assert.equal(
      remaining,
      0,
      `${remaining} property_controllers tuple(s) still have no irrigation profile after run()`,
    );
  });

  it("re-running is idempotent — no new rows created, no failures", async () => {
    const m = getMigration(MIGRATION_ID)!;

    const beforeCount = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) AS cnt FROM irrigation_controllers`,
    );
    const before = Number(beforeCount.rows[0]?.cnt ?? 0);

    const results = await m.run(() => {});
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(failed.length, 0, "Re-run should have no failures");

    const afterCount = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) AS cnt FROM irrigation_controllers`,
    );
    const after = Number(afterCount.rows[0]?.cnt ?? 0);
    assert.equal(
      after,
      before,
      `Re-run should not create new rows (before: ${before}, after: ${after})`,
    );
  });
});

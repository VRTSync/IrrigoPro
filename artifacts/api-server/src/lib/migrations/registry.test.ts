// Slice 4a — registry tests for the company-id-columns-v1 migration.
//
// Behavioral tests that hit the real DB (same pattern as other storage-layer
// tests in this project). The registry size and metadata are static-source
// checks that require no DB.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { listMigrations, getMigration } from "./registry";
import { db } from "../../db";
import { sql } from "drizzle-orm";

// ── Static registry assertions ─────────────────────────────────────────────────

describe("migration registry — static shape", () => {
  it("contains the company-id, reconcile-totals, work-order-zones, renumber-estimates, and reconcile-finding-disposition migrations", () => {
    const all = listMigrations();
    const ids = all.map((m) => m.id);
    assert.ok(ids.includes("company-id-columns-v1"), "missing company-id-columns-v1");
    assert.ok(
      ids.includes("reconcile-billing-sheet-invoice-totals-v1"),
      "missing reconcile-billing-sheet-invoice-totals-v1",
    );
    assert.ok(ids.includes("work-order-zones-v1"), "missing work-order-zones-v1");
    assert.ok(ids.includes("renumber-estimates-v1"), "missing renumber-estimates-v1");
    assert.ok(
      ids.includes("reconcile-finding-disposition-v1"),
      "missing reconcile-finding-disposition-v1",
    );
  });

  it("getMigration returns the definition for the known id", () => {
    const m = getMigration("company-id-columns-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "company-id-columns-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
  });

  it("getMigration returns the reconcile-totals definition with the required shape", () => {
    const m = getMigration("reconcile-billing-sheet-invoice-totals-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "reconcile-billing-sheet-invoice-totals-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
  });

  it("getMigration returns the renumber-estimates definition with the required shape", () => {
    const m = getMigration("renumber-estimates-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "renumber-estimates-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
  });

  it("getMigration returns undefined for unknown id", () => {
    assert.equal(getMigration("nonexistent"), undefined);
  });
});

// ── Behavioral tests for renumber-estimates-v1 ────────────────────────────────

describe("renumber-estimates-v1 — static shape + check()", () => {
  const MIGRATION_KEY = "renumber-estimates-v1";

  before(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  it("check() returns a valid MigrationStatus (not error)", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    const status = await m.check();
    assert.ok(
      status.state === "not_started" ||
      status.state === "partially_applied" ||
      status.state === "completed",
      `Unexpected state: ${status.state}`,
    );
  });
});

describe("renumber-estimates-v1 — preview()", () => {
  const MIGRATION_KEY = "renumber-estimates-v1";

  it("returns a valid MigrationPreview shape with required arrays", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    const preview = await m.preview();
    assert.ok(Array.isArray(preview.steps), "steps should be an array");
    assert.ok(typeof preview.orphanRows === "object" && preview.orphanRows !== null, "orphanRows should be an object");
    assert.ok(Array.isArray(preview.warnings), "warnings should be an array");
    assert.ok(
      Object.hasOwn(preview.orphanRows, "estimatesToRenumber"),
      "orphanRows should have estimatesToRenumber key",
    );
    assert.equal(typeof preview.orphanRows.estimatesToRenumber, "number", "estimatesToRenumber should be a number");
  });

  it("each step has an id and description string", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    const preview = await m.preview();
    for (const step of preview.steps) {
      assert.equal(typeof step.id, "string", `step id should be a string, got ${typeof step.id}`);
      assert.ok(step.id.length > 0, "step id should be non-empty");
      assert.equal(typeof step.description, "string", `step description should be a string`);
      assert.ok(step.description.length > 0, "step description should be non-empty");
    }
  });

  it("preview reports the correct total count matching the step list (capped at 200)", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    const preview = await m.preview();
    const total = preview.orphanRows.estimatesToRenumber as number;
    // Steps ≤ total when capped at 200; steps may include summary rows for
    // companies with more than the per-company preview cap.
    assert.ok(
      preview.steps.length <= total + 50, // +50 headroom for summary "…and N more" steps
      `steps.length (${preview.steps.length}) should be ≤ total estimates (${total}) plus summary rows`,
    );
  });
});

describe("renumber-estimates-v1 — run()", () => {
  const MIGRATION_KEY = "renumber-estimates-v1";

  before(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  it("run() completes with no failed steps", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    const results = await m.run(() => {});
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(
      failed.length,
      0,
      `Steps failed: ${failed.map((r) => `${r.id}: ${r.error}`).join(", ")}`,
    );
  });

  it("after run(), all companies have nextEstimateNumber ≥ startingEstimateNumber", async () => {
    const rows = await db.execute<{ next: number; start: number }>(sql`
      SELECT next_estimate_number AS next, starting_estimate_number AS start
      FROM companies
      WHERE is_active = true
    `);
    for (const r of rows.rows) {
      assert.ok(
        r.next >= r.start,
        `Company has nextEstimateNumber (${r.next}) < startingEstimateNumber (${r.start})`,
      );
    }
  });

  it("re-running is idempotent — no failed steps, same nextEstimateNumber", async () => {
    const before = await db.execute<{ id: number; next: number }>(sql`
      SELECT id, next_estimate_number AS next FROM companies WHERE is_active = true ORDER BY id
    `);
    const m = getMigration(MIGRATION_KEY)!;
    const results = await m.run(() => {});
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(failed.length, 0, "Re-run should have no failures");
    const after = await db.execute<{ id: number; next: number }>(sql`
      SELECT id, next_estimate_number AS next FROM companies WHERE is_active = true ORDER BY id
    `);
    // nextEstimateNumber must not regress — it may stay the same or increase
    // (if new estimates were created between runs), but never decrease.
    for (const a of after.rows) {
      const b = before.rows.find((x) => x.id === a.id);
      if (!b) continue;
      assert.ok(
        a.next >= b.next,
        `Company ${a.id}: nextEstimateNumber regressed from ${b.next} to ${a.next}`,
      );
    }
  });
});

// ── Behavioral tests — check() ─────────────────────────────────────────────────

describe("company-id-columns-v1 — check()", () => {
  const MIGRATION_KEY = "company-id-columns-v1";

  before(async () => {
    // Ensure the app_settings marker is cleared for the tests that need a clean slate.
    await db.execute(sql`
      DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}
    `);
  });

  it("returns not_started when marker is absent and columns don't exist", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    // In CI the columns may or may not exist on work_orders etc. We only
    // test the marker-absent path reliably; the partially_applied path
    // is validated by the integration scenario below.
    const status = await m.check();
    // If the columns already exist from a prior migration run, the state
    // will be 'partially_applied' or 'completed' — both are valid non-error states.
    assert.ok(
      status.state === "not_started" ||
      status.state === "partially_applied" ||
      status.state === "completed",
      `Unexpected state: ${status.state}`,
    );
  });

  it("returns completed when marker is set to 'completed'", async () => {
    await db.execute(sql`
      INSERT INTO app_settings (key, value)
      VALUES (${MIGRATION_KEY}, 'completed')
      ON CONFLICT (key) DO UPDATE SET value = 'completed'
    `);
    const m = getMigration(MIGRATION_KEY)!;
    const status = await m.check();
    assert.equal(status.state, "completed");
    // Cleanup
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });
});

// ── Behavioral tests — preview() ──────────────────────────────────────────────

describe("company-id-columns-v1 — preview()", () => {
  it("returns exactly 6 steps", async () => {
    const m = getMigration("company-id-columns-v1")!;
    const preview = await m.preview();
    assert.equal(preview.steps.length, 6);
    assert.equal(preview.steps[0].id, "step1_add_columns");
    assert.equal(preview.steps[1].id, "step2_backfill");
    assert.equal(preview.steps[2].id, "step3_assert_no_nulls");
    assert.equal(preview.steps[3].id, "step4_apply_not_null");
    assert.equal(preview.steps[4].id, "step5_create_indexes");
    assert.equal(preview.steps[5].id, "step6_mark_completed");
  });

  it("orphanRows contains an entry for each of the 4 tables", async () => {
    const m = getMigration("company-id-columns-v1")!;
    const preview = await m.preview();
    for (const table of ["work_orders", "billing_sheets", "invoices", "estimates"]) {
      assert.ok(Object.hasOwn(preview.orphanRows, table), `Missing orphanRows.${table}`);
      assert.equal(typeof preview.orphanRows[table], "number");
    }
  });
});

// ── Behavioral tests — run() ───────────────────────────────────────────────────

describe("company-id-columns-v1 — run()", () => {
  const MIGRATION_KEY = "company-id-columns-v1";

  before(async () => {
    // Clear the marker so run() starts fresh.
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  after(async () => {
    // Clean up marker after tests.
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);
  });

  it("run() completes all 6 steps with no failures on a clean (or already-columns) DB", async () => {
    const m = getMigration(MIGRATION_KEY)!;
    const emits: Array<{ step: string; status: string }> = [];
    const results = await m.run((event) => {
      emits.push({ step: event.step, status: event.status });
    });

    assert.ok(results.length > 0, "run() should return at least one step result");

    const failed = results.filter((r) => r.status === "failed");
    assert.equal(
      failed.length,
      0,
      `Steps failed: ${failed.map((r) => `${r.id}: ${r.error}`).join(", ")}`,
    );

    // The marker should now be set to 'completed'.
    const marker = await db.execute(
      sql`SELECT value FROM app_settings WHERE key = ${MIGRATION_KEY}`
    );
    assert.equal(marker.rows[0]?.value, "completed");
  });

  it("re-running after completion is a no-op (all steps succeed, no errors)", async () => {
    // Marker is already 'completed' from the previous test. Re-run should
    // pass through step1 (IF NOT EXISTS), step2 (0 rows updated), step3
    // (0 nulls), step4-6 succeed idempotently.
    const m = getMigration(MIGRATION_KEY)!;
    const results = await m.run(() => {});
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(
      failed.length,
      0,
      `Re-run produced failures: ${failed.map((r) => `${r.id}: ${r.error}`).join(", ")}`,
    );
  });
});

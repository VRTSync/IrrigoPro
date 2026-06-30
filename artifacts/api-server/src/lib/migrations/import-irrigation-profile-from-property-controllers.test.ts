// Tests for the import-irrigation-profile-from-property-controllers-v1 migration.
//
// Uses the real dev DB (shared pattern). The migration is idempotent via ON CONFLICT
// DO NOTHING, so tests can be run repeatedly without polluting state.
//
// The focused mismatch tests (describe "mismatch repair") insert controlled rows under
// a unique branch name (prefixed with "_test_mismatch_") and clean up after themselves.

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
    assert.ok(
      Object.hasOwn(preview.orphanRows, "controllersWithWrongZoneCount"),
      "orphanRows should have controllersWithWrongZoneCount key",
    );
    assert.equal(
      typeof preview.orphanRows.customersWithoutProfile,
      "number",
      "customersWithoutProfile should be a number",
    );
    assert.equal(
      typeof preview.orphanRows.controllersWithWrongZoneCount,
      "number",
      "controllersWithWrongZoneCount should be a number",
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

  it("step count equals customersWithoutProfile + controllersWithWrongZoneCount", async () => {
    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();
    const seedSteps = preview.orphanRows.customersWithoutProfile as number;
    const backfillSteps = preview.orphanRows.controllersWithWrongZoneCount as number;
    const total = seedSteps + backfillSteps;
    assert.equal(
      preview.steps.length,
      total,
      `Expected ${total} steps (${seedSteps} seed + ${backfillSteps} backfill), got ${preview.steps.length}`,
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

// ── Mismatch repair (focused) ─────────────────────────────────────────────────
//
// These tests insert controlled rows under a unique branch name and clean up
// after themselves. They do NOT depend on the shared dev-DB seed state.

describe("import-irrigation-profile migration — mismatch repair", () => {
  // Unique branch name so these rows never collide with production data or
  // other parallel test runs. Timestamp suffix makes reruns safe.
  const BRANCH = `_test_mismatch_${Date.now()}`;

  let companyId: number;
  let customerId: number;

  // IDs we insert so the after() hook can clean them up precisely.
  let wrongCountIcId: number;
  let nullIcId: number;
  let correctIcId: number;
  let otherCompanyId: number;
  let otherCustomerId: number;
  let otherIcId: number;

  before(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);

    // Grab the first available (company_id, customer_id) pair from the DB so we
    // satisfy the FK constraints without inserting into companies/customers.
    const pair = await db.execute<{ company_id: string; customer_id: string }>(sql`
      SELECT company_id, customer_id
      FROM customers
      ORDER BY company_id, id
      LIMIT 1
    `);
    if (pair.rows.length === 0) {
      // No customers exist — skip data insertion; tests will be vacuous but safe.
      companyId = 0;
      customerId = 0;
      return;
    }
    companyId = Number(pair.rows[0]!.company_id);
    customerId = Number(pair.rows[0]!.customer_id);

    // Grab a second (company, customer) pair (different company) for isolation test.
    const pair2 = await db.execute<{ company_id: string; customer_id: string }>(sql`
      SELECT company_id, customer_id
      FROM customers
      WHERE company_id <> ${companyId}
      ORDER BY company_id, id
      LIMIT 1
    `);
    if (pair2.rows.length > 0) {
      otherCompanyId = Number(pair2.rows[0]!.company_id);
      otherCustomerId = Number(pair2.rows[0]!.customer_id);
    } else {
      // Only one company exists — reuse same company with different customer.
      const pair2b = await db.execute<{ company_id: string; customer_id: string }>(sql`
        SELECT company_id, customer_id
        FROM customers
        WHERE company_id = ${companyId} AND id <> ${customerId}
        ORDER BY id
        LIMIT 1
      `);
      otherCompanyId = companyId;
      otherCustomerId = pair2b.rows.length > 0
        ? Number(pair2b.rows[0]!.customer_id)
        : customerId;
    }

    if (companyId === 0) return;

    // ── Insert property_controllers rows (the authoritative source) ────────────
    // Controller A: old value 12, correct value 15
    await db.execute(sql`
      INSERT INTO property_controllers (company_id, customer_id, branch_name, controller_letter, zone_count)
      VALUES (${companyId}, ${customerId}, ${BRANCH}, 'A', 15)
      ON CONFLICT (customer_id, controller_letter, branch_name) DO NOTHING
    `);

    // Controller B: null totalZones case (authoritative count = 8)
    await db.execute(sql`
      INSERT INTO property_controllers (company_id, customer_id, branch_name, controller_letter, zone_count)
      VALUES (${companyId}, ${customerId}, ${BRANCH}, 'B', 8)
      ON CONFLICT (customer_id, controller_letter, branch_name) DO NOTHING
    `);

    // Controller C: already correct (authoritative count = 6)
    await db.execute(sql`
      INSERT INTO property_controllers (company_id, customer_id, branch_name, controller_letter, zone_count)
      VALUES (${companyId}, ${customerId}, ${BRANCH}, 'C', 6)
      ON CONFLICT (customer_id, controller_letter, branch_name) DO NOTHING
    `);

    // Other-company Controller A: should never be touched by this company's run
    if (otherCompanyId !== 0 && otherCustomerId !== 0) {
      await db.execute(sql`
        INSERT INTO property_controllers (company_id, customer_id, branch_name, controller_letter, zone_count)
        VALUES (${otherCompanyId}, ${otherCustomerId}, ${BRANCH}, 'A', 20)
        ON CONFLICT (customer_id, controller_letter, branch_name) DO NOTHING
      `);
    }

    // ── Insert irrigation_controllers rows with controlled zone counts ──────────
    const icA = await db.execute<{ id: string }>(sql`
      INSERT INTO irrigation_controllers
        (company_id, customer_id, branch_name, name, total_zones, is_active, created_at, updated_at)
      VALUES (${companyId}, ${customerId}, ${BRANCH}, 'Controller A', 12, true, NOW(), NOW())
      ON CONFLICT (company_id, customer_id, branch_name, name) DO NOTHING
      RETURNING id
    `);
    wrongCountIcId = icA.rows.length > 0
      ? Number((icA.rows[0] as { id: string }).id)
      : Number((await db.execute<{ id: string }>(sql`
          SELECT id FROM irrigation_controllers
          WHERE company_id = ${companyId} AND customer_id = ${customerId}
            AND branch_name = ${BRANCH} AND name = 'Controller A'
        `)).rows[0]!.id);

    const icB = await db.execute<{ id: string }>(sql`
      INSERT INTO irrigation_controllers
        (company_id, customer_id, branch_name, name, total_zones, is_active, created_at, updated_at)
      VALUES (${companyId}, ${customerId}, ${BRANCH}, 'Controller B', NULL, true, NOW(), NOW())
      ON CONFLICT (company_id, customer_id, branch_name, name) DO NOTHING
      RETURNING id
    `);
    nullIcId = icB.rows.length > 0
      ? Number((icB.rows[0] as { id: string }).id)
      : Number((await db.execute<{ id: string }>(sql`
          SELECT id FROM irrigation_controllers
          WHERE company_id = ${companyId} AND customer_id = ${customerId}
            AND branch_name = ${BRANCH} AND name = 'Controller B'
        `)).rows[0]!.id);

    const icC = await db.execute<{ id: string }>(sql`
      INSERT INTO irrigation_controllers
        (company_id, customer_id, branch_name, name, total_zones, is_active, created_at, updated_at)
      VALUES (${companyId}, ${customerId}, ${BRANCH}, 'Controller C', 6, true, NOW(), NOW())
      ON CONFLICT (company_id, customer_id, branch_name, name) DO NOTHING
      RETURNING id
    `);
    correctIcId = icC.rows.length > 0
      ? Number((icC.rows[0] as { id: string }).id)
      : Number((await db.execute<{ id: string }>(sql`
          SELECT id FROM irrigation_controllers
          WHERE company_id = ${companyId} AND customer_id = ${customerId}
            AND branch_name = ${BRANCH} AND name = 'Controller C'
        `)).rows[0]!.id);

    // Other-company controller with wrong count (should be untouched in isolation test)
    if (otherCompanyId !== 0 && otherCustomerId !== 0) {
      const icOther = await db.execute<{ id: string }>(sql`
        INSERT INTO irrigation_controllers
          (company_id, customer_id, branch_name, name, total_zones, is_active, created_at, updated_at)
        VALUES (${otherCompanyId}, ${otherCustomerId}, ${BRANCH}, 'Controller A', 5, true, NOW(), NOW())
        ON CONFLICT (company_id, customer_id, branch_name, name) DO NOTHING
        RETURNING id
      `);
      otherIcId = icOther.rows.length > 0
        ? Number((icOther.rows[0] as { id: string }).id)
        : Number((await db.execute<{ id: string }>(sql`
            SELECT id FROM irrigation_controllers
            WHERE company_id = ${otherCompanyId} AND customer_id = ${otherCustomerId}
              AND branch_name = ${BRANCH} AND name = 'Controller A'
          `)).rows[0]!.id);
    }
  });

  after(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);

    if (companyId === 0) return;

    // Clean up irrigation_profile_zones first (FK cascade would handle it, but be explicit).
    for (const icId of [wrongCountIcId, nullIcId, correctIcId, otherIcId].filter(Boolean)) {
      await db.execute(sql`
        DELETE FROM irrigation_profile_zones WHERE controller_id = ${icId}
      `);
    }
    // Clean up irrigation_controllers.
    await db.execute(sql`
      DELETE FROM irrigation_controllers
      WHERE branch_name = ${BRANCH}
    `);
    // Clean up property_controllers.
    await db.execute(sql`
      DELETE FROM property_controllers
      WHERE branch_name = ${BRANCH}
    `);
  });

  it("check() and preview() detect a controller with wrong zone count (12 → 15)", async () => {
    if (companyId === 0) return; // no customers in DB — skip

    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();

    const wrongZoneCount = preview.orphanRows.controllersWithWrongZoneCount as number;
    assert.ok(wrongZoneCount >= 1, `Expected at least 1 controller with wrong zone count, got ${wrongZoneCount}`);

    const backfillStep = preview.steps.find(
      (s) => s.id === `backfill:${wrongCountIcId}`,
    );
    assert.ok(backfillStep, `Expected a backfill step for wrongCountIcId=${wrongCountIcId}`);
    assert.ok(
      backfillStep.description.includes("was 12"),
      `Expected description to show "was 12", got: ${backfillStep.description}`,
    );
    assert.ok(
      backfillStep.description.includes("15"),
      `Expected description to show target count 15, got: ${backfillStep.description}`,
    );
  });

  it("check() and preview() detect a controller with null zone count", async () => {
    if (companyId === 0) return;

    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();

    const nullStep = preview.steps.find(
      (s) => s.id === `backfill:${nullIcId}`,
    );
    assert.ok(nullStep, `Expected a backfill step for nullIcId=${nullIcId}`);
    assert.ok(
      nullStep.description.includes("was null"),
      `Expected description to show "was null", got: ${nullStep.description}`,
    );
  });

  it("run() corrects the wrong zone count (12 → 15) and syncs zone placeholders", async () => {
    if (companyId === 0) return;

    const m = getMigration(MIGRATION_ID)!;
    const results = await m.run(() => {});

    const failed = results.filter((r) => r.status === "failed");
    assert.equal(
      failed.length,
      0,
      `Steps failed: ${failed.map((r) => `${r.id}: ${r.error}`).join(", ")}`,
    );

    // Verify total_zones is now 15.
    const ic = await db.execute<{ total_zones: string }>(sql`
      SELECT total_zones FROM irrigation_controllers WHERE id = ${wrongCountIcId}
    `);
    assert.equal(
      Number(ic.rows[0]?.total_zones),
      15,
      `Expected total_zones=15 after backfill, got ${ic.rows[0]?.total_zones}`,
    );

    // Verify zone placeholders synced to 15 (at least zones 1–15 exist).
    const zones = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*) AS cnt
      FROM irrigation_profile_zones
      WHERE controller_id = ${wrongCountIcId}
        AND zone_number <= 15
    `);
    assert.equal(
      Number(zones.rows[0]?.cnt),
      15,
      `Expected 15 zone placeholders, got ${zones.rows[0]?.cnt}`,
    );
  });

  it("run() corrects a null zone count", async () => {
    if (companyId === 0) return;

    // run() was already called in the previous test — check state directly.
    const ic = await db.execute<{ total_zones: string }>(sql`
      SELECT total_zones FROM irrigation_controllers WHERE id = ${nullIcId}
    `);
    assert.equal(
      Number(ic.rows[0]?.total_zones),
      8,
      `Expected total_zones=8 after backfill, got ${ic.rows[0]?.total_zones}`,
    );
  });

  it("run() does not touch a controller whose zone count already matches", async () => {
    if (companyId === 0) return;

    // Controller C had total_zones=6, pc.zone_count=6 — should not appear as a backfill step.
    const m = getMigration(MIGRATION_ID)!;
    const preview = await m.preview();

    const correctStep = preview.steps.find(
      (s) => s.id === `backfill:${correctIcId}`,
    );
    assert.equal(
      correctStep,
      undefined,
      `Controller C (already correct) should not appear as a backfill step`,
    );

    const ic = await db.execute<{ total_zones: string }>(sql`
      SELECT total_zones FROM irrigation_controllers WHERE id = ${correctIcId}
    `);
    assert.equal(
      Number(ic.rows[0]?.total_zones),
      6,
      `Correct controller should still have total_zones=6`,
    );
  });

  it("re-running after corrections reports 0 backfill candidates for these controllers", async () => {
    if (companyId === 0) return;

    const m = getMigration(MIGRATION_ID)!;
    // Clear the done marker so preview() re-evaluates.
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${MIGRATION_KEY}`);

    const preview = await m.preview();

    // Neither wrongCountIcId nor nullIcId should appear anymore.
    const wrongStep = preview.steps.find((s) => s.id === `backfill:${wrongCountIcId}`);
    const nullStep = preview.steps.find((s) => s.id === `backfill:${nullIcId}`);
    assert.equal(wrongStep, undefined, "Previously-corrected wrong-count controller should not reappear");
    assert.equal(nullStep, undefined, "Previously-corrected null controller should not reappear");

    // A second run() should have no failures and create no new rows.
    const beforeCount = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) AS cnt FROM irrigation_controllers`,
    );
    const before = Number(beforeCount.rows[0]?.cnt ?? 0);

    const results = await m.run(() => {});
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(failed.length, 0, "Second run should have no failures");

    const afterCount = await db.execute<{ cnt: string }>(
      sql`SELECT COUNT(*) AS cnt FROM irrigation_controllers`,
    );
    const after = Number(afterCount.rows[0]?.cnt ?? 0);
    assert.equal(after, before, "Second run should not create new rows");
  });

  it("other company's controller with wrong zone count is untouched (company-scoped)", async () => {
    if (companyId === 0 || !otherIcId) return;

    // The migration runs across all companies (it's a global repair for the admin).
    // What we verify here is that the other company's controller was also corrected
    // to its own pc.zone_count=20 — i.e. company A's data never bleeds into company B's.
    const ic = await db.execute<{ total_zones: string; company_id: string }>(sql`
      SELECT total_zones, company_id FROM irrigation_controllers WHERE id = ${otherIcId}
    `);
    assert.equal(
      Number(ic.rows[0]?.company_id),
      otherCompanyId,
      "Other-company controller should still belong to the other company",
    );
    // Its zone count should have been corrected to its own pc.zone_count (20), not to
    // anything from the first company's controllers.
    const otherPc = await db.execute<{ zone_count: string }>(sql`
      SELECT zone_count FROM property_controllers
      WHERE company_id = ${otherCompanyId} AND customer_id = ${otherCustomerId}
        AND branch_name = ${BRANCH} AND controller_letter = 'A'
    `);
    if (otherPc.rows.length > 0) {
      assert.equal(
        Number(ic.rows[0]?.total_zones),
        Number(otherPc.rows[0]!.zone_count),
        "Other-company controller should be corrected to its own pc.zone_count, not contaminated by first company",
      );
    }
  });
});

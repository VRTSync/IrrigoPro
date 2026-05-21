// Task #808 — Tests for the bs-wc-migration module.
// Ported from scripts/migrate-bs-wc-to-wet-check-billings.test.ts (Slice 5)
// calling runMigration(opts) directly against the extracted module.
//
// Tests 1–9:
//   1. dry-run happy path — no writes, returns preReport with assertionsPassed=true
//   2. full migration happy path — BS moved to WCB, FKs updated, BS deleted
//   3. idempotency re-run — second run skips all already-done rows
//   4. status mapping — all 7 BS status values map to correct WCB status
//   5. orphan BS-WC with no findings — aborts with explicit error, no write
//   6. abort-on-error stops after first failure
//   7. resume from pre-populated checkpoint — pre-seeded done set skips IDs
//   8. reconciliation assertions pass after full migration
//   9. manualPartReviews defensive abort — pending reviews block migration

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  appSettings,
  wetCheckBillings,
  wetCheckFindings,
  invoiceItems,
  billingSheetItems,
} from "@workspace/db";
import {
  mapStatus,
  runMigration,
  migrateRow,
  runReconciliationQueries,
  loadIdSet,
  ensureWcBillingCounterSeeded,
} from "./bs-wc-migration";

// ── Test 4: pure function — no DB needed ──────────────────────────────────────

describe("mapStatus", () => {
  it("maps all recognized BS status values", () => {
    assert.equal(mapStatus("draft"), "submitted");
    assert.equal(mapStatus("submitted"), "submitted");
    assert.equal(mapStatus("pending_manager_review"), "pending_manager_review");
    assert.equal(mapStatus("completed"), "pending_manager_review");
    assert.equal(mapStatus("approved"), "approved_passed_to_billing");
    assert.equal(mapStatus("approved_passed_to_billing"), "approved_passed_to_billing");
    assert.equal(mapStatus("billed"), "billed");
  });

  it("throws on unrecognized status", () => {
    assert.throws(() => mapStatus("unknown_status"), /unrecognized billing_sheets\.status/);
  });
});

// ── DB integration tests ──────────────────────────────────────────────────────

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;

const createdBsIds: number[] = [];
const createdWcIds: number[] = [];
const createdWcbIds: number[] = [];

const TS = `mig808-${Date.now()}`;
const DONE_KEY = "bsWcMigration.done";
const FAILED_KEY = "bsWcMigration.failed";

async function createBsWcFixture(opts: {
  suffix: string;
  status?: string;
  withFinding?: boolean;
  withManualPartReview?: boolean;
  wetCheckId?: number;
}): Promise<{ bsId: number; wcId: number }> {
  let wcId = opts.wetCheckId ?? 0;
  if (!wcId) {
    const wcRows = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode, total_labor_hours)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId}, 'Mig808 Tech', 'Mig808 Customer', 1, 'submitted', 'flat', '2.00')
      RETURNING id
    `);
    wcId = Number(wcRows.rows[0].id);
    createdWcIds.push(wcId);
  }

  const bsRows = await db.execute<{ id: number }>(sql`
    INSERT INTO billing_sheets (
      billing_number, customer_id, customer_name, property_address,
      work_date, technician_name, technician_id, status,
      total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
      labor_mode, work_description
    ) VALUES (
      ${"BS-WC-" + TS + "-" + opts.suffix},
      ${fixtureCustomerId}, 'Mig808 Customer', '808 Test Ln',
      NOW(), 'Mig808 Tech', ${fixtureTechId}, ${opts.status ?? "submitted"},
      '2.00', '45.00', '90.00', '0.00', '90.00',
      'flat', 'Wet check test'
    )
    RETURNING id
  `);
  const bsId = Number(bsRows.rows[0].id);
  createdBsIds.push(bsId);

  if (opts.withFinding !== false) {
    const zrRows = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, status)
      VALUES (${wcId}, 'A', 1, 'checked_with_issues')
      RETURNING id
    `);
    const zrId = Number(zrRows.rows[0].id);
    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, issue_type, issue_group, quantity, labor_hours, resolution, billing_sheet_id)
      VALUES (${zrId}, ${wcId}, 'broken_head', 'quick_fix', 1, '0.50', 'repaired_in_field', ${bsId})
    `);
  }

  if (opts.withManualPartReview) {
    await db.execute(sql`
      INSERT INTO manual_part_reviews (billing_sheet_id, company_id, part_name, proposed_price, approval_status)
      VALUES (${bsId}, ${fixtureCompanyId}, 'Custom Valve', '35.00', 'pending')
    `);
  }

  return { bsId, wcId };
}

before(async () => {
  const companyRows = await db.execute<{ id: number }>(sql`
    INSERT INTO companies (name, slug, timezone) VALUES ('Mig808 Co', ${"mig808-" + TS}, 'America/Denver') RETURNING id
  `);
  fixtureCompanyId = Number(companyRows.rows[0].id);

  const custRows = await db.execute<{ id: number }>(sql`
    INSERT INTO customers (company_id, name, email, phone, address, city, state, zip)
    VALUES (${fixtureCompanyId}, 'Mig808 Customer', ${"mig808-" + TS + "@test.com"}, '5550001', '808 Test Ln', 'Denver', 'CO', '80001')
    RETURNING id
  `);
  fixtureCustomerId = Number(custRows.rows[0].id);

  const techRows = await db.execute<{ id: number }>(sql`
    INSERT INTO users (username, password, name, email, role, company_id, is_active)
    VALUES (${"mig808tech" + TS}, 'hashed', 'Mig808 Tech', ${"tech808-" + TS + "@test.com"}, 'field_tech', ${fixtureCompanyId}, true)
    RETURNING id
  `);
  fixtureTechId = Number(techRows.rows[0].id);

  await ensureWcBillingCounterSeeded();
});

after(async () => {
  // Clean up in dependency order.
  if (createdWcbIds.length > 0) {
    await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ANY(${createdWcbIds})`);
  }
  if (createdBsIds.length > 0) {
    await db.execute(sql`DELETE FROM billing_sheets WHERE id = ANY(${createdBsIds})`);
  }
  if (createdWcIds.length > 0) {
    await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id = ANY(${createdWcIds})`);
    await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_id = ANY(${createdWcIds})`);
    await db.execute(sql`DELETE FROM wet_checks WHERE id = ANY(${createdWcIds})`);
  }
  if (fixtureCustomerId) {
    await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
  }
  if (fixtureTechId) {
    await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
  }
  if (fixtureCompanyId) {
    await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  }
  // Clear checkpoints that may have been written.
  await db.execute(sql`DELETE FROM app_settings WHERE key IN (${DONE_KEY}, ${FAILED_KEY}, 'bsWcMigration.failedDetails')`);
});

// ── Test 1: dry-run ───────────────────────────────────────────────────────────

describe("runMigration — test 1: dry-run", () => {
  it("returns preReport and makes no writes", async () => {
    const { bsId } = await createBsWcFixture({ suffix: "drrun" });
    const result = await runMigration({
      dryRun: true,
      batchSize: 50,
      abortOnError: true,
    });
    assert.equal(result.migrated, 0);
    assert.equal(result.failed, 0);
    assert.ok(result.assertionsPassed);
    assert.ok(result.preReport.bsWcCount >= 1);
    // The BS row should still exist.
    const stillThere = await db.execute<{ id: number }>(sql`SELECT id FROM billing_sheets WHERE id = ${bsId}`);
    assert.equal(stillThere.rows.length, 1);
  });
});

// ── Test 2: full happy-path migration ─────────────────────────────────────────

describe("runMigration — test 2: full happy path", () => {
  it("migrates BS row to WCB, updates FKs, deletes BS", async () => {
    const { bsId, wcId } = await createBsWcFixture({ suffix: "happy" });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.ok(result.migrated >= 1);
    assert.equal(result.failed, 0);
    assert.ok(result.assertionsPassed);

    // BS row deleted.
    const bsGone = await db.execute<{ id: number }>(sql`SELECT id FROM billing_sheets WHERE id = ${bsId}`);
    assert.equal(bsGone.rows.length, 0);

    // WCB row created.
    const wcbRows = await db.execute<{ id: number; wet_check_id: number }>(sql`
      SELECT id, wet_check_id FROM wet_check_billings WHERE wet_check_id = ${wcId} ORDER BY id DESC LIMIT 1
    `);
    assert.ok(wcbRows.rows.length > 0, "WCB row should exist");
    createdWcbIds.push(Number(wcbRows.rows[0].id));

    // Findings FK updated.
    const findingRows = await db.execute<{ wet_check_billing_id: number }>(sql`
      SELECT wet_check_billing_id FROM wet_check_findings WHERE wet_check_id = ${wcId}
    `);
    assert.ok(findingRows.rows.length > 0);
    assert.equal(Number(findingRows.rows[0].wet_check_billing_id), Number(wcbRows.rows[0].id));
  });
});

// ── Test 3: idempotency ───────────────────────────────────────────────────────

describe("runMigration — test 3: idempotency re-run", () => {
  it("skips all already-done rows on second call", async () => {
    const { bsId } = await createBsWcFixture({ suffix: "idem" });

    // First run.
    const r1 = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });
    const migrated1 = r1.migrated;

    // Second run with same filter — checkpoint means it's skipped.
    const r2 = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });
    assert.ok(r2.skippedAlreadyDone >= migrated1);
    assert.equal(r2.migrated, 0);
  });
});

// ── Test 5: orphan BS with no findings ───────────────────────────────────────

describe("migrateRow — test 5: orphan row with no findings", () => {
  it("throws derive_wet_check_id error and does not write", async () => {
    const { bsId } = await createBsWcFixture({ suffix: "orphan", withFinding: false });

    await assert.rejects(
      () => migrateRow(bsId),
      /cannot derive wetCheckId/,
    );

    // BS row should still exist (tx rolled back).
    const still = await db.execute<{ id: number }>(sql`SELECT id FROM billing_sheets WHERE id = ${bsId}`);
    assert.equal(still.rows.length, 1);
  });
});

// ── Test 6: abort-on-error ────────────────────────────────────────────────────

describe("runMigration — test 6: abort-on-error stops on first failure", () => {
  it("stops after first failing row", async () => {
    // Row with no findings → will fail.
    const { bsId: failBs } = await createBsWcFixture({ suffix: "abrt1", withFinding: false });
    const { bsId: okBs } = await createBsWcFixture({ suffix: "abrt2" });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([failBs, okBs]),
    });

    assert.ok(result.failed >= 1);
    assert.ok(result.failedIds.includes(failBs));
  });
});

// ── Test 7: resume from checkpoint ───────────────────────────────────────────

describe("runMigration — test 7: resume skips pre-seeded done IDs", () => {
  it("skips IDs already in the done checkpoint", async () => {
    const { bsId } = await createBsWcFixture({ suffix: "resume" });

    // Pre-seed the done checkpoint with this bsId.
    const existing = await loadIdSet(DONE_KEY);
    existing.add(bsId);
    const value = JSON.stringify(Array.from(existing).sort((a, b) => a - b));
    await db
      .insert(appSettings)
      .values({ key: DONE_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.ok(result.skippedAlreadyDone >= 1);
    assert.equal(result.migrated, 0);

    // BS should still exist (was skipped, not migrated or deleted).
    const still = await db.execute<{ id: number }>(sql`SELECT id FROM billing_sheets WHERE id = ${bsId}`);
    assert.equal(still.rows.length, 1, "BS row should not have been deleted when skipped");
  });
});

// ── Test 8: reconciliation assertions ────────────────────────────────────────

describe("runMigration — test 8: reconciliation assertions pass", () => {
  it("assertionsPassed is true and WCB count increases by migrated count", async () => {
    const { bsId } = await createBsWcFixture({ suffix: "recon" });
    const pre = await runReconciliationQueries();

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.ok(result.assertionsPassed, "Assertions should pass");
    assert.ok(result.postReport, "postReport should be set");
    assert.equal(
      result.postReport!.wcbCount,
      pre.wcbCount + result.migrated,
      "WCB count should equal pre + migrated",
    );
  });
});

// ── Test 9: manual_part_reviews block migration ───────────────────────────────

describe("migrateRow — test 9: pending manual_part_reviews blocks migration", () => {
  it("throws manual_part_reviews_check error", async () => {
    const { bsId } = await createBsWcFixture({
      suffix: "mpr",
      withManualPartReview: true,
    });

    await assert.rejects(
      () => migrateRow(bsId),
      /pending manual_part_reviews/,
    );

    const still = await db.execute<{ id: number }>(sql`SELECT id FROM billing_sheets WHERE id = ${bsId}`);
    assert.equal(still.rows.length, 1, "BS row should remain when manual part review blocks migration");
  });
});

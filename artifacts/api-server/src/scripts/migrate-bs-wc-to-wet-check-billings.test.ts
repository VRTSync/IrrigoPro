// Task #796 — Tests for the BS-WC → wet_check_billings migration script.
//
// 10 test cases:
//   1.  dry-run happy path — no writes, reconciliation report printed
//   2.  full migration happy path — BS moved to WCB, FKs updated, BS deleted
//   3.  idempotency re-run — second call with done checkpoint skips all rows
//   4.  status mapping — all 6 BS status values map to correct WCB status
//   5.  orphan BS-WC with no findings — aborts with explicit error
//   6.  per-row transactional isolation with abort-on-error — first failure stops migration
//   7.  resume from pre-populated checkpoint — pre-seeded done set skips those IDs
//   8.  reconciliation count/total match — post-migration counts satisfy assertions
//   9.  manualPartReviews defensive abort — pending reviews block migration
//   10. atomicity proof — failure inside tx (UNIQUE billing_number collision) rolls back
//       WCB insert AND billing-number seq increment; BS and seq left unchanged

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appSettings, wetCheckBillings, wetCheckFindings, invoiceItems, billingSheetItems } from "@workspace/db";
import {
  mapStatus,
  runMigration,
  migrateRow,
  runReconciliationQueries,
  loadIdSet,
  ensureWcBillingCounterSeeded,
} from "./migrate-bs-wc-to-wet-check-billings";

// ── Fixture IDs ───────────────────────────────────────────────────────────────

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;

// Cleanup registry: tracked across tests so after() can purge everything.
const createdBsIds: number[] = [];
const createdWcIds: number[] = [];
const createdWcbIds: number[] = [];
const createdInvoiceIds: number[] = [];

const TS = Date.now();
const DONE_KEY = "bsWcMigration.done";
const FAILED_KEY = "bsWcMigration.failed";
const FAILED_DETAILS_KEY = "bsWcMigration.failedDetails";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createBsWcFixture(opts: {
  suffix: string;
  status?: string;
  withFinding?: boolean;
  withInvoiceItem?: boolean;
  withBsItem?: boolean;
  withManualPartReview?: boolean;
  wetCheckId?: number;
}): Promise<{ bsId: number; wcId: number }> {
  // Create a wet check if not provided.
  let wcId = opts.wetCheckId ?? 0;
  if (!wcId) {
    const wcRows = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode, total_labor_hours)
      VALUES (${fixtureCompanyId}, ${fixtureCustomerId}, ${fixtureTechId}, 'Mig Tech', 'Mig Customer', 1, 'submitted', 'flat', '2.00')
      RETURNING id
    `);
    wcId = Number(wcRows.rows[0].id);
    createdWcIds.push(wcId);
  }

  // Create a billing_sheet with a BS-WC- prefix.
  const bsRows = await db.execute<{ id: number }>(sql`
    INSERT INTO billing_sheets (
      billing_number, customer_id, customer_name, property_address,
      work_date, technician_name, technician_id, status,
      total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount,
      labor_mode, work_description
    ) VALUES (
      ${'BS-WC-' + TS + '-' + opts.suffix},
      ${fixtureCustomerId}, 'Mig Customer', '123 Test Ln',
      NOW(), 'Mig Tech', ${fixtureTechId}, ${opts.status ?? 'submitted'},
      '2.00', '45.00', '90.00', '0.00', '90.00',
      'flat', 'Wet check repair work'
    )
    RETURNING id
  `);
  const bsId = Number(bsRows.rows[0].id);
  createdBsIds.push(bsId);

  if (opts.withFinding !== false) {
    // Create a zone record and finding linked to this BS.
    const zrRows = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, status, repair_labor_hours)
      VALUES (${wcId}, 'A', 1, 'checked_with_issues', '1.00')
      RETURNING id
    `);
    const zrId = Number(zrRows.rows[0].id);

    await db.execute(sql`
      INSERT INTO wet_check_findings (zone_record_id, wet_check_id, issue_type, issue_group, quantity, labor_hours, resolution, billing_sheet_id)
      VALUES (${zrId}, ${wcId}, 'broken_head', 'quick_fix', 1, '0.50', 'repaired_in_field', ${bsId})
    `);
  }

  if (opts.withInvoiceItem) {
    const invRows = await db.execute<{ id: number }>(sql`
      INSERT INTO invoices (invoice_number, customer_id, customer_name, customer_email, invoice_month, invoice_year, period_start, period_end, status, parts_subtotal, labor_subtotal, total_amount)
      VALUES (${'INV-MIG-' + TS + '-' + opts.suffix}, ${fixtureCustomerId}, 'Mig Customer', 'mig@test.com', 5, 2026, NOW(), NOW(), 'draft', '0.00', '90.00', '90.00')
      RETURNING id
    `);
    const invId = Number(invRows.rows[0].id);
    createdInvoiceIds.push(invId);

    await db.execute(sql`
      INSERT INTO invoice_items (invoice_id, source_type, source_id, billing_sheet_id, work_date, description, labor_hours, labor_rate, labor_total, total_price)
      VALUES (${invId}, 'billing_sheet', ${bsId}, ${bsId}, NOW(), 'Wet check repair', '2.00', '45.00', '90.00', '90.00')
    `);

    // Update billing_sheet to reference invoice.
    await db.execute(sql`UPDATE billing_sheets SET invoice_id = ${invId} WHERE id = ${bsId}`);
  }

  if (opts.withBsItem) {
    await db.execute(sql`
      INSERT INTO billing_sheet_items (billing_sheet_id, part_name, quantity, unit_price, total_price, labor_hours)
      VALUES (${bsId}, 'Hunter Head', '1.00', '12.50', '12.50', '0.00')
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

async function clearCheckpoints(): Promise<void> {
  await db.execute(sql`DELETE FROM app_settings WHERE key IN (${DONE_KEY}, ${FAILED_KEY}, ${FAILED_DETAILS_KEY})`);
}

async function bsExists(bsId: number): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(sql`SELECT id FROM billing_sheets WHERE id = ${bsId}`);
  return rows.rows.length > 0;
}

async function wcbCountForWcId(wcId: number): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM wet_check_billings WHERE wet_check_id = ${wcId}`);
  return Number(rows.rows[0].count);
}

async function findingBsIdCount(bsId: number): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM wet_check_findings WHERE billing_sheet_id = ${bsId}`);
  return Number(rows.rows[0].count);
}

async function findingWcbIdCount(wcbId: number): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM wet_check_findings WHERE wet_check_billing_id = ${wcbId}`);
  return Number(rows.rows[0].count);
}

async function invoiceItemBsIdCount(bsId: number): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM invoice_items WHERE billing_sheet_id = ${bsId}`);
  return Number(rows.rows[0].count);
}

async function bsiCount(bsId: number): Promise<number> {
  const rows = await db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM billing_sheet_items WHERE billing_sheet_id = ${bsId}`);
  return Number(rows.rows[0].count);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("migrate-bs-wc-to-wet-check-billings", () => {
  before(async () => {
    const companyRows = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${'BS-WC-Mig Test Co ' + TS}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number(companyRows.rows[0].id);

    const customerRows = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'Mig Customer', ${'mig-' + TS + '@example.com'})
      RETURNING id
    `);
    fixtureCustomerId = Number(customerRows.rows[0].id);

    const userRows = await db.execute<{ id: number }>(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${'mig-tech-' + TS}, 'hashed', 'Mig Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number(userRows.rows[0].id);
  });

  after(async () => {
    await clearCheckpoints();

    // Remove in FK-safe order.
    if (createdWcbIds.length > 0) {
      await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_billing_id = ANY(${createdWcbIds}::int[])`);
      await db.execute(sql`DELETE FROM invoice_items WHERE wet_check_billing_id = ANY(${createdWcbIds}::int[])`);
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ANY(${createdWcbIds}::int[])`);
    }

    // Also clean up any WCBs created by the migration for our wet checks.
    if (createdWcIds.length > 0) {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE wet_check_id = ANY(${createdWcIds}::int[])`);
    }

    // Clean up invoice_items linked to our invoices.
    if (createdInvoiceIds.length > 0) {
      await db.execute(sql`DELETE FROM invoice_items WHERE invoice_id = ANY(${createdInvoiceIds}::int[])`);
      await db.execute(sql`DELETE FROM invoices WHERE id = ANY(${createdInvoiceIds}::int[])`);
    }

    // Clean up BSIs and MPRs for any remaining BS rows.
    if (createdBsIds.length > 0) {
      await db.execute(sql`DELETE FROM manual_part_reviews WHERE billing_sheet_id = ANY(${createdBsIds}::int[])`);
      await db.execute(sql`DELETE FROM billing_sheet_items WHERE billing_sheet_id = ANY(${createdBsIds}::int[])`);
      await db.execute(sql`DELETE FROM wet_check_findings WHERE billing_sheet_id = ANY(${createdBsIds}::int[])`);
      await db.execute(sql`DELETE FROM billing_sheets WHERE id = ANY(${createdBsIds}::int[])`);
    }

    // Zone records.
    if (createdWcIds.length > 0) {
      await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id = ANY(${createdWcIds}::int[])`);
      await db.execute(sql`DELETE FROM wet_checks WHERE id = ANY(${createdWcIds}::int[])`);
    }

    if (fixtureCustomerId) await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    if (fixtureTechId) await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    if (fixtureCompanyId) await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  // ── Test 1: dry-run happy path ──────────────────────────────────────────────

  it("1. dry-run prints reconciliation report and makes no writes", async () => {
    await clearCheckpoints();
    const { bsId, wcId } = await createBsWcFixture({ suffix: "t1" });

    const result = await runMigration({
      dryRun: true,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.equal(result.migrated, 0, "dry-run must not migrate any rows");
    assert.ok(result.preReport.bsWcCount >= 1, "pre-report should see at least the fixture BS-WC row");

    // BS row must still exist.
    assert.ok(await bsExists(bsId), "BS row must NOT be deleted in dry-run");

    // No WCB should have been created.
    assert.equal(await wcbCountForWcId(wcId), 0, "no WCB created in dry-run");

    // Checkpoints must be empty.
    const done = await loadIdSet(DONE_KEY);
    assert.equal(done.has(bsId), false, "done checkpoint must be empty in dry-run");
  });

  // ── Test 2: full migration happy path ──────────────────────────────────────

  it("2. full migration moves BS row to WCB and updates all FKs", async () => {
    await clearCheckpoints();
    const { bsId, wcId } = await createBsWcFixture({
      suffix: "t2",
      status: "submitted",
      withFinding: true,
      withInvoiceItem: true,
      withBsItem: true,
    });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.equal(result.migrated, 1, "exactly one row should be migrated");
    assert.equal(result.failed, 0, "no failures expected");

    // BS row must be gone.
    assert.equal(await bsExists(bsId), false, "BS row must be deleted after migration");

    // WCB must have been created.
    const wcbCount = await wcbCountForWcId(wcId);
    assert.ok(wcbCount >= 1, "at least one WCB row should exist for the wet check");

    // Get the WCB id.
    const wcbRows = await db.execute<{ id: number }>(sql`
      SELECT id FROM wet_check_billings WHERE wet_check_id = ${wcId} ORDER BY id DESC LIMIT 1
    `);
    const wcbId = Number(wcbRows.rows[0].id);
    createdWcbIds.push(wcbId);

    // Findings must now reference the WCB, not the BS.
    assert.equal(await findingBsIdCount(bsId), 0, "no findings should still reference the old BS id");
    assert.ok(await findingWcbIdCount(wcbId) >= 1, "findings should now reference the WCB id");

    // Invoice items FK must be updated.
    assert.equal(await invoiceItemBsIdCount(bsId), 0, "no invoice_items should still reference the BS id");

    // billing_sheet_items must be deleted.
    assert.equal(await bsiCount(bsId), 0, "billing_sheet_items for the BS must be deleted");

    // Done checkpoint must include the BS id.
    const done = await loadIdSet(DONE_KEY);
    assert.ok(done.has(bsId), "done checkpoint must include the migrated BS id");

    // WCB status should be 'submitted' (mapped from 'submitted').
    const wcbDetailRows = await db.execute<{ status: string; billing_number: string }>(sql`
      SELECT status, billing_number FROM wet_check_billings WHERE id = ${wcbId}
    `);
    assert.equal(wcbDetailRows.rows[0].status, "submitted");
    assert.ok(wcbDetailRows.rows[0].billing_number.startsWith("WC-"), "billing_number must start with WC-");
  });

  // ── Test 3: idempotency re-run ─────────────────────────────────────────────

  it("3. second run with the same BS id in done checkpoint is a no-op", async () => {
    // Pre-seed the done checkpoint with a fake id that won't exist.
    const fakeId = 9999001;
    const value = JSON.stringify([fakeId]);
    await db
      .insert(appSettings)
      .values({ key: DONE_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });

    const { bsId } = await createBsWcFixture({ suffix: "t3" });

    // First run — should migrate.
    const r1 = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });
    assert.equal(r1.migrated, 1);

    // Second run — bsId is now in done checkpoint, should skip.
    const r2 = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });
    assert.equal(r2.migrated, 0, "second run must not re-migrate the same row");
    assert.equal(r2.failed, 0, "second run must not fail");

    // Clean up WCBs created for this test.
    const wcbRows = await db.execute<{ id: number }>(sql`
      SELECT id FROM wet_check_billings WHERE wet_check_id IN (
        SELECT id FROM wet_checks WHERE customer_id = ${fixtureCustomerId}
      ) ORDER BY id DESC LIMIT 5
    `);
    for (const row of wcbRows.rows) createdWcbIds.push(Number(row.id));
  });

  // ── Test 4: status mapping for all 6 BS status values ──────────────────────

  it("4. mapStatus maps all 6 billing_sheet status values correctly", () => {
    assert.equal(mapStatus("draft"),                    "submitted",                "draft → submitted");
    assert.equal(mapStatus("submitted"),                "submitted",                "submitted → submitted");
    assert.equal(mapStatus("pending_manager_review"),   "pending_manager_review",   "pending_manager_review → pending_manager_review");
    assert.equal(mapStatus("completed"),                "pending_manager_review",   "completed (legacy) → pending_manager_review");
    assert.equal(mapStatus("approved_passed_to_billing"), "approved_passed_to_billing", "approved_passed_to_billing → approved_passed_to_billing");
    assert.equal(mapStatus("billed"),                   "billed",                   "billed → billed");
  });

  it("4b. mapStatus throws for unrecognized status values", () => {
    assert.throws(() => mapStatus("unknown_status"), /unrecognized billing_sheets\.status/);
    assert.throws(() => mapStatus(""),               /unrecognized billing_sheets\.status/);
    assert.throws(() => mapStatus("cancelled"),      /unrecognized billing_sheets\.status/);
  });

  it("4c. mapStatus maps legacy 'approved' to approved_passed_to_billing", () => {
    assert.equal(mapStatus("approved"), "approved_passed_to_billing", "approved (legacy) → approved_passed_to_billing");
  });

  // ── Test 5: orphan BS-WC with no findings ──────────────────────────────────

  it("5. orphan BS-WC with no linked findings aborts with an explicit error", async () => {
    await clearCheckpoints();
    const { bsId } = await createBsWcFixture({ suffix: "t5", withFinding: false });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.equal(result.migrated, 0, "orphan row must not be migrated");
    assert.equal(result.failed, 1, "orphan row must be counted as failed");
    assert.ok(result.failedIds.includes(bsId), "failedIds must include the orphan BS id");

    // BS row must still exist (transaction rolled back).
    assert.ok(await bsExists(bsId), "BS row must still exist after failed migration");
  });

  // ── Test 6: per-row transactional isolation with abort-on-error ─────────────

  it("6. per-row isolation: orphan row fails, abort-on-error stops subsequent rows", async () => {
    await clearCheckpoints();

    // Row 1 — valid, should succeed.
    const { bsId: bsIdGood, wcId: wcIdGood } = await createBsWcFixture({ suffix: "t6-good" });

    // Row 2 — orphan, will fail.
    const { bsId: bsIdBad } = await createBsWcFixture({ suffix: "t6-bad", withFinding: false });

    // Row 3 — valid, but won't be reached because abort-on-error fires after row 2.
    const { bsId: bsIdLate } = await createBsWcFixture({ suffix: "t6-late" });

    // Migrate good first, then bad, then late — ordering by id ascending.
    // Since bsIdGood < bsIdBad < bsIdLate (serial), use --bs-ids filter
    // but don't use bsIdFilter to control ordering, just let it run naturally.
    // Use abortOnError=true (default). The good row comes first, succeeds.
    // The bad row fails and triggers abort. The late row is never processed.
    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsIdGood, bsIdBad, bsIdLate]),
    });

    // Good row was migrated.
    assert.equal(result.migrated, 1, "first valid row should be migrated");
    // Bad row failed.
    assert.equal(result.failed, 1, "orphan row should fail");
    // Because abortOnError=true, processing stopped — late row was not attempted.
    // (migrated + skipped + failed < 3 means late row wasn't reached)
    const totalProcessed = result.migrated + result.skippedAlreadyDone + result.failed;
    assert.ok(totalProcessed < 3, `late row should not be processed (totalProcessed=${totalProcessed})`);

    // Good BS should be gone; bad and late BSes should still exist.
    assert.equal(await bsExists(bsIdGood), false, "good BS must be deleted");
    assert.ok(await bsExists(bsIdBad), "bad BS must still exist");
    assert.ok(await bsExists(bsIdLate), "late BS must still exist (never reached)");

    // Clean up WCBs.
    const wcbRows = await db.execute<{ id: number }>(sql`
      SELECT id FROM wet_check_billings WHERE wet_check_id = ${wcIdGood}
    `);
    for (const row of wcbRows.rows) createdWcbIds.push(Number(row.id));
  });

  // ── Test 7: resume from pre-populated checkpoint ───────────────────────────

  it("7. pre-seeded done checkpoint causes those IDs to be skipped", async () => {
    const { bsId: bsIdAlreadyDone } = await createBsWcFixture({ suffix: "t7-done" });
    const { bsId: bsIdToMigrate } = await createBsWcFixture({ suffix: "t7-migrate" });

    // Pre-seed the done checkpoint with bsIdAlreadyDone.
    // (Simulate a partially completed previous run.)
    // Since that row is still in billing_sheets, we just need to mark it done.
    const value = JSON.stringify([bsIdAlreadyDone]);
    await db
      .insert(appSettings)
      .values({ key: DONE_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsIdAlreadyDone, bsIdToMigrate]),
    });

    assert.equal(result.skippedAlreadyDone, 1, "already-done row must be skipped");
    assert.equal(result.migrated, 1, "the other row must be migrated");

    // Pre-seeded row must still exist in billing_sheets (was never migrated).
    assert.ok(await bsExists(bsIdAlreadyDone), "pre-seeded BS must still exist (skipped)");

    // Migrated row must be gone.
    assert.equal(await bsExists(bsIdToMigrate), false, "migrated BS must be deleted");

    // Collect created WCBs.
    const wcbRows = await db.execute<{ id: number }>(sql`
      SELECT w.id FROM wet_check_billings w
      JOIN wet_checks wc ON wc.id = w.wet_check_id
      WHERE wc.customer_id = ${fixtureCustomerId}
      ORDER BY w.id DESC LIMIT 10
    `);
    for (const row of wcbRows.rows) createdWcbIds.push(Number(row.id));
  });

  // ── Test 8: reconciliation count/total match ───────────────────────────────

  it("8. post-migration reconciliation assertions pass (counts match, no dangling FKs)", async () => {
    await clearCheckpoints();
    const { bsId } = await createBsWcFixture({
      suffix: "t8",
      status: "pending_manager_review",
      withFinding: true,
    });

    const preReport = await runReconciliationQueries();

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.ok(result.assertionsPassed, "all post-run assertions must pass");
    assert.equal(result.migrated, 1);
    assert.equal(result.failed, 0);

    const postReport = await runReconciliationQueries();

    // WCB count increased by 1.
    assert.equal(postReport.wcbCount, preReport.wcbCount + 1);

    // No dangling FK references.
    assert.equal(postReport.danglingFindingsBsWcId, 0, "no dangling findings FKs");
    assert.equal(postReport.danglingInvoiceItemsBsWcId, 0, "no dangling invoice_items FKs");

    // Collect WCBs for cleanup.
    const wcbRows = await db.execute<{ id: number }>(sql`
      SELECT w.id FROM wet_check_billings w
      JOIN wet_checks wc ON wc.id = w.wet_check_id
      WHERE wc.customer_id = ${fixtureCustomerId}
      ORDER BY w.id DESC LIMIT 10
    `);
    for (const row of wcbRows.rows) createdWcbIds.push(Number(row.id));
  });

  // ── Test 9: manualPartReviews defensive abort ──────────────────────────────

  it("9. BS-WC with pending manual_part_reviews aborts and leaves row untouched", async () => {
    await clearCheckpoints();
    const { bsId, wcId } = await createBsWcFixture({
      suffix: "t9",
      status: "submitted",
      withFinding: true,
      withManualPartReview: true,
    });

    const result = await runMigration({
      dryRun: false,
      batchSize: 50,
      abortOnError: true,
      bsIdFilter: new Set([bsId]),
    });

    assert.equal(result.migrated, 0, "row with pending manual_part_reviews must not be migrated");
    assert.equal(result.failed, 1, "row must be counted as failed");
    assert.ok(result.failedIds.includes(bsId));

    // BS row must still be intact.
    assert.ok(await bsExists(bsId), "BS row must still exist (transaction rolled back)");

    // No WCB created for this wet check.
    assert.equal(await wcbCountForWcId(wcId), 0, "no WCB must have been created");
  });

  // ── Test 10: atomicity proof ───────────────────────────────────────────────
  //
  // Forces a failure AFTER the billing-number counter has been incremented and
  // AFTER the WCB INSERT is attempted — by pre-inserting a WCB row with the
  // billing_number that the migration will allocate next. The UNIQUE constraint
  // on billing_number causes the INSERT to fail, which rolls back the entire
  // transaction: the WCB insert is undone AND the seq increment is undone.
  //
  // Post-assertions:
  //   - BS row still exists (not deleted)
  //   - billing_number_counters.last_seq unchanged (seq rolled back)
  //   - No extra WCB row was created (only the collision row we pre-inserted)
  //   - wet_check_findings still reference the BS (FK updates rolled back)

  it("10. tx failure after billing-number allocation rolls back WCB insert and seq increment", async () => {
    await clearCheckpoints();
    await ensureWcBillingCounterSeeded();

    const { bsId, wcId } = await createBsWcFixture({
      suffix: "t10",
      status: "submitted",
      withFinding: true,
    });

    const year = new Date().getFullYear();
    const prefix = `WC-${year}-`;

    // Read the current seq so we know what the next allocated number will be.
    const seqResult = await db.execute<{ last_seq: string }>(sql`
      SELECT last_seq FROM billing_number_counters WHERE prefix = ${prefix}
    `);
    const seqBefore = Number(seqResult.rows[0]?.last_seq ?? 0);
    const nextNumber = `${prefix}${(seqBefore + 1).toString().padStart(4, "0")}`;

    // Pre-insert a WCB with the billing_number that will be allocated next.
    // This creates the collision that will force the migration tx to fail.
    const collisionRows = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_check_billings (billing_number, customer_name, work_date, technician_name, wet_check_id, status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount, no_photos_needed)
      VALUES (${nextNumber}, 'Collision Row', NOW(), 'Collision Tech', ${wcId}, 'submitted', '0.00', '45.00', '0.00', '0.00', '0.00', false)
      RETURNING id
    `);
    const collisionWcbId = Number(collisionRows.rows[0].id);
    createdWcbIds.push(collisionWcbId);

    // migrateRow must throw due to the UNIQUE violation.
    await assert.rejects(
      () => migrateRow(bsId),
      (err: unknown) => {
        // Postgres UNIQUE violation error code is 23505.
        const msg = err instanceof Error ? err.message : String(err);
        return msg.includes("unique") || msg.includes("duplicate") || msg.includes("23505");
      },
      "migrateRow must throw on billing_number UNIQUE constraint violation",
    );

    // BS row must still exist — transaction was fully rolled back.
    assert.ok(await bsExists(bsId), "BS row must still exist after failed tx");

    // The billing_number_counters seq must be back to seqBefore — the UPDATE
    // inside the failed tx was rolled back.
    const seqAfterResult = await db.execute<{ last_seq: string }>(sql`
      SELECT last_seq FROM billing_number_counters WHERE prefix = ${prefix}
    `);
    const seqAfter = Number(seqAfterResult.rows[0]?.last_seq ?? 0);
    assert.equal(seqAfter, seqBefore, "seq increment must be rolled back after tx failure");

    // Exactly one WCB for this wcId — the collision row we pre-inserted, nothing extra.
    assert.equal(await wcbCountForWcId(wcId), 1, "only the pre-inserted collision WCB must exist");

    // Findings still reference the BS (FK update was rolled back).
    assert.ok(await findingBsIdCount(bsId) >= 1, "findings must still reference the BS after tx rollback");
  });
});

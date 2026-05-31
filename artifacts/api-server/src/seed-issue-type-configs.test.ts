/**
 * B2a — Issue type configs seeder tests.
 *
 * Verifies:
 *  - seedIssueTypeConfigsForCompany inserts the expected count per company
 *  - A second run (idempotent) inserts 0 rows
 *  - seedIssueTypeConfigsForActiveCompanies covers all active companies
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { WET_CHECK_ISSUE_TYPE_SEED } from "@workspace/db";
import { seedIssueTypeConfigsForCompany } from "./seeds/issue-type-configs";
import { seedIssueTypeConfigsForActiveCompanies } from "./seed-issue-type-configs";

const TAG = `seed-itc-${Date.now()}`;
const SEED_COUNT = WET_CHECK_ISSUE_TYPE_SEED.length;

// Companies created once for the entire file; both suites share them.
let cid1: number;
let cid2: number;

async function countConfigs(companyId: number): Promise<number> {
  const res = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM issue_type_configs WHERE company_id = ${companyId}
  `);
  return Number((res.rows[0] as { cnt: string }).cnt);
}

before(async () => {
  const co1 = await db.execute(sql`
    INSERT INTO companies (name, subscription, is_active)
    VALUES (${`SeedTestCo1_${TAG}`}, 'basic', true)
    RETURNING id
  `);
  cid1 = Number((co1.rows[0] as { id: number }).id);

  const co2 = await db.execute(sql`
    INSERT INTO companies (name, subscription, is_active)
    VALUES (${`SeedTestCo2_${TAG}`}, 'basic', true)
    RETURNING id
  `);
  cid2 = Number((co2.rows[0] as { id: number }).id);
});

after(async () => {
  await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id IN (${cid1}, ${cid2})`);
  await db.execute(sql`DELETE FROM companies WHERE id IN (${cid1}, ${cid2})`);
});

describe("seedIssueTypeConfigsForCompany — per-company seeder", () => {
  before(async () => {
    // Start each sub-suite clean.
    await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id IN (${cid1}, ${cid2})`);
  });

  it("inserts exactly SEED_COUNT rows on first run", async () => {
    const inserted = await seedIssueTypeConfigsForCompany(cid1);
    assert.equal(inserted, SEED_COUNT,
      `first run should insert all ${SEED_COUNT} seed rows`);
    const count = await countConfigs(cid1);
    assert.equal(count, SEED_COUNT);
  });

  it("inserts 0 rows on second run (idempotent)", async () => {
    const inserted = await seedIssueTypeConfigsForCompany(cid1);
    assert.equal(inserted, 0, "second run must insert 0 rows (ON CONFLICT DO NOTHING)");
    const count = await countConfigs(cid1);
    assert.equal(count, SEED_COUNT, "row count unchanged after idempotent re-run");
  });

  it("does NOT overwrite a customized row on re-run", async () => {
    await db.execute(sql`
      UPDATE issue_type_configs
      SET default_labor_hours = '9.99'
      WHERE company_id = ${cid1} AND issue_type = 'nozzle_replacement'
    `);

    await seedIssueTypeConfigsForCompany(cid1);

    const res = await db.execute(sql`
      SELECT default_labor_hours FROM issue_type_configs
      WHERE company_id = ${cid1} AND issue_type = 'nozzle_replacement'
    `);
    const val = String((res.rows[0] as { default_labor_hours: string }).default_labor_hours);
    assert.equal(val, "9.99", "customized row must not be overwritten by re-seed");
  });

  it("seeds a second company independently", async () => {
    const inserted = await seedIssueTypeConfigsForCompany(cid2);
    assert.equal(inserted, SEED_COUNT, "second company seeds its own rows");
    const count = await countConfigs(cid2);
    assert.equal(count, SEED_COUNT);
  });
});

describe("seedIssueTypeConfigsForActiveCompanies — bulk seeder", () => {
  before(async () => {
    // Clear both test companies so the bulk seeder must re-insert.
    await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id IN (${cid1}, ${cid2})`);
  });

  it("seeds all active companies in one call", async () => {
    await seedIssueTypeConfigsForActiveCompanies();
    const count1 = await countConfigs(cid1);
    const count2 = await countConfigs(cid2);
    assert.ok(count1 >= SEED_COUNT, `company 1 should have at least ${SEED_COUNT} configs, got ${count1}`);
    assert.ok(count2 >= SEED_COUNT, `company 2 should have at least ${SEED_COUNT} configs, got ${count2}`);
  });

  it("bulk seeder is also idempotent", async () => {
    const count1Before = await countConfigs(cid1);
    await seedIssueTypeConfigsForActiveCompanies();
    const count1After = await countConfigs(cid1);
    assert.equal(count1After, count1Before, "row count must not grow on second bulk seed run");
  });
});

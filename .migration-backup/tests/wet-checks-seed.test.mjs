import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WET_CHECK_ISSUE_TYPE_SEED } from "../shared/schema.ts";
import { seedIssueTypeConfigsForActiveCompanies } from "../server/seed-issue-type-configs.ts";
import { pool } from "../server/db.ts";

const BASE_URL = "http://localhost:5000";
const HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

async function api(method, path) {
  const res = await fetch(`${BASE_URL}${path}`, { method, headers: { ...HEADERS } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function fetchPerCompanyCounts() {
  const result = await pool.query(`
    SELECT c.id AS company_id, COUNT(itc.id)::int AS cnt
    FROM companies c
    LEFT JOIN issue_type_configs itc ON itc.company_id = c.id
    WHERE c.is_active = TRUE
    GROUP BY c.id
    ORDER BY c.id
  `);
  return result.rows;
}

async function fetchPerCompanyTypes(companyId) {
  const result = await pool.query(
    `SELECT issue_type FROM issue_type_configs WHERE company_id = $1 ORDER BY issue_type`,
    [companyId],
  );
  return result.rows.map((r) => r.issue_type);
}

describe("Wet check capture: per-company issue-type seed", () => {
  test("seed produces exactly 10 issue type configs per active company with no duplicates", async () => {
    assert.equal(WET_CHECK_ISSUE_TYPE_SEED.length, 10,
      `Seed list itself must define exactly 10 issue types, got ${WET_CHECK_ISSUE_TYPE_SEED.length}`);

    const counts = await fetchPerCompanyCounts();
    assert.ok(counts.length >= 1, "Test environment must have at least one active company");

    for (const { company_id, cnt } of counts) {
      assert.equal(cnt, 10,
        `Active company ${company_id} must have exactly 10 issue type configs, got ${cnt}`);
      const types = await fetchPerCompanyTypes(company_id);
      const unique = new Set(types);
      assert.equal(unique.size, types.length,
        `Issue types for company ${company_id} must be unique (no duplicates), got: ${JSON.stringify(types)}`);
      const seedTypes = new Set(WET_CHECK_ISSUE_TYPE_SEED.map((s) => s.issueType));
      for (const t of types) {
        assert.ok(seedTypes.has(t),
          `Company ${company_id} has unexpected issue_type ${t} not in SEED`);
      }
    }
  });

  test("HTTP endpoint exposes the seeded rows with matching shape", async () => {
    const res = await api("GET", "/api/wet-checks/issue-types");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 10);
    for (const seed of WET_CHECK_ISSUE_TYPE_SEED) {
      const row = res.body.find((r) => r.issueType === seed.issueType);
      assert.ok(row, `Missing seeded issue type "${seed.issueType}"`);
      assert.equal(row.issueGroup, seed.issueGroup);
      assert.equal(String(row.defaultLaborHours), seed.defaultLaborHours);
    }
  });

  test("seed function is safe to re-run — re-invoking does not duplicate rows", async () => {
    // Capture the per-company state, then run the seed function twice
    // back-to-back. ON CONFLICT DO NOTHING must keep every active company
    // pinned at exactly SEED.length rows.
    const before = await fetchPerCompanyCounts();
    assert.ok(before.length >= 1, "Test environment must have at least one active company");

    await seedIssueTypeConfigsForActiveCompanies();
    await seedIssueTypeConfigsForActiveCompanies();

    const after = await fetchPerCompanyCounts();
    assert.equal(after.length, before.length,
      `Number of active companies should not change across re-runs (was ${before.length}, now ${after.length})`);

    for (const row of after) {
      assert.equal(row.cnt, 10,
        `After re-running the seed, company ${row.company_id} must still have exactly 10 issue type configs, got ${row.cnt}`);
    }
  });
});

/**
 * needs-review-pending-wcb.test.ts
 *
 * Verifies the PENDING_REVIEW_WCB fix: the Needs Review queue must NOT include
 * wet checks whose snapshot is already approved (approved_passed_to_billing or
 * billed). Only pre-approval statuses (submitted, pending_manager_review) should
 * qualify via Rule 3.
 *
 * Tests:
 *   Section A — pure set-membership (no DB)
 *     A1. PENDING_REVIEW_WCB contains submitted and pending_manager_review only
 *     A2. ACTIVE_WCB still contains approved_passed_to_billing (billing unchanged)
 *     A3. PENDING_REVIEW_WCB is a strict subset of ACTIVE_WCB
 *     A4. approved_passed_to_billing is NOT in PENDING_REVIEW_WCB
 *     A5. billed is NOT in PENDING_REVIEW_WCB
 *
 *   Section B — live DB: SQL filter mirrors the needs-review Step 1 query
 *     B1. WCB with status=submitted        → returned by PENDING_REVIEW_WCB filter
 *     B2. WCB with status=pending_manager_review → returned
 *     B3. WCB with status=approved_passed_to_billing → NOT returned
 *     B4. WCB with status=billed           → NOT returned
 *     B5. Exactly 2 of our 4 seeded WCBs pass the filter (submitted + pmr only)
 *     B6. ACTIVE_WCB filter still returns all 3 non-billed WCBs (billing unchanged)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, inArray } from "drizzle-orm";

import { ACTIVE_WCB, PENDING_REVIEW_WCB } from "./billing-workspace-routes";
import { db } from "../db";
import { wetCheckBillings } from "@workspace/db/schema";

// ─── Scratch IDs (far from real data) ────────────────────────────────────────
// WCB ids are auto-assigned (serial); we identify rows by wet_check_id.

const S = {
  companyId: 2,
  customerId: 80100,
  techId:     80100,

  wc_submitted: 80101,
  wc_pmr:       80102,
  wc_aptb:      80103,
  wc_billed:    80104,
};

const ALL_WC_IDS = [S.wc_submitted, S.wc_pmr, S.wc_aptb, S.wc_billed];

async function seed() {
  // customer
  await db.execute(sql`
    INSERT INTO customers (id, company_id, name, email, labor_rate)
    VALUES (${S.customerId}, ${S.companyId}, 'NeedsReview Test Customer', 'nrtest@test.local', '55.00')
    ON CONFLICT (id) DO UPDATE SET labor_rate = '55.00'
  `);
  // technician
  await db.execute(sql`
    INSERT INTO users (id, username, password, name, role, company_id)
    VALUES (${S.techId}, 'nrtest-tech-80100', 'hashed', 'NR Tech', 'field_tech', ${S.companyId})
    ON CONFLICT (id) DO NOTHING
  `);
  // four wet checks (one per WCB status scenario)
  for (const id of ALL_WC_IDS) {
    await db.execute(sql`
      INSERT INTO wet_checks (
        id, company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at
      ) VALUES (
        ${id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'NR Tech',
        'NeedsReview Test Customer', 1, 'converted', 'flat', '0.00', now()
      )
      ON CONFLICT (id) DO NOTHING
    `);
  }
  // four WCBs — one in each status; id is serial so we identify rows by wet_check_id
  const wcbRows = [
    { wcId: S.wc_submitted, status: "submitted",                num: "WCB-NR-01" },
    { wcId: S.wc_pmr,       status: "pending_manager_review",   num: "WCB-NR-02" },
    { wcId: S.wc_aptb,      status: "approved_passed_to_billing", num: "WCB-NR-03" },
    { wcId: S.wc_billed,    status: "billed",                   num: "WCB-NR-04" },
  ] as const;
  for (const row of wcbRows) {
    await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address,
        work_date, technician_name, technician_id, wet_check_id,
        status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
        total_amount, photos
      ) VALUES (
        ${row.num}, ${S.customerId}, 'NeedsReview Test Customer', '1 Test St',
        '2026-06-16', 'NR Tech', ${S.techId}, ${row.wcId},
        ${row.status}, '1.00', '55.00', '55.00', '0.00', '55.00', '{}'
      )
      ON CONFLICT (billing_number) DO UPDATE SET status = EXCLUDED.status
    `);
  }
}

async function cleanup() {
  await db.execute(sql`DELETE FROM wet_check_billings WHERE billing_number LIKE 'WCB-NR-0%'`);
  await db.execute(sql`DELETE FROM wet_checks WHERE id = ANY(${sql`ARRAY[${sql.join(ALL_WC_IDS.map(id => sql`${id}`), sql`, `)}]::int[]`})`);
  await db.execute(sql`DELETE FROM customers WHERE id = ${S.customerId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${S.techId}`);
}

// ─── helper: fetch our seeded WCBs by wet_check_id ───────────────────────────

async function ourWcbs() {
  return db
    .select({ wetCheckId: wetCheckBillings.wetCheckId, status: wetCheckBillings.status })
    .from(wetCheckBillings)
    .where(inArray(wetCheckBillings.wetCheckId, ALL_WC_IDS));
}

// ─── Section A: pure set-membership ──────────────────────────────────────────

describe("PENDING_REVIEW_WCB set membership (no DB)", () => {
  it("A1: contains submitted and pending_manager_review only", () => {
    assert.ok(PENDING_REVIEW_WCB.has("submitted"), "must include submitted");
    assert.ok(PENDING_REVIEW_WCB.has("pending_manager_review"), "must include pending_manager_review");
    assert.equal(PENDING_REVIEW_WCB.size, 2, "must have exactly 2 members");
  });

  it("A2: ACTIVE_WCB still contains approved_passed_to_billing (billing unchanged)", () => {
    assert.ok(
      ACTIVE_WCB.has("approved_passed_to_billing"),
      "ACTIVE_WCB must still include approved_passed_to_billing for billing workspace",
    );
  });

  it("A3: PENDING_REVIEW_WCB is a strict subset of ACTIVE_WCB", () => {
    for (const status of PENDING_REVIEW_WCB) {
      assert.ok(ACTIVE_WCB.has(status), `ACTIVE_WCB must contain ${status}`);
    }
    assert.ok(
      PENDING_REVIEW_WCB.size < ACTIVE_WCB.size,
      "PENDING_REVIEW_WCB must be strictly smaller than ACTIVE_WCB",
    );
  });

  it("A4: approved_passed_to_billing is NOT in PENDING_REVIEW_WCB", () => {
    assert.ok(
      !PENDING_REVIEW_WCB.has("approved_passed_to_billing"),
      "approved_passed_to_billing must NOT be in PENDING_REVIEW_WCB",
    );
  });

  it("A5: billed is NOT in PENDING_REVIEW_WCB", () => {
    assert.ok(!PENDING_REVIEW_WCB.has("billed"), "billed must NOT be in PENDING_REVIEW_WCB");
  });
});

// ─── Section B: live DB — SQL filter ─────────────────────────────────────────

describe("Needs Review SQL filter uses PENDING_REVIEW_WCB (live DB)", () => {
  before(seed);
  after(cleanup);

  it("B1: submitted WCB is returned by PENDING_REVIEW_WCB SQL filter", async () => {
    const rows = await db
      .select({ wetCheckId: wetCheckBillings.wetCheckId })
      .from(wetCheckBillings)
      .where(inArray(wetCheckBillings.status, [...PENDING_REVIEW_WCB]));
    const wcIds = rows.map(r => r.wetCheckId);
    assert.ok(wcIds.includes(S.wc_submitted), "submitted WCB must be in result");
  });

  it("B2: pending_manager_review WCB is returned by PENDING_REVIEW_WCB SQL filter", async () => {
    const rows = await db
      .select({ wetCheckId: wetCheckBillings.wetCheckId })
      .from(wetCheckBillings)
      .where(inArray(wetCheckBillings.status, [...PENDING_REVIEW_WCB]));
    const wcIds = rows.map(r => r.wetCheckId);
    assert.ok(wcIds.includes(S.wc_pmr), "pending_manager_review WCB must be in result");
  });

  it("B3: approved_passed_to_billing WCB is NOT returned by PENDING_REVIEW_WCB SQL filter", async () => {
    const rows = await db
      .select({ wetCheckId: wetCheckBillings.wetCheckId })
      .from(wetCheckBillings)
      .where(inArray(wetCheckBillings.status, [...PENDING_REVIEW_WCB]));
    const wcIds = rows.map(r => r.wetCheckId);
    assert.ok(
      !wcIds.includes(S.wc_aptb),
      "approved_passed_to_billing WCB must NOT appear in PENDING_REVIEW_WCB filter results",
    );
  });

  it("B4: billed WCB is NOT returned by PENDING_REVIEW_WCB SQL filter", async () => {
    const rows = await db
      .select({ wetCheckId: wetCheckBillings.wetCheckId })
      .from(wetCheckBillings)
      .where(inArray(wetCheckBillings.status, [...PENDING_REVIEW_WCB]));
    const wcIds = rows.map(r => r.wetCheckId);
    assert.ok(
      !wcIds.includes(S.wc_billed),
      "billed WCB must NOT appear in PENDING_REVIEW_WCB filter results",
    );
  });

  it("B5: exactly 2 of our 4 seeded WCBs pass the filter (submitted + pmr only)", async () => {
    const rows = await db
      .select({ wetCheckId: wetCheckBillings.wetCheckId })
      .from(wetCheckBillings)
      .where(inArray(wetCheckBillings.status, [...PENDING_REVIEW_WCB]));
    const ourMatches = rows.filter(r => r.wetCheckId != null && ALL_WC_IDS.includes(r.wetCheckId));
    assert.equal(
      ourMatches.length,
      2,
      `expected exactly 2 matches (submitted + pending_manager_review), got ${ourMatches.length}`,
    );
    const matchWcIds = ourMatches.map(r => r.wetCheckId).sort((a, b) => (a ?? 0) - (b ?? 0));
    assert.deepEqual(
      matchWcIds,
      [S.wc_submitted, S.wc_pmr].sort((a, b) => a - b),
    );
  });

  it("B6: ACTIVE_WCB filter returns all 3 non-billed WCBs (billing workspace unchanged)", async () => {
    const rows = await db
      .select({ wetCheckId: wetCheckBillings.wetCheckId })
      .from(wetCheckBillings)
      .where(inArray(wetCheckBillings.status, [...ACTIVE_WCB]));
    const ourMatches = rows.filter(r => r.wetCheckId != null && ALL_WC_IDS.includes(r.wetCheckId));
    assert.equal(
      ourMatches.length,
      3,
      `ACTIVE_WCB must still match submitted + pmr + aptb; got ${ourMatches.length}`,
    );
  });
});

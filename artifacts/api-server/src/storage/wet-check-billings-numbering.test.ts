// Task #783 — WC Billing Slice 10: wet_check_billings numbering tests.
//
// Verifies:
//   1. First call returns WC-${currentYear}-1000
//   2. Second call returns WC-${currentYear}-1001
//   3. Exactly one counter row exists after both calls
//   4. Seed bootstrap is idempotent (second instance does not reset counter)

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { DatabaseStorage } from "../storage";

const currentYear = new Date().getFullYear();
const prefix = `WC-${currentYear}-`;

describe("getNextWetCheckBillingNumber — WC-YYYY- sequence", () => {
  before(async () => {
    // Remove any existing counter row for this prefix so the test starts clean.
    // Uses raw SQL to avoid importing the schema table into the test.
    await db.execute(
      sql`DELETE FROM billing_number_counters WHERE prefix = ${prefix}`,
    );
  });

  after(async () => {
    // Clean up the counter row produced during the test run.
    await db.execute(
      sql`DELETE FROM billing_number_counters WHERE prefix = ${prefix}`,
    );
  });

  it("first call returns WC-YYYY-1000", async () => {
    const s = new DatabaseStorage();
    const num = await s.getNextWetCheckBillingNumber();
    assert.equal(num, `${prefix}1000`);
  });

  it("second call (same instance) returns WC-YYYY-1001", async () => {
    // Re-use same instance — memoization flags are already set; the
    // counter row was seeded in the previous test, so ON CONFLICT DO NOTHING
    // is a no-op and the sequence continues.
    const s = new DatabaseStorage();
    // The prefix was already seeded in the previous test; ensure the row exists
    // before calling (it does — the test above created it).
    const num = await s.getNextWetCheckBillingNumber();
    assert.equal(num, `${prefix}1001`);
  });

  it("exactly one counter row exists for the WC-YYYY- prefix after both calls", async () => {
    const rows = await db.execute(
      sql`SELECT count(*)::int AS cnt FROM billing_number_counters WHERE prefix = ${prefix}`,
    );
    const cnt = Number((rows.rows[0] as { cnt: number }).cnt);
    assert.equal(cnt, 1);
  });

  it("seed bootstrap is idempotent — a fresh instance after seeding does not reset last_seq", async () => {
    // Read current last_seq (should be 1001 after the two increments above).
    const before = await db.execute(
      sql`SELECT last_seq FROM billing_number_counters WHERE prefix = ${prefix}`,
    );
    const seqBefore = Number((before.rows[0] as { last_seq: number }).last_seq);

    // Create a fresh storage instance — its _wetCheckCounterPrefixSeeded set is
    // empty, so it will re-run the INSERT … ON CONFLICT DO NOTHING bootstrap.
    // This must NOT reset last_seq back to 999.
    const fresh = new DatabaseStorage();
    await fresh.getNextWetCheckBillingNumber();

    const after = await db.execute(
      sql`SELECT last_seq FROM billing_number_counters WHERE prefix = ${prefix}`,
    );
    const seqAfter = Number((after.rows[0] as { last_seq: number }).last_seq);

    // The counter must have advanced by exactly 1 (the increment from the call
    // above), not reset to 1000.
    assert.equal(seqAfter, seqBefore + 1);
    assert.ok(seqAfter >= 1002, `expected seq >= 1002, got ${seqAfter}`);
  });
});

// Tests for the ensureIrrigationControllers redirect.
//
// Verifies that:
//  1. ensureIrrigationControllers creates irrigation_controllers rows (not property_controllers).
//  2. Zone placeholder rows (irrigation_profile_zones) are seeded 1..DEFAULT_ZONE_COUNT.
//  3. A second call for the same tuple is a no-op (idempotent).
//  4. The zone-count trim in updateIrrigationController removes only empty trailing zones.
//
// All tests hit the real dev DB (shared pattern) and clean up after themselves.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

// Use a stable (companyId, customerId) pair that won't collide with live data.
// companyId 999999 is guaranteed to have no real company in dev.
const TEST_COMPANY_ID = 999999;
const TEST_CUSTOMER_ID = 999998;

async function cleanup() {
  await db.execute(sql`
    DELETE FROM irrigation_profile_zones
    WHERE company_id = ${TEST_COMPANY_ID}
  `);
  await db.execute(sql`
    DELETE FROM irrigation_controllers
    WHERE company_id = ${TEST_COMPANY_ID}
  `);
}

describe("ensureIrrigationControllers — basic seeding", () => {
  before(cleanup);
  after(cleanup);

  it("seeds irrigation_controllers rows for count=2 (A, B)", async () => {
    const rows = await storage.ensureIrrigationControllers(
      TEST_COMPANY_ID,
      TEST_CUSTOMER_ID,
      2,
      null,
    );

    assert.equal(rows.length, 2);
    const names = rows.map((r) => r.name).sort();
    assert.deepEqual(names, ["Controller A", "Controller B"]);
    assert.equal(rows[0].companyId, TEST_COMPANY_ID);
    assert.equal(rows[0].customerId, TEST_CUSTOMER_ID);
    assert.equal(rows[0].totalZones, 12, "default totalZones should be 12");
  });

  it("seeds irrigation_profile_zones placeholder rows for each controller", async () => {
    const zoneRows = await db.execute<{ controller_id: string; zone_number: string }>(sql`
      SELECT ic.id AS controller_id, ipz.zone_number
      FROM irrigation_controllers ic
      JOIN irrigation_profile_zones ipz ON ipz.controller_id = ic.id
      WHERE ic.company_id  = ${TEST_COMPANY_ID}
        AND ic.customer_id = ${TEST_CUSTOMER_ID}
      ORDER BY ic.name, ipz.zone_number
    `);

    // 2 controllers × 12 zones each = 24 placeholder rows
    assert.equal(zoneRows.rows.length, 24);
  });
});

describe("ensureIrrigationControllers — idempotency", () => {
  before(cleanup);
  after(cleanup);

  it("calling twice for the same tuple creates no duplicate rows", async () => {
    await storage.ensureIrrigationControllers(TEST_COMPANY_ID, TEST_CUSTOMER_ID, 2, null);
    await storage.ensureIrrigationControllers(TEST_COMPANY_ID, TEST_CUSTOMER_ID, 2, null);

    const ctrlCount = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*) AS cnt FROM irrigation_controllers
      WHERE company_id = ${TEST_COMPANY_ID} AND customer_id = ${TEST_CUSTOMER_ID}
    `);
    assert.equal(Number(ctrlCount.rows[0]?.cnt), 2, "should still have exactly 2 controllers");
  });

  it("growing count adds missing letters without duplicating existing ones", async () => {
    await storage.ensureIrrigationControllers(TEST_COMPANY_ID, TEST_CUSTOMER_ID, 2, null);
    const rows = await storage.ensureIrrigationControllers(TEST_COMPANY_ID, TEST_CUSTOMER_ID, 3, null);

    assert.equal(rows.length, 3);
    const names = rows.map((r) => r.name).sort();
    assert.deepEqual(names, ["Controller A", "Controller B", "Controller C"]);
  });
});

describe("ensureIrrigationControllers — branch isolation", () => {
  before(cleanup);
  after(cleanup);

  it("seeds with branchName scoped separately from the null branch", async () => {
    const nullBranch = await storage.ensureIrrigationControllers(
      TEST_COMPANY_ID, TEST_CUSTOMER_ID, 1, null,
    );
    const namedBranch = await storage.ensureIrrigationControllers(
      TEST_COMPANY_ID, TEST_CUSTOMER_ID, 1, "East",
    );

    assert.equal(nullBranch.length, 1);
    assert.equal(namedBranch.length, 1);
    assert.equal(nullBranch[0].branchName, "");
    assert.equal(namedBranch[0].branchName, "East");
    assert.notEqual(nullBranch[0].id, namedBranch[0].id, "should be distinct rows");
  });
});

describe("updateIrrigationController — non-destructive zone trim", () => {
  let controllerId: number;

  before(async () => {
    await cleanup();
    // Create a controller with 5 empty placeholder zones.
    const [ctrl] = await storage.ensureIrrigationControllers(
      TEST_COMPANY_ID, TEST_CUSTOMER_ID, 1, null,
    );
    controllerId = ctrl!.id;
    // Override totalZones to 5 for our test scenario.
    await db.execute(sql`
      UPDATE irrigation_controllers SET total_zones = 5 WHERE id = ${controllerId}
    `);
    await db.execute(sql`
      DELETE FROM irrigation_profile_zones WHERE controller_id = ${controllerId}
    `);
    // Insert exactly 5 empty placeholder zones.
    for (let z = 1; z <= 5; z++) {
      await db.execute(sql`
        INSERT INTO irrigation_profile_zones
          (company_id, controller_id, zone_number, name, zone_type, run_time_minutes, zone_order, is_active, created_at, updated_at)
        VALUES
          (${TEST_COMPANY_ID}, ${controllerId}, ${z}, ${"Zone " + z}, 'other', 0, ${z}, true, NOW(), NOW())
      `);
    }
  });

  after(cleanup);

  it("shrinking totalZones removes empty trailing zones", async () => {
    await storage.updateIrrigationController(TEST_COMPANY_ID, controllerId, {
      totalZones: 3,
    });

    const remaining = await db.execute<{ zone_number: string }>(sql`
      SELECT zone_number FROM irrigation_profile_zones
      WHERE controller_id = ${controllerId}
      ORDER BY zone_number
    `);
    const nums = remaining.rows.map((r) => Number(r.zone_number));
    assert.deepEqual(nums, [1, 2, 3], "Only zones 1-3 should remain");
  });

  it("shrinking does NOT remove a zone that has non-zero runTimeMinutes", async () => {
    // Reset to 5 zones, make zone 4 have data.
    await db.execute(sql`
      UPDATE irrigation_controllers SET total_zones = 5 WHERE id = ${controllerId}
    `);
    for (let z = 1; z <= 5; z++) {
      await db.execute(sql`
        INSERT INTO irrigation_profile_zones
          (company_id, controller_id, zone_number, name, zone_type, run_time_minutes, zone_order, is_active, created_at, updated_at)
        VALUES
          (${TEST_COMPANY_ID}, ${controllerId}, ${z}, ${"Zone " + z}, 'other', ${z === 4 ? 15 : 0}, ${z}, true, NOW(), NOW())
        ON CONFLICT (company_id, controller_id, zone_number)
        DO UPDATE SET run_time_minutes = EXCLUDED.run_time_minutes
      `);
    }

    await storage.updateIrrigationController(TEST_COMPANY_ID, controllerId, {
      totalZones: 3,
    });

    const remaining = await db.execute<{ zone_number: string }>(sql`
      SELECT zone_number FROM irrigation_profile_zones
      WHERE controller_id = ${controllerId}
      ORDER BY zone_number
    `);
    const nums = remaining.rows.map((r) => Number(r.zone_number));
    // Zone 4 has runTimeMinutes=15 and should be preserved.
    assert.ok(nums.includes(4), "Zone 4 with runTimeMinutes=15 should be preserved");
  });
});

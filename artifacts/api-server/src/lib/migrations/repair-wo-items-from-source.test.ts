// Unit + integration tests for repair-wo-items-from-source migration.
//
// Section A — Pure helper unit tests (no DB):
//   1. money() — NaN, null, empty, Infinity
//   2. signatureKey() — normalises price to 2dp, null partId
//   3. matchActualsToEstimate() — no extras, clean 2× duplication (WO-26 scenario),
//      field-add present, price drift, multi-zone estimate with duplication,
//      all field-adds (nothing matches estimate), empty inputs
//   4. buildOverageReport() — empty match, field-add only, drift only, combined
//   5. buildRebuiltItemsFromEstimate() — structure, zone lineage, NaN guard, multi-zone
//   6. Deprecation guard — old migration's run() refuses with "superseded"
//
// Section B — Integration test (real DB, seeded duplication scenario):
//   7. Seed: estimate (2 items) → WO with 4 items (2× duplication simulated)
//   8. check() reports WO as candidate
//   9. preview() lists WO as auto-repair candidate
//  10. run() without acknowledged → fails
//  11. run(acknowledged=true) → repairs WO to 2 items, totalAmount halved
//  12. WO partsSubtotal updated correctly
//  13. Re-run is idempotent → WO item count unchanged

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  signatureKey,
  matchActualsToEstimate,
  buildOverageReport,
  buildRebuiltItemsFromEstimate,
  type WoItemRow,
  type EstimateItemRow,
} from "./repair-wo-items-from-source";
import { repairDuplicatedWorkOrderItemsMigration } from "./repair-duplicated-work-order-items";
import { repairWoItemsFromSourceMigration } from "./repair-wo-items-from-source";
import { db } from "../../db";
import { sql } from "drizzle-orm";

// ── Helpers ───────────────────────────────────────────────────────────────────

let nextId = 1;
function makeWoItem(overrides: Partial<WoItemRow> & Pick<WoItemRow, "partId">): WoItemRow {
  return {
    id: nextId++,
    partName: overrides.partName ?? "Test Part",
    partPrice: overrides.partPrice ?? "12.50",
    quantity: overrides.quantity ?? 1,
    laborHours: overrides.laborHours ?? "0.00",
    totalPrice: overrides.totalPrice ?? "12.50",
    ...overrides,
  };
}

function makeEstItem(
  overrides: Partial<EstimateItemRow> & Pick<EstimateItemRow, "id" | "partId">,
): EstimateItemRow {
  return {
    partName: "Test Part",
    partPrice: "12.50",
    quantity: 1,
    laborHours: "0.00",
    controllerLetter: null,
    zoneNumber: null,
    issueType: null,
    ...overrides,
  };
}

// ── Section A — money() ───────────────────────────────────────────────────────

describe("money()", () => {
  it("parses valid numeric string", () => { assert.equal(money("12.50"), 12.5); });
  it("returns 0 for 'NaN' string", () => { assert.equal(money("NaN"), 0); });
  it("returns 0 for null", () => { assert.equal(money(null), 0); });
  it("returns 0 for undefined", () => { assert.equal(money(undefined), 0); });
  it("returns 0 for empty string", () => { assert.equal(money(""), 0); });
  it("returns 0 for Infinity", () => { assert.equal(money(Infinity), 0); });
  it("returns 0 for -Infinity", () => { assert.equal(money(-Infinity), 0); });
  it("passes through a finite number", () => { assert.equal(money(99.99), 99.99); });
  it("all degenerate inputs produce finite results", () => {
    for (const v of ["NaN", null, undefined, "", Infinity, -Infinity, "garbage"]) {
      assert.ok(Number.isFinite(money(v)), `money(${String(v)}) must be finite`);
    }
  });
});

// ── Section A — signatureKey() ────────────────────────────────────────────────

describe("signatureKey()", () => {
  it("normalises price to 2dp", () => {
    assert.equal(signatureKey(1, "12.5", 1), "1|12.50|1");
  });
  it("null partId uses empty string prefix", () => {
    assert.equal(signatureKey(null, "45.00", 2), "|45.00|2");
  });
  it("same partId/price/quantity produces same key regardless of zone", () => {
    // Zone is not part of the signature
    const k1 = signatureKey(1, "12.50", 1);
    const k2 = signatureKey(1, "12.50", 1);
    assert.equal(k1, k2);
  });
  it("different quantities produce different keys", () => {
    assert.notEqual(signatureKey(1, "12.50", 1), signatureKey(1, "12.50", 2));
  });
  it("different prices produce different keys", () => {
    assert.notEqual(signatureKey(1, "12.50", 1), signatureKey(1, "13.00", 1));
  });
  it("NaN price coerces to 0.00 in key", () => {
    assert.equal(signatureKey(1, "NaN", 1), "1|0.00|1");
  });
});

// ── Section A — matchActualsToEstimate() ──────────────────────────────────────

describe("matchActualsToEstimate() — empty inputs", () => {
  it("empty WO items → no remaining, no matches", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1 })];
    const r = matchActualsToEstimate([], estItems);
    assert.equal(r.matchedWoIds.size, 0);
    assert.equal(r.remaining.length, 0);
    assert.equal(r.pureDuplicates.length, 0);
  });

  it("empty estimate items → all WO items remain, all are field-adds (partId present)", () => {
    const woItems = [makeWoItem({ partId: 1 })];
    const r = matchActualsToEstimate(woItems, []);
    assert.equal(r.matchedWoIds.size, 0);
    assert.equal(r.remaining.length, 1);
    assert.equal(r.fieldAdds.length, 1);
    assert.equal(r.pureDuplicates.length, 0);
  });
});

describe("matchActualsToEstimate() — exact match (no extras)", () => {
  it("WO item count equals estimate count → all matched, nothing remaining", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 })];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.matchedWoIds.size, 1);
    assert.equal(r.remaining.length, 0);
    assert.equal(r.pureDuplicates.length, 0);
    assert.equal(r.fieldAdds.length, 0);
    assert.equal(r.drifted.length, 0);
  });
});

describe("matchActualsToEstimate() — WO-26 scenario (clean 2× duplication)", () => {
  // Estimate: 2 items (partId=1 zone A, partId=2 zone B)
  // WO after append bug: 4 items — 2 originals (with zone ctx) + 2 appended (no zone ctx)
  // All 4 share same (partId, price, qty) signatures as the estimate items.
  // Expected: 2 matched, 2 remaining as pureDuplicates → canAutoRepair = true

  it("matched count equals estimate count", () => {
    const estItems = [
      makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 }),
      makeEstItem({ id: 2, partId: 2, partPrice: "45.00", quantity: 1 }),
    ];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }), // original (zone ctx)
      makeWoItem({ partId: 2, partPrice: "45.00", quantity: 1 }), // original (zone ctx)
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }), // appended duplicate
      makeWoItem({ partId: 2, partPrice: "45.00", quantity: 1 }), // appended duplicate
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.matchedWoIds.size, 2, "should consume 2 WO items for the 2 estimate items");
    assert.equal(r.remaining.length, 2, "2 remaining (the duplicates)");
    assert.equal(r.pureDuplicates.length, 2, "both remaining are pure duplicates");
    assert.equal(r.fieldAdds.length, 0, "no field-adds");
    assert.equal(r.drifted.length, 0, "no drifted items");
  });

  it("canAutoRepair condition: pureDuplicates > 0, fieldAdds = 0, drifted = 0", () => {
    const estItems = [
      makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 }),
      makeEstItem({ id: 2, partId: 2, partPrice: "45.00", quantity: 1 }),
    ];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "45.00", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "45.00", quantity: 1 }),
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    const canAutoRepair = r.pureDuplicates.length > 0 && r.fieldAdds.length === 0 && r.drifted.length === 0;
    assert.ok(canAutoRepair, "WO-26 scenario must be auto-repairable");
  });

  it("real WO-26 values: $2125.20 estimate, 4 items (zone A+B for 2 parts), 8 WO items after 2× bug", () => {
    // Estimate: partId=1 ($1000, qty=1, zone A), partId=1 ($125.20, qty=1, zone B),
    //           partId=2 ($500, qty=1, zone A), partId=2 ($500, qty=1, zone B)
    const estItems = [
      makeEstItem({ id: 1, partId: 1, partPrice: "1000.00", quantity: 1 }),
      makeEstItem({ id: 2, partId: 1, partPrice: "125.20",  quantity: 1 }),
      makeEstItem({ id: 3, partId: 2, partPrice: "500.00",  quantity: 1 }),
      makeEstItem({ id: 4, partId: 2, partPrice: "500.00",  quantity: 1 }),
    ];
    // Append bug doubles the set → 8 WO items
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "1000.00", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "125.20",  quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "500.00",  quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "500.00",  quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "1000.00", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "125.20",  quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "500.00",  quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "500.00",  quantity: 1 }),
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.matchedWoIds.size, 4);
    assert.equal(r.remaining.length, 4);
    assert.equal(r.pureDuplicates.length, 4, "all 4 extra items are pure duplicates");
    assert.equal(r.fieldAdds.length, 0);
    assert.equal(r.drifted.length, 0);
    const canAutoRepair = r.pureDuplicates.length > 0 && r.fieldAdds.length === 0 && r.drifted.length === 0;
    assert.ok(canAutoRepair, "WO-26 real-values must be auto-repairable");
  });
});

describe("matchActualsToEstimate() — field-add present (partId not in estimate)", () => {
  it("field-added item appears in fieldAdds, not pureDuplicates", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),           // matches estimate
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),           // pure dup
      makeWoItem({ partId: 99, partPrice: "75.00", quantity: 1, partName: "Field cap" }), // field-add
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.fieldAdds.length, 1, "one field-add");
    assert.equal(r.fieldAdds[0].partId, 99);
    assert.equal(r.pureDuplicates.length, 1, "one pure dup for partId=1");
    assert.equal(r.drifted.length, 0);
    // fieldAdds.length > 0 means canAutoRepair is false (the condition requires zero field-adds)
    assert.ok(r.fieldAdds.length > 0, "field-add present — auto-repair must be blocked");
  });
});

describe("matchActualsToEstimate() — price drift (partId in estimate but different price)", () => {
  it("drifted item appears in drifted, not pureDuplicates", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),  // matches estimate
      makeWoItem({ partId: 1, partPrice: "15.00", quantity: 1 }),  // price drift → drifted
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.drifted.length, 1);
    assert.equal(money(r.drifted[0].partPrice), 15.0);
    assert.equal(r.pureDuplicates.length, 0);
    assert.equal(r.fieldAdds.length, 0);
    // drifted.length > 0 means canAutoRepair is false (the condition requires zero drifted)
    assert.ok(r.drifted.length > 0, "price drift present — auto-repair must be blocked");
  });
});

describe("matchActualsToEstimate() — quantity drift (same partId/price, different qty)", () => {
  it("extra item with different quantity goes to drifted", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),  // matches estimate
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 2 }),  // qty drift → drifted
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.drifted.length, 1, "qty-drifted item goes to drifted bucket");
    assert.equal(r.drifted[0].quantity, 2);
  });
});

describe("matchActualsToEstimate() — multi-zone same partId (estimate has 2 rows for same partId)", () => {
  it("both estimate items matched, both remaining are pure duplicates", () => {
    // Estimate: 2 rows for partId=1 (zone A and zone B, same price/qty)
    const estItems = [
      makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1, controllerLetter: "A", zoneNumber: 1 }),
      makeEstItem({ id: 2, partId: 1, partPrice: "12.50", quantity: 1, controllerLetter: "A", zoneNumber: 2 }),
    ];
    // WO has 4 rows for partId=1 (2 original + 2 appended)
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    assert.equal(r.matchedWoIds.size, 2, "2 WO items consumed for 2 estimate items");
    assert.equal(r.pureDuplicates.length, 2, "2 remaining are pure duplicates");
    assert.equal(r.fieldAdds.length, 0);
    assert.equal(r.drifted.length, 0);
    const canAutoRepair = r.pureDuplicates.length > 0 && r.fieldAdds.length === 0 && r.drifted.length === 0;
    assert.ok(canAutoRepair, "multi-zone pure duplication must be auto-repairable");
  });
});

// ── Section A — buildOverageReport() ─────────────────────────────────────────

describe("buildOverageReport() — no extras (empty match)", () => {
  it("returns 'no detail' when fieldAdds and drifted are both empty", () => {
    const match = matchActualsToEstimate([], []);
    const report = buildOverageReport(match, []);
    assert.equal(report, "no detail");
  });
});

describe("buildOverageReport() — field-add only", () => {
  it("report mentions field-add partId and name", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1 })];
    const woItems = [
      makeWoItem({ partId: 1 }),
      makeWoItem({ partId: 99, partName: "Field cap", partPrice: "75.00" }),
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    const report = buildOverageReport(r, estItems);
    assert.match(report, /field-add/);
    assert.match(report, /99/);
  });
});

describe("buildOverageReport() — price drift", () => {
  it("report shows wo_price vs est_price", () => {
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50" })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50" }),
      makeWoItem({ partId: 1, partPrice: "15.00" }),
    ];
    const r = matchActualsToEstimate(woItems, estItems);
    const report = buildOverageReport(r, estItems);
    assert.match(report, /drift/);
    assert.match(report, /15\.00/);
    assert.match(report, /12\.50/);
  });
});

// ── Section A — buildRebuiltItemsFromEstimate() ──────────────────────────────

describe("buildRebuiltItemsFromEstimate() — empty estimate", () => {
  it("returns empty array", () => {
    assert.equal(buildRebuiltItemsFromEstimate(42, []).length, 0);
  });
});

describe("buildRebuiltItemsFromEstimate() — single item structure", () => {
  it("produces one row with correct fields and totalPrice = price × qty", () => {
    const items = buildRebuiltItemsFromEstimate(10, [
      makeEstItem({ id: 1, partId: 7, partPrice: "45.00", quantity: 2, laborHours: "0.50" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].workOrderId, 10);
    assert.equal(items[0].partId, 7);
    assert.equal(items[0].partPrice, "45.00");
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].laborHours, "0.50");
    assert.equal(items[0].totalPrice, "90.00");
    assert.equal(items[0].findingId, null, "findingId always null on rebuilt items");
  });
});

describe("buildRebuiltItemsFromEstimate() — zone lineage preserved", () => {
  it("controllerLetter, zoneNumber, issueType carried through from estimate", () => {
    const items = buildRebuiltItemsFromEstimate(99, [
      makeEstItem({ id: 1, partId: 3, controllerLetter: "B", zoneNumber: 5, issueType: "clogged_nozzle" }),
    ]);
    assert.equal(items[0].controllerLetter, "B");
    assert.equal(items[0].zoneNumber, 5);
    assert.equal(items[0].issueType, "clogged_nozzle");
  });
});

describe("buildRebuiltItemsFromEstimate() — NaN price guard", () => {
  it("NaN partPrice coerced to 0.00 — no NaN in output", () => {
    const items = buildRebuiltItemsFromEstimate(1, [
      makeEstItem({ id: 1, partId: 1, partPrice: "NaN", quantity: 2 }),
    ]);
    assert.equal(items[0].partPrice, "0.00");
    assert.equal(items[0].totalPrice, "0.00");
  });
});

describe("buildRebuiltItemsFromEstimate() — one row per estimate item", () => {
  it("two estimate items → two rebuilt rows with correct totals", () => {
    const items = buildRebuiltItemsFromEstimate(7, [
      makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1, zoneNumber: 1 }),
      makeEstItem({ id: 2, partId: 1, partPrice: "12.50", quantity: 1, zoneNumber: 2 }),
    ]);
    assert.equal(items.length, 2);
    const subtotal = items.reduce((s, it) => s + parseFloat(it.totalPrice), 0);
    assert.ok(Math.abs(subtotal - 25) < 0.01, `expected 25, got ${subtotal}`);
  });
});

// ── Section A — deprecation guard ─────────────────────────────────────────────

describe("repair-duplicated-work-order-items-v1 — deprecated flag + run() refuses", () => {
  it("migration has deprecated=true and a non-empty deprecationReason", () => {
    assert.equal(repairDuplicatedWorkOrderItemsMigration.deprecated, true);
    assert.ok(
      typeof repairDuplicatedWorkOrderItemsMigration.deprecationReason === "string" &&
      repairDuplicatedWorkOrderItemsMigration.deprecationReason.length > 0,
    );
  });

  it("run() returns failed status with 'superseded' in error message", async () => {
    const emitted: Array<{ status: string; error?: string }> = [];
    const results = await repairDuplicatedWorkOrderItemsMigration.run(
      (e) => emitted.push({ status: e.status, error: e.error }),
      { acknowledged: true },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "failed");
    assert.ok(results[0].error?.includes("superseded"), `got: ${results[0].error}`);
  });
});

// ── Section B — Integration tests (real DB) ────────────────────────────────────

const MARKER_KEY = "repairWoItemsFromSource.done";

let seededCompanyId: number | null = null;
let seededCustomerId: number | null = null;
let seededEstimateId: number | null = null;
let seededWoId: number | null = null;
const seededPartIds: number[] = [];

before(async () => {
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${MARKER_KEY}`);
});

after(async () => {
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${MARKER_KEY}`);
  if (seededWoId) {
    await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${seededWoId}`);
    await db.execute(sql`DELETE FROM work_orders WHERE id = ${seededWoId}`);
  }
  if (seededEstimateId) {
    await db.execute(sql`DELETE FROM estimate_items WHERE estimate_id = ${seededEstimateId}`);
    await db.execute(sql`DELETE FROM estimates WHERE id = ${seededEstimateId}`);
  }
  for (const pid of seededPartIds) {
    await db.execute(sql`DELETE FROM parts WHERE id = ${pid}`);
  }
  if (seededCustomerId) {
    await db.execute(sql`DELETE FROM customers WHERE id = ${seededCustomerId}`);
  }
  if (seededCompanyId) {
    await db.execute(sql`DELETE FROM companies WHERE id = ${seededCompanyId}`);
  }
});

describe("repair-wo-items-from-source-v1 — integration: seed + run + verify", () => {
  before(async () => {
    const companyRes = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name, is_active, next_estimate_number, starting_estimate_number)
      VALUES ('TestCo-RWI', true, 1, 1)
      RETURNING id
    `);
    seededCompanyId = companyRes.rows[0].id;

    const custRes = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (company_id, name, email, phone, address, labor_rate)
      VALUES (${seededCompanyId}, 'TestCust-RWI', 'rwi@test.com', '5550000001', '1 Test St', '80.00')
      RETURNING id
    `);
    seededCustomerId = custRes.rows[0].id;

    const p1Res = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, description, price, sku, category, is_active)
      VALUES (${seededCompanyId}, 'RWI-Part-Nozzle', 'test part', '12.50', 'RWI-NOZZLE', 'Nozzle', true)
      RETURNING id
    `);
    const p2Res = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, description, price, sku, category, is_active)
      VALUES (${seededCompanyId}, 'RWI-Part-Valve', 'test part', '45.00', 'RWI-VALVE', 'Valve', true)
      RETURNING id
    `);
    seededPartIds.push(p1Res.rows[0].id, p2Res.rows[0].id);
    const [partNozzleId, partValveId] = seededPartIds;

    // Estimate: 2 items, total = $57.50
    const estRes = await db.execute<{ id: number }>(sql`
      INSERT INTO estimates (
        company_id, customer_id, estimate_number, customer_name, customer_email,
        project_name, status, internal_status, lifecycle,
        labor_mode, total_labor_hours, labor_rate,
        parts_subtotal, labor_subtotal, total_amount
      ) VALUES (
        ${seededCompanyId}, ${seededCustomerId}, 'EST-RWI-001', 'TestCust-RWI', 'rwi@test.com',
        'RWI Test Project', 'approved', 'approved', 'approved',
        'flat', '0', '80.00',
        '57.50', '0.00', '57.50'
      )
      RETURNING id
    `);
    seededEstimateId = estRes.rows[0].id;

    await db.execute(sql`
      INSERT INTO estimate_items (estimate_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${seededEstimateId}, ${partNozzleId}, 'RWI-Part-Nozzle', '12.50', 1, '0.00', '12.50'),
        (${seededEstimateId}, ${partValveId},  'RWI-Part-Valve',  '45.00', 1, '0.00', '45.00')
    `);

    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (
        work_order_number, estimate_id, customer_id, company_id,
        customer_name, customer_email, project_name
      ) VALUES (
        'WO-RWI-001', ${seededEstimateId}, ${seededCustomerId}, ${seededCompanyId},
        'TestCust-RWI', 'rwi@test.com', 'RWI Test Project'
      )
      RETURNING id
    `);
    seededWoId = woRes.rows[0].id;

    // Simulate append bug: 2 original items + 2 duplicates = 4 total
    // All 4 have same (partId, partPrice, quantity) → pure duplicates
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${seededWoId}, ${partNozzleId}, 'RWI-Part-Nozzle', '12.50', 1, '0.00', '12.50'),
        (${seededWoId}, ${partValveId},  'RWI-Part-Valve',  '45.00', 1, '0.00', '45.00'),
        (${seededWoId}, ${partNozzleId}, 'RWI-Part-Nozzle', '12.50', 1, '0.00', '12.50'),
        (${seededWoId}, ${partValveId},  'RWI-Part-Valve',  '45.00', 1, '0.00', '45.00')
    `);
  });

  it("seeded WO has 4 items and $115.00 total", async () => {
    const r = await db.execute<{ cnt: string; total: string }>(sql`
      SELECT COUNT(*)::text AS cnt, SUM(total_price)::text AS total
      FROM work_order_items WHERE work_order_id = ${seededWoId}
    `);
    assert.equal(r.rows[0].cnt, "4");
    assert.ok(Math.abs(parseFloat(r.rows[0].total) - 115) < 0.01);
  });

  it("check() reports the WO as a candidate", async () => {
    const status = await repairWoItemsFromSourceMigration.check();
    assert.ok(
      status.state === "not_started" || status.state === "partially_applied",
      `expected not_started or partially_applied, got ${status.state}`,
    );
  });

  it("preview() lists at least 1 auto-repair candidate", async () => {
    const preview = await repairWoItemsFromSourceMigration.preview();
    assert.ok(
      (preview.orphanRows as { autoRepair?: number }).autoRepair! >= 1 ||
      preview.warnings.some((w) => w.includes("WO-RWI-001")),
      `expected ≥1 auto-repair candidate. orphanRows=${JSON.stringify(preview.orphanRows)}`,
    );
  });

  it("run() without acknowledged=true returns failed status", async () => {
    const results = await repairWoItemsFromSourceMigration.run(() => {}, {});
    assert.equal(results[0].status, "failed");
    assert.ok(results[0].error?.includes("acknowledged"));
  });

  it("run(acknowledged=true) repairs WO — item count drops to 2", async () => {
    const results = await repairWoItemsFromSourceMigration.run(() => {}, { acknowledged: true });
    const failed = results.filter((r) => r.status === "failed");
    assert.equal(
      failed.length,
      0,
      `Failed steps: ${failed.map((r) => `${r.id}: ${r.error}`).join(", ")}`,
    );

    const r = await db.execute<{ cnt: string; total: string }>(sql`
      SELECT COUNT(*)::text AS cnt, SUM(total_price)::text AS total
      FROM work_order_items WHERE work_order_id = ${seededWoId}
    `);
    assert.equal(r.rows[0].cnt, "2", "after repair WO should have 2 items");
    assert.ok(Math.abs(parseFloat(r.rows[0].total) - 57.5) < 0.01, "total should be $57.50");
  });

  it("after repair, WO partsSubtotal updated to $57.50", async () => {
    const r = await db.execute<{ parts_subtotal: string }>(sql`
      SELECT parts_subtotal FROM work_orders WHERE id = ${seededWoId}
    `);
    assert.ok(
      Math.abs(parseFloat(r.rows[0].parts_subtotal) - 57.5) < 0.01,
      `partsSubtotal should be ~57.50, got ${r.rows[0].parts_subtotal}`,
    );
  });

  it("re-run is idempotent — WO item count unchanged", async () => {
    const before = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt FROM work_order_items WHERE work_order_id = ${seededWoId}
    `);
    const results = await repairWoItemsFromSourceMigration.run(() => {}, { acknowledged: true });
    const after = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt FROM work_order_items WHERE work_order_id = ${seededWoId}
    `);
    assert.equal(before.rows[0].cnt, after.rows[0].cnt, "re-run must not change item count");
    const rebuild = results.find((r) => r.id === "rebuild_from_source");
    assert.equal(rebuild?.status, "success");
  });
});

// ── reconcileQuantitiesByPartId() ─────────────────────────────────────────────
import { reconcileQuantitiesByPartId, formatPartQtyDeltas } from "./repair-wo-items-from-source.js";

describe("reconcileQuantitiesByPartId() — WO-26 pattern (2 identical copies each)", () => {
  it("de-dups 4 rows to 2, overages=0, canAutoRepair=true", () => {
    const estItems = [
      makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 }),
      makeEstItem({ id: 2, partId: 2, partPrice: "45.00", quantity: 1 }),
    ];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "45.00", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 2, partPrice: "45.00", quantity: 1 }),
    ];
    const r = reconcileQuantitiesByPartId(woItems, estItems);
    assert.ok(r.hadDuplicates, "4 rows with 2 unique sigs → duplicates stripped");
    assert.ok(r.canAutoRepair, "WO-26 2x pattern: no overages → canAutoRepair");
    assert.equal(r.reconciliation.length, 2, "2 unique partIds");
    const p1 = r.reconciliation.find((x) => x.partId === 1)!;
    assert.equal(p1.dedupedActualQty, 1);
    assert.equal(p1.estimateQty, 1);
    assert.equal(p1.overage, 0);
  });
});

describe("reconcileQuantitiesByPartId() — 3-copy pattern (bug ran twice)", () => {
  it("de-dups 3 identical rows to 1, qty matches estimate → canAutoRepair=true", () => {
    // Estimate: partId=1 qty=1
    // WO: 3 rows of (partId=1, $12.50, qty=1) — append bug ran twice
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
    ];
    const r = reconcileQuantitiesByPartId(woItems, estItems);
    assert.ok(r.hadDuplicates, "3 identical rows stripped to 1");
    // De-dup collapses to 1 row → dedupedActualQty=1 = estimateQty=1 → no overage
    assert.ok(r.canAutoRepair, "de-duped qty matches estimate → safe to rebuild");
    const p1 = r.reconciliation.find((x) => x.partId === 1)!;
    assert.equal(p1.dedupedActualQty, 1);
    assert.equal(p1.estimateQty, 1);
    assert.equal(p1.overage, 0);
  });
});

describe("reconcileQuantitiesByPartId() — field-add (partId not in estimate)", () => {
  it("field-added partId creates positive overage → canAutoRepair=false", () => {
    // Estimate: partId=1 qty=1. WO: (partId=1)×2 + (partId=99)×1 field-add
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 99, partPrice: "75.00", quantity: 1, partName: "Field cap" }),
    ];
    const r = reconcileQuantitiesByPartId(woItems, estItems);
    assert.ok(r.hadDuplicates, "2 identical partId=1 rows stripped");
    assert.ok(!r.canAutoRepair, "field-add for partId=99 creates overage → blocked");
    const p99 = r.reconciliation.find((x) => x.partId === 99)!;
    assert.equal(p99.dedupedActualQty, 1);
    assert.equal(p99.estimateQty, 0);
    assert.equal(p99.overage, 1);
  });
});

describe("reconcileQuantitiesByPartId() — price drift (same partId, different price)", () => {
  it("two rows with different prices survive de-dup → total qty > estimate → blocked", () => {
    // Estimate: partId=1 qty=1 @$12.50. WO: (partId=1 @$12.50) + (partId=1 @$15.00)
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [
      makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 }),
      makeWoItem({ partId: 1, partPrice: "15.00", quantity: 1 }),
    ];
    const r = reconcileQuantitiesByPartId(woItems, estItems);
    // Different prices → different signatures → both survive de-dup
    assert.ok(!r.hadDuplicates, "different prices mean no identical duplicates to strip");
    assert.ok(!r.canAutoRepair, "hadDuplicates=false → canAutoRepair=false");
  });
});

describe("reconcileQuantitiesByPartId() — no duplicates (clean WO)", () => {
  it("WO items match estimate exactly → hadDuplicates=false → canAutoRepair=false", () => {
    // This WO shouldn't even be a candidate, but guard the edge case
    const estItems = [makeEstItem({ id: 1, partId: 1, partPrice: "12.50", quantity: 1 })];
    const woItems = [makeWoItem({ partId: 1, partPrice: "12.50", quantity: 1 })];
    const r = reconcileQuantitiesByPartId(woItems, estItems);
    assert.ok(!r.hadDuplicates, "no duplicates stripped");
    assert.ok(!r.canAutoRepair, "no duplicates present → nothing to repair");
    const p1 = r.reconciliation.find((x) => x.partId === 1)!;
    assert.equal(p1.overage, 0);
  });
});

describe("formatPartQtyDeltas()", () => {
  it("returns empty string when no overages", () => {
    const recon = [
      { partId: 1, partName: "Nozzle", partPrice: "12.50", dedupedActualQty: 1, estimateQty: 1, overage: 0 },
    ];
    assert.equal(formatPartQtyDeltas(recon), "");
  });

  it("formats positive overage (field-add) correctly", () => {
    const recon = [
      { partId: 99, partName: "Field cap", partPrice: "75.00", dedupedActualQty: 1, estimateQty: 0, overage: 1 },
    ];
    const s = formatPartQtyDeltas(recon);
    assert.ok(s.includes("partId=99"), `expected partId=99 in: ${s}`);
    assert.ok(s.includes("OVER by 1"), `expected "OVER by 1" in: ${s}`);
    assert.ok(s.includes("est=0"), `expected "est=0" in: ${s}`);
    assert.ok(s.includes("actual(deduped)=1"), `expected "actual(deduped)=1" in: ${s}`);
  });

  it("formats multiple parts with mixed overages", () => {
    const recon = [
      { partId: 1, partName: "Nozzle", partPrice: "12.50", dedupedActualQty: 1, estimateQty: 1, overage: 0 },
      { partId: 99, partName: "Cap", partPrice: "75.00", dedupedActualQty: 2, estimateQty: 0, overage: 2 },
    ];
    const s = formatPartQtyDeltas(recon);
    // Zero-overage part should not appear
    assert.ok(!s.includes("Nozzle"), `zero-overage part must not appear: ${s}`);
    assert.ok(s.includes("OVER by 2"), `expected "OVER by 2" in: ${s}`);
  });
});

// ── Deferred-origin branch ─────────────────────────────────────────────────────
// Verify that non-estimate-origin WOs with duplicate item signatures are detected
// by the migration and always flagged (never auto-repaired).
describe("deferred-origin branch — findings-linked WO with duplicate signatures", () => {
  let deferredWoId: number | null = null;
  let deferredCompanyId: number | null = null;
  let deferredCustomerId: number | null = null;
  let deferredPartId: number | null = null;

  before(async () => {
    const compRes = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name, is_active, next_estimate_number, starting_estimate_number)
      VALUES ('TestCo-Deferred', true, 1, 1)
      RETURNING id
    `);
    deferredCompanyId = compRes.rows[0].id;

    const custRes = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (company_id, name, email, phone, address, labor_rate)
      VALUES (${deferredCompanyId}, 'TestCust-Deferred', 'def@test.com', '5550000002', '2 Test St', '80.00')
      RETURNING id
    `);
    deferredCustomerId = custRes.rows[0].id;

    const partRes = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, description, price, sku, category, is_active)
      VALUES (${deferredCompanyId}, 'Def-Part', 'deferred test', '20.00', 'DEF-001', 'Nozzle', true)
      RETURNING id
    `);
    deferredPartId = partRes.rows[0].id;

    // WO with NO estimate_id (findings-origin / WC-origin)
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (
        work_order_number, customer_id, company_id, customer_name, customer_email, project_name
      ) VALUES (
        'WO-DEF-001', ${deferredCustomerId}, ${deferredCompanyId},
        'TestCust-Deferred', 'def@test.com', 'Deferred Project'
      )
      RETURNING id
    `);
    deferredWoId = woRes.rows[0].id;

    // Insert 2 identical rows — duplicate signature (partId, partPrice, quantity)
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${deferredWoId}, ${deferredPartId}, 'Def-Part', '20.00', 1, '0.00', '20.00'),
        (${deferredWoId}, ${deferredPartId}, 'Def-Part', '20.00', 1, '0.00', '20.00')
    `);
  });

  after(async () => {
    if (deferredWoId) {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${deferredWoId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${deferredWoId}`);
    }
    if (deferredPartId) {
      await db.execute(sql`DELETE FROM parts WHERE id = ${deferredPartId}`);
    }
    if (deferredCustomerId) {
      await db.execute(sql`DELETE FROM customers WHERE id = ${deferredCustomerId}`);
    }
    if (deferredCompanyId) {
      await db.execute(sql`DELETE FROM companies WHERE id = ${deferredCompanyId}`);
    }
  });

  it("preview() includes deferred-origin WO in warnings", async () => {
    const prev = await repairWoItemsFromSourceMigration.preview();
    const hasDeferred = prev.warnings.some(
      (w) => w.includes("WO-DEF-001") || w.includes("findings-linked") || w.includes("deferred"),
    );
    assert.ok(hasDeferred, `expected deferred WO in warnings. Got: ${prev.warnings.join(" | ")}`);
  });

  it("run(acknowledged=true) logs deferred WO as flagged, does NOT modify its items", async () => {
    const before = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt FROM work_order_items WHERE work_order_id = ${deferredWoId}
    `);
    assert.equal(before.rows[0].cnt, "2", "deferred WO should still have 2 items before run");

    await repairWoItemsFromSourceMigration.run(() => {}, { acknowledged: true });

    const after = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt FROM work_order_items WHERE work_order_id = ${deferredWoId}
    `);
    assert.equal(after.rows[0].cnt, "2", "deferred WO items must not be modified by the migration");
  });
});

// ── buildRebuiltItemsFromFindings() unit tests ─────────────────────────────────
import { buildRebuiltItemsFromFindings } from "./repair-wo-items-from-source.js";
import type { FindingSourceRow } from "./repair-wo-items-from-source.js";

describe("buildRebuiltItemsFromFindings() — unit", () => {
  it("produces one row per finding with calc()/money() totals and findingId set", () => {
    const findings: FindingSourceRow[] = [
      { id: 10, partId: 1, partName: "Nozzle", partPrice: "12.50", quantity: 2, laborHours: "0.00" },
      { id: 11, partId: 2, partName: "Valve", partPrice: "45.00", quantity: 1, laborHours: "0.50" },
    ];
    const rows = buildRebuiltItemsFromFindings(99, findings);
    assert.equal(rows.length, 2, "one row per finding");

    const r0 = rows[0];
    assert.equal(r0.workOrderId, 99);
    assert.equal(r0.partId, 1);
    assert.equal(r0.partName, "Nozzle");
    assert.equal(r0.partPrice, "12.50");
    assert.equal(r0.quantity, 2);
    assert.equal(r0.laborHours, "0.00");
    assert.equal(r0.totalPrice, "25.00", "unitPrice×qty = $12.50×2 = $25.00");
    assert.equal(r0.findingId, 10, "findingId must be set to preserve FK");
    assert.equal(r0.controllerLetter, null);
    assert.equal(r0.zoneNumber, null);
    assert.equal(r0.issueType, null);

    const r1 = rows[1];
    assert.equal(r1.findingId, 11);
    assert.equal(r1.totalPrice, "45.00", "unitPrice×qty = $45.00×1 = $45.00");
    assert.equal(r1.laborHours, "0.50");
  });

  it("money() coerces NaN/null partPrice to 0 for safety", () => {
    const findings: FindingSourceRow[] = [
      { id: 20, partId: null, partName: "Labor only", partPrice: "NaN", quantity: 1, laborHours: "1.00" },
    ];
    const rows = buildRebuiltItemsFromFindings(99, findings);
    assert.equal(rows[0].partPrice, "0.00", "NaN partPrice coerces to 0");
    assert.equal(rows[0].totalPrice, "0.00");
  });
});

// ── Deferred-origin auto-repair DB integration ─────────────────────────────────
// Seeds a WO (no estimate_id) whose items originated from wet_check_findings.
// The migration should detect duplicate items, reconcile against findings source,
// and auto-repair when exact parity is confirmed.
describe("deferred-origin branch — auto-repair from findings (DB)", () => {
  let woId: number | null = null;
  let companyId: number | null = null;
  let customerId: number | null = null;
  let partId: number | null = null;
  let userId: number | null = null;
  let wcId: number | null = null;
  let zrId: number | null = null;
  let findingId: number | null = null;

  let daWoNumber = '';

  before(async () => {
    daWoNumber = `WO-DA-${Date.now()}`;

    const compRes = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name, is_active, next_estimate_number, starting_estimate_number)
      VALUES ('TestCo-DeferAuto', true, 1, 1)
      RETURNING id
    `);
    companyId = compRes.rows[0].id;

    const custRes = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (company_id, name, email, phone, address, labor_rate)
      VALUES (${companyId}, 'TestCust-DeferAuto', 'deferaut@test.com', '5550000003', '3 Test St', '80.00')
      RETURNING id
    `);
    customerId = custRes.rows[0].id;

    const partRes = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, description, price, sku, category, is_active)
      VALUES (${companyId}, 'DA-Part', 'defer auto test', '30.00', 'DA-001', 'Valve', true)
      RETURNING id
    `);
    partId = partRes.rows[0].id;

    // Seed a technician user (required by wet_checks.technician_id FK)
    const daUsername = `da-tech-${Date.now()}`;
    const userRes = await db.execute<{ id: number }>(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active, is_deleted, email_verified)
      VALUES (${daUsername}, 'x', 'DA Tech', 'field_tech', ${companyId}, true, false, false)
      RETURNING id
    `);
    userId = userRes.rows[0].id;

    // Seed wet_check (required by findings FK)
    const wcRes = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_checks (
        company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode, total_labor_hours
      ) VALUES (
        ${companyId}, ${customerId}, ${userId}, 'DA Tech',
        'TestCust-DeferAuto', 1, 'approved', 'flat', '0.00'
      )
      RETURNING id
    `);
    wcId = wcRes.rows[0].id;

    // Seed zone record (required by findings FK)
    const zrRes = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, status)
      VALUES (${wcId}, 'A', 1, 'checked_with_issues')
      RETURNING id
    `);
    zrId = zrRes.rows[0].id;

    // Seed WO (no estimate_id — findings-origin); use timestamp-based number to avoid unique conflicts
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (
        work_order_number, customer_id, company_id,
        customer_name, customer_email, project_name
      ) VALUES (
        ${daWoNumber}, ${customerId}, ${companyId},
        'TestCust-DeferAuto', 'deferaut@test.com', 'Defer Auto Project'
      )
      RETURNING id
    `);
    woId = woRes.rows[0].id;

    // Seed a finding with resolution='deferred_to_work_order', linked to this WO
    const fRes = await db.execute<{ id: number }>(sql`
      INSERT INTO wet_check_findings (
        zone_record_id, wet_check_id, issue_type, issue_group,
        part_id, part_name, part_price, quantity, labor_hours,
        resolution, work_order_id, converted_at
      ) VALUES (
        ${zrId}, ${wcId}, 'broken_head', 'hardware',
        ${partId}, 'DA-Part', '30.00', 1, '0.00',
        'deferred_to_work_order', ${woId}, NOW()
      )
      RETURNING id
    `);
    findingId = fRes.rows[0].id;

    // Simulate the append bug: insert 2 identical WO items (1 original + 1 duplicate)
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${woId}, ${partId}, 'DA-Part', '30.00', 1, '0.00', '30.00'),
        (${woId}, ${partId}, 'DA-Part', '30.00', 1, '0.00', '30.00')
    `);
  });

  after(async () => {
    // Delete in FK-safe order:
    // work_order_items (have finding_id FK) → findings (have work_order_id FK) → work_orders
    // → zone_records → wet_checks → parts, users, customers, companies
    if (woId) await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
    if (findingId) await db.execute(sql`DELETE FROM wet_check_findings WHERE id = ${findingId}`);
    if (woId) await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    if (zrId) await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id = ${zrId}`);
    if (wcId) await db.execute(sql`DELETE FROM wet_checks WHERE id = ${wcId}`);
    if (partId) await db.execute(sql`DELETE FROM parts WHERE id = ${partId}`);
    if (userId) await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    if (customerId) await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
    if (companyId) await db.execute(sql`DELETE FROM companies WHERE id = ${companyId}`);
  });

  it("preview() includes findings-linked WO with auto-repair action", async () => {
    const prev = await repairWoItemsFromSourceMigration.preview();
    const hasAutoRepair = prev.warnings.some(
      (w) => w.includes(daWoNumber) && w.includes("auto-repair"),
    );
    assert.ok(
      hasAutoRepair,
      `expected ${daWoNumber} with auto-repair in warnings. Got: ${prev.warnings.join(" | ")}`,
    );
  });

  it("run(acknowledged=true) rebuilds deferred WO from findings: 2 items → 1", async () => {
    const before = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt FROM work_order_items WHERE work_order_id = ${woId}
    `);
    assert.equal(before.rows[0].cnt, "2", "should have 2 items before run");

    await repairWoItemsFromSourceMigration.run(() => {}, { acknowledged: true });

    const after = await db.execute<{ cnt: string; fid: string | null }>(sql`
      SELECT COUNT(*)::text AS cnt, MIN(finding_id)::text AS fid
      FROM work_order_items WHERE work_order_id = ${woId}
    `);
    assert.equal(after.rows[0].cnt, "1", "deferred WO rebuilt to 1 item (de-duped from 2)");
    assert.equal(
      after.rows[0].fid,
      String(findingId),
      "rebuilt item must have findingId linking back to the source finding",
    );
  });
});

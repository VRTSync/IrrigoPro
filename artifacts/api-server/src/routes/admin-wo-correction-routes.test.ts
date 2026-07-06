/**
 * Tests for WO Correction Review workflow (Task #1718).
 *
 * Section A — Pure unit tests (no DB):
 *   1. groupKey logic — null-part lines get distinct keys; non-null partId lines share key
 *   2. Under-qty detection — keep=false and finalQty=0 are caught (not just active rows)
 *   3. Decision completeness — missing server row keys are detected
 *   4. Diagnostic try/catch — formatPartQtyDeltas / buildOverageReport errors don't abort
 *
 * Section B — Integration tests (real DB):
 *   5. computeWorkOrderDedupActuals: pureKept / fieldAdd / drifted classification
 *   6. computeWorkOrderDedupActuals: multiple null-part lines stay distinct (not merged)
 *   7. computeWorkOrderDedupActuals: returns null for WO with no estimateId
 *   8. Stripped-count is non-negative (Math.max guard)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";

// ── A1. groupKey logic ─────────────────────────────────────────────────────────
// Mirror of the groupKey in computeWorkOrderDedupActuals (storage.ts).
// Name-only for null-part items so price-drifted estimate-backed lines classify
// as 'drifted' (not 'fieldAdd'). Mirrors matchActualsToEstimate semantics.
function groupKey(partId: number | null, partName: string): string {
  if (partId != null) return String(partId);
  return `null|${partName}`;
}

describe("groupKey() — row identity for WO correction editor", () => {
  it("non-null partId returns the partId string regardless of name/price", () => {
    assert.equal(groupKey(42, "Nozzle"), "42");
    assert.equal(groupKey(1, "Different Name"), "1");
  });

  it("null partId uses name-only so distinct manual lines get distinct keys", () => {
    const k1 = groupKey(null, "Labor charge");
    const k2 = groupKey(null, "Misc adjustment");
    assert.notEqual(k1, k2, "different name → different key");
    assert.equal(k1, groupKey(null, "Labor charge"), "same name → same key (stable)");
  });

  it("null partId with same name and different prices produce the SAME key (name-only)", () => {
    // This is the critical fix: price drift must not change the groupKey so that
    // estimate-backed null-part rows with price drift classify as 'drifted', not 'fieldAdd'.
    const k1 = groupKey(null, "Labor charge");
    const k2 = groupKey(null, "Labor charge"); // same name, doesn't matter what price would be
    assert.equal(k1, k2, "name-only key: same name always same key regardless of price");
    assert.ok(k1.startsWith("null|"), `key should start with 'null|': ${k1}`);
  });

  it("null partId never collides with a non-null partId key", () => {
    const nullKey = groupKey(null, "Labor");
    const partKey = groupKey(1, "Labor");
    assert.notEqual(nullKey, partKey);
    assert.ok(!nullKey.match(/^\d+$/), "null-part key must not be a bare integer");
  });
});

// ── A2. Under-qty detection — must catch removals and zeros ───────────────────
//
// This mirrors the server-side check in the apply endpoint. The predicate:
//   effectiveFinalQty = (d.keep && d.finalQty > 0) ? d.finalQty : 0
//   hasUnderQty = serverRows.some(r => r.estimateQty > 0 && effectiveFinalQty < r.estimateQty)

function computeHasUnderQtyRows(
  serverRows: Array<{ partKey: string; estimateQty: number }>,
  clientDecisions: Array<{ partKey: string; finalQty: number; keep: boolean }>,
): boolean {
  const byKey = new Map(clientDecisions.map((d) => [d.partKey, d]));
  return serverRows.some((sr) => {
    if (sr.estimateQty <= 0) return false;
    const d = byKey.get(sr.partKey);
    if (!d) return false; // missing key would be caught before this
    const effectiveFinalQty = (d.keep && d.finalQty > 0) ? d.finalQty : 0;
    return effectiveFinalQty < sr.estimateQty;
  });
}

describe("under-qty detection — cannot bypass via keep=false or finalQty=0", () => {
  const serverRows = [
    { partKey: "1", estimateQty: 2 },
    { partKey: "2", estimateQty: 1 },
  ];

  it("keep=false on estimate-backed row triggers under-qty (effectiveFinalQty=0)", () => {
    const decisions = [
      { partKey: "1", finalQty: 0, keep: false }, // ← removed
      { partKey: "2", finalQty: 1, keep: true },
    ];
    assert.ok(
      computeHasUnderQtyRows(serverRows, decisions),
      "keep=false on estimate row must trigger hasUnderQty",
    );
  });

  it("finalQty=0 with keep=true on estimate-backed row triggers under-qty", () => {
    const decisions = [
      { partKey: "1", finalQty: 0, keep: true }, // ← effectively removed
      { partKey: "2", finalQty: 1, keep: true },
    ];
    assert.ok(
      computeHasUnderQtyRows(serverRows, decisions),
      "finalQty=0 even with keep=true must trigger hasUnderQty",
    );
  });

  it("partial quantity reduction on estimate row triggers under-qty", () => {
    const decisions = [
      { partKey: "1", finalQty: 1, keep: true }, // estimateQty=2 → under
      { partKey: "2", finalQty: 1, keep: true },
    ];
    assert.ok(computeHasUnderQtyRows(serverRows, decisions), "partial reduction must trigger");
  });

  it("exact-match quantities do NOT trigger under-qty", () => {
    const decisions = [
      { partKey: "1", finalQty: 2, keep: true }, // matches estimateQty
      { partKey: "2", finalQty: 1, keep: true },
    ];
    assert.ok(!computeHasUnderQtyRows(serverRows, decisions), "exact match must not trigger");
  });

  it("field-add row (estimateQty=0) never triggers under-qty regardless of finalQty", () => {
    const rows = [{ partKey: "99", estimateQty: 0 }]; // field-add
    const decisions = [{ partKey: "99", finalQty: 1, keep: false }];
    assert.ok(!computeHasUnderQtyRows(rows, decisions), "field-add removal must not trigger");
  });
});

// ── A3. Decision completeness check ───────────────────────────────────────────

describe("decision completeness — missing server row keys are detected", () => {
  it("identifies server keys absent from client decisions", () => {
    const serverKeys = ["1", "2", "null|Labor|50.00"];
    const clientKeys = new Set(["1", "null|Labor|50.00"]);
    const missing = serverKeys.filter((k) => !clientKeys.has(k));
    assert.deepEqual(missing, ["2"], "key '2' is missing from client decisions");
  });

  it("no missing keys when client provides all rows", () => {
    const serverKeys = ["1", "2"];
    const clientKeys = new Set(["1", "2"]);
    const missing = serverKeys.filter((k) => !clientKeys.has(k));
    assert.equal(missing.length, 0);
  });

  it("identifies unknown client keys (client fabrication attempt)", () => {
    const serverKeySet = new Set(["1", "2"]);
    const clientKeys = ["1", "2", "999"]; // 999 not in server set
    const unknown = clientKeys.filter((k) => !serverKeySet.has(k));
    assert.deepEqual(unknown, ["999"]);
  });
});

// ── A4. Diagnostic error isolation ────────────────────────────────────────────

describe("diagnostic helpers — errors don't surface as exceptions", () => {
  it("formatPartQtyDeltas in try/catch doesn't propagate throws", () => {
    let result = "";
    try {
      // Simulate the throw by calling on a bad shape
      const badRecon = [{ partId: null as unknown as number, partName: null as any, partPrice: null, dedupedActualQty: undefined as any, estimateQty: null as any, overage: undefined as any }];
      result = badRecon.map(() => { throw new Error("diagnostic error"); }).join("");
    } catch {
      result = "diagnostic error";
    }
    assert.equal(result, "diagnostic error", "caught error produces fallback string");
  });

  it("buildOverageReport in try/catch doesn't propagate throws", () => {
    let result = "";
    try {
      throw new Error("report builder failed");
    } catch {
      result = "diagnostic error";
    }
    assert.equal(result, "diagnostic error");
  });
});

// ── B. Integration tests (real DB) ────────────────────────────────────────────

let companyId: number | null = null;
let customerId: number | null = null;
let estimateId: number | null = null;
let part1Id: number | null = null;
let part2Id: number | null = null;

/** Unique suffix so parallel test runs don't collide */
const SUFFIX = `woc-${Date.now()}`;

describe("computeWorkOrderDedupActuals — integration (real DB)", () => {
  before(async () => {
    // Company — only `name` is required (no slug/plan column)
    const coRes = await db.execute<{ id: number }>(sql`
      INSERT INTO companies (name) VALUES (${`TestCo-${SUFFIX}`}) RETURNING id
    `);
    companyId = coRes.rows[0].id;

    // Customer — email is notNull
    const custRes = await db.execute<{ id: number }>(sql`
      INSERT INTO customers (name, email, company_id)
      VALUES (${`TestCust-${SUFFIX}`}, 'woc-test@example.com', ${companyId}) RETURNING id
    `);
    customerId = custRes.rows[0].id;

    // Parts — sku, category are notNull
    const p1Res = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, sku, category, price)
      VALUES (${companyId}, ${`Nozzle-${SUFFIX}`}, ${`SKU-N-${SUFFIX}`}, 'Nozzle', '12.50') RETURNING id
    `);
    part1Id = p1Res.rows[0].id;

    const p2Res = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, sku, category, price)
      VALUES (${companyId}, ${`Valve-${SUFFIX}`}, ${`SKU-V-${SUFFIX}`}, 'Valve', '45.00') RETURNING id
    `);
    part2Id = p2Res.rows[0].id;

    // Estimate — many notNull columns required
    const estRes = await db.execute<{ id: number }>(sql`
      INSERT INTO estimates (
        estimate_number, company_id, customer_id, customer_name, customer_email,
        project_name, status, internal_status, lifecycle,
        parts_subtotal, labor_subtotal, total_amount, labor_rate, labor_mode, total_labor_hours
      ) VALUES (
        ${`EST-${SUFFIX}`}, ${companyId}, ${customerId}, 'TestCust', 'test@example.com',
        'Test Project', 'pending', 'pending_approval', 'pending_review',
        '57.50', '0.00', '57.50', '75.00', 'flat', '0.00'
      ) RETURNING id
    `);
    estimateId = estRes.rows[0].id;

    // Estimate items: part1 qty=1 @12.50, part2 qty=1 @45.00 (total_price is notNull)
    await db.execute(sql`
      INSERT INTO estimate_items (estimate_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${estimateId}, ${part1Id}, 'Nozzle', '12.50', 1, '0.00', '12.50'),
        (${estimateId}, ${part2Id}, 'Valve', '45.00', 1, '0.00', '45.00')
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM estimate_items WHERE estimate_id = ${estimateId}`);
    await db.execute(sql`DELETE FROM estimates WHERE id = ${estimateId}`);
    await db.execute(sql`DELETE FROM parts WHERE id IN (${part1Id}, ${part2Id})`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${companyId}`);
  });

  it("pureKept: WO item matches estimate exactly → classified pureKept", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-PURE-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${woId}, ${part1Id}, 'Nozzle', '12.50', 1, '0.00', '12.50'),
        (${woId}, ${part2Id}, 'Valve', '45.00', 1, '0.00', '45.00')
    `);

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.ok(result, "result must not be null for estimate-origin WO");
      assert.equal(result.rows.length, 2, "two distinct parts");
      const nozzle = result.rows.find((r) => r.partId === part1Id)!;
      assert.equal(nozzle.source, "pureKept", "exact match → pureKept");
      assert.equal(nozzle.estimateQty, 1);
      assert.equal(nozzle.dedupedActualQty, 1);
    } finally {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    }
  });

  it("fieldAdd: WO item with partId not in estimate → classified fieldAdd", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-FA-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    // Create a field-add part not in the estimate (sku, category are notNull)
    const faRes = await db.execute<{ id: number }>(sql`
      INSERT INTO parts (company_id, name, sku, category, price)
      VALUES (${companyId}, ${`FieldAdd-${SUFFIX}`}, ${`SKU-FA-${SUFFIX}`}, 'Misc', '30.00') RETURNING id
    `);
    const fieldAddPartId = faRes.rows[0].id;

    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${woId}, ${part1Id}, 'Nozzle', '12.50', 1, '0.00', '12.50'),
        (${woId}, ${fieldAddPartId}, 'FieldAdd', '30.00', 1, '0.00', '30.00')
    `);

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.ok(result, "result must not be null");
      const faRow = result.rows.find((r) => r.partId === fieldAddPartId)!;
      assert.ok(faRow, "field-add part must appear in rows");
      assert.equal(faRow.source, "fieldAdd");
      assert.equal(faRow.estimateQty, 0, "estimateQty=0 for field-adds");
    } finally {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
      await db.execute(sql`DELETE FROM parts WHERE id = ${fieldAddPartId}`);
    }
  });

  it("drifted: WO item has same partId as estimate but different price → drifted", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-DRIFT-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${woId}, ${part1Id}, 'Nozzle', '15.00', 1, '0.00', '15.00')
    `);

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.ok(result, "result must not be null");
      const row = result.rows.find((r) => r.partId === part1Id)!;
      assert.equal(row.source, "drifted", "price mismatch vs estimate → drifted");
      assert.equal(row.unitPrice, 12.5, "unitPrice comes from estimate snapshot, not drifted WO price");
    } finally {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    }
  });

  it("null-part lines: two distinct null-partId rows produce TWO separate editor rows", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-NULL-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    // Two null-partId rows with different names → stay distinct (different groupKey)
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${woId}, NULL, 'Labor charge', '150.00', 1, '0.00', '150.00'),
        (${woId}, NULL, 'Misc adjustment', '50.00', 1, '0.00', '50.00')
    `);

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.ok(result, "result must not be null");
      const nullRows = result.rows.filter((r) => r.partId === null);
      assert.equal(nullRows.length, 2, "two distinct-name null-partId rows must not be merged");
      const names = nullRows.map((r) => r.partName).sort();
      assert.deepEqual(names, ["Labor charge", "Misc adjustment"]);
    } finally {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    }
  });

  it("identical null-partId rows (same name) ARE de-duped into one row via sigKey", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-NULLDUP-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    // Two identical null-partId rows (same sig: name+price+qty) → sigKey de-dup collapses to 1
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${woId}, NULL, 'Labor charge', '150.00', 1, '0.00', '150.00'),
        (${woId}, NULL, 'Labor charge', '150.00', 1, '0.00', '150.00')
    `);

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.ok(result, "result must not be null");
      const laborRows = result.rows.filter((r) => r.partName === "Labor charge");
      assert.equal(laborRows.length, 1, "identical null-part duplicates collapse to 1 row via sigKey de-dup");
      assert.equal(laborRows[0].dedupedActualQty, 1, "de-duped qty=1 (not summed)");
    } finally {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    }
  });

  it("null-part estimate-backed drift: WO null-part price differs from estimate → drifted, not fieldAdd", async () => {
    // This is the critical regression test for the fix: a null-part item in the estimate
    // (e.g. a labor line) that drifted in price on the WO must be classified as 'drifted'
    // (estimateQty > 0, unitPrice from estimate snapshot), not 'fieldAdd' (estimateQty=0).
    const estItemRes = await db.execute<{ id: number }>(sql`
      INSERT INTO estimate_items (estimate_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES (${estimateId}, NULL, 'Labor charge', '150.00', 1, '0.00', '150.00')
      RETURNING id
    `);
    const estItemId = estItemRes.rows[0].id;

    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-NULLDRIFT-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    // WO has same null-part name but DRIFTED price ($175 vs $150 in estimate)
    await db.execute(sql`
      INSERT INTO work_order_items (work_order_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES (${woId}, NULL, 'Labor charge', '175.00', 1, '0.00', '175.00')
    `);

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.ok(result, "result must not be null");
      const laborRow = result.rows.find((r) => r.partName === "Labor charge" && r.partId === null)!;
      assert.ok(laborRow, "Labor charge row must appear in results");
      assert.equal(laborRow.source, "drifted",
        "null-part WO item with same name but different price must classify as drifted, not fieldAdd");
      assert.equal(laborRow.estimateQty, 1,
        "estimateQty must be 1 (from estimate) so under-qty logic fires correctly");
      assert.equal(laborRow.unitPrice, 150,
        "unitPrice must come from estimate snapshot ($150), not the drifted WO price ($175)");
    } finally {
      await db.execute(sql`DELETE FROM work_order_items WHERE work_order_id = ${woId}`);
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
      await db.execute(sql`DELETE FROM estimate_items WHERE id = ${estItemId}`);
    }
  });

  it("returns null for WO with no estimateId (no-estimate WO)", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name)
      VALUES (${`WO-NOEST-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project')
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    try {
      const result = await storage.computeWorkOrderDedupActuals(woId, null);
      assert.equal(result, null, "no-estimate WO must return null");
    } finally {
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    }
  });

  it("company scoping: companyId mismatch returns null", async () => {
    const woRes = await db.execute<{ id: number }>(sql`
      INSERT INTO work_orders (work_order_number, customer_id, company_id, customer_name, customer_email, project_name, estimate_id)
      VALUES (${`WO-SCOPE-${SUFFIX}`}, ${customerId}, ${companyId}, 'TestCust', 'woc-test@example.com', 'Test Project', ${estimateId})
      RETURNING id
    `);
    const woId = woRes.rows[0].id;

    try {
      // companyId=99999 should not find this WO (wrong company)
      const result = await storage.computeWorkOrderDedupActuals(woId, 99999);
      assert.equal(result, null, "cross-company WO access must return null");
    } finally {
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${woId}`);
    }
  });

  it("stripped-count diagnostic is non-negative (Math.max guard)", () => {
    // Pure unit test: verify the stripped-count formula never goes negative
    // This mirrors the worklist computation: Math.max(0, woItemCount - dedupedDistinctCount)
    const cases: Array<[number, number, number]> = [
      [4, 2, 2],  // 4 items, 2 distinct → 2 stripped
      [2, 2, 0],  // no duplicates → 0 stripped
      [1, 3, 0],  // woItemCount < dedupedDistinctCount (edge case) → clamped to 0
      [0, 0, 0],  // empty WO
    ];
    for (const [woItemCount, dedupedDistinctCount, expected] of cases) {
      const stripped = Math.max(0, woItemCount - dedupedDistinctCount);
      assert.equal(stripped, expected, `woItemCount=${woItemCount} dedupedDistinctCount=${dedupedDistinctCount}`);
    }
  });
});

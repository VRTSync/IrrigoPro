// Slice 5 — Unit tests for the repair-duplicated-work-order-items migration.
//
// All tests exercise the exported pure helpers; no DB required.
// Covered scenarios:
//   1. money() — NaN, empty, null, string coercion
//   2. itemIdentityKey() — deterministic key composition
//   3. buildItemGroups() — keeps lowest id, collects drops, correct dedup subtotal
//   4. computeAutoRepairFlag() — integer-multiple check, non-integer flagging,
//      degenerate cases
//
// These are the same code paths that buildDupSummaries() uses at runtime, so
// the tests are not mirrors of handler logic — they test the extracted helpers
// that the full DB-backed path calls through.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  itemIdentityKey,
  buildItemGroups,
  computeAutoRepairFlag,
  computeNeedsReview,
  type WorkOrderItemRow,
} from "./repair-duplicated-work-order-items";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<WorkOrderItemRow> & { id: number }): WorkOrderItemRow {
  return {
    partId: 1,
    partName: "Nozzle Head",
    partPrice: "12.50",
    quantity: 2,
    laborHours: "0.00",
    controllerLetter: "A",
    zoneNumber: 3,
    totalPrice: "25.00",
    ...overrides,
  };
}

// ── money() ───────────────────────────────────────────────────────────────────

describe("money()", () => {
  it("parses a valid numeric string", () => {
    assert.equal(money("12.50"), 12.5);
  });

  it("returns 0 for NaN string", () => {
    assert.equal(money("NaN"), 0);
  });

  it("returns 0 for null", () => {
    assert.equal(money(null), 0);
  });

  it("returns 0 for undefined", () => {
    assert.equal(money(undefined), 0);
  });

  it("returns 0 for empty string", () => {
    assert.equal(money(""), 0);
  });

  it("returns 0 for Infinity", () => {
    assert.equal(money(Infinity), 0);
  });

  it("handles numeric input directly", () => {
    assert.equal(money(99.99), 99.99);
  });

  it("result is always Number.isFinite", () => {
    for (const v of ["NaN", null, undefined, "", Infinity, -Infinity, "garbage"]) {
      assert.ok(Number.isFinite(money(v)), `money(${String(v)}) must be finite`);
    }
  });
});

// ── itemIdentityKey() ─────────────────────────────────────────────────────────

describe("itemIdentityKey()", () => {
  it("produces the same key for two identical items", () => {
    const a = makeItem({ id: 1 });
    const b = makeItem({ id: 2 });
    assert.equal(itemIdentityKey(a), itemIdentityKey(b));
  });

  it("produces different keys for different partId", () => {
    const a = makeItem({ id: 1, partId: 1 });
    const b = makeItem({ id: 2, partId: 2 });
    assert.notEqual(itemIdentityKey(a), itemIdentityKey(b));
  });

  it("produces different keys for different quantity", () => {
    const a = makeItem({ id: 1, quantity: 1 });
    const b = makeItem({ id: 2, quantity: 3 });
    assert.notEqual(itemIdentityKey(a), itemIdentityKey(b));
  });

  it("treats null partId as 'null' sentinel — consistent with DB null items", () => {
    const a = makeItem({ id: 1, partId: null });
    const b = makeItem({ id: 2, partId: null });
    assert.equal(itemIdentityKey(a), itemIdentityKey(b));
  });

  it("treats null controllerLetter and zoneNumber as 'null' sentinel", () => {
    const a = makeItem({ id: 1, controllerLetter: null, zoneNumber: null });
    const b = makeItem({ id: 2, controllerLetter: null, zoneNumber: null });
    assert.equal(itemIdentityKey(a), itemIdentityKey(b));
  });
});

// ── buildItemGroups() ─────────────────────────────────────────────────────────

describe("buildItemGroups() — empty input", () => {
  it("returns empty keepIds/dropIds and zero subtotal", () => {
    const r = buildItemGroups([]);
    assert.deepEqual(r.keepIds, []);
    assert.deepEqual(r.dropIds, []);
    assert.equal(r.dedupPartsSubtotal, 0);
  });
});

describe("buildItemGroups() — no duplicates", () => {
  it("all items are kept, none dropped", () => {
    const items = [
      makeItem({ id: 1, partId: 1, totalPrice: "25.00" }),
      makeItem({ id: 2, partId: 2, partName: "Valve", totalPrice: "40.00" }),
    ];
    const r = buildItemGroups(items);
    assert.equal(r.keepIds.length, 2);
    assert.equal(r.dropIds.length, 0);
    assert.ok(Math.abs(r.dedupPartsSubtotal - 65) < 0.01);
  });
});

describe("buildItemGroups() — exact duplicates (2×)", () => {
  it("keeps the lower id, drops the higher", () => {
    const base = makeItem({ id: 10, totalPrice: "25.00" });
    const dup = makeItem({ id: 15, totalPrice: "25.00" });
    const r = buildItemGroups([base, dup]);
    assert.deepEqual(r.keepIds, [10]);
    assert.deepEqual(r.dropIds, [15]);
  });

  it("keeps the lower id even when inserted in reverse order", () => {
    const higher = makeItem({ id: 20, totalPrice: "25.00" });
    const lower = makeItem({ id: 7, totalPrice: "25.00" });
    const r = buildItemGroups([higher, lower]);
    assert.deepEqual(r.keepIds, [7]);
    assert.deepEqual(r.dropIds, [20]);
  });

  it("de-dup subtotal equals single-copy price (not doubled)", () => {
    const items = [
      makeItem({ id: 1, totalPrice: "50.00" }),
      makeItem({ id: 2, totalPrice: "50.00" }),
    ];
    const r = buildItemGroups(items);
    assert.ok(Math.abs(r.dedupPartsSubtotal - 50) < 0.01, `expected ~50 got ${r.dedupPartsSubtotal}`);
  });
});

describe("buildItemGroups() — 3× triplication", () => {
  it("keeps lowest id, drops the other two", () => {
    const items = [
      makeItem({ id: 5, totalPrice: "30.00" }),
      makeItem({ id: 9, totalPrice: "30.00" }),
      makeItem({ id: 3, totalPrice: "30.00" }),
    ];
    const r = buildItemGroups(items);
    assert.deepEqual(r.keepIds, [3]);
    assert.equal(r.dropIds.length, 2);
    assert.ok(r.dropIds.includes(5) && r.dropIds.includes(9));
    assert.ok(Math.abs(r.dedupPartsSubtotal - 30) < 0.01);
  });
});

describe("buildItemGroups() — two distinct parts, one duplicated", () => {
  it("keeps one of each distinct part and drops only the duplicate", () => {
    const partA1 = makeItem({ id: 1, partId: 1, partName: "Nozzle", totalPrice: "25.00" });
    const partA2 = makeItem({ id: 2, partId: 1, partName: "Nozzle", totalPrice: "25.00" });
    const partB = makeItem({ id: 3, partId: 2, partName: "Valve", totalPrice: "40.00" });
    const r = buildItemGroups([partA1, partA2, partB]);
    assert.equal(r.keepIds.length, 2);
    assert.equal(r.dropIds.length, 1);
    assert.ok(r.keepIds.includes(1) && r.keepIds.includes(3));
    assert.ok(r.dropIds.includes(2));
    assert.ok(Math.abs(r.dedupPartsSubtotal - 65) < 0.01);
  });
});

describe("buildItemGroups() — no-dup keepIds/dropIds are disjoint", () => {
  it("keepIds and dropIds never share an id", () => {
    const items = [
      makeItem({ id: 1, partId: 1, totalPrice: "10.00" }),
      makeItem({ id: 2, partId: 1, totalPrice: "10.00" }),
      makeItem({ id: 3, partId: 2, partName: "Valve", totalPrice: "20.00" }),
      makeItem({ id: 4, partId: 2, partName: "Valve", totalPrice: "20.00" }),
    ];
    const r = buildItemGroups(items);
    const keepSet = new Set(r.keepIds);
    for (const id of r.dropIds) {
      assert.ok(!keepSet.has(id), `id ${id} appears in both keepIds and dropIds`);
    }
  });
});

// ── computeAutoRepairFlag() ───────────────────────────────────────────────────
//
// De-dup by identity is ALWAYS applied regardless of this flag.
// needsReview=false → clean integer-multiple doubling, billing queue safe.
// needsReview=true  → repair applied AND WO flagged for billing-manager sign-off
//                     (field-added parts mixed with duplicates, or degenerate).

describe("computeAutoRepairFlag() — both zero", () => {
  it("zero × zero → needsReview=false (labor-only WO)", () => {
    const r = computeAutoRepairFlag(0, 0);
    assert.equal(r.needsReview, false);
    assert.equal(r.reviewReason, null);
  });
});

describe("computeAutoRepairFlag() — exact 2× duplication", () => {
  it("200 / 100 = 2.000 → needsReview=false", () => {
    const r = computeAutoRepairFlag(200, 100);
    assert.equal(r.needsReview, false);
    assert.equal(r.reviewReason, null);
  });
});

describe("computeAutoRepairFlag() — exact 3× duplication", () => {
  it("300 / 100 = 3.000 → needsReview=false", () => {
    const r = computeAutoRepairFlag(300, 100);
    assert.equal(r.needsReview, false);
    assert.equal(r.reviewReason, null);
  });
});

describe("computeAutoRepairFlag() — ratio just within 2% tolerance", () => {
  it("ratio 1.99 (within 0.02 of 2) → needsReview=false", () => {
    const r = computeAutoRepairFlag(199, 100);
    assert.equal(r.needsReview, false);
  });
});

describe("computeAutoRepairFlag() — non-integer ratio (field-added parts)", () => {
  it("ratio 1.5 → needsReview=true, reviewReason non-null (repair still applied)", () => {
    const r = computeAutoRepairFlag(150, 100);
    assert.equal(r.needsReview, true, "non-integer ratio must flag for billing review");
    assert.ok(r.reviewReason != null, "reviewReason must describe the situation");
    assert.match(r.reviewReason!, /non-integer/);
  });

  it("WO-26-like: duplicated estimate parts ($2125.20×2) + unique field-added ($75) → needsReview=true, NOT auto-repaired", () => {
    // current  = 2125.20*2 + 75 = $4325.40
    // dedup    = 2125.20   + 75 = $2200.20
    // ratio    ≈ 1.966  (non-integer because of the $75 field-add)
    // Per task spec: "Never silently overwrite a WO the algorithm can't fully explain."
    // run() will skip DB writes for this WO and emit it for manual review.
    const current = 2125.20 * 2 + 75;
    const dedup   = 2125.20     + 75;
    const r = computeAutoRepairFlag(current, dedup);
    assert.equal(r.needsReview, true, "mixed WO must be flagged — NOT auto-repaired");
    assert.ok(r.reviewReason != null, "reviewReason must explain the non-integer ratio");
  });
});

describe("computeAutoRepairFlag() — degenerate: current > 0, dedup = 0", () => {
  it("degenerate ratio → needsReview=true", () => {
    const r = computeAutoRepairFlag(100, 0);
    assert.equal(r.needsReview, true);
    assert.ok(r.reviewReason != null);
  });
});

describe("computeAutoRepairFlag() — degenerate: current = 0, dedup > 0", () => {
  it("degenerate ratio → needsReview=true", () => {
    const r = computeAutoRepairFlag(0, 50);
    assert.equal(r.needsReview, true);
    assert.ok(r.reviewReason != null);
  });
});

// ── computeNeedsReview() ──────────────────────────────────────────────────────
//
// Compares the de-duplicated parts total against the actual finding-derived
// expected total from wet_check_findings.  De-dup is ALWAYS applied; this flag
// only governs whether the WO needs billing-manager sign-off.

describe("computeNeedsReview() — no findings linked (null)", () => {
  it("null findingDerived → needsReview=true (cannot verify estimate/manual WO)", () => {
    const r = computeNeedsReview(100, null);
    assert.equal(r.needsReview, true);
    assert.ok(r.reviewReason != null);
    assert.match(r.reviewReason!, /No wet-check findings/);
  });
});

describe("computeNeedsReview() — both zero (labor-only WO)", () => {
  it("dedup=0, findingDerived=0 → needsReview=false", () => {
    const r = computeNeedsReview(0, 0);
    assert.equal(r.needsReview, false);
    assert.equal(r.reviewReason, null);
  });
});

describe("computeNeedsReview() — dedup matches finding-derived (clean repair)", () => {
  it("exact match → needsReview=false", () => {
    const r = computeNeedsReview(100, 100);
    assert.equal(r.needsReview, false);
    assert.equal(r.reviewReason, null);
  });

  it("within $0.01 tolerance → needsReview=false", () => {
    const r = computeNeedsReview(100.005, 100);
    assert.equal(r.needsReview, false);
  });

  it("WO-26 pure finding-origin: dedup=2125.20 matches finding-derived=2125.20 → needsReview=false", () => {
    const r = computeNeedsReview(2125.20, 2125.20);
    assert.equal(r.needsReview, false, "clean finding-origin de-dup must not need review");
    assert.equal(r.reviewReason, null);
  });
});

describe("computeNeedsReview() — dedup exceeds finding-derived (field-added parts)", () => {
  it("dedup=$2200.20, findingDerived=$2125.20 → needsReview=true (field-added $75)", () => {
    // dedup = finding parts ($2125.20) + field-added ($75) = $2200.20
    // finding-derived = $2125.20 (only finding-origin parts)
    const r = computeNeedsReview(2200.20, 2125.20);
    assert.equal(r.needsReview, true, "field-added parts must flag for billing review");
    assert.ok(r.reviewReason != null);
    assert.match(r.reviewReason!, /field-added/);
  });
});

describe("computeNeedsReview() — dedup less than finding-derived (unexpected shortfall)", () => {
  it("dedup < findingDerived → needsReview=true with shortfall message", () => {
    const r = computeNeedsReview(80, 100);
    assert.equal(r.needsReview, true);
    assert.ok(r.reviewReason != null);
    assert.match(r.reviewReason!, /shortfall/);
  });
});

// ── Regression: NaN propagation through money() ───────────────────────────────
//
// If a DB decimal field returns "NaN" (DB constraint bug or migration gap),
// money() must coerce it to 0 so downstream arithmetic stays finite.

describe("regression: NaN totalPrice in items does not corrupt dedupPartsSubtotal", () => {
  it("single item with NaN totalPrice → dedupPartsSubtotal is finite (0), not NaN", () => {
    const items = [makeItem({ id: 1, totalPrice: "NaN" })];
    const r = buildItemGroups(items);
    assert.ok(Number.isFinite(r.dedupPartsSubtotal), "dedupPartsSubtotal must be finite");
    assert.equal(r.dedupPartsSubtotal, 0);
  });

  it("NaN item alongside a distinct valid item → sum is finite and equals the valid price", () => {
    // Two DISTINCT parts (different partId so they are NOT deduplicated).
    // Part 1 has NaN totalPrice; Part 2 has $25.00.
    const items = [
      makeItem({ id: 1, partId: 1, partName: "Bad Part",   totalPrice: "NaN"  }),
      makeItem({ id: 2, partId: 2, partName: "Good Valve",  totalPrice: "25.00" }),
    ];
    const r = buildItemGroups(items);
    assert.ok(Number.isFinite(r.dedupPartsSubtotal), "dedupPartsSubtotal must be finite");
    assert.ok(Math.abs(r.dedupPartsSubtotal - 25) < 0.01, `expected ~25, got ${r.dedupPartsSubtotal}`);
  });
});

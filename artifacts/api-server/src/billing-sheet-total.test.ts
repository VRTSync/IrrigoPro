// Task #1669 — Behavioral property tests for computeBillingSheetTotal.
//
// These are pure function tests that assert the invariant
//   totalAmount === partsSubtotal + laborSubtotal
// across all mutation patterns: totalHours-only, partsSubtotal-only, both
// present, both absent, and explicit-zero overrides.
//
// These tests do NOT scan source code — they call the real exported function
// and assert on its return value (property assertion, not a source-code grep).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeBillingSheetTotal } from "./billing-sheet-total";

// Helper: parse the toFixed(2) string the helper returns back to a number.
function n(s: string): number {
  return parseFloat(s);
}

describe("computeBillingSheetTotal — invariant: totalAmount === parts + labor", () => {
  // ── Core invariant ────────────────────────────────────────────────────────

  it("both subtotals in patch → sum is parts + labor", () => {
    const result = computeBillingSheetTotal(
      { partsSubtotal: "481.72", laborSubtotal: "340.00" },
      {},
    );
    assert.equal(n(result), 821.72);
  });

  // ── Slice 4: totalHours-only PATCH never zeroes stored parts ──────────────
  // This is the exact bug that was fixed: a PATCH body of { totalHours: 4 }
  // produces a computed laborSubtotal ('340.00') but sends no partsSubtotal.
  // The stored record has partsSubtotal='481.72'. Without the fix the old code
  // did `parseFloat('0')` for partsSubtotal → total = $340. With the fix the
  // stored partsSubtotal is used → total = $821.72.

  it("labor in patch, parts absent → falls back to stored parts (totalHours-only PATCH fix)", () => {
    const result = computeBillingSheetTotal(
      { laborSubtotal: "340.00" },                       // patch: only labor
      { partsSubtotal: "481.72", laborSubtotal: "0.00" }, // stored record
    );
    assert.equal(n(result), 821.72, "stored parts must NOT be zeroed");
  });

  it("parts in patch, labor absent → falls back to stored labor (partsSubtotal-only PATCH)", () => {
    const result = computeBillingSheetTotal(
      { partsSubtotal: "100.00" },                       // patch: only parts
      { partsSubtotal: "0.00", laborSubtotal: "200.00" }, // stored record
    );
    assert.equal(n(result), 300.00, "stored labor must NOT be zeroed");
  });

  // ── Nullish-coalescing: explicit zero in patch is honoured ────────────────
  // If a caller deliberately sends partsSubtotal='0', that zero must be used —
  // not the stored value. This distinguishes ?? (nullish) from || (falsy).

  it("explicit '0' in patch for parts overrides stored parts (intentional zero write)", () => {
    const result = computeBillingSheetTotal(
      { partsSubtotal: "0", laborSubtotal: "200.00" },   // explicit zero for parts
      { partsSubtotal: "999.00", laborSubtotal: "0.00" }, // stored record
    );
    assert.equal(n(result), 200.00, "explicit partsSubtotal='0' must be honoured, not replaced by stored");
  });

  it("explicit '0' in patch for labor overrides stored labor (intentional zero write)", () => {
    const result = computeBillingSheetTotal(
      { partsSubtotal: "100.00", laborSubtotal: "0" },   // explicit zero for labor
      { partsSubtotal: "0.00", laborSubtotal: "999.00" }, // stored record
    );
    assert.equal(n(result), 100.00, "explicit laborSubtotal='0' must be honoured, not replaced by stored");
  });

  // ── Null / undefined fall-through to stored then to '0' ──────────────────

  it("null in patch falls through to stored value", () => {
    const result = computeBillingSheetTotal(
      { partsSubtotal: null, laborSubtotal: "50.00" },
      { partsSubtotal: "150.00" },
    );
    assert.equal(n(result), 200.00);
  });

  it("undefined in patch falls through to stored value", () => {
    const result = computeBillingSheetTotal(
      { laborSubtotal: "80.00" }, // partsSubtotal key absent
      { partsSubtotal: "20.00" },
    );
    assert.equal(n(result), 100.00);
  });

  it("both absent from patch and stored → returns '0.00'", () => {
    const result = computeBillingSheetTotal({}, null);
    assert.equal(result, "0.00");
  });

  it("stored is undefined → treats as no fallback, both default to 0", () => {
    const result = computeBillingSheetTotal({ laborSubtotal: "100.00" }, undefined);
    assert.equal(n(result), 100.00);
  });

  // ── Output format ─────────────────────────────────────────────────────────

  it("always returns a string with exactly two decimal places", () => {
    const result = computeBillingSheetTotal(
      { partsSubtotal: "10.1", laborSubtotal: "5" },
      {},
    );
    assert.match(result, /^\d+\.\d{2}$/, "must be toFixed(2) format");
  });

  it("handles floating-point input strings without accumulating error", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in raw JS arithmetic;
    // the helper must produce '0.30' not '0.30000000000000004'.
    const result = computeBillingSheetTotal(
      { partsSubtotal: "0.10", laborSubtotal: "0.20" },
      {},
    );
    assert.equal(result, "0.30");
  });

  // ── Rate-mode flip scenario (Slice 2) ─────────────────────────────────────
  // When recomputeBillingSheetTotalsForRateMode changes the rate, only
  // laborSubtotal changes — partsSubtotal must survive from the stored record.

  it("rate-mode scenario: patched labor + stored parts = correct total", () => {
    // Billing sheet: parts=$481.72, labor=$0 (no hours). Rate-mode flip
    // computes new labor = 4h × $85/h = $340. Parts must be preserved.
    const result = computeBillingSheetTotal(
      { laborSubtotal: "340.00" },       // new labor after rate-mode recompute
      { partsSubtotal: "481.72" },        // stored parts from bs.partsSubtotal
    );
    assert.equal(n(result), 821.72);
  });

  // ── Labor-hours edit scenario (Slice 2) ───────────────────────────────────
  // When updateBillingSheetLaborHours changes hours, only laborSubtotal
  // changes — partsSubtotal must survive from the stored record.

  it("labor-hours scenario: patched labor + stored parts = correct total", () => {
    // Billing sheet: parts=$200, laborRate=$85/h. Tech edits hours to 2.
    // New labor = 2h × $85 = $170. Total = $370.
    const result = computeBillingSheetTotal(
      { laborSubtotal: "170.00" },
      { partsSubtotal: "200.00" },
    );
    assert.equal(n(result), 370.00);
  });
});

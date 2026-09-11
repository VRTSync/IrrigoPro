// Unit tests for the one shared budget classifier.
//
// Two contracts are under test and both must hold for every call site:
//
//   1. BOUNDARIES — soft and hard use ">=" semantics, so a value sitting
//      exactly on a threshold lands in the HIGHER bucket.
//   2. UNITS — the first argument is a RATIO (1 === 100% of cap) while the
//      thresholds are 0-to-100 percentages. Feeding a percentage where a
//      ratio belongs does not throw and does not fail to compile; it silently
//      reports every customer as "over". The unit-convention block below is
//      the only thing standing between that mistake and production.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyBudgetPercent, type BudgetStatus } from "./budget-status.js";

describe("classifyBudgetPercent — boundaries (default 75/100)", () => {
  it("is healthy just under the soft threshold", () => {
    assert.equal(classifyBudgetPercent(0.7499, 75, 100), "healthy");
    assert.equal(classifyBudgetPercent(0.5, 75, 100), "healthy");
    assert.equal(classifyBudgetPercent(0, 75, 100), "healthy");
  });
  it("is approaching exactly at the soft threshold", () => {
    assert.equal(classifyBudgetPercent(0.75, 75, 100), "approaching");
  });
  it("is approaching between soft and hard", () => {
    assert.equal(classifyBudgetPercent(0.9, 75, 100), "approaching");
    assert.equal(classifyBudgetPercent(0.9999, 75, 100), "approaching");
  });
  it("is over exactly at the hard threshold", () => {
    assert.equal(classifyBudgetPercent(1, 75, 100), "over");
  });
  it("is over above the hard threshold", () => {
    assert.equal(classifyBudgetPercent(1.5, 75, 100), "over");
    assert.equal(classifyBudgetPercent(12, 75, 100), "over");
  });
});

describe("classifyBudgetPercent — non-default per-customer thresholds", () => {
  it("honours a lower soft/hard pair", () => {
    assert.equal(classifyBudgetPercent(0.49, 50, 80), "healthy");
    assert.equal(classifyBudgetPercent(0.5, 50, 80), "approaching");
    assert.equal(classifyBudgetPercent(0.6, 50, 80), "approaching");
    assert.equal(classifyBudgetPercent(0.8, 50, 80), "over");
  });
  it("honours a higher soft/hard pair", () => {
    assert.equal(classifyBudgetPercent(0.89, 90, 120), "healthy");
    assert.equal(classifyBudgetPercent(0.9, 90, 120), "approaching");
    assert.equal(classifyBudgetPercent(1.19, 90, 120), "approaching");
    assert.equal(classifyBudgetPercent(1.2, 90, 120), "over");
  });
  it("collapses to two buckets when soft === hard", () => {
    assert.equal(classifyBudgetPercent(0.99, 100, 100), "healthy");
    assert.equal(classifyBudgetPercent(1, 100, 100), "over");
  });
});

describe("classifyBudgetPercent — every unset input", () => {
  it("returns unset for a null ratio (no cap, zero cap, negative cap)", () => {
    // Callers collapse "cap is null", "cap is 0" and "cap is negative" into a
    // null ratio before calling; all three arrive here identically.
    assert.equal(classifyBudgetPercent(null, 75, 100), "unset");
    assert.equal(classifyBudgetPercent(null, 50, 80), "unset");
  });
  it("returns unset regardless of thresholds", () => {
    for (const [soft, hard] of [[0, 0], [75, 100], [200, 400]] as const) {
      assert.equal(classifyBudgetPercent(null, soft, hard), "unset");
    }
  });
  it("never returns unset for a numeric ratio", () => {
    for (const ratio of [-1, 0, 0.5, 1, 99]) {
      const s: BudgetStatus = classifyBudgetPercent(ratio, 75, 100);
      assert.notEqual(s, "unset");
    }
  });
});

describe("classifyBudgetPercent — unit convention (ratio in, percent thresholds)", () => {
  // This is the whole risk of consolidating four classifiers: three of them
  // took a ratio and one took a 0-to-100 percentage. If someone "simplifies"
  // the implementation to compare the first argument against the thresholds
  // directly, every assertion below flips.

  it("treats the first argument as a ratio, not a percentage", () => {
    // 0.8 is 80% of cap → below the 100% hard threshold.
    assert.equal(classifyBudgetPercent(0.8, 75, 100), "approaching");
    // The same number read as a 0-to-100 percentage would be 80% → also
    // approaching, so that pair alone proves nothing. These do:
    assert.equal(classifyBudgetPercent(0.5, 75, 100), "healthy");
    assert.equal(classifyBudgetPercent(0.99, 75, 100), "approaching");
  });

  it("misreads a 0-to-100 percentage as a catastrophic overspend", () => {
    // Demonstrates the failure mode explicitly: 80 as a ratio is 8000% of cap.
    // A caller holding a percentage MUST divide by 100 (or classify the
    // underlying spend / cap) before calling.
    assert.equal(classifyBudgetPercent(80, 75, 100), "over");
    assert.equal(classifyBudgetPercent(80 / 100, 75, 100), "approaching");
    assert.equal(classifyBudgetPercent(10, 75, 100), "over");
    assert.equal(classifyBudgetPercent(10 / 100, 75, 100), "healthy");
  });

  it("reads thresholds as 0-to-100 percentages, not ratios", () => {
    // Passing 0.75 / 1.0 as thresholds (the inverse mistake) would make a
    // customer at 50% of cap read "over"; with the real convention it doesn't.
    assert.equal(classifyBudgetPercent(0.5, 75, 100), "healthy");
    assert.equal(classifyBudgetPercent(0.5, 0.75, 1), "over");
  });

  it("classifies spend/cap pairs the way each call site computes them", () => {
    // Every call site divides spend by cap and passes the quotient.
    const ratio = (spend: number, cap: number) => spend / cap;
    assert.equal(classifyBudgetPercent(ratio(500, 1000), 75, 100), "healthy");
    assert.equal(classifyBudgetPercent(ratio(750, 1000), 75, 100), "approaching");
    assert.equal(classifyBudgetPercent(ratio(1000, 1000), 75, 100), "over");
    assert.equal(classifyBudgetPercent(ratio(1500, 1000), 75, 100), "over");
    // BudgetBar holds (spend / cap) * 100 for the track width; classifying
    // that value directly is the exact bug this convention prevents.
    const barPercent = (500 / 1000) * 100;
    assert.equal(classifyBudgetPercent(barPercent, 75, 100), "over");
    assert.equal(classifyBudgetPercent(barPercent / 100, 75, 100), "healthy");
  });
});

// Task #687 — Financial Pulse Slice 1.
//
// Pure unit tests for the threshold classifier. Boundary cases matter:
// soft and hard thresholds use ">=" semantics (hitting 75% exactly is
// "approaching", hitting 100% exactly is "over").

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBudgetPercent,
  computePeriodUsage,
  getPeriodKeys,
} from "./budget-status";

describe("classifyBudgetPercent", () => {
  it("returns healthy below the soft threshold", () => {
    assert.equal(classifyBudgetPercent(0.5, 75, 100), "healthy");
    assert.equal(classifyBudgetPercent(0.7499, 75, 100), "healthy");
  });
  it("returns approaching at exactly the soft threshold", () => {
    assert.equal(classifyBudgetPercent(0.75, 75, 100), "approaching");
  });
  it("returns approaching between soft and hard", () => {
    assert.equal(classifyBudgetPercent(0.9, 75, 100), "approaching");
  });
  it("returns over at exactly the hard threshold", () => {
    assert.equal(classifyBudgetPercent(1.0, 75, 100), "over");
  });
  it("returns over above the hard threshold", () => {
    assert.equal(classifyBudgetPercent(1.5, 75, 100), "over");
  });
  it("honours non-default thresholds", () => {
    assert.equal(classifyBudgetPercent(0.6, 50, 80), "approaching");
    assert.equal(classifyBudgetPercent(0.8, 50, 80), "over");
    assert.equal(classifyBudgetPercent(0.49, 50, 80), "healthy");
  });
});

describe("computePeriodUsage", () => {
  it("returns unset when cap is null", () => {
    const r = computePeriodUsage(null, 1234, 75, 100, "2026-05");
    assert.equal(r.status, "unset");
    assert.equal(r.cap, null);
    assert.equal(r.percent, null);
    assert.equal(r.spend, 1234);
  });
  it("returns unset when cap is zero or negative", () => {
    assert.equal(computePeriodUsage(0, 100, 75, 100, "k").status, "unset");
    assert.equal(computePeriodUsage(-5, 100, 75, 100, "k").status, "unset");
  });
  it("returns healthy/approaching/over correctly", () => {
    assert.equal(computePeriodUsage(1000, 500, 75, 100, "k").status, "healthy");
    assert.equal(computePeriodUsage(1000, 750, 75, 100, "k").status, "approaching");
    assert.equal(computePeriodUsage(1000, 1000, 75, 100, "k").status, "over");
    assert.equal(computePeriodUsage(1000, 1500, 75, 100, "k").status, "over");
  });
});

describe("getPeriodKeys", () => {
  it("formats monthKey as YYYY-MM and yearKey as YYYY", () => {
    const k = getPeriodKeys(new Date(2026, 0, 15));
    assert.equal(k.monthKey, "2026-01");
    assert.equal(k.yearKey, "2026");
  });
  it("zero-pads the month", () => {
    const k = getPeriodKeys(new Date(2026, 8, 1));
    assert.equal(k.monthKey, "2026-09");
  });
});

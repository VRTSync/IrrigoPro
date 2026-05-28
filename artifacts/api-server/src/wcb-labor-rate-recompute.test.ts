/**
 * wcb-labor-rate-recompute.test.ts (Task #977)
 *
 * Pure unit tests for the recompute math used by
 * DatabaseStorage.recomputeWcbTotalsForLaborRate.
 *
 * We test the arithmetic in isolation by extracting the formula,
 * since the full storage method requires a live DB connection.
 *
 * Formula:
 *   laborSubtotal = totalHours × newRate
 *   totalAmount   = laborSubtotal + partsSubtotal
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

function recomputeWcbTotals(
  totalHours: string | number,
  partsSubtotal: string | number,
  newRate: number,
): { laborSubtotal: string; totalAmount: string; laborRate: string } {
  const hours = parseFloat(String(totalHours ?? "0")) || 0;
  const parts = parseFloat(String(partsSubtotal ?? "0")) || 0;
  const laborSubtotal = hours * newRate;
  const totalAmount = laborSubtotal + parts;
  return {
    laborRate: newRate.toFixed(2),
    laborSubtotal: laborSubtotal.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
  };
}

describe("recomputeWcbTotals math (Task #977)", () => {
  it("computes laborSubtotal = totalHours × newRate", () => {
    const result = recomputeWcbTotals("3.00", "0.00", 80);
    assert.equal(result.laborSubtotal, "240.00");
    assert.equal(result.totalAmount, "240.00");
    assert.equal(result.laborRate, "80.00");
  });

  it("adds partsSubtotal to totalAmount", () => {
    const result = recomputeWcbTotals("2.00", "150.00", 75);
    assert.equal(result.laborSubtotal, "150.00");
    assert.equal(result.totalAmount, "300.00");
  });

  it("handles fractional rates correctly", () => {
    const result = recomputeWcbTotals("1.50", "50.00", 45.5);
    assert.equal(result.laborSubtotal, "68.25");
    assert.equal(result.totalAmount, "118.25");
  });

  it("handles zero hours", () => {
    const result = recomputeWcbTotals("0.00", "200.00", 100);
    assert.equal(result.laborSubtotal, "0.00");
    assert.equal(result.totalAmount, "200.00");
  });

  it("handles zero rate", () => {
    const result = recomputeWcbTotals("4.00", "80.00", 0);
    assert.equal(result.laborSubtotal, "0.00");
    assert.equal(result.totalAmount, "80.00");
  });

  it("handles both zero hours and zero parts", () => {
    const result = recomputeWcbTotals("0.00", "0.00", 65);
    assert.equal(result.laborSubtotal, "0.00");
    assert.equal(result.totalAmount, "0.00");
  });

  it("preserves the new rate on the returned object", () => {
    const result = recomputeWcbTotals("1.00", "0.00", 123.45);
    assert.equal(result.laborRate, "123.45");
  });

  it("treats empty-string totalHours as 0", () => {
    const result = recomputeWcbTotals("" as unknown as string, "50.00", 60);
    assert.equal(result.laborSubtotal, "0.00");
    assert.equal(result.totalAmount, "50.00");
  });
});

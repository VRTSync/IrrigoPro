// Task #751 — Unit tests for the 0.25 quantization helper used in the
// issue-type-labor backfill script.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quantizeTo025 } from "./backfill-issue-type-labor-quarter";

describe("quantizeTo025", () => {
  const cases: Array<[string | number, string]> = [
    [0,      "0.25"],
    ["0",    "0.25"],
    ["0.10", "0.25"],
    ["0.33", "0.25"],
    ["0.40", "0.50"],
    ["1.00", "1.00"],
    ["1.55", "1.50"],
    [0.25,   "0.25"],
    [0.50,   "0.50"],
    [1.50,   "1.50"],
    [2.00,   "2.00"],
    ["0.05", "0.25"],
    ["0.13", "0.25"],
    ["0.63", "0.75"],
    ["0.75", "0.75"],
    ["1.25", "1.25"],
  ];

  for (const [input, expected] of cases) {
    it(`quantizeTo025(${JSON.stringify(input)}) === "${expected}"`, () => {
      assert.equal(quantizeTo025(input), expected);
    });
  }

  it("handles null as 0.25", () => {
    assert.equal(quantizeTo025(null), "0.25");
  });

  it("handles undefined as 0.25", () => {
    assert.equal(quantizeTo025(undefined), "0.25");
  });
});

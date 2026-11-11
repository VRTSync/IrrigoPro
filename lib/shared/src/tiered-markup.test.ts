import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCustomerPrice, computeTieredMarkup, DEFAULT_MARKUP_TIERS as tiers, validateMarkupTiers } from "./tiered-markup";

for (const [cost, markup, price] of [
  [180, 108.25, 288.25], [1.75, 2.63, 4.38], [1150, 341.25, 1491.25],
  [0, 0, 0], [.01, .02, .03], [5, 7.5, 12.5], [5.01, 7.51, 12.52],
  [500, 211.25, 711.25], [-1, 0, -1],
]) test(`cost ${cost}`, () => {
  assert.equal(computeTieredMarkup(cost, tiers), markup);
  assert.equal(computeCustomerPrice(cost, tiers), price);
});
test("empty schedule", () => {
  assert.equal(computeTieredMarkup(180, []), 0);
  assert.equal(computeCustomerPrice(180, []), 180);
});
test("exact half cents and adjacent boundaries", () => {
  assert.equal(computeTieredMarkup(.29, [{ tierOrder: 1, minCost: .01, maxCost: null, markupPercent: 50 }]), .15);
  for (const cost of [24.99, 25, 25.01, 99.99, 100, 100.01, 249.99, 250, 250.01, 499.99, 500, 500.01])
    assert.ok(computeCustomerPrice(cost, tiers) >= cost);
});
test("rejects invalid schedules and nonfinite values", () => {
  for (const bad of [
    [], [{ ...tiers[0], tierOrder: 2 }], [{ ...tiers[0], minCost: 0 }],
    [{ ...tiers[0], maxCost: null, markupPercent: -1 }],
    [{ ...tiers[0], maxCost: null, markupPercent: Infinity }],
    [{ ...tiers[0], maxCost: .01 }], [tiers[0], { ...tiers[1], minCost: 5.02 }],
  ]) assert.throws(() => validateMarkupTiers(bad));
  assert.throws(() => computeCustomerPrice(NaN, tiers));
});

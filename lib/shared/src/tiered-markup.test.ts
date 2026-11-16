import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCustomerPrice, computeMarkup, materialPriceChecks, DEFAULT_MARKUP_TIERS as tiers, validateMarkupTiers, validateMinimumMarkup } from "./tiered-markup";

const schedule = { tiers, minimumMarkupDollars: 2 };
// All nineteen reference cases from the flat-tier specification.
for (const [cost, price, markup] of [
  [180, 252, 72], [1.75, 4.38, 2.63], [1150, 1380, 230],
  [.25, 2.25, 2], [.65, 2.65, 2], [1, 3, 2], [1.5, 3.75, 2.25],
  [5, 12.5, 7.5], [5.01, 12.5, 7.49], [6.25, 12.5, 6.25], [7, 14, 7],
  [25.01, 50, 24.99], [100.01, 165, 64.99],
  [0, 0, 0], [-5, 0, 0], [.01, 2.01, 2], [500, 650, 150], [500.01, 650, 149.99],
]) test(`reference cost ${cost}`, () => {
  assert.equal(computeCustomerPrice(cost, schedule), price);
  assert.equal(computeMarkup(cost, schedule), markup);
});
test("reference empty schedule returns zero", () => {
  assert.equal(computeMarkup(180, { ...schedule, tiers: [] }), 0);
  assert.equal(computeCustomerPrice(180, { ...schedule, tiers: [] }), 0);
});
test("exact half cents round up without binary multiplication errors", () => {
  const single = { minimumMarkupDollars: 0, tiers: [{ tierOrder: 1, minCost: .01, maxCost: null, markupPercent: 50 }] };
  // IEEE multiplication yields 0.43499999999999994, but the exact price is 43.5 cents.
  assert.equal(computeCustomerPrice(.29, single), .44);
  assert.equal(computeMarkup(.29, single), .15);
  assert.equal(computeCustomerPrice(.27, single), .41);
  assert.equal(computeCustomerPrice(1.75, schedule), 4.38);
  assert.equal(computeCustomerPrice(.01, single), .02);
});
test("all boundaries and catchups follow the one-previous-tier rule", () => {
  for (const [cost, expected] of [[25, 50], [30.3, 50], [30.31, 50.01], [100, 165], [117.86, 165], [117.87, 165.02],
    [250, 350], [250.01, 350], [269.23, 350], [269.24, 350.01], [541.66, 650], [541.67, 650], [541.68, 650.02]]) {
    assert.equal(computeCustomerPrice(cost, schedule), expected, `cost ${cost}`);
  }
  const unusual = { minimumMarkupDollars: 0, tiers: tiers.map((t, i) => ({ ...t, markupPercent: i === 0 ? 999 : 0 })) };
  // Deliberately not a recursive floor across every earlier tier.
  assert.equal(computeCustomerPrice(25.01, unusual), 25.01);
});
test("custom minimum and detailed checks use the same winning result", () => {
  assert.deepEqual(materialPriceChecks(.25, schedule), { flatPrice: .63, minimumPrice: 2.25, neverLessPrice: 0, price: 2.25 });
  assert.equal(computeCustomerPrice(.25, { ...schedule, minimumMarkupDollars: 4.5 }), 4.75);
  assert.equal(computeCustomerPrice(5.01, { ...schedule, minimumMarkupDollars: 20 }), 25.01);
});
test("rejects invalid schedules, minimums and nonfinite values", () => {
  for (const bad of [
    [], [{ ...tiers[0], tierOrder: 2 }], [{ ...tiers[0], minCost: 0 }],
    [{ ...tiers[0], maxCost: null, markupPercent: -1 }],
    [{ ...tiers[0], maxCost: null, markupPercent: Infinity }],
    [{ ...tiers[0], maxCost: .01 }], [tiers[0], { ...tiers[1], minCost: 5.02 }],
  ]) assert.throws(() => validateMarkupTiers(bad));
  for (const value of [-1, NaN, Infinity, .001, 100000000]) assert.throws(() => validateMinimumMarkup(value));
  assert.throws(() => computeCustomerPrice(NaN, schedule));
});

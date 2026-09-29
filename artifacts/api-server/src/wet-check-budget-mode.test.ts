import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWetCheckCreateMode } from "./wet-check-budget-mode";

describe("resolveWetCheckCreateMode", () => {
  it("uses the customer's own company scope and reports a forced service mode", async () => {
    const calls: Array<[number, number]> = [];
    const decision = await resolveWetCheckCreateMode(42, 7, "service", async (customerId, companyId) => {
      calls.push([customerId, companyId]);
      return { allocation: 100, spend: 125, headroom: -25 };
    });

    assert.deepEqual(calls, [[42, 7]]);
    assert.equal(decision.mode, "inspection");
    assert.equal(decision.forced, true);
    assert.equal(decision.headroom, -25);
  });

  it("does not report a force for no allocation or an explicit inspection", async () => {
    const noBudget = async () => ({ allocation: null, spend: 0, headroom: null });
    assert.deepEqual(
      await resolveWetCheckCreateMode(42, 7, "service", noBudget),
      { allocation: null, spend: 0, headroom: null, mode: "service", forced: false },
    );
    assert.equal(
      (await resolveWetCheckCreateMode(42, 7, "inspection", async () => ({
        allocation: 100,
        spend: 125,
        headroom: -25,
      }))).forced,
      false,
    );
  });
});
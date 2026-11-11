import { describe, expect, it } from "vitest";
import { computeCustomerPrice, DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import { addLastTier, draftsToTiers, removeLastTier, tiersToDrafts } from "./markup-tier-form";

describe("markup tier form helpers", () => {
  it("round-trips default tiers and matches the reference examples", () => {
    const { tiers, error } = draftsToTiers(tiersToDrafts(DEFAULT_MARKUP_TIERS));
    expect(error).toBeNull();
    expect(tiers).toEqual(DEFAULT_MARKUP_TIERS);
    expect(computeCustomerPrice(180, tiers)).toBe(288.25);
    expect(computeCustomerPrice(1.75, tiers)).toBe(4.38);
    expect(computeCustomerPrice(1150, tiers)).toBe(1491.25);
  });

  it("adds and removes the last tier while staying valid", () => {
    const drafts = tiersToDrafts(DEFAULT_MARKUP_TIERS);
    const added = addLastTier(drafts);
    expect(added).toHaveLength(7);
    expect(draftsToTiers(added).error).toBeNull();
    const removed = removeLastTier(added);
    expect(removed).toHaveLength(6);
    expect(removed[5].maxCost).toBe("");
    expect(draftsToTiers(removed).error).toBeNull();
  });

  it("reports overlapping bounds and missing values", () => {
    const drafts = tiersToDrafts(DEFAULT_MARKUP_TIERS);
    drafts[1].maxCost = "4.00";
    expect(draftsToTiers(drafts).error).toMatch(/Upper bound/);
    const blank = tiersToDrafts(DEFAULT_MARKUP_TIERS);
    blank[0].markupPercent = "";
    expect(draftsToTiers(blank).error).toMatch(/markup percentage/);
  });
});

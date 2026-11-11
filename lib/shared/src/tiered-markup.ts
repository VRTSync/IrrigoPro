export interface MarkupTier {
  tierOrder: number;
  minCost: number;
  maxCost: number | null;
  markupPercent: number;
}

export const DEFAULT_MARKUP_TIERS: MarkupTier[] = ([
  [0.01, 5, 150], [5.01, 25, 100], [25.01, 100, 65],
  [100.01, 250, 40], [250.01, 500, 30], [500.01, null, 20],
] as [number, number | null, number][]).map(([minCost, maxCost, markupPercent], i) => ({
  tierOrder: i + 1, minCost: minCost!, maxCost, markupPercent: markupPercent!,
}));

const cents = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > 99999999.99) throw new Error("Invalid monetary value");
  return Math.round(value * 100);
};

export function validateMarkupTiers(tiers: readonly MarkupTier[]): void {
  if (!tiers.length) throw new Error("At least one tier is required");
  let next = 1;
  tiers.forEach((tier, i) => {
    if (tier.tierOrder !== i + 1) throw new Error("Tier order must be sequential starting at 1");
    if (cents(tier.minCost) !== next || tier.minCost !== cents(tier.minCost) / 100)
      throw new Error("Tiers must start at $0.01 and have no gaps or overlaps");
    if (!Number.isFinite(tier.markupPercent) || tier.markupPercent < 0 || tier.markupPercent > 999.99 ||
        tier.markupPercent !== Math.round(tier.markupPercent * 100) / 100)
      throw new Error("Markup must be between 0 and 999.99 with at most two decimals");
    if (tier.maxCost === null) {
      if (i !== tiers.length - 1) throw new Error("Only the final tier may be unbounded");
    } else {
      if (i === tiers.length - 1) throw new Error("Final tier must be unbounded");
      if (tier.maxCost !== cents(tier.maxCost) / 100 || cents(tier.maxCost) <= next)
        throw new Error("Upper bound must exceed lower bound");
      next = cents(tier.maxCost) + 1;
    }
  });
}

/** Integer cent portions × hundredths of a percent; round ONCE, exactly half-up. */
export function computeTieredMarkup(cost: number, tiers: readonly MarkupTier[]): number {
  if (!Number.isFinite(cost)) throw new Error("Invalid cost");
  if (cost <= 0 || !tiers.length) return 0;
  validateMarkupTiers(tiers);
  const costCents = cents(cost);
  let numerator = 0n;
  for (const tier of tiers) {
    const floor = cents(tier.minCost) - 1;
    const portion = Math.max(0, Math.min(costCents, tier.maxCost === null ? costCents : cents(tier.maxCost)) - floor);
    numerator += BigInt(portion) * BigInt(Math.round(tier.markupPercent * 100));
  }
  return Number((numerator + 5000n) / 10000n) / 100;
}

export function computeCustomerPrice(cost: number, tiers: readonly MarkupTier[]): number {
  if (!Number.isFinite(cost)) throw new Error("Invalid cost");
  if (cost <= 0 || !tiers.length) return cost;
  return (cents(cost) + cents(computeTieredMarkup(cost, tiers))) / 100;
}

export function isMaterialMarkupEligible(part: { cost?: unknown; category?: string | null }): boolean {
  return Number.isFinite(Number(part.cost)) && Number(part.cost) > 0 &&
    !["rental", "service", "labor"].includes((part.category ?? "").trim().toLowerCase());
}

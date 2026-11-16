export interface MarkupTier {
  tierOrder: number;
  minCost: number;
  maxCost: number | null;
  markupPercent: number;
}

export interface MarkupScheduleParams {
  tiers: readonly MarkupTier[];
  minimumMarkupDollars: number;
}

export const DEFAULT_MINIMUM_MARKUP_DOLLARS = 2;

/** The API retains decimal dollars as strings; convert at the shared-engine boundary. */
export function markupScheduleParams(context: {
  tiers: readonly MarkupTier[];
  schedule: { minimumMarkupDollars: string | number };
}): MarkupScheduleParams {
  return { tiers: context.tiers, minimumMarkupDollars: Number(context.schedule.minimumMarkupDollars) };
}

export function validateMinimumMarkup(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 99999999.99 || value !== Math.round(value * 100) / 100)
    throw new Error("Minimum markup must be a nonnegative dollar amount with at most two decimals");
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

/** Compare exact integer cent × rate numerators; round the winning price ONCE, half-up. */
export function materialPriceChecks(cost: number, schedule: MarkupScheduleParams) {
  if (!Number.isFinite(cost)) throw new Error("Invalid cost");
  const { tiers, minimumMarkupDollars } = schedule;
  if (cost <= 0 || !tiers.length) return { flatPrice: 0, minimumPrice: 0, neverLessPrice: 0, price: 0 };
  validateMarkupTiers(tiers);
  validateMinimumMarkup(minimumMarkupDollars);
  const costCents = cents(cost);
  const index = tiers.findIndex(t => t.maxCost === null || costCents <= cents(t.maxCost));
  const tierIndex = index < 0 ? tiers.length - 1 : index;
  const flat = (amount: number, tier: MarkupTier) => BigInt(amount) * (10000n + BigInt(Math.round(tier.markupPercent * 100)));
  const minimum = (amount: number) => BigInt(amount + cents(minimumMarkupDollars)) * 10000n;
  const flatPrice = flat(costCents, tiers[tierIndex]);
  const minimumPrice = minimum(costCents);
  let neverLessPrice = 0n;
  if (tierIndex > 0) {
    const previous = tiers[tierIndex - 1];
    const ceiling = cents(previous.maxCost!);
    const previousFlat = flat(ceiling, previous);
    const previousMinimum = minimum(ceiling);
    neverLessPrice = previousFlat > previousMinimum ? previousFlat : previousMinimum;
  }
  const winner = [flatPrice, minimumPrice, neverLessPrice].reduce((a, b) => a > b ? a : b);
  const rounded = (value: bigint) => Number((value + 5000n) / 10000n) / 100;
  return { flatPrice: rounded(flatPrice), minimumPrice: rounded(minimumPrice), neverLessPrice: rounded(neverLessPrice), price: rounded(winner) };
}

export function computeCustomerPrice(cost: number, schedule: MarkupScheduleParams): number {
  return materialPriceChecks(cost, schedule).price;
}

export function computeMarkup(cost: number, schedule: MarkupScheduleParams): number {
  const price = computeCustomerPrice(cost, schedule);
  return cost <= 0 || !schedule.tiers.length ? 0 : (cents(price) - cents(cost)) / 100;
}

/** Kept as an export alias for consumers; the calculation is now flat-tier. */
export const computeTieredMarkup = computeMarkup;
export function isMaterialMarkupEligible(part: { cost?: unknown; category?: string | null }): boolean {
  return Number.isFinite(Number(part.cost)) && Number(part.cost) > 0 &&
    !["rental", "service", "labor"].includes((part.category ?? "").trim().toLowerCase());
}

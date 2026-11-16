import { validateMarkupTiers, validateMinimumMarkup, type MarkupTier } from "@workspace/shared";

export function minimumMarkupError(value: string): string | null {
  if (value.trim() === "") return "Enter a minimum markup";
  try { validateMinimumMarkup(Number(value)); return null; }
  catch (e) { return e instanceof Error ? e.message : "Invalid minimum markup"; }
}

/** Editable row: the lower bound is derived from the previous upper bound. */
export interface TierDraft {
  maxCost: string;
  markupPercent: string;
}

export const MARKUP_EXAMPLE_COSTS = [180, 1.75, 1150] as const;

const toCents = (v: number) => Math.round(v * 100);

export function tiersToDrafts(tiers: readonly MarkupTier[]): TierDraft[] {
  return [...tiers]
    .sort((a, b) => a.tierOrder - b.tierOrder)
    .map((t) => ({
      maxCost: t.maxCost === null ? "" : t.maxCost.toFixed(2),
      markupPercent: String(t.markupPercent),
    }));
}

/** Converts drafts to numeric tiers and validates them with the shared engine rules. */
export function draftsToTiers(drafts: readonly TierDraft[]): { tiers: MarkupTier[]; error: string | null } {
  const tiers: MarkupTier[] = [];
  let nextMinCents = 1;
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const isLast = i === drafts.length - 1;
    const pct = d.markupPercent.trim() === "" ? NaN : Number(d.markupPercent);
    if (!Number.isFinite(pct)) return { tiers, error: `Tier ${i + 1}: enter a markup percentage` };
    let maxCost: number | null = null;
    if (!isLast) {
      const max = d.maxCost.trim() === "" ? NaN : Number(d.maxCost);
      if (!Number.isFinite(max)) return { tiers, error: `Tier ${i + 1}: enter an upper bound` };
      maxCost = max;
    }
    tiers.push({ tierOrder: i + 1, minCost: nextMinCents / 100, maxCost, markupPercent: pct });
    if (maxCost !== null) nextMinCents = toCents(maxCost) + 1;
  }
  try {
    validateMarkupTiers(tiers);
  } catch (e) {
    return { tiers, error: e instanceof Error ? e.message : "Invalid tiers" };
  }
  return { tiers, error: null };
}

/** Lower bound shown for row i, derived from the previous row's upper bound. */
export function lowerBoundFor(drafts: readonly TierDraft[], i: number): string {
  if (i === 0) return "0.01";
  const prev = Number(drafts[i - 1].maxCost);
  if (!Number.isFinite(prev) || drafts[i - 1].maxCost.trim() === "") return "—";
  return ((toCents(prev) + 1) / 100).toFixed(2);
}

/** Appends a tier: the previous final tier gets a finite upper bound. */
export function addLastTier(drafts: readonly TierDraft[]): TierDraft[] {
  if (drafts.length >= 100) return [...drafts];
  const lower = Number(lowerBoundFor(drafts, drafts.length - 1));
  const base = Number.isFinite(lower) ? lower : 0.01;
  const suggestedMax = Math.max(base * 2, base + 99.99);
  const copy = drafts.map((d) => ({ ...d }));
  const last = copy[copy.length - 1];
  last.maxCost = suggestedMax.toFixed(2);
  copy.push({ maxCost: "", markupPercent: last.markupPercent });
  return copy;
}

/** Removes the final tier; the new final tier becomes unbounded. */
export function removeLastTier(drafts: readonly TierDraft[]): TierDraft[] {
  if (drafts.length <= 1) return [...drafts];
  const copy = drafts.slice(0, -1).map((d) => ({ ...d }));
  copy[copy.length - 1].maxCost = "";
  return copy;
}

export function formatMoney(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function isNotFoundError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { status?: number }).status === 404;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
    if (err instanceof Error && err.message) return err.message;
  }
  return fallback;
}

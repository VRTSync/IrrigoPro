// ─── Budget status classification ───────────────────────────────────────────
//
// One home for the rule that turns "how much of the cap has this customer
// spent" into the four-state budget bucket. Before this module the same
// classifier was written out four separate times: the API server's
// budget-status helper, the Financial Pulse math module, the BudgetBar
// component, and the customer form's live preview. Every surface that shows a
// budget meter now imports from here, so the bucket a manager sees on the
// Budget Status page and the bucket the alert service fires on cannot drift
// apart.
//
// ── UNIT CONVENTION — read before calling ──────────────────────────────────
// The two units in play are NOT interchangeable and neither mistake throws:
//
//   usageRatio   spend / cap, as a RATIO. 1 means "100% of cap". 0.8 is 80%.
//   soft/hard    thresholds as 0-to-100 PERCENTAGES. 75 means "75% of cap".
//
// Passing a 0-to-100 percentage as `usageRatio` makes 80% arrive as 8000% and
// every customer reads "over"; passing a ratio as a threshold makes every
// customer read "healthy". Call sites that hold a 0-to-100 percentage must
// divide by 100 — or better, classify the underlying `spend / cap` directly.
// The parameter is named `usageRatio` for exactly this reason.

export type BudgetStatus = "unset" | "healthy" | "approaching" | "over";

/**
 * Map (usageRatio, soft, hard) to the four-state status bucket.
 *
 * Boundary semantics matter for alerts:
 *   - `usageRatio * 100 <  soft`                → healthy
 *   - `soft <= usageRatio * 100 <  hard`        → approaching
 *   - `usageRatio * 100 >= hard`                → over
 *
 * That is, hitting the soft threshold exactly enters `approaching`, and
 * hitting the hard threshold exactly enters `over` — a boundary always lands
 * in the higher bucket. This matches the common-sense reading of "we've
 * reached 100% of cap" → over.
 *
 * `usageRatio === null` means the customer has no usable cap (unset, zero, or
 * negative) and yields `unset`. Deciding *whether* a cap is usable stays with
 * the caller, which is the only place that can see the raw cap; every caller
 * today treats null / non-positive as no cap.
 *
 * @param usageRatio spend / cap as a RATIO (1 === 100% of cap), or null when
 *                   there is no usable cap. NOT a 0-to-100 percentage.
 * @param softPercent soft threshold as a 0-to-100 percentage (default 75).
 * @param hardPercent hard threshold as a 0-to-100 percentage (default 100).
 */
export function classifyBudgetPercent(
  usageRatio: number,
  softPercent: number,
  hardPercent: number,
): Exclude<BudgetStatus, "unset">;
export function classifyBudgetPercent(
  usageRatio: number | null,
  softPercent: number,
  hardPercent: number,
): BudgetStatus;
export function classifyBudgetPercent(
  usageRatio: number | null,
  softPercent: number,
  hardPercent: number,
): BudgetStatus {
  if (usageRatio == null) return "unset";
  const pctOfCap = usageRatio * 100;
  if (pctOfCap >= hardPercent) return "over";
  if (pctOfCap >= softPercent) return "approaching";
  return "healthy";
}

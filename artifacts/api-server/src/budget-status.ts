// Task #687 — Financial Pulse Slice 1.
//
// Pure helpers shared by the `/api/customers/:id/budget-usage` route and
// the future alert-firing path (Slice 2). Kept side-effect free so unit
// tests can exercise the threshold math without HTTP or a DB.

export type BudgetPeriod = "monthly" | "annual";
export type BudgetStatus = "unset" | "healthy" | "approaching" | "over";

export interface BudgetPeriodUsage {
  /** The cap for this period, or null when the user hasn't set one. */
  cap: number | null;
  /** Sum of non-draft / non-cancelled invoice totals in the period. */
  spend: number;
  /**
   * `spend / cap` expressed as 0..n (n can exceed 1 when over). `null`
   * when no cap is set so the UI can render an "unset" state without
   * dividing by zero.
   */
  percent: number | null;
  status: BudgetStatus;
  /** Bucket key — 'YYYY-MM' for monthly, 'YYYY' for annual. */
  periodKey: string;
}

/**
 * Map (percent, soft, hard) to the four-state status bucket.
 *
 * Boundary semantics matter for alerts later:
 *   - `percent < soft`              → healthy
 *   - `soft <= percent < hard`      → approaching
 *   - `percent >= hard`             → over
 *
 * That is, hitting the soft threshold exactly enters `approaching`, and
 * hitting the hard threshold exactly enters `over`. This matches the
 * common-sense reading of "we've reached 100% of cap" → over.
 */
export function classifyBudgetPercent(
  percent: number,
  softPercent: number,
  hardPercent: number,
): Exclude<BudgetStatus, "unset"> {
  const pctOfCap = percent * 100;
  if (pctOfCap >= hardPercent) return "over";
  if (pctOfCap >= softPercent) return "approaching";
  return "healthy";
}

export function computePeriodUsage(
  cap: number | null,
  spend: number,
  softPercent: number,
  hardPercent: number,
  periodKey: string,
): BudgetPeriodUsage {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) {
    return { cap: null, spend, percent: null, status: "unset", periodKey };
  }
  const percent = spend / cap;
  return {
    cap,
    spend,
    percent,
    status: classifyBudgetPercent(percent, softPercent, hardPercent),
    periodKey,
  };
}

/** Period keys for "now": monthly = 'YYYY-MM', annual = 'YYYY'. */
export function getPeriodKeys(now: Date = new Date()): {
  monthKey: string;
  yearKey: string;
} {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { monthKey: `${y}-${m}`, yearKey: String(y) };
}

/**
 * Inclusive start, exclusive end window for the calendar month containing
 * `now`. Mirrors the `getThisMonthBilledForCompany` boundaries in storage.
 */
export function getMonthWindow(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

export function getYearWindow(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear() + 1, 0, 1),
  };
}

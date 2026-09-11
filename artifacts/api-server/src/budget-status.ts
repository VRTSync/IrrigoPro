// Task #687 — Financial Pulse Slice 1.
//
// Pure helpers shared by the `/api/customers/:id/budget-usage` route and
// the future alert-firing path (Slice 2). Kept side-effect free so unit
// tests can exercise the threshold math without HTTP or a DB.

// Task #2008 — the classifier and the BudgetStatus union now live in
// lib/shared/src/budget-status.ts so the API server, Financial Pulse, the
// BudgetBar component and the customer form's live preview all bucket a
// customer identically. Re-exported here so existing importers of this module
// keep working. NOTE the unit convention: `classifyBudgetPercent` takes
// spend / cap as a RATIO and thresholds as 0-to-100 percentages.
import { classifyBudgetPercent, type BudgetStatus } from "@workspace/shared";
export { classifyBudgetPercent } from "@workspace/shared";
export type { BudgetStatus } from "@workspace/shared";

export type BudgetPeriod = "monthly" | "annual";

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

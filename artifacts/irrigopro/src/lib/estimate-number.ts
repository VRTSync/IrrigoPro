// Task #678 — display-time "EST-" prefix.
// The database stores only the raw digits in `estimates.estimateNumber`
// (e.g. "50001"). This helper is the single source of truth for the
// human-readable rendering of an estimate number across the frontend.
// It tolerates already-prefixed legacy values defensively by stripping
// any leading "EST-" / "EST" / "#" before re-prepending the canonical
// "EST-" prefix.

export function formatEstimateNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const digits = raw.replace(/^#\s*/, "").replace(/^EST[-\s]*/i, "");
  return `EST-${digits}`;
}

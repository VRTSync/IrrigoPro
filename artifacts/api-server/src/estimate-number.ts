// Task #678 — display-time "EST-" prefix.
// The database stores only the raw digits in `estimates.estimateNumber`.
// This helper formats the human-readable value for any server-rendered
// surface (PDF, email subject/body, audit summaries). Validation,
// uniqueness, and the per-company sequence allocator continue to
// operate on the raw digits — never call this before a DB write.

export function formatEstimateNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const digits = raw.replace(/^#\s*/, "").replace(/^EST[-\s]*/i, "");
  return `EST-${digits}`;
}

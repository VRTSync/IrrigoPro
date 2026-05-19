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

// Task #691 — Sanitize a customer name for use in a downloaded file name.
// Replaces filesystem-reserved characters on Windows/macOS (/ \ : * ? " < > |)
// and ASCII control chars with a space, collapses whitespace runs, and trims.
export function sanitizeFilenameSegment(value: string | null | undefined): string {
  if (!value) return "";
  // eslint-disable-next-line no-control-regex
  return String(value)
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Task #691 — Build the download filename for an estimate PDF.
// Format: "{Customer Name} - EST-{Number}.pdf". Falls back to
// "estimate-EST-{Number}.pdf" when the customer name is empty after
// sanitization, and to "estimate.pdf" when the number is missing.
export function buildEstimatePdfFilename(
  estimateNumber: string | number | null | undefined,
  customerName: string | null | undefined,
): string {
  const formattedNumber = formatEstimateNumber(estimateNumber);
  if (!formattedNumber) return "estimate.pdf";
  const safeCustomer = sanitizeFilenameSegment(customerName);
  if (!safeCustomer) return `estimate-${formattedNumber}.pdf`;
  return `${safeCustomer} - ${formattedNumber}.pdf`;
}

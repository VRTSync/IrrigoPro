import { WET_CHECK_ISSUE_TYPE_SEED } from "@workspace/db";

// Map from raw issueType enum value → human-readable label.
// Derived from the canonical seed so labels stay in sync with the
// issue_type_configs table and the wet-check UI.
const ISSUE_LABEL_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  WET_CHECK_ISSUE_TYPE_SEED.map((s) => [s.issueType, s.displayLabel]),
);

/**
 * Returns the human-readable label for a raw issue type enum value.
 *
 * Used by the inspection-estimate generator (storage.ts) and by the
 * inspection-estimate PDF renderer (Slice 2) so the label is derived
 * from a single source of truth on both paths.
 *
 * Falls back to a title-cased transformation of the enum string when
 * the issue type is not in the seed (future-proofs against new types
 * before the seed is updated).
 */
export function humanizeIssueType(issueType: string | null | undefined): string {
  if (!issueType) return "Finding";
  return (
    ISSUE_LABEL_MAP[issueType] ??
    issueType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

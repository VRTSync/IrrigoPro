// Pure builder for the body of POST/PATCH /api/wet-checks/.../findings.
// Extracted from FindingSheet.saveMut so the payload semantics — especially
// the rules around `repairedInField`, `techDisposition`, and the labor-only
// `noPartNeeded` confirmation — can be locked in by tests without mounting
// the full sheet UI.
//
// Task #468 — when a tech edits a finding that's already
// `repaired_in_field` / `completed_in_field`, the PATCH body must keep
// `repairedInField: true` and preserve the existing `noPartNeeded` value
// instead of silently demoting the finding back to pending.

// ─── Custom-review type constant ─────────────────────────────────────────────
// "Custom — Flag for Manager" is a synthetic issue type stored in the existing
// `issueType` column.  It never comes from the WET_CHECK_ISSUE_TYPE_SEED and
// is never auto-billed. Description lives in `notes`, disposition is always
// `needs_review`, and ≥1 photo is required before the tech can move on.
export const CUSTOM_REVIEW_ISSUE_TYPE = "custom_review";

/** True when the issueType represents a tech-flagged-for-manager finding. */
export function isCustomReview(issueType: string | null | undefined): boolean {
  return issueType === CUSTOM_REVIEW_ISSUE_TYPE;
}

/**
 * Canonical predicate: a finding belongs to the manager review queue when
 * it is unresolved AND either:
 *   - it was explicitly flagged as custom_review, OR
 *   - the tech disposition is not "completed_in_field"
 *
 * Routing rules:
 *   - custom_review: always needs_review while resolution='pending'; drops
 *     out of the queue once the manager routes it (resolution changes).
 *   - completed_in_field: auto-routed to WCB snapshot on Approve & Convert,
 *     so it is excluded from the manager decision queue.
 *   - All other unresolved findings with techDisposition!='completed_in_field'
 *     need a manager routing decision.
 *
 * Used in the manager wizard, combined-review surface, and submit hardening.
 */
export function isNeedsReview(f: {
  resolution?: string | null;
  techDisposition?: string | null;
  issueType?: string | null;
}): boolean {
  // Must be unresolved in all cases.
  if ((f.resolution ?? "pending") !== "pending") return false;
  // custom_review findings always need review (no-part, no auto-bill).
  if (isCustomReview(f.issueType)) return true;
  // Non-custom: needs review unless the tech marked it completed_in_field.
  return f.techDisposition !== "completed_in_field";
}

export type FindingSavePayloadInput = {
  selectedPart: { id: number | null; name: string | null; price: string | null } | null;
  partFromEdit: { id: number | null; name: string | null; price: string | null } | null;
  quantity: string;
  laborHours: string;
  notes: string;
  repairedInField: boolean;
  noPartNeeded: boolean;
};

export type FindingSavePayload = {
  partId: number | null;
  partName: string | null;
  partPrice: string | null;
  quantity: number;
  laborHours: string;
  notes: string | null;
  repairedInField: boolean;
  techDisposition: "completed_in_field" | "needs_review";
  noPartNeeded: boolean;
};

export function effectivePart(
  selectedPart: FindingSavePayloadInput["selectedPart"],
  partFromEdit: FindingSavePayloadInput["partFromEdit"],
): { id: number | null; name: string | null; price: string | null } {
  if (selectedPart) return { id: selectedPart.id, name: selectedPart.name, price: selectedPart.price };
  if (partFromEdit) return partFromEdit;
  return { id: null, name: null, price: null };
}

// Snap any incoming laborHours string to the nearest 0.25 increment,
// with a floor of 0.25. Used by buildFindingSavePayload and available
// as a standalone export for testing.
export function quantizeLaborHours(v: string): string {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return "0.25";
  const snapped = Math.round(n * 4) / 4;
  return Math.max(0.25, snapped).toFixed(2);
}

export function buildFindingSavePayload(input: FindingSavePayloadInput): FindingSavePayload {
  const p = effectivePart(input.selectedPart, input.partFromEdit);
  return {
    partId: p.id,
    partName: p.name,
    partPrice: p.price,
    quantity: Math.max(1, parseInt(input.quantity) || 1),
    laborHours: input.laborHours ? quantizeLaborHours(input.laborHours) : "0.25",
    notes: input.notes || null,
    repairedInField: input.repairedInField,
    // Task #428 — tech disposition mirrors the Mark Complete toggle so an
    // explicit completed-in-field repair is captured even when
    // WET_CHECK_AUTO_BILL is off.
    techDisposition: input.repairedInField ? "completed_in_field" : "needs_review",
    // Task #464 — labor-only Mark Complete confirmation. Picking a part
    // always wins (server also force-clears this when partId is set), so
    // the two states cannot both be true on a finding.
    noPartNeeded: !p.id && input.repairedInField ? input.noPartNeeded : false,
  };
}

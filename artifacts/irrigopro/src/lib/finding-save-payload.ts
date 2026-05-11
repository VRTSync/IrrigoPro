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

export function buildFindingSavePayload(input: FindingSavePayloadInput): FindingSavePayload {
  const p = effectivePart(input.selectedPart, input.partFromEdit);
  return {
    partId: p.id,
    partName: p.name,
    partPrice: p.price,
    quantity: Math.max(1, parseInt(input.quantity) || 1),
    laborHours: input.laborHours || "0",
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

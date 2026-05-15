// Task #612 — pure helpers that encode the wet-check finding row
// invariants. Extracted from storage.ts so they can be unit-tested
// without standing up a Drizzle connection. Storage calls these
// helpers from `updateWetCheckFinding` to keep the two finding-state
// invariants in sync:
//
//   1. partId set       →  noPartNeeded must be false
//   2. noPartNeeded=true →  partId/partName/partPrice must be null
//
// The pre-Task-#612 code only enforced (1). Without (2), a tech who
// flipped "no part needed" on a finding that already had a part
// could land the row in the forbidden double-true state, which
// tripped the auto-bill preview.

import type { InsertWetCheckFinding } from "@workspace/db";

export type FindingPatchInput = Partial<InsertWetCheckFinding>;

/**
 * Mutates `next` in-place so the partId / noPartNeeded invariants
 * always hold for the row that will be written.
 *
 * Caller is expected to have already loaded the part snapshot
 * (partName/partPrice) into `next` when `patch.partId != null` —
 * this helper only enforces the cross-field invariant.
 */
export function applyNoPartNeededInvariant(
  patch: FindingPatchInput,
  next: FindingPatchInput,
): void {
  if (patch.partId != null) {
    // Assigning a part always wins over the labor-only flag.
    next.noPartNeeded = false;
    return;
  }
  if (patch.noPartNeeded === true && patch.partId === undefined) {
    // Flipping the labor-only flag without touching partId on a row
    // that already had a part snapshot — clear the snapshot so the
    // two states can never both be true.
    next.partId = null;
    next.partName = null;
    next.partPrice = null;
  }
}

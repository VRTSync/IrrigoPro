// Reconcile seam — Slice 6 Phase 1.
//
// `resolveWetCheckControllers` is the single call site that the wet-check
// capture and grid screens should use to determine which controllers/zones
// to display for a customer+branch. Today it always falls back to the old
// `property_controllers` table (letter + zone-count only). When a full
// irrigation profile exists in `irrigation_controllers` for this customer/branch
// it should eventually return that richer data instead — that unification is
// a follow-up task tracked separately.
//
// Phase 1 contract:
//   - Return type matches the shape consumed by wet-check capture (list of
//     letters + zone counts). This will change when unification happens.
//   - No business logic lives here today; just the storage call so the
//     follow-up can swap the implementation in one place.

import { storage } from "./storage";

export interface ResolvedController {
  letter: string;
  zoneCount: number;
  notes: string | null;
}

/**
 * Returns the controllers that should drive the wet-check grid for a given
 * customer+branch combination. Currently always reads from `property_controllers`
 * (the legacy wet-check grid table).
 *
 * TODO (follow-up unification task): when an irrigation profile exists in
 * `irrigation_controllers` for this companyId + customerId + branchName,
 * derive the controller letters and zone counts from that profile instead,
 * so techs don't need to enter controllers twice.
 */
export async function resolveWetCheckControllers(
  companyId: number,
  customerId: number,
  branchName?: string | null,
): Promise<ResolvedController[]> {
  // Phase 1: always fall back to property_controllers (old table).
  const rows = await storage.listPropertyControllers(companyId, customerId);

  const branch = branchName ?? null;
  const filtered = branch
    ? rows.filter((r) => (r.branchName || null) === branch)
    : rows;

  return filtered.map((r) => ({
    letter: r.controllerLetter,
    zoneCount: r.zoneCount,
    notes: r.notes ?? null,
  }));
}

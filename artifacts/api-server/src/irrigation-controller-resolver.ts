// Reconcile seam — Slice 6.
//
// `resolveWetCheckControllers` is the single call site that the wet-check
// capture and grid screens use to determine which controllers/zones to display
// for a customer+branch. It now reads from `irrigation_controllers` first
// (the canonical post-unification table), falling back to the legacy
// `property_controllers` table only when no irrigation profile exists for
// the customer+branch yet (pre-seed state).
//
// Mapping from irrigation_controllers → wet-check grid shape:
//   name:        "Controller A" → letter: "A"
//   totalZones:  integer        → zoneCount: integer (defaults to 12 if null)
//   notes:       string | null  → notes: string | null

import { storage } from "./storage";

export interface ResolvedController {
  letter: string;
  zoneCount: number;
  notes: string | null;
}

/** Extract the single uppercase letter from a controller name like "Controller A". */
function extractLetter(name: string): string {
  return (
    name.trim().split(/\s+/).pop()?.slice(-1).toUpperCase() ??
    name.slice(0, 1).toUpperCase()
  );
}

/**
 * Returns the controllers that should drive the wet-check grid for a given
 * customer+branch combination.
 *
 * Priority:
 *  1. `irrigation_controllers` for this (companyId, customerId, branchName) tuple —
 *     the canonical post-unification source.
 *  2. Legacy `property_controllers` — only when no irrigation profile exists yet
 *     (pre-seed state, before the admin migration or lazy-seed has run).
 */
export async function resolveWetCheckControllers(
  companyId: number,
  customerId: number,
  branchName?: string | null,
): Promise<ResolvedController[]> {
  const branch = branchName ?? null;
  const branchArg = typeof branch === "string" ? branch : undefined;

  // 1. Try irrigation_controllers first (single source of truth).
  const irrigCtrls = await storage.listIrrigationControllers(
    companyId,
    customerId,
    branchArg,
  );

  if (irrigCtrls.length > 0) {
    return irrigCtrls.map((ctrl) => ({
      letter: extractLetter(ctrl.name),
      zoneCount: ctrl.totalZones ?? 12,
      notes: ctrl.notes ?? null,
    }));
  }

  // 2. Fall back to property_controllers (legacy pre-seed state).
  const legacyRows = await storage.listPropertyControllers(companyId, customerId);
  const filtered = branch !== null
    ? legacyRows.filter((r) => (r.branchName || null) === branch)
    : legacyRows;

  return filtered.map((r) => ({
    letter: r.controllerLetter,
    zoneCount: r.zoneCount,
    notes: r.notes ?? null,
  }));
}

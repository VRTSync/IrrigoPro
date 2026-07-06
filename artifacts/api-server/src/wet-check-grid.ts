/**
 * Wet-check controller grid building.
 *
 * This module owns the decision logic for how many controllers and zones go into
 * a wet-check or controller-read grid:
 *
 *   1. If irrigation_controllers rows exist for the (company, customer, branch)
 *      triple → use them as the authoritative source (profile path).
 *   2. Otherwise → fall back to `customers.totalControllers` (clamped 1–26) plus
 *      the `property_controllers` zone-count map (legacy path, unchanged behaviour).
 *
 * The logic is extracted here so it can be covered by isolated tests without
 * standing up a full Express + database integration harness.
 */

export interface IrrigationControllerRow {
  name: string;
  totalZones: number | null;
}

export interface PropertyControllerRow {
  branchName: string | null;
  controllerLetter: string;
  zoneCount: number | null;
}

export interface GridSeedConfig {
  name: string;
  zoneCount: number | null;
}

export interface GridResult {
  numControllers: number;
  seedConfigs: GridSeedConfig[];
}

/**
 * Build the seed-config array used to call `ensureIrrigationControllers`.
 *
 * @param irrigCtrls   Rows from `listIrrigationControllers` for this
 *                     (companyId, customerId, branchKey) triple.
 *                     Pass the **already-scoped** list — branchKey="" for
 *                     customer-level, a string for branch-level.
 * @param totalControllers  `customers.totalControllers` integer (legacy fallback count).
 * @param legacyPCs    All `property_controllers` rows for this customer (any branch).
 * @param branchKey    The bucket key used for `irrigation_controllers` queries.
 *                     "" for customer-level, a named string for branch-level.
 *                     Used only for legacy-path branch filtering of `legacyPCs`.
 */
export function buildWetCheckGrid(
  irrigCtrls: IrrigationControllerRow[],
  totalControllers: number | null | undefined,
  legacyPCs: PropertyControllerRow[],
  branchKey: string,
): GridResult {
  if (irrigCtrls.length > 0) {
    // Profile path: count and zone configs come entirely from irrigation_controllers.
    // Zone counts are passed through as-is — null is NOT defaulted to 12.
    return {
      numControllers: irrigCtrls.length,
      seedConfigs: irrigCtrls.map(ctrl => ({
        name: ctrl.name,
        zoneCount: ctrl.totalZones ?? null,
      })),
    };
  }

  // Legacy path: keep the exact behaviour that existed before this module was
  // introduced. Count = clamp(customers.totalControllers, 1, 26).
  // Zone counts come from property_controllers rows that match the branch bucket.
  const numControllers = Math.max(1, Math.min(26, Number(totalControllers ?? 1)));
  const pcMap = new Map(
    legacyPCs
      .filter(r => (r.branchName ?? "") === branchKey)
      .map(r => [r.controllerLetter, r]),
  );
  const seedConfigs = Array.from({ length: numControllers }, (_, i) => {
    const letter = String.fromCharCode("A".charCodeAt(0) + i);
    const pc = pcMap.get(letter);
    return { name: `Controller ${letter}`, zoneCount: pc?.zoneCount ?? null } satisfies GridSeedConfig;
  });
  return { numControllers, seedConfigs };
}

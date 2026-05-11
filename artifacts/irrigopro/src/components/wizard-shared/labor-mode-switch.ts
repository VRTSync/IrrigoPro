export type LaborMode = "flat" | "per_part";

export interface SwitchableLaborItem {
  laborHours: number;
  quantity: number;
}

/**
 * Task #396 — Pure helper for the labor-mode toggle on a wizard.
 *
 * When switching from `per_part` → `flat`, prepopulate the flat total with the
 * current sum of per-row labor hours so the visible total doesn't snap to 0.
 * In every other transition the existing flat hours are preserved untouched.
 *
 * Returns the next `flatTotalHours` value to apply.
 */
export function nextFlatTotalHoursForModeSwitch(
  currentMode: LaborMode,
  nextMode: LaborMode,
  currentFlatTotalHours: number,
  items: SwitchableLaborItem[],
): number {
  if (nextMode === "flat" && currentMode === "per_part") {
    const summed = items.reduce(
      (acc, it) => acc + Number(it.laborHours || 0) * Number(it.quantity || 0),
      0,
    );
    if (summed > 0) return summed;
  }
  return currentFlatTotalHours;
}

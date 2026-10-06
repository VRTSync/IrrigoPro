export type ZoneActor = { id: number | null; name: string };
export type ZoneChanges = { created: number[]; restored: number[]; retired: number[] };

export const CLEAR_ZONE_COUNT_MESSAGE = "A zone count can't be cleared. Lower it instead — zones above the new count are retired and their history is kept.";
export class ZoneCountClearError extends Error {
  constructor() { super(CLEAR_ZONE_COUNT_MESSAGE); this.name = "ZoneCountClearError"; }
}

export function validateZoneCount(target: number): void {
  if (!Number.isInteger(target) || target < 1 || target > 100) {
    throw new RangeError("zone count must be 1-100");
  }
}

export function zonePlaceholder(n: number) {
  return { name: `Zone ${n}`, zoneType: "other", runTimeMinutes: 0, zoneOrder: n, isActive: true };
}

export function compressZoneRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join(", ");
}

export function zoneCountSummary(old: number | null, target: number, changes: ZoneChanges): string {
  let summary = `Zone count ${old ?? "not set"} → ${target}`;
  if (changes.created.length) summary += `; added zones ${compressZoneRanges(changes.created)}`;
  if (changes.restored.length) summary += `; restored zones ${compressZoneRanges(changes.restored)}`;
  if (changes.retired.length) summary += `; retired zones ${compressZoneRanges(changes.retired)} (history kept)`;
  return summary;
}

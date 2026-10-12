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

export const ZONE_EDIT_SUMMARY_PREFIX = "Zones edited: ";
export function zoneEditSummary(numbers: number[]): string {
  // Session summaries list pairs separately, retaining the specified
  // "3, 4, 7" wording; runs of three or more remain compressed.
  return ZONE_EDIT_SUMMARY_PREFIX + compressZoneRanges(numbers).replace(/(\d+)-(\d+)/g, (range, start, end) =>
    Number(end) === Number(start) + 1 ? `${start}, ${end}` : range);
}
export function parseZoneRanges(value: string): number[] {
  const numbers: number[] = [];
  for (const token of value.split(",")) {
    const match = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(token);
    if (!match) return [];
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > 100) return [];
    for (let n = start; n <= end; n++) numbers.push(n);
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export type BulkZonePatch = { zoneType?: string; programId?: number | null; runTimeMinutes?: number };
export class ZoneProgramError extends Error {
  constructor() { super("Program not on this controller"); }
}

export function zoneCountSummary(old: number | null, target: number, changes: ZoneChanges): string {
  let summary = `Zone count ${old ?? "not set"} → ${target}`;
  if (changes.created.length) summary += `; added zones ${compressZoneRanges(changes.created)}`;
  if (changes.restored.length) summary += `; restored zones ${compressZoneRanges(changes.restored)}`;
  if (changes.retired.length) summary += `; retired zones ${compressZoneRanges(changes.retired)} (history kept)`;
  return summary;
}

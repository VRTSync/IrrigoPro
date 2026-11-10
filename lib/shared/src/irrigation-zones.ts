export type ZoneExtraProgram = { programId: number; runTimeMinutes: number };

/** Main line first, followed by extras in the supplied program order. */
export function zoneProgramLines(z: { programId: number | null; runTimeMinutes: number; extraPrograms?: ZoneExtraProgram[] }): (ZoneExtraProgram & { main: boolean })[] {
  return [
    ...(z.programId != null ? [{ programId: z.programId, runTimeMinutes: z.runTimeMinutes, main: true }] : []),
    ...(z.extraPrograms ?? []).filter(line => line.programId !== z.programId).map(line => ({ ...line, main: false })),
  ];
}

export interface PlaceholderZoneFields {
  zoneNumber: number;
  name: string;
  zoneType: string;
  runTimeMinutes: number | null;
  programId: number | null;
  notes: string | null;
}

/** True while a zone still holds the values the count reconciliation inserts. */
export function isPlaceholderZone(z: PlaceholderZoneFields): boolean {
  return z.name === `Zone ${z.zoneNumber}` && z.zoneType === "other" &&
    (z.runTimeMinutes ?? 0) === 0 && z.programId == null && !z.notes?.trim();
}

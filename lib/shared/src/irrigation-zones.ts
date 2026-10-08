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

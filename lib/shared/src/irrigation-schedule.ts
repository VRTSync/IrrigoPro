// Pure schedule-calculation helper for the Irrigation System Profile.
//
// `computeRunSchedule` is a pure function — no DB access, no side effects.
// It is used by both the API server (report PDF generation) and the
// frontend (live schedule preview in the capture/edit UI).
//
// Algorithm:
//   For each active program:
//     For each startTime in program.startTimes:
//       Walk zones (filtered to this program, ordered by zoneOrder) sequentially.
//       adjustedRunTime = Math.round(runTimeMinutes × seasonalAdjustPct / 100)
//       If a zone has overrideStartTime/overrideDays: start at its own time,
//         mark isOverride=true, do NOT chain (next zone still starts from the
//         last non-override end).
//       Otherwise: expectedStart = running clock, expectedEnd = start + adjusted,
//         next zone starts at expectedEnd.

export interface ScheduleInputProgram {
  id: number;
  name: string;
  wateringDays?: string[] | null;
  startTimes?: string[] | null;
  seasonalAdjustPct: number;
  isActive: boolean;
  sortOrder: number;
}

export interface ScheduleInputZone {
  id: number;
  programId?: number | null;
  zoneNumber: number;
  name: string;
  zoneType: string;
  runTimeMinutes: number;
  zoneOrder: number;
  isActive: boolean;
  overrideStartTime?: string | null;
  overrideDays?: string[] | null;
}

export interface ScheduledZoneEntry {
  zoneId: number;
  zoneNumber: number;
  zoneName: string;
  zoneType: string;
  programId: number;
  programName: string;
  startTime: string;
  expectedStartMinutes: number;
  expectedEndMinutes: number;
  adjustedRunTimeMinutes: number;
  isOverride: boolean;
  overrideDays?: string[] | null;
}

export interface ProgramSchedule {
  programId: number;
  programName: string;
  startTime: string;
  wateringDays: string[];
  entries: ScheduledZoneEntry[];
}

// Parse "HH:MM" → minutes from midnight. Returns NaN on invalid input.
function parseTimeToMinutes(t: string): number {
  const parts = t.split(":");
  if (parts.length < 2) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

// Format minutes-from-midnight → "HH:MM".
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Compute the auto run-time schedule for a set of programs and zones.
 *
 * @param programs - All programs for a controller (active ones are processed).
 * @param zones    - All zones for a controller (filtered/ordered per program internally).
 * @returns An array of ProgramSchedule — one entry per (program × startTime).
 */
export function computeRunSchedule(
  programs: ScheduleInputProgram[],
  zones: ScheduleInputZone[],
): ProgramSchedule[] {
  const result: ProgramSchedule[] = [];

  const activePrograms = [...programs]
    .filter((p) => p.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  for (const program of activePrograms) {
    const programZones = zones
      .filter((z) => z.isActive && z.programId === program.id)
      .sort((a, b) => a.zoneOrder - b.zoneOrder || a.zoneNumber - b.zoneNumber);

    const rawStartTimes = program.startTimes ?? [];
    const startTimesToProcess =
      rawStartTimes.length > 0 ? rawStartTimes : ["00:00"];

    for (const startTimeStr of startTimesToProcess) {
      const startMinutes = parseTimeToMinutes(startTimeStr);
      if (!Number.isFinite(startMinutes)) continue;

      const entries: ScheduledZoneEntry[] = [];
      let runningClock = startMinutes;

      for (const zone of programZones) {
        const adjusted = Math.round(
          (zone.runTimeMinutes * program.seasonalAdjustPct) / 100,
        );

        if (zone.overrideStartTime) {
          // Per-zone override: start at its own time, don't chain.
          const overrideMinutes = parseTimeToMinutes(zone.overrideStartTime);
          const effectiveStart = Number.isFinite(overrideMinutes)
            ? overrideMinutes
            : runningClock;

          entries.push({
            zoneId: zone.id,
            zoneNumber: zone.zoneNumber,
            zoneName: zone.name,
            zoneType: zone.zoneType,
            programId: program.id,
            programName: program.name,
            startTime: startTimeStr,
            expectedStartMinutes: effectiveStart,
            expectedEndMinutes: effectiveStart + adjusted,
            adjustedRunTimeMinutes: adjusted,
            isOverride: true,
            overrideDays: zone.overrideDays ?? null,
          });
          // Override zones do NOT advance the running clock — the next
          // sequential zone still starts where the last non-override ended.
        } else {
          entries.push({
            zoneId: zone.id,
            zoneNumber: zone.zoneNumber,
            zoneName: zone.name,
            zoneType: zone.zoneType,
            programId: program.id,
            programName: program.name,
            startTime: startTimeStr,
            expectedStartMinutes: runningClock,
            expectedEndMinutes: runningClock + adjusted,
            adjustedRunTimeMinutes: adjusted,
            isOverride: false,
            overrideDays: null,
          });
          runningClock += adjusted;
        }
      }

      result.push({
        programId: program.id,
        programName: program.name,
        startTime: startTimeStr,
        wateringDays: program.wateringDays ?? [],
        entries,
      });
    }
  }

  return result;
}

// Re-export the time helpers so callers can format output (e.g. PDF tables).
export { minutesToTime, parseTimeToMinutes };

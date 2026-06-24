// Unit tests for computeRunSchedule.
//
// Run via: pnpm --filter @workspace/shared run test
// Uses the same node:test + assert/strict pattern as the rest of lib/shared.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRunSchedule, minutesToTime } from "./irrigation-schedule.js";
import type { ScheduleInputProgram, ScheduleInputZone } from "./irrigation-schedule.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProgram(overrides: Partial<ScheduleInputProgram> & { id: number }): ScheduleInputProgram {
  return {
    name: `Program ${overrides.id}`,
    wateringDays: ["Mon", "Wed", "Fri"],
    startTimes: ["06:00"],
    seasonalAdjustPct: 100,
    isActive: true,
    sortOrder: overrides.id,
    ...overrides,
  };
}

function makeZone(overrides: Partial<ScheduleInputZone> & { id: number; programId: number }): ScheduleInputZone {
  return {
    zoneNumber: overrides.id,
    name: `Zone ${overrides.id}`,
    zoneType: "rotor",
    runTimeMinutes: 10,
    zoneOrder: overrides.id,
    isActive: true,
    overrideStartTime: null,
    overrideDays: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeRunSchedule", () => {
  describe("(a) 2 programs × 4 zones each — sequential, seasonal-adjusted", () => {
    const programs: ScheduleInputProgram[] = [
      makeProgram({ id: 1, startTimes: ["06:00"], seasonalAdjustPct: 100 }),
      makeProgram({ id: 2, startTimes: ["07:00"], seasonalAdjustPct: 50 }),
    ];

    // Program 1: zones 1-4, each 10 min, 100% → 10 min each.
    // Program 2: zones 5-8, each 20 min, 50%  →  10 min each.
    const zones: ScheduleInputZone[] = [
      makeZone({ id: 1, programId: 1, zoneOrder: 1, runTimeMinutes: 10 }),
      makeZone({ id: 2, programId: 1, zoneOrder: 2, runTimeMinutes: 10 }),
      makeZone({ id: 3, programId: 1, zoneOrder: 3, runTimeMinutes: 10 }),
      makeZone({ id: 4, programId: 1, zoneOrder: 4, runTimeMinutes: 10 }),
      makeZone({ id: 5, programId: 2, zoneOrder: 1, runTimeMinutes: 20 }),
      makeZone({ id: 6, programId: 2, zoneOrder: 2, runTimeMinutes: 20 }),
      makeZone({ id: 7, programId: 2, zoneOrder: 3, runTimeMinutes: 20 }),
      makeZone({ id: 8, programId: 2, zoneOrder: 4, runTimeMinutes: 20 }),
    ];

    const result = computeRunSchedule(programs, zones);

    it("returns two ProgramSchedule entries", () => {
      assert.equal(result.length, 2);
    });

    it("program 1 has 4 zone entries", () => {
      assert.equal(result[0].entries.length, 4);
    });

    it("program 1 zone 1 starts at 06:00 (360 min)", () => {
      assert.equal(result[0].entries[0].expectedStartMinutes, 360);
      assert.equal(result[0].entries[0].adjustedRunTimeMinutes, 10);
    });

    it("program 1 zones are sequential (each ends where the next begins)", () => {
      const entries = result[0].entries;
      for (let i = 0; i < entries.length - 1; i++) {
        assert.equal(entries[i].expectedEndMinutes, entries[i + 1].expectedStartMinutes);
      }
    });

    it("program 1 zone 4 ends at 400 min (06:00 + 4×10)", () => {
      const last = result[0].entries[3];
      assert.equal(last.expectedEndMinutes, 360 + 40);
    });

    it("program 2 seasonal 50% → 10 min adjusted from 20 min raw", () => {
      assert.equal(result[1].entries[0].adjustedRunTimeMinutes, 10);
    });

    it("program 2 zone 1 starts at 07:00 (420 min)", () => {
      assert.equal(result[1].entries[0].expectedStartMinutes, 420);
    });

    it("program 2 zones are sequential", () => {
      const entries = result[1].entries;
      for (let i = 0; i < entries.length - 1; i++) {
        assert.equal(entries[i].expectedEndMinutes, entries[i + 1].expectedStartMinutes);
      }
    });

    it("all non-override entries have isOverride=false", () => {
      for (const ps of result) {
        for (const entry of ps.entries) {
          assert.equal(entry.isOverride, false);
        }
      }
    });
  });

  describe("(b) zone with overrideStartTime breaks chain and is marked isOverride", () => {
    const programs: ScheduleInputProgram[] = [
      makeProgram({ id: 1, startTimes: ["06:00"], seasonalAdjustPct: 100 }),
    ];

    // Zones 1 and 3 are normal. Zone 2 has an override start at 08:00.
    const zones: ScheduleInputZone[] = [
      makeZone({ id: 1, programId: 1, zoneOrder: 1, runTimeMinutes: 10 }),
      makeZone({ id: 2, programId: 1, zoneOrder: 2, runTimeMinutes: 15, overrideStartTime: "08:00", overrideDays: ["Tue", "Thu"] }),
      makeZone({ id: 3, programId: 1, zoneOrder: 3, runTimeMinutes: 10 }),
    ];

    const result = computeRunSchedule(programs, zones);
    const entries = result[0].entries;

    it("produces 3 entries", () => {
      assert.equal(entries.length, 3);
    });

    it("zone 1 starts at 360 min (06:00)", () => {
      assert.equal(entries[0].expectedStartMinutes, 360);
    });

    it("zone 2 (override) is marked isOverride=true", () => {
      assert.equal(entries[1].isOverride, true);
    });

    it("zone 2 starts at its own overrideStartTime (08:00 = 480 min)", () => {
      assert.equal(entries[1].expectedStartMinutes, 480);
    });

    it("zone 2 overrideDays is carried through", () => {
      assert.deepEqual(entries[1].overrideDays, ["Tue", "Thu"]);
    });

    it("zone 3 starts immediately after zone 1 ends (not after zone 2)", () => {
      // Zone 1 ends at 360+10=370. Zone 2 is override and does not advance the clock.
      assert.equal(entries[2].expectedStartMinutes, 370);
    });

    it("zone 3 is not an override", () => {
      assert.equal(entries[2].isOverride, false);
    });
  });

  describe("(c) multiple start times repeat the full zone sequence", () => {
    const programs: ScheduleInputProgram[] = [
      makeProgram({ id: 1, startTimes: ["06:00", "18:00"], seasonalAdjustPct: 100 }),
    ];
    const zones: ScheduleInputZone[] = [
      makeZone({ id: 1, programId: 1, zoneOrder: 1, runTimeMinutes: 10 }),
      makeZone({ id: 2, programId: 1, zoneOrder: 2, runTimeMinutes: 10 }),
    ];

    const result = computeRunSchedule(programs, zones);

    it("returns 2 ProgramSchedule entries (one per startTime)", () => {
      assert.equal(result.length, 2);
    });

    it("first entry has startTime 06:00", () => {
      assert.equal(result[0].startTime, "06:00");
    });

    it("second entry has startTime 18:00", () => {
      assert.equal(result[1].startTime, "18:00");
    });

    it("both entries have 2 zone entries", () => {
      assert.equal(result[0].entries.length, 2);
      assert.equal(result[1].entries.length, 2);
    });

    it("first entry zone 1 starts at 360 min", () => {
      assert.equal(result[0].entries[0].expectedStartMinutes, 360);
    });

    it("second entry zone 1 starts at 1080 min (18:00)", () => {
      assert.equal(result[1].entries[0].expectedStartMinutes, 1080);
    });

    it("each sequence is independent (different running clocks)", () => {
      assert.equal(result[0].entries[1].expectedStartMinutes, 370);
      assert.equal(result[1].entries[1].expectedStartMinutes, 1090);
    });
  });

  describe("(d) seasonalAdjustPct = 0 produces 0-minute zones without crashing", () => {
    const programs: ScheduleInputProgram[] = [
      makeProgram({ id: 1, startTimes: ["06:00"], seasonalAdjustPct: 0 }),
    ];
    const zones: ScheduleInputZone[] = [
      makeZone({ id: 1, programId: 1, zoneOrder: 1, runTimeMinutes: 20 }),
      makeZone({ id: 2, programId: 1, zoneOrder: 2, runTimeMinutes: 20 }),
    ];

    const result = computeRunSchedule(programs, zones);
    const entries = result[0].entries;

    it("returns entries without crashing", () => {
      assert.equal(entries.length, 2);
    });

    it("both zones have adjustedRunTimeMinutes = 0", () => {
      assert.equal(entries[0].adjustedRunTimeMinutes, 0);
      assert.equal(entries[1].adjustedRunTimeMinutes, 0);
    });

    it("all zones start at the program start time (clock doesn't advance)", () => {
      assert.equal(entries[0].expectedStartMinutes, 360);
      assert.equal(entries[1].expectedStartMinutes, 360);
    });
  });

  describe("minutesToTime helper", () => {
    it("360 → 06:00", () => { assert.equal(minutesToTime(360), "06:00"); });
    it("0 → 00:00", () => { assert.equal(minutesToTime(0), "00:00"); });
    it("1439 → 23:59", () => { assert.equal(minutesToTime(1439), "23:59"); });
  });

  describe("inactive programs/zones are excluded", () => {
    const programs: ScheduleInputProgram[] = [
      makeProgram({ id: 1, isActive: false }),
      makeProgram({ id: 2, isActive: true, startTimes: ["07:00"] }),
    ];
    const zones: ScheduleInputZone[] = [
      makeZone({ id: 1, programId: 1, isActive: true, runTimeMinutes: 10 }),
      makeZone({ id: 2, programId: 2, isActive: true, runTimeMinutes: 10 }),
      makeZone({ id: 3, programId: 2, isActive: false, runTimeMinutes: 10 }),
    ];

    const result = computeRunSchedule(programs, zones);

    it("only active program is processed", () => {
      assert.equal(result.length, 1);
      assert.equal(result[0].programId, 2);
    });

    it("only active zone is included", () => {
      assert.equal(result[0].entries.length, 1);
      assert.equal(result[0].entries[0].zoneId, 2);
    });
  });
});

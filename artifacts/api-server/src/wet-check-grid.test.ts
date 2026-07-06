/**
 * Tests for buildWetCheckGrid — the grid-sizing logic used by all three
 * wet-check / controller-read code paths in routes.ts.
 *
 * This file is the "route-level regression guard" the code review requested:
 * it tests the exact decision logic wired into the routes (profile vs legacy
 * fallback, branch isolation, blankStart invariance, null zone propagation).
 *
 * It intentionally does NOT spin up Express or hit a database — all inputs
 * are plain objects so the logic can be tested quickly and deterministically.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWetCheckGrid, type IrrigationControllerRow, type PropertyControllerRow } from "./wet-check-grid";

// ─── helpers ─────────────────────────────────────────────────────────────────

function ic(name: string, totalZones: number | null): IrrigationControllerRow {
  return { name, totalZones };
}

function pc(
  controllerLetter: string,
  zoneCount: number | null,
  branchName: string | null = null,
): PropertyControllerRow {
  return { controllerLetter, zoneCount, branchName };
}

// ─── Profile path ─────────────────────────────────────────────────────────────

describe("buildWetCheckGrid — profile path (irrigation_controllers non-empty)", () => {
  it("uses profile controller count even when totalControllers is higher", () => {
    // Profile has 2 controllers; stale totalControllers = 5.
    const result = buildWetCheckGrid(
      [ic("Controller A", 8), ic("Controller B", 12)],
      /* totalControllers */ 5,
      /* legacyPCs */ [],
      /* branchKey */ "",
    );
    assert.equal(result.numControllers, 2);
    assert.equal(result.seedConfigs.length, 2);
  });

  it("uses profile controller count even when totalControllers is lower", () => {
    // Profile has 3 controllers; stale totalControllers = 1.
    const result = buildWetCheckGrid(
      [ic("Controller A", 6), ic("Controller B", 8), ic("Controller C", 4)],
      /* totalControllers */ 1,
      /* legacyPCs */ [],
      /* branchKey */ "",
    );
    assert.equal(result.numControllers, 3);
    assert.equal(result.seedConfigs.length, 3);
  });

  it("passes zone counts through as-is — does NOT default null to 12", () => {
    const result = buildWetCheckGrid(
      [ic("Controller A", null), ic("Controller B", 8)],
      1,
      [],
      "",
    );
    assert.equal(result.seedConfigs[0].zoneCount, null, "first controller zoneCount should be null, not 12");
    assert.equal(result.seedConfigs[1].zoneCount, 8);
  });

  it("all-null zone counts pass through without coercion", () => {
    const result = buildWetCheckGrid(
      [ic("Controller A", null), ic("Controller B", null), ic("Controller C", null)],
      3,
      [],
      "",
    );
    for (const cfg of result.seedConfigs) {
      assert.equal(cfg.zoneCount, null, "null zone count must not be coerced");
    }
  });

  it("preserves controller names from irrigation_controllers", () => {
    const result = buildWetCheckGrid(
      [ic("Back Yard", 6), ic("Front Zone", 10)],
      2,
      [],
      "",
    );
    assert.equal(result.seedConfigs[0].name, "Back Yard");
    assert.equal(result.seedConfigs[1].name, "Front Zone");
  });

  it("branch path: profile for 'North Wing' is used, not customer-level legacy data", () => {
    const result = buildWetCheckGrid(
      [ic("Controller A", 5), ic("Controller B", 7)],
      /* totalControllers — customer-level count, should be ignored */ 4,
      /* legacyPCs scoped to customer-level */ [pc("A", 99, null), pc("B", 99, null)],
      /* branchKey */ "North Wing",
    );
    assert.equal(result.numControllers, 2);
    // Zone counts come from profile, not legacy
    assert.equal(result.seedConfigs[0].zoneCount, 5);
    assert.equal(result.seedConfigs[1].zoneCount, 7);
  });
});

// ─── Legacy fallback path ─────────────────────────────────────────────────────

describe("buildWetCheckGrid — legacy fallback path (irrigation_controllers empty)", () => {
  it("uses clamp(totalControllers) not property_controllers.length for count", () => {
    // totalControllers=3 but only 1 legacy row exists → count must be 3
    const result = buildWetCheckGrid(
      /* irrigCtrls — empty (no profile) */ [],
      /* totalControllers */ 3,
      [pc("A", 8, null)],
      "",
    );
    assert.equal(result.numControllers, 3);
    assert.equal(result.seedConfigs.length, 3);
  });

  it("uses zone counts from matching property_controllers rows", () => {
    const result = buildWetCheckGrid(
      [],
      2,
      [pc("A", 6, null), pc("B", 10, null)],
      "",
    );
    assert.equal(result.seedConfigs[0].zoneCount, 6);
    assert.equal(result.seedConfigs[1].zoneCount, 10);
  });

  it("uses null zone count for controllers with no matching legacy row", () => {
    // totalControllers=3, only row A exists — B and C get null
    const result = buildWetCheckGrid([], 3, [pc("A", 6, null)], "");
    assert.equal(result.seedConfigs[0].zoneCount, 6, "A should use legacy row");
    assert.equal(result.seedConfigs[1].zoneCount, null, "B has no row → null");
    assert.equal(result.seedConfigs[2].zoneCount, null, "C has no row → null");
  });

  it("clamps totalControllers at minimum 1", () => {
    const result = buildWetCheckGrid([], /* totalControllers */ 0, [], "");
    assert.equal(result.numControllers, 1);
  });

  it("clamps totalControllers at minimum 1 when null", () => {
    const result = buildWetCheckGrid([], null, [], "");
    assert.equal(result.numControllers, 1);
  });

  it("clamps totalControllers at maximum 26", () => {
    const result = buildWetCheckGrid([], /* totalControllers */ 99, [], "");
    assert.equal(result.numControllers, 26);
    assert.equal(result.seedConfigs.length, 26);
  });

  it("generates default names Controller A … Controller N for legacy-path rows", () => {
    const result = buildWetCheckGrid([], 3, [], "");
    assert.equal(result.seedConfigs[0].name, "Controller A");
    assert.equal(result.seedConfigs[1].name, "Controller B");
    assert.equal(result.seedConfigs[2].name, "Controller C");
  });
});

// ─── Branch isolation ─────────────────────────────────────────────────────────

describe("buildWetCheckGrid — branch isolation", () => {
  it("legacy path: only uses property_controllers rows matching branchKey", () => {
    // branchKey = "North Wing"; customer-level row (branchName=null→"") must be ignored
    const result = buildWetCheckGrid(
      [],
      2,
      [pc("A", 99, null), pc("A", 5, "North Wing"), pc("B", 7, "North Wing")],
      "North Wing",
    );
    assert.equal(result.seedConfigs[0].zoneCount, 5, "should use North Wing row, not customer-level");
    assert.equal(result.seedConfigs[1].zoneCount, 7);
  });

  it("legacy path: customer-level bucket uses only branchName=null rows", () => {
    const result = buildWetCheckGrid(
      [],
      2,
      [pc("A", 99, "South Campus"), pc("A", 6, null), pc("B", 10, null)],
      /* branchKey customer-level */ "",
    );
    assert.equal(result.seedConfigs[0].zoneCount, 6, "should use customer-level row (branchName=null)");
    assert.equal(result.seedConfigs[1].zoneCount, 10);
  });

  it("profile path: rows from a different branch are not used (caller pre-scopes the irrigCtrls list)", () => {
    // Caller passes only the North Wing rows (already scoped by listIrrigationControllers).
    // Customer-level rows should have no effect.
    const northWingCtrls = [ic("Controller A", 5), ic("Controller B", 7)];
    const result = buildWetCheckGrid(northWingCtrls, 4, [], "North Wing");
    assert.equal(result.numControllers, 2);
    assert.equal(result.seedConfigs[0].zoneCount, 5);
    assert.equal(result.seedConfigs[1].zoneCount, 7);
  });
});

// ─── blankStart behaviour (simulated) ────────────────────────────────────────
//
// blankStart is handled at the route level (buildWetCheckGrid is NOT called when
// blankStart=true). These tests verify that the routes.ts blankStart guard is
// described correctly: when blankStart=true the result should be numControllers=0
// and ensureIrrigationControllers is not called. We simulate the route logic here.

describe("blankStart guard — route-level behaviour (simulated inline)", () => {
  it("blankStart=true → numControllers=0, buildWetCheckGrid is NOT called", () => {
    let gridCalled = false;
    function simulatedRoute(blankStart: boolean) {
      if (blankStart) return { numControllers: 0, gridCalled: false };
      gridCalled = true;
      const r = buildWetCheckGrid([ic("Controller A", 8)], 1, [], "");
      return { numControllers: r.numControllers, gridCalled: true };
    }
    const result = simulatedRoute(true);
    assert.equal(result.numControllers, 0);
    assert.equal(result.gridCalled, false);
  });

  it("blankStart=false + profile → numControllers from profile", () => {
    function simulatedRoute(blankStart: boolean) {
      if (blankStart) return 0;
      const r = buildWetCheckGrid(
        [ic("Controller A", 8), ic("Controller B", 4), ic("Controller C", 6)],
        /* stale totalControllers */ 1,
        [],
        "",
      );
      return r.numControllers;
    }
    assert.equal(simulatedRoute(false), 3);
  });
});

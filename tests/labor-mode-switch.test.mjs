import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nextFlatTotalHoursForModeSwitch } from "../client/src/components/wizard-shared/labor-mode-switch.ts";

// Task #396 — Pure-state tests for the wizard labor-mode toggle.
// Covers the explicit done criterion: switching per_part → flat must
// prepopulate flatTotalHours from the summed per-row hours, and every
// other transition must leave the flat hours untouched.

const ITEMS = [
  { laborHours: 1.5, quantity: 2 }, // 3.0
  { laborHours: 0.25, quantity: 4 }, // 1.0
];

describe("nextFlatTotalHoursForModeSwitch", () => {
  test("per_part → flat prepopulates from summed per-row hours when prior flat is 0", () => {
    const next = nextFlatTotalHoursForModeSwitch("per_part", "flat", 0, ITEMS);
    assert.equal(next, 4); // 3.0 + 1.0
  });

  test("per_part → flat overrides any stale prior flat value with the live sum", () => {
    const next = nextFlatTotalHoursForModeSwitch("per_part", "flat", 99, ITEMS);
    assert.equal(next, 4);
  });

  test("per_part → flat with no per-row hours leaves prior flat value intact", () => {
    const next = nextFlatTotalHoursForModeSwitch("per_part", "flat", 7, [
      { laborHours: 0, quantity: 5 },
    ]);
    assert.equal(next, 7);
  });

  test("flat → per_part preserves flat hours so a switch back doesn't lose them", () => {
    const next = nextFlatTotalHoursForModeSwitch("flat", "per_part", 12.5, ITEMS);
    assert.equal(next, 12.5);
  });

  test("no-op transition (flat → flat) preserves flat hours", () => {
    const next = nextFlatTotalHoursForModeSwitch("flat", "flat", 8, ITEMS);
    assert.equal(next, 8);
  });

  test("no-op transition (per_part → per_part) preserves flat hours", () => {
    const next = nextFlatTotalHoursForModeSwitch("per_part", "per_part", 3, ITEMS);
    assert.equal(next, 3);
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderZone, zoneProgramLines } from "./irrigation-zones.js";

const zone = { zoneNumber: 17, name: "Zone 17", zoneType: "other", runTimeMinutes: 0, programId: null, notes: null };
test("program lines are main-first, retain extra order and skip main duplicates", () => {
  assert.deepEqual(zoneProgramLines({ programId: 3, runTimeMinutes: 30, extraPrograms: [
    { programId: 1, runTimeMinutes: 10 }, { programId: 3, runTimeMinutes: 5 }, { programId: 2, runTimeMinutes: 0 },
  ] }), [
    { programId: 3, runTimeMinutes: 30, main: true }, { programId: 1, runTimeMinutes: 10, main: false }, { programId: 2, runTimeMinutes: 0, main: false },
  ]);
  assert.deepEqual(zoneProgramLines({ programId: null, runTimeMinutes: 0 }), []);
  assert.deepEqual(zoneProgramLines({ programId: null, runTimeMinutes: 0, extraPrograms: [{ programId: 1, runTimeMinutes: 10 }] }),
    [{ programId: 1, runTimeMinutes: 10, main: false }]);
});
test("placeholder defaults, nullable values and blank notes", () => {
  assert.equal(isPlaceholderZone(zone), true);
  assert.equal(isPlaceholderZone({ ...zone, runTimeMinutes: null, notes: " \n " }), true);
  assert.equal(isPlaceholderZone({ ...zone, isActive: false } as typeof zone), true);
});
test("every setup field and exact default name", () => {
  for (const patch of [
    { name: "Zone 017" }, { name: "zone 17" }, { name: "Zone 17 " },
    { zoneNumber: 18 }, { zoneType: "rotor" }, { runTimeMinutes: 1 },
    { programId: 1 }, { notes: "Back slope" },
  ]) assert.equal(isPlaceholderZone({ ...zone, ...patch }), false);
});

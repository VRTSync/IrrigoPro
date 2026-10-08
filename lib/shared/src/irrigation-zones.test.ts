import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderZone } from "./irrigation-zones.js";

const zone = { zoneNumber: 17, name: "Zone 17", zoneType: "other", runTimeMinutes: 0, programId: null, notes: null };
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

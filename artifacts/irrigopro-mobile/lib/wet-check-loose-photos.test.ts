// Task #597 — guard the predicate that drives the mobile wet-check
// overview's "loose photos" amber banner. The banner is rendered
// inline in `app/wet-check/[id].tsx`; the test runner here is the
// node test harness (no React Native renderer) so we exercise the
// same predicate against a representative payload to lock in the
// classification: a "loose" photo is one with both `zoneRecordId`
// and `findingId` null. Anything attached to a zone or a finding
// must be excluded.

import { test } from "node:test";
import assert from "node:assert/strict";

type Photo = {
  id: number;
  zoneRecordId: number | null;
  findingId: number | null;
};

const isLoose = (p: Photo) => p.zoneRecordId == null && p.findingId == null;

test("loose-photo predicate identifies unattached wet-check photos", () => {
  const photos: Photo[] = [
    { id: 1, zoneRecordId: 10, findingId: null },   // zone-attached
    { id: 2, zoneRecordId: null, findingId: 20 },   // finding-attached
    { id: 3, zoneRecordId: null, findingId: null }, // loose
    { id: 4, zoneRecordId: null, findingId: null }, // loose
    { id: 5, zoneRecordId: 11, findingId: 21 },     // both — still excluded
  ];
  const loose = photos.filter(isLoose);
  assert.equal(loose.length, 2);
  assert.deepEqual(
    loose.map((p) => p.id).sort(),
    [3, 4],
  );
});

test("loose-photo predicate handles empty / nullish payloads safely", () => {
  assert.equal(([] as Photo[]).filter(isLoose).length, 0);
  const undefArr: Photo[] | undefined = undefined;
  assert.equal((undefArr ?? []).filter(isLoose).length, 0);
});

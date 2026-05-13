import { describe, expect, it } from "vitest";
import {
  countFindingPhotos,
  countLoosePhotos,
  countTotalPhotos,
  countZonePhotos,
} from "./wet-check-photos";

const wc = {
  zoneRecords: [
    { id: 1, findings: [{ id: 10 }, { id: 11 }] },
    { id: 2, findings: [] as { id: number }[] },
    { id: 3, findings: null },
  ],
  photos: [
    { zoneRecordId: 1, findingId: null },
    { zoneRecordId: null, findingId: 10 },
    { zoneRecordId: null, findingId: 11 },
    { zoneRecordId: 2, findingId: null },
    { zoneRecordId: null, findingId: null },
    { zoneRecordId: null, findingId: null },
  ],
};

describe("wet-check-photos helpers", () => {
  it("countZonePhotos counts zone-direct + finding-linked photos", () => {
    expect(countZonePhotos(wc, wc.zoneRecords[0])).toBe(3);
    expect(countZonePhotos(wc, wc.zoneRecords[1])).toBe(1);
    expect(countZonePhotos(wc, wc.zoneRecords[2])).toBe(0);
  });

  it("countFindingPhotos counts photos by finding id", () => {
    expect(countFindingPhotos(wc, { id: 10 })).toBe(1);
    expect(countFindingPhotos(wc, { id: 11 })).toBe(1);
    expect(countFindingPhotos(wc, { id: 99 })).toBe(0);
  });

  it("countLoosePhotos counts wet-check-level photos with no zone or finding", () => {
    expect(countLoosePhotos(wc)).toBe(2);
  });

  it("countTotalPhotos returns total photo count", () => {
    expect(countTotalPhotos(wc)).toBe(6);
  });

  it("is null-safe for fresh wet checks (null nested arrays)", () => {
    expect(countTotalPhotos(null)).toBe(0);
    expect(countTotalPhotos({ photos: null, zoneRecords: null })).toBe(0);
    expect(countLoosePhotos({ photos: null })).toBe(0);
    expect(countZonePhotos(null, null)).toBe(0);
    expect(
      countZonePhotos(
        { photos: null, zoneRecords: [{ id: 1, findings: null }] },
        { id: 1, findings: null },
      ),
    ).toBe(0);
    expect(countFindingPhotos({ photos: null }, { id: 1 })).toBe(0);
  });
});

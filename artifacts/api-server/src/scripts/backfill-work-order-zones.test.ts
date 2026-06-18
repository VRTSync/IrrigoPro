// Task #1437 (Slice 3) — Tests for the work-order zone backfill.
//
// Two layers:
//   1. Pure unit tests for computeZoneStamps (part/qty matching, confidence).
//   2. Operational tests for runBackfill using mock BackfillDeps — dry-run
//      non-mutation, apply mutation, no-source skip, unmappable skip,
//      already-zoned exclusion, resumability, error isolation, and
//      app_settings persistence. The applyStamps spy asserts we only ever
//      write the three zone columns (never qty/labor/totals/completedAt).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeZoneStamps,
  runBackfill,
  DONE_KEY,
  SEEN_KEY,
  type CandidateRow,
  type BackfillDeps,
  type BackfillOptions,
  type FailureEntry,
  type WorkOrderItemRow,
  type SourceZoneItem,
  type ZoneStamp,
} from "./backfill-work-order-zones-core";

// ── computeZoneStamps (pure matching) ────────────────────────────────────────

function woItem(overrides: Partial<WorkOrderItemRow> & { id: number }): WorkOrderItemRow {
  return {
    partId: null,
    partName: null,
    quantity: 1,
    controllerLetter: null,
    zoneNumber: null,
    ...overrides,
  };
}

function src(overrides: Partial<SourceZoneItem> = {}): SourceZoneItem {
  return {
    partId: null,
    partName: null,
    quantity: 1,
    controllerLetter: "A",
    zoneNumber: 1,
    issueType: "broken_head",
    ...overrides,
  };
}

describe("computeZoneStamps", () => {
  it("returns [] when no item needs a stamp (all already zoned)", () => {
    const items = [woItem({ id: 1, controllerLetter: "A", zoneNumber: 1 })];
    assert.deepEqual(computeZoneStamps(items, [src()]), []);
  });

  it("returns null when there are no zone-bearing source items", () => {
    const items = [woItem({ id: 1, partId: 5 })];
    const noZoneSources = [src({ partId: 5, controllerLetter: null, zoneNumber: null })];
    assert.equal(computeZoneStamps(items, noZoneSources), null);
  });

  it("matches by partId and copies controller/zone/issue", () => {
    const items = [woItem({ id: 1, partId: 5, quantity: 2 })];
    const sources = [src({ partId: 5, quantity: 2, controllerLetter: "B", zoneNumber: 3, issueType: "leaking_valve" })];
    const stamps = computeZoneStamps(items, sources);
    assert.deepEqual(stamps, [
      { itemId: 1, controllerLetter: "B", zoneNumber: 3, issueType: "leaking_valve" },
    ]);
  });

  it("falls back to partName match when partId is null", () => {
    const items = [woItem({ id: 1, partId: null, partName: "Sprinkler Head" })];
    const sources = [src({ partId: null, partName: "sprinkler head", controllerLetter: "C", zoneNumber: 4 })];
    const stamps = computeZoneStamps(items, sources);
    assert.equal(stamps?.[0].controllerLetter, "C");
    assert.equal(stamps?.[0].zoneNumber, 4);
  });

  it("prefers the candidate with matching quantity when a part repeats", () => {
    const items = [woItem({ id: 1, partId: 5, quantity: 3 })];
    const sources = [
      src({ partId: 5, quantity: 1, controllerLetter: "A", zoneNumber: 1 }),
      src({ partId: 5, quantity: 3, controllerLetter: "B", zoneNumber: 2 }),
    ];
    const stamps = computeZoneStamps(items, sources);
    assert.equal(stamps?.[0].zoneNumber, 2, "should pick the qty-matching source");
  });

  it("consumes each source item only once (no double-assignment)", () => {
    const items = [
      woItem({ id: 1, partId: 5, quantity: 1 }),
      woItem({ id: 2, partId: 5, quantity: 1 }),
    ];
    const sources = [
      src({ partId: 5, quantity: 1, controllerLetter: "A", zoneNumber: 1 }),
      src({ partId: 5, quantity: 1, controllerLetter: "B", zoneNumber: 2 }),
    ];
    const stamps = computeZoneStamps(items, sources);
    assert.equal(stamps?.length, 2);
    const zones = stamps!.map((s) => s.zoneNumber).sort();
    assert.deepEqual(zones, [1, 2], "two items get two distinct sources");
  });

  it("returns null when an item cannot be mapped to any source", () => {
    const items = [
      woItem({ id: 1, partId: 5 }),
      woItem({ id: 2, partId: 99 }), // no source for partId 99
    ];
    const sources = [src({ partId: 5 })];
    assert.equal(computeZoneStamps(items, sources), null);
  });

  it("leaves already-zoned items untouched and only stamps the zone-less ones", () => {
    const items = [
      woItem({ id: 1, partId: 5, controllerLetter: "Z", zoneNumber: 9 }),
      woItem({ id: 2, partId: 6 }),
    ];
    const sources = [
      src({ partId: 6, controllerLetter: "A", zoneNumber: 1 }),
    ];
    const stamps = computeZoneStamps(items, sources);
    assert.equal(stamps?.length, 1);
    assert.equal(stamps?.[0].itemId, 2);
  });
});

// ── runBackfill operational tests ────────────────────────────────────────────

function makeMockDeps(overrides: Partial<BackfillDeps> = {}): BackfillDeps & {
  appliedWorkOrders: number[];
  appliedStamps: ZoneStamp[];
  savedKeys: Record<string, Set<number>>;
  failures: FailureEntry[];
} {
  const appliedWorkOrders: number[] = [];
  const appliedStamps: ZoneStamp[] = [];
  const savedKeys: Record<string, Set<number>> = {};
  const failures: FailureEntry[] = [];

  const deps: BackfillDeps = {
    loadIdSet: async (key) => savedKeys[key] ?? new Set(),
    saveIdSet: async (key, ids) => { savedKeys[key] = new Set(ids); },
    appendFailure: async (entry) => { failures.push(entry); },
    getCandidates: async () => [],
    getWorkOrderItems: async () => [],
    getEstimateZonedItems: async () => [],
    getFindings: async () => [],
    getZoneRecords: async () => new Map(),
    applyStamps: async (woId, stamps) => {
      appliedWorkOrders.push(woId);
      appliedStamps.push(...stamps);
    },
    ...overrides,
  };

  return Object.assign(deps, { appliedWorkOrders, appliedStamps, savedKeys, failures });
}

const silentOpts: BackfillOptions = {
  dryRun: false,
  batchSize: 50,
  log: () => {},
  logError: () => {},
};

function silentDry(): BackfillOptions {
  return { ...silentOpts, dryRun: true };
}

describe("runBackfill — empty candidate set", () => {
  it("does nothing when getCandidates returns empty", async () => {
    const mock = makeMockDeps();
    const result = await runBackfill(mock, silentDry());
    assert.equal(result.totalSelected, 0);
    assert.equal(mock.appliedWorkOrders.length, 0);
  });
});

describe("runBackfill — dry-run does not mutate", () => {
  it("MATCH in dry-run reports matchedDryRun but never calls applyStamps", async () => {
    const candidate: CandidateRow = { id: 5, estimateId: 100, originWetCheckId: 20 };
    const mock = makeMockDeps({
      getCandidates: async () => [candidate],
      getWorkOrderItems: async () => [woItem({ id: 1, partId: 7 })],
      getEstimateZonedItems: async () => [src({ partId: 7, controllerLetter: "A", zoneNumber: 1 })],
    });
    const result = await runBackfill(mock, silentDry());
    assert.equal(result.matchedDryRun, 1);
    assert.equal(result.matched, 0);
    assert.equal(mock.appliedWorkOrders.length, 0);
    assert.equal(Object.keys(mock.savedKeys).length, 0, "dry-run must not write app_settings");
  });
});

describe("runBackfill — apply mode commits stamps", () => {
  it("calls applyStamps and adds id to done set; only zone columns are written", async () => {
    const candidate: CandidateRow = { id: 7, estimateId: 200, originWetCheckId: 30 };
    const mock = makeMockDeps({
      getCandidates: async () => [candidate],
      getWorkOrderItems: async () => [woItem({ id: 1, partId: 8, quantity: 2 })],
      getEstimateZonedItems: async () => [
        src({ partId: 8, quantity: 2, controllerLetter: "B", zoneNumber: 2, issueType: "leaking_valve" }),
      ],
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.matched, 1);
    assert.deepEqual(mock.appliedWorkOrders, [7]);
    assert.deepEqual(mock.appliedStamps, [
      { itemId: 1, controllerLetter: "B", zoneNumber: 2, issueType: "leaking_valve" },
    ]);
    // Stamp shape carries ONLY zone columns + the item id — no qty/labor/total.
    const keys = Object.keys(mock.appliedStamps[0]).sort();
    assert.deepEqual(keys, ["controllerLetter", "issueType", "itemId", "zoneNumber"]);
    assert.ok(mock.savedKeys[DONE_KEY]?.has(7));
  });

  it("falls back to wet-check findings when the estimate has no zoned items", async () => {
    const candidate: CandidateRow = { id: 9, estimateId: 300, originWetCheckId: 40 };
    const mock = makeMockDeps({
      getCandidates: async () => [candidate],
      getWorkOrderItems: async () => [woItem({ id: 1, partName: "Head", quantity: 1 })],
      getEstimateZonedItems: async () => [], // estimate not zoned → fallback
      getFindings: async () => [
        {
          zoneRecordId: 500, partId: null, partName: "Head",
          partPrice: "10.00", quantity: 1, laborHours: "0.25",
          issueType: "broken_head", notes: null,
        },
      ],
      getZoneRecords: async () => new Map([[500, { controllerLetter: "C", zoneNumber: 3 }]]),
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.matched, 1);
    assert.equal(mock.appliedStamps[0].controllerLetter, "C");
    assert.equal(mock.appliedStamps[0].zoneNumber, 3);
  });
});

describe("runBackfill — skip paths persist to seen", () => {
  it("skips (no source) when neither estimate nor wet check yields zone items", async () => {
    const candidate: CandidateRow = { id: 11, estimateId: 400, originWetCheckId: 50 };
    const mock = makeMockDeps({
      getCandidates: async () => [candidate],
      getWorkOrderItems: async () => [woItem({ id: 1, partId: 5 })],
      getEstimateZonedItems: async () => [],
      getFindings: async () => [],
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.skippedNoSource, 1);
    assert.equal(mock.appliedWorkOrders.length, 0);
    assert.ok(mock.savedKeys[SEEN_KEY]?.has(11));
  });

  it("skips (unmappable) when an item cannot be matched to a source", async () => {
    const candidate: CandidateRow = { id: 13, estimateId: 500, originWetCheckId: 55 };
    const mock = makeMockDeps({
      getCandidates: async () => [candidate],
      getWorkOrderItems: async () => [woItem({ id: 1, partId: 99 })],
      getEstimateZonedItems: async () => [src({ partId: 5, controllerLetter: "A", zoneNumber: 1 })],
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.skippedUnmappable, 1);
    assert.equal(mock.appliedWorkOrders.length, 0);
    assert.ok(mock.savedKeys[SEEN_KEY]?.has(13));
  });
});

describe("runBackfill — resumability", () => {
  it("skips work orders already in done set", async () => {
    const candidate: CandidateRow = { id: 7, estimateId: 200, originWetCheckId: 30 };
    const mock = makeMockDeps({
      loadIdSet: async (key) => (key === DONE_KEY ? new Set([7]) : new Set()),
      getCandidates: async () => [candidate],
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.alreadyProcessed, 1);
    assert.equal(mock.appliedWorkOrders.length, 0);
  });

  it("skips work orders already in seen set", async () => {
    const candidate: CandidateRow = { id: 11, estimateId: 400, originWetCheckId: 50 };
    const mock = makeMockDeps({
      loadIdSet: async (key) => (key === SEEN_KEY ? new Set([11]) : new Set()),
      getCandidates: async () => [candidate],
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.alreadyProcessed, 1);
    assert.equal(mock.appliedWorkOrders.length, 0);
  });
});

describe("runBackfill — error isolation", () => {
  it("continues processing remaining work orders when one throws and records the failure", async () => {
    const candidates: CandidateRow[] = [
      { id: 1, estimateId: 100, originWetCheckId: 10 },
      { id: 2, estimateId: 101, originWetCheckId: 11 },
    ];
    const mock = makeMockDeps({
      getCandidates: async () => candidates,
      getWorkOrderItems: async (woId) => {
        if (woId === 1) throw new Error("DB timeout");
        return []; // WO 2: no items → nothing to stamp → done
      },
    });
    const result = await runBackfill(mock, silentOpts);
    assert.equal(result.errors, 1);
    assert.equal(mock.failures.length, 1);
    assert.equal(mock.failures[0].id, 1);
    assert.ok(mock.failures[0].error.includes("DB timeout"));
  });
});

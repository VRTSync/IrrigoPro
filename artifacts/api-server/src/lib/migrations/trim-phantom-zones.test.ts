// Tests for the trim-phantom-zones-v1 migration.
//
// All tests use in-memory deps — no shared dev-DB required. The pure preview
// builder (buildTrimPhantomZonesPreview) and the deps-injectable runner
// (runTrimPhantomZonesMigration) are tested in isolation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrimPhantomZonesPreview,
  runTrimPhantomZonesMigration,
  type PhantomZoneRow,
  type TrimPhantomZonesDeps,
} from "./trim-phantom-zones";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeZone(overrides: Partial<PhantomZoneRow> = {}): PhantomZoneRow {
  return {
    id: 1,
    wetCheckId: 10,
    controllerLetter: "A",
    zoneNumber: 50,
    zoneCount: 12,
    status: "not_checked",
    observedPressure: null,
    observedFlow: null,
    ranSuccessfully: null,
    notes: null,
    repairLaborHours: "0.00",
    findingCount: 0,
    ...overrides,
  };
}

function makeDeps(opts: {
  candidates: PhantomZoneRow[];
  failIds?: Set<number>;
}): TrimPhantomZonesDeps & { deleted: number[]; markedDone: boolean } {
  const deleted: number[] = [];
  let markedDone = false;
  const failIds = opts.failIds ?? new Set<number>();

  return {
    get deleted() { return deleted; },
    get markedDone() { return markedDone; },
    getCandidates: async () => opts.candidates,
    deleteZone: async (id) => {
      if (failIds.has(id)) throw new Error(`simulated failure for zone ${id}`);
      deleted.push(id);
    },
    markDone: async () => { markedDone = true; },
  };
}

// ── buildTrimPhantomZonesPreview ──────────────────────────────────────────────

describe("buildTrimPhantomZonesPreview", () => {
  it("empty candidate set → 0 steps, phantomZones=0, no ack warning", () => {
    const preview = buildTrimPhantomZonesPreview([]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.phantomZones, 0);
    assert.ok(preview.warnings.some((w) => /No trimmable/.test(w)));
  });

  it("truly-empty not_checked zone beyond count → included in preview", () => {
    const zone = makeZone({ id: 42, wetCheckId: 5, controllerLetter: "B", zoneNumber: 20, zoneCount: 12 });
    const preview = buildTrimPhantomZonesPreview([zone]);
    assert.equal(preview.steps.length, 1);
    assert.equal(preview.orphanRows.phantomZones, 1);
    assert.ok(preview.steps[0].id.includes("wc_5_ctrl_B"));
    assert.ok(preview.steps[0].description.includes("wet check #5") || preview.steps[0].description.includes("Wet check #5"));
    assert.ok(preview.steps[0].description.includes("controller B"));
    assert.ok(preview.warnings.some((w) => /PERMANENT HARD DELETE/.test(w)));
    assert.ok(preview.warnings.some((w) => /Acknowledge to proceed/.test(w)));
  });

  it("not_checked zone beyond count WITH a note → excluded from preview (data preserved)", () => {
    const zone = makeZone({ id: 99, notes: "pressure low", zoneNumber: 50, zoneCount: 12 });
    const preview = buildTrimPhantomZonesPreview([zone]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.phantomZones, 0);
    assert.ok(preview.warnings.some((w) => /No trimmable/.test(w)));
  });

  it("not_checked zone beyond count WITH a PSI reading → excluded from preview", () => {
    const zone = makeZone({ id: 99, observedPressure: "45.50", zoneNumber: 50, zoneCount: 12 });
    const preview = buildTrimPhantomZonesPreview([zone]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.phantomZones, 0);
  });

  it("not_checked zone beyond count WITH findings → excluded from preview", () => {
    const zone = makeZone({ id: 99, findingCount: 2, zoneNumber: 50, zoneCount: 12 });
    const preview = buildTrimPhantomZonesPreview([zone]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.phantomZones, 0);
  });

  it("not_checked zone beyond count WITH non-zero repairLaborHours → excluded", () => {
    const zone = makeZone({ id: 99, repairLaborHours: "0.50", zoneNumber: 50, zoneCount: 12 });
    const preview = buildTrimPhantomZonesPreview([zone]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.phantomZones, 0);
  });

  it("not_checked zone beyond count WITH ranSuccessfully set → excluded from preview", () => {
    const zone = makeZone({ id: 99, ranSuccessfully: true, zoneNumber: 50, zoneCount: 12 });
    const preview = buildTrimPhantomZonesPreview([zone]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.phantomZones, 0);
  });

  it("mixed: one empty and one note-carrying zone — only empty appears in preview", () => {
    const empty = makeZone({ id: 1, wetCheckId: 10, zoneNumber: 50, zoneCount: 12 });
    const noteZone = makeZone({ id: 2, wetCheckId: 10, zoneNumber: 51, zoneCount: 12, notes: "test note" });
    const preview = buildTrimPhantomZonesPreview([empty, noteZone]);
    assert.equal(preview.steps.length, 1);
    assert.equal(preview.orphanRows.phantomZones, 1);
    assert.ok(preview.steps[0].description.includes("zone number"));
  });

  it("multiple wet checks produce one step per (wetCheck, controller) group", () => {
    const zones = [
      makeZone({ id: 1, wetCheckId: 10, controllerLetter: "A", zoneNumber: 50, zoneCount: 12 }),
      makeZone({ id: 2, wetCheckId: 10, controllerLetter: "A", zoneNumber: 51, zoneCount: 12 }),
      makeZone({ id: 3, wetCheckId: 20, controllerLetter: "B", zoneNumber: 30, zoneCount: 6 }),
    ];
    const preview = buildTrimPhantomZonesPreview(zones);
    assert.equal(preview.steps.length, 2);
    assert.equal(preview.orphanRows.phantomZones, 3);
  });
});

// ── runTrimPhantomZonesMigration ──────────────────────────────────────────────

describe("runTrimPhantomZonesMigration — test case (a): zone with note is NOT deleted", async () => {
  it("not_checked zone beyond count with a note is preserved", async () => {
    // The candidate query (in the real DB) would still return this zone
    // because the DB query only filters by status+zoneNumber, not isEmptyZone.
    // The JS guard inside the runner must reject it.
    const noteZone = makeZone({ id: 99, notes: "pressure low", zoneNumber: 50, zoneCount: 12 });
    const deps = makeDeps({ candidates: [noteZone] });
    const emits: Array<{ step: string; status: string }> = [];
    const results = await runTrimPhantomZonesMigration(deps, (e) => emits.push(e));

    // Zone must NOT be deleted
    assert.equal(deps.deleted.length, 0);

    // Runner finds nothing trimmable → skipped
    const summary = results.find((r) => r.id === "trim_summary")!;
    assert.equal(summary.status, "skipped");
    assert.equal(summary.rowsAffected, 0);

    // markDone still called so check() reports completed
    assert.ok(deps.markedDone);
  });
});

describe("runTrimPhantomZonesMigration — test case (b): empty zone beyond count IS deleted", async () => {
  it("truly empty not_checked zone beyond count is deleted", async () => {
    const emptyZone = makeZone({ id: 1, wetCheckId: 5, zoneNumber: 50, zoneCount: 12 });
    const deps = makeDeps({ candidates: [emptyZone] });
    const emits: Array<{ step: string; status: string }> = [];
    const results = await runTrimPhantomZonesMigration(deps, (e) => emits.push(e));

    assert.ok(deps.deleted.includes(1), "zone id=1 should have been deleted");

    const wcStep = results.find((r) => r.id === "wc_5")!;
    assert.equal(wcStep.status, "success");
    assert.equal(wcStep.rowsAffected, 1);

    const summary = results.find((r) => r.id === "trim_summary")!;
    assert.equal(summary.status, "success");
    assert.equal(summary.rowsAffected, 1);

    assert.ok(deps.markedDone);
    assert.ok(emits.some((e) => e.step === "wc_5" && e.status === "running"));
    assert.ok(emits.some((e) => e.step === "wc_5" && e.status === "success"));
  });
});

describe("runTrimPhantomZonesMigration — test case (c): other statuses are never deleted", async () => {
  it("checked_ok, checked_with_issues, not_applicable zones are not deleted regardless of zoneNumber", async () => {
    // These would not reach the runner in practice (the DB query filters
    // status='not_checked'), but we confirm the JS guard also respects
    // isEmptyZone's status check (status != 'not_checked' → not empty → not deleted).
    const zones = [
      makeZone({ id: 10, status: "checked_ok",          zoneNumber: 50, zoneCount: 12 }),
      makeZone({ id: 11, status: "checked_with_issues", zoneNumber: 50, zoneCount: 12 }),
      makeZone({ id: 12, status: "not_applicable",      zoneNumber: 50, zoneCount: 12 }),
    ];
    const deps = makeDeps({ candidates: zones });
    const results = await runTrimPhantomZonesMigration(deps, () => {});

    assert.equal(deps.deleted.length, 0, "no zones with non-not_checked status should be deleted");

    const summary = results.find((r) => r.id === "trim_summary")!;
    assert.equal(summary.status, "skipped");
    assert.equal(summary.rowsAffected, 0);
    assert.ok(deps.markedDone);
  });
});

describe("runTrimPhantomZonesMigration — test case (d): idempotent re-run", async () => {
  it("after a clean pass, re-run finds nothing and check() would report completed", async () => {
    // First run — one trimmable zone
    const emptyZone = makeZone({ id: 7, wetCheckId: 3, zoneNumber: 99, zoneCount: 10 });
    const deps1 = makeDeps({ candidates: [emptyZone] });
    await runTrimPhantomZonesMigration(deps1, () => {});
    assert.ok(deps1.deleted.includes(7));

    // Second run — no candidates remain (simulates the zone being gone from DB)
    const deps2 = makeDeps({ candidates: [] });
    const results2 = await runTrimPhantomZonesMigration(deps2, () => {});
    assert.equal(deps2.deleted.length, 0);
    const summary2 = results2.find((r) => r.id === "trim_summary")!;
    assert.equal(summary2.status, "skipped");
    assert.equal(summary2.rowsAffected, 0);
    assert.ok(deps2.markedDone, "markDone should be called even on the re-run with zero candidates");
  });
});

describe("runTrimPhantomZonesMigration — partial failure handling", () => {
  it("failed deletes are recorded; successful ones proceed; markDone not called when errors remain", async () => {
    const zones = [
      makeZone({ id: 1, wetCheckId: 10, zoneNumber: 50, zoneCount: 12 }),
      makeZone({ id: 2, wetCheckId: 20, zoneNumber: 55, zoneCount: 12 }),
    ];
    const deps = makeDeps({ candidates: zones, failIds: new Set([1]) });
    const results = await runTrimPhantomZonesMigration(deps, () => {});

    // zone 2 (different wet check) should still be deleted
    assert.ok(deps.deleted.includes(2));
    assert.ok(!deps.deleted.includes(1));

    const summary = results.find((r) => r.id === "trim_summary")!;
    assert.equal(summary.status, "failed");
    assert.ok(!deps.markedDone, "markDone should NOT be called when there are errors");
  });
});

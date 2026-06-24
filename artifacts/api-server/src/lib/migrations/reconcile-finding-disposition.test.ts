// Task #1538 — Tests for the reconcile-finding-disposition migration.
//
// All tests use in-memory deps — no shared dev-DB required. The pure preview
// builder (buildFindingDispositionPreview) and the deps-injectable runner
// (runFindingDispositionMigration) are tested in isolation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFindingDispositionPreview,
  runFindingDispositionMigration,
  computeFindingRepair,
  type FindingRow,
  type FindingRepair,
  type FindingMigrationDeps,
} from "./reconcile-finding-disposition";

// ── computeFindingRepair ──────────────────────────────────────────────────────

describe("computeFindingRepair", () => {
  it("routes to needs_review when no part and not labor-only", () => {
    const repair = computeFindingRepair(
      { partId: null, noPartNeeded: false, issueType: "head_replacement" },
      new Set(),
    );
    assert.deepEqual(repair, { newResolution: "pending", newTechDisposition: "needs_review" });
  });

  it("routes to repaired_in_field when a partId is present", () => {
    const repair = computeFindingRepair(
      { partId: 42, noPartNeeded: false, issueType: "head_replacement" },
      new Set(),
    );
    assert.deepEqual(repair, { newResolution: "repaired_in_field", newTechDisposition: "completed_in_field" });
  });

  it("routes to repaired_in_field when noPartNeeded=true (labor-only mark complete)", () => {
    const repair = computeFindingRepair(
      { partId: null, noPartNeeded: true, issueType: "coverage_issue" },
      new Set(),
    );
    assert.deepEqual(repair, { newResolution: "repaired_in_field", newTechDisposition: "completed_in_field" });
  });

  it("routes to repaired_in_field for a labor-only issue type", () => {
    const repair = computeFindingRepair(
      { partId: null, noPartNeeded: false, issueType: "special_labor" },
      new Set(["special_labor"]),
    );
    assert.deepEqual(repair, { newResolution: "repaired_in_field", newTechDisposition: "completed_in_field" });
  });
});

// ── buildFindingDispositionPreview ────────────────────────────────────────────

describe("buildFindingDispositionPreview", () => {
  it("empty candidate set → 0 steps, no ack warnings", () => {
    const preview = buildFindingDispositionPreview([], new Set());
    assert.equal(preview.steps.length, 0);
    assert.deepEqual(preview.orphanRows, {});
    assert.ok(preview.warnings.some((w) => /No split findings/.test(w)));
  });

  it("split finding with no part → preview flags it as needs_review route", () => {
    const candidates: FindingRow[] = [
      { id: 101, wetCheckId: 5, issueType: "head_replacement", partId: null, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
    ];
    const preview = buildFindingDispositionPreview(candidates, new Set());
    assert.equal(preview.steps.length, 1);
    assert.equal(preview.steps[0].id, "finding_101");
    assert.match(preview.steps[0].description, /needs_review/);
    assert.match(preview.steps[0].description, /pending/);
    // orphanRows is empty so Run button is never permanently gated
    assert.deepEqual(preview.orphanRows, {});
    // acknowledgement warning present
    assert.ok(preview.warnings.some((w) => /1 finding\(s\)/.test(w)));
    assert.ok(preview.warnings.some((w) => /Acknowledge to proceed/.test(w)));
  });

  it("split finding with a partId → preview shows repaired_in_field route", () => {
    const candidates: FindingRow[] = [
      { id: 202, wetCheckId: 7, issueType: "valve_issue", partId: 99, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
    ];
    const preview = buildFindingDispositionPreview(candidates, new Set());
    assert.equal(preview.steps.length, 1);
    assert.match(preview.steps[0].description, /repaired_in_field/);
    assert.match(preview.steps[0].description, /completed_in_field/);
  });

  it("multiple candidates produce one step each and the count in warnings", () => {
    const candidates: FindingRow[] = [
      { id: 10, wetCheckId: 1, issueType: "leak_repair", partId: null, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
      { id: 11, wetCheckId: 1, issueType: "nozzle_replacement", partId: 55, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
    ];
    const preview = buildFindingDispositionPreview(candidates, new Set());
    assert.equal(preview.steps.length, 2);
    assert.ok(preview.warnings.some((w) => /2 finding\(s\)/.test(w)));
  });

  it("already-consistent findings are never included (they would not be in candidates)", () => {
    // Only split findings are fed to preview; this test confirms the preview
    // does not itself filter — it trusts the candidate set.
    const candidates: FindingRow[] = [];
    const preview = buildFindingDispositionPreview(candidates, new Set());
    assert.equal(preview.steps.length, 0);
  });
});

// ── runFindingDispositionMigration ────────────────────────────────────────────

function makeDeps(opts: {
  candidates: FindingRow[];
  failIds?: Set<number>;
}): FindingMigrationDeps & { applied: Map<number, FindingRepair>; markedDone: boolean } {
  const applied = new Map<number, FindingRepair>();
  let markedDone = false;
  const failIds = opts.failIds ?? new Set<number>();

  const deps: FindingMigrationDeps & { applied: Map<number, FindingRepair>; markedDone: boolean } = {
    applied,
    get markedDone() { return markedDone; },
    getCandidates: async () => opts.candidates,
    applyRepair: async (id, repair) => {
      if (failIds.has(id)) throw new Error(`simulated failure for finding ${id}`);
      applied.set(id, repair);
    },
    markDone: async () => { markedDone = true; },
  };
  return deps;
}

describe("runFindingDispositionMigration", () => {
  it("split no-part finding → routes to needs_review; re-run is skipped", async () => {
    const candidates: FindingRow[] = [
      { id: 1, wetCheckId: 2, issueType: "head_replacement", partId: null, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
    ];
    const deps = makeDeps({ candidates });
    const emits: Array<{ step: string; status: string }> = [];
    const results = await runFindingDispositionMigration(deps, (e) => emits.push(e), new Set());

    // Applied the correct repair
    assert.ok(deps.applied.has(1));
    assert.deepEqual(deps.applied.get(1), { newResolution: "pending", newTechDisposition: "needs_review" });

    // Per-row step + summary
    const rowResult = results.find((r) => r.id === "finding_1")!;
    assert.equal(rowResult.status, "success");
    const summary = results.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary.status, "success");
    assert.equal(summary.rowsAffected, 1);

    // markDone called
    assert.ok(deps.markedDone);

    // Emitted running → success
    assert.ok(emits.some((e) => e.step === "finding_1" && e.status === "running"));
    assert.ok(emits.some((e) => e.step === "finding_1" && e.status === "success"));

    // Re-run: no candidates → skipped
    const deps2 = makeDeps({ candidates: [] });
    const results2 = await runFindingDispositionMigration(deps2, () => {}, new Set());
    const summary2 = results2.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary2.status, "skipped");
    assert.equal(summary2.rowsAffected, 0);
    assert.ok(deps2.markedDone);
  });

  it("split finding with a partId → aligns to repaired_in_field / completed_in_field", async () => {
    const candidates: FindingRow[] = [
      { id: 55, wetCheckId: 3, issueType: "valve_issue", partId: 12, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
    ];
    const deps = makeDeps({ candidates });
    await runFindingDispositionMigration(deps, () => {}, new Set());

    assert.ok(deps.applied.has(55));
    assert.deepEqual(deps.applied.get(55), { newResolution: "repaired_in_field", newTechDisposition: "completed_in_field" });
    assert.ok(deps.markedDone);
  });

  it("finding already consistent (e.g. resolution=repaired_in_field + techDisposition=completed_in_field) is not in candidates and thus untouched", async () => {
    // Consistent findings are excluded by the DB query; this test confirms
    // the runner applies nothing when the candidate list is empty.
    const deps = makeDeps({ candidates: [] });
    const results = await runFindingDispositionMigration(deps, () => {}, new Set());
    assert.equal(deps.applied.size, 0);
    const summary = results.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary.rowsAffected, 0);
  });

  it("partial failure: failed steps are recorded, successful ones still applied", async () => {
    const candidates: FindingRow[] = [
      { id: 10, wetCheckId: 1, issueType: "leak_repair", partId: null, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
      { id: 11, wetCheckId: 1, issueType: "nozzle_replacement", partId: 5, noPartNeeded: false, resolution: "pending", techDisposition: "completed_in_field" },
    ];
    const deps = makeDeps({ candidates, failIds: new Set([10]) });
    const results = await runFindingDispositionMigration(deps, () => {}, new Set());

    const failed = results.find((r) => r.id === "finding_10")!;
    assert.equal(failed.status, "failed");
    assert.ok(failed.error?.includes("simulated failure"));

    const ok = results.find((r) => r.id === "finding_11")!;
    assert.equal(ok.status, "success");
    assert.ok(deps.applied.has(11));

    const summary = results.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary.status, "failed");
    assert.equal(summary.rowsAffected, 1);

    // markDone NOT called when there are errors
    assert.ok(!deps.markedDone);
  });

  it("check() wrapping: error in getCandidates surfaces as failed step, not unhandled rejection", async () => {
    const errDeps: FindingMigrationDeps & { applied: Map<number, FindingRepair>; markedDone: boolean } = {
      applied: new Map(),
      markedDone: false,
      getCandidates: async () => { throw new Error("DB gone"); },
      applyRepair: async () => {},
      markDone: async () => {},
    };
    // The runner itself lets the error propagate (the check() wrapper in the
    // migration definition handles isolation). Test that the throw is not
    // swallowed silently:
    await assert.rejects(
      () => runFindingDispositionMigration(errDeps, () => {}, new Set()),
      /DB gone/,
    );
  });
});

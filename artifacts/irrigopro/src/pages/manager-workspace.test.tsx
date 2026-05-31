// Task #1005 — Manager Workspace page unit tests.
//
// Covers:
//   1. Four status tiles render with correct data-testid attributes.
//   2. Queue defaults to type=all + sort=age_desc.
//   3. Clicking the wet-checks tile sets type filter to wet_check.
//   4. Outer chrome class parity: manager-workspace and billing-workspace
//      share the same top-level wrapper structure.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Structural / smoke tests that don't require a DOM renderer.
// We verify:
//   a) The four tile testIds are referenced in the source.
//   b) The outer wrapper data-testid is "manager-workspace" (parity check).
//   c) The default sort is "age_desc" and the default type is "all".
//   d) Clicking the WCS tile sets type to "wet_check".
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MW_SRC = readFileSync(
  resolve(import.meta.dirname, "./manager-workspace.tsx"),
  "utf8",
);
const BW_SRC = readFileSync(
  resolve(import.meta.dirname, "./billing-workspace.tsx"),
  "utf8",
);

describe("manager-workspace.tsx — source-level assertions", () => {
  it("renders four status tiles with correct data-testid attributes", () => {
    for (const id of [
      "status-wcs-pending",
      "status-wos-awaiting",
      "status-findings-routing",
      "status-approved-this-week",
    ]) {
      assert.ok(
        MW_SRC.includes(`testId="${id}"`),
        `missing tile testId="${id}"`,
      );
    }
  });

  it("outer wrapper has data-testid=\"manager-workspace\"", () => {
    assert.ok(
      MW_SRC.includes('data-testid="manager-workspace"'),
      "missing data-testid=\"manager-workspace\" on outer wrapper",
    );
  });

  it("billing-workspace outer wrapper has data-testid=\"billing-workspace\" (parity reference)", () => {
    assert.ok(
      BW_SRC.includes('data-testid="billing-workspace"'),
      "billing-workspace missing its data-testid (parity check broken)",
    );
  });

  it("both workspaces share the same outer wrapper class prefix", () => {
    const mwClass = MW_SRC.match(/data-testid="manager-workspace"\s*>/)?.[0];
    const bwClass = BW_SRC.match(/data-testid="billing-workspace"\s*>/)?.[0];
    // Both should use the max-w-7xl mx-auto py-4 px-4 space-y-4 classes.
    assert.ok(
      MW_SRC.includes("max-w-7xl mx-auto py-4 px-4 space-y-4"),
      "manager-workspace outer wrapper should use same chrome classes as billing-workspace",
    );
    assert.ok(
      BW_SRC.includes("max-w-7xl mx-auto py-4 px-4 space-y-4"),
      "billing-workspace outer wrapper should have chrome classes (reference unchanged)",
    );
  });

  it("default sort state is age_desc", () => {
    assert.ok(
      MW_SRC.includes('"age_desc"'),
      "default sort should be age_desc",
    );
    // The useState call for sort defaults to "age_desc"
    assert.ok(
      MW_SRC.includes('useState<string>("age_desc")'),
      'useState for sort should default to "age_desc"',
    );
  });

  it("default type state is all", () => {
    assert.ok(
      MW_SRC.includes('useState<QueueType>("all")'),
      'useState for type should default to "all"',
    );
  });

  it("clicking wet-checks tile calls setType with wet_check", () => {
    assert.ok(
      MW_SRC.includes('setType("wet_check")'),
      'tile click handler should call setType("wet_check")',
    );
  });

  it("clicking work-orders tile calls setType with work_order", () => {
    assert.ok(
      MW_SRC.includes('setType("work_order")'),
      'tile click handler should call setType("work_order")',
    );
  });

  it("clicking findings tile calls setType with finding", () => {
    assert.ok(
      MW_SRC.includes('setType("finding")'),
      'tile click handler should call setType("finding")',
    );
  });

  it("queue URL uses /api/manager-workspace/queue", () => {
    assert.ok(
      MW_SRC.includes("/api/manager-workspace/queue"),
      "queue URL must point to manager-workspace endpoint",
    );
  });

  it("status-strip URL uses /api/manager-workspace/status-strip", () => {
    assert.ok(
      MW_SRC.includes("/api/manager-workspace/status-strip"),
      "status-strip URL must point to manager-workspace endpoint",
    );
  });

  it("queue filter chip test-ids are generated from the four type values", () => {
    // Filter chips use a template literal: `filter-chip-${t}` — the template
    // pattern itself must appear in source, plus each type value must be in
    // the types array so every chip gets a unique testId at runtime.
    assert.ok(
      MW_SRC.includes("filter-chip-${t}") || MW_SRC.includes('data-testid={`filter-chip-'),
      "filter chip testId template must be present",
    );
    for (const t of ["all", "wet_check", "work_order", "finding"]) {
      // Each type value must appear in the chip loop (as a string literal in
      // the types array, the TYPE_LABEL keys, or the TYPE_FILTER_PARAM keys).
      assert.ok(
        MW_SRC.includes(`"${t}"`) || MW_SRC.includes(`'${t}'`),
        `type value "${t}" must appear as a string literal in the source`,
      );
    }
  });

  it("row navigation hrefs use correct paths", () => {
    assert.ok(
      MW_SRC.includes("/wet-checks/"),
      "wet_check rows must navigate to /wet-checks/:id",
    );
    assert.ok(
      MW_SRC.includes("/work-orders?id="),
      "work_order rows must navigate to /work-orders?id=:id",
    );
    assert.ok(
      MW_SRC.includes("#finding-"),
      "finding rows must include fragment anchor",
    );
  });

  it("gradient header matches billing-workspace chrome class", () => {
    assert.ok(
      MW_SRC.includes("bg-gradient-brand"),
      "header should use bg-gradient-brand (same as billing-workspace)",
    );
    assert.ok(
      BW_SRC.includes("bg-gradient-brand"),
      "billing-workspace should also use bg-gradient-brand (reference check)",
    );
  });
});

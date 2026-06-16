// Task #1238 — Manager Workspace (merged) source-level assertions.
//
// Covers:
//   1. Outer wrapper has data-testid="manager-workspace".
//   2. Four stage tile testIds are present (findings_to_route removed Task #1280).
//   3. Four stage section testIds are present (findings_to_route removed Task #1280).
//   4. Keyboard shortcut keys (J/K/A/B/F/Ctrl+S/Shift+A) are wired.
//   5. Queue and status-strip URLs point to /api/manager-workspace/*.
//   6. Approve / kickback / save action testIds are present.
//   7. Stage filter chip testId is present.
//   8. Shortcuts cheatsheet testId is present.
//   9. Header uses bg-gradient-brand.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MW_SRC = readFileSync(
  resolve(import.meta.dirname, "./manager-workspace.tsx"),
  "utf8",
);

describe("manager-workspace.tsx — source-level assertions", () => {
  it("outer wrapper has data-testid=\"manager-workspace\"", () => {
    assert.ok(
      MW_SRC.includes('data-testid="manager-workspace"'),
      'missing data-testid="manager-workspace" on outer wrapper',
    );
  });

  it("has four stage tile testIds", () => {
    for (const stage of [
      "needs_review",
      "waiting_on_tech",
      "passed_to_billing",
      "billed_7d",
    ]) {
      assert.ok(
        MW_SRC.includes(`stage-tile-${stage}`) ||
          MW_SRC.includes("`stage-tile-${stage}`"),
        `missing stage tile testId for ${stage}`,
      );
    }
  });

  it("has four stage section testIds", () => {
    for (const stage of [
      "needs_review",
      "waiting_on_tech",
      "passed_to_billing",
      "billed_7d",
    ]) {
      assert.ok(
        MW_SRC.includes(`stage-section-${stage}`) ||
          MW_SRC.includes("`stage-section-${stage}`"),
        `missing stage section testId for ${stage}`,
      );
    }
  });

  it("keyboard shortcuts: J next / K previous wired", () => {
    assert.ok(MW_SRC.includes('"j"') || MW_SRC.includes('"J"'), "J key handler missing");
    assert.ok(MW_SRC.includes('"k"') || MW_SRC.includes('"K"'), "K key handler missing");
  });

  it("keyboard shortcuts: A approve / Shift+A bulk approve", () => {
    assert.ok(MW_SRC.includes("approveActive"), "A approve handler missing");
    assert.ok(MW_SRC.includes("bulkApprove"), "Shift+A bulk approve handler missing");
  });

  it("keyboard shortcuts: B kickback / F detail focus", () => {
    assert.ok(MW_SRC.includes('"b"') || MW_SRC.includes('"B"'), "B key handler missing");
    assert.ok(MW_SRC.includes('"f"') || MW_SRC.includes('"F"'), "F key handler missing");
  });

  it("keyboard shortcuts: Ctrl+S save / ? cheatsheet", () => {
    assert.ok(
      MW_SRC.includes("saveActiveEdits"),
      "Ctrl+S save-edits handler missing",
    );
    assert.ok(
      MW_SRC.includes("cheatsheetOpen"),
      "? cheatsheet state missing",
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

  it("approve button testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="approve-button"'),
      'missing data-testid="approve-button"',
    );
  });

  it("kickback reason textarea testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="kickback-reason"'),
      'missing data-testid="kickback-reason"',
    );
  });

  it("kickback button testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="kickback-button"'),
      'missing data-testid="kickback-button"',
    );
  });

  it("save-edits button testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="save-edits-button"'),
      'missing data-testid="save-edits-button"',
    );
  });

  it("clear-stage-filter chip testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="clear-stage-filter"'),
      'missing data-testid="clear-stage-filter"',
    );
  });

  it("shortcuts cheatsheet testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="shortcuts-cheatsheet"'),
      'missing data-testid="shortcuts-cheatsheet"',
    );
  });

  it("header uses bg-gradient-brand", () => {
    assert.ok(
      MW_SRC.includes("bg-gradient-brand"),
      "header should use bg-gradient-brand",
    );
  });

  it("FinancialPulseWidget billing-header variant is rendered", () => {
    assert.ok(
      MW_SRC.includes('variant="billing-header"'),
      'FinancialPulseWidget must use variant="billing-header"',
    );
  });

  it("bulk-approve endpoint is /api/billing-workspace/bulk-approve (reused)", () => {
    assert.ok(
      MW_SRC.includes("/api/billing-workspace/bulk-approve"),
      "bulk-approve must reuse the billing-workspace endpoint",
    );
  });

  it("outer wrapper uses max-w-7xl mx-auto py-4 px-4 space-y-4", () => {
    assert.ok(
      MW_SRC.includes("max-w-7xl mx-auto py-4 px-4 space-y-4"),
      "outer wrapper chrome class must match standard layout",
    );
  });

  it("StageSection row-cap constant ROW_CAP is declared", () => {
    assert.ok(
      MW_SRC.includes("ROW_CAP") && MW_SRC.includes("= 10"),
      "ROW_CAP = 10 constant must be declared for stage section windowing",
    );
  });

  it("show-all-rows button testId is present (10-row cap expander)", () => {
    assert.ok(
      MW_SRC.includes('data-testid="show-all-rows"'),
      'missing data-testid="show-all-rows" for stage section expander',
    );
  });

  it("show-less-rows button testId is present (collapse back to 10)", () => {
    assert.ok(
      MW_SRC.includes('data-testid="show-less-rows"'),
      'missing data-testid="show-less-rows" for stage section collapse',
    );
  });

  it("DetailPaneInline covers part and manual_review types", () => {
    assert.ok(
      MW_SRC.includes('"part"') && MW_SRC.includes('"manual_review"'),
      "part and manual_review type strings must appear in DetailPaneInline branch",
    );
    assert.ok(
      MW_SRC.includes("active.type === \"part\""),
      "part type guard must be present in DetailPaneInline condition",
    );
    assert.ok(
      MW_SRC.includes("active.type === \"manual_review\""),
      "manual_review type guard must be present in DetailPaneInline condition",
    );
  });

  it("wet_check detail pane has begin-review-button testId", () => {
    assert.ok(
      MW_SRC.includes('data-testid="begin-review-button"'),
      'missing data-testid="begin-review-button" for wet_check detail pane',
    );
  });

  it("finding detail pane has open-wet-check-button testId", () => {
    assert.ok(
      MW_SRC.includes('data-testid="open-wet-check-button"'),
      'missing data-testid="open-wet-check-button" for finding detail pane',
    );
  });

  it("B-key has no-op toast guard for wet_check type", () => {
    assert.ok(
      MW_SRC.includes('active.type === "wet_check"') &&
        MW_SRC.includes("Cannot kick back from here"),
      "B-key must show no-op toast for wet_check type",
    );
  });

  it("expanded stage state is lifted (expandedStages + toggleStageExpanded)", () => {
    assert.ok(
      MW_SRC.includes("expandedStages") && MW_SRC.includes("toggleStageExpanded"),
      "collapsed state must be lifted to parent for correct J/K traversal",
    );
  });

  it("age filter state and select are present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="manager-age-filter"'),
      'missing data-testid="manager-age-filter" select',
    );
    assert.ok(
      MW_SRC.includes('params.set("age", age)'),
      "age param must be wired to queue URL",
    );
  });

  it("sort filter state and select are present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="manager-sort"'),
      'missing data-testid="manager-sort" select',
    );
    assert.ok(
      MW_SRC.includes('params.set("sort", sort)'),
      "sort param must be wired to queue URL",
    );
  });

  it("advanceToNext is constrained to needs_review section", () => {
    assert.ok(
      MW_SRC.includes("grouped.needs_review"),
      "advanceToNext must reference grouped.needs_review, not global flatItems",
    );
    assert.ok(
      !MW_SRC.includes("Math.min(activeIndex + 1, flatItems.length - 1)"),
      "advanceToNext must NOT advance globally via flatItems",
    );
  });

  it("customer and tech filter controls are in the filter bar", () => {
    assert.ok(
      MW_SRC.includes('data-testid="manager-customer-filter"'),
      'missing data-testid="manager-customer-filter"',
    );
    assert.ok(
      MW_SRC.includes('data-testid="manager-tech-filter"'),
      'missing data-testid="manager-tech-filter"',
    );
  });

  it("age filter <1 option value is not HTML-encoded", () => {
    // JSX value={"<1"} renders as the literal string <1, not &lt;1
    const idx = MW_SRC.indexOf('"manager-age-filter"');
    const nearby = MW_SRC.slice(Math.max(0, idx - 500), idx + 500);
    assert.ok(
      !nearby.includes("&lt;1"),
      'age filter must not use HTML entity &lt;1 — use value={"<1"} instead',
    );
    assert.ok(
      nearby.includes('"<1"') || nearby.includes("'<1'"),
      'age filter must have a <1 option with the literal string "<1"',
    );
  });

  it("only wet_check and finding have no-op approve toast; other types fall through", () => {
    // wet_check_billing / part / manual_review should NOT have their own blocking toast
    assert.ok(
      !MW_SRC.includes("Wet check billings are passed to billing automatically"),
      "wet_check_billing must not block approve with a no-op toast",
    );
    assert.ok(
      !MW_SRC.includes("Part approvals must be handled from the Parts Pending Approval"),
      "part/manual_review must not block approve with a no-op toast",
    );
    // wet_check and finding still have no-op toasts
    assert.ok(
      MW_SRC.includes("Wet checks must be reviewed in their detail screen"),
      "wet_check still requires its no-op approve toast",
    );
  });

  it("kickback handler does not show 'Not supported' toast for non-BS/WO types", () => {
    assert.ok(
      !MW_SRC.includes('"Not supported"'),
      "kickback must not show a blocking Not-supported toast; use silent null-path guard instead",
    );
  });

  it("waiting_on_tech items render read-only panel (no DetailPaneInline, no action buttons)", () => {
    assert.ok(
      MW_SRC.includes('data-testid="waiting-on-tech-readonly"'),
      'missing data-testid="waiting-on-tech-readonly" read-only panel for waiting_on_tech stage',
    );
    // The waiting_on_tech check must come BEFORE the DetailPaneInline branch
    const witIdx = MW_SRC.indexOf('waiting_on_tech" ?');
    const dpiIdx = MW_SRC.indexOf("DetailPaneInline");
    assert.ok(
      witIdx >= 0 && dpiIdx >= 0 && witIdx < dpiIdx,
      "waiting_on_tech stage guard must appear before DetailPaneInline in the detail pane",
    );
  });

  it("view-record-button testId present in waiting_on_tech panel", () => {
    assert.ok(
      MW_SRC.includes('data-testid="view-record-button"'),
      'missing data-testid="view-record-button" in waiting_on_tech read-only panel',
    );
  });
});

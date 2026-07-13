// Task #1779 — Stale assertions scrubbed; updated to match the simplified
// Manager Workspace hub introduced in Task #1258.
//
// Covers:
//   1. Outer wrapper has data-testid="manager-workspace".
//   2. Needs-approval card testId is present.
//   3. Launchpad testId is present.
//   4. Launchpad tile links (Work Orders, Billing Sheets, Wet Checks, Estimates).
//   5. Needs-approval endpoint is /api/manager-workspace/needs-approval.
//   6. Status-strip URL uses /api/manager-workspace/status-strip.
//   7. Header uses bg-gradient-brand.
//   8. FinancialPulseWidget billing-header variant is rendered.
//   9. Outer wrapper uses max-w-5xl mx-auto py-4 px-4 space-y-4.
//  10. Task #1777 — Pending Estimates removal assertions (intact).

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

  it("needs-approval card testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="needs-approval-card"'),
      'missing data-testid="needs-approval-card"',
    );
  });

  it("launchpad testId is present", () => {
    assert.ok(
      MW_SRC.includes('data-testid="launchpad"'),
      'missing data-testid="launchpad"',
    );
  });

  it("launchpad tile links to /wet-checks/pending-review", () => {
    assert.ok(
      MW_SRC.includes('href="/wet-checks/pending-review"'),
      "Wet Checks launchpad tile must link to /wet-checks/pending-review",
    );
  });

  it("launchpad tile links to /work-orders", () => {
    assert.ok(
      MW_SRC.includes('href="/work-orders"'),
      "Work Orders launchpad tile must link to /work-orders",
    );
  });

  it("launchpad tile links to /billing-sheets", () => {
    assert.ok(
      MW_SRC.includes('href="/billing-sheets"'),
      "Billing Sheets launchpad tile must link to /billing-sheets",
    );
  });

  it("needs-approval endpoint is /api/manager-workspace/needs-approval", () => {
    assert.ok(
      MW_SRC.includes("/api/manager-workspace/needs-approval"),
      "needs-approval query must point to /api/manager-workspace/needs-approval",
    );
  });

  it("status-strip URL uses /api/manager-workspace/status-strip", () => {
    assert.ok(
      MW_SRC.includes("/api/manager-workspace/status-strip"),
      "status-strip URL must point to manager-workspace endpoint",
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

  it("outer wrapper uses max-w-5xl mx-auto py-4 px-4 space-y-4", () => {
    assert.ok(
      MW_SRC.includes("max-w-5xl mx-auto py-4 px-4 space-y-4"),
      "outer wrapper chrome class must match standard layout (max-w-5xl)",
    );
  });

  it("approval-row testId pattern is present for list items", () => {
    assert.ok(
      MW_SRC.includes("approval-row-"),
      'missing data-testid="approval-row-{id}" pattern for needs-approval list items',
    );
  });

  // ── Task #1777 — Pending Estimates removal ───────────────────────────────

  it("PendingEstimatesSection component is not defined in the source", () => {
    assert.ok(
      !MW_SRC.includes("PendingEstimatesSection"),
      "PendingEstimatesSection must be removed from manager-workspace.tsx",
    );
  });

  it("EstimateApprovalRow type is not defined in the source", () => {
    assert.ok(
      !MW_SRC.includes("EstimateApprovalRow"),
      "EstimateApprovalRow type must be removed from manager-workspace.tsx",
    );
  });

  it("EstimateDetailModal is not imported", () => {
    assert.ok(
      !MW_SRC.includes("EstimateDetailModal"),
      "EstimateDetailModal import must be removed from manager-workspace.tsx",
    );
  });

  it("sendEstimateEmail is not imported", () => {
    assert.ok(
      !MW_SRC.includes("sendEstimateEmail"),
      "sendEstimateEmail import must be removed from manager-workspace.tsx",
    );
  });

  it("totalCount does not include an estimates addend", () => {
    assert.ok(
      !MW_SRC.includes("pendingEstimates.length"),
      "totalCount must not reference pendingEstimates.length — estimates are not counted in Needs Approval",
    );
  });

  it("Estimates launchpad tile is still present", () => {
    assert.ok(
      MW_SRC.includes('href="/estimates/command-center"'),
      "Estimates launchpad tile link to /estimates/command-center must remain",
    );
  });

  it("pending-approval query is retained for the tile badge count", () => {
    assert.ok(
      MW_SRC.includes("/api/estimates/pending-approval"),
      "/api/estimates/pending-approval query must remain for the launchpad tile count",
    );
  });
});

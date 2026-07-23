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

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MW_SRC = readFileSync(
  resolve(import.meta.dirname, "./manager-workspace.tsx"),
  "utf8",
);

describe("manager-workspace.tsx — source-level assertions", () => {
  it('outer wrapper has data-testid="manager-workspace"', () => {
    expect(MW_SRC.includes('data-testid="manager-workspace"')).toBe(true);
  });

  it("needs-approval card testId is present", () => {
    expect(MW_SRC.includes('data-testid="needs-approval-card"')).toBe(true);
  });

  it("launchpad testId is present", () => {
    expect(MW_SRC.includes('data-testid="launchpad"')).toBe(true);
  });

  it("launchpad tile links to /wet-checks/pending-review", () => {
    expect(MW_SRC.includes('href="/wet-checks/pending-review"')).toBe(true);
  });

  it("launchpad tile links to /work-orders", () => {
    expect(MW_SRC.includes('href="/work-orders"')).toBe(true);
  });

  it("launchpad tile links to /billing-sheets", () => {
    expect(MW_SRC.includes('href="/billing-sheets"')).toBe(true);
  });

  it("needs-approval endpoint is /api/manager-workspace/needs-approval", () => {
    expect(MW_SRC.includes("/api/manager-workspace/needs-approval")).toBe(true);
  });

  it("status-strip URL uses /api/manager-workspace/status-strip", () => {
    expect(MW_SRC.includes("/api/manager-workspace/status-strip")).toBe(true);
  });

  it("header uses bg-gradient-brand", () => {
    expect(MW_SRC.includes("bg-gradient-brand")).toBe(true);
  });

  it('FinancialPulseWidget billing-header variant is rendered', () => {
    expect(MW_SRC.includes('variant="billing-header"')).toBe(true);
  });

  it("outer wrapper uses max-w-5xl mx-auto py-4 px-4 space-y-4", () => {
    expect(MW_SRC.includes("max-w-5xl mx-auto py-4 px-4 space-y-4")).toBe(true);
  });

  it("approval-row testId pattern is present for list items", () => {
    expect(MW_SRC.includes("approval-row-")).toBe(true);
  });

  // ── Task #1777 — Pending Estimates removal ───────────────────────────────

  it("PendingEstimatesSection component is not defined in the source", () => {
    expect(MW_SRC.includes("PendingEstimatesSection")).toBe(false);
  });

  it("EstimateApprovalRow type is not defined in the source", () => {
    expect(MW_SRC.includes("EstimateApprovalRow")).toBe(false);
  });

  it("EstimateDetailModal is not imported", () => {
    expect(MW_SRC.includes("EstimateDetailModal")).toBe(false);
  });

  it("sendEstimateEmail is not imported", () => {
    expect(MW_SRC.includes("sendEstimateEmail")).toBe(false);
  });

  it("totalCount does not include an estimates addend", () => {
    expect(MW_SRC.includes("pendingEstimates.length")).toBe(false);
  });

  it("Estimates launchpad tile is still present", () => {
    expect(MW_SRC.includes('href="/estimates/command-center"')).toBe(true);
  });

  it("pending-approval query is retained for the tile badge count", () => {
    expect(MW_SRC.includes("/api/estimates/pending-approval")).toBe(true);
  });
});

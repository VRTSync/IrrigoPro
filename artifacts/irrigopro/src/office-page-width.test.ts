import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrappers = [
  ["pages/admin-dashboard.tsx", "max-w-7xl mx-auto pt-4 pb-8 px-2 sm:px-4 space-y-5", "w-full pt-4 pb-8 px-2 sm:px-4 lg:px-6 space-y-5"],
  ["pages/operations.tsx", "max-w-7xl mx-auto -mt-2", "w-full -mt-2"],
  ["pages/estimate-command-center.tsx", "py-6 max-w-[1400px] mx-auto space-y-6", "py-6 w-full space-y-6"],
  ["pages/wet-checks/WetCheckSystemPage.tsx", "max-w-6xl mx-auto py-6 px-4", "w-full py-6 px-4 lg:px-6"],
  ["pages/manager-workspace.tsx", "max-w-5xl mx-auto py-4 px-4 space-y-4", "w-full py-4 px-4 lg:px-6 space-y-4"],
  ["pages/action-board.tsx", "max-w-7xl mx-auto px-4 pt-6", "w-full px-4 lg:px-6 pt-6"],
  ["pages/action-board.tsx", "max-w-7xl mx-auto py-6 px-4 space-y-6", "w-full py-6 px-4 lg:px-6 space-y-6"],
  ["pages/budget-status.tsx", "max-w-5xl mx-auto py-4 px-4", "w-full py-4 px-4 lg:px-6"],
  ["pages/budget-status.tsx", "max-w-5xl mx-auto py-4 px-4 space-y-4", "w-full py-4 px-4 lg:px-6 space-y-4"],
  ["pages/wet-check-reconciliation.tsx", "max-w-6xl mx-auto py-6 px-4 space-y-6", "w-full py-6 px-4 lg:px-6 space-y-6"],
  ["pages/parts-pending-approval.tsx", "space-y-6 p-6 max-w-5xl mx-auto", "space-y-6 p-6 w-full"],
  ["pages/parts-settings.tsx", "max-w-4xl mx-auto py-6 px-4", "w-full py-6 px-4 lg:px-6"],
  ["pages/markup-schedule.tsx", "mx-auto max-w-5xl space-y-6 py-6", "w-full space-y-6 py-6"],
  ["pages/labor-rates.tsx", "max-w-5xl mx-auto py-6 px-4", "w-full py-6 px-4 lg:px-6"],
  ["pages/admin-budget-goals.tsx", "space-y-6 max-w-5xl mx-auto", "space-y-6 w-full"],
  ["pages/admin-issue-types.tsx", "max-w-6xl mx-auto py-6 space-y-4", "w-full py-6 space-y-4"],
  ["pages/admin-client-errors.tsx", "max-w-6xl mx-auto py-6 space-y-6", "w-full py-6 space-y-6"],
  ["pages/company-profile.tsx", "max-w-4xl mx-auto", "w-full"],
  ["pages/user-profile.tsx", "container mx-auto p-6 max-w-4xl", "w-full p-6"],
  ["pages/company-user-management.tsx", "container mx-auto p-6 space-y-8", "w-full p-6 space-y-8"],
  ["pages/customers/IrrigationProfile.tsx", "container mx-auto p-4 max-w-4xl space-y-4", "w-full p-4 lg:px-6 space-y-4"],
  ["pages/estimates.tsx", "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6", "w-full px-4 sm:px-6 lg:px-8 py-6"],
  ["pages/estimates-pending-approval.tsx", "space-y-6 p-6 max-w-6xl mx-auto", "space-y-6 p-6 w-full"],
  ["components/wet-check-review/CombinedReviewSurface.tsx", "max-w-4xl mx-auto py-6 px-4 space-y-4", "w-full py-6 px-4 lg:px-6 space-y-4"],
  ["components/wet-check-review/CombinedReviewSurface.tsx", "max-w-4xl mx-auto py-6 px-4", "w-full py-6 px-4 lg:px-6"],
  ["components/wet-check-review/CombinedReviewSurface.tsx", "max-w-4xl mx-auto py-6 px-4 space-y-6", "w-full py-6 px-4 lg:px-6 space-y-6"],
  ["components/manager/wet-check-confirm.tsx", "max-w-3xl mx-auto py-4 space-y-0 px-4 sm:px-0", "w-full py-4 space-y-0 px-4 lg:px-6"],
  ["components/manager/wet-check-done.tsx", "max-w-3xl mx-auto py-4 space-y-0 px-4 sm:px-0", "w-full py-4 space-y-0 px-4 lg:px-6"],
  ["components/manager/wet-check-wizard.tsx", "max-w-3xl mx-auto py-4 space-y-4", "w-full py-4 px-4 lg:px-6 space-y-4"],
  ["components/manager/wet-check-wizard.tsx", "max-w-3xl mx-auto py-4 space-y-4 px-4 sm:px-0", "w-full py-4 space-y-4 px-4 lg:px-6"],
] as const;

describe("office page widths", () => {
  it.each(wrappers)("%s replaces %s with %s", (file, before, after) => {
    const source = readFileSync(`src/${file}`, "utf8");
    expect(source).toContain(`className="${after}"`);
    expect(source).not.toContain(`className="${before}"`);
  });
});

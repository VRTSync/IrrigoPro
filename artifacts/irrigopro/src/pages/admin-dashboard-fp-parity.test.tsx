// Task #708 — Static-source guard for the admin-dashboard FP wiring.
//
// Replaces the prior #662 "this-month-billed" test (deleted with the
// FinancialExposure / TopLists components). The new contract is:
//
//  1. The Unbilled Revenue KPI tile is sourced from
//     `/api/financial-pulse/kpis` — NOT from a client-side reduce
//     over `/api/customers/billing-preview`.
//  2. The page mounts the shared `<FinancialPulseWidget>` for both
//     the admin-dashboard variant and the top-customers-compact
//     variant.
//  3. The legacy in-page `<FinancialExposure>` and `<TopLists>`
//     components are no longer imported.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join(__dirname, "admin-dashboard.tsx"),
  "utf8",
);

describe("Task #708 — admin-dashboard FP parity", () => {
  it("Unbilled Revenue tile is sourced from FP, not billing-preview reduce", () => {
    expect(SRC).toContain("/api/financial-pulse/kpis");
    // The previous (Slice 4) implementation reduced over
    // billingPreviewQ.data summing `totalUnbilled` to drive the
    // KPI tile. That client-side aggregation is now gone.
    expect(SRC).not.toMatch(/totalUnbilled\s*\+=/);
    expect(SRC).not.toMatch(
      /financial\.totalUnbilled[\s\S]{0,200}testId="kpi-unbilled-revenue"/,
    );
  });

  it("mounts the shared FinancialPulseWidget (admin + top-customers)", () => {
    expect(SRC).toContain("FinancialPulseWidget");
    expect(SRC).toMatch(/variant=["']admin-dashboard["']/);
    expect(SRC).toMatch(/variant=["']top-customers-compact["']/);
  });

  it("no longer imports the legacy FinancialExposure / TopLists components", () => {
    expect(SRC).not.toMatch(/admin-dashboard\/financial-exposure/);
    expect(SRC).not.toMatch(/admin-dashboard\/top-lists/);
  });

  it("Unbilled tile links to /financial-pulse, not the legacy billing dashboard", () => {
    // The new tile points users at the FP page so the source of
    // truth is one click away. Guard against a regression that
    // re-points it back at /billing/dashboard.
    const tileBlock = SRC.split('testId="kpi-unbilled-revenue"')[0];
    const lastHref = tileBlock.lastIndexOf("href=");
    const hrefSnippet = tileBlock.slice(lastHref, lastHref + 80);
    expect(hrefSnippet).toContain("/financial-pulse");
  });
});

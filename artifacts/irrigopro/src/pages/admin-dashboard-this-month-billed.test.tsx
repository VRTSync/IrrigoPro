// Task #662 — Regression test for the "This Month Billed" tile.
//
// Two angles:
//   1. Static-source guard: admin-dashboard.tsx must fetch from
//      /api/dashboard/this-month-billed and must NOT compute the
//      tile by summing /api/invoices client-side. If a future
//      change reintroduces the cross-tenant leak we caught here.
//   2. Runtime render: FinancialExposure renders the endpoint's
//      `amount` value verbatim (no further client-side math).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { FinancialExposure } from "@/components/admin-dashboard/financial-exposure";

describe("Task #662 — admin-dashboard This Month Billed wiring", () => {
  const dashboardSrc = fs.readFileSync(
    path.join(__dirname, "admin-dashboard.tsx"),
    "utf8",
  );

  it("admin-dashboard.tsx fetches the company-scoped endpoint", () => {
    expect(dashboardSrc).toContain("/api/dashboard/this-month-billed");
  });

  it("admin-dashboard.tsx does NOT sum invoices client-side for thisMonthBilled", () => {
    // The previous (broken) code derived thisMonthBilled from
    // invoicesQ via a `.reduce(...)` over `totalAmount`. Guard
    // against that pattern returning.
    const lines = dashboardSrc.split("\n");
    const offenders = lines
      .map((text, i) => ({ text, line: i + 1 }))
      .filter(({ text }) => /thisMonthBilled\s*[:=][^,;]*invoices[A-Za-z]*Q/.test(text));
    expect(offenders).toEqual([]);
    // And no client-side `totalAmount` reduce hanging off invoicesQ
    // either — the new code reads `thisMonthBilledQ.data?.amount`.
    expect(dashboardSrc).toMatch(/thisMonthBilledQ\.data\?\.amount/);
  });

  it("FinancialExposure renders the amount returned by the new endpoint", () => {
    render(
      <FinancialExposure
        approvedUnbilled={0}
        unapprovedUnbilled={0}
        totalUnbilled={0}
        thisMonthBilled={3000}
        isLoading={false}
      />,
    );
    const tile = screen.getByTestId("exposure-month");
    expect(tile.textContent).toContain("This Month Billed");
    // Formatted as USD with no decimal places.
    expect(tile.textContent).toContain("$3,000");
  });

  it("FinancialExposure shows the loading skeleton instead of a stale 0", () => {
    render(
      <FinancialExposure
        approvedUnbilled={0}
        unapprovedUnbilled={0}
        totalUnbilled={0}
        thisMonthBilled={0}
        isLoading={true}
      />,
    );
    const tile = screen.getByTestId("exposure-month");
    // While loading we must not flash a misleading "$0".
    expect(tile.textContent).not.toContain("$0");
  });
});

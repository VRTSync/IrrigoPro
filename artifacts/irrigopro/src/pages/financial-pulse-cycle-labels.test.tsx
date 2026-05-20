// Task #723 — Cycle-language rename for the FP page's top KPI tiles.
//
// We avoid mounting the whole FinancialPulsePage (it pulls in
// RevenueMixCard / charts / etc.) and instead pin the rename with:
//   1. A direct render of MetricTile with the same props the page
//      passes for the renamed tile — proves the helper "April 2026"
//      subtitle renders alongside the delta and no MTD badge shows.
//   2. A static-source guard over `financial-pulse.tsx` proving the
//      new labels, `billedLastCycle` field, and absence of the old
//      "Billed MTD" / `windowBadge="MTD"` on the renamed tile.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MetricTile } from "@/components/financial-pulse/metric-tile";

function withTooltip(ui: React.ReactNode) {
  return <TooltipProvider>{ui}</TooltipProvider>;
}

describe("Task #723 — MetricTile renders helper alongside delta", () => {
  it("shows the 'Billed Last Cycle' label, the closed month subtitle, and the cycle-aware delta together", () => {
    render(
      withTooltip(
        <MetricTile
          testId="kpi-billed-last-cycle"
          label="Billed Last Cycle"
          value={55000}
          format="currency"
          deltaPct={-5.5}
          deltaLabel="vs prior month"
          deltaGoodDirection="up"
          helper="April 2026"
        />,
      ),
    );
    const tile = screen.getByTestId("kpi-billed-last-cycle");
    expect(tile.textContent).toMatch(/Billed Last Cycle/);
    // Subtitle visible alongside delta.
    expect(tile.textContent).toMatch(/April 2026/);
    // Delta label uses cycle wording.
    expect(tile.textContent).toMatch(/vs prior month/);
    // Value formatted as currency.
    expect(tile.textContent).toMatch(/\$55,000/);
    // No window badge on this tile.
    expect(
      tile.querySelector('[data-testid="kpi-billed-last-cycle-window-badge"]'),
    ).toBeNull();
  });

  it("renders the 'Current Cycle ({Month})' label on the unbilled tile", () => {
    const monthName = new Date().toLocaleDateString(undefined, {
      month: "long",
    });
    render(
      withTooltip(
        <MetricTile
          testId="kpi-unbilled-exposure"
          label={`Current Cycle (${monthName})`}
          value={2200}
          format="currency"
          deltaGoodDirection="down"
        />,
      ),
    );
    const tile = screen.getByTestId("kpi-unbilled-exposure");
    expect(tile.textContent).toMatch(
      new RegExp(`Current Cycle \\(${monthName}\\)`),
    );
    expect(tile.textContent).toMatch(/\$2,200/);
  });
});

describe("Task #723 — static-source guards for the rename", () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, "financial-pulse.tsx"),
    "utf8",
  );

  it("declares billedLastCycle on the KpisResponse shape", () => {
    expect(SRC).toMatch(/billedLastCycle:\s*BilledLastCycleTile/);
    expect(SRC).toMatch(/monthLabel:\s*string/);
    expect(SRC).toMatch(/monthIso:\s*string/);
  });

  it("first KPI tile uses the cycle label, sources from billedLastCycle, and drops the MTD badge", () => {
    const tileStart = SRC.indexOf('testId="kpi-billed-last-cycle"');
    expect(tileStart).toBeGreaterThan(-1);
    const tileEnd = SRC.indexOf("/>", tileStart);
    const tile = SRC.slice(tileStart, tileEnd);
    expect(tile).toMatch(/label="Billed Last Cycle"/);
    expect(tile).toMatch(/data\?\.billedLastCycle\.value/);
    expect(tile).toMatch(/deltaLabel="vs prior month"/);
    expect(tile).toMatch(/helper=\{data\?\.billedLastCycle\.monthLabel\}/);
    expect(tile).not.toMatch(/windowBadge="MTD"/);
    expect(tile).not.toMatch(/INFO_TIPS\.billedMtd/);
  });

  it("unbilled-exposure tile uses the 'Work Not Yet Billed' label (Task #730 rename)", () => {
    const tileStart = SRC.indexOf('testId="kpi-unbilled-exposure"');
    expect(tileStart).toBeGreaterThan(-1);
    const tileEnd = SRC.indexOf("/>", tileStart);
    const tile = SRC.slice(tileStart, tileEnd);
    // Task #730 renamed the tile from "Unbilled Pipeline" (Task #726) to "Work Not Yet Billed".
    expect(tile).toMatch(/label="Work Not Yet Billed"/);
    // Old labels must be gone.
    expect(tile).not.toMatch(/label="Unbilled Exposure"/);
    expect(tile).not.toMatch(/label="Unbilled Pipeline"/);
  });
});

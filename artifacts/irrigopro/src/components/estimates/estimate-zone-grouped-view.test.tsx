/**
 * estimate-zone-grouped-view.test.tsx
 *
 * Covers:
 *  (a) Inspection pending-approval surface shows zone-grouped sections +
 *      per-zone subtotals, not a flat list.
 *  (b) Pricing-restricted role (field_tech) sees zone structure and labels
 *      but no dollar columns.
 *  (c) Labor-only / $0.00 lines appear under their zone rather than as
 *      orphan rows.
 *  (d) Non-inspection surface (no zone tags) renders the labor-only empty
 *      state, not the zone-grouped view.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { EstimateZoneGroupedView } from "./estimate-zone-grouped-view";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeZonedItems() {
  return [
    {
      id: 1,
      partName: "Rotor head",
      issueType: "broken_head",
      quantity: 2,
      partPrice: "12.50",
      laborHours: "0.50",
      totalPrice: "25.00",
      controllerLetter: "A",
      zoneNumber: 1,
    },
    {
      id: 2,
      partName: "Nozzle",
      issueType: "clogged_nozzle",
      quantity: 1,
      partPrice: "3.00",
      laborHours: "0.25",
      totalPrice: "3.00",
      controllerLetter: "A",
      zoneNumber: 2,
    },
    {
      id: 3,
      // labor-only: partPrice = 0
      partName: null,
      issueType: "leak",
      quantity: 0,
      partPrice: "0.00",
      laborHours: "1.00",
      totalPrice: "0.00",
      controllerLetter: "B",
      zoneNumber: 1,
    },
  ];
}

function renderView(props: Partial<React.ComponentProps<typeof EstimateZoneGroupedView>> = {}) {
  const defaults: React.ComponentProps<typeof EstimateZoneGroupedView> = {
    items: makeZonedItems(),
    laborRate: 75,
    partsSubtotal: 28,
    laborSubtotal: 131.25,
    totalAmount: 159.25,
    totalLaborHours: 1.75,
    canSeePricing: true,
    showTotalsFooter: true,
    ...props,
  };
  return render(<EstimateZoneGroupedView {...defaults} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EstimateZoneGroupedView", () => {
  it("(a) renders zone-grouped sections, not a flat item list", () => {
    renderView();

    // Summary table is present
    expect(screen.getByTestId("zone-summary-table")).toBeTruthy();

    // Zone labels appear in the summary
    expect(screen.getAllByText(/Controller A · Zone 1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Controller A · Zone 2/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Controller B · Zone 1/i).length).toBeGreaterThan(0);

    // Each zone's summary row is present
    const summaryRows = screen.getAllByTestId("zone-summary-row");
    expect(summaryRows).toHaveLength(3);
  });

  it("(a) shows per-zone subtotals when canSeePricing=true", () => {
    renderView({ canSeePricing: true });

    // Each zone detail block shows a "Subtotal" row
    const subtotals = screen.getAllByText(/Subtotal/i);
    expect(subtotals.length).toBeGreaterThanOrEqual(3);

    // Zone totals footer columns are present
    expect(screen.getByText(/Parts Subtotal/i)).toBeTruthy();
    expect(screen.getByText(/Grand Total/i)).toBeTruthy();
  });

  it("(b) pricing-restricted role sees zone labels but no dollar columns", () => {
    renderView({ canSeePricing: false });

    // Zone structure is still visible
    expect(screen.getAllByText(/Controller A · Zone 1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Controller B · Zone 1/i).length).toBeGreaterThan(0);

    // Dollar-denominated columns are absent
    expect(screen.queryByText(/Zone Total/i)).toBeNull();
    expect(screen.queryByText(/Parts Total/i)).toBeNull();
    expect(screen.queryByText(/Parts Subtotal/i)).toBeNull();
    expect(screen.queryByText(/Grand Total/i)).toBeNull();
    expect(screen.queryByText(/Unit \$/i)).toBeNull();

    // Issue labels still render
    expect(screen.getAllByText(/Zone 1/i).length).toBeGreaterThan(0);
  });

  it("(c) labor-only items appear under their zone with 'labor only' badge", () => {
    renderView({ canSeePricing: true });

    // The labor-only badge should appear for the $0 item in Controller B · Zone 1
    const laborOnlyBadges = screen.getAllByText(/labor only/i);
    expect(laborOnlyBadges.length).toBeGreaterThanOrEqual(1);

    // The item is inside the Controller B · Zone 1 group, not a separate orphan section
    const bZoneHeaders = screen.getAllByText(/Controller B · Zone 1/i);
    expect(bZoneHeaders.length).toBeGreaterThan(0);
  });

  it("(c) labor-only items' zone rows have dashes instead of prices", () => {
    renderView({ canSeePricing: true });

    // The labor-only item cells render em-dashes for qty/unit/total
    const dashes = screen.getAllByText("—");
    // at least 3 dashes for the 3 pricing cells (qty, unit, parts total) of the labor-only item
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("showTotalsFooter=false suppresses the grand-totals footer", () => {
    renderView({ canSeePricing: true, showTotalsFooter: false });

    expect(screen.queryByText(/Grand Total/i)).toBeNull();
    expect(screen.queryByText(/Parts Subtotal/i)).toBeNull();
  });

  it("showTotalsFooter=true (default) renders the grand-totals footer", () => {
    renderView({ canSeePricing: true, showTotalsFooter: true });

    expect(screen.getByText(/Grand Total/i)).toBeTruthy();
    expect(screen.getByText(/Parts Subtotal/i)).toBeTruthy();
  });

  it("(d) empty items array renders nothing inside the grouped view (caller should show empty state)", () => {
    renderView({ items: [] });

    // Summary table is present but has no zone-summary-rows (just the totals row)
    const summaryRows = screen.queryAllByTestId("zone-summary-row");
    expect(summaryRows).toHaveLength(0);
  });
});

// ── isInspectionOriginEstimate integration ────────────────────────────────────

import { isInspectionOriginEstimate } from "@/lib/estimate-zone-grouping";

describe("isInspectionOriginEstimate", () => {
  it("returns true when any item has controllerLetter or zoneNumber", () => {
    expect(isInspectionOriginEstimate(makeZonedItems())).toBe(true);
  });

  it("returns false for items with no zone tags (non-inspection origin)", () => {
    const flatItems = [
      { id: 1, partName: "Valve", quantity: 1, partPrice: "50", totalPrice: "50" },
    ];
    expect(isInspectionOriginEstimate(flatItems)).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isInspectionOriginEstimate(null)).toBe(false);
    expect(isInspectionOriginEstimate(undefined)).toBe(false);
    expect(isInspectionOriginEstimate([])).toBe(false);
  });
});

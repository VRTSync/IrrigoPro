import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZoneStatusGrid, type ZoneRecordWithFindings } from "./ZoneStatusGrid";
import type { CustomerController } from "@/lib/controller-types";

const controller: CustomerController = {
  id: 1, companyId: 1, customerId: 7, branchName: null,
  controllerLetter: "A", zoneCount: 12, notes: null,
};
const zones = [
  { id: 101, zoneNumber: 1, name: "Zone 1", setUp: false },
  { id: 103, zoneNumber: 3, name: "Front Lawn", setUp: true },
];

describe("record-backed wet-check grid", () => {
  it("renders current records, numbers only, with unchanged IDs and click arguments", () => {
    const onCellClick = vi.fn();
    render(<ZoneStatusGrid controllers={[{ ...controller, zones }]} zoneRecords={[]} onCellClick={onCellClick} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    const named = screen.getByTestId("grid-zone-A-3");
    expect(named).toHaveAccessibleName("Controller A Zone 3 · Front Lawn — not checked");
    expect(named).toHaveAttribute("title", "Controller A Zone 3 · Front Lawn — not checked");
    expect(named.textContent).toBe("3");
    expect(screen.getByTestId("grid-zone-A-1")).toHaveAccessibleName("Controller A Zone 1 — not checked");
    expect(screen.queryByTestId("grid-zone-A-2")).not.toBeInTheDocument();
    fireEvent.click(named);
    expect(onCellClick).toHaveBeenCalledWith("A", 3);
  });

  it("preserves record lookup, status style, active ring, photo and completion badges", () => {
    const record = {
      id: 50, controllerLetter: "A", zoneNumber: 3, status: "checked_with_issues",
      markedCompleteAt: "2026-10-13", findings: [{ id: 60 }],
    } as unknown as ZoneRecordWithFindings;
    render(<ZoneStatusGrid controllers={[{ ...controller, zones }]} zoneRecords={[record]}
      activeLetter="A" activeZone={3} showPhotoCounts
      photos={[{ zoneRecordId: 50, findingId: null }, { zoneRecordId: null, findingId: 60 }]} />);
    const cell = screen.getByTestId("grid-zone-A-3");
    expect(cell).toHaveAccessibleName("Controller A Zone 3 · Front Lawn — checked_with_issues");
    expect(cell).toHaveClass("bg-amber-500", "ring-blue-500");
    expect(cell.querySelector(".lucide-circle-check")).not.toBeNull();
    expect(cell.querySelector(".lucide-camera")?.parentElement).toHaveTextContent("2");
  });

  it("uses the count when zones are missing from an older response", () => {
    render(<ZoneStatusGrid controllers={[{ ...controller, zoneCount: 3 }]} zoneRecords={[]} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByTestId("grid-zone-A-3")).toHaveAccessibleName("Controller A Zone 3 — not checked");
  });

  it("renders no cells for an explicitly empty zones array despite a positive mirror", () => {
    render(<ZoneStatusGrid controllers={[{ ...controller, zones: [] }]} zoneRecords={[]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders records with a null mirror and preserves placeholder labels regardless of their text", () => {
    render(<ZoneStatusGrid controllers={[{ ...controller, zoneCount: null, zones: [{ ...zones[0], name: "Ignored", setUp: false }] }]} zoneRecords={[]} />);
    expect(screen.getByTestId("grid-zone-A-1")).toHaveAccessibleName("Controller A Zone 1 — not checked");
  });
});

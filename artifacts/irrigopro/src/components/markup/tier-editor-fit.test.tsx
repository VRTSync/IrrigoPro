import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TierEditor } from "./tier-editor";

it("lets tier inputs fit their columns without a scrolling table wrapper", () => {
  render(
    <TierEditor
      idPrefix="fit"
      drafts={[
        { maxCost: "25", markupPercent: "100" },
        { maxCost: "", markupPercent: "65" },
      ]}
    />,
  );

  expect(screen.getByTestId("table-tiers-fit").parentElement).not.toHaveClass("overflow-x-auto");
  expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  for (const label of ["Tier 1 upper bound", "Tier 1 markup percent"]) {
    expect(screen.getByRole("spinbutton", { name: label })).toHaveClass("w-full", "min-w-[72px]");
  }
});

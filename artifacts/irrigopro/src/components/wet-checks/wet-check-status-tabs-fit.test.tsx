import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WetCheckFilterBar } from "./wet-check-filter-bar";

it("wraps all five status chips without a scrolling strip", () => {
  render(
    <WetCheckFilterBar
      status="all"
      onStatusChange={vi.fn()}
      customer=""
      onCustomerChange={vi.fn()}
      tech=""
      onTechChange={vi.fn()}
    />,
  );

  const chips = ["needsReview", "inProgress", "readyToBill", "billed", "all"]
    .map((status) => screen.getByTestId(`tab-wc-status-${status}`));
  const row = chips[0].parentElement!;
  expect(row).toHaveClass("flex-wrap");
  expect(row).not.toHaveClass("overflow-x-auto");
  expect(row.parentElement).toHaveClass("flex-1 min-w-0", { exact: true });
  for (const chip of chips) {
    expect(chip.parentElement).toBe(row);
    expect(chip).toHaveClass("whitespace-nowrap");
    expect(chip).toBeVisible();
  }
  expect(screen.getByTestId("button-wc-more-filters-toggle")).toBeVisible();
});

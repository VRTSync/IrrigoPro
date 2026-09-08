import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BudgetBar } from "./BudgetBar";

describe("BudgetBar", () => {
  it("clamps invoiced and pending segments to the allocation width", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={80} pendingAmount={50} allocation={100} />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(container.querySelector('[style*="width: 80%"]')).toBeInTheDocument();
    expect(
      container.querySelector('[style*="left: 80%"][style*="width: 20%"]'),
    ).toBeInTheDocument();
  });

  it("shows crew-friendly status only, without dollars or percentage text", () => {
    const { container } = render(
      <BudgetBar
        invoicedAmount={125}
        pendingAmount={0}
        allocation={100}
        forcedStatus="over"
        hideDollars
      />,
    );

    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
  });
});
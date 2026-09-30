import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KpiBand } from "./financial-pulse";

describe("Financial Pulse period badge", () => {
  it("updates Profit Margin's badge when MTD switches to YTD", () => {
    const view = render(
      <TooltipProvider>
        <KpiBand data={undefined} period="mtd" isLoading={false} isError={false} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("kpi-gross-margin-window-badge").textContent).toBe("MTD");
    view.rerender(
      <TooltipProvider>
        <KpiBand data={undefined} period="ytd" isLoading={false} isError={false} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("kpi-gross-margin-window-badge").textContent).toBe("YTD");
  });
});
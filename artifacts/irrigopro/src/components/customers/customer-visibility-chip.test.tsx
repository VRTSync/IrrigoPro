import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CustomerVisibilityChip } from "./customer-visibility-chip";

afterEach(cleanup);
describe("CustomerVisibilityChip", () => {
  it("shows Hidden with QuickBooks provenance and slate styling", () => {
    render(<CustomerVisibilityChip customer={{ hiddenFromBilling: true, hiddenByQuickbooks: true }} />);
    expect(screen.getByText("Hidden").title).toBe("Inactive in QuickBooks");
    expect(screen.getByText("Hidden").className).toContain("bg-slate-100");
    expect(screen.queryByText("Active")).toBeNull();
  });
  it("shows Visible with green styling and no inactive tooltip", () => {
    render(<CustomerVisibilityChip customer={{ hiddenFromBilling: false, hiddenByQuickbooks: false }} />);
    expect(screen.getByText("Visible").className).toContain("bg-green-100");
    expect(screen.getByText("Visible").hasAttribute("title")).toBe(false);
    expect(screen.queryByText("Active")).toBeNull();
  });
  it("does not attribute a person's hiding choice to QuickBooks", () => {
    render(<CustomerVisibilityChip customer={{ hiddenFromBilling: true, hiddenByQuickbooks: false }} />);
    expect(screen.getByText("Hidden").hasAttribute("title")).toBe(false);
  });
});

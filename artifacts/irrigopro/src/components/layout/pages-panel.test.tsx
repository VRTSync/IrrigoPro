import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PagesPanel } from "./pages-panel";
import { findActivePage, navForRole } from "./nav-config";
import { NAV_PIN_LIMIT, navPinsKey, useNavPins } from "./nav-pins";

const sections = navForRole("company_admin");

function Panel({ sectionId = "field" }: { sectionId?: string }) {
  const pins = useNavPins(12, "company_admin");
  return (
    <PagesPanel
      section={sections.find(({ id }) => id === sectionId)!}
      activePage={findActivePage(sections, "/work-orders")}
      badges={{ estimatesPendingApproval: 4 }}
      pins={pins}
    />
  );
}

beforeEach(() => localStorage.clear());

describe("desktop pages panel", () => {
  it("shows named groups, the active link and page badges", () => {
    render(<Panel />);
    const panel = within(screen.getByRole("navigation", { name: "Field Work" }));
    expect(panel.getByRole("heading", { name: "Plan" })).toBeVisible();
    expect(panel.getByRole("heading", { name: "In the field" })).toBeVisible();
    expect(panel.getByRole("link", { name: "Work Orders" })).toHaveAttribute("aria-current", "page");
    const estimates = panel.getByRole("link", { name: "Estimates" });
    expect(estimates).not.toHaveAttribute("aria-current");
    expect(within(estimates).getByText("4")).toBeVisible();
  });

  it("toggles the star, its pressed state, and its accessible name", () => {
    render(<Panel />);
    const star = screen.getByRole("button", { name: "Pin Work Orders" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    const pinnedStar = screen.getByRole("button", { name: "Unpin Work Orders" });
    expect(pinnedStar).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pinnedStar);
    expect(screen.getByRole("button", { name: "Pin Work Orders" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not put a star on Dashboard", () => {
    render(<Panel sectionId="dashboard" />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("at the limit only lets the user unpin pages", () => {
    const ids = sections.flatMap(({ pages }) => pages.map(({ id }) => id)).filter((id) => id !== "dashboard");
    localStorage.setItem(navPinsKey(12), JSON.stringify(ids.slice(0, NAV_PIN_LIMIT)));
    render(<Panel />);
    const unpin = screen.getByRole("button", { name: "Unpin Work Orders" });
    expect(unpin).toBeEnabled();
    for (const button of screen.getAllByRole("button", { name: /^Unpin / })) expect(button).toBeEnabled();
    // Showing another section also obeys the same per-user limit.
    render(<Panel sectionId="parts" />);
    const pin = screen.getByRole("button", { name: "Pin Parts Catalog" });
    expect(pin).toBeDisabled();
    expect(pin).toHaveAttribute("title", "Up to 8 pinned pages");
  });
});

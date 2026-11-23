import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./nav-rail";
import { findActivePage, navForRole, type NavBadgeMap } from "./nav-config";

function mount(role = "company_admin", badges: NavBadgeMap = {}) {
  const sections = navForRole(role);
  const onSelectSection = vi.fn();
  render(
    <NavRail
      sections={sections}
      activePage={findActivePage(sections, "/invoices")}
      badges={badges}
      brandThemed={role !== "super_admin"}
      user={{ name: "Test User", role }}
      onSelectSection={onSelectSection}
    />,
  );
  return { rail: screen.getByRole("navigation", { name: "Desktop sections" }), onSelectSection };
}

describe("desktop section rail", () => {
  it("orders the company admin sections and puts Settings in the bottom group", () => {
    const { rail, onSelectSection } = mount();
    expect(rail).toHaveClass("nav-rail-brand");
    expect(within(rail).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Dashboard", "Field", "Approvals", "Billing", "Clients", "Insights", "Parts", "Settings", "Account"]);
    expect(within(screen.getByTestId("nav-rail-bottom")).getByRole("button", { name: "Settings" })).toBeVisible();
    expect(within(rail).getByRole("link", { name: "IrrigoPro" })).toHaveAttribute("href", "/");
    const billing = within(rail).getByRole("button", { name: "Billing" });
    expect(billing).toHaveAttribute("aria-current", "true");
    fireEvent.click(billing);
    expect(onSelectSection).toHaveBeenCalledWith("billing");
  });

  it.each([7, 103])("shows role-visible badge sums and caps the label for %s overdue invoices", (overdueInvoices) => {
    mount("company_admin", { overdueInvoices, partsPendingApproval: 2 });
    expect(screen.getByTestId("nav-rail-badge-billing")).toHaveTextContent(overdueInvoices > 99 ? "99+" : "7");
    expect(screen.getByTestId("nav-rail-badge-parts")).toHaveTextContent("2");
    expect(screen.queryByTestId("nav-rail-badge-settings")).not.toBeInTheDocument();
  });

  it("keeps the super-admin rail plain and links the mark to App Health", () => {
    const { rail } = mount("super_admin");
    expect(rail).not.toHaveClass("nav-rail-brand");
    expect(within(rail).getByRole("link", { name: "IrrigoPro" })).toHaveAttribute("href", "/super-admin/app-health");
    expect(within(rail).queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("keeps the current account actions without restoring Switch User", async () => {
    const { rail } = mount();
    fireEvent.keyDown(within(rail).getByRole("button", { name: "Account" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("data-side", "right");
    expect(within(menu).getByRole("menuitem", { name: "My Account" })).toHaveAttribute("href", "/user-profile");
    expect(within(menu).getByRole("menuitem", { name: "Logout" })).toBeVisible();
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./nav-rail";
import { findActivePage, navForRole, type NavBadgeMap } from "./nav-config";

function mount(role = "company_admin", badges: NavBadgeMap = {}, expanded = false) {
  const sections = navForRole(role);
  const onSelectSection = vi.fn();
  const onCollapse = vi.fn();
  render(
    <NavRail
      sections={sections}
      activePage={findActivePage(sections, expanded ? "/work-orders" : "/invoices")}
      badges={badges}
      brandThemed={role !== "super_admin"}
      user={{ name: "Test User", role }}
      onSelectSection={onSelectSection}
      expanded={expanded}
      onCollapse={onCollapse}
    />,
  );
  return { rail: screen.getByRole("navigation", { name: "Desktop sections" }), onSelectSection, onCollapse };
}

describe("desktop section rail", () => {
  it("widens the same rail to show full section names, not pages", async () => {
    const { rail, onSelectSection, onCollapse } = mount("company_admin", { estimatesPendingApproval: 103 }, true);
    const nav = within(rail);
    const labels = ["Dashboard", "Field Work", "Approvals", "Billing", "Customers", "Insights", "Parts", "Settings"];
    const sections = nav.getAllByRole("button").filter((button) => labels.includes(button.getAttribute("aria-label") ?? ""));
    expect(sections.map((button) => button.getAttribute("aria-label"))).toEqual(labels);
    sections.forEach((button, index) => expect(within(button).getByText(labels[index])).toBeVisible());
    expect(within(screen.getByTestId("nav-rail-bottom")).getByRole("button", { name: "Settings" })).toBeVisible();
    expect(nav.queryByText("Work Orders")).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "IrrigoPro" })).toHaveAttribute("href", "/");
    const field = nav.getByRole("button", { name: "Field Work" });
    expect(field).toHaveAttribute("aria-current", "true");
    expect(within(field).getByTestId("nav-rail-badge-field")).toHaveTextContent("99+");
    fireEvent.click(field);
    expect(onSelectSection).toHaveBeenCalledWith("field");
    fireEvent.click(nav.getByRole("button", { name: "Collapse menu" }));
    expect(onCollapse).toHaveBeenCalledOnce();
    const account = nav.getByRole("button", { name: "Account" });
    expect(within(account).getByText("Test User")).toBeVisible();
    expect(within(account).getByText("company admin")).toBeVisible();
    fireEvent.keyDown(account, { key: "Enter" });
    expect(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "My Account" })).toBeVisible();
  });

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

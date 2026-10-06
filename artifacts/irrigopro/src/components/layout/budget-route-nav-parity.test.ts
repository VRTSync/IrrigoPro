import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAN_VIEW_ACTION_BOARD, CAN_VIEW_BUDGETS, hasCapability } from "@workspace/shared";

import {
  billingManagerNav,
  bookkeeperNav,
  companyAdminNav,
  managerNav,
  superAdminNav,
  type NavConfig,
  type NavItem,
} from "./nav-config";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const companyAdminSource = readFileSync(
  resolve(process.cwd(), "src/components/company-admin-app.tsx"),
  "utf8",
);

function hasBudgetLeaf(config: NavConfig): boolean {
  const visit = (items: NavItem[]): boolean =>
    items.some((item) =>
      item.type === "leaf" ? item.path === "/budget-status" : visit(item.items),
    );
  return visit(config.items);
}

function hasActionBoardLeaf(config: NavConfig): boolean {
  const visit = (items: NavItem[]): boolean =>
    items.some((item) =>
      item.type === "leaf" ? item.path === "/action-board" : visit(item.items),
    );
  return visit(config.items);
}

function roleBlock(role: string): string {
  const marker = `if (user.role === "${role}")`;
  const start = appSource.indexOf(marker);
  expect(start, `${role} role block must exist`).toBeGreaterThanOrEqual(0);
  const next = appSource.indexOf("if (user.role ===", start + marker.length);
  return appSource.slice(start, next < 0 ? appSource.length : next);
}

describe("Budget Status route and navigation parity", () => {
  it.each([
    ["billing_manager", billingManagerNav],
    ["irrigation_manager", managerNav],
  ] as const)("%s has both the capability, route, and nav leaf", (role, nav) => {
    expect(hasCapability(role, CAN_VIEW_BUDGETS)).toBe(true);
    expect(roleBlock(role)).toContain('<Route path="/budget-status"');
    expect(hasBudgetLeaf(nav)).toBe(true);
  });

  it("company_admin has both the capability, route, and nav leaf", () => {
    expect(hasCapability("company_admin", CAN_VIEW_BUDGETS)).toBe(true);
    expect(companyAdminSource).toContain('<Route path="/budget-status"');
    expect(hasBudgetLeaf(companyAdminNav)).toBe(true);
  });

  it("bookkeeper has neither capability, route, nor nav leaf", () => {
    expect(hasCapability("bookkeeper", CAN_VIEW_BUDGETS)).toBe(false);
    expect(roleBlock("bookkeeper")).not.toContain('<Route path="/budget-status"');
    expect(hasBudgetLeaf(bookkeeperNav)).toBe(false);
  });

  it("field_tech has neither capability nor route", () => {
    expect(hasCapability("field_tech", CAN_VIEW_BUDGETS)).toBe(false);
    expect(roleBlock("field_tech")).not.toContain('<Route path="/budget-status"');
  });

  it("records the deliberate super_admin route-without-leaf asymmetry", () => {
    expect(hasCapability("super_admin", CAN_VIEW_BUDGETS)).toBe(true);
    expect(roleBlock("super_admin")).toContain('<Route path="/budget-status"');
    expect(hasBudgetLeaf(superAdminNav)).toBe(false);
  });
});

describe("Action Board route and navigation parity", () => {
  it.each([
    ["irrigation_manager", managerNav],
  ] as const)("%s has route and nav leaf", (role, nav) => {
    expect(hasCapability(role, CAN_VIEW_ACTION_BOARD)).toBe(true);
    expect(roleBlock(role)).toContain('<Route path="/action-board"');
    expect(hasActionBoardLeaf(nav)).toBe(true);
  });

  it("company_admin has route and nav leaf", () => {
    expect(hasCapability("company_admin", CAN_VIEW_ACTION_BOARD)).toBe(true);
    expect(companyAdminSource).toContain('<Route path="/action-board"');
    expect(hasActionBoardLeaf(companyAdminNav)).toBe(true);
  });

  it("super_admin has the route but deliberate route-without-leaf asymmetry", () => {
    expect(hasCapability("super_admin", CAN_VIEW_ACTION_BOARD)).toBe(true);
    expect(roleBlock("super_admin")).toContain('<Route path="/action-board"');
    expect(hasActionBoardLeaf(superAdminNav)).toBe(false);
  });

  it("bookkeeper and field_tech cannot reach Action Board", () => {
    expect(hasCapability("bookkeeper", CAN_VIEW_ACTION_BOARD)).toBe(false);
    expect(hasCapability("field_tech", CAN_VIEW_ACTION_BOARD)).toBe(false);
    expect(roleBlock("bookkeeper")).not.toContain('<Route path="/action-board"');
    expect(hasActionBoardLeaf(bookkeeperNav)).toBe(false);
    expect(roleBlock("field_tech")).not.toContain('<Route path="/action-board"');
  });

  it("billing managers keep budget and financial access but cannot reach Action Board", () => {
    expect(hasCapability("billing_manager", CAN_VIEW_ACTION_BOARD)).toBe(false);
    expect(hasCapability("billing_manager", CAN_VIEW_BUDGETS)).toBe(true);
    expect(roleBlock("billing_manager")).not.toContain('<Route path="/action-board"');
    expect(roleBlock("billing_manager")).toContain('<Route path="/financial-pulse"');
    expect(hasActionBoardLeaf(billingManagerNav)).toBe(false);
  });

  it.each([undefined, null, "unknown"])("fails closed for role %s", (role) => {
    expect(hasCapability(role, CAN_VIEW_ACTION_BOARD)).toBe(false);
  });
});

describe("Bookkeeper location audit direct routes", () => {
  it("keeps the audit report and exact-record read-only projections, not ticket editors", () => {
    const routes = roleBlock("bookkeeper");
    expect(routes).toContain('<Route path="/reports/missing-location-data" component={MissingLocationDataReportPage}');
    expect(routes).toMatch(/<Route path="\/work-orders">\s*\{\(\) => <MissingLocationTicketDetail ticketType="work_order" \/>\}/);
    expect(routes).toMatch(/<Route path="\/billing-sheets">\s*\{\(\) => <MissingLocationTicketDetail ticketType="billing_sheet" \/>\}/);
    expect(routes).not.toContain('component={WorkOrders}');
    expect(routes).not.toContain('component={BillingSheets}');
  });
});
import { describe, expect, it } from "vitest";
import { CAN_READ_INVOICES, CAN_READ_LOCATION_REPORT, hasCapability } from "@workspace/shared";
import { NAV_SECTIONS, navForRole, type NavRole } from "./nav-config";

const roles = {
  c: "company_admin",
  i: "irrigation_manager",
  b: "billing_manager",
  k: "bookkeeper",
  s: "super_admin",
} as const satisfies Record<string, NavRole>;
type RoleCode = keyof typeof roles;

// Locked navigation table, in section and page order. The last column covers
// the per-role Estimates paths; every other row has one shared href.
const table: [sectionId: string, pageId: string, href: string, roles: string, overrides?: Partial<Record<RoleCode, string>>][] = [
  ["platform", "app-health", "/super-admin/app-health", "s"],
  ["platform", "companies", "/super-admin", "s"],
  ["platform", "client-errors", "/admin/client-errors", "s"],
  ["platform", "loose-photos", "/super-admin/loose-photos", "s"],
  ["dashboard", "dashboard", "/", "cibk"],
  ["users", "all-users", "/system-users", "s"],
  ["field", "action-board", "/action-board", "ci"],
  ["field", "estimates", "/estimates", "cib", { c: "/estimates/command-center", b: "/estimates/pending-approval" }],
  ["field", "wet-checks", "/wet-checks", "cibs"],
  ["field", "work-orders", "/work-orders", "cib"],
  ["field", "billing-sheets", "/billing-sheets", "cib"],
  ["approvals", "manager-workspace", "/manager-workspace", "cib"],
  ["approvals", "wet-check-reviews", "/wet-checks?tab=needs-review", "cib"],
  ["billing", "command-center", "/billing/command-center", "cb"],
  ["billing", "invoices", "/invoices", "cbk"],
  ["customers", "customers", "/customers", "cibk"],
  ["customers", "maps", "/site-maps", "ci"],
  ["insights", "budget-status", "/budget-status", "cib"],
  ["insights", "financial-pulse", "/financial-pulse", "cibs"],
  ["insights", "missing-photos-wo", "/work-orders/missing-photos", "cb"],
  ["insights", "missing-photos-bs", "/billing-sheets/missing-photos", "cb"],
  ["insights", "zero-price", "/billing-sheets/zero-price-audit", "cb"],
  ["insights", "labor-rate", "/billing-sheets/labor-rate-audit", "cb"],
  ["insights", "missing-location", "/reports/missing-location-data", "cibks"],
  ["insights", "wc-recon", "/admin/wet-check-reconciliation", "cs"],
  ["parts", "parts-catalog", "/parts", "cib"],
  ["parts", "parts-pending", "/parts-pending-approval", "cb"],
  ["parts", "markup", "/admin/markup-schedule", "cs"],
  ["parts", "parts-settings", "/parts-settings", "cib"],
  ["data", "db-migrations", "/admin/migrations", "s"],
  ["data", "wc-labor-backfill", "/admin/wc-labor-backfill", "s"],
  ["settings", "team", "/users", "c"],
  ["settings", "company-profile", "/company-profile", "c"],
  ["settings", "quickbooks", "/quickbooks", "cbks"],
  ["settings", "labor-rates", "/labor-rates", "c"],
  ["settings", "budget-goals", "/admin/budget-goals", "cs"],
  ["settings", "controllers", "/admin/controllers", "cs"],
  ["settings", "issue-types", "/admin/issue-types", "cbs"],
];

describe("shared navigation", () => {
  it.each(Object.keys(roles) as RoleCode[])("matches the locked page order and hrefs for role %s", (code) => {
    const sections = navForRole(roles[code]);
    expect(sections.flatMap(({ pages }) => pages.map(({ sectionId, id, href }) => [sectionId, id, href])))
      .toEqual(table.filter(([, , , codes]) => codes.includes(code))
        .map(([section, page, href, , overrides]) => [section, page, overrides?.[code] ?? href]));
    for (const { groups, pages } of sections) {
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((group) => group.pages.length > 0)).toBe(true);
      expect(groups.flatMap((group) => group.pages)).toEqual(pages);
    }
  });

  it.each(Object.values(roles))("aligns report visibility and invoice badges with capabilities for %s", (role) => {
    const pages = navForRole(role).flatMap(({ pages }) => pages);
    expect(pages.some(({ href }) => href === "/reports/missing-location-data"))
      .toBe(hasCapability(role, CAN_READ_LOCATION_REPORT));
    const invoiceBadges = pages.filter(({ badgeKey }) => badgeKey === "overdueInvoices");
    expect(invoiceBadges.map(({ id }) => id)).toEqual(pages.some(({ id }) => id === "invoices") ? ["invoices"] : []);
    if (invoiceBadges.length) expect(hasCapability(role, CAN_READ_INVOICES)).toBe(true);
  });

  it("uses unique kebab-case page IDs and keeps rail labels short", () => {
    const ids = NAV_SECTIONS.flatMap(({ groups }) => groups.flatMap(({ pages }) => pages.map(({ id }) => id)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const { railLabel } of NAV_SECTIONS) expect(railLabel.length).toBeLessThanOrEqual(9);
  });

  it("keeps Data and Settings at the end without badge sums", () => {
    expect(NAV_SECTIONS.slice(-2).map(({ id, placement, showBadgeSum }) => [id, placement, showBadgeSum]))
      .toEqual([["data", "bottom", false], ["settings", "bottom", false]]);
  });

  it("provides a description for every section and page", () => {
    for (const section of NAV_SECTIONS) {
      expect(section.description.trim(), section.id).not.toBe("");
      for (const { pages } of section.groups) {
        for (const page of pages) expect(page.description.trim(), page.id).not.toBe("");
      }
    }
  });

  it.each(["field_tech", "system_documenter", "toString", "unknown", undefined])("has no desktop sections for %s", (role) => {
    expect(navForRole(role)).toEqual([]);
  });
});

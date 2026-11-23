import { describe, expect, it } from "vitest";
import { findActivePage, navForRole } from "./nav-config";
import { resolveRouteMeta } from "./route-meta";

const sections = navForRole("company_admin");

describe("active navigation page", () => {
  it.each([
    ["/wet-checks", "tab=needs-review", "wet-check-reviews"],
    ["/wet-checks", "filter=inspection&tab=needs-review", "wet-check-reviews"],
    ["/wet-checks", "", "wet-checks"],
    ["/wet-checks", "tab=approved", "wet-checks"],
    ["/wet-checks/12", "tab=needs-review", "wet-checks"],
    ["/work-orders/missing-photos", "", "missing-photos-wo"],
    ["/customers/12/profile", "", "customers"],
    ["/customers-old", "", undefined],
    ["/not-in-nav", "", undefined],
    ["/", "", "dashboard"],
  ])("selects the right page at %s with query %s", (path, search, id) => {
    expect(findActivePage(sections, path, search)?.id).toBe(id);
  });

  it("does not highlight a reviews link the role cannot see", () => {
    expect(findActivePage(navForRole("super_admin"), "/wet-checks", "tab=needs-review")?.id).toBe("wet-checks");
  });
});

describe("navigation breadcrumbs", () => {
  it("uses only the Dashboard label for the root", () => {
    expect(resolveRouteMeta("/", sections)).toEqual({
      title: "Dashboard",
      breadcrumb: [{ label: "Dashboard" }],
    });
  });

  it("uses the section and page from the active query-specific destination", () => {
    expect(resolveRouteMeta("/wet-checks", sections, "tab=needs-review")).toEqual({
      title: "Wet Check Reviews",
      breadcrumb: [{ label: "Approvals" }, { label: "Wet Check Reviews" }],
    });
  });

  it("preserves wet-check detail breadcrumbs and canonical return links", () => {
    expect(resolveRouteMeta("/wet-checks/12", sections).breadcrumb).toEqual([
      { label: "Field Work" }, { label: "Wet Checks", path: "/wet-checks" }, { label: "Detail" },
    ]);
    expect(resolveRouteMeta("/wet-checks/12/review", sections).breadcrumb).toEqual([
      { label: "Approvals" }, { label: "Wet Check Reviews", path: "/wet-checks?tab=needs-review" }, { label: "Detail" },
    ]);
  });
});

import { Home } from "lucide-react";
import { describe, expect, it } from "vitest";
import { navItemsForRole } from "./navigation";

describe("standalone navigation links", () => {
  it.each(["unrecognized", undefined])("offers only Dashboard for %s", (role) => {
    expect(navItemsForRole(role)).toEqual([{ path: "/", label: "Dashboard", icon: Home, isCenter: true }]);
  });

  it("preserves the five field-tech quick links and their order", () => {
    expect(navItemsForRole("field_tech").map(({ path, label, isCenter }) => [path, label, !!isCenter])).toEqual([
      ["/work-orders", "Work Orders", false],
      ["/wet-checks", "Wet Checks", false],
      ["/", "Home", true],
      ["/billing-sheets", "Onsite", false],
      ["/customers", "Customers", false],
    ]);
  });
});

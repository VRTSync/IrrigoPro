/**
 * nav-config.test.ts (Task #803 — Slice 7, extended in Task #1004 — Slice 5,
 * updated in Task #1321 — removed stale Wet Check Reviews / Billings entries)
 *
 * Asserts that the Wet Check group is present in billingManagerNav,
 * companyAdminNav, superAdminNav, and managerNav, and that wet-check leaf
 * paths have been removed from the Operations group in each config.
 *
 * Also asserts managerNav omits admin-only paths.
 */

import { describe, it, expect } from "vitest";
import {
  billingManagerNav,
  companyAdminNav,
  superAdminNav,
  managerNav,
  type NavConfig,
  type NavGroup,
  type NavLeaf,
  type NavItem,
} from "./nav-config";

const WET_CHECK_PATHS = ["/wet-checks"];

function findGroup(config: NavConfig, label: string): NavGroup | undefined {
  return config.items.find(
    (item): item is NavGroup => item.type === "group" && item.label === label,
  );
}

function leafPaths(group: NavGroup): string[] {
  return group.items
    .filter((item): item is NavLeaf => item.type === "leaf")
    .map((item) => item.path);
}

function collectAllLeafPaths(items: NavItem[]): string[] {
  const paths: string[] = [];
  for (const item of items) {
    if (item.type === "leaf") {
      paths.push(item.path);
    } else {
      paths.push(...collectAllLeafPaths(item.items));
    }
  }
  return paths;
}

describe("nav-config Wet Check group (Task #803)", () => {
  for (const [name, config] of [
    ["billingManagerNav", billingManagerNav],
    ["companyAdminNav", companyAdminNav],
    ["superAdminNav", superAdminNav],
    ["managerNav", managerNav],
  ] as const) {
    describe(name, () => {
      it("has a top-level Wet Check group", () => {
        const group = findGroup(config, "Wet Check");
        expect(group).toBeDefined();
        expect(group!.type).toBe("group");
      });

      it("Wet Check group has exactly one leaf", () => {
        const group = findGroup(config, "Wet Check")!;
        const leaves = leafPaths(group);
        expect(leaves).toHaveLength(1);
      });

      it("Wet Check group contains /wet-checks only", () => {
        const group = findGroup(config, "Wet Check")!;
        const leaves = leafPaths(group);
        expect(leaves).toContain("/wet-checks");
        expect(leaves).not.toContain("/wet-checks/pending-review");
        expect(leaves).not.toContain("/wet-check-billings");
      });

      it("Operations group does not contain wet-check leaf paths", () => {
        const opsGroup = findGroup(config, "Operations");
        if (!opsGroup) return;
        const ops = leafPaths(opsGroup);
        for (const path of WET_CHECK_PATHS) {
          expect(ops).not.toContain(path);
        }
      });
    });
  }
});

describe("managerNav — omits admin-only paths (Task #1004)", () => {
  it("does not contain /admin/quickbooks", () => {
    const all = collectAllLeafPaths(managerNav.items);
    expect(all).not.toContain("/admin/quickbooks");
  });

  it("does not contain /admin/migrate-wet-check", () => {
    const all = collectAllLeafPaths(managerNav.items);
    expect(all).not.toContain("/admin/migrate-wet-check");
  });

  it("includes /wet-checks in wetCheckGroup", () => {
    const all = collectAllLeafPaths(managerNav.items);
    expect(all).toContain("/wet-checks");
  });

  it("does not include stale /wet-checks/pending-review or /wet-check-billings", () => {
    const all = collectAllLeafPaths(managerNav.items);
    expect(all).not.toContain("/wet-checks/pending-review");
    expect(all).not.toContain("/wet-check-billings");
  });

  it("includes Operations group with work orders and billing sheets", () => {
    const all = collectAllLeafPaths(managerNav.items);
    expect(all).toContain("/work-orders");
    expect(all).toContain("/billing-sheets");
  });

  it("includes Parts group", () => {
    const all = collectAllLeafPaths(managerNav.items);
    expect(all).toContain("/parts");
  });
});

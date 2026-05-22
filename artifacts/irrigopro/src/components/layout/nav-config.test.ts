/**
 * nav-config.test.ts (Task #803 — Slice 7)
 *
 * Asserts that the Wet Check group is present in billingManagerNav,
 * companyAdminNav, and superAdminNav, and that wet-check leaf paths
 * have been removed from the Operations group in each config.
 */

import { describe, it, expect } from "vitest";
import {
  billingManagerNav,
  companyAdminNav,
  superAdminNav,
  type NavConfig,
  type NavGroup,
  type NavLeaf,
} from "./nav-config";

const WET_CHECK_PATHS = [
  "/wet-checks",
  "/wet-checks/pending-review",
  "/wet-check-billings",
];

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

describe("nav-config Wet Check group (Task #803)", () => {
  for (const [name, config] of [
    ["billingManagerNav", billingManagerNav],
    ["companyAdminNav", companyAdminNav],
    ["superAdminNav", superAdminNav],
  ] as const) {
    describe(name, () => {
      it("has a top-level Wet Check group", () => {
        const group = findGroup(config, "Wet Check");
        expect(group).toBeDefined();
        expect(group!.type).toBe("group");
      });

      it("Wet Check group has exactly three leaves", () => {
        const group = findGroup(config, "Wet Check")!;
        const leaves = leafPaths(group);
        expect(leaves).toHaveLength(3);
      });

      it("Wet Check group contains /wet-checks, /wet-checks/pending-review, /wet-check-billings", () => {
        const group = findGroup(config, "Wet Check")!;
        const leaves = leafPaths(group);
        expect(leaves).toContain("/wet-checks");
        expect(leaves).toContain("/wet-checks/pending-review");
        expect(leaves).toContain("/wet-check-billings");
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

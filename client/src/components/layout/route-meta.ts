import type { NavConfig, NavItem, NavGroup, NavLeaf } from "./nav-config";

export interface BreadcrumbSegment {
  label: string;
  path?: string;
}

export interface RouteMeta {
  title: string;
  breadcrumb: BreadcrumbSegment[];
}

function trimSlash(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function findLeaf(
  items: NavItem[],
  location: string,
  parents: NavGroup[],
): { leaf: NavLeaf; parents: NavGroup[] } | null {
  for (const item of items) {
    if (item.type === "leaf") {
      if (item.path === location) return { leaf: item, parents };
    } else {
      const found = findLeaf(item.items, location, [...parents, item]);
      if (found) return found;
    }
  }
  return null;
}

const FALLBACK_PATTERNS: Array<{ regex: RegExp; meta: () => RouteMeta }> = [
  {
    regex: /^\/customers\/[^/]+\/profile$/,
    meta: () => ({
      title: "Customer Profile",
      breadcrumb: [{ label: "Customers", path: "/customers" }, { label: "Profile" }],
    }),
  },
  {
    regex: /^\/customers\/[^/]+\/site-maps$/,
    meta: () => ({
      title: "Customer Site Maps",
      breadcrumb: [{ label: "Customers", path: "/customers" }, { label: "Site Maps" }],
    }),
  },
  {
    regex: /^\/wet-checks\/[^/]+\/review$/,
    meta: () => ({
      title: "Wet Check Review",
      breadcrumb: [
        { label: "Operations" },
        { label: "Wet Check Reviews", path: "/wet-checks/pending-review" },
        { label: "Detail" },
      ],
    }),
  },
  {
    regex: /^\/wet-checks\/[^/]+$/,
    meta: () => ({
      title: "Wet Check",
      breadcrumb: [
        { label: "Operations" },
        { label: "Wet Checks", path: "/wet-checks/admin" },
        { label: "Detail" },
      ],
    }),
  },
  {
    regex: /^\/user-profile$/,
    meta: () => ({ title: "My Account", breadcrumb: [{ label: "My Account" }] }),
  },
  {
    regex: /^\/switch-user$/,
    meta: () => ({ title: "Switch User", breadcrumb: [{ label: "Switch User" }] }),
  },
  {
    regex: /^\/license-agreement$/,
    meta: () => ({ title: "License Agreement", breadcrumb: [{ label: "License Agreement" }] }),
  },
  {
    regex: /^\/privacy-policy$/,
    meta: () => ({ title: "Privacy Policy", breadcrumb: [{ label: "Privacy Policy" }] }),
  },
  {
    regex: /^\/operations$/,
    meta: () => ({ title: "Operations", breadcrumb: [{ label: "Operations" }] }),
  },
  {
    regex: /^\/admin$/,
    meta: () => ({ title: "Dashboard", breadcrumb: [{ label: "Dashboard", path: "/" }] }),
  },
];

function humanize(seg: string): string {
  return seg
    .split("-")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function resolveRouteMeta(location: string, config: NavConfig): RouteMeta {
  const loc = trimSlash(location || "/");

  const found = findLeaf(config.items, loc, []);
  if (found) {
    const breadcrumb: BreadcrumbSegment[] = [
      ...found.parents.map((p) => ({ label: p.label })),
      { label: found.leaf.label, path: found.leaf.path },
    ];
    return { title: found.leaf.label, breadcrumb };
  }

  for (const { regex, meta } of FALLBACK_PATTERNS) {
    if (regex.test(loc)) return meta();
  }

  const segs = loc.split("/").filter(Boolean);
  const last = segs[segs.length - 1] || "Home";
  const label = humanize(last);
  return { title: label, breadcrumb: [{ label }] };
}

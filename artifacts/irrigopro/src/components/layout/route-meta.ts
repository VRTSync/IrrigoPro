import { findActivePage, type ResolvedNavSection } from "./nav-config";

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
        { label: "Approvals" },
        { label: "Wet Check Reviews", path: "/wet-checks?tab=needs-review" },
        { label: "Detail" },
      ],
    }),
  },
  {
    regex: /^\/wet-checks\/[^/]+$/,
    meta: () => ({
      title: "Wet Check",
      breadcrumb: [
        { label: "Field Work" },
        { label: "Wet Checks", path: "/wet-checks" },
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

export function resolveRouteMeta(
  location: string,
  sections: ResolvedNavSection[],
  search = "",
): RouteMeta {
  const loc = trimSlash(location || "/");
  const page = findActivePage(sections, loc, search);

  // A specific detail pattern takes precedence over a matching parent page,
  // but not over an exact configured destination (e.g. the Users shortcut).
  if (page?.path !== loc) {
    for (const { regex, meta } of FALLBACK_PATTERNS) {
      if (regex.test(loc)) return meta();
    }
  }

  if (page) {
    const section = sections.find(({ id }) => id === page.sectionId);
    const breadcrumb = [{ label: page.label }];
    if (section && section.id !== "dashboard") breadcrumb.unshift({ label: section.label });
    return { title: page.label, breadcrumb };
  }

  const segs = loc.split("/").filter(Boolean);
  const last = segs[segs.length - 1] || "Home";
  const label = humanize(last);
  return { title: label, breadcrumb: [{ label }] };
}

import {
  Activity, AlertTriangle, BarChart3, Building2, Calculator, ClipboardCheck,
  ClipboardList, Cpu, Database, DollarSign, Droplets, Home, ImageOff,
  LayoutDashboard, MapIcon, Package, Percent, Receipt, Scale, Settings,
  ShieldCheck, Users, Wrench, type LucideIcon,
} from "lucide-react";

export type NavRole =
  | "company_admin" | "irrigation_manager" | "billing_manager"
  | "bookkeeper" | "super_admin";

export type NavBadgeKey =
  | "partsPendingApproval" | "wetCheckReviews" | "estimatesPendingApproval"
  | "awaitingApproval" | "overdueInvoices";
export type NavBadgeMap = Partial<Record<NavBadgeKey, number>>;

export interface NavPage {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  paths: Partial<Record<NavRole, string>>;
  search?: string;
  badgeKey?: NavBadgeKey;
}

export interface NavPageGroup {
  label: string | null;
  pages: NavPage[];
}

export interface NavSection {
  id: string;
  label: string;
  railLabel: string;
  description: string;
  icon: LucideIcon;
  placement: "top" | "bottom";
  showBadgeSum: boolean;
  groups: NavPageGroup[];
}

export interface ResolvedNavPage extends Omit<NavPage, "paths"> {
  path: string;
  href: string;
  sectionId: string;
}

export interface ResolvedNavSection extends Omit<NavSection, "groups"> {
  groups: { label: string | null; pages: ResolvedNavPage[] }[];
  pages: ResolvedNavPage[];
}

const c = "company_admin";
const i = "irrigation_manager";
const b = "billing_manager";
const k = "bookkeeper";
const s = "super_admin";

function samePath(path: string, ...roles: NavRole[]): NavPage["paths"] {
  return Object.fromEntries(roles.map((role) => [role, path]));
}

// The locked role table governs destinations; the B2 mockup supplies the descriptions.
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "platform", label: "Platform", railLabel: "Platform",
    description: "Platform health and companies", icon: Activity, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "app-health", label: "App Health", description: "Uptime, errors and background jobs", icon: Activity, paths: samePath("/super-admin/app-health", s) },
      { id: "companies", label: "Companies", description: "Every company on the platform", icon: Building2, paths: samePath("/super-admin", s) },
      { id: "client-errors", label: "Client Errors", description: "Errors reported by browsers", icon: AlertTriangle, paths: samePath("/admin/client-errors", s) },
      { id: "loose-photos", label: "Loose Photos", description: "Photos not attached to a finding", icon: ImageOff, paths: samePath("/super-admin/loose-photos", s) },
    ] }],
  },
  {
    id: "dashboard", label: "Dashboard", railLabel: "Dashboard",
    description: "A looking glass over the whole app", icon: Home, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "dashboard", label: "Dashboard", description: "Built for your role", icon: Home, paths: samePath("/", c, i, b, k) },
    ] }],
  },
  {
    id: "users", label: "Users", railLabel: "Users",
    description: "People across every company", icon: Users, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "all-users", label: "All Users", description: "Every user across companies", icon: Users, paths: samePath("/system-users", s) },
    ] }],
  },
  {
    id: "field", label: "Field Work", railLabel: "Field",
    description: "Plan the work, then the three ways work gets done", icon: Droplets, placement: "top", showBadgeSum: true,
    groups: [
      { label: "Plan", pages: [
        { id: "action-board", label: "Action Board", description: "Morning dispatch: open work, wet checks due, budget", icon: ClipboardCheck, paths: samePath("/action-board", c, i) },
        {
          id: "estimates", label: "Estimates", description: "Quotes, including those from inspection wet checks", icon: LayoutDashboard,
          paths: { [c]: "/estimates/command-center", [i]: "/estimates", [b]: "/estimates/pending-approval" },
          badgeKey: "estimatesPendingApproval",
        },
      ] },
      { label: "In the field", pages: [
        { id: "wet-checks", label: "Wet Checks", description: "Service and inspection walks", icon: Droplets, paths: samePath("/wet-checks", c, i, b, s) },
        { id: "work-orders", label: "Work Orders", description: "Planned jobs, from estimates or direct", icon: Wrench, paths: samePath("/work-orders", c, i, b) },
        { id: "billing-sheets", label: "Billing Sheets", description: "On-site work done without a work order", icon: ClipboardList, paths: samePath("/billing-sheets", c, i, b) },
      ] },
    ],
  },
  {
    id: "approvals", label: "Approvals", railLabel: "Approvals",
    description: "Field work waiting for sign-off before billing", icon: ClipboardCheck, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "manager-workspace", label: "Manager Workspace", description: "Approve work orders and billing sheets", icon: LayoutDashboard, paths: samePath("/manager-workspace", c, i, b), badgeKey: "awaitingApproval" },
      {
        id: "wet-check-reviews", label: "Wet Check Reviews", description: "Opens Wet Checks on the Needs Review tab", icon: ClipboardCheck,
        paths: samePath("/wet-checks", c, i, b), search: "tab=needs-review", badgeKey: "wetCheckReviews",
      },
    ] }],
  },
  {
    id: "billing", label: "Billing", railLabel: "Billing",
    description: "Turn approved work into invoices", icon: DollarSign, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "command-center", label: "Command Center", description: "Bill approved work by customer", icon: ClipboardList, paths: samePath("/billing/command-center", c, b) },
      { id: "invoices", label: "Invoices", description: "QuickBooks invoices and aging", icon: Receipt, paths: samePath("/invoices", c, b, k), badgeKey: "overdueInvoices" },
    ] }],
  },
  {
    id: "customers", label: "Customers", railLabel: "Clients",
    description: "Profiles, contacts, irrigation systems and budgets", icon: Users, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "customers", label: "Customers", description: "Every customer, with a Visible filter for the master list", icon: Users, paths: samePath("/customers", c, i, b, k) },
      { id: "maps", label: "Maps", description: "Site maps", icon: MapIcon, paths: samePath("/site-maps", c, i) },
    ] }],
  },
  {
    id: "insights", label: "Insights", railLabel: "Insights",
    description: "How the money is tracking, and data-quality audits", icon: BarChart3, placement: "top", showBadgeSum: true,
    groups: [
      { label: "Money", pages: [
        { id: "budget-status", label: "Budget Status", description: "Spend against monthly budgets", icon: BarChart3, paths: samePath("/budget-status", c, i, b) },
        { id: "financial-pulse", label: "Financial Pulse", description: "Financial overview", icon: Activity, paths: samePath("/financial-pulse", c, i, b, s) },
      ] },
      { label: "Audits", pages: [
        { id: "missing-photos-wo", label: "Missing Photos – Work Orders", description: "Completed work with no photos", icon: ShieldCheck, paths: samePath("/work-orders/missing-photos", c, b) },
        { id: "missing-photos-bs", label: "Missing Photos – Billing", description: "Billing sheets with no photos", icon: ShieldCheck, paths: samePath("/billing-sheets/missing-photos", c, b) },
        { id: "zero-price", label: "Zero Price Audit", description: "Lines billed at zero", icon: ShieldCheck, paths: samePath("/billing-sheets/zero-price-audit", c, b) },
        { id: "labor-rate", label: "Labor Rate Audit", description: "Lines off the customer's rate", icon: ShieldCheck, paths: samePath("/billing-sheets/labor-rate-audit", c, b) },
        { id: "missing-location", label: "Missing Location Data", description: "Work without controller or zone", icon: ShieldCheck, paths: samePath("/reports/missing-location-data", c, i, b, k, s) },
        { id: "wc-recon", label: "WC Reconciliation", description: "Wet-check billing reconciliation", icon: Scale, paths: samePath("/admin/wet-check-reconciliation", c, s) },
      ] },
    ],
  },
  {
    id: "parts", label: "Parts", railLabel: "Parts",
    description: "Catalog, approvals and pricing", icon: Package, placement: "top", showBadgeSum: true,
    groups: [{ label: null, pages: [
      { id: "parts-catalog", label: "Parts Catalog", description: "Parts, prices and costs", icon: Package, paths: samePath("/parts", c, i, b) },
      { id: "parts-pending", label: "Pending Approval", description: "Field-added parts waiting for review", icon: ShieldCheck, paths: samePath("/parts-pending-approval", c, b), badgeKey: "partsPendingApproval" },
      { id: "markup", label: "Material Markup", description: "Tiered markup schedule", icon: Percent, paths: samePath("/admin/markup-schedule", c, s) },
      { id: "parts-settings", label: "Parts Settings", description: "Catalog defaults", icon: Settings, paths: samePath("/parts-settings", c, i, b) },
    ] }],
  },
  {
    id: "data", label: "Data", railLabel: "Data",
    description: "Data repairs and backfills", icon: Database, placement: "bottom", showBadgeSum: false,
    groups: [{ label: null, pages: [
      { id: "db-migrations", label: "DB Migrations", description: "Run and review data repairs", icon: Database, paths: samePath("/admin/migrations", s) },
      { id: "wc-labor-backfill", label: "WC Labor Backfill", description: "Backfill wet-check labor", icon: Droplets, paths: samePath("/admin/wc-labor-backfill", s) },
    ] }],
  },
  {
    id: "settings", label: "Settings", railLabel: "Settings",
    description: "Set once, change rarely", icon: Settings, placement: "bottom", showBadgeSum: false,
    groups: [
      { label: "Company", pages: [
        { id: "team", label: "Team", description: "Users and roles", icon: Users, paths: samePath("/users", c) },
        { id: "company-profile", label: "Company Profile", description: "Name, logo, contact", icon: Building2, paths: samePath("/company-profile", c) },
        { id: "quickbooks", label: "QuickBooks", description: "Connection and sync", icon: Calculator, paths: samePath("/quickbooks", c, b, k, s) },
      ] },
      { label: "Pricing and budgets", pages: [
        { id: "labor-rates", label: "Labor Rates", description: "Default rates", icon: DollarSign, paths: samePath("/labor-rates", c) },
        { id: "budget-goals", label: "Budget Goals", description: "Season curve and goals", icon: DollarSign, paths: samePath("/admin/budget-goals", c, s) },
      ] },
      { label: "Irrigation", pages: [
        { id: "controllers", label: "Controllers & Zones", description: "Controller setup", icon: Cpu, paths: samePath("/admin/controllers", c, s) },
        { id: "issue-types", label: "Wet Check Issue Types", description: "Finding categories", icon: Droplets, paths: samePath("/admin/issue-types", c, b, s) },
      ] },
    ],
  },
];

export function navForRole(role: string | undefined): ResolvedNavSection[] {
  if (role !== c && role !== i && role !== b && role !== k && role !== s) return [];

  return NAV_SECTIONS.flatMap(({ groups, ...section }) => {
    const resolvedGroups = groups.flatMap(({ label, pages }) => {
      const resolvedPages = pages.flatMap(({ paths, ...page }) => {
        const path = paths[role];
        if (!path) return [];
        const href = page.search ? `${path}?${page.search}` : path;
        return [{ ...page, path, href, sectionId: section.id }];
      });
      return resolvedPages.length ? [{ label, pages: resolvedPages }] : [];
    });
    const pages = resolvedGroups.flatMap((group) => group.pages);
    return pages.length ? [{ ...section, groups: resolvedGroups, pages }] : [];
  });
}

export function findActivePage(
  sections: ResolvedNavSection[],
  location: string,
  search = "",
): ResolvedNavPage | undefined {
  const path = location.replace(/\/+$/, "") || "/";
  const matches = sections.flatMap((section) => section.pages).filter((page) =>
    page.path === path || (page.path !== "/" && path.startsWith(`${page.path}/`)),
  );
  const longest = Math.max(0, ...matches.map((page) => page.path.length));
  const candidates = matches.filter((page) => page.path.length === longest);
  const params = new URLSearchParams(search);
  return candidates.find((page) => page.path === path && page.search &&
    Array.from(new URLSearchParams(page.search)).every(([key, value]) => params.get(key) === value),
  ) ?? candidates.find((page) => !page.search);
}

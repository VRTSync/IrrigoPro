import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "@/App";
import { AuthProvider } from "@/lib/auth-context";
import { queryClient } from "@/lib/queryClient";
import { navForRole, type NavRole } from "./nav-config";

// Keep both real role routers (including the company-admin Switch), wouter,
// auth, lazy loading and the real NotFound. Stub only destination components
// so this checks routing without requiring page-specific data or signing out.
const page = vi.hoisted(() =>
  (id: string) => ({ default: () => <div data-testid="route-destination">{id}</div> }),
);
vi.mock("@/pages/action-board", () => page("action-board"));
vi.mock("@/pages/admin-budget-goals", () => page("budget-goals"));
vi.mock("@/pages/admin-client-errors", () => page("client-errors"));
vi.mock("@/pages/admin-controllers", () => page("controllers"));
vi.mock("@/pages/admin-dashboard", () => page("dashboard"));
vi.mock("@/pages/admin-issue-types", () => page("issue-types"));
vi.mock("@/pages/admin-wc-labor-backfill", () => page("wc-labor-backfill"));
vi.mock("@/pages/admin/migrations", () => page("db-migrations"));
vi.mock("@/pages/billing-sheets", () => page("billing-sheets"));
vi.mock("@/pages/billing-zero-price-audit", () => page("zero-price"));
vi.mock("@/pages/budget-status", () => page("budget-status"));
vi.mock("@/pages/company-profile", () => page("company-profile"));
vi.mock("@/pages/company-user-management", () => page("team"));
vi.mock("@/pages/customer-billing", () => page("command-center"));
vi.mock("@/pages/customers", () => page("customers"));
vi.mock("@/pages/estimate-command-center", () => page("estimate-command-center"));
vi.mock("@/pages/estimates", () => page("estimates"));
vi.mock("@/pages/estimates-pending-approval", () => page("estimates-pending-approval"));
vi.mock("@/pages/financial-pulse", () => page("financial-pulse"));
vi.mock("@/pages/invoices", () => page("invoices"));
vi.mock("@/pages/labor-rate-audit", () => page("labor-rate"));
vi.mock("@/pages/labor-rates", () => page("labor-rates"));
vi.mock("@/pages/manager-workspace", () => page("manager-workspace"));
vi.mock("@/pages/markup-schedule", () => page("markup"));
vi.mock("@/pages/missing-location-data-report", () => page("missing-location"));
vi.mock("@/pages/missing-photos-report", () => page("missing-photos-bs"));
vi.mock("@/pages/parts-catalog", () => page("parts-catalog"));
vi.mock("@/pages/parts-pending-approval", () => page("parts-pending"));
vi.mock("@/pages/parts-settings", () => page("parts-settings"));
vi.mock("@/pages/quickbooks", () => page("quickbooks"));
vi.mock("@/pages/site-maps", () => page("maps"));
vi.mock("@/pages/super-admin-app-health", () => page("app-health"));
vi.mock("@/pages/super-admin-loose-photos", () => page("loose-photos"));
vi.mock("@/pages/system-user-management", () => page("all-users"));
vi.mock("@/pages/wet-check-reconciliation", () => page("wc-recon"));
vi.mock("@/pages/wet-checks/WetCheckSystemPage", () => page("wet-checks"));
vi.mock("@/pages/work-orders-missing-photos-report", () => page("missing-photos-wo"));
vi.mock("@/pages/work-orders", () => page("work-orders"));
vi.mock("@/components/notifications/notification-system", () => ({ NotificationSystem: () => null }));
vi.mock("@/components/offline/service-worker-update-prompt", () => ({
  ServiceWorkerRegistration: () => null,
  ServiceWorkerUpdatePrompt: () => null,
}));

const roles: NavRole[] = [
  "company_admin", "irrigation_manager", "billing_manager", "bookkeeper", "super_admin",
];
const routeAliases: Partial<Record<NavRole, Record<string, string>>> = {
  company_admin: { estimates: "estimate-command-center" },
  irrigation_manager: { dashboard: "manager-workspace" },
  billing_manager: { dashboard: "manager-workspace", estimates: "estimates-pending-approval" },
  bookkeeper: { dashboard: "invoices" },
  super_admin: { companies: "app-health" },
};

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1366);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media,
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mountAt(role: NavRole, href: string) {
  localStorage.setItem("user", JSON.stringify({ id: 1, role, name: "Router fixture", companyId: 1 }));
  localStorage.setItem("onboarding_completed", "true");
  const location = memoryLocation({ path: href, record: true });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <AuthProvider><AppRoutes /></AuthProvider>
    </Router>,
  );
  return location;
}

for (const role of roles) {
  describe(`${role} menu route parity`, () => {
    const pages = navForRole(role).flatMap((section) => section.pages);
    it.each(pages)("mounts $href in the role's router", async ({ id, href }) => {
      const location = mountAt(role, href);
      const expected = id === "wet-check-reviews" ? "wet-checks" : routeAliases[role]?.[id] ?? id;
      const destination = await screen.findByTestId("route-destination");
      expect(destination.textContent).toBe(expected);
      expect(screen.queryByRole("heading", { name: "404 Page Not Found" })).not.toBeInTheDocument();
      expect(location.history).toEqual([href]);
    });
  });
}

it("detects a missing route rather than passing on a loading screen", async () => {
  mountAt("bookkeeper", "/definitely-not-a-route");
  expect(await screen.findByRole("heading", { name: "404 Page Not Found" })).toBeInTheDocument();
  expect(screen.queryByTestId("route-destination")).not.toBeInTheDocument();
});

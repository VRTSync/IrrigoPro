import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "@/App";
import { AuthProvider } from "@/lib/auth-context";
import { queryClient } from "@/lib/queryClient";
import { navForRole, type NavRole } from "./nav-config";

vi.mock("@/pages/login", () => ({ default: () => null }));
vi.mock("@/pages/estimate-approval", () => ({ default: () => null }));
vi.mock("@/pages/manager-workspace", () => ({ default: () => null }));
vi.mock("@/pages/field-tech-dashboard", () => ({ default: () => <div>Field tech dashboard</div> }));
vi.mock("@/pages/user-profile", () => ({ default: () => <div>User profile</div> }));
vi.mock("@/pages/quickbooks", () => ({ default: () => <div>QuickBooks page</div> }));
vi.mock("@/pages/system-user-management", () => ({ default: () => <div>System users page</div> }));
vi.mock("@/pages/wet-checks/WetCheckSystemPage", () => ({ default: () => <div>Wet check tabs</div> }));
vi.mock("@/components/notifications/notification-system", () => ({ NotificationSystem: () => null }));
vi.mock("@/components/offline/service-worker-update-prompt", () => ({
  ServiceWorkerRegistration: () => null,
  ServiceWorkerUpdatePrompt: () => null,
}));
vi.mock("@/components/offline/conflict-toast-bridge", () => ({ ConflictToastBridge: () => null }));

const roles: NavRole[] = [
  "company_admin", "irrigation_manager", "billing_manager", "bookkeeper", "super_admin",
];

function mount(role: string, width: number, path = "/user-profile") {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => {
    const max = query.match(/max-width:\s*(\d+)px/);
    const min = query.match(/min-width:\s*(\d+)px/);
    return {
      matches: (!max || width <= Number(max[1])) && (!min || width >= Number(min[1])),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }));
  localStorage.setItem("user", JSON.stringify({
    id: 1, role, name: "Nav Fixture", companyId: 1,
  }));
  localStorage.setItem("onboarding_completed", "true");
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <AuthProvider><AppRoutes /></AuthProvider>
    </Router>,
  );
  return location;
}

async function openMenu() {
  const trigger = await screen.findByTestId("phone-nav-menu");
  expect(trigger).toHaveAccessibleName("Open menu");
  fireEvent.click(trigger);
  return within(await screen.findByRole("dialog", { name: "Sidebar" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([], {
    headers: { "X-Total-Count": "7" },
  })));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("phone nav uses the actual role shell", () => {
  for (const width of [390, 820, 1023]) {
    it.each(roles)(`lists every %s sidebar link in order at ${width}px`, async (role) => {
      mount(role, width);
      const menu = await openMenu();

      // Sections start collapsed when no page is active, just as on desktop.
      let collapsed = menu.queryAllByRole("button", { expanded: false })
        .find((button) => button.hasAttribute("aria-controls"));
      while (collapsed) {
        fireEvent.click(collapsed);
        collapsed = menu.queryAllByRole("button", { expanded: false })
          .find((button) => button.hasAttribute("aria-controls"));
      }
      expect(menu.getAllByRole("link").map((link) => link.getAttribute("href")))
        .toEqual(navForRole(role).flatMap(({ pages }) => pages.map(({ href }) => href)));
    });
  }

  it("shows sidebar badges and closes after opening another page", async () => {
    const location = mount("bookkeeper", 820);
    const menu = await openMenu();
    const invoices = menu.getByRole("link", { name: "Invoices" });
    expect(await within(invoices.closest("li")!).findByText("7")).toBeVisible();

    fireEvent.click(menu.getByRole("link", { name: "QuickBooks" }));
    expect(await screen.findByText("QuickBooks page")).toBeVisible();
    expect(location.history).toEqual(["/user-profile", "/quickbooks"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes after tapping the current page", async () => {
    mount("bookkeeper", 390, "/quickbooks");
    const menu = await openMenu();
    fireEvent.click(menu.getByRole("link", { name: "QuickBooks" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes after choosing a different tab on the same page", async () => {
    const location = mount("irrigation_manager", 390, "/wet-checks");
    const menu = await openMenu();
    expect(menu.getByRole("button", { name: "Field Work", expanded: true })).toBeVisible();
    fireEvent.click(menu.getByRole("button", { name: "Approvals" }));
    fireEvent.click(menu.getByRole("link", { name: "Wet Check Reviews" }));
    expect(location.history).toEqual(["/wet-checks", "/wet-checks?tab=needs-review"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("replaces the old User Manager bookmark with the All Users route", async () => {
    const location = mount("super_admin", 1024, "/user-manager");
    expect(await screen.findByText("System users page")).toBeVisible();
    expect(location.history).toEqual(["/system-users"]);
  });

  it("keeps the field tech's quick links without adding a Menu button", () => {
    mount("field_tech", 390, "/");
    expect(screen.getByText("Field tech dashboard")).toBeVisible();
    expect(screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/wet-checks")).toBe(true);
    expect(screen.queryByTestId("phone-nav-menu")).not.toBeInTheDocument();
  });
});

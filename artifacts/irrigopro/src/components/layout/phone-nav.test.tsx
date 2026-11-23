import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "@/App";
import { AuthProvider } from "@/lib/auth-context";
import { queryClient } from "@/lib/queryClient";
import { findActivePage, navForRole, type NavBadgeMap, type NavRole } from "./nav-config";
import { PhoneNav, splitPhoneTabs } from "./phone-nav";
import { JumpToProvider } from "./jump-to";

vi.mock("@/pages/login", () => ({ default: () => null }));
vi.mock("@/pages/estimate-approval", () => ({ default: () => null }));
vi.mock("@/pages/manager-workspace", () => ({ default: () => null }));
vi.mock("@/pages/field-tech-dashboard", () => ({ default: () => <div>Field tech dashboard</div> }));
vi.mock("@/pages/user-profile", () => ({ default: () => <div>User profile</div> }));
vi.mock("@/pages/work-orders", () => ({ default: () => <div>Work orders page</div> }));
vi.mock("@/pages/parts-catalog", () => ({ default: () => <div>Parts catalog page</div> }));
vi.mock("@/pages/quickbooks", () => ({ default: () => <div>QuickBooks page</div> }));
vi.mock("@/pages/system-user-management", () => ({ default: () => <div>System users page</div> }));
vi.mock("@/pages/wet-checks/WetCheckSystemPage", () => ({ default: () => <div>Wet check tabs</div> }));
vi.mock("@/components/notifications/notification-system", () => ({ NotificationSystem: () => null }));
vi.mock("@/components/offline/service-worker-update-prompt", () => ({
  ServiceWorkerRegistration: () => null,
  ServiceWorkerUpdatePrompt: () => null,
}));
vi.mock("@/components/offline/conflict-toast-bridge", () => ({ ConflictToastBridge: () => null }));

const roles: [NavRole, string[], string[]][] = [
  ["company_admin", ["Dashboard", "Field", "Approvals", "Billing"], ["Clients", "Insights", "Parts", "Settings"]],
  ["irrigation_manager", ["Dashboard", "Field", "Approvals", "Clients"], ["Insights", "Parts"]],
  ["billing_manager", ["Dashboard", "Field", "Approvals", "Billing"], ["Clients", "Insights", "Parts", "Settings"]],
  ["bookkeeper", ["Dashboard", "Billing", "Clients", "Insights"], ["Settings"]],
  ["super_admin", ["Platform", "Users", "Field", "Insights"], ["Parts", "Data", "Settings"]],
];

function stubViewport(width: number) {
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
}

function mount(role: string, width: number, path = "/user-profile") {
  stubViewport(width);
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

function phoneTabs() {
  return within(screen.getByRole("navigation", { name: "Phone navigation" }));
}

async function openMenu(label: RegExp, title: string) {
  const trigger = phoneTabs().getByRole("button", { name: label });
  fireEvent.click(trigger);
  return within(await screen.findByRole("dialog", { name: title }));
}

function renderPhone(path: string, badges: NavBadgeMap = {}) {
  const sections = navForRole("company_admin");
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <JumpToProvider role="company_admin">
        <PhoneNav sections={sections} activePage={findActivePage(sections, path)} badges={badges} user={{}} brandThemed />
      </JumpToProvider>
    </Router>,
  );
  return location;
}

beforeEach(() => {
  localStorage.clear();
  stubViewport(390);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/user") {
      return Response.json(JSON.parse(localStorage.getItem("user") ?? "null"));
    }
    return Response.json([], { headers: { "X-Total-Count": "7" } });
  }));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("phone navigation tabs", () => {
  it.each(roles)("splits direct tabs from More for %s", (role, expectedTabs, expectedMore) => {
    const { tabs, more } = splitPhoneTabs(navForRole(role));
    expect(tabs.map((section) => section.railLabel)).toEqual(expectedTabs);
    expect(more.map((section) => section.railLabel)).toEqual(expectedMore);
  });

  it("navigates directly from the Dashboard tab", () => {
    const location = renderPhone("/work-orders");
    fireEvent.click(phoneTabs().getByRole("link", { name: "Dashboard" }));
    expect(location.history).toEqual(["/work-orders", "/"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks More current for a page inside it", () => {
    renderPhone("/parts");
    expect(phoneTabs().getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("text-phone-page")).toHaveTextContent("Parts Catalog");
  });

  it("offers My Account and Logout without the retired Switch User action", async () => {
    renderPhone("/parts");
    fireEvent.keyDown(screen.getByRole("button", { name: "Account" }), { key: "Enter" });
    const account = within(await screen.findByRole("menu"));
    expect(account.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual(["My Account", "Logout"]);
    expect(account.getByRole("menuitem", { name: "My Account" })).toHaveAttribute("href", "/user-profile");
  });

  it.each([[7, "7"], [105, "99+"]])("shows the Billing tab badge for %s overdue invoices", (overdueInvoices, label) => {
    renderPhone("/work-orders", { overdueInvoices });
    expect(within(phoneTabs().getByRole("button", { name: /^Billing/ })).getByText(label)).toBeVisible();
  });
});

describe("phone nav uses the actual role routers", () => {
  for (const width of [390, 820, 1023]) {
    it.each(roles)(`lists every %s config destination in order at ${width}px`, async (role) => {
      mount(role, width);
      const sections = navForRole(role);
      const { tabs, more } = splitPhoneTabs(sections);
      const links: (string | null)[] = [];
      for (const section of tabs) {
        if (section.pages.length === 1) {
          links.push(phoneTabs().getByTestId(`link-phone-tab-${section.id}`).getAttribute("href"));
        } else {
          fireEvent.click(phoneTabs().getByTestId(`button-phone-tab-${section.id}`));
          const dialog = within(await screen.findByRole("dialog", { name: section.label }));
          links.push(...dialog.getAllByRole("link").map((link) => link.getAttribute("href")));
          fireEvent.click(dialog.getByRole("button", { name: "Close" }));
          await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        }
      }
      const menu = await openMenu(/^More/, "More");
      expect(menu.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
        .toEqual(more.map((section) => section.label));
      links.push(...menu.getAllByRole("link").map((link) => link.getAttribute("href")));
      expect(links).toEqual(sections.flatMap(({ pages }) => pages.map(({ href }) => href)));
    });
  }

  it("shows Field group headings and closes after navigating to Work Orders", async () => {
    const location = mount("company_admin", 390);
    const menu = await openMenu(/^Field/, "Field Work");
    expect(menu.getByRole("heading", { name: "Plan" })).toBeVisible();
    expect(menu.getByRole("heading", { name: "In the field" })).toBeVisible();
    fireEvent.click(menu.getByRole("link", { name: "Work Orders" }));
    expect(await screen.findByText("Work orders page")).toBeVisible();
    expect(location.history).toEqual(["/user-profile", "/work-orders"]);
    expect(phoneTabs().getByRole("button", { name: /^Field/ })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the bookkeeper's shared overdue count and closes More after navigation", async () => {
    const location = mount("bookkeeper", 820);
    expect(await within(phoneTabs().getByRole("link", { name: /^Billing/ })).findByText("7")).toBeVisible();
    const menu = await openMenu(/^More/, "More");
    fireEvent.click(menu.getByRole("link", { name: "QuickBooks" }));
    expect(await screen.findByText("QuickBooks page")).toBeVisible();
    expect(location.history).toEqual(["/user-profile", "/quickbooks"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes after tapping the current page", async () => {
    mount("bookkeeper", 390, "/quickbooks");
    const menu = await openMenu(/^More/, "More");
    const quickBooks = menu.getByRole("link", { name: "QuickBooks" });
    expect(quickBooks).toHaveAttribute("aria-current", "page");
    fireEvent.click(quickBooks);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes after choosing a different tab on the same page", async () => {
    const location = mount("irrigation_manager", 390, "/wet-checks");
    expect(phoneTabs().getByRole("button", { name: /^Field/ })).toHaveAttribute("aria-current", "page");
    const menu = await openMenu(/^Approvals/, "Approvals");
    fireEvent.click(menu.getByRole("link", { name: "Wet Check Reviews" }));
    expect(location.history).toEqual(["/wet-checks", "/wet-checks?tab=needs-review"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(phoneTabs().getByRole("button", { name: /^Approvals/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("text-phone-page")).toHaveTextContent("Wet Check Reviews");
  });

  it("shows the same invoice count on the Billing tab and its page row", async () => {
    mount("company_admin", 390);
    expect(await within(phoneTabs().getByRole("button", { name: /^Billing/ })).findByText("7")).toBeVisible();
    const billing = await openMenu(/^Billing/, "Billing");
    expect(within(billing.getByRole("link", { name: /^Invoices/ })).getByText("7")).toBeVisible();
  });

  it("does not open the old portalled sidebar with the desktop shortcut on a tablet", () => {
    mount("super_admin", 820);
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("navigation", { name: "Phone navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
  });
});

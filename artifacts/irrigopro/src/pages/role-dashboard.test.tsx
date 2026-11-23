import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  AGING_BUCKET_LABELS, DASHBOARD_TILE_ORDER, DASHBOARD_TILE_ROLES, type DashboardSectionsResponse,
} from "@workspace/shared";
import { JumpToProvider } from "@/components/layout/jump-to";
import { navPinsKey } from "@/components/layout/nav-pins";
import type { DashboardRole } from "@/components/dashboard/command-band";
import { BUCKET_TO_AGING_VALUE } from "@/lib/invoice-ar-query";
import RoleDashboard from "./role-dashboard";

const auth = vi.hoisted(() => ({ role: "company_admin" }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 62, companyId: 7, role: auth.role } }),
}));

let failures = 0;
let profileFails = false;
const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = new URL(String(input), "http://dashboard.test");
  switch (url.pathname) {
    case "/api/dashboard/sections": {
      if (failures-- > 0) return Response.json({ message: "Unavailable" }, { status: 503 });
      const overdueDate = new Date(2026, 6, 14, 9).toISOString();
      const dueDate = new Date(2026, 6, 19, 9).toISOString();
      const data: DashboardSectionsResponse = {
        generatedAt: new Date().toISOString(),
        tiles: DASHBOARD_TILE_ORDER.filter((key) => DASHBOARD_TILE_ROLES[key].includes(auth.role)).map((key) => ({
          key, total: key === "billing-sheets" ? 0 : 4, overdue: key === "wet-checks" ? 3 : 0,
          oldest: key === "billing-sheets" ? null : {
            label: key === "invoices" ? "I-14 · Orchard" : "Orchard",
            verb: key === "invoices" ? "Due" : "Submitted",
            at: key === "invoices" ? dueDate : overdueDate,
          },
        })),
        field: ["company_admin", "irrigation_manager"].includes(auth.role)
          ? { techsOnActiveWork: 2, workOrdersInProgress: 3, wetChecksInProgress: 5 } : null,
        money: auth.role === "irrigation_manager" ? null : {
          readyToBillCount: auth.role === "bookkeeper" ? null : 12,
          openInvoiceBalance: "2415.23", pastDueBalance: "123.40",
        },
      };
      return Response.json(data);
    }
    case "/api/company/7/profile":
      return profileFails ? new Response(null, { status: 503 }) : Response.json({ name: "Orchard Irrigation Services" });
    case "/api/action-board":
      return Response.json({ rows: [
        { lane: "clear_to_send" }, { lane: "clear_to_send" },
        { lane: "over_budget_nothing_approved" }, { lane: "nothing_pending" },
      ] });
    case "/api/invoices/aging-summary":
      return Response.json({ buckets: Object.entries(AGING_BUCKET_LABELS).map(([key, label]) => ({
        key, label, balanceDue: "120.10", count: 2,
      })), overall: { balanceDue: "480.40", count: 8 } });
    default:
      throw new Error(`Unexpected dashboard request: ${input}`);
  }
});

beforeEach(() => {
  vi.setSystemTime(new Date(2026, 6, 15, 12));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView ??= () => {};
  fetchSpy.mockClear();
  failures = 0;
  profileFails = false;
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function mount(role: DashboardRole) {
  auth.role = role;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
  const location = memoryLocation({ path: "/", record: true });
  render(
    <Router hook={location.hook}>
      <QueryClientProvider client={client}>
        <JumpToProvider role={role}><RoleDashboard /></JumpToProvider>
      </QueryClientProvider>
    </Router>,
  );
  return client;
}

const testIds = (pattern: RegExp, prefix: string) =>
  screen.queryAllByTestId(pattern).map((node) => node.getAttribute("data-testid")?.slice(prefix.length));
const tiles = () => testIds(/^dashboard-tile-/, "dashboard-tile-");
const slots = () => testIds(/^dashboard-slot-/, "dashboard-slot-");
const quickActions = () => screen.getAllByTestId(/^link-quick-action-/).map((link) => [link.textContent, link.getAttribute("href")]);

describe("Role Dashboard", () => {
  it("shows the company admin all eight tiles, the two previews, and three quick actions", async () => {
    const client = mount("company_admin");
    expect(await screen.findByText("ORCHARD IRRIGATION SERVICES · IRRIGATION")).toBeInTheDocument();
    expect(tiles()).toEqual(DASHBOARD_TILE_ORDER);
    expect(slots()).toEqual([]);
    expect(quickActions()).toEqual([
      ["Open Action Board", "/action-board"],
      ["Command Center", "/billing/command-center"],
      ["Estimates", "/estimates/command-center"],
    ]);
    const plan = within(screen.getByTestId("dashboard-preview-plan"));
    expect(await plan.findByTestId("text-plan-clear_to_send")).toHaveTextContent("2");
    expect(plan.getByTestId("text-plan-over_budget_nothing_approved")).toHaveTextContent("1");
    expect(plan.getByTestId("text-plan-nothing_pending")).toHaveTextContent("1");
    const aging = within(screen.getByTestId("dashboard-preview-aging"));
    for (const key of Object.keys(AGING_BUCKET_LABELS) as (keyof typeof AGING_BUCKET_LABELS)[]) {
      const row = await aging.findByTestId(`link-aging-${key}`);
      expect(row).toHaveTextContent(AGING_BUCKET_LABELS[key]);
      expect(row).toHaveTextContent("$120.10");
      expect(row).toHaveAttribute("href", `/invoices?aging=${BUCKET_TO_AGING_VALUE[key]}`);
    }
    expect(screen.getByTestId("text-field-line")).toHaveTextContent("2 techs on active work · 3 work orders in progress · 5 wet checks in progress");
    expect(screen.getByTestId("text-money-line")).toHaveTextContent("12 items ready to bill · $2,415.23 open invoices · $123.40 past due");
    expect(screen.getByTestId("text-past-due")).toHaveStyle({ color: "#fecaca" });
    expect(client.getQueryData(["/api/action-board?year=2026&month=7"])).toMatchObject({ rows: expect.any(Array) });
    expect(client.getQueryData(["/api/invoices", "aging-summary", ""])).toMatchObject({ overall: { count: 8 } });
    expect(fetchSpy.mock.calls.map(([url, init]) => [String(url), init?.method ?? "GET"]).sort()).toEqual([
      ["/api/action-board?year=2026&month=7", "GET"],
      ["/api/company/7/profile", "GET"],
      ["/api/dashboard/sections", "GET"],
      ["/api/invoices/aging-summary", "GET"],
    ]);
  });

  it("shows the irrigation manager five tiles, links to their Estimates, and doesn't load money data", async () => {
    mount("irrigation_manager");
    expect(await screen.findByTestId("text-field-line")).toBeInTheDocument();
    expect(tiles()).toEqual(["wet-checks", "estimates", "work-orders", "billing-sheets", "approvals"]);
    expect(slots()).toEqual(["ready-to-bill", "invoices", "parts"]);
    expect(screen.getByTestId("dashboard-slot-invoices")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("dashboard-tile-estimates")).toHaveAttribute("href", "/estimates");
    expect(screen.getByTestId("dashboard-tile-wet-checks")).toHaveAttribute("href", "/wet-checks?tab=needs-review");
    expect(screen.getByTestId("dashboard-preview-plan")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-preview-aging")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-money-line")).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).startsWith("/api/invoices"))).toBe(false);
  });

  it("shows the billing manager their Estimates queue and only the aging preview", async () => {
    mount("billing_manager");
    expect(await screen.findByTestId("text-money-line")).toHaveTextContent("12 items ready to bill");
    expect(tiles()).toEqual(DASHBOARD_TILE_ORDER);
    expect(screen.getByTestId("dashboard-tile-estimates")).toHaveAttribute("href", "/estimates/pending-approval");
    expect(screen.getByTestId("dashboard-preview-aging")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-preview-plan")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-field-line")).not.toBeInTheDocument();
    expect(quickActions()).toEqual([
      ["Open Command Center", "/billing/command-center"],
      ["Start a Wet Check", "/wet-checks/new"],
      ["Invoices", "/invoices"],
    ]);
    expect(fetchSpy.mock.calls.some(([url]) => /\/action-board|\/company\//.test(String(url)))).toBe(false);
  });

  it("shows only Invoices and aging to a bookkeeper, without ready-to-bill data", async () => {
    mount("bookkeeper");
    expect(await screen.findByTestId("text-money-line")).toHaveTextContent("$2,415.23 open invoices · $123.40 past due");
    expect(screen.getByTestId("text-money-line")).not.toHaveTextContent("ready to bill");
    expect(screen.queryByTestId("text-field-line")).not.toBeInTheDocument();
    expect(tiles()).toEqual(["invoices"]);
    expect(slots()).toHaveLength(7);
    expect(screen.getByTestId("dashboard-preview-aging")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-preview-plan")).not.toBeInTheDocument();
    expect(screen.getByText("IRRIGOPRO · IRRIGATION")).toBeInTheDocument();
    expect(screen.getByText("Due in 4 days")).toBeInTheDocument();
    expect(quickActions()).toEqual([["Open Invoices", "/invoices"], ["QuickBooks", "/quickbooks"]]);
  });

  it("colors overdue totals, gives accessible counts, and marks an empty queue", async () => {
    mount("company_admin");
    const wetChecks = await screen.findByRole("link", { name: "Open Wet Checks: 4 waiting, 3 overdue" });
    expect(within(wetChecks).getByTestId("dashboard-count-wet-checks")).toHaveStyle({ color: "#b91c1c" });
    expect(wetChecks).toHaveTextContent("Oldest: Orchard");
    expect(wetChecks).toHaveTextContent("Submitted 1 day ago");
    expect(wetChecks).toHaveAttribute("title", expect.stringContaining("Overdue after 2 days"));
    const draft = screen.getByRole("link", { name: "Open Billing Sheets: 0 waiting, none overdue" });
    expect(draft).toHaveTextContent("Nothing waiting");
    expect(draft).toHaveClass("bg-transparent");
  });

  it("resolves saved pins by role and opens the shared Jump To dialog", async () => {
    localStorage.setItem(navPinsKey(62), JSON.stringify(["estimates", "customers", "invoices"]));
    mount("irrigation_manager");
    const pins = within(screen.getByTestId("dashboard-pinned"));
    expect(pins.getByRole("link", { name: "Estimates" })).toHaveAttribute("href", "/estimates");
    expect(pins.getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/customers");
    expect(pins.queryByRole("link", { name: "Invoices" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-jump-to"));
    expect(await screen.findByRole("dialog", { name: "Jump to a page" })).toBeInTheDocument();
  });

  it.each([
    [new Date(2026, 3, 1, 12), "Irrigation season · week 1 / 31"],
    [new Date(2026, 6, 15, 12), "Irrigation season · week 16 / 31"],
    [new Date(2026, 9, 31, 12), "Irrigation season · week 31 / 31"],
    [new Date(2026, 10, 18, 12), "Off season · next season opens Apr 1 (134 days)"],
  ])("shows the season for %s with no Pinned line by default", (clock, text) => {
    vi.setSystemTime(clock);
    mount("bookkeeper");
    expect(screen.getByTestId("text-season-chip")).toHaveTextContent(text);
    expect(screen.queryByTestId("dashboard-pinned")).not.toBeInTheDocument();
  });

  it("shows loading, then error placeholders, and refetches on Retry", async () => {
    failures = 1;
    profileFails = true;
    mount("company_admin");
    expect(screen.getByTestId("dashboard-tile-wet-checks").querySelector(".animate-pulse")).not.toBeNull();
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Section counts could not be loaded.");
    expect(screen.getByTestId("dashboard-count-wet-checks")).toHaveTextContent("—");
    expect(screen.getByText("IRRIGOPRO · IRRIGATION")).toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: "Open Wet Checks: 4 waiting, 3 overdue" });
    expect(screen.queryByTestId("dashboard-sections-error")).not.toBeInTheDocument();
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([url]) => url === "/api/dashboard/sections")).toHaveLength(2));
  });

  it("refetches section counts on window focus despite the app's default infinite freshness", async () => {
    focusManager.setFocused(false);
    const client = mount("bookkeeper");
    await screen.findByTestId("text-money-line");
    focusManager.setFocused(true);
    await waitFor(() => expect(fetchSpy.mock.calls.filter(([url]) => url === "/api/dashboard/sections")).toHaveLength(2));
    await waitFor(() => expect(client.isFetching({ queryKey: ["/api/dashboard/sections"] })).toBe(0));
  });
});

/**
 * Document System Slice 7 — System Documenter app, through the real AppRoutes.
 * Wouter harness: memoryLocation with BOTH hook and searchHook so `?branch=` is real.
 * apiRequest is the real implementation wrapped in a recorder; fetch is stubbed
 * at the network edge only, so the wizard flows run unmodified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import shellSource from "./documenter-app.tsx?raw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { DocumentationControllerGraph, DocumentationSite, DocumentationSites } from "@workspace/api-client-react";

vi.mock("@/pages/login", () => ({ default: () => <div>Login page</div> }));
vi.mock("@/pages/field-tech-dashboard", () => ({ default: () => <div>Field tech dashboard</div> }));
vi.mock("@/pages/manager-workspace", () => ({ default: () => <div>Manager workspace</div> }));
vi.mock("@/pages/estimate-approval", () => ({ default: () => <div>Estimate approval</div> }));
vi.mock("@/components/company-admin-app", () => ({ default: () => <div>Company admin app</div> }));
vi.mock("@/components/layout/navigation", () => ({ default: () => <nav>Navigation</nav> }));
vi.mock("@/components/layout/powered-by-footer", () => ({ default: () => <footer>Powered by footer</footer> }));
vi.mock("@/components/layout/desktop-shell", () => ({ DesktopShell: () => <nav>Desktop admin shell</nav> }));
vi.mock("@/components/offline/service-worker-update-prompt", () => ({
  ServiceWorkerRegistration: () => null, ServiceWorkerUpdatePrompt: () => null,
}));
vi.mock("@/components/offline/conflict-toast-bridge", () => ({ ConflictToastBridge: () => null }));
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: vi.fn(actual.apiRequest),
    clearSessionAndLogout: vi.fn(actual.clearSessionAndLogout),
  };
});

import { AppRoutes } from "@/App";
import { AuthProvider } from "@/lib/auth-context";
import { apiRequest, clearSessionAndLogout, queryClient } from "@/lib/queryClient";
import { isApiAllowedForRole } from "@workspace/shared";
import SwitchUser from "@/pages/switch-user";

// Radix pointer shim (copied from invoices-ar-collections.test.tsx).
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function ctrl(id: number, o: Partial<DocumentationControllerGraph> = {}): DocumentationControllerGraph {
  return {
    id, letter: "A", name: "Clock A", location: "Garage wall", brand: "Hunter", model: "Pro-C",
    totalZones: 2, settingsPhotoUrl: `photo-${id}`, notes: null, lastUpdatedAt: null,
    fieldVerifiedAt: null, fieldVerifiedByName: null, gaps: [], verified: false,
    programs: [], zones: [], ...o,
  };
}
const program = { id: 9, companyId: 1, controllerId: 0, name: "A", wateringDays: ["Mon"], startTimes: ["05:00"], seasonalAdjustPct: 100, isActive: true, sortOrder: 0, createdAt: "", updatedAt: "" };
const zone = (n: number) => ({ id: 100 + n, zoneNumber: n, name: `Zone ${n}`, zoneType: "Spray", zoneTypeConfirmed: true, programId: 9, runTimeMinutes: 10 });

const s = (branchName: string, status: "verified" | "not_verified" | "nothing_on_file") =>
  ({ branchName, status, verifiedAt: null, controllerCount: 0, backflowCount: 0 });

function makeSites(): DocumentationSites {
  return {
    customers: [
      { customerId: 5, name: "Dogwood Estates", address: "5 Dogwood Ln", branches: [], sites: [s("", "not_verified")] },
      { customerId: 1, name: "Alder Court", address: "1 Alder Ct", branches: [], sites: [s("", "verified")] },
      { customerId: 2, name: "Birch Plaza", address: "2 Birch Way", branches: ["North", "South"], sites: [s("North", "verified"), s("South", "not_verified")] },
      { customerId: 3, name: "Cedar Ridge", address: "3 Ridge Rd", branches: [], sites: [s("", "not_verified")] },
      { customerId: 4, name: "Cedar Hollow", address: null, branches: [], sites: [] },
    ],
  };
}

function siteFor(id: number, branchName: string): DocumentationSite | null {
  const c = sites.customers.find((x) => x.customerId === id);
  if (!c) return null;
  const controllers = id === 3
    ? [ctrl(4, { model: "", gaps: [{ step: "details", code: "model", label: "model" }] })]
    : id === 5 ? [ctrl(6, { verified: true, programs: [program], zones: [zone(1), zone(2)] })] : [];
  return {
    customer: { id, name: c.name, address: c.address, branches: c.branches },
    branchName, controllers, backflows: [],
    site: { status: "not_verified", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: id === 5 },
  };
}

let sites: DocumentationSites;
const fetchCalls: [string, string][] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  fetchCalls.push([method, url]);
  const path = url.split("?")[0];
  if (method === "POST" && path === "/api/auth/logout") return json({ ok: true });
  if (method === "GET" && path === "/api/system-documentation/sites") return json(sites);
  const m = path.match(/^\/api\/system-documentation\/customers\/(\d+)\/site(\/verify)?$/);
  if (m) {
    const id = Number(m[1]);
    const branch = new URLSearchParams(url.split("?")[1] ?? "").get("branchName") ?? "";
    if (m[2] && method === "POST") {
      // Server marks the site verified; the picker must reflect it on refetch.
      sites = { customers: sites.customers.map((c) => c.customerId === id ? { ...c, sites: c.sites.map((x) => ({ ...x, status: "verified" as const })) } : c) };
      return json({ ok: true });
    }
    const site = siteFor(id, branch);
    return site ? json(site) : json({ message: "Not found" }, 404);
  }
  return json({});
});

beforeEach(() => {
  sites = makeSites();
  fetchCalls.length = 0;
  fetchStub.mockClear();
  vi.mocked(apiRequest).mockClear();
  vi.mocked(clearSessionAndLogout).mockClear();
  vi.stubGlobal("fetch", fetchStub);
  localStorage.clear();
  queryClient.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(path = "/", role = "system_documenter") {
  localStorage.setItem("user", JSON.stringify({ id: 31, role, name: "Rosa Delgado", companyId: 1, username: "rosa", email: "r@x", isActive: true }));
  const nav = memoryLocation({ path, record: true });
  render(
    <Router hook={nav.hook} searchHook={nav.searchHook}>
      <AuthProvider><AppRoutes /></AuthProvider>
    </Router>,
  );
  return nav;
}

const cards = () => screen.queryAllByTestId(/^card-property-\d+$/);
const atHome = async (nav: ReturnType<typeof memoryLocation>) => {
  expect(await screen.findByRole("heading", { name: "Which property?" })).toBeInTheDocument();
  expect(nav.history.at(-1)).toBe("/");
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("System Documenter app (Slice 7)", () => {
  it("1. / shows Which property? with no staff links, navigation, notifications or footer", async () => {
    mount("/");
    expect(await screen.findByRole("heading", { name: "Which property?" })).toBeInTheDocument();
    expect(screen.getByText("Pick the property you're standing on.")).toBeInTheDocument();
    expect(screen.getByText("System Documenter")).toBeInTheDocument();
    expect(screen.getByRole("banner").style.backgroundImage).toContain("var(--primary-dark)");
    for (const name of ["Work Orders", "Wet Checks", "Customers", "Dashboard"]) {
      expect(screen.queryByRole("link", { name: new RegExp(name, "i") })).toBeNull();
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Powered by footer")).toBeNull();
    await waitFor(() => expect(cards().length).toBe(4));
    // Only allowlisted reads on first paint (no background fetchers).
    for (const [m, u] of fetchCalls) expect(isApiAllowedForRole("system_documenter", m, u)).toBe(true);
  });

  it("shows three skeleton cards while loading, and retry after an error", async () => {
    let fail = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    fetchStub.mockImplementationOnce(async (input: RequestInfo | URL) => {
      fetchCalls.push(["GET", String(input)]);
      await gate;
      return fail ? json({ message: "boom" }, 500) : json(sites);
    });
    mount("/");
    expect(await screen.findAllByTestId("picker-skeleton-card")).toHaveLength(3);
    release();
    expect(await screen.findByTestId("picker-error")).toHaveTextContent("Couldn't load properties.");
    fail = false;
    fireEvent.click(screen.getByTestId("button-picker-retry"));
    await waitFor(() => expect(cards().length).toBe(4));
  });

  it("2. staff URLs (and app-health) redirect to / without any inherited shell", async () => {
    for (const path of ["/work-orders", "/customers/5/profile", "/super-admin/app-health", "/estimate-approval/fixture-token"]) {
      const nav = mount(path);
      await atHome(nav);
      expect(screen.queryByText("Navigation")).toBeNull();
      expect(screen.queryByText("Desktop admin shell")).toBeNull();
      expect(screen.queryByText("No screens for this account")).toBeNull();
      cleanup();
    }
  });

  it("3. filters: Not verified (4) by default, All (5); counts ignore search; cedar narrows both", async () => {
    mount("/");
    await waitFor(() => expect(cards().length).toBe(4));
    const nv = screen.getByTestId("chip-filter-not-verified");
    const all = screen.getByTestId("chip-filter-all");
    expect(nv).toHaveTextContent("Not verified (4)");
    expect(nv).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveTextContent("All (5)");
    // Sorted by name.
    expect(cards().map((c) => c.getAttribute("data-testid"))).toEqual(["card-property-2", "card-property-4", "card-property-3", "card-property-5"]);
    fireEvent.click(all);
    expect(cards()).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "CEDAR" } });
    expect(cards()).toHaveLength(2);
    expect(all).toHaveTextContent("All (5)");
    fireEvent.click(nv);
    expect(cards()).toHaveLength(2);
    expect(nv).toHaveTextContent("Not verified (4)");
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("text-picker-empty")).toHaveTextContent("No properties match. Try another name, or switch to All.");
  });

  it("4. badges follow the exact precedence", async () => {
    mount("/");
    fireEvent.click(await screen.findByTestId("chip-filter-all"));
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(screen.getByTestId("badge-property-1")).toHaveTextContent("Verified");
    expect(screen.getByTestId("badge-property-2")).toHaveTextContent("1 of 2 verified");
    expect(screen.getByTestId("badge-property-3")).toHaveTextContent("Not verified");
    expect(screen.getByTestId("badge-property-4")).toHaveTextContent("Nothing on file");
    expect(screen.getByTestId("badge-property-4").className).toContain("bg-slate-100 text-slate-700");
  });

  it("5. branchless customer opens its summary; two-branch customer opens Which location?", async () => {
    const nav = mount("/");
    fireEvent.click(await screen.findByTestId("card-property-3"));
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
    expect(nav.history.at(-1)).toBe("/customers/3/document-system");
    cleanup();
    mount("/");
    fireEvent.click(await screen.findByTestId("card-property-2"));
    expect(await screen.findByText("Which location?")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("branch-picker-back"));
    await screen.findByRole("heading", { name: "Which property?" });
  });

  it("6a. branchless exits: summary back and Save and leave go to /, footer sits at bottom-0", async () => {
    const nav = mount("/customers/3/document-system");
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
    const footer = screen.getByTestId("button-save-leave").parentElement!;
    expect(footer.className).toContain("bottom-0");
    expect(footer.className).not.toContain("bottom-20");
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await atHome(nav);
    cleanup();
    const nav2 = mount("/customers/3/document-system");
    fireEvent.click(await screen.findByTestId("button-save-leave"));
    await atHome(nav2);
  });

  it("6b. multi-branch exits return to the location step", async () => {
    const nav = mount("/customers/2/document-system?branch=South");
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-doc-back"));
    expect(await screen.findByText("Which location?")).toBeInTheDocument();
    expect(nav.history.at(-1)).toBe("/customers/2/document-system");
    fireEvent.click(screen.getByTestId("branch-option-South"));
    fireEvent.click(await screen.findByTestId("button-save-leave"));
    expect(await screen.findByText("Which location?")).toBeInTheDocument();
  });

  it("6c. Done shows Back to properties; picker refetches and shows the site verified", async () => {
    const nav = mount("/");
    fireEvent.click(await screen.findByTestId("card-property-5"));
    expect(await screen.findByTestId("text-finish-status")).toHaveTextContent("Every item is verified.");
    fireEvent.click(screen.getByTestId("button-finish"));
    expect(await screen.findByText("System documented")).toBeInTheDocument();
    expect(screen.queryByTestId("button-back-to-customer")).toBeNull();
    const back = screen.getByTestId("button-back-to-properties");
    expect(back).toHaveTextContent("Back to properties");
    expect(back.parentElement!.className).toContain("bottom-0");
    fireEvent.click(back);
    await atHome(nav);
    await waitFor(() => expect(screen.getByTestId("chip-filter-not-verified")).toHaveTextContent("Not verified (3)"));
    expect(screen.queryByTestId("card-property-5")).toBeNull();
    fireEvent.click(screen.getByTestId("chip-filter-all"));
    expect(screen.getByTestId("badge-property-5")).toHaveTextContent("Verified");
  });

  it("foreign customer id shows the load error without any foreign details", async () => {
    const nav = mount("/customers/99/document-system");
    expect(await screen.findByTestId("doc-load-error")).toHaveTextContent("Couldn't load this location.");
    expect(screen.queryByText("What's on file")).toBeNull();
    expect(screen.queryByTestId("text-doc-subtitle")).toBeNull();
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await atHome(nav);
  });

  it("7. allowlist proof: every apiRequest and fetch call in a real wizard walk is allowed", async () => {
    const nav = mount("/");
    fireEvent.click(await screen.findByTestId("card-property-3"));
    fireEvent.click(await screen.findByTestId("row-controller-4"));
    expect(await screen.findByTestId("step-details")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chip-model-ICC2"));
    fireEvent.click(screen.getByTestId("button-next"));
    expect(await screen.findByTestId("step-zone-count")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await atHome(nav);

    const apiCalls = vi.mocked(apiRequest).mock.calls.map(([url, method]) => [String(method ?? "GET").toUpperCase(), url] as [string, string]);
    expect(apiCalls).toContainEqual(["PUT", "/api/irrigation-controllers/4"]);
    expect(fetchCalls).toContainEqual(["PUT", "/api/irrigation-controllers/4"]);
    const recorded = [...apiCalls, ...fetchCalls];
    expect(recorded.length).toBeGreaterThan(3);
    const denied = recorded.filter(([m, u]) => !isApiAllowedForRole("system_documenter", m, u));
    expect(denied).toEqual([]);
  });

  it("8. account menu: Signed in as, Switch User, Log out", async () => {
    const user = userEvent.setup();
    const nav = mount("/");
    await screen.findByRole("heading", { name: "Which property?" });
    const account = screen.getByRole("button", { name: "Account" });
    expect(account.className).toContain("h-11 w-11");
    await user.click(account);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Signed in as Rosa Delgado")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Switch User" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Signing out to switch accounts");
    expect(nav.history.at(-1)).toBe("/switch-user");
    expect(clearSessionAndLogout).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchCalls).toContainEqual(["POST", "/api/auth/logout"]));
    expect(fetchCalls.some(([, url]) => url === "/api/users")).toBe(false);
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("8b. Log out uses the real logout request and clears the current account", async () => {
    const user = userEvent.setup();
    mount("/");
    await screen.findByRole("heading", { name: "Which property?" });
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Log out" }));
    expect(clearSessionAndLogout).toHaveBeenCalledTimes(1);
    expect(fetchCalls).toContainEqual(["POST", "/api/auth/logout"]);
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("8c. direct Switch User navigation never mounts the forbidden user-list fetch", async () => {
    mount("/switch-user");
    expect(await screen.findByRole("status")).toHaveTextContent("Signing out to switch accounts");
    await waitFor(() => expect(fetchCalls).toEqual([["POST", "/api/auth/logout"]]));
    expect(clearSessionAndLogout).toHaveBeenCalledTimes(1);
  });

  it("8d. existing staff Switch User still loads its original selector", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 32, role: "field_tech", name: "Staff" }));
    fetchStub.mockImplementationOnce(async (input) => {
      fetchCalls.push(["GET", String(input)]);
      return json([]);
    });
    render(<AuthProvider><SwitchUser /></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Select User Profile" })).toBeInTheDocument();
    expect(fetchCalls).toEqual([["GET", "/api/users"]]);
    expect(clearSessionAndLogout).not.toHaveBeenCalled();
  });

  it("static: the shell imports no staff navigation, notification or footer components", () => {
    const src: string = shellSource;
    for (const forbidden of ["layout/navigation", "desktop-shell", "NotificationSystem", "NotificationPermissionBanner", "powered-by-footer", "SessionExpiredBanner"]) {
      expect(src).not.toContain(forbidden);
    }
    expect(src).toContain('variant="documenter"');
  });
});

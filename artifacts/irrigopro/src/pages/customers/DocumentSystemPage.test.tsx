/**
 * Document System Slice 4 — wizard page, site summary and controller basics.
 * Wouter harness per .agents/memory/wouter-jsdom-page-tests.md: memoryLocation
 * with BOTH hook and searchHook so `?branch=` is real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { DocumentationControllerGraph, DocumentationSite, DocumentationSites } from "@workspace/api-client-react";

const { apiRequestSpy, uploadSpy, authState } = vi.hoisted(() => ({
  apiRequestSpy: vi.fn(),
  uploadSpy: vi.fn(),
  authState: { role: "irrigation_manager" },
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: apiRequestSpy };
});
vi.mock("@/pages/wet-checks/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/pages/wet-checks/helpers")>("@/pages/wet-checks/helpers");
  return { ...actual, uploadPhotoToStorage: uploadSpy };
});
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, name: "Pat Rivera", role: authState.role, companyId: 1 }, isLoading: false }),
}));

import DocumentSystemPage from "./DocumentSystemPage";
import { hasCapability, CAN_DOCUMENT_IRRIGATION_SYSTEM } from "@workspace/shared";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function ctrl(id: number, letter: string, o: Partial<DocumentationControllerGraph> = {}): DocumentationControllerGraph {
  return {
    id, letter, name: `Clock ${letter}`, location: "Garage wall", brand: "Hunter", model: "Pro-C",
    totalZones: 2, settingsPhotoUrl: `photo-${id}`, notes: null, lastUpdatedAt: null,
    fieldVerifiedAt: null, fieldVerifiedByName: null, gaps: [], verified: false,
    programs: [], zones: [], ...o,
  };
}

const program = { id: 9, companyId: 1, controllerId: 0, name: "A", wateringDays: ["Mon"], startTimes: ["05:00"], seasonalAdjustPct: 100, isActive: true, sortOrder: 0, createdAt: "", updatedAt: "" };
const zone = (n: number) => ({ id: 100 + n, zoneNumber: n, name: `Zone ${n}`, zoneType: "Spray", zoneTypeConfirmed: true, programId: 9, runTimeMinutes: 10 });
const complete = (id: number, letter: string, o: Partial<DocumentationControllerGraph> = {}) =>
  ctrl(id, letter, { programs: [program], zones: [zone(1), zone(2)], ...o });

const slice5Gaps = [
  { step: "zone_types", code: "zone_types", label: "2 zones without a type" },
  { step: "programs", code: "programs", label: "at least one program" },
];

function siteOf(controllers: DocumentationControllerGraph[], branchName = "", branches: string[] = []): DocumentationSite {
  return {
    customer: { id: 7, name: "Harbor Pines HOA", address: "12 Dune Rd", branches },
    branchName, controllers, backflows: [],
    site: { status: "not_verified", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: false },
  };
}

function sitesOf(branches: string[] = []): DocumentationSites {
  return {
    customers: [{
      customerId: 7, name: "Harbor Pines HOA", address: "12 Dune Rd", branches,
      sites: branches.map((b, i) => ({ branchName: b, status: i ? "verified" : "nothing_on_file", verifiedAt: null, controllerCount: 0, backflowCount: 0 })),
    }],
  };
}

let site: DocumentationSite;
let sites: DocumentationSites;
let failNext: string | null = null;

function installApi() {
  apiRequestSpy.mockImplementation(async (url: string, method = "GET", data?: unknown) => {
    void data;
    if (method === "GET" && url === "/api/system-documentation/sites") return sites;
    if (method === "GET" && url.startsWith("/api/system-documentation/customers/7/site")) return site;
    if (failNext) { const m = failNext; failNext = null; throw new Error(`500: ${JSON.stringify({ message: m })}`); }
    if (url === "/api/customers/7/controllers-profile") return { id: 55, letter: "D" };
    return {};
  });
}

function writes() {
  return apiRequestSpy.mock.calls.filter(([, m]) => m && m !== "GET");
}

function renderPage(path = "/customers/7/document-system") {
  const nav = memoryLocation({ path, record: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Router hook={nav.hook} searchHook={nav.searchHook}>
        <Route path="/customers/:customerId/document-system" component={DocumentSystemPage} />
      </Router>
    </QueryClientProvider>,
  );
  return { nav, qc };
}

beforeEach(() => {
  apiRequestSpy.mockReset();
  uploadSpy.mockReset();
  failNext = null;
  sites = sitesOf();
  site = siteOf([]);
  installApi();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DocumentSystemPage — Slice 4", () => {
  it("1. summary shows Verified / Ready to verify / Needs info pills", async () => {
    site = siteOf([
      complete(1, "A", { verified: true }),
      complete(2, "B"),
      ctrl(3, "C", { gaps: [{ step: "zone_count", code: "zone_count", label: "zone count" }] }),
    ]);
    renderPage();
    expect(await screen.findByTestId("status-controller-1")).toHaveTextContent("Verified");
    expect(screen.getByTestId("status-controller-2")).toHaveTextContent("Ready to verify");
    expect(screen.getByTestId("status-controller-3")).toHaveTextContent("Needs info");
    expect(screen.getByText("What's on file")).toBeInTheDocument();
    expect(screen.getByText(/Backflow capture is coming to this screen/)).toBeInTheDocument();
  });

  it("shows the empty info box when nothing is on file", async () => {
    renderPage();
    expect(await screen.findByTestId("text-doc-empty")).toHaveTextContent("Nothing is on file for this location yet.");
  });

  it("2. two-branch customer without ?branch= shows Which location?, and tapping sets ?branch=", async () => {
    sites = sitesOf(["North Gate", "South Lot"]);
    site = siteOf([], "South Lot", ["North Gate", "South Lot"]);
    const { nav } = renderPage();
    expect(await screen.findByText("Which location?")).toBeInTheDocument();
    expect(screen.getByText("Harbor Pines HOA has 2 locations. Each one is documented and verified on its own.")).toBeInTheDocument();
    expect(screen.getByTestId("status-branch-South Lot")).toHaveTextContent("Verified");
    fireEvent.click(screen.getByTestId("branch-option-South Lot"));
    await waitFor(() => expect(nav.history.at(-1)).toBe("/customers/7/document-system?branch=South%20Lot"));
    expect(await screen.findByTestId("text-doc-subtitle")).toHaveTextContent("Harbor Pines HOA, South Lot");
    expect(apiRequestSpy).toHaveBeenCalledWith("/api/system-documentation/customers/7/site?branchName=South%20Lot", "GET");
  });

  it("3. opening a controller whose first gap is zone_count lands on Zone count", async () => {
    site = siteOf([ctrl(3, "C", { gaps: [{ step: "zone_count", code: "zone_count", label: "zone count" }, ...slice5Gaps] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-3"));
    expect(await screen.findByTestId("step-zone-count")).toBeInTheDocument();
    expect(screen.getByText("The office has 2 zones on file for this clock.")).toBeInTheDocument();
  });

  it("4. Clock details: Next disabled until all four set; changing only model sends PUT { model }", async () => {
    site = siteOf([ctrl(4, "A", { model: "", gaps: [{ step: "details", code: "model", label: "model" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-4"));
    expect(await screen.findByTestId("step-details")).toBeInTheDocument();
    expect(screen.getByText("This clock is letter A. The letter never changes when you rename it.")).toBeInTheDocument();
    const next = screen.getByTestId("button-next");
    expect(next).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("Still needed: model");
    fireEvent.click(screen.getByTestId("chip-model-ICC2"));
    expect(screen.getByTestId("chip-model-ICC2")).toHaveAttribute("aria-pressed", "true");
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    await screen.findByTestId("step-zone-count");
    expect(writes()).toEqual([["/api/irrigation-controllers/4", "PUT", { model: "ICC2" }]]);
  });

  it("changing the brand clears the model", async () => {
    site = siteOf([ctrl(4, "A", { gaps: [{ step: "details", code: "x", label: "x" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-4"));
    await screen.findByTestId("step-details");
    fireEvent.click(screen.getByTestId("chip-brand-Toro"));
    expect(screen.getByTestId("input-model")).toHaveValue("");
    expect(screen.getByTestId("button-next")).toBeDisabled();
  });

  it("5. new controller: no request until Clock details Next, then one POST with settingsPhotoUrl", async () => {
    uploadSpy.mockResolvedValue("ph-123");
    renderPage();
    fireEvent.click(await screen.findByTestId("button-add-controller"));
    expect(await screen.findByText("Tap to take photo")).toBeInTheDocument();
    expect(screen.getByTestId("button-next")).toBeDisabled();
    const file = new File(["x"], "clock.jpg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [file] } }); });
    await waitFor(() => expect(screen.getByTestId("button-next")).not.toBeDisabled());
    expect(screen.getByText("Tap to retake")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-details");
    expect(screen.getByText("A letter is assigned when you save.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByTestId("input-name"), { target: { value: "Clubhouse Clock" } });
    fireEvent.click(screen.getByTestId("chip-location-Mech room"));
    fireEvent.click(screen.getByTestId("chip-brand-Rain Bird"));
    fireEvent.click(screen.getByTestId("chip-model-ESP-ME3"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-zone-count");
    expect(writes()).toEqual([[
      "/api/customers/7/controllers-profile", "POST",
      { name: "Clubhouse Clock", location: "Mech room", brand: "Rain Bird", model: "ESP-ME3", branchName: "", settingsPhotoUrl: "ph-123" },
    ]]);
    // Going back and forward again must not create a second row.
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-details");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-zone-count");
    expect(writes().filter(([u]) => u.endsWith("controllers-profile"))).toHaveLength(1);
  });

  it("Save & exit on an unsaved draft asks before leaving", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("button-add-controller"));
    fireEvent.click(await screen.findByTestId("button-save-exit"));
    expect(await screen.findByText("Leave without saving?")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-dialog-leave"));
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it("6. zone count 12 to 10 warns, confirms, then PUT zone-count", async () => {
    site = siteOf([ctrl(6, "B", { totalZones: 12, gaps: [{ step: "zone_count", code: "zone_count", label: "zone count" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-6"));
    await screen.findByTestId("step-zone-count");
    fireEvent.click(screen.getByLabelText("Fewer zones"));
    fireEvent.click(screen.getByLabelText("Fewer zones"));
    expect(screen.getByTestId("input-zone-count")).toHaveValue(10);
    expect(screen.getByTestId("text-retire-warning")).toHaveTextContent("Zones 11 to 12 will be retired.");
    fireEvent.click(screen.getByTestId("button-next"));
    expect(await screen.findByText("Retire zones 11 to 12?")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-dialog-retire"));
    await screen.findByTestId("step-review");
    expect(writes()).toEqual([["/api/irrigation-controllers/6/zone-count", "PUT", { totalZones: 10 }]]);
  });

  it("7. Review: Verify disabled with gaps", async () => {
    site = siteOf([ctrl(7, "C", { gaps: slice5Gaps })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-7"));
    await screen.findByTestId("step-review");
    expect(screen.getByTestId("button-verify")).toBeDisabled();
    expect(screen.getByTestId("text-review-gaps")).toHaveTextContent("Still needed:");
    expect(screen.getByTestId("link-finish-in-profile")).toHaveAttribute("href", "/customers/7/irrigation-profile");
  });

  it("7b. Review without gaps posts field-verify and flashes", async () => {
    site = siteOf([complete(8, "E")]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-8"));
    await screen.findByTestId("step-review");
    expect(screen.queryByTestId("link-finish-in-profile")).toBeNull();
    fireEvent.click(screen.getByTestId("button-verify"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Controller E verified.");
    expect(writes()).toEqual([["/api/irrigation-controllers/8/field-verify", "POST"]]);
  });

  it("verify 400 shows the server message", async () => {
    site = siteOf([complete(8, "E")]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-8"));
    await screen.findByTestId("step-review");
    failNext = "Zone 2 has no program";
    fireEvent.click(screen.getByTestId("button-verify"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("Zone 2 has no program");
  });

  it("8. Not at this location sends PUT { isActive: false } after confirming", async () => {
    site = siteOf([complete(9, "F")]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-9"));
    fireEvent.click(await screen.findByTestId("button-not-here"));
    expect(await screen.findByText("Mark controller F as not at this location?")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-dialog-inactive"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Controller F marked not at this location.");
    expect(writes()).toEqual([["/api/irrigation-controllers/9", "PUT", { isActive: false }]]);
  });

  it("9. a failed save keeps the typed name and Retry resends", async () => {
    site = siteOf([ctrl(10, "G", { gaps: [{ step: "details", code: "x", label: "x" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-10"));
    await screen.findByTestId("step-details");
    fireEvent.change(screen.getByTestId("input-name"), { target: { value: "Pool Clock" } });
    failNext = "Database unavailable";
    fireEvent.click(screen.getByTestId("button-next"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("Couldn't save: Database unavailable");
    expect(screen.getByTestId("input-name")).toHaveValue("Pool Clock");
    expect(screen.getByTestId("step-details")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-retry"));
    await screen.findByTestId("step-zone-count");
    expect(writes()).toEqual([
      ["/api/irrigation-controllers/10", "PUT", { name: "Pool Clock" }],
      ["/api/irrigation-controllers/10", "PUT", { name: "Pool Clock" }],
    ]);
  });

  it("Save & exit saves the step and flashes; verified + unchanged exits silently", async () => {
    site = siteOf([complete(11, "H", { verified: true }), ctrl(12, "J", { gaps: [{ step: "details", code: "x", label: "x" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-11"));
    await screen.findByTestId("step-review");
    fireEvent.click(screen.getByTestId("button-save-exit"));
    await screen.findByText("What's on file");
    expect(screen.queryByTestId("status-doc-flash")).toBeNull();
    fireEvent.click(screen.getByTestId("row-controller-12"));
    await screen.findByTestId("step-details");
    fireEvent.change(screen.getByTestId("input-name"), { target: { value: "Shop Clock" } });
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Controller J saved. It stays unverified until you finish it.");
    expect(writes()).toEqual([["/api/irrigation-controllers/12", "PUT", { name: "Shop Clock" }]]);
  });

  it("a successful save invalidates exactly the site key", async () => {
    site = siteOf([ctrl(13, "K", { gaps: [{ step: "details", code: "x", label: "x" }] })]);
    const { qc } = renderPage();
    const spy = vi.spyOn(qc, "invalidateQueries");
    fireEvent.click(await screen.findByTestId("row-controller-13"));
    await screen.findByTestId("step-details");
    fireEvent.change(screen.getByTestId("input-name"), { target: { value: "Gate Clock" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-zone-count");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/system-documentation/customers", 7, "site", ""], exact: true });
  });
});

describe("Review regressions", () => {
  it("unchanged header/record mismatch stays a gap until a deliberate count reconciles it", async () => {
    site = siteOf([ctrl(20, "R", { totalZones: 2, zones: [], gaps: [{ step: "zone_count", code: "zone_count", label: "zone count" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-20"));
    await screen.findByTestId("step-zone-count");
    expect(screen.getByTestId("input-zone-count")).toHaveValue(2);
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("zone count");
    fireEvent.click(screen.getByTestId("chip-office-zones"));
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(writes()).toEqual([["/api/irrigation-controllers/20/zone-count", "PUT", { totalZones: 2 }]]);
  });

  it("Back from details sends a cleared optional field as null", async () => {
    site = siteOf([ctrl(21, "S", { gaps: [{ step: "details", code: "x", label: "x" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-21"));
    await screen.findByTestId("step-details");
    fireEvent.change(screen.getByTestId("input-location"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-photo");
    expect(writes()).toEqual([["/api/irrigation-controllers/21", "PUT", { location: null }]]);
  });

  it("a cleared name on Save & exit shows an error, stays, and never claims saved", async () => {
    site = siteOf([ctrl(22, "T", { gaps: [{ step: "details", code: "x", label: "x" }] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-22"));
    await screen.findByTestId("step-details");
    fireEvent.change(screen.getByTestId("input-name"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("Name can't be blank");
    expect(screen.getByTestId("step-details")).toBeInTheDocument();
    expect(screen.queryByTestId("status-doc-flash")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("Back on a complete unsaved draft keeps it locally and does not POST", async () => {
    uploadSpy.mockResolvedValue("ph-9");
    renderPage();
    fireEvent.click(await screen.findByTestId("button-add-controller"));
    await act(async () => { fireEvent.change(await screen.findByTestId("doc-photo-input"), { target: { files: [new File(["x"], "a.jpg")] } }); });
    await waitFor(() => expect(screen.getByTestId("button-next")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-details");
    fireEvent.change(screen.getByTestId("input-name"), { target: { value: "Pool" } });
    fireEvent.click(screen.getByTestId("chip-location-Pedestal"));
    fireEvent.click(screen.getByTestId("chip-brand-Toro"));
    fireEvent.click(screen.getByTestId("chip-model-Tempus"));
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-photo");
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-details");
    expect(screen.getByTestId("input-name")).toHaveValue("Pool");
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByText("Leave without saving?")).toBeInTheDocument();
  });

  it("sites list failure shows Retry instead of a site", async () => {
    let fail = true;
    apiRequestSpy.mockImplementation(async (url: string) => {
      if (url === "/api/system-documentation/sites") { if (fail) throw new Error("500: boom"); return sites; }
      return site;
    });
    renderPage();
    expect(await screen.findByTestId("doc-sites-error")).toBeInTheDocument();
    expect(apiRequestSpy.mock.calls.some(([u]) => String(u).includes("/site?"))).toBe(false);
    fail = false;
    fireEvent.click(screen.getByTestId("button-sites-retry"));
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
  });

  it("changing branch never renders the previous branch's flow", async () => {
    sites = sitesOf(["North", "South"]);
    site = siteOf([complete(30, "A")], "North", ["North", "South"]);
    const { nav } = renderPage("/customers/7/document-system?branch=North");
    fireEvent.click(await screen.findByTestId("row-controller-30"));
    await screen.findByTestId("step-review");
    act(() => nav.navigate("/customers/7/document-system?branch=South"));
    expect(screen.queryByTestId("step-review")).toBeNull();
  });

  it("upload in flight blocks Next and Save & exit; failure keeps preview and Retry upload works", async () => {
    site = siteOf([ctrl(40, "P", { gaps: [{ step: "photo", code: "photo", label: "clock photo" }] })]);
    let reject!: (e: Error) => void;
    uploadSpy.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    uploadSpy.mockResolvedValueOnce("ph-new");
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-40"));
    await screen.findByTestId("step-photo");
    await act(async () => { fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [new File(["x"], "a.jpg")] } }); });
    expect(screen.getByTestId("doc-photo-uploading")).toBeInTheDocument();
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("button-save-exit")).toBeDisabled();
    expect(screen.getByTestId("button-doc-back")).toBeDisabled();
    await act(async () => { reject(new Error("500: {\"message\":\"storage down\"}")); });
    expect(await screen.findByTestId("doc-photo-error")).toHaveTextContent("storage down");
    expect(screen.getByTestId("doc-photo-preview")).toBeInTheDocument();
    expect(screen.getByTestId("button-save-exit")).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByTestId("doc-photo-retry")); });
    await waitFor(() => expect(screen.getByTestId("button-next")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-details");
    expect(writes()).toEqual([["/api/irrigation-controllers/40/photo", "POST", { url: "ph-new" }]]);
  });
});

describe("10. Document System button role gate", () => {
  const allowed = ["irrigation_manager", "company_admin", "super_admin"];
  const denied = ["field_tech", "billing_manager", "bookkeeper"];

  it("capability matches the endpoint guard for each role", () => {
    for (const r of allowed) expect(hasCapability(r, CAN_DOCUMENT_IRRIGATION_SYSTEM)).toBe(true);
    for (const r of denied) expect(hasCapability(r, CAN_DOCUMENT_IRRIGATION_SYSTEM)).toBe(false);
  });

  it.each([...allowed.map((r) => [r, true] as const), ...denied.map((r) => [r, false] as const)])(
    "customer profile for %s shows Document System: %s",
    async (role, shown) => {
      authState.role = role;
      const { default: CustomerProfile } = await import("@/pages/customer-profile");
      const customer = { id: 7, name: "Harbor Pines HOA", address: "12 Dune Rd", branches: [], billingVisible: true };
      const qc = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            queryFn: async ({ queryKey }) => (queryKey[0] === "/api/customers/7" ? customer : []),
          },
        },
      });
      apiRequestSpy.mockImplementation(async (url: string) => (url === "/api/customers/7" ? customer : []));
      const nav = memoryLocation({ path: "/customers/7/profile" });
      render(
        <QueryClientProvider client={qc}>
          <Router hook={nav.hook} searchHook={nav.searchHook}>
            <Route path="/customers/:id/profile" component={CustomerProfile} />
          </Router>
        </QueryClientProvider>,
      );
      const name = await screen.findAllByText("Harbor Pines HOA");
      expect(name.length).toBeGreaterThan(0);
      const btn = within(document.body).queryByTestId("button-document-system");
      if (shown) expect(btn).not.toBeNull();
      else expect(btn).toBeNull();
    },
    20000,
  );
});

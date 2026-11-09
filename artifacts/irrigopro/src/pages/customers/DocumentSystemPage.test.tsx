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
import type { DocumentationBackflow, DocumentationControllerGraph, DocumentationSite, DocumentationSites } from "@workspace/api-client-react";

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
    id, letter, letterConfirmed: true, name: `Clock ${letter}`, location: "Garage wall", brand: "Hunter", model: "Pro-C",
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
let custom: ((url: string, method: string, data: unknown) => unknown) | null = null;

function installApi() {
  apiRequestSpy.mockImplementation(async (url: string, method = "GET", data?: unknown) => {
    void data;
    if (method === "GET" && url === "/api/system-documentation/sites") return sites;
    if (method === "GET" && url.startsWith("/api/system-documentation/customers/7/site")) return site;
    if (custom) { const out = custom(url, method, data); if (out !== undefined) return out; }
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
  custom = null;
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
    expect(screen.queryByText(/Backflow capture is coming to this screen/)).toBeNull();
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

  it("5. new controller cannot bypass on-site letter confirmation before the letter-picker slice", async () => {
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
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("clock letter confirmed on site");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-next"));
    expect(screen.getByTestId("step-details")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
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
    await screen.findByTestId("step-zone-types");
    expect(writes()).toEqual([["/api/irrigation-controllers/6/zone-count", "PUT", { totalZones: 10 }]]);
  });

  it("7. Review: Verify disabled with gaps", async () => {
    site = siteOf([ctrl(7, "C", { gaps: [] })]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-7"));
    await screen.findByTestId("step-review");
    expect(screen.getByTestId("button-verify")).toBeDisabled();
    expect(screen.getByTestId("text-review-gaps")).toHaveTextContent("Still needed:");
    expect(screen.queryByTestId("link-finish-in-profile")).toBeNull();
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
    await screen.findByTestId("step-zone-types");
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

// ─── Slice 5 — zone types, programs and run times ─────────────────────────────

type Z = DocumentationControllerGraph["zones"][number];
type P = DocumentationControllerGraph["programs"][number];
const z5 = (n: number, o: Partial<Z> = {}): Z => ({ id: 100 + n, zoneNumber: n, name: `Zone ${n}`, zoneType: "other", zoneTypeConfirmed: false, programId: null, runTimeMinutes: 0, ...o });
const p5 = (id: number, name: string, o: Partial<P> = {}): P => ({ ...program, id, name, wateringDays: ["Mon"], startTimes: ["05:00"], ...o });
const range = (n: number, o: Partial<Z> = {}) => Array.from({ length: n }, (_, i) => z5(i + 1, o));
const gap = (step: string) => [{ step, code: step, label: step }];
const bulk = () => writes().filter(([u]) => String(u).endsWith("/zones/bulk"));

async function open(c: DocumentationControllerGraph, testId: string) {
  site = siteOf([c]);
  const r = renderPage();
  fireEvent.click(await screen.findByTestId(`row-controller-${c.id}`));
  await screen.findByTestId(testId);
  return r;
}

describe("Slice 5 — zone types", () => {
  it("1. brush Rotor on zones 3 and 4 shows Rotor and the counter goes up by 2", async () => {
    await open(ctrl(50, "A", { totalZones: 4, zones: range(4), gaps: gap("zone_types") }), "step-zone-types");
    expect(screen.getByTestId("text-typed-counter")).toHaveTextContent("0 of 4 zones typed");
    fireEvent.click(screen.getByTestId("chip-brush-rotor"));
    fireEvent.click(screen.getByLabelText("Zone 3, no type"));
    fireEvent.click(screen.getByLabelText("Zone 4, no type"));
    expect(screen.getByLabelText("Zone 3, Rotor")).toHaveTextContent("Rotor");
    expect(screen.getByLabelText("Zone 4, Rotor")).toHaveTextContent("Rotor");
    expect(screen.getByTestId("text-typed-counter")).toHaveTextContent("2 of 4 zones typed");
  });

  it("2. a stored-other zone tapped with Other is still sent, grouped by type", async () => {
    const zones = range(7).map((z) => ([3, 4, 7].includes(z.zoneNumber) ? z : { ...z, zoneType: "rotor", zoneTypeConfirmed: true }));
    await open(ctrl(51, "A", { totalZones: 7, zones, gaps: gap("zone_types") }), "step-zone-types");
    fireEvent.click(screen.getByTestId("chip-brush-rotor"));
    fireEvent.click(screen.getByTestId("tile-zone-3"));
    fireEvent.click(screen.getByTestId("tile-zone-4"));
    fireEvent.click(screen.getByTestId("chip-brush-other"));
    fireEvent.click(screen.getByTestId("tile-zone-7"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-programs");
    expect(writes()).toEqual([
      ["/api/irrigation-controllers/51/zones/bulk", "PUT", { zoneIds: [103, 104], patch: { zoneType: "rotor" } }],
      ["/api/irrigation-controllers/51/zones/bulk", "PUT", { zoneIds: [107], patch: { zoneType: "other" } }],
    ]);
  });

  it("3. Next disabled until every zone typed; Set the 5 untyped zones to Spray fills exactly those", async () => {
    const zones = range(7).map((z) => (z.zoneNumber <= 2 ? { ...z, zoneType: "drip", zoneTypeConfirmed: true } : z));
    await open(ctrl(52, "A", { totalZones: 7, zones, gaps: gap("zone_types") }), "step-zone-types");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-fill-untyped"));
    expect(screen.queryByTestId("button-fill-untyped")).toBeNull();
    expect(screen.getByLabelText("Zone 1, Drip")).toBeInTheDocument();
    for (const n of [3, 4, 5, 6, 7]) expect(screen.getByLabelText(`Zone ${n}, Spray`)).toBeInTheDocument();
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-programs");
    expect(writes()).toEqual([["/api/irrigation-controllers/52/zones/bulk", "PUT", { zoneIds: [103, 104, 105, 106, 107], patch: { zoneType: "pop_up_spray" } }]]);
  });

  it("the fill button label counts untyped zones", async () => {
    await open(ctrl(53, "A", { totalZones: 5, zones: range(5), gaps: gap("zone_types") }), "step-zone-types");
    expect(screen.getByTestId("button-fill-untyped")).toHaveTextContent("Set the 5 untyped zones to Spray");
  });

  it("tapped tiles survive a site refetch", async () => {
    const { qc } = await open(ctrl(54, "A", { totalZones: 3, zones: range(3), gaps: gap("zone_types") }), "step-zone-types");
    fireEvent.click(screen.getByTestId("chip-brush-drip"));
    fireEvent.click(screen.getByTestId("tile-zone-2"));
    await act(async () => { await qc.refetchQueries(); });
    expect(screen.getByLabelText("Zone 2, Drip")).toBeInTheDocument();
    expect(screen.getByTestId("text-typed-counter")).toHaveTextContent("1 of 3 zones typed");
  });

  it("drafts stay with their controller", async () => {
    site = siteOf([
      ctrl(56, "A", { totalZones: 2, zones: range(2), gaps: gap("zone_types") }),
      ctrl(57, "B", { totalZones: 2, zones: range(2).map((z) => ({ ...z, id: z.id + 50 })), gaps: gap("zone_types") }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-56"));
    await screen.findByTestId("step-zone-types");
    fireEvent.click(screen.getByTestId("tile-zone-1"));
    fireEvent.click(screen.getByTestId("button-save-exit"));
    await screen.findByText("What's on file");
    fireEvent.click(screen.getByTestId("row-controller-57"));
    await screen.findByTestId("step-zone-types");
    expect(screen.getByLabelText("Zone 1, no type")).toBeInTheDocument();
    expect(writes()).toEqual([["/api/irrigation-controllers/56/zones/bulk", "PUT", { zoneIds: [101], patch: { zoneType: "pop_up_spray" } }]]);
  });

  it("an audited controller with an unknown count gets real zone ids after Zone count", async () => {
    site = siteOf([ctrl(55, "D", { totalZones: null, zones: [], gaps: [{ step: "zone_count", code: "zone_count", label: "zone count" }] })]);
    custom = (url, method) => {
      if (url === "/api/irrigation-controllers/55/zone-count" && method === "PUT") {
        site = siteOf([ctrl(55, "D", { totalZones: 3, zones: [z5(1, { id: 551 }), z5(2, { id: 552 }), z5(3, { id: 553 })] })]);
        return {};
      }
      return undefined;
    };
    renderPage();
    fireEvent.click(await screen.findByTestId("row-controller-55"));
    await screen.findByTestId("step-zone-count");
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText("More zones"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-zone-types");
    fireEvent.click(await screen.findByTestId("button-fill-untyped"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-programs");
    expect(bulk()).toEqual([["/api/irrigation-controllers/55/zones/bulk", "PUT", { zoneIds: [551, 552, 553], patch: { zoneType: "pop_up_spray" } }]]);
  });
});

describe("Slice 5 — programs", () => {
  const typed = (n: number, o: Partial<Z> = {}) => range(n, { zoneType: "rotor", zoneTypeConfirmed: true, ...o });

  it("4. with A and inactive C, + Add program posts B and selects it", async () => {
    custom = (url, method, data) => (method === "POST" && url.endsWith("/programs") ? { ...p5(12, (data as { name: string }).name, { wateringDays: [], startTimes: [] }) } : undefined);
    await open(ctrl(60, "A", { totalZones: 2, zones: typed(2), programs: [p5(9, "A"), p5(11, "C", { isActive: false })], gaps: gap("programs") }), "step-programs");
    expect(screen.queryByTestId("tab-program-C")).toBeNull();
    fireEvent.click(screen.getByTestId("button-add-program"));
    await waitFor(() => expect(screen.getByTestId("tab-program-B")).toHaveAttribute("aria-pressed", "true"));
    expect(writes()).toEqual([["/api/irrigation-controllers/60/programs", "POST", { name: "B", wateringDays: [], startTimes: [], seasonalAdjustPct: 100 }]]);
  });

  it("no active programs shows the info box", async () => {
    await open(ctrl(61, "A", { totalZones: 2, zones: typed(2), programs: [], gaps: gap("programs") }), "step-programs");
    expect(screen.getByTestId("text-no-programs")).toHaveTextContent("No programs yet. Add the first one that's set on the clock.");
    expect(screen.getByTestId("button-next")).toBeDisabled();
  });

  it("5. days and times are sent in week order, blanks dropped, sorted", async () => {
    await open(ctrl(62, "A", { totalZones: 2, zones: typed(2), programs: [p5(9, "A", { wateringDays: [], startTimes: [] })], gaps: gap("programs") }), "step-programs");
    fireEvent.click(screen.getByTestId("chip-day-Wed"));
    fireEvent.click(screen.getByTestId("chip-day-Mon"));
    fireEvent.change(screen.getByTestId("input-start-time-0"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByTestId("button-add-time"));
    fireEvent.click(screen.getByTestId("button-add-time"));
    fireEvent.change(screen.getByTestId("input-start-time-2"), { target: { value: "05:00" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    expect(writes()).toEqual([["/api/irrigation-programs/9", "PUT", { wateringDays: ["Mon", "Wed"], startTimes: ["05:00", "18:30"] }]]);
  });

  it("6. a program with no days blocks Next", async () => {
    await open(ctrl(63, "A", { totalZones: 2, zones: typed(2), programs: [p5(9, "A", { wateringDays: [] })], gaps: gap("programs") }), "step-programs");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("Still needed: Program A days");
  });

  it("7. Remove program confirms, then DELETEs immediately", async () => {
    await open(ctrl(64, "A", { totalZones: 2, zones: typed(2), programs: [p5(9, "A")], gaps: gap("programs") }), "step-programs");
    fireEvent.click(screen.getByTestId("button-remove-program"));
    expect(await screen.findByText("Remove Program A? Zones on it lose their program.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-dialog-remove-program"));
    await screen.findByTestId("text-no-programs");
    expect(writes()).toEqual([["/api/irrigation-programs/9", "DELETE"]]);
  });

  it("removing a program clears its zone assignments", async () => {
    await open(ctrl(65, "A", { totalZones: 2, zones: typed(2, { programId: 9, runTimeMinutes: 10 }), programs: [p5(9, "A"), p5(10, "B")], gaps: gap("programs") }), "step-programs");
    fireEvent.click(screen.getByTestId("button-remove-program"));
    fireEvent.click(await screen.findByTestId("button-dialog-remove-program"));
    await waitFor(() => expect(screen.queryByTestId("tab-program-A")).toBeNull());
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("2 zones without a program");
  });

  it("switching tabs keeps each program's draft; only edited programs are sent", async () => {
    await open(ctrl(66, "A", { totalZones: 2, zones: typed(2), programs: [p5(9, "A"), p5(10, "B")], gaps: gap("programs") }), "step-programs");
    fireEvent.click(screen.getByTestId("chip-day-Tue"));
    fireEvent.click(screen.getByTestId("tab-program-B"));
    expect(screen.getByTestId("chip-day-Tue")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("tab-program-A"));
    expect(screen.getByTestId("chip-day-Tue")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("button-seasonal-plus"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    expect(writes()).toEqual([["/api/irrigation-programs/9", "PUT", { wateringDays: ["Mon", "Tue"], seasonalAdjustPct: 110 }]]);
  });
});

describe("Slice 5 — run times and review", () => {
  const ready = (n: number, o: Partial<Z> = {}) => range(n, { zoneType: "rotor", zoneTypeConfirmed: true, ...o });

  it("8. Set all (A, 12), zone 5 to 15, Next sends two grouped bulk calls", async () => {
    await open(ctrl(70, "A", { totalZones: 5, zones: ready(5), programs: [p5(9, "A")], gaps: gap("run_times") }), "step-run-times");
    fireEvent.click(screen.getByLabelText("Set all more minutes"));
    fireEvent.click(screen.getByLabelText("Set all more minutes"));
    fireEvent.click(screen.getByTestId("button-apply-all"));
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByLabelText("Zone 5 more minutes"));
    expect(screen.getByTestId("input-minutes-5")).toHaveValue("15");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(bulk()).toEqual([
      ["/api/irrigation-controllers/70/zones/bulk", "PUT", { zoneIds: [101, 102, 103, 104], patch: { programId: 9, runTimeMinutes: 12 } }],
      ["/api/irrigation-controllers/70/zones/bulk", "PUT", { zoneIds: [105], patch: { programId: 9, runTimeMinutes: 15 } }],
    ]);
  });

  it("9. picking a program on a 0-minute row uses the Set all minutes", async () => {
    await open(ctrl(71, "A", { totalZones: 2, zones: ready(2), programs: [p5(9, "A")], gaps: gap("run_times") }), "step-run-times");
    fireEvent.click(screen.getByLabelText("Zone 2 on program A"));
    expect(screen.getByTestId("input-minutes-2")).toHaveValue("10");
    expect(screen.getByTestId("input-minutes-1")).toHaveValue("0");
  });

  it("zero-minute Zone 8 is complete, saves zero, appears in Review and can Verify", async () => {
    const zones = ready(8, { programId: 9, runTimeMinutes: 10 });
    zones[7] = { ...zones[7], programId: null, runTimeMinutes: 0 };
    await open(ctrl(79, "A", { totalZones: 8, zones, programs: [p5(9, "A")], gaps: gap("run_times") }), "step-run-times");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("1 zone without a program");
    fireEvent.click(screen.getByLabelText("Zone 8 on program A"));
    expect(screen.getByTestId("input-minutes-8")).toHaveValue("10");
    fireEvent.change(screen.getByTestId("input-minutes-8"), { target: { value: "0" } });
    expect(within(screen.getByTestId("row-run-zone-8")).getByText("Zone 8")).not.toHaveClass("text-amber-700");
    expect(screen.getByLabelText("Zone 8 fewer minutes")).toBeDisabled();
    expect(screen.queryByTestId("text-still-needed")).toBeNull();
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(bulk()).toEqual([["/api/irrigation-controllers/79/zones/bulk", "PUT", { zoneIds: [108], patch: { programId: 9, runTimeMinutes: 0 } }]]);
    expect(screen.getByTestId("text-review-programs")).toHaveTextContent("Program A: Mon at 5:00 AM, 100%, 8 zones (1 at 0 min), 70 min");
    expect(screen.getByTestId("button-verify")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-verify"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Controller A verified.");
  });

  it("stored zeros and minus-to-zero stay complete; Review counts zeros separately per program", async () => {
    const zones = [
      ...ready(3, { programId: 9, runTimeMinutes: 0 }),
      z5(4, { zoneTypeConfirmed: true, programId: 10, runTimeMinutes: 12 }),
    ];
    zones[0].runTimeMinutes = 1;
    await open(ctrl(78, "A", { totalZones: 4, zones, programs: [p5(9, "A"), p5(10, "B")], gaps: gap("run_times") }), "step-run-times");
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("Zone 1 fewer minutes"));
    expect(screen.getByTestId("input-minutes-1")).toHaveValue("0");
    expect(screen.getByLabelText("Zone 1 fewer minutes")).toBeDisabled();
    for (const n of [1, 2, 3]) expect(within(screen.getByTestId(`row-run-zone-${n}`)).getByText(`Zone ${n}`)).not.toHaveClass("text-amber-700");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(screen.getByTestId("text-review-programs")).toHaveTextContent("Program A: Mon at 5:00 AM, 100%, 3 zones (3 at 0 min), 0 min");
    expect(screen.getByTestId("text-review-programs")).toHaveTextContent("Program B: Mon at 5:00 AM, 100%, 1 zone, 12 min");
  });

  it.each([null, 999, 10])("missing, unknown and inactive program %s stays amber and blocks Next", async (programId) => {
    await open(ctrl(77, "A", {
      totalZones: 1, zones: ready(1, { programId, runTimeMinutes: 10 }),
      programs: [p5(9, "A"), p5(10, "B", { isActive: false })], gaps: gap("run_times"),
    }), "step-run-times");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("1 zone without a program");
    expect(within(screen.getByTestId("row-run-zone-1")).getByText("Zone 1")).toHaveClass("text-amber-700");
  });

  it("10. a failing second bulk call; Retry sends only the unsent group", async () => {
    let n = 0;
    custom = (url) => {
      if (url.endsWith("/zones/bulk") && ++n === 2) throw new Error(`500: ${JSON.stringify({ message: "Could not update zones" })}`);
      return undefined;
    };
    await open(ctrl(72, "A", { totalZones: 2, zones: ready(2), programs: [p5(9, "A")], gaps: gap("run_times") }), "step-run-times");
    fireEvent.click(screen.getByTestId("button-apply-all"));
    fireEvent.click(screen.getByLabelText("Zone 2 more minutes"));
    fireEvent.click(screen.getByTestId("button-next"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("Couldn't save: Could not update zones");
    expect(screen.getByTestId("input-minutes-2")).toHaveValue("11");
    fireEvent.click(screen.getByTestId("button-retry"));
    await screen.findByTestId("step-review");
    const g1 = ["/api/irrigation-controllers/72/zones/bulk", "PUT", { zoneIds: [101], patch: { programId: 9, runTimeMinutes: 10 } }];
    const g2 = ["/api/irrigation-controllers/72/zones/bulk", "PUT", { zoneIds: [102], patch: { programId: 9, runTimeMinutes: 11 } }];
    expect(bulk()).toEqual([g1, g2, g2]);
  });

  it("11. Review shows Types and Programs lines and no Controllers & Zones link", async () => {
    const zones = ready(4, { programId: 9, runTimeMinutes: 12 }).map((z) => (z.zoneNumber < 4 ? { ...z, zoneType: "pop_up_spray" } : z));
    await open(ctrl(73, "A", { totalZones: 4, zones, programs: [p5(9, "A", { wateringDays: ["Fri", "Mon", "Wed"] })] }), "step-review");
    expect(screen.getByTestId("text-review-types")).toHaveTextContent("Spray 3, Rotor 1");
    expect(screen.getByTestId("text-review-programs")).toHaveTextContent("Program A: Mon Wed Fri at 5:00 AM, 100%, 4 zones, 48 min");
    expect(screen.queryByTestId("link-finish-in-profile")).toBeNull();
  });

  it("12. full path from zone types to an enabled Verify", async () => {
    custom = (url, method) => (method === "POST" && url.endsWith("/programs") ? p5(12, "A", { wateringDays: [], startTimes: [] }) : undefined);
    await open(ctrl(74, "A", { totalZones: 2, zones: range(2), programs: [], gaps: gap("zone_types") }), "step-zone-types");
    fireEvent.click(screen.getByTestId("button-fill-untyped"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-programs");
    fireEvent.click(screen.getByTestId("button-add-program"));
    await screen.findByTestId("card-program-A");
    fireEvent.click(screen.getByTestId("chip-day-Mon"));
    fireEvent.change(screen.getByTestId("input-start-time-0"), { target: { value: "05:00" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    fireEvent.click(screen.getByTestId("button-apply-all"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(screen.getByTestId("button-verify")).toHaveTextContent("Verify controller A");
    expect(screen.getByTestId("button-verify")).not.toBeDisabled();
  });
});

describe("Run times — typed minutes", () => {
  async function openMinutes(o: Partial<Z> = {}, count = 4) {
    return open(ctrl(90, "A", {
      totalZones: count,
      zones: range(count, { zoneType: "rotor", zoneTypeConfirmed: true, programId: 9, runTimeMinutes: 10, ...o }),
      programs: [p5(9, "A")], gaps: gap("run_times"),
    }), "step-run-times");
  }
  function input(n: number | "all" = 1) {
    return screen.getByTestId(n === "all" ? "input-set-all-minutes" : `input-minutes-${n}`) as HTMLInputElement;
  }
  function typeMinutes(n: number | "all", text: string) {
    const el = input(n);
    act(() => el.focus());
    fireEvent.change(el, { target: { value: text } });
    return el;
  }
  function blur(el: HTMLInputElement) {
    act(() => el.blur());
  }

  it("selects the current text, keeps typing local, and saves typed 32 with Next", async () => {
    await openMinutes({ runTimeMinutes: 0 }, 1);
    const el = input();
    expect(el).toHaveAttribute("type", "text");
    expect(el).toHaveAttribute("inputmode", "numeric");
    expect(el).toHaveAttribute("pattern", "[0-9]*");
    expect(el).toHaveAttribute("enterkeyhint", "next");
    expect(el).toHaveAccessibleName("Zone 1 minutes");
    act(() => el.focus());
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 1]);
    const calls = apiRequestSpy.mock.calls.length;
    fireEvent.change(el, { target: { value: "3" } });
    fireEvent.change(el, { target: { value: "32" } });
    expect(el).toHaveValue("32");
    expect(apiRequestSpy).toHaveBeenCalledTimes(calls);
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(bulk()).toEqual([["/api/irrigation-controllers/90/zones/bulk", "PUT", { zoneIds: [101], patch: { programId: 9, runTimeMinutes: 32 } }]]);
  });

  it("keeps overflow text red across rerenders, commits 120, and normalizes on blur", async () => {
    const { qc } = await openMinutes();
    const el = typeMinutes(1, "150");
    expect(el).toHaveValue("150");
    expect(el).toHaveClass("border-red-400");
    expect(screen.getByLabelText("Zone 1 more minutes")).toBeDisabled();
    await act(async () => { await qc.refetchQueries(); });
    expect(el).toHaveValue("150");
    blur(el);
    expect(el).toHaveValue("120");
    expect(el).not.toHaveClass("border-red-400");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(bulk()[0][2]).toEqual({ zoneIds: [101], patch: { programId: 9, runTimeMinutes: 120 } });
  });

  it("restores a blank without a new edit, even after a refetch or an earlier commit", async () => {
    const { qc } = await openMinutes();
    const el = typeMinutes(1, "");
    await act(async () => { await qc.refetchQueries(); });
    expect(el).toHaveValue("");
    blur(el);
    expect(el).toHaveValue("10");
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-programs");
    expect(bulk()).toEqual([]);
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    typeMinutes(1, "32");
    fireEvent.change(input(), { target: { value: "" } });
    blur(input());
    expect(input()).toHaveValue("32");
    fireEvent.click(screen.getByTestId("button-save-exit"));
    await screen.findByTestId("status-doc-flash");
    expect(bulk()).toEqual([["/api/irrigation-controllers/90/zones/bulk", "PUT", { zoneIds: [101], patch: { programId: 9, runTimeMinutes: 32 } }]]);
  });

  it("drops letters and limits the raw text to three digits", async () => {
    await openMinutes();
    const el = typeMinutes(1, "3a2");
    expect(el).toHaveValue("32");
    fireEvent.change(el, { target: { value: "12345x" } });
    expect(el).toHaveValue("123");
    blur(el);
    expect(el).toHaveValue("120");
    typeMinutes(1, "0");
    expect(screen.getByLabelText("Zone 1 fewer minutes")).toBeDisabled();
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
  });

  it("Enter blurs and selects the next numbered zone; terminal and Set all Enter just blur", async () => {
    await openMinutes();
    const third = typeMinutes(3, "32");
    fireEvent.keyDown(third, { key: "Enter" });
    expect(input(4)).toHaveFocus();
    expect([input(4).selectionStart, input(4).selectionEnd]).toEqual([0, 2]);
    fireEvent.keyDown(input(4), { key: "Enter" });
    expect(input(4)).not.toHaveFocus();
    const all = typeMinutes("all", "32");
    fireEvent.keyDown(all, { key: "Enter" });
    expect(all).not.toHaveFocus();
    expect(input(1)).not.toHaveFocus();
    expect(bulk()).toEqual([]);
  });

  it("Set all typing affects no rows until Apply, then uses the typed value on every row", async () => {
    await openMinutes();
    const all = typeMinutes("all", "32");
    expect(all).toHaveAccessibleName("Set all minutes");
    expect([all.selectionStart, all.selectionEnd]).toEqual([2, 2]);
    for (const n of [1, 2, 3, 4]) expect(input(n)).toHaveValue("10");
    expect(writes()).toEqual([]);
    blur(all);
    fireEvent.click(screen.getByTestId("button-apply-all"));
    for (const n of [1, 2, 3, 4]) expect(input(n)).toHaveValue("32");
    fireEvent.click(screen.getByLabelText("Set all fewer minutes"));
    expect(all).toHaveValue("31");
    fireEvent.click(screen.getByLabelText("Set all more minutes"));
    expect(all).toHaveValue("32");
    fireEvent.click(screen.getByLabelText("Zone 1 fewer minutes"));
    expect(input()).toHaveValue("31");
    fireEvent.click(screen.getByLabelText("Zone 1 more minutes"));
    expect(input()).toHaveValue("32");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(bulk()).toEqual([["/api/irrigation-controllers/90/zones/bulk", "PUT", { zoneIds: [101, 102, 103, 104], patch: { programId: 9, runTimeMinutes: 32 } }]]);
  });

  it("Set all enforces 1–120, restores blanks, and supplies program defaults", async () => {
    await openMinutes({ programId: null, runTimeMinutes: 0 });
    const all = typeMinutes("all", "0");
    blur(all);
    expect(all).toHaveValue("1");
    typeMinutes("all", "150");
    expect(all).toHaveValue("150");
    expect(all).toHaveClass("border-red-400");
    blur(all);
    expect(all).toHaveValue("120");
    typeMinutes("all", "");
    blur(all);
    expect(all).toHaveValue("120");
    typeMinutes("all", "32");
    blur(all);
    fireEvent.click(screen.getByLabelText("Zone 1 on program A"));
    expect(input()).toHaveValue("32");
    expect(input(2)).toHaveValue("0");
    expect(writes()).toEqual([]);
  });

  it("minutes without a program stay amber and incomplete and persist with Back and Save & exit", async () => {
    await openMinutes({ programId: null, runTimeMinutes: 0 }, 2);
    typeMinutes(1, "32");
    expect(screen.getByLabelText("Zone 1 on program A")).toHaveAttribute("aria-pressed", "false");
    expect(within(screen.getByTestId("row-run-zone-1")).getByText("Zone 1")).toHaveClass("text-amber-700");
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("2 zones without a program");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-programs");
    expect(bulk()).toEqual([["/api/irrigation-controllers/90/zones/bulk", "PUT", { zoneIds: [101], patch: { programId: null, runTimeMinutes: 32 } }]]);
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    expect(input()).toHaveValue("32");
    typeMinutes(2, "15");
    fireEvent.click(screen.getByTestId("button-save-exit"));
    await screen.findByTestId("status-doc-flash");
    expect(bulk().at(-1)?.[2]).toEqual({ zoneIds: [102], patch: { programId: null, runTimeMinutes: 15 } });
  });

  it("typed values survive a failed group and Retry sends only the unsent group", async () => {
    let n = 0;
    custom = (url) => {
      if (url.endsWith("/zones/bulk") && ++n === 2) throw new Error("500: save failed");
      return undefined;
    };
    await openMinutes({}, 2);
    typeMinutes(1, "32");
    typeMinutes(2, "15");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("text-save-error");
    expect(input()).toHaveValue("32");
    expect(input(2)).toHaveValue("15");
    fireEvent.click(screen.getByTestId("button-retry"));
    await screen.findByTestId("step-review");
    const first = ["/api/irrigation-controllers/90/zones/bulk", "PUT", { zoneIds: [101], patch: { programId: 9, runTimeMinutes: 32 } }];
    const second = ["/api/irrigation-controllers/90/zones/bulk", "PUT", { zoneIds: [102], patch: { programId: 9, runTimeMinutes: 15 } }];
    expect(bulk()).toEqual([first, second, second]);
  });
});

describe("Slice 5 — review fixes", () => {
  const ready = (n: number, o: Partial<Z> = {}) => range(n, { zoneType: "rotor", zoneTypeConfirmed: true, ...o });

  it("Back and Save & exit persist minutes on rows without a program (programId: null)", async () => {
    await open(ctrl(80, "A", { totalZones: 2, zones: ready(2), programs: [p5(9, "A")], gaps: gap("run_times") }), "step-run-times");
    fireEvent.click(screen.getByLabelText("Zone 1 more minutes"));
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-programs");
    expect(bulk()).toEqual([["/api/irrigation-controllers/80/zones/bulk", "PUT", { zoneIds: [101], patch: { programId: null, runTimeMinutes: 1 } }]]);
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    expect(screen.getByTestId("input-minutes-1")).toHaveValue("1");
    fireEvent.click(screen.getByLabelText("Zone 2 more minutes"));
    fireEvent.click(screen.getByTestId("button-save-exit"));
    await screen.findByTestId("status-doc-flash");
    expect(bulk().at(-1)).toEqual(["/api/irrigation-controllers/80/zones/bulk", "PUT", { zoneIds: [102], patch: { programId: null, runTimeMinutes: 1 } }]);
  });

  it("controls are disabled while a save is pending", async () => {
    let release!: () => void;
    custom = (url) => (url.endsWith("/zones/bulk") || url.startsWith("/api/irrigation-programs/")
      ? new Promise((r) => { release = () => r({}); }) : undefined);
    await open(ctrl(81, "A", { totalZones: 2, zones: range(2), programs: [p5(9, "A")], gaps: gap("zone_types") }), "step-zone-types");
    fireEvent.click(screen.getByTestId("button-fill-untyped"));
    fireEvent.click(screen.getByTestId("button-next"));
    await waitFor(() => expect(screen.getByTestId("tile-zone-1")).toBeDisabled());
    expect(screen.getByTestId("chip-brush-rotor")).toBeDisabled();
    await act(async () => { release(); });
    await screen.findByTestId("step-programs");
    fireEvent.click(screen.getByTestId("chip-day-Tue"));
    fireEvent.click(screen.getByTestId("button-next"));
    await waitFor(() => expect(screen.getByTestId("input-start-time-0")).toBeDisabled());
    expect(screen.getByTestId("chip-day-Wed")).toBeDisabled();
    expect(screen.getByTestId("button-remove-program")).toBeDisabled();
    await act(async () => { release(); });
    await screen.findByTestId("step-run-times");
  });

  it("a save marks profile list (any branch), detail, history and picker caches stale", async () => {
    const { qc } = await open(ctrl(82, "A", { totalZones: 2, zones: range(2), gaps: gap("zone_types") }), "step-zone-types");
    const keys = [
      ["/api/customers/7/controllers-profile"],
      ["/api/customers/7/controllers-profile?branchName=North"],
      ["/api/irrigation-controllers/82"],
      ["/api/irrigation-controllers/82/history"],
    ];
    const sitesReads = () => apiRequestSpy.mock.calls.filter(([u]) => u === "/api/system-documentation/sites").length;
    const before = sitesReads();
    const other = ["/api/customers/8/controllers-profile"];
    for (const k of [...keys, other]) qc.setQueryData(k, { cached: true });
    fireEvent.click(screen.getByTestId("button-fill-untyped"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-programs");
    await waitFor(() => { for (const k of keys) expect(qc.getQueryState(k)?.isInvalidated).toBe(true); });
    expect(qc.getQueryState(other)?.isInvalidated).toBe(false);
    // The picker statuses list is mounted, so invalidation refetches it.
    await waitFor(() => expect(sitesReads()).toBeGreaterThan(before));
  });

  it("a deleted program's letter is free again", async () => {
    custom = (url, method, data) => (method === "POST" && url.endsWith("/programs") ? p5(12, (data as { name: string }).name, { wateringDays: [], startTimes: [] }) : undefined);
    await open(ctrl(83, "A", { totalZones: 2, zones: ready(2), programs: [p5(9, "A")], gaps: gap("programs") }), "step-programs");
    fireEvent.click(screen.getByTestId("button-remove-program"));
    fireEvent.click(await screen.findByTestId("button-dialog-remove-program"));
    await screen.findByTestId("text-no-programs");
    fireEvent.click(screen.getByTestId("button-add-program"));
    await screen.findByTestId("tab-program-A");
    expect(writes().at(-1)).toEqual(["/api/irrigation-controllers/83/programs", "POST", { name: "A", wateringDays: [], startTimes: [], seasonalAdjustPct: 100 }]);
  });

  it("sends only the selected controller's zone and program IDs across branch and customer navigation", async () => {
    const scoped = (id: number, programId: number, zoneId: number, step: string) =>
      ctrl(id, "A", {
        totalZones: 2,
        programs: [p5(programId, "A", { controllerId: id })],
        zones: range(2, { zoneTypeConfirmed: step !== "zone_types" }).map((z, i) => ({ ...z, id: zoneId + i })),
        gaps: gap(step),
      });
    const north = siteOf([scoped(101, 501, 1001, "zone_types"), scoped(102, 502, 1101, "run_times")], "North", ["North", "South"]);
    const south = siteOf([scoped(201, 601, 2001, "run_times")], "South", ["North", "South"]);
    const other = { ...siteOf([scoped(301, 701, 3001, "run_times")], "West"), customer: { ...site.customer, id: 8, name: "Other property", branches: ["West"] } };
    apiRequestSpy.mockImplementation(async (url: string, method = "GET") => {
      if (method !== "GET") return {};
      if (url === "/api/system-documentation/sites") return sitesOf(["North", "South"]);
      if (url.includes("/customers/8/site")) return other;
      return url.includes("branchName=South") ? south : north;
    });
    const { nav } = renderPage("/customers/7/document-system?branch=North");
    fireEvent.click(await screen.findByTestId("row-controller-101"));
    await screen.findByTestId("step-zone-types");
    fireEvent.click(screen.getByTestId("button-fill-untyped"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-programs");
    fireEvent.click(screen.getByTestId("chip-day-Tue"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-run-times");
    fireEvent.click(screen.getByTestId("button-apply-all"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    for (const [path, id] of [
      ["/customers/7/document-system?branch=South", 201],
      ["/customers/8/document-system?branch=West", 301],
    ] as const) {
      act(() => nav.navigate(path));
      fireEvent.click(await screen.findByTestId(`row-controller-${id}`));
      await screen.findByTestId("step-run-times");
      expect(screen.getByTestId("input-minutes-1")).toHaveValue("0");
      fireEvent.click(screen.getByTestId("button-apply-all"));
      fireEvent.click(screen.getByTestId("button-next"));
      await screen.findByTestId("step-review");
    }
    expect(writes()).toEqual([
      ["/api/irrigation-controllers/101/zones/bulk", "PUT", { zoneIds: [1001, 1002], patch: { zoneType: "pop_up_spray" } }],
      ["/api/irrigation-programs/501", "PUT", { wateringDays: ["Mon", "Tue"] }],
      ["/api/irrigation-controllers/101/zones/bulk", "PUT", { zoneIds: [1001, 1002], patch: { programId: 501, runTimeMinutes: 10 } }],
      ["/api/irrigation-controllers/201/zones/bulk", "PUT", { zoneIds: [2001, 2002], patch: { programId: 601, runTimeMinutes: 10 } }],
      ["/api/irrigation-controllers/301/zones/bulk", "PUT", { zoneIds: [3001, 3002], patch: { programId: 701, runTimeMinutes: 10 } }],
    ]);
  });
});

// ─── Slice 6 — backflow flow and Finish ───────────────────────────────────────

function bf(id: number, o: Partial<DocumentationBackflow> = {}): DocumentationBackflow {
  return {
    id, branchName: "", name: `Backflow ${id}`, brand: "Watts", model: "009", size: '1"', deviceType: "rpz",
    serialNumber: "K1", location: "By meter", installDate: null, photoUrl: `bfp-${id}`, notes: null,
    lastTestedDate: "2024-05-10", nextTestDueDate: "2025-05-10", lastTestResult: "pass", lastTestedBy: "Delta Testing",
    testUnknownReason: null, gaps: [], verified: false,
    isActive: true, lastUpdatedByUserId: null, lastUpdatedByName: null, lastUpdatedAt: null,
    fieldVerifiedByUserId: null, fieldVerifiedByName: null, fieldVerifiedAt: null, createdAt: "", updatedAt: "", ...o,
  };
}
const noTest = { lastTestResult: null, lastTestedDate: null, lastTestedBy: null, nextTestDueDate: null };
const withBf = (controllers: DocumentationControllerGraph[], backflows: DocumentationBackflow[], o: Partial<DocumentationSite["site"]> = {}) => {
  const s6 = siteOf(controllers);
  return { ...s6, backflows, site: { ...s6.site, ...o } };
};
async function openBf(b: DocumentationBackflow, testId: string, others: DocumentationBackflow[] = []) {
  site = withBf([], [b, ...others]);
  const r = renderPage();
  fireEvent.click(await screen.findByTestId(`row-backflow-${b.id}`));
  await screen.findByTestId(testId);
  return r;
}

describe("Slice 6 — backflow flow", () => {
  it("3. backflow rows are buttons with BF badge and subtitle, and open the flow", async () => {
    site = withBf([], [bf(1), bf(2, { serialNumber: null, size: null, deviceType: "double_check" })]);
    renderPage();
    const row = await screen.findByTestId("row-backflow-1");
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveTextContent("BF");
    expect(row).toHaveTextContent('RPZ 1", SN K1');
    expect(screen.getByTestId("row-backflow-2")).toHaveTextContent("Double check, no serial");
    expect(screen.queryByText(/Backflow capture is coming/)).toBeNull();
    expect(screen.queryByTestId("link-controllers-zones")).toBeNull();
    expect(screen.queryByTestId("chip-no-backflow")).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByTestId("step-review")).toBeInTheDocument();
    expect(screen.getByText("Backflow · Step 5 of 5")).toBeInTheDocument();
  });

  it("4. a new backflow writes nothing before Device Next, then one POST named Backflow 2", async () => {
    uploadSpy.mockResolvedValue("bf-ph");
    custom = (url, method) => (method === "POST" && url === "/api/customers/7/backflows" ? { id: 77 } : undefined);
    site = withBf([], [bf(1)]);
    renderPage();
    fireEvent.click(await screen.findByTestId("button-add-backflow"));
    expect(await screen.findByText(/Get the whole device and the serial plate/)).toBeInTheDocument();
    const file = new File(["x"], "bf.jpg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(screen.getByTestId("doc-photo-input"), { target: { files: [file] } }); });
    await waitFor(() => expect(screen.getByTestId("button-next")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-device");
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("chip-type-rpz"));
    fireEvent.click(screen.getByTestId('chip-size-1"'));
    fireEvent.click(screen.getByTestId("chip-bf-brand-Febco"));
    fireEvent.change(screen.getByTestId("input-serial"), { target: { value: "K81234" } });
    expect(screen.getByTestId("input-serial")).toHaveAttribute("autocapitalize", "characters");
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-location");
    expect(screen.getByTestId("input-bf-name")).toHaveValue("Backflow 2");
    expect(writes()).toEqual([["/api/customers/7/backflows", "POST", {
      name: "Backflow 2", branchName: "", deviceType: "rpz", size: '1"', brand: "Febco", model: null, serialNumber: "K81234", photoUrl: "bf-ph",
    }]]);
    // Back and forward again updates instead of creating a second row.
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-bf-device");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-location");
    expect(writes().filter(([u]) => u === "/api/customers/7/backflows")).toHaveLength(1);
  });

  it("draft Save & exit asks with the backflow copy and writes nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("button-add-backflow"));
    fireEvent.click(await screen.findByTestId("button-save-exit"));
    expect(await screen.findByText("This backflow hasn't been saved yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-dialog-leave"));
    await screen.findByText("What's on file");
    expect(writes()).toHaveLength(0);
    expect(screen.queryByTestId("status-doc-flash")).toBeNull();
  });

  it("5. Device: Next disabled without a serial; a 409 keeps inputs and shows its message; Retry resends", async () => {
    await openBf(bf(5, { serialNumber: null, gaps: [{ step: "device", code: "serial", label: "serial number" }] }), "step-bf-device");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("serial number");
    fireEvent.change(screen.getByTestId("input-serial"), { target: { value: "K81234" } });
    let conflict = true;
    custom = (url, method) => {
      if (method === "PUT" && url === "/api/backflows/5" && conflict) { conflict = false; throw new Error(`409: ${JSON.stringify({ message: "Another backflow already has serial K81234" })}`); }
      return undefined;
    };
    fireEvent.click(screen.getByTestId("button-next"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("Another backflow already has serial K81234");
    expect(screen.getByTestId("input-serial")).toHaveValue("K81234");
    expect(screen.getByTestId("step-bf-device")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-retry"));
    await screen.findByTestId("step-bf-location");
    expect(writes()).toEqual([
      ["/api/backflows/5", "PUT", { serialNumber: "K81234" }],
      ["/api/backflows/5", "PUT", { serialNumber: "K81234" }],
    ]);
  });

  it("changed-only: whitespace-only edits and untouched steps write nothing; real edits send trimmed fields", async () => {
    await openBf(bf(6, { gaps: [{ step: "device", code: "x", label: "x" }] }), "step-bf-device");
    fireEvent.change(screen.getByTestId("input-serial"), { target: { value: "K1 " } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-location");
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByTestId("input-bf-name"), { target: { value: " Pool backflow " } });
    fireEvent.change(screen.getByTestId("input-install-date"), { target: { value: "2019-04-02" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-last-test");
    expect(writes()).toEqual([["/api/backflows/6", "PUT", { name: "Pool backflow", installDate: "2019-04-02" }]]);
  });

  it("6. no test on file: Pass needs a tester; both send log-test; next due follows storage date math", async () => {
    await openBf(bf(10, { ...noTest, gaps: [{ step: "last_test", code: "test", label: "test result" }] }), "step-bf-last-test");
    expect(screen.queryByTestId("text-test-on-file")).toBeNull();
    expect(screen.getByTestId("button-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("chip-result-pass"));
    fireEvent.change(screen.getByTestId("input-test-date"), { target: { value: "2024-05-10" } });
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("test date and tester");
    expect(screen.getByTestId("text-next-due")).toHaveTextContent("Next test due May 10, 2025");
    fireEvent.change(screen.getByTestId("input-tested-by"), { target: { value: " Delta Testing " } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(writes()).toEqual([["/api/backflows/10/log-test", "POST", { lastTestedDate: "2024-05-10", lastTestResult: "pass", lastTestedBy: "Delta Testing" }]]);
  });

  it("6b. Never tested sends PUT { testUnknownReason } and a stored reason is preselected", async () => {
    await openBf(bf(11, { ...noTest, gaps: [{ step: "last_test", code: "test", label: "test result" }] }), "step-bf-last-test");
    fireEvent.click(screen.getByTestId("chip-result-never_tested"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(screen.getByTestId("text-review-last-test")).toHaveTextContent("Never tested");
    expect(writes()).toEqual([["/api/backflows/11", "PUT", { testUnknownReason: "never_tested" }]]);
  });

  it("a stored no_tag reason is preselected and Next resends nothing", async () => {
    await openBf(bf(12, { ...noTest, testUnknownReason: "no_tag", gaps: [{ step: "device", code: "x", label: "x" }] }), "step-bf-device");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-location");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-last-test");
    expect(screen.getByTestId("chip-result-no_tag")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(writes()).toHaveLength(0);
  });

  it("7. test on file: Next gated until a choice; Matches writes nothing; choice survives re-entry this session only", async () => {
    await openBf(bf(13, { gaps: [{ step: "last_test", code: "x", label: "x" }] }), "step-bf-last-test");
    expect(screen.getByTestId("text-test-on-file")).toHaveTextContent("On file: Pass on May 10, 2024 by Delta Testing. Next due May 10, 2025.");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("chip-test-matches"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(screen.getByTestId("button-verify")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-edit-last-test"));
    await screen.findByTestId("step-bf-last-test");
    expect(screen.getByTestId("chip-test-matches")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-next")).not.toBeDisabled();
    expect(writes()).toHaveLength(0);
    // A new session must look at the tag again.
    fireEvent.click(screen.getByTestId("button-save-exit"));
    fireEvent.click(await screen.findByTestId("row-backflow-13"));
    await screen.findByTestId("step-bf-last-test");
    expect(screen.getByTestId("chip-test-matches")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("button-next")).toBeDisabled();
    expect(screen.getByTestId("text-still-needed")).toHaveTextContent("check the test tag");
  });

  it("7b. Tag shows a newer test: Fail with date and tester sends log-test", async () => {
    await openBf(bf(14, { gaps: [{ step: "last_test", code: "x", label: "x" }] }), "step-bf-last-test");
    fireEvent.click(screen.getByTestId("chip-test-newer"));
    expect(screen.queryByTestId("chip-result-never_tested")).toBeNull();
    expect(screen.getByTestId("button-next")).toBeDisabled();
    fireEvent.click(screen.getByTestId("chip-result-fail"));
    fireEvent.change(screen.getByTestId("input-test-date"), { target: { value: "2025-06-01" } });
    fireEvent.change(screen.getByTestId("input-tested-by"), { target: { value: "Ames Testing" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    expect(writes()).toEqual([["/api/backflows/14/log-test", "POST", { lastTestedDate: "2025-06-01", lastTestResult: "fail", lastTestedBy: "Ames Testing" }]]);
  });

  it("a partial newer test is never claimed saved on Save & exit, from Last test or Review", async () => {
    await openBf(bf(15, { gaps: [{ step: "last_test", code: "x", label: "x" }] }), "step-bf-last-test");
    fireEvent.click(screen.getByTestId("chip-test-newer"));
    fireEvent.click(screen.getByTestId("chip-result-pass"));
    fireEvent.change(screen.getByTestId("input-test-date"), { target: { value: "2025-06-01" } });
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("date and tester");
    expect(screen.getByTestId("input-test-date")).toHaveValue("2025-06-01");
    // Back keeps the draft locally; exit from an earlier step still refuses.
    fireEvent.click(screen.getByTestId("button-doc-back"));
    await screen.findByTestId("step-bf-location");
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByTestId("text-save-error")).toHaveTextContent("missing its date or tester");
    expect(screen.queryByTestId("status-doc-flash")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("8. Not at this location sends PUT { isActive: false } after confirming", async () => {
    await openBf(bf(16, { name: "Front RPZ" }), "step-review");
    fireEvent.click(screen.getByTestId("button-not-here"));
    expect(await screen.findByText("Mark Front RPZ as not at this location?")).toBeInTheDocument();
    expect(screen.getByText("It disappears from this list. Its history is kept.")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-dialog-inactive"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Front RPZ marked not at this location.");
    expect(writes()).toEqual([["/api/backflows/16", "PUT", { isActive: false }]]);
  });

  it("a new draft has no Not at this location button", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("button-add-backflow"));
    await screen.findByTestId("step-bf-photo");
    expect(screen.queryByTestId("button-not-here")).toBeNull();
  });

  it("9. Verify backflow posts field-verify and flashes", async () => {
    await openBf(bf(17, { name: "Side RPZ" }), "step-review");
    expect(screen.getByTestId("text-review-device")).toHaveTextContent('RPZ, 1"');
    expect(screen.getByTestId("text-review-installed")).toHaveTextContent("Not known");
    expect(screen.getByTestId("button-verify")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-edit-last-test"));
    await screen.findByTestId("step-bf-last-test");
    fireEvent.click(screen.getByTestId("chip-test-matches"));
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-review");
    fireEvent.click(screen.getByTestId("button-verify"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Side RPZ verified.");
    expect(writes()).toEqual([["/api/backflows/17/field-verify", "POST"]]);
  });

  it("verified + unchanged Save & exit is silent; a change flashes saved", async () => {
    await openBf(bf(18, { verified: true }), "step-review");
    fireEvent.click(screen.getByTestId("button-save-exit"));
    await screen.findByText("What's on file");
    expect(screen.queryByTestId("status-doc-flash")).toBeNull();
    fireEvent.click(screen.getByTestId("row-backflow-18"));
    fireEvent.click(await screen.findByTestId("button-edit-name"));
    await screen.findByTestId("step-bf-location");
    fireEvent.change(screen.getByTestId("input-bf-name"), { target: { value: "Shop RPZ" } });
    fireEvent.click(screen.getByTestId("button-save-exit"));
    expect(await screen.findByTestId("status-doc-flash")).toHaveTextContent("Shop RPZ saved. It stays unverified until you finish it.");
  });

  it("controls are disabled while a backflow save is pending", async () => {
    let release: () => void = () => {};
    custom = (url, method) => (method === "PUT" && url === "/api/backflows/19" ? new Promise((r) => { release = () => r({}); }) : undefined);
    await openBf(bf(19, { gaps: [{ step: "location", code: "x", label: "x" }] }), "step-bf-location");
    fireEvent.change(screen.getByTestId("input-bf-name"), { target: { value: "Gate RPZ" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await waitFor(() => expect(screen.getByTestId("doc-frame-content")).toBeDisabled());
    expect(screen.getByTestId("button-save-exit")).toBeDisabled();
    await act(async () => { release(); });
    await screen.findByTestId("step-bf-last-test");
  });

  it("a backflow save marks the Controllers & Zones backflow list and detail stale", async () => {
    const { qc } = await openBf(bf(20, { gaps: [{ step: "location", code: "x", label: "x" }] }), "step-bf-location");
    const keys = [["/api/customers/7/backflows"], ["/api/backflows/20"], ["/api/customers/7/controllers-profile"]];
    for (const k of keys) qc.setQueryData(k, { cached: true });
    qc.setQueryData(["/api/customers/8/backflows"], { cached: true });
    fireEvent.change(screen.getByTestId("input-bf-name"), { target: { value: "Vault RPZ" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-bf-last-test");
    await waitFor(() => { for (const k of keys) expect(qc.getQueryState(k)?.isInvalidated).toBe(true); });
    expect(qc.getQueryState(["/api/customers/8/backflows"])?.isInvalidated).toBe(false);
  });
});

describe("Slice 6 — next due date is timezone-independent", () => {
  it("rolls the year in UTC like the API server, across DST and leap days", async () => {
    const { nextDueDate } = await import("@/components/document-system/backflow-model");
    const realTZ = process.env.TZ;
    try {
      for (const tz of ["America/Denver", "Pacific/Auckland", "UTC"]) {
        process.env.TZ = tz;
        expect(nextDueDate("2025-03-09")).toBe("2026-03-09"); // US DST start
        expect(nextDueDate("2025-11-02")).toBe("2026-11-02"); // US DST end
        expect(nextDueDate("2024-02-29")).toBe("2025-03-01"); // leap day rollover
        expect(nextDueDate("2024-12-31")).toBe("2025-12-31");
        expect(nextDueDate("")).toBeNull();
      }
    } finally {
      process.env.TZ = realTZ;
    }
  });
});

describe("Slice 6 — no backflow and Finish", () => {
  it("10. the no-backflow chip posts confirmed true, then false", async () => {
    site = withBf([complete(1, "A", { verified: true })], []);
    custom = (url, method, data) => {
      if (method === "POST" && url.endsWith("/site/no-backflow")) {
        site = { ...site, site: { ...site.site, noBackflowConfirmed: (data as { confirmed: boolean }).confirmed } };
        return {};
      }
      return undefined;
    };
    renderPage();
    const chip = await screen.findByTestId("chip-no-backflow");
    expect(chip).toHaveTextContent("There is no backflow at this location");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("chip-no-backflow")).toHaveTextContent("Confirmed: no backflow at this location"));
    expect(screen.getByTestId("chip-no-backflow")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("chip-no-backflow"));
    await waitFor(() => expect(screen.getByTestId("chip-no-backflow")).toHaveAttribute("aria-pressed", "false"));
    expect(writes()).toEqual([
      ["/api/system-documentation/customers/7/site/no-backflow", "POST", { branchName: "", confirmed: true }],
      ["/api/system-documentation/customers/7/site/no-backflow", "POST", { branchName: "", confirmed: false }],
    ]);
  });

  it.each([
    ["no controller", () => withBf([], [bf(1, { verified: true })]), "Add at least one controller."],
    ["unverified items", () => withBf([complete(1, "A"), complete(2, "B", { verified: true })], [bf(3)]), "2 items still to verify before you can finish."],
    ["one unverified", () => withBf([complete(1, "A", { verified: true })], [bf(3)]), "1 item still to verify before you can finish."],
    ["no backflow answer", () => withBf([complete(1, "A", { verified: true })], []), "Add a backflow, or confirm there isn't one."],
  ])("11. Finish blocked: %s", async (_n, make, text) => {
    site = make();
    renderPage();
    expect(await screen.findByTestId("text-finish-status")).toHaveTextContent(text);
    expect(screen.getByTestId("button-finish")).toBeDisabled();
  });

  it("11b. ready Finish posts verify, then shows Done with fixture counts; Back returns to summary", async () => {
    site = withBf([
      complete(1, "A", { verified: true, totalZones: 12, programs: [program, { ...program, id: 10, name: "B" }, { ...program, id: 11, name: "C", isActive: false }] }),
      complete(2, "B", { verified: true, totalZones: 8 }),
    ], [bf(3, { verified: true })], {}, );
    site = { ...site, branchName: "North", customer: { ...site.customer, branches: ["North"] } };
    sites = sitesOf(["North"]);
    const { nav } = renderPage("/customers/7/document-system?branch=North");
    expect(await screen.findByTestId("text-finish-status")).toHaveTextContent("Every item is verified.");
    fireEvent.click(screen.getByTestId("button-finish"));
    expect(await screen.findByText("System documented")).toBeInTheDocument();
    expect(writes()).toEqual([["/api/system-documentation/customers/7/site/verify", "POST", { branchName: "North" }]]);
    expect(screen.getByTestId("text-done-line")).toHaveTextContent(/^Harbor Pines HOA, North, verified in the field by you on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    expect(screen.getByTestId("text-done-controllers")).toHaveTextContent("2");
    expect(screen.getByTestId("text-done-zones")).toHaveTextContent("20");
    expect(screen.getByTestId("text-done-programs")).toHaveTextContent("3");
    expect(screen.getByTestId("text-done-backflows")).toHaveTextContent("1");
    expect(screen.getByText("The office now sees this location as verified, and billing can tie every line to a controller and zone.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-doc-back"));
    expect(await screen.findByText("What's on file")).toBeInTheDocument();
    expect(screen.queryByTestId("status-doc-flash")).toBeNull();
    fireEvent.click(screen.getByTestId("button-finish"));
    fireEvent.click(await screen.findByTestId("button-back-to-customer"));
    await waitFor(() => expect(nav.history.at(-1)).toBe("/customers/7/profile"));
  });

  it("Finish 400 shows the server message and stays on the summary", async () => {
    site = withBf([complete(1, "A", { verified: true })], [], { noBackflowConfirmed: true });
    renderPage();
    failNext = "Controller A is not verified";
    fireEvent.click(await screen.findByTestId("button-finish"));
    expect(await screen.findByTestId("text-summary-error")).toHaveTextContent("Controller A is not verified");
    expect(screen.queryByText("System documented")).toBeNull();
  });

  it("verified site shows the field banner; Save and leave goes to the profile", async () => {
    site = withBf([complete(1, "A", { verified: true })], [], { status: "verified", verifiedAt: "2025-03-04T15:00:00Z", verifiedByName: "Pat Rivera", noBackflowConfirmed: true });
    const { nav } = renderPage();
    expect(await screen.findByTestId("text-site-verified")).toHaveTextContent(/^Verified in the field on Mar \d, 2025 by Pat Rivera\.$/);
    fireEvent.click(screen.getByTestId("button-save-leave"));
    await waitFor(() => expect(nav.history.at(-1)).toBe("/customers/7/profile"));
  });

  it("Done and flash never carry across a branch or customer change", async () => {
    const north = { ...withBf([complete(1, "A", { verified: true })], [], { noBackflowConfirmed: true }), branchName: "North" };
    const south = { ...withBf([complete(2, "B")], [bf(5)]), branchName: "South" };
    apiRequestSpy.mockImplementation(async (url: string, method = "GET") => {
      if (method !== "GET") return {};
      if (url === "/api/system-documentation/sites") return sitesOf(["North", "South"]);
      return url.includes("branchName=South") ? south : north;
    });
    const { nav } = renderPage("/customers/7/document-system?branch=North");
    fireEvent.click(await screen.findByTestId("button-finish"));
    await screen.findByText("System documented");
    act(() => nav.navigate("/customers/7/document-system?branch=South"));
    expect(await screen.findByTestId("row-backflow-5")).toBeInTheDocument();
    expect(screen.queryByText("System documented")).toBeNull();
    expect(screen.getByTestId("text-finish-status")).toHaveTextContent("2 items still to verify");
    fireEvent.click(screen.getByTestId("row-backflow-5"));
    await screen.findByTestId("step-review");
    act(() => nav.navigate("/customers/7/document-system?branch=North"));
    expect(await screen.findByTestId("row-controller-1")).toBeInTheDocument();
    expect(screen.queryByTestId("step-review")).toBeNull();
    expect(writes()).toEqual([["/api/system-documentation/customers/7/site/verify", "POST", { branchName: "North" }]]);
  });
});

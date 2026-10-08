import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IrrigationControllerGrid, type ControllerWithZones } from "./irrigation-controller-grid";
import type { IrrigationController, IrrigationProfileZone } from "@workspace/db/schema";
import { IrrigationSystemCard } from "./irrigation-system-card";
import type { Customer } from "@workspace/db/schema";

const { request, toast, auth } = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn(), auth: { role: "company_admin" } }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { role: auth.role } }) }));
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(),
  apiRequest: request,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/pages/wet-checks/helpers", () => ({ uploadPhotoToStorage: vi.fn() }));

const baseController = {
  id: 7, companyId: 1, customerId: 9, name: "Controller A", letter: "A", totalZones: 38,
  isActive: true, location: null, brand: null, model: null, settingsPhotoUrl: null,
} as IrrigationController;
const zones = Array.from({ length: 38 }, (_, i) => ({
  id: 100 + i, companyId: 1, controllerId: 7, zoneNumber: i + 1,
  name: `Zone ${i + 1}`, programId: null, zoneType: "other", runTimeMinutes: 0,
  zoneOrder: i + 1, isActive: true, notes: null, overrideDays: null, overrideStartTime: null, retiredAt: null,
})) as IrrigationProfileZone[];
const controller: ControllerWithZones = { ...baseController, zones: zones.map(z => ({ ...z, setUp: false })), retiredZoneCount: 0 };
function counted(count: number): ControllerWithZones {
  return { ...controller, totalZones: count || null, zones: Array.from({ length: count }, (_, i) => ({
    ...zones[0], id: 100 + i, zoneNumber: i + 1, name: `Zone ${i + 1}`, setUp: false,
  })) };
}

function mount(ctrl = controller, canManage = true, canEdit = true, retiredZones: IrrigationProfileZone[] = [], queryFn?: () => Promise<unknown>) {
  const detail = { ...ctrl, zones: ctrl.zones.map(z => ({ ...zones[0], ...z })), programs: [], retiredZones };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity,
    queryFn: queryFn ?? (() => Promise.resolve(detail)) } } });
  if (!queryFn) qc.setQueryData([`/api/irrigation-controllers/${ctrl.id}`], detail);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(<QueryClientProvider client={qc}>
    <IrrigationControllerGrid controllers={[ctrl]} customerId={9} canManageControllers={canManage} canEditZones={canEdit} onRefreshList={vi.fn()} />
  </QueryClientProvider>);
  return { qc, invalidate };
}

beforeEach(() => { auth.role = "company_admin"; request.mockReset(); toast.mockReset(); request.mockResolvedValue({ controller, created: [], restored: [], retired: [] }); });

describe("zone records — minimal grid adaptation", () => {
  it("38 chips agree with 38 table rows; increment uses the count endpoint and refreshes all readers", async () => {
    const { invalidate } = mount();
    expect(screen.getAllByTestId(/^zone-chip-A-/)).toHaveLength(38);
    fireEvent.click(screen.getByTestId("button-zone-increment-A"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 39 }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/properties", 9, "controllers"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/irrigation-controllers/7/history"] });
    // Increment opens the table; collapse/re-expand still preserves its rows.
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findAllByText(/^Zone \d+$/)).toHaveLength(38);
  });
  it("Add Zone is a count increment, with no free-form creation fields", async () => {
    mount(controller, false);
    expect(screen.queryByTestId("button-zone-increment-A")).toBeNull();
    expect(screen.queryByTestId("button-zone-decrement-A")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const add = await screen.findByRole("button", { name: "Add Zone" });
    fireEvent.click(add);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 39 }));
    expect(screen.queryByPlaceholderText("Zone name")).toBeNull();
    expect(request.mock.calls.every(([url]) => !String(url).endsWith("/zones"))).toBe(true);
  });
  it("a zone remains editable, but has neither Delete nor a zone-number input", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const row = (await screen.findByText("Zone 1")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect(within(row).queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(within(row).queryByText("Zone #")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const call = request.mock.calls.find(([url]) => url === "/api/irrigation-zones/100")!;
    expect(call[1]).toBe("PUT"); expect(call[2]).not.toHaveProperty("zoneNumber");
  });
  it("count failure displays the server message, not a raw HTTP error", async () => {
    const message = "A zone count can't be cleared. Lower it instead — zones above the new count are retired and their history is kept.";
    request.mockRejectedValueOnce(new Error(`400: ${JSON.stringify({ message })}`));
    mount();
    fireEvent.click(screen.getByTestId("button-zone-decrement-A"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: message, variant: "destructive" })));
  });
  it("decrement stops at 1, and unknown count starts at 1", async () => {
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}>
      <IrrigationControllerGrid controllers={[counted(1)]} customerId={9} canManageControllers canEditZones />
    </QueryClientProvider>);
    expect(screen.getByTestId("button-zone-decrement-A")).toBeDisabled();
    unmount();
    mount(counted(0));
    expect(screen.getByTestId("button-zone-decrement-A")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-zone-increment-A"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 1 }));
  });
  it("increment and Add Zone stop at 100", async () => {
    mount(counted(100));
    expect(screen.getByTestId("button-zone-increment-A")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findByRole("button", { name: "Add Zone" })).toBeDisabled();
  });
});

describe("connected controller tiles", () => {
  for (const role of ["company_admin", "super_admin", "irrigation_manager", "billing_manager", "field_tech"]) {
    it(`customer card retains the management/editing boundary for ${role}`, async () => {
      auth.role = role;
      const manage = ["company_admin", "super_admin", "irrigation_manager"].includes(role);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      qc.setQueryData(["/api/customers/9/controllers-profile"], [counted(2)]);
      qc.setQueryData(["/api/irrigation-controllers/7"], { ...controller, zones: zones.slice(0, 2), programs: [], retiredZones: [] });
      render(<QueryClientProvider client={qc}>
        <IrrigationSystemCard customer={{ id: 9 } as Customer} canManageControllers={manage} />
      </QueryClientProvider>);
      expect(!!screen.queryByTestId("button-zone-increment-A")).toBe(manage);
      fireEvent.click(screen.getByRole("button", { name: "Expand" }));
      expect(!!screen.queryByRole("button", { name: "Add Zone" })).toBe(manage || role === "field_tech");
      expect(!!screen.queryByRole("button", { name: "Edit Details" })).toBe(manage);
      expect(!!screen.queryByTestId("button-zone-decrement-A")).toBe(manage);
      expect(screen.queryAllByRole("button", { name: "Edit" }).length > 0).toBe(manage || role === "field_tech");
    });
  }
  it("record identities, states, tooltip labels, attention precedence and partial wording", () => {
    const ctrl = counted(3);
    ctrl.totalZones = 99;
    ctrl.location = "North gate";
    ctrl.zones[0] = { ...ctrl.zones[0], name: "Front entry rotor", zoneType: "rotor", setUp: true };
    ctrl.zones[2] = { ...ctrl.zones[2], isActive: false };
    mount(ctrl);
    expect(screen.getAllByTestId(/^zone-chip-A-/)).toHaveLength(3);
    expect(screen.getByTestId("zone-chip-A-1")).toHaveAttribute("data-state", "set-up");
    expect(screen.getByTestId("zone-chip-A-1")).toHaveAttribute("title", "Zone 1 · Front entry rotor · Rotor");
    expect(screen.getByTestId("zone-chip-A-2")).toHaveAttribute("data-state", "placeholder");
    expect(screen.getByTestId("zone-chip-A-2")).toHaveAttribute("title", "Zone 2 · not set up yet");
    expect(screen.getByTestId("zone-chip-A-3")).toHaveAttribute("data-state", "attention");
    expect(screen.getByTestId("zone-chip-A-3")).toHaveAttribute("title", "Zone 3 · Zone 3 · needs attention");
    expect(screen.getByText("3 zones · 1 set up")).toBeInTheDocument();
    expect(screen.getByText(/North gate/)).toBeInTheDocument();
  });
  it("all-set-up wording", () => {
    mount({ ...counted(2), zones: counted(2).zones.map(z => ({ ...z, setUp: true, name: "Garden" })) });
    expect(screen.getByText("2 zones · all set up")).toBeInTheDocument();
  });
  it("zero wording and empty table copy apply to read-only users", async () => {
    mount(counted(0), false, false);
    expect(screen.getByText("No zones yet — use + to add")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findByText("No zones yet. Use + above to add the first zone.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Zone" })).toBeNull();
  });
  it("chip opens exact unloaded row, focuses Name, scrolls and consumes intent", async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    let resolve!: (value: unknown) => void;
    mount(counted(3), true, true, [], () => new Promise(r => { resolve = r; }));
    fireEvent.click(screen.getByTestId("zone-chip-A-2"));
    await waitFor(() => expect(resolve).toBeDefined());
    resolve({ ...controller, zones: zones.slice(0, 3), programs: [], retiredZones: [] });
    const input = await screen.findByRole("textbox", { name: "Zone 2 Name" });
    expect(input).toHaveFocus();
    expect(screen.getByTestId("zone-row-101")).toHaveClass("ring-2");
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.queryByRole("textbox", { name: "Zone 2 Name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    fireEvent.click(screen.getByTestId("zone-chip-A-2"));
    expect(await screen.findByRole("textbox", { name: "Zone 2 Name" })).toHaveFocus();
  });
  it("read-only chip opens and highlights without an editor", async () => {
    mount(counted(3), false, false);
    fireEvent.click(screen.getByTestId("zone-chip-A-2"));
    expect(await screen.findByTestId("zone-row-101")).toHaveClass("ring-2");
    expect(screen.queryByRole("textbox", { name: "Zone 2 Name" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
  it("set-up top zone confirms, Cancel sends nothing, confirm decrements", async () => {
    const ctrl = counted(3);
    ctrl.zones[2] = { ...ctrl.zones[2], name: "Back slope drip", zoneType: "drip", setUp: true };
    mount(ctrl);
    fireEvent.click(screen.getByTestId("button-zone-decrement-A"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Retire Zone 3?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent('"Back slope drip" drops out of pickers and wet checks.');
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-zone-decrement-A"));
    fireEvent.click(screen.getByRole("button", { name: "Retire zone" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 2 }));
  });
  it("placeholder retires directly; expanded stepper stays visible; duplicate count fields are absent", async () => {
    mount(counted(3));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByTestId("button-zone-increment-A")).toBeInTheDocument();
    expect(await screen.findByText("Zones (3) · 0 set up")).toBeInTheDocument();
    expect(screen.queryByText("Total Zones")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Details" }));
    expect(screen.queryByText("Total Zones")).toBeNull();
    fireEvent.click(screen.getByTestId("button-zone-decrement-A"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 2 }));
  });
  it("retired list is hidden, attributed, read-only, and excluded from chips", async () => {
    const retired = { ...zones[2], retiredAt: new Date("2026-10-05T12:00:00Z"), retiredByName: "Test manager", name: "Back slope drip", zoneType: "drip" };
    mount({ ...counted(2), retiredZoneCount: 1 }, true, true, [retired]);
    expect(screen.getAllByTestId(/^zone-chip-A-/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.queryByText(/retired Oct/)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Show 1 retired zones" }));
    const list = screen.getByTestId("retired-zones-A");
    expect(list).toHaveTextContent("by Test manager");
    expect(list).toHaveTextContent("Raise the zone count to bring these back.");
    expect(within(list).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide retired zones" }));
    expect(screen.queryByTestId("retired-zones-A")).toBeNull();
  });
  for (const restored of [false, true]) {
    it(`${restored ? "restored" : "new"} top identity opens with Name focused after refreshed detail; shared pending blocks duplicates`, async () => {
      const ctrl = counted(2);
      const top = { ...zones[2], id: restored ? 900 : 901, name: restored ? "Restored garden" : "Zone 3" };
      const { qc } = mount(ctrl, false, true, restored ? [top] : []);
      qc.setDefaultOptions({ queries: { retry: false, queryFn: async () => ({ ...ctrl, zones: [...zones.slice(0, 2), top], programs: [], retiredZones: [] }) } });
      let resolve!: (v: unknown) => void;
      request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
      fireEvent.click(screen.getByRole("button", { name: "Expand" }));
      const add = await screen.findByRole("button", { name: "Add Zone" });
      fireEvent.click(add);
      fireEvent.click(add);
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      resolve({ created: restored ? [] : [3], restored: restored ? [3] : [] });
      expect(await screen.findByRole("textbox", { name: "Zone 3 Name" })).toHaveFocus();
      expect(screen.getByTestId(`zone-row-${top.id}`)).toHaveClass("ring-2");
      expect(screen.queryByTestId("button-zone-decrement-A")).toBeNull();
    });
  }
});

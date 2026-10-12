import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IrrigationControllerGrid, type ControllerWithZones } from "./irrigation-controller-grid";
import type { IrrigationController, IrrigationProfileZone, IrrigationProgram } from "@workspace/db/schema";
import { IrrigationSystemCard } from "./irrigation-system-card";
import type { Customer } from "@workspace/db/schema";
const proto = Element.prototype as any;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

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

function mount(ctrl = controller, canManage = true, canEdit = true, retiredZones: IrrigationProfileZone[] = [], queryFn?: () => Promise<unknown>, programs: IrrigationProgram[] = []) {
  const detail = { ...ctrl, zones: ctrl.zones.map(z => ({ ...zones[0], ...z })), programs, retiredZones };
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

async function openSheet(count = 5) {
  const mounted = mount(counted(count));
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  await screen.findByRole("textbox", { name: "Zone 1 Name" });
  return mounted;
}
async function selectOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("fast zone sheet", () => {
  it("blur saves only name, shows a check, and never invalidates detail/list", async () => {
    const { invalidate } = await openSheet();
    request.mockResolvedValueOnce({ ...zones[0], name: "Garden" });
    const name = screen.getByRole("textbox", { name: "Zone 1 Name" });
    fireEvent.change(name, { target: { value: "Garden" } }); fireEvent.blur(name);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-zones/100", "PUT", { name: "Garden" }));
    expect(await screen.findByLabelText("Saved")).toBeInTheDocument();
    expect(invalidate.mock.calls.every(([filter]) => String(filter?.queryKey?.[0]).endsWith("/history"))).toBe(true);
  });
  it("Enter navigates the same column, Shift+Enter reverses, last row stays; blur deduplicates", async () => {
    await openSheet();
    request.mockResolvedValue({ ...zones[2], runTimeMinutes: 12 });
    const third = screen.getByRole("spinbutton", { name: "Zone 3 Runtime" });
    third.focus(); fireEvent.change(third, { target: { value: "12" } }); fireEvent.keyDown(third, { key: "Enter" }); fireEvent.blur(third);
    expect(screen.getByRole("spinbutton", { name: "Zone 4 Runtime" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Enter", shiftKey: true });
    expect(third).toHaveFocus();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const last = screen.getByRole("textbox", { name: "Zone 5 Name" }); last.focus(); fireEvent.keyDown(last, { key: "Enter" });
    expect(last).toHaveFocus();
  });
  it("Escape restores saved value without request; empty Name restores and validates temporarily", async () => {
    await openSheet();
    const name = screen.getByRole("textbox", { name: "Zone 1 Name" });
    name.focus(); fireEvent.change(name, { target: { value: "Unsaved" } }); fireEvent.keyDown(name, { key: "Escape" });
    expect(name).toHaveValue("Zone 1"); expect(request).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "" } }); fireEvent.blur(name);
    expect(name).toHaveValue("Zone 1"); expect(name).toHaveAttribute("title", "A zone needs a name");
    expect(name).toHaveClass("border-red-400"); expect(request).not.toHaveBeenCalled();
    await waitFor(() => expect(name).not.toHaveClass("border-red-400"), { timeout: 2500 });
  });
  it("failure keeps red draft and server feedback; retry uses newer typing and other field saves preserve it", async () => {
    await openSheet();
    request.mockRejectedValueOnce(new Error('500: {"message":"Try this field again"}'));
    const name = screen.getByRole("textbox", { name: "Zone 1 Name" });
    fireEvent.change(name, { target: { value: "Garden" } }); fireEvent.blur(name);
    const retry = await screen.findByRole("button", { name: "Retry Zone 1" });
    expect(retry).toHaveAttribute("title", "Try this field again"); expect(name).toHaveValue("Garden"); expect(name).toHaveClass("border-red-400");
    request.mockResolvedValueOnce({ ...zones[0], runTimeMinutes: 12 });
    const runtime = screen.getByRole("spinbutton", { name: "Zone 1 Runtime" });
    fireEvent.change(runtime, { target: { value: "12" } }); fireEvent.blur(runtime);
    await waitFor(() => expect(runtime).toHaveValue(12));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry Zone 1" })).toBeInTheDocument());
    expect(name).toHaveValue("Garden"); expect(name).toHaveClass("border-red-400");
    fireEvent.change(name, { target: { value: "New garden" } });
    request.mockResolvedValueOnce({ ...zones[0], runTimeMinutes: 12, name: "New garden" });
    fireEvent.click(screen.getByRole("button", { name: "Retry Zone 1" }));
    await waitFor(() => expect(request).toHaveBeenLastCalledWith("/api/irrigation-zones/100", "PUT", { name: "New garden" }));
    await waitFor(() => expect(name).not.toHaveClass("border-red-400"));
  });
  it("serializes rapid commits and preserves another unsaved cell", async () => {
    await openSheet();
    let resolve!: (v: unknown) => void;
    request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const name = screen.getByRole("textbox", { name: "Zone 1 Name" });
    const notes = screen.getByRole("textbox", { name: "Zone 1 Notes" });
    fireEvent.change(name, { target: { value: "First" } }); fireEvent.blur(name);
    fireEvent.change(notes, { target: { value: "Keep this draft" } });
    fireEvent.change(name, { target: { value: "Second" } }); fireEvent.blur(name);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    request.mockResolvedValueOnce({ ...zones[0], name: "Second" });
    resolve({ ...zones[0], name: "First" });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Saved")).toBeInTheDocument());
    expect(name).toHaveValue("Second"); expect(notes).toHaveValue("Keep this draft");
  });
  it("committing back to the saved value while a request is pending still sends the reversal", async () => {
    await openSheet();
    let resolve!: (v: unknown) => void;
    request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const name = screen.getByRole("textbox", { name: "Zone 1 Name" });
    fireEvent.change(name, { target: { value: "First" } }); fireEvent.blur(name);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    fireEvent.change(name, { target: { value: "Zone 1" } }); fireEvent.blur(name);
    request.mockResolvedValueOnce(zones[0]); resolve({ ...zones[0], name: "First" });
    await waitFor(() => expect(request).toHaveBeenLastCalledWith("/api/irrigation-zones/100", "PUT", { name: "Zone 1" }));
    await waitFor(() => expect(screen.getByLabelText("Saved")).toBeInTheDocument());
    expect(name).toHaveValue("Zone 1");
  });
  it("schedule follows typing; bulk waits for cell saves and refetch preserves unsaved notes on another row", async () => {
    const program = { id: 5, controllerId: 7, name: "Morning", wateringDays: ["Mon"], startTimes: ["06:00"], seasonalAdjustPct: 100, isActive: true, sortOrder: 1 } as IrrigationProgram;
    const ctrl = counted(2);
    ctrl.zones[0] = { ...ctrl.zones[0], programId: 5, runTimeMinutes: 5 } as typeof ctrl.zones[0];
    let serverDetail = { ...ctrl, programs: [program], retiredZones: [], zones: ctrl.zones.map(z => ({ ...zones[0], ...z })) };
    mount(ctrl, true, true, [], async () => serverDetail, [program]);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const runtime = await screen.findByRole("spinbutton", { name: "Zone 1 Runtime" });
    fireEvent.change(runtime, { target: { value: "12" } });
    const schedule = screen.getByText("Auto Run-Time Schedule").parentElement!;
    expect(within(schedule).getByText("12 min")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    const note = screen.getByRole("textbox", { name: "Zone 2 Notes" });
    fireEvent.change(note, { target: { value: "Do not lose me" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all zones" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bulk Runtime" }), { target: { value: "20" } });
    let resolve!: (v: unknown) => void;
    request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    fireEvent.blur(runtime);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    resolve({ ...zones[0], programId: 5, runTimeMinutes: 12 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled());
    const refreshed = { ...ctrl, programs: [program], retiredZones: [], zones: zones.slice(0, 2).map(z => ({ ...z, programId: 5, runTimeMinutes: 20 })) };
    serverDetail = refreshed;
    request.mockResolvedValueOnce(refreshed.zones);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(runtime).toHaveValue(20));
    expect(note).toHaveValue("Do not lose me");
    expect(within(schedule).getAllByText("20 min")).toHaveLength(2);
  });
  it("Type, Program and Status save immediately with field-only payloads", async () => {
    await openSheet();
    request.mockResolvedValue({ ...zones[0], zoneType: "rotor" });
    await selectOption("Zone 1 Type", "Rotor");
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-zones/100", "PUT", { zoneType: "rotor" }));
    fireEvent.click(screen.getByRole("switch", { name: "Zone 1 Status" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-zones/100", "PUT", { isActive: false }));
  });
  it("shift-selects 3–7 and applies only Type and Runtime", async () => {
    const { invalidate } = await openSheet(8);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Zone 3" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Zone 7" }), { shiftKey: true });
    expect(screen.getByText("5 zones selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all zones" })).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await selectOption("Bulk Type", "Rotor");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bulk Runtime" }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zones/bulk", "PUT", { zoneIds: [102, 103, 104, 105, 106], patch: { zoneType: "rotor", runTimeMinutes: 12 } }));
    await waitFor(() => expect(screen.queryByText("5 zones selected")).toBeNull());
    expect(toast).toHaveBeenCalledWith({ title: "Updated 5 zones" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/customers/9/controllers-profile"] });
  });
  it("explicit None and zero differ from unset; bulk failure keeps selection, collapse clears it", async () => {
    await openSheet(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all zones" }));
    expect(screen.getByRole("checkbox", { name: "Select all zones" })).toBeChecked();
    await selectOption("Bulk Program", "— None —");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Bulk Runtime" }), { target: { value: "0" } });
    request.mockRejectedValueOnce(new Error('400: {"message":"Program not on this controller"}'));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zones/bulk", "PUT", { zoneIds: [100, 101], patch: { programId: null, runTimeMinutes: 0 } }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Program not on this controller" })));
    expect(screen.getByText("2 zones selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" })); fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.queryByText("2 zones selected")).toBeNull();
  });
  it("read-only rows have text and no editable/select/Override controls", async () => {
    mount(counted(2), false, false); fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const row = await screen.findByTestId("zone-row-100");
    expect(within(row).getByText("Zone 1")).toBeInTheDocument();
    for (const role of ["textbox", "spinbutton", "checkbox", "combobox", "switch", "button"]) expect(within(row).queryByRole(role)).toBeNull();
  });
  it("Override saves its own patch and schedule follows unsaved drafts", async () => {
    await openSheet();
    fireEvent.click(within(screen.getByTestId("zone-row-100")).getByRole("button", { name: "Override" }));
    fireEvent.change(screen.getByLabelText("Zone 1 Override Start"), { target: { value: "08:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    request.mockResolvedValueOnce({ ...zones[0], overrideStartTime: "08:30", overrideDays: ["Mon"] });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-zones/100", "PUT", { overrideStartTime: "08:30", overrideDays: ["Mon"] }));
  });
  it("chip turns solid in the connected card with no controller-list refetch", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, queryFn: vi.fn() } } });
    qc.setQueryData(["/api/customers/9/controllers-profile"], [counted(2)]);
    qc.setQueryData(["/api/irrigation-controllers/7"], { ...baseController, zones: zones.slice(0, 2), programs: [], retiredZones: [] });
    render(<QueryClientProvider client={qc}><IrrigationSystemCard customer={{ id: 9 } as Customer} canManageControllers /></QueryClientProvider>);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    request.mockResolvedValueOnce({ ...zones[0], name: "Garden" });
    const input = screen.getByRole("textbox", { name: "Zone 1 Name" });
    fireEvent.change(input, { target: { value: "Garden" } }); fireEvent.blur(input);
    await waitFor(() => expect(qc.getQueryData<ControllerWithZones[]>(["/api/customers/9/controllers-profile"])![0].zones[0].setUp).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.getByTestId("zone-chip-A-1")).toHaveAttribute("data-state", "set-up");
    expect(invalidate.mock.calls.some(([filter]) => String(filter?.queryKey?.[0]).endsWith("controllers-profile"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("textbox", { name: "Zone 2 Name" })).toBeInTheDocument();
  });
});

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
     expect(await screen.findAllByRole("textbox", { name: /^Zone \d+ Name$/ })).toHaveLength(38);
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
    const input = await screen.findByRole("textbox", { name: "Zone 1 Name" });
    const row = input.closest("tr")!;
    expect(within(row).queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(within(row).queryByText("Zone #")).toBeNull();
    request.mockResolvedValueOnce({ ...zones[0], name: "Garden" });
    fireEvent.change(input, { target: { value: "Garden" } });
    fireEvent.blur(input);
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
      expect(screen.queryAllByRole("textbox", { name: /^Zone \d+ Name$/ }).length > 0).toBe(manage || role === "field_tech");
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
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe("Zone 2".length);
    expect(screen.getByTestId("zone-row-101")).toHaveClass("ring-2");
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("textbox", { name: "Zone 2 Name" })).not.toHaveFocus();
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

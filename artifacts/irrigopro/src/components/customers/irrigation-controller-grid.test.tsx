import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IrrigationControllerGrid } from "./irrigation-controller-grid";
import type { IrrigationController } from "@workspace/db/schema";

const { request, toast } = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(),
  apiRequest: request,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/pages/wet-checks/helpers", () => ({ uploadPhotoToStorage: vi.fn() }));

const controller = {
  id: 7, companyId: 1, customerId: 9, name: "Controller A", letter: "A", totalZones: 38,
  isActive: true, location: null, brand: null, model: null, settingsPhotoUrl: null,
} as IrrigationController;
const zones = Array.from({ length: 38 }, (_, i) => ({
  id: 100 + i, companyId: 1, controllerId: 7, zoneNumber: i + 1,
  name: `Zone ${i + 1}`, programId: null, zoneType: "other", runTimeMinutes: 0,
  zoneOrder: i + 1, isActive: true, notes: null, overrideDays: null, overrideStartTime: null, retiredAt: null,
}));

function mount(ctrl = controller, canManage = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity,
    queryFn: () => Promise.resolve({ ...ctrl, zones, programs: [] }) } } });
  qc.setQueryData([`/api/irrigation-controllers/${ctrl.id}`], { ...ctrl, zones, programs: [] });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  render(<QueryClientProvider client={qc}>
    <IrrigationControllerGrid controllers={[ctrl]} customerId={9} canManageControllers={canManage} canEditZones onRefreshList={vi.fn()} />
  </QueryClientProvider>);
  return { qc, invalidate };
}

beforeEach(() => { request.mockReset(); toast.mockReset(); request.mockResolvedValue({ controller, created: [], restored: [], retired: [] }); });

describe("zone records — minimal grid adaptation", () => {
  it("38 chips agree with 38 table rows; increment uses the count endpoint and refreshes all readers", async () => {
    const { invalidate } = mount();
    expect(screen.getAllByTestId(/^zone-chip-A-/)).toHaveLength(38);
    fireEvent.click(screen.getByTestId("button-zone-increment-A"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 39 }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/properties", 9, "controllers"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/irrigation-controllers/7/history"] });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findAllByText(/^Zone \d+$/)).toHaveLength(38);
  });
  it("Add Zone is a count increment, with no free-form creation fields", async () => {
    mount(controller, false);
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
      <IrrigationControllerGrid controllers={[{ ...controller, totalZones: 1 }]} customerId={9} canManageControllers canEditZones />
    </QueryClientProvider>);
    expect(screen.getByTestId("button-zone-decrement-A")).toBeDisabled();
    unmount();
    mount({ ...controller, totalZones: null });
    expect(screen.getByTestId("button-zone-decrement-A")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-zone-increment-A"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/irrigation-controllers/7/zone-count", "PUT", { totalZones: 1 }));
  });
  it("increment and Add Zone stop at 100", async () => {
    mount({ ...controller, totalZones: 100 });
    expect(screen.getByTestId("button-zone-increment-A")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(await screen.findByRole("button", { name: "Add Zone" })).toBeDisabled();
  });
});

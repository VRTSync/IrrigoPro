import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { DocumentationControllerGraph, DocumentationSite } from "@workspace/api-client-react";
import { SiteSummary } from "./site-summary";
import { docSiteKey } from "./use-doc-site";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: request }));

const controller = (id: number, letter: string): DocumentationControllerGraph => ({
  id, letter, name: `Clock ${letter}`, location: "Garage", brand: "Hunter", model: "Pro-C", totalZones: 2,
  settingsPhotoUrl: `photo-${id}`, notes: null, lastUpdatedAt: null, fieldVerifiedAt: null, fieldVerifiedByName: null,
  programs: [], zones: [], gaps: [], verified: true,
});
const controllers = [controller(1, "A"), controller(2, "B"), controller(3, "C")];
function site(rows = controllers): DocumentationSite {
  return { customer: { id: 7, name: "Property", address: null, branches: ["North"] }, branchName: "North", controllers: rows,
    backflows: [], site: { status: "verified", verifiedAt: "2026-11-09T00:00:00Z", verifiedByName: "Pat", noBackflowConfirmed: true } };
}
let qc: QueryClient;
let current: DocumentationSite;
let props: ReturnType<typeof callbacks>;
function callbacks() { return { onBack: vi.fn(), onDone: vi.fn(), onOpenController: vi.fn(), onAddController: vi.fn(), onOpenBackflow: vi.fn(), onAddBackflow: vi.fn(), onFinished: vi.fn() }; }
function Harness() {
  const { data } = useQuery({ queryKey: docSiteKey(7, "North"), queryFn: async () => current, initialData: current });
  return <SiteSummary {...props} customerId={7} branchName="North" site={data} subtitle="Property · North" flash={null} />;
}
function mount(rows = controllers) {
  current = site(rows); props = callbacks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(<QueryClientProvider client={qc}><Harness /></QueryClientProvider>);
}
function order() { return screen.getAllByTestId(/^(row|reorder)-controller-/).map(e => e.getAttribute("data-testid")); }
beforeEach(() => { request.mockReset(); });
afterEach(() => { cleanup(); qc?.clear(); });

describe("wizard controller order", () => {
  it.each([0, 1])("does not offer reordering for %i controllers", n => {
    mount(controllers.slice(0, n));
    expect(screen.queryByRole("button", { name: "Reorder" })).toBeNull();
    expect(screen.getByTestId("button-add-controller")).toBeEnabled();
  });
  it("normal rows still open their existing controller", () => {
    mount(); fireEvent.click(screen.getByTestId("row-controller-2"));
    expect(props.onOpenController).toHaveBeenCalledWith(2);
  });
  it("moves in place without opening or editing controllers and cancels without saving", () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    expect(screen.getByRole("button", { name: "Move Clock A up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Clock C down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Clock B up" }));
    expect(order()).toEqual(["reorder-controller-2", "reorder-controller-1", "reorder-controller-3"]);
    expect(within(screen.getByTestId("reorder-controller-2")).getByText("B")).toBeInTheDocument();
    expect(props.onOpenController).not.toHaveBeenCalled();
    expect(screen.getByTestId("button-doc-back")).toBeDisabled();
    expect(screen.queryByTestId("button-save-leave")).toBeNull();
    expect(screen.queryByTestId("button-finish")).toBeNull();
    expect(screen.getByTestId("button-add-controller")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(order()).toEqual(["row-controller-1", "row-controller-2", "row-controller-3"]);
    expect(request).not.toHaveBeenCalled();
  });
  it("sends real scope and the original order, updates cache, and initializes the next edit from saved order", async () => {
    mount();
    request.mockImplementation(async () => {
      current = site([controllers[1], controllers[0], controllers[2]]);
      return { controllerIds: [2, 1, 3] };
    });
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Clock B up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await screen.findByText("Controller order saved.");
    expect(request).toHaveBeenCalledWith("/api/system-documentation/customers/7/site/controller-order", "PUT", {
      branchName: "North", controllerIds: [2, 1, 3], previousControllerIds: [1, 2, 3],
    });
    expect(order()).toEqual(["row-controller-2", "row-controller-1", "row-controller-3"]);
    expect(qc.getQueryData<DocumentationSite>(docSiteKey(7, "North"))?.site).toEqual(current.site);
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    expect(order()[0]).toBe("reorder-controller-2");
  });
  it("retains a failed draft and retries without claiming it was saved", async () => {
    mount(); request.mockRejectedValueOnce(new Error("Could not save — please retry")).mockResolvedValueOnce({ controllerIds: [2, 1, 3] });
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Clock B up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    expect(screen.queryByText("Controller order saved.")).toBeNull();
    expect(order()[0]).toBe("reorder-controller-2");
    current = site([controllers[1], controllers[0], controllers[2]]);
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await screen.findByText("Controller order saved.");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("retains the original snapshot on a concurrent refresh and Cancel adopts current server rows", async () => {
    mount();
    request.mockRejectedValue(new Error("The controller list or its order changed. Cancel and reorder the refreshed list."));
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Clock B up" }));
    current = site([controllers[0], controllers[2], controller(4, "D")]);
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    await screen.findByRole("alert");
    expect(order()[0]).toBe("reorder-controller-2");
    await waitFor(() => expect(qc.getQueryData<DocumentationSite>(docSiteKey(7, "North"))?.controllers[2].id).toBe(4));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(order()).toEqual(["row-controller-1", "row-controller-3", "row-controller-4"]);
  });
  it("disables save, cancel and arrows while the save is pending", async () => {
    mount();
    let finish!: (value: unknown) => void;
    request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save order" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Clock B up" })).toBeDisabled();
    finish({ controllerIds: [1, 2, 3] });
    await screen.findByText("Controller order saved.");
  });
});

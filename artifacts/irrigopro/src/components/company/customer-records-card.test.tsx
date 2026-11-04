import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  lock: { locked: false, systemName: null as string | null, quickbooksConnected: true, isLoading: false },
  apiRequest: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/hooks/use-customer-records-lock", () => ({ useCustomerRecordsLock: () => state.lock }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/queryClient", async (original) => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: state.apiRequest,
}));
import { CustomerRecordsCard } from "./customer-records-card";

function mount(canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><CustomerRecordsCard companyId={5} canEdit={canEdit} /></QueryClientProvider>);
  return invalidate;
}
beforeEach(() => {
  state.lock = { locked: false, systemName: null, quickbooksConnected: true, isLoading: false };
  state.apiRequest.mockReset().mockResolvedValue({});
  state.toast.mockReset();
});

describe("Customer records Company card", () => {
  it("prevents enabling while disconnected", () => {
    state.lock.quickbooksConnected = false;
    mount();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText("Connect QuickBooks first. While locked, customers can only arrive from QuickBooks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("sends the exact trimmed settings and invalidates the shared cache", async () => {
    const invalidate = mount();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Managed in"), { target: { value: " High Plains CRM " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith("/api/company/5/customer-records", "PUT", { locked: true, systemName: "High Plains CRM" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/company/customer-records"] });
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith({ title: "Customer records setting saved" }));
  });

  it("keeps permitted non-admin readers read-only with no Save", () => {
    mount(false);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByLabelText("Managed in")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Managed in")).toHaveAttribute("maxlength", "60");
  });

  it("warns while locked and disconnected but allows unlocking and blank names", async () => {
    state.lock = { ...state.lock, locked: true, quickbooksConnected: false, systemName: "High Plains CRM" };
    mount();
    expect(screen.getByText("QuickBooks is disconnected. New customers can't reach IrrigoPro until it is reconnected.")).toHaveClass("border-amber-200", "bg-amber-50", "text-amber-800");
    expect(screen.getByRole("switch")).toBeEnabled();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.change(screen.getByLabelText("Managed in"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith("/api/company/5/customer-records", "PUT", { locked: false, systemName: null }));
  });

  it("shows parsed server errors destructively", async () => {
    state.apiRequest.mockRejectedValue(new Error('409: {"message":"Connect QuickBooks before locking customer details."}'));
    mount();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith({
      title: "Error", description: "Connect QuickBooks before locking customer details.", variant: "destructive",
    }));
  });
});

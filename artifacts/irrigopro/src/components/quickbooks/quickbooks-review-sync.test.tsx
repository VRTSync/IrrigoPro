import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuickBooksIntegration } from "./quickbooks-integration";

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(),
  apiRequest: mocks.request,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

beforeEach(() => {
  mocks.request.mockReset();
  mocks.toast.mockReset();
  localStorage.setItem("user", JSON.stringify({ role: "billing_manager", companyId: 1 }));
});

describe("customer sync review notification", () => {
  it.each([
    [{ message: "Existing success description", heldForReview: 2 }, "Existing success description — 2 held for review"],
    [{ message: "Existing success description", heldForReview: 0 }, "Existing success description"],
    [{ customersAdded: 4, customersAlreadySynced: 5 }, "4 added, 5 already synced"],
  ])("preserves the existing description and appends positive held counts: %j", async (response, description) => {
    const client = new QueryClient({ defaultOptions: { queries: {
      staleTime: Infinity, retry: false, queryFn: () => new Promise(() => {}),
    } } });
    client.setQueryData(["/api/quickbooks/connection"], { isConnected: true });
    client.setQueryData(["/api/quickbooks/connection/stale"], { stale: false, count: 0 });
    client.setQueryData(["/api/estimates"], []);
    client.setQueryData(["/api/quickbooks/health"], { connections: [] });
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    mocks.request.mockResolvedValue(response);
    render(<QueryClientProvider client={client}><QuickBooksIntegration /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Customer Sync Complete", description, variant: "default",
    }));
    expect(mocks.request).toHaveBeenCalledWith("/api/quickbooks/sync-customers", "POST");
    for (const key of ["/api/customers", "/api/customers/billing-preview", "/api/customer-review/summary", "/api/quickbooks/customer-pull-status"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});

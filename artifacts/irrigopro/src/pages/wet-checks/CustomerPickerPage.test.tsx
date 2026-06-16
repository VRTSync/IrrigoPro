/**
 * CustomerPickerPage.test.tsx
 *
 * Covers the billing-visible filter fix:
 *  1. The picker's queryFn fetches `/api/customers?billingVisible=true`, not
 *     the defunct `?active=true` param.
 *  2. A customer with `hiddenFromBilling=true` is absent when the server
 *     correctly filters it — i.e. only billing-visible rows are returned.
 *  3. A customer with `hiddenFromBilling=false` appears in the grid.
 *  4. The React Query cache key uses `{ billingVisible: true }`, not
 *     `{ active: true }` — so the correct cache slot is used and the
 *     stale `active=true` slot is ignored.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// vi.hoisted ensures the spy is created before vi.mock factories run (which
// are hoisted to the top of the module at compile time).
const { apiRequestSpy } = vi.hoisted(() => ({
  apiRequestSpy: vi.fn(async (url: string) => {
    if ((url as string).includes("/api/customers")) return [];
    if ((url as string).includes("/api/wet-checks")) return [];
    return [];
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
}));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/wet-checks/new", vi.fn()],
  };
});

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: apiRequestSpy,
  };
});

import CustomerPickerPage from "./CustomerPickerPage";

function makeCustomer(
  overrides: Partial<{
    id: number;
    name: string;
    address: string;
    hiddenFromBilling: boolean;
  }> = {},
) {
  return {
    id: 1,
    name: "Acme Corp",
    address: "123 Main St",
    hiddenFromBilling: false,
    companyId: 1,
    email: null,
    phone: null,
    notes: null,
    billingNotes: null,
    budgetMonthly: null,
    budgetAnnual: null,
    budgetAlertChannels: null,
    budgetAlertRecipientUserIds: null,
    budgetNotifyCustomerContact: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildQc(customers: ReturnType<typeof makeCustomer>[] = []) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["/api/customers", { billingVisible: true }], customers);
  qc.setQueryData(["/api/wet-checks"], []);
  return qc;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("CustomerPickerPage — billing-visible filter", () => {
  it("fetches /api/customers?billingVisible=true (not ?active=true)", async () => {
    apiRequestSpy.mockClear();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      const customerCalls = apiRequestSpy.mock.calls.filter(([url]) =>
        (url as string).includes("/api/customers"),
      );
      expect(customerCalls.length).toBeGreaterThan(0);
      const url = customerCalls[0][0] as string;
      expect(url).toContain("billingVisible=true");
      expect(url).not.toContain("active=true");
    });
  });

  it("renders a billing-visible customer (hiddenFromBilling=false)", async () => {
    const visible = makeCustomer({ id: 1, name: "Visible Corp", hiddenFromBilling: false });
    const qc = buildQc([visible]);
    render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("customer-card-1")).toBeTruthy();
      expect(screen.getByText("Visible Corp")).toBeTruthy();
    });
  });

  it("does not render a hidden-from-billing customer when server omits it", async () => {
    // The server returns only billing-visible customers when
    // ?billingVisible=true is sent. We simulate that by seeding the
    // cache with only the visible customer — the hidden one (id=99)
    // is absent, as the API would return.
    const visible = makeCustomer({ id: 2, name: "Visible Only", hiddenFromBilling: false });
    const qc = buildQc([visible]);
    render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("customer-card-2")).toBeTruthy();
    });
    expect(screen.queryByTestId("customer-card-99")).toBeNull();
  });

  it("uses { billingVisible: true } as the query key, not { active: true }", async () => {
    const visible = makeCustomer({ id: 3, name: "Key Check Corp" });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    // Seed the correct key — component must read from here.
    qc.setQueryData(["/api/customers", { billingVisible: true }], [visible]);
    qc.setQueryData(["/api/wet-checks"], []);
    // Seed the stale key — component must NOT read from here.
    qc.setQueryData(["/api/customers", { active: true }], [
      makeCustomer({ id: 99, name: "ShouldNotAppear" }),
    ]);

    render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("customer-card-3")).toBeTruthy();
    });
    expect(screen.queryByTestId("customer-card-99")).toBeNull();
  });
});

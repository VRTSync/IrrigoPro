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
 *
 * Also covers the branch picker guard (Task #1463):
 *  5. Multi-branch customer with no in-progress check → clicking the card
 *     shows the BranchPicker overlay instead of navigating.
 *  6. Single-location customer → clicking the card navigates directly.
 *  7. Multi-branch customer with an active in-progress check still goes
 *     through the BranchPicker (Resume badge on the active branch).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// vi.hoisted ensures the spy is created before vi.mock factories run (which
// are hoisted to the top of the module at compile time).
const { apiRequestSpy, mockNavigate } = vi.hoisted(() => ({
  apiRequestSpy: vi.fn(async (url: string) => {
    if ((url as string).includes("/api/customers")) return [];
    if ((url as string).includes("/api/wet-checks")) return [];
    return [];
  }),
  mockNavigate: vi.fn(),
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
    useLocation: () => ["/wet-checks/new", mockNavigate],
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

// ─── Branch picker guard (Task #1463) ────────────────────────────────────────
// Proves: multi-branch customers ALWAYS go through the BranchPicker overlay
// before navigation, so POST /api/wet-checks is never hit without a branchName.

function buildQcBranch(
  customers: ReturnType<typeof makeCustomer>[],
  wetChecks: Array<{ id: number; companyId: number; customerId: number; technicianId: number; status: string; branchName: string | null; startedAt: string }> = [],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["/api/customers", { billingVisible: true }], customers);
  qc.setQueryData(["/api/wet-checks"], wetChecks);
  return qc;
}

describe("CustomerPickerPage — branch picker guard (Task #1463)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  describe("(a) multi-branch customer with no in-progress check", () => {
    const multiBranch = makeCustomer({
      id: 50,
      name: "Riverside Campus",
    }) as ReturnType<typeof makeCustomer> & { branches: string[] };
    (multiBranch as Record<string, unknown>).branches = ["North Wing", "South Wing"];

    it("shows the BranchPicker overlay when the customer card is clicked", () => {
      const qc = buildQcBranch([multiBranch]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-50"));

      expect(screen.getByText("Select Branch")).toBeTruthy();
      expect(screen.getByTestId("branch-list")).toBeTruthy();
    });

    it("shows a button for each configured branch", () => {
      const qc = buildQcBranch([multiBranch]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-50"));

      expect(screen.getByTestId("branch-option-North Wing")).toBeTruthy();
      expect(screen.getByTestId("branch-option-South Wing")).toBeTruthy();
    });

    it("does NOT call navigate() when the card is clicked — branch picker intercepts", () => {
      const qc = buildQcBranch([multiBranch]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-50"));

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("back button dismisses the branch picker and returns to the customer list", () => {
      const qc = buildQcBranch([multiBranch]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-50"));
      expect(screen.queryByTestId("branch-list")).toBeTruthy();

      fireEvent.click(screen.getByTestId("branch-picker-back"));
      expect(screen.queryByTestId("branch-list")).toBeNull();
      expect(screen.getByTestId("customer-card-50")).toBeTruthy();
    });
  });

  describe("(b) single-location customer — bypasses branch picker", () => {
    const singleLoc = makeCustomer({ id: 60, name: "Greenfield Estates" });
    // branches is null / absent on a single-location customer

    it("calls navigate() immediately without showing the BranchPicker", () => {
      const qc = buildQcBranch([singleLoc]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-60"));

      expect(mockNavigate).toHaveBeenCalledOnce();
      expect(mockNavigate).toHaveBeenCalledWith("/wet-checks/c/60");
    });

    it("does NOT render the Select Branch heading", () => {
      const qc = buildQcBranch([singleLoc]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-60"));

      expect(screen.queryByText("Select Branch")).toBeNull();
      expect(screen.queryByTestId("branch-list")).toBeNull();
    });
  });

  describe("(c) multi-branch customer WITH an active in-progress check", () => {
    it("still shows the BranchPicker with a Resume badge on the active branch", () => {
      const multiBranch = makeCustomer({ id: 70, name: "Campus North" }) as ReturnType<typeof makeCustomer>;
      (multiBranch as Record<string, unknown>).branches = ["East Wing", "West Wing"];

      const activeCheck = {
        id: 99,
        companyId: 1,
        customerId: 70,
        technicianId: 7,
        status: "in_progress",
        branchName: "East Wing",
        startedAt: new Date("2024-06-01").toISOString(),
      };

      const qc = buildQcBranch([multiBranch], [activeCheck]);
      render(<CustomerPickerPage />, { wrapper: wrapper(qc) });

      fireEvent.click(screen.getByTestId("customer-card-70"));

      // BranchPicker should be showing
      expect(screen.getByTestId("branch-list")).toBeTruthy();

      // East Wing button should carry the Resume badge
      const eastBtn = screen.getByTestId("branch-option-East Wing");
      expect(eastBtn.textContent).toContain("Resume");

      // navigate() must NOT have been called yet
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});

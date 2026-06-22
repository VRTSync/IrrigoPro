/**
 * work-orders-reassign-role-gate.test.tsx
 *
 * Behavioral regression guard for the tech Assign dropdown role gate.
 * Mounts WorkOrders with a mocked currentUser and verifies:
 *
 *  1. company_admin  → Assign select IS rendered on an active non-billed WO.
 *  2. super_admin    → Assign select IS rendered on an active non-billed WO.
 *  3. field_tech     → Assign select is NOT rendered (different view branch).
 *
 * The gate lives in work-orders.tsx:
 *   const canReassign = ['irrigation_manager', 'company_admin', 'super_admin']
 *     .includes(currentUser?.role ?? '');
 * ...gated in JSX as {canReassign && !isBilled(workOrder) && <Select …>}.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Module mocks ────────────────────────────────────────────────────────────

// vi.hoisted so spies are defined before vi.mock factories run (hoisted to top).
const { apiRequestSpy } = vi.hoisted(() => ({
  apiRequestSpy: vi.fn(async () => []),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: apiRequestSpy };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useLocation: () => ["/work-orders", vi.fn()],
  };
});

vi.mock("@/components/work-orders/work-order-wizard", () => ({
  WorkOrderWizard: () => null,
}));

vi.mock("@/components/work-orders/work-order-details", () => ({
  WorkOrderDetails: () => null,
}));

vi.mock("@/components/billing/completed-work-detail-modal", () => ({
  CompletedWorkDetailModal: () => null,
}));

vi.mock("@/components/work-orders/work-order-completion", () => ({
  WorkOrderCompletion: () => null,
}));

vi.mock("@/components/ui/loading-skeleton", () => ({
  WorkOrderListSkeleton: () => null,
}));

// ─── Import the component under test AFTER mocks ─────────────────────────────
import WorkOrders from "./work-orders";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

type Role = "company_admin" | "super_admin" | "field_tech" | "irrigation_manager";

function setUser(role: Role, id = 1) {
  localStorage.setItem(
    "user",
    JSON.stringify({ id, role, companyId: 1, name: "Test User" }),
  );
}

function makeWorkOrder(id: number, assignedTechnicianId: number | null = null) {
  return {
    id,
    workOrderNumber: `WO-${id}`,
    status: "pending",
    projectName: "Spring Inspection",
    customerName: "Acme Farms",
    customerAddress: "123 Ranch Rd",
    projectAddress: "123 Ranch Rd",
    scheduledDate: null,
    invoiceId: null,
    assignedTechnicianId,
    assignedTechnicianName: null,
    estimateId: null,
    description: "",
    priority: "normal",
    completedAt: null,
    billedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    companyId: 1,
  };
}

/**
 * Build a QueryClient pre-seeded with work orders.
 * For field_tech the query key includes the technician id.
 */
function buildQc(
  workOrders: ReturnType<typeof makeWorkOrder>[],
  opts: { forTechId?: number } = {},
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  if (opts.forTechId !== undefined) {
    // field_tech branch uses a different query key
    qc.setQueryData(
      ["/api/work-orders", "technician", opts.forTechId],
      workOrders,
    );
  } else {
    qc.setQueryData(["/api/work-orders"], workOrders);
  }

  // Suppress missing-photos and field-tech list fetches
  qc.setQueryData(["/api/work-orders/missing-photos"], {
    cutoff: null,
    count: 0,
    workOrders: [],
  });
  qc.setQueryData(["/api/users/field-techs"], []);

  return qc;
}

function Wrapper({ qc }: { qc: QueryClient }) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WorkOrders — tech Assign Select role gate", () => {
  afterEach(() => {
    localStorage.clear();
    apiRequestSpy.mockReset();
    apiRequestSpy.mockResolvedValue([]);
  });

  it("company_admin sees Assign select on an active non-billed work order", async () => {
    setUser("company_admin");
    const wo = makeWorkOrder(201);
    const qc = buildQc([wo]);

    render(<WorkOrders />, { wrapper: Wrapper({ qc }) });

    await waitFor(() => {
      expect(
        screen.queryByTestId("assign-tech-select-201") ||
          screen.queryByTestId("assign-tech-select-mobile-201"),
      ).toBeTruthy();
    });
  });

  it("super_admin sees Assign select on an active non-billed work order", async () => {
    setUser("super_admin");
    const wo = makeWorkOrder(202);
    const qc = buildQc([wo]);

    render(<WorkOrders />, { wrapper: Wrapper({ qc }) });

    await waitFor(() => {
      expect(
        screen.queryByTestId("assign-tech-select-202") ||
          screen.queryByTestId("assign-tech-select-mobile-202"),
      ).toBeTruthy();
    });
  });

  it("field_tech does NOT see Assign select on an assigned work order", async () => {
    const techId = 7;
    setUser("field_tech", techId);
    // Assign the WO to the tech so the Field Tech View renders the View button
    // (giving a positive anchor that the WO row IS in the DOM).
    const wo = makeWorkOrder(203, techId);
    const qc = buildQc([wo], { forTechId: techId });

    render(<WorkOrders />, { wrapper: Wrapper({ qc }) });

    await waitFor(() => {
      // The work order should render (field-tech View button anchors this)
      const viewBtn = screen.queryByRole("button", { name: /view/i });
      expect(viewBtn).toBeTruthy();
    });

    // In no scenario should the Assign dropdown be present for field_tech
    expect(screen.queryByTestId("assign-tech-select-203")).toBeNull();
    expect(screen.queryByTestId("assign-tech-select-mobile-203")).toBeNull();
  });
});

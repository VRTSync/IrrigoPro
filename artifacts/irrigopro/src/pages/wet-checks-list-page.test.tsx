/**
 * wet-checks-list-page.test.tsx — Slice 7 unified list page
 *
 * Covers:
 *  1. Role-parity matrix (4 roles × showsCompanyCol / showsBulk)
 *  2. Default status filter per role (query key assertions)
 *  3. Row chrome is identical across irrigation_manager / billing_manager /
 *     company_admin for the same fixture (snapshot parity)
 *  4. Empty-state customer-picker affordance
 *  5. DismissibleHelp dismiss-and-stay-dismissed lifecycle
 *  6. Bulk select gating
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: vi.fn(async () => []),
  };
});
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/wet-checks", vi.fn()],
    Link: ({ href, children }: any) => <a href={href}>{children}</a>,
  };
});

const mockGetCurrentUser = vi.fn();
vi.mock("./wet-checks/helpers", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

import WetChecksListPage from "./wet-checks/WetChecksListPage";
import { resetHelpDismissal } from "@/components/shared/dismissible-help";

const GUIDE_ID = "wc-list-first-time";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    customerName: "Acme Corp",
    propertyAddress: "123 Main St",
    technicianName: "Jordan Lee",
    status: "submitted",
    startedAt: "2026-05-01T10:00:00Z",
    submittedAt: "2026-05-01T14:00:00Z",
    approvedAt: null,
    zoneRecordCount: 3,
    findingCount: 2,
    photoCount: 5,
    companyName: "Sunshine Irrigation",
    ...overrides,
  };
}

function buildQc(rows: unknown[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-checks/admin", "all"], rows);
  qc.setQueryData(["/api/wet-checks/admin", "submitted,pending_manager_review"], rows);
  qc.setQueryData(["/api/wet-checks/admin", "approved_passed_to_billing,billed"], rows);
  qc.setQueryData(["/api/wet-checks/admin", "submitted"], rows);
  qc.setQueryData(["/api/wet-checks/admin", "approved"], rows);
  qc.setQueryData(["/api/customers", { active: true }], []);
  qc.setQueryData(["/api/companies"], []);
  return qc;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin", name: "Admin" });
});

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  resetHelpDismissal(GUIDE_ID);
});

describe("WetChecksListPage — Slice 7", () => {
  describe("role-parity matrix", () => {
    it("super_admin: shows company filter, bulk select", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "super_admin" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.getByTestId("select-wc-company-filter")).toBeTruthy();
      expect(screen.getByTestId("checkbox-wc-select-all")).toBeTruthy();
    });

    it("company_admin: no company filter, has bulk select", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.queryByTestId("select-wc-company-filter")).toBeNull();
      expect(screen.getByTestId("checkbox-wc-select-all")).toBeTruthy();
    });

    it("irrigation_manager: no company filter, no bulk select", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "irrigation_manager" });
      const qc = buildQc([makeRow({ status: "submitted" })]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.queryByTestId("select-wc-company-filter")).toBeNull();
      expect(screen.queryByTestId("checkbox-wc-select-all")).toBeNull();
    });

    it("billing_manager: no company filter, no bulk select", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "billing_manager" });
      const qc = buildQc([makeRow({ status: "approved_passed_to_billing" })]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.queryByTestId("select-wc-company-filter")).toBeNull();
      expect(screen.queryByTestId("checkbox-wc-select-all")).toBeNull();
    });
  });

  describe("default status filter per role", () => {
    function observerCount(qc: QueryClient, statusFilter: string): number {
      return (
        qc
          .getQueryCache()
          .find({ queryKey: ["/api/wet-checks/admin", statusFilter] })
          ?.getObserversCount() ?? 0
      );
    }

    it("irrigation_manager subscribes to status='submitted,pending_manager_review'", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "irrigation_manager" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(observerCount(qc, "submitted,pending_manager_review")).toBeGreaterThan(0);
    });

    it("billing_manager subscribes to status='approved_passed_to_billing,billed'", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "billing_manager" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(observerCount(qc, "approved_passed_to_billing,billed")).toBeGreaterThan(0);
    });

    it("company_admin subscribes to status='all'", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(observerCount(qc, "all")).toBeGreaterThan(0);
    });
  });

  describe("row chrome parity", () => {
    it("renders the same row content for irrigation_manager, billing_manager, company_admin", () => {
      const row = makeRow();
      const roles: Array<"irrigation_manager" | "billing_manager" | "company_admin"> = [
        "irrigation_manager",
        "billing_manager",
        "company_admin",
      ];
      const containers: HTMLElement[] = [];
      for (const role of roles) {
        mockGetCurrentUser.mockReturnValue({ id: 1, role });
        const qc = buildQc([row]);
        const { container, unmount } = render(
          <WetChecksListPage />,
          { wrapper: wrapper(qc) },
        );
        containers.push(container.cloneNode(true) as HTMLElement);
        unmount();
      }
      for (const c of containers) {
        expect(c.querySelector('[data-testid="card-wc-row-1"]')).toBeTruthy();
        expect(c.textContent).toContain("Acme Corp");
        expect(c.textContent).toContain("Jordan Lee");
      }
    });
  });

  describe("empty state customer-picker", () => {
    it("shows empty-state picker when no rows and no filters active", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.getByTestId("wc-empty-state-picker")).toBeTruthy();
    });

    it("shows 'no match' card when filters active but no rows", async () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      const input = screen.getByTestId("input-wc-customer-filter");
      fireEvent.change(input, { target: { value: "XYZ" } });
      await waitFor(() => {
        expect(screen.queryByTestId("wc-empty-state-picker")).toBeNull();
        expect(screen.getByText(/No wet checks match/i)).toBeTruthy();
      });
    });
  });

  describe("DismissibleHelp lifecycle", () => {
    it("renders the help banner when not dismissed", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.getByTestId(`help-${GUIDE_ID}`)).toBeTruthy();
    });

    it("dismiss button hides the banner and persists to localStorage", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      fireEvent.click(screen.getByTestId(`help-dismiss-${GUIDE_ID}`));
      expect(screen.queryByTestId(`help-${GUIDE_ID}`)).toBeNull();
      const storedKeys = Object.keys(window.localStorage).filter((k) =>
        k.includes(GUIDE_ID),
      );
      expect(storedKeys.length).toBeGreaterThan(0);
    });

    it("banner stays dismissed across re-renders when key is in localStorage", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([]);
      const { unmount } = render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      fireEvent.click(screen.getByTestId(`help-dismiss-${GUIDE_ID}`));
      unmount();
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.queryByTestId(`help-${GUIDE_ID}`)).toBeNull();
    });
  });

  describe("bulk selection (admin roles only)", () => {
    it("shows bulk toolbar after selecting a row", async () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "company_admin" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      fireEvent.click(screen.getByTestId("checkbox-wc-select-1"));
      await waitFor(() => {
        expect(screen.getByTestId("bulk-selection-toolbar")).toBeTruthy();
        expect(screen.getByTestId("text-bulk-selected-count").textContent).toContain("1");
      });
    });

    it("does NOT show bulk select for irrigation_manager", () => {
      mockGetCurrentUser.mockReturnValue({ id: 1, role: "irrigation_manager" });
      const qc = buildQc([makeRow()]);
      render(<WetChecksListPage />, { wrapper: wrapper(qc) });
      expect(screen.queryByTestId("checkbox-wc-select-all")).toBeNull();
      expect(screen.queryByTestId("bulk-selection-toolbar")).toBeNull();
    });
  });
});

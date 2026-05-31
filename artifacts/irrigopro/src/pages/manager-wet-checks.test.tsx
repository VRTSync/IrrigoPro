/**
 * manager-wet-checks.test.tsx — rewired to WetChecksListPage (Slice 7)
 *
 * Verifies that irrigation_manager's default status filter is 'submitted'
 * and that the unified list page renders correctly for that role.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: vi.fn(async () => []) };
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

function buildQc(rows: unknown[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-checks/admin", "submitted,pending_manager_review"], rows);
  qc.setQueryData(["/api/wet-checks/admin", "all"], rows);
  qc.setQueryData(["/api/customers", { active: true }], []);
  return qc;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockGetCurrentUser.mockReturnValue({ id: 1, role: "irrigation_manager", name: "Manager" });
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  resetHelpDismissal("wc-list-first-time");
});

describe("WetChecksListPage — irrigation_manager role (rewired from manager-wet-checks)", () => {
  it("renders the unified page wrapper", () => {
    const qc = buildQc([]);
    render(<WetChecksListPage />, { wrapper: wrapper(qc) });
    expect(screen.getByTestId("page-wet-checks-list")).toBeDefined();
  });

  it("seeds status=submitted,pending_manager_review as the default filter", () => {
    const qc = buildQc([]);
    const spy = vi.spyOn(qc, "getQueryData");
    render(<WetChecksListPage />, { wrapper: wrapper(qc) });
    const submittedCalls = spy.mock.calls.filter(
      (args) => JSON.stringify(args[0]).includes("submitted,pending_manager_review"),
    );
    expect(submittedCalls.length).toBeGreaterThan(0);
  });

  it("does NOT show bulk select checkbox for irrigation_manager", () => {
    const qc = buildQc([{
      id: 1, customerName: "Acme", propertyAddress: null,
      technicianName: "Tech", status: "submitted",
      startedAt: "2026-05-01T10:00:00Z", submittedAt: null, approvedAt: null,
    }]);
    render(<WetChecksListPage />, { wrapper: wrapper(qc) });
    expect(screen.queryByTestId("checkbox-wc-select-all")).toBeNull();
  });

  it("does NOT show company column filter for irrigation_manager", () => {
    const qc = buildQc([]);
    render(<WetChecksListPage />, { wrapper: wrapper(qc) });
    expect(screen.queryByTestId("select-wc-company-filter")).toBeNull();
  });

  it("shows empty-state picker when no wet checks are found", () => {
    const qc = buildQc([]);
    render(<WetChecksListPage />, { wrapper: wrapper(qc) });
    expect(screen.getByTestId("wc-empty-state-picker")).toBeTruthy();
  });
});

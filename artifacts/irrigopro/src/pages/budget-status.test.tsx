import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() =>
  vi.fn(() => ({ user: { role: "billing_manager" } })),
);

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: useQueryMock,
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: useAuthMock,
}));

import BudgetStatusPage from "./budget-status";
import { BudgetStatusCard } from "@/components/budget/BudgetStatusCard";

const response = {
  year: 2026,
  month: 9,
  lastRefreshedAt: "2026-09-08T12:00:00.000Z",
  rollup: {
    totalAllocation: 1000,
    totalSpend: 500,
    totalInvoiced: 400,
    totalPending: 100,
    customersWithAllocation: 1,
    overCapCount: 0,
    approachingCount: 0,
    seasonToDateTarget: 4000,
    seasonToDateSpend: 2000,
  },
  rows: [
    {
      customerId: 1,
      customerName: "Budgeted Customer",
      allocation: 1000,
      invoicedAmount: 400,
      pendingAmount: 100,
      totalSpend: 500,
      fillPercent: 50,
      status: "Go",
      softThresholdPercent: 75,
      hardThresholdPercent: 100,
      seasonToDateTarget: 4000,
      seasonToDateSpend: 2000,
      seasonToDateInvoiced: 1800,
      seasonToDatePending: 200,
      annualGoal: 7000,
    },
    {
      customerId: 2,
      customerName: "Unset Customer",
      allocation: null,
      invoicedAmount: 0,
      pendingAmount: 0,
      totalSpend: 0,
      fillPercent: null,
      status: "Unset",
      softThresholdPercent: 75,
      hardThresholdPercent: 100,
      seasonToDateTarget: 0,
      seasonToDateSpend: 0,
      seasonToDateInvoiced: 0,
      seasonToDatePending: 0,
      annualGoal: null,
    },
  ],
};

describe("Budget Status unset-customer filter", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    useAuthMock.mockReturnValue({ user: { role: "billing_manager" } });
    useQueryMock.mockReturnValue({ data: response, isLoading: false });
  });

  it("defaults on, reports the hidden count, and reveals unset rows when toggled off", () => {
    render(<BudgetStatusPage />);

    const checkbox = screen.getByRole("checkbox", {
      name: /Hide customers with no budget set/i,
    });
    expect(checkbox).toBeChecked();
    expect(screen.getByTestId("unset-count")).toHaveTextContent("1 hidden");
    expect(screen.getByText("Budgeted Customer")).toBeInTheDocument();
    expect(screen.queryByText("Unset Customer")).not.toBeInTheDocument();

    fireEvent.click(checkbox);

    expect(checkbox).not.toBeChecked();
    expect(screen.getByTestId("unset-count")).toHaveTextContent("1 unset");
    expect(screen.getByText("Unset Customer")).toBeInTheDocument();
  });

  it("keeps the workspace card and full page on the same budget-status read", () => {
    const page = render(<BudgetStatusPage />);
    const pageQuery = useQueryMock.mock.calls.at(-1)?.[0]?.queryKey?.[0];
    page.unmount();

    render(<BudgetStatusCard />);
    const cardQuery = useQueryMock.mock.calls.at(-1)?.[0]?.queryKey?.[0];

    expect(pageQuery).toBe(cardQuery);
    expect(pageQuery).toMatch(/^\/api\/budget\/status\?year=\d{4}&month=\d{1,2}$/);
  });

  it("forwards an explicit company scope for super-admin links", () => {
    useAuthMock.mockReturnValue({ user: { role: "super_admin" } });
    window.history.replaceState({}, "", "/budget-status?companyId=42");
    render(<BudgetStatusPage />);

    const query = useQueryMock.mock.calls.at(-1)?.[0]?.queryKey?.[0];
    expect(query).toMatch(/&companyId=42$/);
  });

  it("does not show an unscoped roll-up to a super admin", () => {
    useAuthMock.mockReturnValue({ user: { role: "super_admin" } });
    render(<BudgetStatusPage />);

    expect(
      screen.getByText("Select a company before opening Budget Status."),
    ).toBeInTheDocument();
    expect(useQueryMock.mock.calls.at(-1)?.[0]?.enabled).toBe(false);
  });

  it("preserves company scope from the super-admin card to the full page", () => {
    useAuthMock.mockReturnValue({ user: { role: "super_admin" } });
    window.history.replaceState({}, "", "/manager-workspace?companyId=42");
    render(<BudgetStatusCard />);

    expect(screen.getByRole("link", { name: /View all/i })).toHaveAttribute(
      "href",
      "/budget-status?companyId=42",
    );
  });
});
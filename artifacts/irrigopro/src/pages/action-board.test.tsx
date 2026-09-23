import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActionBoardPage from "./action-board";

const base = {
  year: 2026,
  month: 9,
  excludedWithoutBudgetGoal: 2,
  rows: [
    {
      customerId: 1, customerName: "Decimal Lawn", lane: "clear_to_send",
      allocation: 1000, annualGoal: 12000, invoicedAmount: 100, pendingAmount: 200,
      doNotExceed: 700, openWorkOrders: [
        { workOrderNumber: "WO-1", estimatedTotal: "125.50" },
        { workOrderNumber: "WO-2", estimatedTotal: "74.50" },
      ], wetCheckDue: false,
    },
    {
      customerId: 2, customerName: "Approved Estate", lane: "over_budget_nothing_approved",
      allocation: 100, annualGoal: 1200, invoicedAmount: 150, pendingAmount: 0,
      doNotExceed: -50, preApproved: true, openWorkOrders: [
        { workOrderNumber: "WO-3", estimatedTotal: 200, preApproved: true },
      ], wetCheckDue: true,
    },
    {
      customerId: 3, customerName: "No Work Garden", lane: "nothing_pending",
      allocation: 800, annualGoal: 9600, invoicedAmount: 100, pendingAmount: 0,
      doNotExceed: 700, openWorkOrders: [], wetCheckDue: false,
    },
    {
      customerId: 4, customerName: "Direct Work", lane: "clear_to_send",
      allocation: 800, annualGoal: 9600, invoicedAmount: 0, pendingAmount: 0,
      doNotExceed: 800, openWorkOrders: [{ workOrderNumber: "WO-4", estimatedTotal: null }],
      wetCheckDue: true,
    },
  ],
  rollup: { totalAllocation: 2700, totalInvoiced: 350, seasonToDateTarget: 5000, seasonToDateSpend: 3000, overBudgetCount: 1, heldWorkOrderCount: 0 },
};

function renderPage(response = base) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ActionBoardPage /></QueryClientProvider>);
}

describe("Action Board page", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders normalized decimal totals, null estimates, every lane, approvals, and no edit/findings UI", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("action-board-excluded")).toBeInTheDocument());
    expect(screen.getByTestId("action-board-excluded")).toHaveTextContent("2 customers");
    expect(screen.getByText(/2 · \$200/)).toBeInTheDocument();
    expect(screen.getByText(/1 · no estimate/)).toBeInTheDocument();
    expect(screen.queryByText(/1 · \$0/)).not.toBeInTheDocument();
    expect(screen.getByTestId("action-board-lane-clear_to_send")).toBeInTheDocument();
    expect(screen.getByTestId("action-board-lane-over_budget")).toBeInTheDocument();
    expect(screen.getByTestId("action-board-lane-nothing_pending")).toBeInTheDocument();
    expect(screen.getAllByText(/pre-approved/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("action-board-excluded")).toHaveTextContent("2 customers excluded");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/edit/i)).not.toBeInTheDocument();
  });

  it("shows the budget-goal empty state", async () => {
    renderPage({ ...base, rows: [], excludedWithoutBudgetGoal: 4 });
    await waitFor(() => expect(screen.getByTestId("action-board-empty")).toBeInTheDocument());
    expect(screen.getByTestId("action-board-empty")).toHaveTextContent("No customers have a budget goal");
    expect(screen.getByTestId("action-board-excluded")).toHaveTextContent("4 customers excluded");
  });
});
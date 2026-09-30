import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { generateActionBoardPlan } from "@workspace/shared";
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
  return { ...render(<QueryClientProvider client={client}><ActionBoardPage /></QueryClientProvider>), client };
}

describe("Action Board page", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
    expect(screen.getByTestId("button-copy-plan")).toBeInTheDocument();
    expect(screen.getByTestId("input-action-board-plan")).toHaveValue(
      generateActionBoardPlan(base.rows, new Date()),
    );
    expect(screen.queryByText(/finding/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("input-action-board-plan")).toBeInTheDocument();
  });

  it("shows the budget-goal empty state", async () => {
    renderPage({ ...base, rows: [], excludedWithoutBudgetGoal: 4 });
    await waitFor(() => expect(screen.getByTestId("action-board-empty")).toBeInTheDocument());
    expect(screen.getByTestId("action-board-empty")).toHaveTextContent("No customers have a budget goal");
    expect(screen.getByTestId("action-board-excluded")).toHaveTextContent("4 customers excluded");
  });

  it("keeps the editable plan through a refetch, copies edits, and confirms regeneration", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { client } = renderPage();
    await waitFor(() => expect((screen.getByTestId("input-action-board-plan") as HTMLTextAreaElement).value).toContain("Decimal Lawn"));
    const editor = screen.getByTestId("input-action-board-plan") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "Crew A\nDecimal Lawn" } });
    client.setQueriesData({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/action-board?") },
      (old) => ({ ...(old as typeof base), excludedWithoutBudgetGoal: 5 }));
    await waitFor(() => expect(screen.getByTestId("action-board-excluded")).toHaveTextContent("5 customers"));
    expect(editor.value).toBe("Crew A\nDecimal Lawn");
    fireEvent.click(screen.getByTestId("button-copy-plan"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Crew A\nDecimal Lawn"));
    expect(screen.getByTestId("status-copy-plan")).toHaveTextContent("Copied today's plan");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByTestId("button-regenerate-plan"));
    expect(confirm).toHaveBeenCalled();
    expect(editor.value).toBe("Crew A\nDecimal Lawn");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId("button-regenerate-plan"));
    expect(editor.value).toContain("Decimal Lawn");
    expect(editor.value).toContain("Work orders are in the app");
  });

  it("selects the full plan for manual copy when both clipboard paths fail", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    renderPage();
    await waitFor(() => expect((screen.getByTestId("input-action-board-plan") as HTMLTextAreaElement).value).toContain("Decimal Lawn"));
    const editor = screen.getByTestId("input-action-board-plan") as HTMLTextAreaElement;
    fireEvent.click(screen.getByTestId("button-copy-plan"));
    await waitFor(() => expect(screen.getByTestId("status-copy-plan")).toHaveTextContent("copy it manually"));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(editor.value.length);
  });

  it("copies with the selection fallback when iOS does not expose the async clipboard", async () => {
    vi.stubGlobal("navigator", {});
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    renderPage();
    await waitFor(() => expect((screen.getByTestId("input-action-board-plan") as HTMLTextAreaElement).value).toContain("Decimal Lawn"));
    fireEvent.click(screen.getByTestId("button-copy-plan"));
    await waitFor(() => expect(screen.getByTestId("status-copy-plan")).toHaveTextContent("Copied today's plan"));
    expect(exec).toHaveBeenCalledWith("copy");
  });
});
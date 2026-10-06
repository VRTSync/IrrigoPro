import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { generateActionBoardPlan } from "@workspace/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActionBoardPage from "./action-board";

const auth = vi.hoisted(() => ({ role: "irrigation_manager" as string | undefined }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: auth.role ? { role: auth.role } : null }),
}));

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
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: !(auth.role === "super_admin" && url.startsWith("/api/action-board") && !new URL(url, "http://localhost").searchParams.has("companyId")),
    json: async () => url === "/api/companies" ? [{ id: 10, name: "Company A" }, { id: 20, name: "Company B" }] : response,
  })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><ActionBoardPage /></QueryClientProvider>), client };
}

describe("Action Board page", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); auth.role = "irrigation_manager"; window.history.replaceState({}, "", "/action-board"); });

  it.each(["billing_manager", "bookkeeper", "field_tech", "unknown", undefined])(
    "denies direct page access for %s without issuing any requests",
    (role) => {
      auth.role = role;
      renderPage();
      expect(screen.getByRole("alert")).toHaveTextContent("You do not have access to Action Board.");
      expect(screen.queryByTestId("action-board-page")).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["irrigation_manager", "company_admin", "super_admin"])(
    "allows direct page access for %s",
    async (role) => {
      auth.role = role;
      if (role === "super_admin") window.history.replaceState({}, "", "/action-board?companyId=10");
      renderPage();
      await waitFor(() => expect(screen.getByTestId("action-board-excluded")).toBeInTheDocument());
      expect(screen.getByTestId("action-board-page")).toBeInTheDocument();
      const boardCalls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/action-board"));
      expect(boardCalls.length).toBeGreaterThan(0);
      for (const [url] of boardCalls) {
        const params = new URL(String(url), "http://localhost").searchParams;
        expect(params.get("companyId")).toBe(role === "super_admin" ? "10" : null);
      }
    },
  );

  it("waits for super-admin company selection and scopes board and tiles after switching companies", async () => {
    auth.role = "super_admin";
    renderPage();
    await screen.findByRole("option", { name: "Company A" });
    expect(screen.getByText("Select a company before opening Action Board.")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/action-board"))).toBe(false);
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "10" } });
    await screen.findByTestId("action-board-excluded");
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "20" } });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("companyId=20"))).toBe(true));
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/action-board"));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every(([url]) => ["10", "20"].includes(new URL(String(url), "http://localhost").searchParams.get("companyId") ?? ""))).toBe(true);
  });

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
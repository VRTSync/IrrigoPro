import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import FinancialPulsePage from "./financial-pulse";

beforeEach(() => {
  localStorage.setItem("user", JSON.stringify({ id: 1, role: "company_admin" }));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = url.includes("/pulse-summary")
      ? {
          lastCycle: { value: 300 },
          inFlight: { value: 100, customerCount: 1, techCount: 1 },
          yearToDate: { value: 400 },
          customers: [{ customerId: 1, name: "Acme Grounds", budgetStatus: "healthy", inFlight: 100, ytd: 400 }],
          technicians: [{ technicianId: 2, name: "Alex", inFlight: 100, ytd: 400 }],
        }
      : url.includes("/top-customers")
        ? {
            rows: [{
              customerId: 1, name: "Acme Grounds", revenue: 400,
              monthlySpark: [{ month: "2026-10", revenue: 400 }],
              monthlyCap: 1_000, monthlySpend: 400, monthlyStatus: "healthy",
              annualCap: 10_000, annualSpend: 400,
              avgDaysToPay: 12, lastInvoiceAt: "2026-10-01",
            }],
          }
        : null;
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  }));
});

afterEach(() => {
  localStorage.removeItem("user");
  vi.unstubAllGlobals();
});

function renderPulse(path: string) {
  const nav = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <Router hook={nav.hook} searchHook={nav.searchHook}>
        <TooltipProvider>
          <FinancialPulsePage />
        </TooltipProvider>
      </Router>
    </QueryClientProvider>,
  );
}

function expectStackedLabels(row: HTMLElement, labels: (string | null)[]) {
  const table = row.closest("table");
  expect(table).toHaveClass("table-stack");
  expect(Array.from(table!.querySelectorAll("th"), (header) =>
    (header.querySelector("button > span") ?? header).textContent?.trim()))
    .toEqual(labels.map((label) => label ?? ""));
  expect(Array.from(row.querySelectorAll("td"), (cell) => cell.getAttribute("data-label")))
    .toEqual(labels);
}

it("stacks the In-Flight by Customer and by Technician tables without dropping columns", async () => {
  renderPulse("/financial-pulse");
  expectStackedLabels(await screen.findByTestId("pulse-customer-row-1"), ["Customer", "Budget", "In-Flight", "YTD"]);
  expectStackedLabels(await screen.findByTestId("pulse-tech-row-2"), ["Technician", "In-Flight", "YTD"]);
});

it("stacks the customer health table, keeping its actions cell unlabeled", async () => {
  renderPulse("/financial-pulse?tab=accounting");
  expectStackedLabels(await screen.findByTestId("customer-row-1"), [
    "Customer", "Revenue", "Trend (7m)", "Monthly used", "Annual used", "Status",
    "Avg. time to pay", "Last invoice", null,
  ]);
});

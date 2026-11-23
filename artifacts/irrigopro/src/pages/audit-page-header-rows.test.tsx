import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AuthProvider } from "@/lib/auth-context";
import BillingZeroPriceAuditPage from "./billing-zero-price-audit";
import CustomerProfile from "./customer-profile";
import LaborRateAuditPage from "./labor-rate-audit";
import { WetCheckDetail } from "./wet-checks/WetCheckDetail";

// Radix Select expects pointer capture, which jsdom doesn't implement.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const customer = { id: 1, name: "Header Test Customer" };
const auditRow = {
  source: "billing_sheet",
  parentId: 1,
  parentNumber: "BS-001",
  customerId: customer.id,
  customerName: customer.name,
  workDate: null,
  technicianName: "Test Technician",
  status: "completed",
};

afterEach(() => localStorage.removeItem("user"));

function renderPage(path: string, route: string, page: React.ReactNode) {
  localStorage.setItem("user", JSON.stringify({ role: "company_admin" }));
  const location = memoryLocation({ path });
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: 0, retry: false, queryFn: async () => [] },
    },
  });
  return {
    client,
    go: () => render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Router hook={location.hook} searchHook={location.searchHook}>
            <Route path={route}>{page}</Route>
            <Route path="/billing-sheets"><h1>Billing Sheets</h1></Route>
          </Router>
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("Audit Fix page header rows", () => {
  it.each(["service", "inspection"])("wraps both wet check header rows in %s mode without losing actions", (mode) => {
    const { client, go } = renderPage("/wet-checks/1", "/wet-checks/:id", <WetCheckDetail id={1} />);
    client.setQueryData(["/api/wet-checks", 1], {
      id: 1, mode, customerId: customer.id, customerName: customer.name,
      status: "submitted", zoneRecords: [], photos: [],
    });
    client.setQueryData(["/api/properties", customer.id, "controllers"], []);
    go();

    const back = screen.getByRole("button", { name: "Back to Customer" });
    const pdf = screen.getByTestId("wet-check-download-pdf");
    const actions = pdf.parentElement!;
    expect(back.parentElement).toHaveClass("flex-wrap");
    expect(actions.parentElement).toBe(back.parentElement);
    expect(actions).toHaveClass("flex-wrap", "justify-end");
    expect(within(actions).getByRole("button", { name: "Export CSV" })).toBeVisible();
    expect(pdf).toBeVisible();
    expect(within(actions).getByTestId("wet-check-download-report")).toBeVisible();
    expect(within(actions).getByTestId("wet-check-send-report")).toBeVisible();
  });

  it("wraps the customer actions and all five profile tabs", () => {
    const { client, go } = renderPage("/customers/1/profile", "/customers/:id/profile", <CustomerProfile />);
    client.setQueryData(["/api/customers/1"], customer);
    go();

    const actions = screen.getByRole("button", { name: "View Site Map" }).parentElement!;
    expect(actions).toHaveClass("flex-wrap", "max-w-full");
    expect(actions).not.toHaveClass("shrink-0");
    const tabs = screen.getByRole("tablist");
    expect(tabs).toHaveClass("flex-wrap");
    expect(tabs).not.toHaveClass("min-w-max");
    expect(tabs.parentElement).not.toHaveClass("overflow-x-auto");
    expect(within(tabs).getAllByRole("tab")).toHaveLength(5);
    for (const tab of within(tabs).getAllByRole("tab")) expect(tab).toBeVisible();
  });

  it.each([
    {
      path: "/billing-sheets/zero-price-audit",
      query: "/api/admin/billing-sheets/zero-price-audit",
      page: <BillingZeroPriceAuditPage />,
      row: {
        ...auditRow, itemId: 1, itemName: "Sprinkler", partId: 1, partName: "Sprinkler",
        quantity: "1", storedUnitPrice: "0", storedTotalPrice: "0",
        catalogUnitPrice: "5", expectedTotalPrice: "5", difference: "5",
      },
    },
    {
      path: "/billing-sheets/labor-rate-audit",
      query: "/api/admin/labor-rate-audit",
      page: <LaborRateAuditPage />,
      row: {
        ...auditRow, totalHours: "1", storedLaborRate: "5", storedLaborSubtotal: "5",
        storedPartsSubtotal: "0", storedTotalAmount: "5",
        customerStandardRate: "10", customerEmergencyRate: "15", inferredClassification: "standard",
        expectedLaborRate: "10", expectedLaborSubtotal: "10", expectedTotalAmount: "10",
      },
    },
  ])("keeps one header back control and right-aligned Refresh on $path with results", ({ path, query, page, row }) => {
    const { client, go } = renderPage(path, path, page);
    client.setQueryData([query], { companyId: 1, count: 1, rows: [row] });
    go();

    expect(screen.getByText(customer.name)).toBeVisible();
    expect(screen.queryByTestId("button-back-billing-sheets")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" }).parentElement).toHaveClass("justify-end");
    fireEvent.click(screen.getByTestId("page-header-back"));
    expect(screen.getByRole("heading", { name: "Billing Sheets" })).toBeVisible();
  });
});

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AdminControllers from "./admin-controllers";
import AdminIssueTypesPage from "./admin-issue-types";
import LaborRates from "./labor-rates";

const proto = Element.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};

const customer = { id: 1, name: "Acme Grounds", irrigoName: "Acme", companyId: 3 };
const laborRatesKey = ["/api/customers", { billingVisible: true }] as const;

beforeEach(() => {
  localStorage.setItem("user", JSON.stringify({ role: "company_admin" }));
});

afterEach(() => {
  localStorage.removeItem("user");
});

function renderPage(page: ReactNode, key: QueryKey, rows: unknown[]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity, gcTime: 0, retry: false,
        queryFn: ({ queryKey }) => { throw new Error(`Unexpected query: ${JSON.stringify(queryKey)}`); },
      },
    },
  });
  client.setQueryData(key, rows);
  render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
}

function expectRowLabels(row: HTMLElement, labels: (string | null)[]) {
  const table = screen.getByRole("table");
  expect(table).toHaveClass("table-stack");
  expect(table.parentElement).toHaveClass("table-stack-container");
  expect(within(row).getAllByRole("cell").map(cell => cell.getAttribute("data-label"))).toEqual(labels);
}

describe("Stacked admin tables", () => {
  it("labels issue type data cells and keeps the edit actions unlabelled", async () => {
    renderPage(<AdminIssueTypesPage />, ["/api/admin/issue-types"], [{
      id: 42, issueType: "broken_head", issueGroup: "quick_fix",
      displayLabel: "Broken head", defaultLaborHours: "0.50", partCategoryFilter: "Heads",
      isActive: true,
    }]);
    const row = await screen.findByTestId("row-issue-type-42");
    const labels = ["Order", "Label", "Key", "Group", "Labor hrs", "Part filter", "Active", null];
    expectRowLabels(row, labels);

    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect(within(row).getByTestId("select-group-42")).toHaveTextContent("Quick Fix");
    expectRowLabels(row, labels);
  });

  it("labels customer and both labor rates, but not actions", async () => {
    renderPage(<LaborRates />, laborRatesKey, [{ ...customer, laborRate: "50", emergencyLaborRate: "125" }]);

    const row = (await screen.findByText("Acme")).closest("tr")!;
    expectRowLabels(row, ["Customer", "Standard Rate ($/hr)", "Emergency Rate ($/hr)", null]);
  });

  it("leaves the labor rates empty state unlabelled", async () => {
    renderPage(<LaborRates />, laborRatesKey, []);

    const empty = await screen.findByRole("cell", { name: "No customers found" });
    expect(empty).toHaveAttribute("colspan", "4");
    expectRowLabels(empty.closest("tr")!, [null]);
  });

  it("labels controller data and leaves the expander, actions, and detail cells unlabelled", async () => {
    renderPage(<AdminControllers />, ["/api/irrigation-controllers/company-rollup"], [{
      customer,
      controllers: [{ id: 4, name: "Main Clock", totalZones: 12 }],
    }]);
    const expand = await screen.findByRole("button", { name: "Expand" });
    expectRowLabels(expand.closest("tr")!, [null, "Customer", "Controllers", null]);

    fireEvent.click(expand);
    const detail = (await screen.findByText("Main Clock")).closest("tr")!;
    expectRowLabels(detail, [null, null]);
    expect(within(detail).getAllByRole("cell")[1]).toHaveAttribute("colspan", "3");
  });
});

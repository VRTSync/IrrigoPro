import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import CompanyAdminApp from "@/components/company-admin-app";
import { getQueryFn } from "@/lib/queryClient";
import Customers from "./customers";

vi.mock("@/components/customer-form", () => ({
  CustomerForm: ({ customer, trigger }: { customer?: object; trigger: ReactNode }) =>
    customer ? <button>Edit Customer</button> : trigger,
}));
vi.mock("@/components/layout/desktop-shell", () => ({
  DesktopShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const prototype = Element.prototype;
prototype.hasPointerCapture ??= () => false;
prototype.setPointerCapture ??= () => {};
prototype.releasePointerCapture ??= () => {};

const admin = {
  id: 1, companyId: 1, username: "fixture", name: "Fixture",
  role: "company_admin" as const, email: "admin@example.invalid", isActive: true,
};
const visible = {
  id: 10, name: "Cedar Gardens", email: "cedar@example.invalid", phone: "555-0100",
  address: "10 Cedar Road", hiddenFromBilling: false, quickbooksId: null,
};
const inactive = {
  id: 12, name: "Elm Gardens", email: "elm@example.invalid", address: "12 Elm Road",
  hiddenFromBilling: true, hiddenByQuickbooks: true, quickbooksId: "qb-12",
};
const allPath = "/api/customers";
const billablePath = "/api/customers?billingVisible=true";
const fetchSpy = vi.fn<typeof fetch>();

function mockCustomers() {
  let customers = [
    { ...visible }, { ...visible, id: 11, name: "Oak Gardens" }, { ...inactive },
  ];
  fetchSpy.mockImplementation(async (input, options) => {
    const path = String(input);
    const method = options?.method ?? "GET";
    if (method === "GET" && path === allPath) return Response.json(customers);
    if (method === "GET" && path === billablePath) {
      return Response.json(customers.filter(customer => !customer.hiddenFromBilling));
    }
    if (method === "GET" && path === "/api/company/customer-records") {
      return Response.json({ locked: true, quickbooksConnected: false, systemName: "quickbooks" });
    }
    if (method === "PATCH" && path === `${allPath}/10`) {
      const { hiddenFromBilling } = JSON.parse(String(options?.body));
      customers = customers.map(customer =>
        customer.id === 10 ? { ...customer, hiddenFromBilling } : customer,
      );
      return Response.json(customers[0]);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  mockCustomers();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mount(role: string, path = "/customers", withRouter = false) {
  localStorage.setItem("user", JSON.stringify({ ...admin, role }));
  localStorage.setItem("onboarding_completed", "true");
  const navigation = memoryLocation({ path, record: true });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } },
  });
  render(
    <Router hook={navigation.hook} searchHook={navigation.searchHook}>
      <QueryClientProvider client={client}>
        {withRouter ? <CompanyAdminApp user={admin} /> : <Customers />}
      </QueryClientProvider>
    </Router>,
  );
  return navigation;
}

const billableTab = () => screen.getByTestId("tab-customers-billable");
const allTab = () => screen.getByTestId("tab-customers-all");
const billingSwitch = (name: string) => screen.getAllByRole("switch", { name: `Show ${name} in billing` });
const rowFor = (name: string) => within(screen.getByRole("row", { name: new RegExp(name) }));

describe("Customers", () => {
  it.each(["company_admin", "super_admin"])("%s can switch between both lists without adding history", async (role) => {
    const navigation = mount(role);
    await screen.findByTestId("tab-customers-billable");
    expect(billableTab()).toHaveTextContent("Billable customers (2)");
    expect(billableTab()).toHaveAttribute("aria-selected", "true");
    expect(allTab()).toHaveTextContent("All customers (3)");
    expect(screen.getByTestId("card-customer-10")).toBeInTheDocument();
    expect(screen.queryByTestId("card-customer-12")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/QuickBooks is disconnected/)).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining([billablePath, allPath]));
    for (const [metric, label, count] of [
      ["billable", "Billable", "2"], ["hidden", "Hidden from billing", "1"], ["total", "Total", "3"],
    ]) {
      const tile = within(screen.getByTestId(`metric-${metric}-customers`));
      expect(tile.getByText(label)).toBeInTheDocument();
      expect(tile.getByText(count)).toBeInTheDocument();
    }

    fireEvent.mouseDown(allTab(), { button: 0 });
    expect(navigation.history).toEqual(["/customers?view=all"]);
    expect(allTab()).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("columnheader", { name: "Show in Billing" })).toBeInTheDocument();
    expect(billingSwitch("Elm Gardens")).toHaveLength(2);
    expect(screen.getByTestId("card-customer-12")).toHaveClass("opacity-60");
    expect(screen.getAllByText("Inactive in QuickBooks")).toHaveLength(2);
    expect(screen.getByText(/QuickBooks is disconnected/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Customer" })).not.toBeInTheDocument();
    expect(rowFor("Elm Gardens").queryByRole("button", { name: "Delete Customer" })).not.toBeInTheDocument();
    expect(rowFor("Cedar Gardens").getByRole("button", { name: "Delete Customer" })).toBeInTheDocument();

    fireEvent.mouseDown(billableTab(), { button: 0 });
    expect(navigation.history).toEqual(["/customers"]);
    expect(screen.queryByTestId("card-customer-12")).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.every(([, options]) => (options?.method ?? "GET") === "GET")).toBe(true);
  });

  it.each(["billing_manager", "irrigation_manager", "bookkeeper", "field_tech"])(
    "%s sees only billable customers even from a direct All link",
    async (role) => {
      mount(role, "/customers?view=all");
      expect(await screen.findByTestId("card-customer-10")).toBeInTheDocument();
      expect(screen.queryByTestId("card-customer-12")).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.queryByTestId("tab-customers-all")).not.toBeInTheDocument();
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
      expect(within(screen.getByTestId("metric-billable-customers")).getByText("Customers")).toBeInTheDocument();
      expect(screen.getAllByTestId(/^metric-.*-customers$/)).toHaveLength(1);
      expect(fetchSpy.mock.calls.map(([path]) => path)).toContain(billablePath);
      expect(fetchSpy.mock.calls.map(([path]) => path)).not.toContain(allPath);
    },
  );

  it("sends the same visibility PATCH from both layouts without opening the profile", async () => {
    const navigation = mount("company_admin", "/customers?view=all");
    await screen.findByRole("columnheader", { name: "Show in Billing" });
    const [mobileSwitch, tableSwitch] = billingSwitch("Cedar Gardens");
    expect(mobileSwitch).toBeChecked();
    fireEvent.click(mobileSwitch);
    await waitFor(() => expect(tableSwitch).not.toBeChecked());
    expect(billableTab()).toHaveTextContent("Billable customers (1)");
    expect(allTab()).toHaveTextContent("All customers (3)");
    fireEvent.click(tableSwitch);
    await waitFor(() => expect(mobileSwitch).toBeChecked());
    expect(billableTab()).toHaveTextContent("Billable customers (2)");
    expect(navigation.history).toEqual(["/customers?view=all"]);
    expect(fetchSpy.mock.calls.filter(([, options]) => options?.method === "PATCH")
      .map(([path, options]) => [path, JSON.parse(String(options?.body))]))
      .toEqual([
        ["/api/customers/10", { hiddenFromBilling: true }],
        ["/api/customers/10", { hiddenFromBilling: false }],
      ]);
  });

  it("replaces the legacy bookmark with the All view through the company admin router", async () => {
    const navigation = mount("company_admin", "/admin/customers", true);
    expect(await screen.findByTestId("card-customer-12")).toBeInTheDocument();
    expect(navigation.history).toEqual(["/customers?view=all"]);
    expect(allTab()).toHaveAttribute("aria-selected", "true");
  });
});

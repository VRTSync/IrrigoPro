import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QB_OWNED_CUSTOMER_FIELDS } from "@workspace/shared";
import type { Customer } from "@workspace/db/schema";

const state = vi.hoisted(() => ({ locked: true, apiRequest: vi.fn() }));
vi.mock("@/hooks/use-customer-records-lock", () => ({
  useCustomerRecordsLock: () => ({
    locked: state.locked, isLoading: false, label: "High Plains CRM",
    canCreateCustomers: !state.locked,
  }),
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest: state.apiRequest }));
import { CustomerForm } from "./customer-form";

const proto = Element.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

const customer = {
  id: 42, companyId: 5, name: "Official Co", irrigoName: "Display Co",
  email: "office@example.invalid", phone: "555-1234", address: "Old address",
  street: "123 Main St", city: "Springfield", state: "IL", zip: "62704", country: "USA",
  laborRate: "45.00",
} as Customer;

function mount(edit = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => String(queryKey[0]).includes("budget-months") ? { months: [] } : [],
      },
      mutations: { retry: false },
    },
  });
  render(<QueryClientProvider client={client}><CustomerForm defaultOpen customer={edit ? customer : undefined} trigger={<button>open</button>} /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  state.locked = true;
  state.apiRequest.mockReset().mockResolvedValue(customer);
  localStorage.setItem("user", JSON.stringify({ id: 7, companyId: 5, role: "company_admin" }));
});

describe("customer records locked form", () => {
  it("disables owned inputs while keeping Display Name and Labor Rate editable", () => {
    mount();
    expect(screen.getByTestId("customer-details-locked-note")).toHaveTextContent("Customer details are managed in High Plains CRM. Edit them there. They update here on the next QuickBooks sync.");
    for (const field of QB_OWNED_CUSTOMER_FIELDS.filter((field) => field !== "address")) {
      expect(document.querySelector(`input[name="${field}"]`)).toBeDisabled();
    }
    expect(document.querySelector('input[name="irrigoName"]')).toBeEnabled();
    expect(document.querySelector('input[name="laborRate"]')).toBeEnabled();
  });

  it("successfully saves a labor rate without any owned key or synthesized address", async () => {
    mount();
    const input = document.querySelector<HTMLInputElement>('input[name="laborRate"]')!;
    fireEvent.change(input, { target: { value: "52.00" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith("/api/customers/42", "PUT", expect.objectContaining({ laborRate: "52.00" })));
    const payload = state.apiRequest.mock.calls.find(([url, method]) => url === "/api/customers/42" && method === "PUT")![2];
    for (const field of QB_OWNED_CUSTOMER_FIELDS) expect(payload).not.toHaveProperty(field);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByLabelText("Official Customer Name")).toHaveValue(customer.name);
    expect(screen.getByLabelText("Email Address")).toHaveValue(customer.email);
    expect(document.querySelector('input[name="laborRate"]')).toHaveValue("52.00");
  });

  it("preserves the unlocked fields and full composed-address payload", async () => {
    state.locked = false;
    mount();
    expect(screen.queryByTestId("customer-details-locked-note")).not.toBeInTheDocument();
    for (const field of QB_OWNED_CUSTOMER_FIELDS.filter((field) => field !== "address")) {
      expect(document.querySelector(`input[name="${field}"]`)).toBeEnabled();
    }
    fireEvent.submit(screen.getByLabelText("Official Customer Name").closest("form")!);
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith("/api/customers/42", "PUT", expect.objectContaining({
      name: customer.name, email: customer.email, phone: customer.phone, street: customer.street,
      city: customer.city, state: customer.state, zip: customer.zip, country: customer.country,
      address: "123 Main St, Springfield, IL 62704, USA",
    })));
  });

  it("renders only the replacement body for locked creation", () => {
    mount(false);
    expect(screen.getByText("New customers are added in High Plains CRM.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Official Customer Name")).not.toBeInTheDocument();
    expect(document.querySelector('button[type="submit"]')).not.toBeInTheDocument();
  });
});

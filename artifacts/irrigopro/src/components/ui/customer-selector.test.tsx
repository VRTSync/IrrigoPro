import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Customer } from "@workspace/db/schema";

const state = vi.hoisted(() => ({
  role: "company_admin" as string | null,
  stubForm: false,
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: state.role ? { id: 7, companyId: 3, role: state.role } : null }),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: state.apiRequest,
  useArrayQuery: () => ({
    data: [
      { id: 1, name: "First Co", email: "first@example.invalid" },
      { id: 2, name: "Second Co", email: "second@example.invalid" },
    ],
    isLoading: false,
  }),
}));
// Only the wiring test substitutes a stub. The admin-opening test uses the
// actual CustomerForm (including its Radix Selects and structured fields).
vi.mock("@/components/customer-form", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/customer-form")>();
  return {
    ...actual,
    CustomerForm: (props: Parameters<typeof actual.CustomerForm>[0]) =>
      state.stubForm ? (
        <>
          {props.trigger}
          <button onClick={() => props.onSaved?.({ id: 99, name: "New Co" } as Customer)}>stub-save</button>
        </>
      ) : <actual.CustomerForm {...props} />,
  };
});

import { CustomerSelector } from "./customer-selector";
import { CustomerForm } from "@/components/customer-form";

// Reuse the existing Radix shim from invoices-batch-reminders.test.tsx.
const proto = HTMLElement.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => String(queryKey[0]).includes("budget-months")
          ? { months: [] }
          : [],
      },
      mutations: { retry: false },
    },
  });
  return { ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>), client };
}

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Search and select a customer..." }));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  state.role = "company_admin";
  state.stubForm = false;
  state.apiRequest.mockReset();
  localStorage.setItem("user", JSON.stringify({ id: 7, companyId: 3, role: "company_admin" }));
});

describe("one shared customer modal in the selector", () => {
  it("opens the real full Add New Customer form for company admins", async () => {
    mount(<CustomerSelector onSelectCustomer={vi.fn()} />);
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Create New Customer" }));
    expect(await screen.findByRole("dialog", { name: "Add New Customer" })).toBeInTheDocument();
    expect(screen.getByLabelText("Street")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toBeInTheDocument();
    expect(screen.getByText("Budget & Alerts")).toBeInTheDocument();
    expect(screen.getByText("Labor Rate (per hour)")).toBeInTheDocument();
    expect(document.querySelector('input[name="laborRate"]')).toBeInTheDocument();
  });

  it.each(["billing_manager", "super_admin", null])("does not offer creation for role %s", (role) => {
    state.role = role;
    mount(<CustomerSelector onSelectCustomer={vi.fn()} />);
    openPicker();
    expect(screen.queryByRole("button", { name: "Create New Customer" })).not.toBeInTheDocument();
    expect(screen.getByText("First Co")).toBeInTheDocument();
  });

  it("honors the company-admin caller opt-out", () => {
    mount(<CustomerSelector canCreateCustomer={false} onSelectCustomer={vi.fn()} />);
    openPicker();
    expect(screen.queryByRole("button", { name: "Create New Customer" })).not.toBeInTheDocument();
  });

  it("selects the saved response once, closes the picker and clears its search", () => {
    state.stubForm = true;
    const select = vi.fn();
    mount(<CustomerSelector onSelectCustomer={select} />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText("Search customers by name, email, or address..."), {
      target: { value: "nonmatching search" },
    });
    fireEvent.click(screen.getByRole("button", { name: "stub-save" }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({ id: 99, name: "New Co" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openPicker();
    expect(screen.getByPlaceholderText("Search customers by name, email, or address...")).toHaveValue("");
    expect(screen.getByText("Second Co")).toBeInTheDocument();
  });

  it.each([false, true])("passes the actual %s edit response after closing and invalidates caches", async (edit) => {
    const response = { id: edit ? 42 : 99, name: "Server Co", email: "server@example.invalid", companyId: 3 };
    state.apiRequest.mockResolvedValue(response);
    const close = vi.fn();
    const saved = vi.fn(() => expect(close).toHaveBeenLastCalledWith(false));
    const { client } = mount(
      <CustomerForm
        customer={edit ? { ...response, name: "Original Co" } as Customer : undefined}
        trigger={<button>open-form</button>}
        onOpenChange={close}
        onSaved={saved}
      />,
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "open-form" }));
    fireEvent.change(screen.getByLabelText("Official Customer Name"), { target: { value: "Typed Co" } });
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "typed@example.invalid" } });
    fireEvent.submit(screen.getByLabelText("Official Customer Name").closest("form")!);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved).toHaveBeenCalledWith(response);
    expect(state.apiRequest).toHaveBeenCalledWith(
      edit ? "/api/customers/42" : "/api/customers",
      edit ? "PUT" : "POST",
      expect.objectContaining({ name: "Typed Co" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/customers"] });
    if (edit) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/customers/42"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/customers/42/budget-usage"] });
    }
  });

  it("scrolls Budget & Alerts into view on open and cancels the pending frame on close", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 123);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const scroll = vi.spyOn(proto, "scrollIntoView");
    try {
      mount(<CustomerForm initialSection="budget-and-alerts" trigger={<button>open-budget</button>} />);
      fireEvent.click(screen.getByRole("button", { name: "open-budget" }));
      const callback = raf.mock.calls.at(-1)![0];
      callback(0);
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
      expect(scroll.mock.instances.at(-1)).toBe(document.getElementById("budget-and-alerts"));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(cancel).toHaveBeenCalledWith(123);
    } finally {
      raf.mockRestore();
      cancel.mockRestore();
      scroll.mockRestore();
    }
  });
});

describe("single-writer source guards", () => {
  const root = path.resolve(__dirname, "../..");
  const source = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("keeps selector creation delegated to CustomerForm", () => {
    const selector = source("components/ui/customer-selector.tsx");
    expect(selector).toContain("<CustomerForm");
    for (const retired of ["newCustomer" + "Schema", "showNewCustomer" + "Dialog", 'apiRequest("/api/customers", "POST"']) {
      expect(selector).not.toContain(retired);
    }
  });

  it("has no literal customer POST writer elsewhere in the web source", () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? files(file) : [file];
      });
    }
    const duplicate = /apiRequest\(\s*["'`]\/api\/customers["'`]\s*,\s*["']POST/;
    const matches = files(root)
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !/\.test\./.test(file))
      .filter((file) => duplicate.test(readFileSync(file, "utf8")));
    expect(matches).toEqual([]);
  });

  it("keeps profile editing in place and removes the obsolete list-page query handler", () => {
    const profile = source("pages/customer-profile.tsx");
    expect(profile).not.toContain("customers?" + "edit=");
    expect(profile).toContain('initialSection="budget-and-alerts"');
    expect(source("pages/customers.tsx")).not.toContain("editCustomerId");
  });
});

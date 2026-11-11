import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Part } from "@workspace/db/schema";
import { activeContext, installFetch, polyfillDom, renderWithClient, type Reply } from "@/test/markup-fetch-harness";

const state = vi.hoisted(() => ({ apiRequest: vi.fn(), role: "company_admin" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: 1, role: state.role, companyId: 5 } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: state.apiRequest,
  queryClient: { invalidateQueries: vi.fn() },
  useArrayQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "/api/part-settings/categories"
      ? [{ id: 1, name: "Sprinklers" }, { id: 2, name: "Rental" }]
      : [],
  }),
}));
import { PartFormDialog } from "./part-form-dialog";

const part = {
  id: 77, companyId: 5, name: "Rotor 5000", description: "", price: "10.00", cost: "180.00",
  sku: "HUN-5000", category: "Sprinklers", material: null, size: null, brand: null,
  fittingType: null, detail: null, isActive: true,
} as unknown as Part;

let activeReply: Reply;
function mount(p: Part = part) {
  const calls = installFetch((c) => (c.path === "/api/markup-schedules/active" ? activeReply : undefined));
  renderWithClient(<PartFormDialog part={p} open onOpenChange={() => {}} />);
  return calls;
}
const price = () => screen.getByTestId("input-part-price") as HTMLInputElement;
const status = () => screen.getByTestId("status-part-pricing");
const save = () => screen.getByTestId("button-save-part");

beforeEach(() => {
  polyfillDom();
  state.role = "company_admin";
  state.apiRequest.mockReset().mockResolvedValue({});
  activeReply = { status: 200, body: activeContext };
});

describe("part form tiered pricing", () => {
  it("shows a read-only shared-engine price that follows cost edits and saves it", async () => {
    mount();
    await waitFor(() => expect(price().value).toBe("288.25"));
    expect(price()).toHaveAttribute("readonly");
    expect(status()).toHaveTextContent("Standard 2026");
    expect(status()).toHaveTextContent("$108.25");
    expect(status()).toHaveTextContent("60.1% effective");
    fireEvent.change(screen.getByLabelText("Cost ($)"), { target: { value: "1.75" } });
    await waitFor(() => expect(price().value).toBe("4.38"));
    fireEvent.change(screen.getByLabelText("Cost ($)"), { target: { value: "1150" } });
    await waitFor(() => expect(price().value).toBe("1491.25"));
    fireEvent.click(save());
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledTimes(1));
    expect(state.apiRequest.mock.calls[0][0]).toBe("/api/parts/77");
    expect(state.apiRequest.mock.calls[0][2]).toMatchObject({ cost: 1150, price: 1491.25 });
  });

  it("switches to manual price when cost is blank or zero, preserving the blank cost", async () => {
    mount();
    await waitFor(() => expect(price().value).toBe("288.25"));
    fireEvent.change(screen.getByLabelText("Cost ($)"), { target: { value: "0" } });
    await waitFor(() => expect(status()).toHaveTextContent("Manual price. No positive cost recorded."));
    fireEvent.change(screen.getByLabelText("Cost ($)"), { target: { value: "" } });
    expect(price()).not.toHaveAttribute("readonly");
    fireEvent.change(price(), { target: { value: "42.50" } });
    fireEvent.click(save());
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledTimes(1));
    expect(state.apiRequest.mock.calls[0][2]).toMatchObject({ cost: null, price: 42.5 });
  });

  it("uses manual price for excluded categories", async () => {
    mount({ ...part, category: "Rental", price: "75.00" } as Part);
    await waitFor(() => expect(status()).toHaveTextContent("excluded from material markup"));
    expect(price()).not.toHaveAttribute("readonly");
    expect(price().value).toBe("75.00");
    expect(save()).toBeEnabled();
  });

  it("treats only a 404 as no active schedule (manual mode)", async () => {
    activeReply = { status: 404, body: { message: "No active markup schedule" } };
    mount();
    await waitFor(() => expect(status()).toHaveTextContent("Manual price. No active markup schedule."));
    expect(price().value).toBe("10.00");
    expect(price()).not.toHaveAttribute("readonly");
    expect(save()).toBeEnabled();
  });

  it("blocks saving on other schedule errors until a retry succeeds", async () => {
    activeReply = { status: 500, body: { message: "database unavailable" } };
    mount();
    await waitFor(() => expect(status()).toHaveTextContent("database unavailable"));
    expect(save()).toBeDisabled();
    fireEvent.submit(save().closest("form")!);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.apiRequest).not.toHaveBeenCalled();
    activeReply = { status: 200, body: activeContext };
    fireEvent.click(screen.getByTestId("button-retry-pricing"));
    await waitFor(() => expect(price().value).toBe("288.25"));
    expect(save()).toBeEnabled();
  });

  it("scopes the schedule read to the part's company for super admins", async () => {
    state.role = "super_admin";
    const calls = mount({ ...part, companyId: 9 } as Part);
    await waitFor(() => expect(price().value).toBe("288.25"));
    expect(calls[0].search).toBe("?companyId=9");
  });
});

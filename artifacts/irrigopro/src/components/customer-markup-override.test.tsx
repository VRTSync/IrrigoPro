import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { activeSchedule, installFetch, oldSchedule, polyfillDom, renderWithClient, type Call, type Reply } from "@/test/markup-fetch-harness";

const auth = vi.hoisted(() => ({ role: "billing_manager" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { CustomerMarkupOverride } from "./customer-markup-override";

let override: { scheduleId: number } | null;
let putReply: Reply;
function mount() {
  const calls = installFetch((c) => {
    if (c.path === "/api/markup-schedules/options") return { status: 200, body: [activeSchedule, oldSchedule] };
    if (c.path !== "/api/customers/42/markup-override") return undefined;
    if (c.method === "GET") return { status: 200, body: { override: override && { id: 1, companyId: 5, customerId: 42, ...override } } };
    if (c.method === "PUT") { override = c.body as { scheduleId: number }; return putReply; }
    if (c.method === "DELETE") { override = null; return { status: 200, body: { ok: true } }; }
    return undefined;
  });
  renderWithClient(<CustomerMarkupOverride customerId={42} companyId={5} role={auth.role} />);
  return calls;
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");
async function choose(name: string) {
  await userEvent.click(await screen.findByTestId("select-customer-markup"));
  await userEvent.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  polyfillDom();
  auth.role = "billing_manager";
  override = null;
  putReply = { status: 200, body: { override: { id: 1, companyId: 5, customerId: 42, scheduleId: 7 } } };
});

describe("customer Pricing override", () => {
  it("creates, changes and removes an override through the real endpoints", async () => {
    const calls = mount();
    expect(await screen.findByTestId("select-customer-markup")).toHaveTextContent("Company Default");
    expect(screen.getByTestId("button-save-customer-markup")).toBeDisabled();

    await choose("Standard 2025");
    await userEvent.click(screen.getByTestId("button-save-customer-markup"));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "PUT", body: { scheduleId: 7 } });
    await waitFor(() => expect(screen.getByTestId("button-save-customer-markup")).toBeDisabled());

    await choose("Standard 2026 (active default)");
    await userEvent.click(screen.getByTestId("button-save-customer-markup"));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({ method: "PUT", body: { scheduleId: 11 } });

    await waitFor(() => expect(screen.getByTestId("select-customer-markup")).toHaveTextContent("Standard 2026"));
    await choose("Company Default");
    await userEvent.click(screen.getByTestId("button-save-customer-markup"));
    await waitFor(() => expect(writes(calls)).toHaveLength(3));
    expect(writes(calls)[2]).toMatchObject({ method: "DELETE", path: "/api/customers/42/markup-override" });
    await waitFor(() => expect(screen.getByTestId("select-customer-markup")).toHaveTextContent("Company Default"));
  });

  it("keeps the selection unsaved when the server rejects it", async () => {
    putReply = { status: 404, body: { message: "Schedule not found" } };
    const calls = mount();
    await choose("Standard 2025");
    await userEvent.click(screen.getByTestId("button-save-customer-markup"));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("button-save-customer-markup")).toBeEnabled());
  });

  it("shows a retryable error when options fail to load", async () => {
    installFetch((c) => (c.path.endsWith("/options") ? { status: 500, body: { message: "boom" } } : { status: 200, body: { override: null } }));
    renderWithClient(<CustomerMarkupOverride customerId={42} companyId={5} role={auth.role} />);
    expect(await screen.findByTestId("status-pricing-error")).toHaveTextContent("boom");
  });

  it("renders nothing and makes no requests for roles without assignment capability", () => {
    auth.role = "irrigation_manager";
    const calls = mount();
    expect(screen.queryByTestId("card-customer-pricing")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("customer form placement", () => {
  it("renders the Pricing section when editing a customer as a billing manager", async () => {
    const { CustomerForm } = await import("./customer-form");
    localStorage.setItem("user", JSON.stringify({ id: 1, companyId: 5, role: "billing_manager" }));
    const placementCalls = installFetch((c) => c.path.endsWith("/options") ? { status: 200, body: [oldSchedule] }
      : c.path.endsWith("/markup-override") ? { status: 200, body: { override: { id: 1, companyId: 5, customerId: 42, scheduleId: 7 } } } : { status: 200, body: [] });
    renderWithClient(
      <CustomerForm defaultOpen customer={{ id: 42, companyId: 5, name: "Woodglenn HOA", branches: [] } as never} trigger={<button>open</button>} />,
      (key) => (String(key[0]).includes("budget-months") ? { months: [] } : []),
    );
    expect(await screen.findByTestId("card-customer-pricing")).toBeInTheDocument();
    expect(placementCalls.every((c) => c.method === "GET")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("card-customer-pricing").querySelector("select")?.value).toBe("7"));
  });
});

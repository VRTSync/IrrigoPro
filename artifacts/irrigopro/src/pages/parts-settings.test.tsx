import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installFetch, polyfillDom, renderWithClient } from "@/test/markup-fetch-harness";

const auth = vi.hoisted(() => ({ role: "company_admin" as string }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: 1, role: auth.role, companyId: 5 } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import PartsSettings from "./parts-settings";
import { QuickAddPopover } from "@/components/parts/part-form-dialog";

const cats = [{ id: 1, name: "Fittings", companyId: 5, markupPercent: "35.00" }];
const queryFn = (key: readonly unknown[]) => (key[0] === "/api/part-settings/categories" ? cats : []);

beforeEach(() => { polyfillDom(); auth.role = "company_admin"; });

describe("category markup retirement", () => {
  it("shows the banner with a link for managers and never shows or sends markup", async () => {
    const calls = installFetch((c) => (c.method === "PATCH" ? { status: 200, body: {} } : undefined));
    renderWithClient(<PartsSettings />, queryFn);
    const banner = screen.getByTestId("banner-markup-retired");
    expect(banner).toHaveTextContent("Material markup is managed through the Tiered Markup Schedule");
    expect(within(banner).getByTestId("link-markup-schedule")).toHaveAttribute("href", "/admin/markup-schedule");
    await screen.findByText("Fittings");
    expect(screen.queryByText(/Markup %/)).toBeNull();
    expect(screen.queryByText("35.00%")).toBeNull();
    fireEvent.click(screen.getAllByRole("button").find((b) => b.querySelector(".lucide-pen-line, .lucide-edit, .lucide-square-pen"))!);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    fireEvent.keyDown(screen.getByDisplayValue("Fittings"), { key: "Enter" });
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Fittings" }));
  });

  it("omits the link for roles without the capability", () => {
    auth.role = "billing_manager";
    installFetch(() => undefined);
    renderWithClient(<PartsSettings />, queryFn);
    expect(screen.getByTestId("banner-markup-retired")).toBeInTheDocument();
    expect(screen.queryByTestId("link-markup-schedule")).toBeNull();
  });

  it("quick-add category has no markup input and posts only the name", async () => {
    const calls = installFetch(() => ({ status: 201, body: { id: 2, name: "Valves" } }));
    renderWithClient(<QuickAddPopover label="Category" apiPath="/api/part-settings/categories" queryKey="/api/part-settings/categories" onAdded={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Valves" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls[0]?.body).toEqual({ name: "Valves" }));
  });
});

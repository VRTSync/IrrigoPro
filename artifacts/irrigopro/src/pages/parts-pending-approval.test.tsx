import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { computeCustomerPrice, markupScheduleParams } from "@workspace/shared";
import type { Part } from "@workspace/db/schema";
import { activeContext, installFetch, polyfillDom, renderWithClient, type Route } from "@/test/markup-fetch-harness";

const auth = vi.hoisted(() => ({ role: "company_admin" as string }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: { id: 1, role: auth.role, companyId: 5 } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { PendingPartRow } from "./parts-pending-approval";

const part = (over: Partial<Part> = {}) =>
  ({ id: 3, companyId: 9, name: "PVC Elbow", sku: "PE-1", category: "Fittings", cost: "180.00", price: "12.00", ...over }) as unknown as Part;

function mount(p: Part, route: Route) {
  const calls = installFetch(route);
  const onApprove = vi.fn();
  renderWithClient(<table><tbody><PendingPartRow part={p} onApprove={onApprove} isApproving={false} /></tbody></table>);
  return { calls, onApprove };
}
const ok: Route = () => ({ status: 200, body: activeContext });

beforeEach(() => { polyfillDom(); auth.role = "company_admin"; });

describe("PendingPartRow pricing", () => {
  it("shows the shared-engine price read-only and follows cost edits", async () => {
    const { onApprove } = mount(part(), ok);
    const price = screen.getByTestId("input-pending-price-3");
    await waitFor(() => expect(price).toHaveValue(computeCustomerPrice(180, markupScheduleParams(activeContext))));
    expect(price).toHaveAttribute("readonly");
    fireEvent.change(screen.getByTestId("input-pending-cost-3"), { target: { value: "42.5" } });
    const expected = computeCustomerPrice(42.5, markupScheduleParams(activeContext)).toFixed(2);
    expect(price).toHaveValue(Number(expected));
    fireEvent.click(screen.getByTestId("button-approve-part-3"));
    expect(onApprove).toHaveBeenCalledWith(3, expected, "42.5");
  });
  it("uses a custom schedule minimum in the read-only approval preview", async () => {
    const { onApprove } = mount(part({ cost: ".25" }), () => ({ status: 200, body: {
      ...activeContext, schedule: { ...activeContext.schedule, minimumMarkupDollars: "4.50" },
    } }));
    await waitFor(() => expect(screen.getByTestId("input-pending-price-3")).toHaveValue(4.75));
    fireEvent.click(screen.getByTestId("button-approve-part-3"));
    expect(onApprove).toHaveBeenCalledWith(3, "4.75", ".25");
  });

  it("scopes the schedule read to the part's company for super admins", async () => {
    auth.role = "super_admin";
    const { calls } = mount(part(), ok);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].search).toBe("?companyId=9");
  });

  it("uses a manual price for excluded categories", async () => {
    const { onApprove } = mount(part({ category: "Rental" }), ok);
    expect(screen.getByTestId("status-pending-pricing-3")).toHaveTextContent("Excluded category");
    fireEvent.change(screen.getByTestId("input-pending-price-3"), { target: { value: "75" } });
    fireEvent.click(screen.getByTestId("button-approve-part-3"));
    expect(onApprove).toHaveBeenCalledWith(3, "75", "180.00");
  });

  it("preserves a cleared cost as null with a manual price", async () => {
    const { onApprove } = mount(part(), ok);
    fireEvent.change(screen.getByTestId("input-pending-cost-3"), { target: { value: "" } });
    expect(screen.getByTestId("status-pending-pricing-3")).toHaveTextContent("No positive cost");
    expect(screen.getByTestId("input-pending-price-3")).not.toHaveAttribute("readonly");
    fireEvent.click(screen.getByTestId("button-approve-part-3"));
    expect(onApprove).toHaveBeenCalledWith(3, "12.00", null);
  });

  it("allows manual pricing when no schedule is active (404)", async () => {
    mount(part(), () => ({ status: 404, body: { message: "No active markup schedule" } }));
    expect(await screen.findByText(/No active markup schedule: manual price/)).toBeInTheDocument();
    expect(screen.getByTestId("button-approve-part-3")).toBeEnabled();
  });

  it("blocks approval on other errors and retries", async () => {
    let fail = true;
    mount(part(), () => (fail ? { status: 500, body: { message: "database unavailable" } } : { status: 200, body: activeContext }));
    expect(await screen.findByText(/database unavailable/)).toBeInTheDocument();
    expect(screen.getByTestId("button-approve-part-3")).toBeDisabled();
    fail = false;
    fireEvent.click(screen.getByTestId("button-retry-pending-pricing-3"));
    await waitFor(() => expect(screen.getByTestId("button-approve-part-3")).toBeEnabled());
    expect(screen.getByTestId("input-pending-price-3")).toHaveAttribute("readonly");
  });
});

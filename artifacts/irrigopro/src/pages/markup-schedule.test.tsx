import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  activeContext, activeSchedule, installFetch, oldSchedule, polyfillDom, renderWithClient, type Call, type Route,
} from "@/test/markup-fetch-harness";

const auth = vi.hoisted(() => ({ role: "company_admin" as string }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, role: auth.role, companyId: auth.role === "super_admin" ? null : 5 } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import MarkupSchedulePage from "./markup-schedule";

let active: Route;
const baseRoute = (extra?: Route): Route => (c) =>
  extra?.(c) ??
  (c.method === "GET" && c.path === "/api/markup-schedules/active" ? active(c) : undefined) ??
  (c.method === "GET" && c.path === "/api/markup-schedules" ? { status: 200, body: [activeSchedule, oldSchedule] } : undefined) ??
  (c.method === "GET" && c.path === "/api/markup-schedules/7" ? { status: 200, body: { schedule: oldSchedule, tiers: activeContext.tiers } } : undefined);

const mount = () => renderWithClient(<MarkupSchedulePage />, () => [{ id: 5, name: "Woodglenn Irrigation" }, { id: 9, name: "Other Co" }]);
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

beforeEach(() => {
  polyfillDom();
  auth.role = "company_admin";
  active = () => ({ status: 200, body: activeContext });
});

describe("Material Markup page", () => {
  it("shows the current schedule, effective date and shared-engine examples", async () => {
    installFetch(baseRoute());
    mount();
    expect(await screen.findByTestId("card-active-schedule")).toBeInTheDocument();
    expect(screen.getByTestId("text-effective-date")).toHaveTextContent("Effective Jan 1, 2026");
    expect(screen.getByTestId("input-active-name")).toHaveValue("Standard 2026");
    expect(screen.getByTestId("example-active-180")).toHaveTextContent("$252.00");
    expect(screen.getByTestId("example-active-180")).toHaveTextContent("+$72.00");
    expect(screen.getByTestId("example-active-1.75")).toHaveTextContent("$4.38");
    expect(screen.getByTestId("example-active-1150")).toHaveTextContent("$1,380.00");
    expect(screen.getByTestId("input-minimum-active")).toHaveValue(2);
    expect(screen.getByTestId("example-active-180")).toHaveTextContent("Never-less check: $165.00");
    expect(await screen.findByTestId("row-schedule-7")).toHaveTextContent("Inactive");
  });
  it("validates and saves an edited minimum with live calculation checks", async () => {
    const calls = installFetch(baseRoute((c) => c.method === "PUT" ? { status: 200, body: activeSchedule } : undefined));
    mount();
    const input = await screen.findByTestId("input-minimum-active");
    const save = screen.getByTestId("button-save-schedule");
    for (const value of ["", "-1", "0.001"]) {
      fireEvent.change(input, { target: { value } });
      expect(save).toBeDisabled();
      expect(screen.getByTestId("text-tier-error-active")).toBeInTheDocument();
    }
    fireEvent.change(input, { target: { value: "5.50" } });
    expect(save).toBeEnabled();
    expect(screen.getByTestId("example-active-1.75")).toHaveTextContent("$7.25");
    expect(screen.getByTestId("example-active-1.75")).toHaveTextContent("Flat-tier: $4.38");
    expect(screen.getByTestId("example-active-1.75")).toHaveTextContent("Minimum check: $7.25");
    fireEvent.click(save);
    await waitFor(() => expect(writes(calls)[0].body).toMatchObject({ minimumMarkupDollars: 5.5 }));
  });

  it("blocks invalid tiers and blank names, then saves a new version with edited name and rates", async () => {
    const calls = installFetch(baseRoute((c) => (c.method === "PUT" ? { status: 200, body: { ...activeSchedule, id: 12 } } : undefined)));
    mount();
    await screen.findByTestId("card-active-schedule");
    const save = screen.getByTestId("button-save-schedule");

    fireEvent.change(screen.getByTestId("input-tier-max-active-2"), { target: { value: "4.00" } });
    expect(screen.getByTestId("text-tier-error-active")).toHaveTextContent(/Upper bound/);
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-tier-max-active-2"), { target: { value: "25.00" } });
    expect(screen.queryByTestId("text-tier-error-active")).toBeNull();

    fireEvent.change(screen.getByTestId("input-tier-percent-active-1"), { target: { value: "-1" } });
    expect(screen.getByTestId("text-tier-error-active")).toHaveTextContent(/Markup must be/);
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-tier-percent-active-1"), { target: { value: "120" } });

    fireEvent.change(screen.getByTestId("input-active-name"), { target: { value: "  " } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-active-name"), { target: { value: "Standard 2026 rev" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const put = writes(calls)[0];
    expect(put.path).toBe("/api/markup-schedules/11");
    expect(put.search).toBe("");
    const body = put.body as { name: string; tiers: { tierOrder: number; minCost: number; maxCost: number | null; markupPercent: number }[] };
    expect(body.name).toBe("Standard 2026 rev");
    expect(body.tiers).toHaveLength(6);
    expect(body.tiers[0]).toEqual({ tierOrder: 1, minCost: 0.01, maxCost: 5, markupPercent: 120 });
    expect(body.tiers[5]).toEqual({ tierOrder: 6, minCost: 500.01, maxCost: null, markupPercent: 20 });
    expect(calls.some((c) => c.path.includes("recalc"))).toBe(false);
  });

  it("adds and removes the last tier with valid contiguous bounds", async () => {
    const calls = installFetch(baseRoute((c) => (c.method === "PUT" ? { status: 200, body: activeSchedule } : undefined)));
    mount();
    await screen.findByTestId("card-active-schedule");
    fireEvent.click(screen.getByTestId("button-add-tier-active"));
    expect(screen.getByTestId("row-tier-active-7")).toHaveTextContent("and above");
    expect(screen.getByTestId("input-tier-max-active-6")).toHaveValue(1000.02);
    expect(screen.queryByTestId("text-tier-error-active")).toBeNull();
    fireEvent.click(screen.getByTestId("button-remove-tier-active"));
    fireEvent.click(screen.getByTestId("button-remove-tier-active"));
    expect(screen.queryByTestId("row-tier-active-6")).toBeNull();
    expect(screen.getByTestId("row-tier-active-5")).toHaveTextContent("and above");
    fireEvent.click(screen.getByTestId("button-save-schedule"));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const tiers = (writes(calls)[0].body as { tiers: unknown[] }).tiers;
    expect(tiers).toHaveLength(5);
    expect(tiers[4]).toMatchObject({ minCost: 250.01, maxCost: null, markupPercent: 30 });
  });

  it("creates a schedule inactive without activating it", async () => {
    const calls = installFetch(baseRoute((c) => (c.method === "POST" && c.path === "/api/markup-schedules"
      ? { status: 201, body: { ...oldSchedule, id: 20, name: "Contract" } } : undefined)));
    mount();
    await screen.findByTestId("card-active-schedule");
    fireEvent.click(screen.getByTestId("button-new-schedule"));
    const create = await screen.findByTestId("button-create-schedule");
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-new-name"), { target: { value: "Contract" } });
    fireEvent.change(screen.getByTestId("input-new-date"), { target: { value: "2026-03-01" } });
    expect(screen.getByTestId("input-minimum-new")).toHaveValue(2);
    fireEvent.change(screen.getByTestId("input-minimum-new"), { target: { value: "3.75" } });
    fireEvent.change(screen.getByTestId("input-tier-percent-new-6"), { target: { value: "" } });
    expect(screen.getByTestId("text-tier-error-new")).toHaveTextContent(/Tier 6/);
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-tier-percent-new-6"), { target: { value: "15" } });
    expect(screen.getByTestId("example-new-1150")).toBeInTheDocument();
    fireEvent.click(create);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/markup-schedules" });
    expect(writes(calls)[0].body).toMatchObject({ name: "Contract", effectiveDate: "2026-03-01", minimumMarkupDollars: 3.75 });
    expect(calls.some((c) => c.path.endsWith("/activate"))).toBe(false);
  });

  it("explains a 404 as no active schedule and reactivates from history", async () => {
    active = () => ({ status: 404, body: { message: "No active markup schedule" } });
    const calls = installFetch(baseRoute((c) => (c.method === "POST" && c.path.endsWith("/activate") ? { status: 200, body: { ok: true } } : undefined)));
    mount();
    expect(await screen.findByTestId("status-no-active-schedule")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("button-activate-schedule-7"));
    await waitFor(() => expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/markup-schedules/7/activate" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/markup-schedules/active").length).toBeGreaterThan(1));
  });

  it("shows read-only history details and deactivates the current schedule", async () => {
    const calls = installFetch(baseRoute((c) => (c.path.endsWith("/deactivate") ? { status: 200, body: { ok: true } } : undefined)));
    mount();
    fireEvent.click(await screen.findByTestId("button-view-schedule-7"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByTestId("table-tiers-detail-7");
    expect(within(dialog).queryAllByRole("spinbutton")).toHaveLength(0);
    expect(within(dialog).getByTestId("minimum-detail-7")).toHaveTextContent("$2.00");
    expect(within(dialog).getByTestId("example-detail-7-180")).toHaveTextContent("$252.00");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByTestId("button-deactivate-schedule"));
    await waitFor(() => expect(writes(calls)[0]).toMatchObject({ path: "/api/markup-schedules/11/deactivate" }));
  });

  it("does not treat non-404 failures as manual mode and offers retry", async () => {
    active = () => ({ status: 500, body: { message: "database unavailable" } });
    installFetch(baseRoute());
    mount();
    expect(await screen.findByTestId("status-active-error")).toHaveTextContent("database unavailable");
    expect(screen.queryByTestId("status-no-active-schedule")).toBeNull();
    active = () => ({ status: 200, body: activeContext });
    fireEvent.click(screen.getByTestId("button-retry-active"));
    expect(await screen.findByTestId("card-active-schedule")).toBeInTheDocument();
  });

  it("requires an explicit company for super admins and scopes every request", async () => {
    auth.role = "super_admin";
    const calls = installFetch(baseRoute((c) => {
      if (c.method === "GET") return undefined;
      if (c.path.endsWith("/preview")) return { status: 200, body: { confirmationToken: "t", eligible: 2, excluded: 0, scheduleId: 11, scheduleName: "Standard 2026", expiresAt: "2026-01-01T00:00:00Z" } };
      if (c.path.endsWith("/recalculate-prices")) return { status: 200, body: { processed: 2, total: 2, updated: 1, unchanged: 1, excluded: 0, errors: [], done: true } };
      if (c.method === "POST" && c.path === "/api/markup-schedules") return { status: 201, body: { schedule: { ...oldSchedule, id: 12 }, tiers: activeContext.tiers } };
      return { status: 200, body: activeContext };
    }));
    mount();
    expect(screen.getByTestId("status-select-company")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByTestId("select-markup-company"));
    await userEvent.click(await screen.findByRole("option", { name: "Other Co" }));
    await screen.findByTestId("card-active-schedule");
    expect(calls.length).toBeGreaterThan(0);
    const activeReads = calls.filter((c) => c.path === "/api/markup-schedules/active");
    expect(activeReads.length).toBeGreaterThan(0);

    // Exercise every generated markup operation from the page.
    fireEvent.click(await screen.findByTestId("button-view-schedule-7"));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByTestId("table-tiers-detail-7");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByTestId("button-save-schedule"));
    fireEvent.click(screen.getByTestId("button-activate-schedule-7"));
    fireEvent.click(screen.getByTestId("button-deactivate-schedule"));
    fireEvent.click(screen.getByTestId("button-new-schedule"));
    fireEvent.change(await screen.findByTestId("input-new-name"), { target: { value: "Scoped" } });
    fireEvent.click(screen.getByTestId("button-create-schedule"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByTestId("button-recalculate-prices"));
    fireEvent.click(await screen.findByTestId("button-recalc-confirm"));
    await screen.findByTestId("panel-recalc-result");

    const markupCalls = calls.filter((c) => c.path.startsWith("/api/markup-schedules"));
    const ops = new Set(markupCalls.map((c) => `${c.method} ${c.path}`));
    for (const op of [
      "GET /api/markup-schedules/active", "GET /api/markup-schedules", "GET /api/markup-schedules/7",
      "PUT /api/markup-schedules/11", "POST /api/markup-schedules/7/activate", "POST /api/markup-schedules/11/deactivate",
      "POST /api/markup-schedules", "POST /api/markup-schedules/recalculate-prices/preview", "POST /api/markup-schedules/recalculate-prices",
    ]) expect(ops).toContain(op);
    expect(markupCalls.filter((c) => !c.search.includes("companyId=9"))).toEqual([]);
  });

  it("refuses roles without the manage capability", () => {
    auth.role = "billing_manager";
    const calls = installFetch(baseRoute());
    mount();
    expect(screen.getByTestId("status-markup-forbidden")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

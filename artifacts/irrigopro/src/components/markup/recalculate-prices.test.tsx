import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { installFetch, polyfillDom, renderWithClient, type Call, type Reply } from "@/test/markup-fetch-harness";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
import { RecalculatePrices, recalculationConfirmText } from "./recalculate-prices";

const preview = { confirmationToken: "tok-1", eligible: 230, excluded: 4, scheduleId: 11, scheduleName: "Standard 2026", expiresAt: "2026-01-01T01:00:00Z" };
const batch = (processed: number, updated: number, extra: Partial<Record<string, unknown>> = {}) =>
  ({ processed, total: 230, updated, unchanged: processed - updated, excluded: 4, errors: [], done: processed === 230, ...extra });

let batches: Reply[];
function mount(hasActiveSchedule = true, params?: { companyId: number }) {
  const calls = installFetch((c) => {
    if (c.path.endsWith("/preview")) return { status: 200, body: preview };
    if (c.method === "POST" && c.path.includes("recalculat")) return batches.shift();
    return undefined;
  });
  const utils = renderWithClient(<RecalculatePrices params={params} hasActiveSchedule={hasActiveSchedule} />);
  return { calls, ...utils };
}
const runs = (calls: Call[]) => calls.filter((c) => (c.body as { confirmationToken?: string } | undefined)?.confirmationToken);

beforeEach(() => {
  polyfillDom();
  toast.mockReset();
  batches = [];
});

describe("Recalculate All Catalog Prices", () => {
  it("is disabled without an active schedule", () => {
    const { calls } = mount(false);
    expect(screen.getByTestId("button-recalculate-prices")).toBeDisabled();
    expect(calls).toHaveLength(0);
  });

  it("shows the exact confirmation with the previewed count and cancelling writes nothing", async () => {
    const { calls } = mount();
    fireEvent.click(screen.getByTestId("button-recalculate-prices"));
    expect(await screen.findByTestId("text-recalc-confirm")).toHaveTextContent(
      "This will update the customer price for all 230 parts with a recorded cost, using the current markup schedule. Rentals, Services, and Labor parts are excluded. Existing billing documents are not affected. Continue?",
    );
    expect(recalculationConfirmText(3)).toContain("all 3 parts");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBeUndefined();
    fireEvent.click(screen.getByTestId("button-recalc-cancel"));
    await waitFor(() => expect(screen.queryByTestId("text-recalc-confirm")).toBeNull());
    expect(runs(calls)).toHaveLength(0);
  });

  it("runs batches from the server's processed offset and shows real counts", async () => {
    batches = [{ status: 200, body: batch(100, 60) }, { status: 200, body: batch(200, 130) }, { status: 200, body: batch(230, 150, { errors: ["SKU X-1: price overflow"] }) }];
    const { calls, client } = mount(undefined, { companyId: 9 });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(screen.getByTestId("button-recalculate-prices"));
    fireEvent.click(await screen.findByTestId("button-recalc-confirm"));
    expect(await screen.findByTestId("panel-recalc-result")).toHaveTextContent("Recalculation complete: 230 of 230 processed");
    expect(runs(calls).map((c) => (c.body as { offset: number }).offset)).toEqual([0, 100, 200]);
    expect(runs(calls).every((c) => (c.body as { confirmationToken: string }).confirmationToken === "tok-1")).toBe(true);
    expect(calls.every((c) => c.search === "?companyId=9")).toBe(true);
    expect(screen.getByTestId("text-recalc-updated")).toHaveTextContent("150");
    expect(screen.getByTestId("text-recalc-unchanged")).toHaveTextContent("80");
    expect(screen.getByTestId("text-recalc-excluded")).toHaveTextContent("4");
    expect(screen.getByTestId("list-recalc-errors")).toHaveTextContent("SKU X-1: price overflow");
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Recalculation finished with errors", variant: "destructive",
      description: "Done — 150 prices updated, 80 unchanged, 4 excluded, 1 failed. Review errors below and preview again.",
    }));
  });

  it("shows in-flight progress from the last committed batch and disables the action", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith("/preview") ? preview : (n++ === 0 ? batch(100, 42) : (await gate, batch(230, 90)));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
    renderWithClient(<RecalculatePrices params={undefined} hasActiveSchedule />);
    fireEvent.click(screen.getByTestId("button-recalculate-prices"));
    fireEvent.click(await screen.findByTestId("button-recalc-confirm"));
    expect(await screen.findByTestId("status-recalc-progress")).toHaveTextContent("Recalculating... 42 parts updated (100 of 230 processed)");
    expect(screen.getByTestId("button-recalculate-prices")).toBeDisabled();
    release();
    expect(await screen.findByTestId("panel-recalc-result")).toHaveTextContent("Recalculation complete: 230 of 230");
  });

  it("stops on an error without silent retry and requires a new preview", async () => {
    batches = [{ status: 200, body: batch(100, 60) }, { status: 409, body: { message: "This batch is already processed or running. Preview again." } }];
    const { calls } = mount();
    fireEvent.click(screen.getByTestId("button-recalculate-prices"));
    fireEvent.click(await screen.findByTestId("button-recalc-confirm"));
    expect(await screen.findByTestId("text-recalc-error")).toHaveTextContent("Preview again");
    expect(runs(calls)).toHaveLength(2);
    expect(screen.getByTestId("panel-recalc-result")).toHaveTextContent("100 of 230");
    expect(screen.getByTestId("button-recalculate-prices")).toBeEnabled();
    fireEvent.click(screen.getByTestId("button-recalculate-prices"));
    await screen.findByTestId("text-recalc-confirm");
    expect(calls.filter((c) => c.path.endsWith("/preview"))).toHaveLength(2);
    expect(runs(calls)).toHaveLength(2);
  });
});

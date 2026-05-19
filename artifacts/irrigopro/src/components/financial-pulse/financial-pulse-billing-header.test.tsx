// Task #711 — Financial Pulse Slice 5.1: tests for the new
// `billing-header` variant + its mount on the Billing Dashboard.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/queryClient")>(
      "@/lib/queryClient",
    );
  return {
    ...actual,
    adaptiveRefetchInterval: () => false as const,
  };
});

import { FinancialPulseWidget } from "./financial-pulse-widget";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  });
}

function withClient(ui: React.ReactNode) {
  return <QueryClientProvider client={makeClient()}>{ui}</QueryClientProvider>;
}

const KPIS = {
  billedMtd: { value: 12000, deltaPct: 8.4 },
  billedYtd: { value: 200000, deltaPct: 0 },
  outstandingAr: { value: 4500, deltaPct: -3.2 },
  unbilledExposure: { value: 2200, deltaPct: 0 },
  projectedMonthEnd: { value: 17000, deltaPct: 0, method: "linear" },
};

describe("FinancialPulseWidget — billing-header variant (Task #711)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
  });
  afterEach(() => {
    fetchSpy.mockReset();
  });

  it("renders three tiles in order: Billed MTD, Collected MTD, Outstanding A/R, plus the FP link", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(KPIS), { status: 200 }),
    );

    render(withClient(<FinancialPulseWidget variant="billing-header" />));

    // Wait for the resolved currency text (skeleton state doesn't have $).
    await screen.findByText(/\$12,000/);

    // Tile order is Billed MTD → Collected MTD → Outstanding A/R.
    const container = screen.getByTestId("fp-widget-billing-header");
    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid^="fp-tile-billing-header-"]',
      ),
    ).filter((el) => !el.getAttribute("data-testid")!.endsWith("-delta"));
    expect(tiles.length).toBe(3);
    expect(tiles[0].getAttribute("data-testid")).toBe(
      "fp-tile-billing-header-billed-mtd",
    );
    expect(tiles[1].getAttribute("data-testid")).toBe(
      "fp-tile-billing-header-collected-mtd",
    );
    expect(tiles[2].getAttribute("data-testid")).toBe(
      "fp-tile-billing-header-outstanding-ar",
    );

    // Values render formatted as USD.
    expect(tiles[0].textContent).toMatch(/\$12,000/);
    // Collected MTD = billedMtd - outstandingAr = 7500.
    expect(tiles[1].textContent).toMatch(/\$7,500/);
    expect(tiles[2].textContent).toMatch(/\$4,500/);

    // Header link to /financial-pulse.
    const link = screen.getByTestId("fp-widget-billing-header-link");
    expect(link.textContent).toMatch(/View Financial Pulse/);
    // Wouter 3 wraps the child <a> with its own anchor — find the
    // nearest anchor (either the child or wouter's wrapper) carrying
    // an href.
    const anchor =
      link.closest("a[href]") ??
      link.querySelector("a[href]") ??
      link.parentElement?.closest("a[href]");
    expect(anchor?.getAttribute("href")).toBe("/financial-pulse");

    // Endpoint used: /api/financial-pulse/kpis?period=mtd.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/financial-pulse/kpis?period=mtd",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("shows a skeleton-loading state before data resolves", () => {
    fetchSpy.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    render(withClient(<FinancialPulseWidget variant="billing-header" />));

    // Strip itself mounted; tiles in skeleton mode.
    expect(screen.getByTestId("fp-widget-billing-header")).toBeInTheDocument();
    const tile = screen.getByTestId("fp-tile-billing-header-billed-mtd");
    // Skeleton renders an empty `div` with no formatted currency yet.
    expect(tile.textContent).not.toMatch(/\$/);
  });

  it("soft-fails to '—' tiles with a Retry button when the endpoint errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("boom", { status: 500 }),
    );

    render(withClient(<FinancialPulseWidget variant="billing-header" />));

    const retry = await screen.findByTestId(
      "fp-widget-billing-header-retry",
    );
    expect(retry).toBeInTheDocument();
    const errBlock = screen.getByTestId("fp-widget-billing-header-error");
    // All three tiles show "—".
    const dashes = errBlock.querySelectorAll("p.text-gray-300");
    expect(dashes.length).toBe(3);

    // Retry refires the fetch — second call returns OK.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(KPIS), { status: 200 }),
    );
    fireEvent.click(retry);
    await waitFor(() => {
      expect(
        screen.queryByTestId("fp-widget-billing-header-error"),
      ).not.toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("renders nothing (null) for roles that get a 403 from FP", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );

    const { container } = render(
      withClient(<FinancialPulseWidget variant="billing-header" />),
    );
    await waitFor(() => {
      // After the 403 resolves to null, the variant returns null.
      expect(
        container.querySelector(
          '[data-testid="fp-widget-billing-header"]',
        ),
      ).toBeNull();
    });
  });

  it("Outstanding A/R tile equals the admin-dashboard variant on the same fixture (cross-page parity)", async () => {
    // Both variants hit the same endpoint. We mock it once per render
    // and assert the rendered Outstanding A/R string matches.
    fetchSpy.mockImplementation(
      async () =>
        new Response(JSON.stringify(KPIS), { status: 200 }),
    );

    const { unmount } = render(
      withClient(<FinancialPulseWidget variant="billing-header" />),
    );
    await screen.findByText(/\$4,500/);
    const billingTile = screen.getByTestId(
      "fp-tile-billing-header-outstanding-ar",
    );
    expect(billingTile.textContent ?? "").toMatch(/\$4,500/);
    unmount();

    render(withClient(<FinancialPulseWidget variant="admin-dashboard" />));
    await screen.findByText(/\$4,500/);
    const adminTile = screen.getByTestId("fp-tile-outstanding-ar");
    expect(adminTile.textContent ?? "").toMatch(/\$4,500/);
  });

  it("smoke: the four pre-existing variants still render without throwing", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...KPIS,
          buckets: [
            { key: "current", label: "Current", amount: 0, count: 0 },
            { key: "days30", label: "30", amount: 0, count: 0 },
            { key: "days60", label: "60", amount: 0, count: 0 },
            { key: "days90", label: "90+", amount: 0, count: 0 },
          ],
          total: 0,
          rows: [],
          customerId: 1,
          name: "X",
          billedYtd: 0,
          outstandingAr: 0,
          unbilledExposure: 0,
          avgDaysToPay: null,
          lastInvoiceAt: null,
          monthly: { cap: null, spend: 0, percent: null, status: "unset" },
          annual: { cap: null, spend: 0, percent: null, status: "unset" },
        }),
        { status: 200 },
      ),
    );

    for (const variant of [
      "admin-dashboard",
      "ar-aging",
      "top-customers-compact",
    ] as const) {
      const { unmount } = render(
        withClient(<FinancialPulseWidget variant={variant} />),
      );
      unmount();
    }
    const { unmount } = render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={1} />,
      ),
    );
    unmount();
  });
});

describe("Task #711 — Billing Dashboard integration", () => {
  // Render the live BillingDashboard page with fetch mocked, then
  // assert that (a) the widget mounts, (b) the FP endpoint was hit
  // from page context, and (c) the rendered tile values match the
  // KPIS fixture.
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => fetchSpy.mockReset());
  afterEach(() => fetchSpy.mockReset());

  it("mounts the billing-header widget, calls /api/financial-pulse/kpis?period=mtd, and renders the tile values", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/financial-pulse/kpis")) {
        return new Response(JSON.stringify(KPIS), { status: 200 });
      }
      // Every other list endpoint the dashboard hits → empty list.
      return new Response("[]", { status: 200 });
    });

    const { default: BillingDashboard } = await import(
      "../../pages/billing-dashboard"
    );

    render(withClient(<BillingDashboard />));

    // Widget appears.
    await screen.findByTestId("fp-widget-billing-header");
    // And the FP endpoint was called from the page.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/financial-pulse/kpis?period=mtd",
      expect.objectContaining({ credentials: "include" }),
    );
    // Tile values render.
    await screen.findByText(/\$12,000/);
    const arTile = screen.getByTestId("fp-tile-billing-header-outstanding-ar");
    expect(arTile.textContent ?? "").toMatch(/\$4,500/);
    const collectedTile = screen.getByTestId(
      "fp-tile-billing-header-collected-mtd",
    );
    expect(collectedTile.textContent ?? "").toMatch(/\$7,500/);
  });
});

describe("Task #711 — static-source guards", () => {
  const WIDGET_SRC = fs.readFileSync(
    path.join(__dirname, "financial-pulse-widget.tsx"),
    "utf8",
  );
  const DASH_SRC = fs.readFileSync(
    path.join(__dirname, "..", "..", "pages", "billing-dashboard.tsx"),
    "utf8",
  );

  it("billing-header variant is declared in the Variant union", () => {
    expect(WIDGET_SRC).toMatch(/\|\s*"billing-header"/);
  });

  it("billing-header variant reuses /api/financial-pulse/kpis?period=mtd (no new endpoint)", () => {
    const start = WIDGET_SRC.indexOf("function BillingHeaderVariant");
    expect(start).toBeGreaterThan(-1);
    const next = WIDGET_SRC.indexOf("\nfunction ", start + 1);
    const body = WIDGET_SRC.slice(start, next === -1 ? undefined : next);
    expect(body).toContain("/api/financial-pulse/kpis?period=mtd");
  });

  it("billing-dashboard mounts the billing-header variant at the top", () => {
    expect(DASH_SRC).toMatch(
      /<FinancialPulseWidget\s+variant="billing-header"/,
    );
    // The widget must come before the "Financial Exposure" heading.
    const widgetIdx = DASH_SRC.indexOf('variant="billing-header"');
    const exposureIdx = DASH_SRC.indexOf("Financial Exposure");
    expect(widgetIdx).toBeGreaterThan(-1);
    // Anchor against the JSX header (not the comment block at the top
    // of the file), which is the actual rendered "Financial Exposure"
    // section heading.
    const exposureHeadingIdx = DASH_SRC.indexOf(
      "/> Financial Exposure",
    );
    expect(exposureHeadingIdx).toBeGreaterThan(widgetIdx);
    void exposureIdx;
  });
});

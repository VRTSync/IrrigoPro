// Task #1003 — Financial Pulse customer-detail: math + label audit and fix.
//
// Verifies:
//  (a) The customer-detail variant renders "Invoiced MTD" / "Invoiced YTD"
//      (NOT "Billed MTD" / "Billed YTD") — regression guard for the relabel.
//  (b) The billing-header variant still renders "Billed MTD" unchanged.
//  (c) All four customer-detail tiles carry infoTip icons.
//  (d) The widget renders the correct currency values from the API fixture.
//  (e) Static-source guard: CustomerDetailVariant does not contain the string
//      literal "Billed MTD" or "Billed YTD" anywhere in the source.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  return (
    <QueryClientProvider client={makeClient()}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
}

// Fixture matching the CustomerSummary shape returned by
// GET /api/financial-pulse/customer/:id/summary
const CUSTOMER_SUMMARY = {
  customerId: 42,
  name: "Prospect at Settlers Chase",
  billedMtd: 2075,
  billedYtd: 4853,
  outstandingAr: 0,
  unbilledExposure: 1200,
  avgDaysToPay: 14.5,
  lastInvoiceAt: "2026-05-20T10:00:00.000Z",
  monthly: { cap: null, spend: 2075, percent: null, status: "unset" },
  annual: { cap: null, spend: 4853, percent: null, status: "unset" },
};

const KPIS_FIXTURE = {
  billedMtd: { value: 12000, deltaPct: 8.4 },
  billedYtd: { value: 200000, deltaPct: 0 },
  outstandingAr: { value: 4500, deltaPct: -3.2 },
  unbilledExposure: { value: 2200, deltaPct: 0 },
  projectedMonthEnd: { value: 17000, deltaPct: 0, method: "linear" },
};

describe("Task #1003 — customer-detail variant labels (relabel regression guard)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => fetchSpy.mockReset());
  afterEach(() => fetchSpy.mockReset());

  it("renders 'Invoiced MTD' — NOT 'Billed MTD'", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$2,075/);
    expect(screen.queryByText("Billed MTD")).toBeNull();
    expect(screen.getByText("Invoiced MTD")).toBeInTheDocument();
  });

  it("renders 'Invoiced YTD' — NOT 'Billed YTD'", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$4,853/);
    expect(screen.queryByText("Billed YTD")).toBeNull();
    expect(screen.getByText("Invoiced YTD")).toBeInTheDocument();
  });

  it("still renders 'Money Owed' and 'Avg. Time to Get Paid' unchanged", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$2,075/);
    expect(screen.getByText("Money Owed")).toBeInTheDocument();
    expect(screen.getByText("Avg. Time to Get Paid")).toBeInTheDocument();
  });

  it("renders the correct currency values from the API fixture", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    // billedMtd → $2,075
    await screen.findByText(/\$2,075/);
    // billedYtd → $4,853
    expect(screen.getByText(/\$4,853/)).toBeInTheDocument();
    // outstandingAr → $0 (rendered as $0)
    const tile = screen.getByTestId("fp-tile-cust-outstanding-ar");
    expect(tile.textContent).toMatch(/\$0/);
    // avgDaysToPay → 14.5 days
    expect(screen.getByText(/14\.5 days/)).toBeInTheDocument();
  });

  it("hits the customer-specific endpoint, not the shared KPIs endpoint", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$2,075/);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/financial-pulse/customer/42/summary",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/financial-pulse/kpis"),
      expect.anything(),
    );
  });

  it("all four tiles carry an infoTip icon (aria-label='About this metric')", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$2,075/);
    const container = screen.getByTestId("fp-widget-customer-detail");
    const infoIcons = container.querySelectorAll(
      '[aria-label="About this metric"]',
    );
    // Four tiles → four infoTip icons
    expect(infoIcons.length).toBe(4);
  });

  it("Invoiced MTD tile carries a 'MTD' window badge", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$2,075/);
    const mtdBadge = screen.getByTestId("fp-tile-cust-billed-mtd-window-badge");
    expect(mtdBadge.textContent).toBe("MTD");
  });

  it("Invoiced YTD tile carries a 'YTD' window badge", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(CUSTOMER_SUMMARY), { status: 200 }),
    );
    render(
      withClient(
        <FinancialPulseWidget variant="customer-detail" customerId={42} />,
      ),
    );
    await screen.findByText(/\$4,853/);
    const ytdBadge = screen.getByTestId("fp-tile-cust-billed-ytd-window-badge");
    expect(ytdBadge.textContent).toBe("YTD");
  });
});

describe("Task #1003 — billing-header variant unaffected (cross-variant parity)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => fetchSpy.mockReset());
  afterEach(() => fetchSpy.mockReset());

  it("billing-header still renders 'Billed MTD' (unchanged by relabel)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(KPIS_FIXTURE), { status: 200 }),
    );
    render(withClient(<FinancialPulseWidget variant="billing-header" />));
    await screen.findByText(/\$12,000/);
    // The billing-header tile label must remain "Billed MTD"
    expect(screen.getByTestId("fp-tile-billing-header-billed-mtd").textContent)
      .toMatch(/Billed MTD/);
    // And must NOT show the customer-detail label
    expect(
      screen.queryByTestId("fp-tile-billing-header-billed-mtd")?.textContent,
    ).not.toMatch(/Invoiced MTD/);
  });
});

describe("Task #1003 — static-source guards", () => {
  const WIDGET_SRC = fs.readFileSync(
    path.join(__dirname, "financial-pulse-widget.tsx"),
    "utf8",
  );

  // Locate just the CustomerDetailVariant function body so we don't
  // accidentally match the comment block or the BILLING_HEADER_TIPS above it.
  const custStart = WIDGET_SRC.indexOf("function CustomerDetailVariant");
  const custEnd = WIDGET_SRC.indexOf("\nfunction ", custStart + 1);
  const CUST_BODY =
    custEnd === -1
      ? WIDGET_SRC.slice(custStart)
      : WIDGET_SRC.slice(custStart, custEnd);

  it("CustomerDetailVariant body does not contain the string 'Billed MTD'", () => {
    expect(CUST_BODY).not.toContain('"Billed MTD"');
  });

  it("CustomerDetailVariant body does not contain the string 'Billed YTD'", () => {
    expect(CUST_BODY).not.toContain('"Billed YTD"');
  });

  it("CustomerDetailVariant body contains 'Invoiced MTD'", () => {
    expect(CUST_BODY).toContain('"Invoiced MTD"');
  });

  it("CustomerDetailVariant body contains 'Invoiced YTD'", () => {
    expect(CUST_BODY).toContain('"Invoiced YTD"');
  });

  it("CUSTOMER_DETAIL_TIPS constant is defined in the source", () => {
    expect(WIDGET_SRC).toContain("CUSTOMER_DETAIL_TIPS");
  });

  it("billing-header variant body still contains 'Billed MTD' label", () => {
    const bhStart = WIDGET_SRC.indexOf("function BillingHeaderVariant");
    const bhEnd = WIDGET_SRC.indexOf("\nfunction ", bhStart + 1);
    const BH_BODY =
      bhEnd === -1 ? WIDGET_SRC.slice(bhStart) : WIDGET_SRC.slice(bhStart, bhEnd);
    expect(BH_BODY).toContain('"Billed MTD"');
  });
});

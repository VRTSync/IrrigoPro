// Task #2009 — BudgetBar is the ONE budget renderer in the client.
//
// This suite covers the component's contract (both input modes, the
// classification boundaries, clamping, the two vocabularies, and the
// percentage suppression that the crew view depends on) and then proves each
// migrated surface actually renders through it.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { BudgetBar } from "./BudgetBar";

// ─── Input modes ────────────────────────────────────────────────────────────

describe("BudgetBar input modes", () => {
  it("amounts mode clamps invoiced and pending segments to the allocation width", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={80} pendingAmount={50} allocation={100} />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(container.querySelector('[style*="width: 80%"]')).toBeInTheDocument();
    expect(
      container.querySelector('[style*="left: 80%"][style*="width: 20%"]'),
    ).toBeInTheDocument();
  });

  it("proportion mode fills from a percentage and shows no monetary text", () => {
    const { container } = render(
      <BudgetBar fillPercent={40} forcedStatus="healthy" />,
    );

    expect(container.querySelector('[style*="width: 40%"]')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$/);
    expect(screen.getByText("Go")).toBeInTheDocument();
  });

  it("proportion mode clamps the segment at the track width but keeps the true figure", () => {
    const { container } = render(
      <BudgetBar fillPercent={137} forcedStatus="over" hidePercent={false} />,
    );

    expect(container.querySelector('[style*="width: 100%"]')).toBeInTheDocument();
    expect(screen.getByText("Stop — 137%")).toBeInTheDocument();
  });

  it("total mode draws one segment and never claims the spend was invoiced", () => {
    const { container } = render(
      <BudgetBar spentAmount={7200} allocation={8000} showPercent />,
    );

    expect(container.querySelector('[style*="width: 90%"]')).toBeInTheDocument();
    expect(container.textContent).toContain("$7,200 / $8,000 (90%)");
    // No legend: an aggregate caller holds no invoiced / pending split.
    expect(container.textContent).not.toMatch(/Invoiced|Pending/);
  });

  it("amounts mode draws the legend from the real invoiced / pending split", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={6000} pendingAmount={1200} allocation={8000} />,
    );

    expect(container.textContent).toContain("Invoiced $6,000");
    expect(container.textContent).toContain("Pending $1,200");
    expect(container.querySelector('[style*="width: 75%"]')).toBeInTheDocument();
    expect(
      container.querySelector('[style*="left: 75%"][style*="width: 15%"]'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      "amounts and a proportion",
      <BudgetBar invoicedAmount={50} pendingAmount={0} fillPercent={50} />,
    ],
    [
      "a total and a proportion",
      <BudgetBar spentAmount={50} fillPercent={50} />,
    ],
    [
      "a total and an amounts breakdown",
      <BudgetBar spentAmount={50} invoicedAmount={50} allocation={100} />,
    ],
    [
      "a proportion and an allocation",
      <BudgetBar fillPercent={50} allocation={100} />,
    ],
  ])("fails loudly when handed %s", (_name, element) => {
    // React logs the thrown render error; silence it for this expectation.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(element)).toThrow(/EXACTLY ONE input mode/i);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reports the spend against an uncapped period when asked to", () => {
    render(
      <BudgetBar invoicedAmount={400} pendingAmount={100} allocation={null} showSpendWhenUnset />,
    );

    expect(screen.getByText(/Spent \$500 — no cap set/)).toBeInTheDocument();
    expect(screen.getByText("Unset")).toBeInTheDocument();
    expect(screen.queryByText("No allocation")).toBeNull();
  });

  it("renders Unset — not zero, not full — when the allocation is null", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={400} pendingAmount={100} allocation={null} />,
    );

    expect(screen.getByText("Unset")).toBeInTheDocument();
    expect(screen.getByText("No allocation")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(container.querySelector('[style*="width:"]')).toBeNull();
  });

  it("renders Unset — not zero, not full — when the fill proportion is null", () => {
    const { container } = render(<BudgetBar fillPercent={null} />);

    expect(screen.getByText("Unset")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(container.querySelector('[style*="width:"]')).toBeNull();
  });
});

// ─── Classification ─────────────────────────────────────────────────────────

describe("BudgetBar classification", () => {
  function pillTextFor(spend: number, cap: number, soft?: number, hard?: number) {
    const view = render(
      <BudgetBar
        invoicedAmount={spend}
        pendingAmount={0}
        allocation={cap}
        softThresholdPercent={soft}
        hardThresholdPercent={hard}
      />,
    );
    const text = view.container.querySelector("span[aria-label^='Budget status']")!
      .textContent;
    view.unmount();
    return text;
  }

  it("puts each default-threshold boundary in the higher bucket", () => {
    expect(pillTextFor(74.9, 100)).toBe("Go");
    expect(pillTextFor(75, 100)).toBe("Slow down");
    expect(pillTextFor(99.9, 100)).toBe("Slow down");
    expect(pillTextFor(100, 100)).toBe("Stop — 100%");
    expect(pillTextFor(101, 100)).toBe("Stop — 101%");
  });

  it("honours non-default per-customer thresholds", () => {
    expect(pillTextFor(59, 100, 60, 90)).toBe("Go");
    expect(pillTextFor(60, 100, 60, 90)).toBe("Slow down");
    expect(pillTextFor(89, 100, 60, 90)).toBe("Slow down");
    expect(pillTextFor(90, 100, 60, 90)).toBe("Stop — 90%");
  });

  it("lets forcedStatus override the local classification", () => {
    render(
      <BudgetBar
        invoicedAmount={10}
        pendingAmount={0}
        allocation={100}
        forcedStatus="over"
      />,
    );
    // Locally this is 10% — "Go". The server said "over", and the server wins.
    expect(screen.getByText("Stop — 10%")).toBeInTheDocument();
  });

  it("clamps the track past 100% while the pill keeps the true figure", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={130} pendingAmount={0} allocation={100} />,
    );

    expect(screen.getByText("Stop — 130%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(container.querySelector('[style*="width: 100%"]')).toBeInTheDocument();
  });
});

// ─── Segments ───────────────────────────────────────────────────────────────

describe("BudgetBar segments", () => {
  it("draws one segment when nothing is pending", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={50} pendingAmount={0} allocation={100} />,
    );
    const track = screen.getByRole("progressbar");
    expect(track.querySelectorAll("div[style]")).toHaveLength(2); // invoiced + cap marker
    expect(container.querySelector('[style*="left: 50%"]')).toBeNull();
  });

  it("draws two segments when part of the spend is pending", () => {
    const { container } = render(
      <BudgetBar invoicedAmount={50} pendingAmount={20} allocation={100} />,
    );
    expect(container.querySelector('[style*="width: 50%"]')).toBeInTheDocument();
    expect(
      container.querySelector('[style*="left: 50%"][style*="width: 20%"]'),
    ).toBeInTheDocument();
  });
});

// ─── Presentation ───────────────────────────────────────────────────────────

describe("BudgetBar presentation", () => {
  it("pillOnly renders the pill and no track", () => {
    render(<BudgetBar pillOnly forcedStatus="approaching" />);
    expect(screen.getByText("Slow down")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders both vocabularies from the one label map", () => {
    const instruction = render(
      <BudgetBar pillOnly forcedStatus="healthy" />,
    );
    expect(screen.getByText("Go")).toBeInTheDocument();
    instruction.unmount();

    render(<BudgetBar pillOnly tone="analytic" forcedStatus="healthy" />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.queryByText("Go")).toBeNull();
  });

  it("speaks the analytic vocabulary for every state", () => {
    for (const [status, word] of [
      ["healthy", "Healthy"],
      ["approaching", "Approaching"],
      ["over", "Over"],
      ["unset", "—"],
    ] as const) {
      const view = render(
        <BudgetBar pillOnly tone="analytic" forcedStatus={status} />,
      );
      expect(screen.getByText(word)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("speaks the instruction vocabulary for every state", () => {
    for (const [status, word] of [
      ["healthy", "Go"],
      ["approaching", "Slow down"],
      ["over", "Stop"],
      ["unset", "Unset"],
    ] as const) {
      const view = render(<BudgetBar pillOnly forcedStatus={status} />);
      expect(screen.getByText(word)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("renders the optional label above the bar", () => {
    render(
      <BudgetBar
        label="This month (2026-09)"
        invoicedAmount={50}
        pendingAmount={0}
        allocation={100}
      />,
    );
    expect(screen.getByText("This month (2026-09)")).toBeInTheDocument();
  });

  it("size sm uses the short track and drops the legend", () => {
    render(
      <BudgetBar
        invoicedAmount={50}
        pendingAmount={20}
        allocation={100}
        size="sm"
      />,
    );
    expect(screen.getByRole("progressbar").className).toContain("h-1.5");
    expect(screen.queryByText(/Invoiced \$50/)).toBeNull();
  });

  it("size md keeps the tall track and the segment legend", () => {
    render(
      <BudgetBar invoicedAmount={50} pendingAmount={20} allocation={100} />,
    );
    expect(screen.getByRole("progressbar").className).toContain("h-3");
    expect(screen.getByText(/Invoiced \$50/)).toBeInTheDocument();
    expect(screen.getByText(/Pending \$20/)).toBeInTheDocument();
  });
});

// ─── The crew-view leak ─────────────────────────────────────────────────────

describe("BudgetBar percentage suppression", () => {
  it("hiding dollars leaks no dollar figure, no percentage and no aria-valuenow", () => {
    const { container } = render(
      <BudgetBar fillPercent={116} forcedStatus="over" hideDollars hidePercent />,
    );

    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
    const track = screen.getByRole("progressbar");
    expect(track).not.toHaveAttribute("aria-valuenow");
    // The accessible label reads from the pill, which is percentage-free
    // once the suffix is suppressed — assert it rather than assume it.
    expect(track.getAttribute("aria-label")).toBe("Budget usage: Stop");
  });

  it("hideDollars alone still suppresses the pill percentage (unchanged default)", () => {
    const { container } = render(
      <BudgetBar
        invoicedAmount={125}
        pendingAmount={0}
        allocation={100}
        forcedStatus="over"
        hideDollars
      />,
    );

    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|%/);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});

// ─── The deleted renderers ──────────────────────────────────────────────────
//
// Deletion is the one thing a rendered test cannot prove: a dead component
// that nobody mounts renders nothing either way. Every *output* claim below
// this block is asserted on rendered DOM.

const SRC_ROOT = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) =>
  fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");

describe("no surface owns a budget renderer any more", () => {
  it("the customer profile's bucket row and local status type are gone", () => {
    const SRC = readSrc("pages/customer-profile.tsx");
    expect(SRC).not.toMatch(/BudgetBucketRow|BUCKET_ACCENT/);
    expect(SRC).not.toMatch(/^type BudgetStatus =/m);
  });

  it("the Financial Pulse page's meter, status helper and local status type are gone", () => {
    const SRC = readSrc("pages/financial-pulse.tsx");
    expect(SRC).not.toMatch(/function BudgetMeter|function statusTone/);
    expect(SRC).not.toMatch(/^type BudgetStatus =/m);
  });

  it("the Financial Pulse widget's meter and both status helpers are gone", () => {
    const SRC = readSrc("components/financial-pulse/financial-pulse-widget.tsx");
    expect(SRC).not.toMatch(
      /function BudgetMeter|function statusColor|function statusPill/,
    );
  });

  it("the customer form's preview row and status helpers are gone", () => {
    const SRC = readSrc("components/customer-form.tsx");
    expect(SRC).not.toMatch(/function PreviewRow|function statusTone|previewBucket/);
  });

  it("the crew view passes no monetary prop, and the live preview no forced status", () => {
    const CREW = readSrc("pages/field-tech-dashboard.tsx");
    const call = CREW.slice(CREW.indexOf("<BudgetBar"), CREW.indexOf("/>", CREW.indexOf("<BudgetBar")));
    expect(call).not.toMatch(/invoicedAmount|pendingAmount|allocation/);

    const FORM = readSrc("components/customer-form.tsx");
    const preview = FORM.slice(FORM.indexOf("function LiveBudgetPreview"));
    expect(preview).not.toMatch(/forcedStatus/);
  });
});

// ─── The crew view, rendered ────────────────────────────────────────────────

const useQueryMock = vi.hoisted(() => vi.fn());
const useArrayQueryMock = vi.hoisted(() => vi.fn(() => ({ data: [] })));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: useQueryMock,
}));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  useArrayQuery: useArrayQueryMock,
  adaptiveRefetchInterval: () => false as const,
  apiRequest: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 7, role: "field_tech", name: "Tech" } }),
}));

// Exactly what GET /api/budget/crew-status returns: customerId, customerName,
// status and fillPercent. No cap, no spend, no remaining, no allocation.
const CREW_RESPONSE = {
  year: 2026,
  month: 9,
  rows: [
    { customerId: 1, customerName: "Over Customer", status: "Stop", fillPercent: 116.4 },
    { customerId: 2, customerName: "Near Customer", status: "Slow down", fillPercent: 82 },
    { customerId: 3, customerName: "Fine Customer", status: "Go", fillPercent: 31 },
  ],
};

describe("crew view renders no dollar figure, no percentage and no aria-valuenow", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation((opts: { queryKey: unknown[] }) => {
      const key = String(opts.queryKey?.[0] ?? "");
      if (key.startsWith("/api/budget/crew-status")) {
        return { data: CREW_RESPONSE, isLoading: false };
      }
      return { data: [], isLoading: false };
    });
    useArrayQueryMock.mockReturnValue({ data: [] });
  });
  afterEach(() => vi.clearAllMocks());

  it("shows the instruction words only", async () => {
    const { default: FieldTechDashboard } = await import(
      "@/pages/field-tech-dashboard"
    );
    const { QueryClient, QueryClientProvider } = await vi.importActual<
      typeof import("@tanstack/react-query")
    >("@tanstack/react-query");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FieldTechDashboard />
      </QueryClientProvider>,
    );

    const list = screen.getByTestId("crew-budget-list");
    expect(within(list).getByText("Stop")).toBeInTheDocument();
    expect(within(list).getByText("Slow down")).toBeInTheDocument();
    expect(within(list).getByText("Go")).toBeInTheDocument();

    // No dollars, no percentage anywhere in the crew budget list.
    expect(list.textContent).not.toMatch(/\$|%/);
    expect(list.textContent).not.toMatch(/116/);

    // And nothing announced through the accessibility layer either.
    for (const track of within(list).getAllByRole("progressbar")) {
      expect(track).not.toHaveAttribute("aria-valuenow");
      expect(track.getAttribute("aria-label")).not.toMatch(/%/);
    }
  });
});

// ─── The other migrated surfaces, rendered ──────────────────────────────────
//
// Each of these mounts the real surface and reads the figures it prints. The
// numbers are the ones the deleted renderer printed for the same fixture, so a
// translation error in the migration fails here rather than in production.

const BUDGET_USAGE = {
  customerId: 42,
  softThresholdPercent: 75,
  hardThresholdPercent: 100,
  currentMonthKey: "2026-09",
  currentYearKey: "2026",
  monthlyCap: 8000,
  // The endpoint's own split: $6,000 billed, $1,200 worked but not yet
  // billed. The card must report both, not call the $7,200 total invoiced.
  monthlySpend: 7200,
  monthlyInvoiced: 6000,
  monthlyPendingNotBilled: 1200,
  monthlyPercent: 0.9,
  monthlyStatus: "approaching" as const,
  annualCap: 40000,
  annualSpend: 12000,
  annualInvoiced: 12000,
  annualPendingNotBilled: 0,
  annualPercent: 0.3,
  annualStatus: "healthy" as const,
};

describe("migrated surface — customer profile Budget & Alerts card", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation((opts: { queryKey: unknown[] }) => {
      const key = String(opts.queryKey?.[0] ?? "");
      if (key.includes("/budget-usage")) {
        return { data: BUDGET_USAGE, isLoading: false, isError: false };
      }
      return { data: undefined, isLoading: false, isError: false };
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("prints the same dollars and percentage the bucket rows printed", async () => {
    const { BudgetCard } = await import("@/pages/customer-profile");
    render(<BudgetCard customerId={42} />);

    const month = screen.getByTestId("customer-budget-month");
    expect(month.textContent).toContain("This month (2026-09)");
    expect(month.textContent).toContain("$7,200 / $8,000 (90%)");
    expect(within(month).getByText("Slow down")).toBeInTheDocument();
    // The legend reports the endpoint's real split, not "Invoiced $7,200".
    expect(month.textContent).toContain("Invoiced $6,000");
    expect(month.textContent).toContain("Pending $1,200");

    const year = screen.getByTestId("customer-budget-year");
    expect(year.textContent).toContain("This year (2026)");
    expect(year.textContent).toContain("$12,000 / $40,000 (30%)");
    expect(within(year).getByText("Go")).toBeInTheDocument();
  });

  it("keeps the spend figure on a period with no cap", async () => {
    useQueryMock.mockImplementation(() => ({
      data: {
        ...BUDGET_USAGE,
        annualCap: null,
        annualPercent: null,
        annualStatus: "unset" as const,
      },
      isLoading: false,
      isError: false,
    }));
    const { BudgetCard } = await import("@/pages/customer-profile");
    render(<BudgetCard customerId={42} />);

    const year = screen.getByTestId("customer-budget-year");
    expect(year.textContent).toContain("Spent $12,000");
    expect(year.textContent).toContain("no cap set");
  });

  it("renders one meter per bucket — the card no longer draws its own", async () => {
    const { BudgetCard } = await import("@/pages/customer-profile");
    const { container } = render(<BudgetCard customerId={42} />);
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  });
});

describe("migrated surface — Financial Pulse page table cell", () => {
  afterEach(() => vi.clearAllMocks());

  it("keeps the track and the percentage the Progress cell showed", async () => {
    const { CustomerBudgetCell } = await import("@/pages/financial-pulse");
    render(
      <CustomerBudgetCell
        cap={8000}
        spend={7200}
        status="approaching"
        testId="customer-monthly-meter-42"
      />,
    );
    const cell = screen.getByTestId("customer-monthly-meter-42");
    expect(within(cell).getByRole("progressbar")).toBeInTheDocument();
    expect(cell.textContent).toContain("90%");
    // A dense revenue table shows no dollars in this column — it never did.
    expect(cell.textContent).not.toMatch(/\$/);
  });

  it("shows the analytic dash and no track when the customer has no cap", async () => {
    const { CustomerBudgetCell } = await import("@/pages/financial-pulse");
    render(
      <CustomerBudgetCell
        cap={null}
        spend={7200}
        status="unset"
        testId="customer-annual-meter-42"
      />,
    );
    const cell = screen.getByTestId("customer-annual-meter-42");
    expect(cell.textContent).toBe("—");
    expect(within(cell).queryByRole("progressbar")).toBeNull();
  });

  it("prints the true percentage past the cap", async () => {
    const { CustomerBudgetCell } = await import("@/pages/financial-pulse");
    render(
      <CustomerBudgetCell
        cap={8000}
        spend={9600}
        status="over"
        testId="customer-monthly-meter-7"
      />,
    );
    expect(screen.getByTestId("customer-monthly-meter-7").textContent).toContain(
      "120%",
    );
  });

  it("prints a healthy percentage well under the cap", async () => {
    const { CustomerBudgetCell } = await import("@/pages/financial-pulse");
    render(
      <CustomerBudgetCell
        cap={8000}
        spend={2000}
        status="healthy"
        testId="customer-monthly-meter-9"
      />,
    );
    expect(screen.getByTestId("customer-monthly-meter-9").textContent).toContain(
      "25%",
    );
  });
});

const CUSTOMER_SUMMARY = {
  customerId: 42,
  name: "Settlers Chase",
  billedMtd: 7200,
  billedYtd: 12000,
  outstandingAr: 0,
  unbilledExposure: 0,
  avgDaysToPay: 14,
  lastInvoiceAt: null,
  monthly: { cap: 8000, spend: 7200, percent: 0.9, status: "approaching" as const },
  annual: { cap: 40000, spend: 12000, percent: 0.3, status: "healthy" as const },
};

const TOP_CUSTOMERS = {
  rows: [
    {
      customerId: 1,
      name: "Over Customer",
      revenue: 9600,
      monthlyCap: 8000,
      monthlyUsedPct: 1.2,
      monthlyStatus: "over" as const,
    },
    {
      customerId: 2,
      name: "Near Customer",
      revenue: 7200,
      monthlyCap: 8000,
      monthlyUsedPct: 0.9,
      monthlyStatus: "approaching" as const,
    },
    {
      customerId: 3,
      name: "Fine Customer",
      revenue: 2000,
      monthlyCap: 8000,
      monthlyUsedPct: 0.25,
      monthlyStatus: "healthy" as const,
    },
  ],
  total: 3,
};

describe("migrated surface — Financial Pulse widget", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation((opts: { queryKey: unknown[] }) => {
      const key = String(opts.queryKey?.[0] ?? "");
      if (key.includes("/customer/")) {
        return { data: CUSTOMER_SUMMARY, isLoading: false, error: null };
      }
      if (key.includes("/top-customers")) {
        return { data: TOP_CUSTOMERS, isLoading: false, error: null };
      }
      return { data: null, isLoading: false, error: null };
    });
  });
  afterEach(() => vi.clearAllMocks());

  async function renderWidget(node: React.ReactNode) {
    const { TooltipProvider } = await import("@/components/ui/tooltip");
    return render(<TooltipProvider>{node}</TooltipProvider>);
  }

  it("customer detail prints the same dollars and percentage as before", async () => {
    const { FinancialPulseWidget } = await import(
      "@/components/financial-pulse/financial-pulse-widget"
    );
    await renderWidget(
      <FinancialPulseWidget variant="customer-detail" customerId={42} />,
    );

    const meter = screen.getByTestId("fp-widget-budget-meter");
    expect(meter.textContent).toContain("$7,200 / $8,000 (90%)");
    expect(within(meter).getByRole("progressbar")).toBeInTheDocument();
    // The summary returns one aggregate spend and no breakdown, so nothing
    // here may claim the total was invoiced.
    expect(meter.textContent).not.toMatch(/Invoiced|Pending/);
  });

  it("top customers badges speak the analytic vocabulary and leak no percentage", async () => {
    const { FinancialPulseWidget } = await import(
      "@/components/financial-pulse/financial-pulse-widget"
    );
    await renderWidget(
      <FinancialPulseWidget variant="top-customers-compact" />,
    );

    expect(screen.getByTestId("fp-top-customer-status-1").textContent).toBe(
      "Over",
    );
    expect(screen.getByTestId("fp-top-customer-status-2").textContent).toBe(
      "Approaching",
    );
    expect(screen.getByTestId("fp-top-customer-status-3").textContent).toBe(
      "Healthy",
    );

    // The badges are pill-only: no track of their own.
    for (const id of [1, 2, 3]) {
      expect(
        within(screen.getByTestId(`fp-top-customer-status-${id}`)).queryByRole(
          "progressbar",
        ),
      ).toBeNull();
    }
  });
});

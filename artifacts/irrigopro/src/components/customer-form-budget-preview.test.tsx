// Task #687 — Financial Pulse Slice 1.
//
// Guard the LiveBudgetPreview re-fetch contract: when the user types a
// new cap or threshold into the form, the preview MUST re-classify
// against the latest server-side spend. The card uses React Query's
// `refetch()` inside a `useEffect` keyed on cap/threshold values. If a
// future refactor drops that hook (or stops including the watched
// values in the dep array) this static-source guard fails fast.

import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "customer-form.tsx"),
  "utf8",
);

// The preview's only data dependency is the budget-usage query; stub it so the
// suite can mount the real component and read what it prints.
const useQueryMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: useQueryMock,
}));

describe("LiveBudgetPreview re-fetch contract", () => {
  it("calls refetch() inside a useEffect whose deps include caps + thresholds", () => {
    // Pull out the LiveBudgetPreview function body.
    const start = SRC.indexOf("function LiveBudgetPreview");
    expect(start).toBeGreaterThan(-1);
    const next = SRC.indexOf("\nfunction ", start + 1);
    const body = SRC.slice(start, next === -1 ? undefined : next);

    // The form values that drive the preview must all be watched.
    expect(body).toMatch(/form\.watch\(\s*"annualBudgetGoal"\s*\)/);
    expect(body).toMatch(/form\.watch\(\s*"budgetSoftThresholdPercent"\s*\)/);
    expect(body).toMatch(/form\.watch\(\s*"budgetHardThresholdPercent"\s*\)/);

    // The useEffect must call refetch and list all four watched values
    // in its dependency array so a change re-triggers the fetch.
    const effectMatch = body.match(
      /useEffect\(\s*\(\)\s*=>\s*\{[^}]*refetch\(\)[^}]*\}\s*,\s*\[([^\]]+)\]\s*\)/,
    );
    expect(effectMatch, "useEffect calling refetch() not found").not.toBeNull();
    const deps = effectMatch![1];
    expect(deps).toMatch(/annualGoal/);
    expect(deps).toMatch(/softPct/);
    expect(deps).toMatch(/hardPct/);
    expect(deps).toMatch(/refetch/);
  });

  it("owns no renderer of its own any more", () => {
    // Task #2009 — parity with the customer-profile card used to mean "both
    // draw a <Progress>". It now means something stronger: both call the ONE
    // budget renderer, so they cannot disagree on colour, wording or
    // thresholds. The preview classifies UNSAVED typed values, so it must
    // pass the typed cap and thresholds and must never take a forced status.
    expect(SRC).toMatch(
      /import\s+\{\s*BudgetBar\s*\}\s+from\s+"@\/components\/budget\/BudgetBar"/,
    );
    expect(SRC).not.toMatch(/function PreviewRow/);
    expect(SRC).not.toMatch(/<Progress/);

    const previewStart = SRC.indexOf("function LiveBudgetPreview");
    expect(previewStart).toBeGreaterThan(-1);
    const previewBody = SRC.slice(previewStart);
    expect(previewBody).toMatch(/<BudgetBar/);
    expect(previewBody).toMatch(/allocation=\{monthlyCap\}/);
    expect(previewBody).toMatch(/allocation=\{annualCap\}/);
    expect(previewBody).toMatch(/softThresholdPercent=\{softThreshold\}/);
    expect(previewBody).toMatch(/hardThresholdPercent=\{hardThreshold\}/);
    expect(previewBody).not.toMatch(/forcedStatus/);
  });
});

// ─── The preview, rendered ──────────────────────────────────────────────────

const USAGE = {
  customerId: 42,
  softThresholdPercent: 75,
  hardThresholdPercent: 100,
  currentMonthKey: "2026-09",
  currentYearKey: "2026",
  monthlyAllocation: 8000,
  monthlyCap: 8000,
  monthlySpend: 7200,
  monthlyInvoiced: 6000,
  monthlyPendingNotBilled: 1200,
  monthlyPercent: 0.9,
  monthlyStatus: "approaching" as const,
  annualCap: 40000,
  annualGoal: 40000,
  seasonToDateTarget: 0,
  seasonToDateSpend: 0,
  annualSpend: 12000,
  annualInvoiced: 12000,
  annualPendingNotBilled: 0,
  annualPercent: 0.3,
  annualStatus: "healthy" as const,
};

describe("LiveBudgetPreview rendered output", () => {
  afterEach(() => vi.clearAllMocks());

  async function renderPreview(values: {
    annualBudgetGoal?: string;
    budgetSoftThresholdPercent?: string;
    budgetHardThresholdPercent?: string;
  }) {
    useQueryMock.mockReturnValue({
      data: USAGE,
      isLoading: false,
      refetch: vi.fn(),
    });
    const { LiveBudgetPreview } = await import("./customer-form");
    type PreviewProps = React.ComponentProps<typeof LiveBudgetPreview>;

    function Harness() {
      const form = useForm({
        defaultValues: {
          annualBudgetGoal: "",
          budgetSoftThresholdPercent: "75",
          budgetHardThresholdPercent: "100",
          ...values,
        },
      });
      return (
        <LiveBudgetPreview
          customer={{ id: 42 } as PreviewProps["customer"]}
          form={form as unknown as PreviewProps["form"]}
        />
      );
    }
    return render(<Harness />);
  }

  it("prints the same dollars and percentage the preview rows printed", async () => {
    await renderPreview({});

    const month = screen.getByTestId("budget-preview-month");
    expect(month.textContent).toContain("This month (2026-09)");
    expect(month.textContent).toContain("$7,200 / $8,000 (90%)");
    expect(month.textContent).toContain("Slow down");
    // The typed cap is previewed against the endpoint's real split.
    expect(month.textContent).toContain("Invoiced $6,000");
    expect(month.textContent).toContain("Pending $1,200");

    const year = screen.getByTestId("budget-preview-year");
    expect(year.textContent).toContain("$12,000 / $40,000 (30%)");
    expect(year.textContent).toContain("Go");
  });

  it("classifies the UNSAVED typed goal, not the server's status", async () => {
    // The server says this year is healthy against a $40,000 cap. The user is
    // typing $10,000, which the same spend blows through — the preview must
    // say so before anything is saved.
    await renderPreview({ annualBudgetGoal: "10000" });

    const year = screen.getByTestId("budget-preview-year");
    expect(year.textContent).toContain("$12,000 / $10,000 (120%)");
    expect(year.textContent).toContain("Stop");
  });

  it("keeps the spend figure while the user has typed no cap yet", async () => {
    useQueryMock.mockReturnValue({
      data: { ...USAGE, annualCap: null, annualGoal: null, annualStatus: "unset" as const },
      isLoading: false,
      refetch: vi.fn(),
    });
    const { LiveBudgetPreview } = await import("./customer-form");
    type PreviewProps = React.ComponentProps<typeof LiveBudgetPreview>;
    function Harness() {
      const form = useForm({
        defaultValues: {
          annualBudgetGoal: "",
          budgetSoftThresholdPercent: "75",
          budgetHardThresholdPercent: "100",
        },
      });
      return (
        <LiveBudgetPreview
          customer={{ id: 42 } as PreviewProps["customer"]}
          form={form as unknown as PreviewProps["form"]}
        />
      );
    }
    render(<Harness />);

    const year = screen.getByTestId("budget-preview-year");
    expect(year.textContent).toContain("Spent $12,000");
    expect(year.textContent).toContain("no cap set");
  });

  it("re-classifies against a typed soft threshold", async () => {
    // 90% of the monthly cap is "Slow down" at the default 75, and still fine
    // at 95 — the typed threshold is what decides.
    await renderPreview({ budgetSoftThresholdPercent: "95" });
    expect(screen.getByTestId("budget-preview-month").textContent).toContain(
      "Go",
    );
  });
});

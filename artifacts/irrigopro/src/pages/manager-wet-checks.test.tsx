/**
 * manager-wet-checks.test.tsx (Task #803 — Slice 7)
 *
 * Asserts:
 *   1. Page queries /api/wet-check-billings (not /api/billing-sheets)
 *   2. "auto-billed today" KPI counts only entries whose workDate is today
 *   3. The drill-in KPI tile href points to /wet-check-billings
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ManagerWetChecksPage from "./manager-wet-checks";

vi.mock("@/components/admin-dashboard/header-strip", () => ({
  HeaderStrip: ({ name, health, healthLabel }: any) => (
    <div data-testid="header-strip">{healthLabel}</div>
  ),
}));

vi.mock("@/components/admin-dashboard/kpi-tile", () => ({
  KpiTile: ({ label, value, href, testId }: any) => (
    <div data-testid={testId}>
      <span data-testid={`${testId}-label`}>{label}</span>
      <span data-testid={`${testId}-value`}>{value}</span>
      {href && <a data-testid={`${testId}-href`} href={href}>{href}</a>}
    </div>
  ),
}));

vi.mock("@/components/manager/wet-check-card", () => ({
  WetCheckCard: ({ wc }: any) => <div data-testid={`wc-card-${wc.id}`} />,
}));

vi.mock("@/utils/safeStorage", () => ({
  safeGet: () => null,
}));

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T12:00:00.000Z`;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString();
}

function makeWcb(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    billingNumber: "WCB-2026-001",
    customerId: 10,
    customerName: "Acme",
    propertyAddress: "1 Main St",
    technicianName: "Jordan",
    technicianId: 5,
    wetCheckId: 20,
    status: "submitted",
    workDate: todayIso(),
    totalAmount: "150.00",
    laborRate: "75.00",
    laborSubtotal: "75.00",
    partsSubtotal: "75.00",
    totalHours: "1.00",
    invoiceId: null,
    billedAt: null,
    photos: [],
    notes: null,
    branchName: null,
    approvedBy: null,
    approvedByUserId: null,
    approvedAt: null,
    approvedTotal: null,
    appliedLaborRate: null,
    noPhotosNeeded: false,
    createdAt: new Date(todayIso()),
    updatedAt: new Date(todayIso()),
    ...overrides,
  };
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function buildClient(
  wetCheckBillings: unknown[],
  pendingReviews: unknown[] = [],
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-check-billings"], wetCheckBillings);
  qc.setQueryData(["/api/wet-checks/pending-review"], pendingReviews);
  return qc;
}

describe("ManagerWetChecksPage (Task #803)", () => {
  it("renders the page wrapper", () => {
    const qc = buildClient([]);
    render(<ManagerWetChecksPage />, { wrapper: wrapper(qc) });
    expect(screen.getByTestId("manager-wet-checks-page")).toBeDefined();
  });

  it("queries /api/wet-check-billings and shows today's total", () => {
    const todayRow = makeWcb({ id: 1, totalAmount: "200.00" });
    const qc = buildClient([todayRow]);
    render(<ManagerWetChecksPage />, { wrapper: wrapper(qc) });

    const valueEl = screen.getByTestId("kpi-completed-today-value");
    expect(valueEl.textContent).toContain("200.00");
  });

  it("auto-billed today counts only entries whose workDate is today", () => {
    const todayA = makeWcb({ id: 1, totalAmount: "100.00", workDate: todayIso() });
    const todayB = makeWcb({ id: 2, totalAmount: "50.00", workDate: todayIso() });
    const notToday = makeWcb({ id: 3, totalAmount: "999.00", workDate: yesterday() });
    const qc = buildClient([todayA, todayB, notToday]);
    render(<ManagerWetChecksPage />, { wrapper: wrapper(qc) });

    const valueEl = screen.getByTestId("kpi-completed-today-value");
    expect(valueEl.textContent).toContain("150.00");
    expect(valueEl.textContent).not.toContain("999");
  });

  it("does not query /api/billing-sheets", () => {
    const qc = buildClient([]);
    const spy = vi.spyOn(qc, "getQueryData");
    render(<ManagerWetChecksPage />, { wrapper: wrapper(qc) });

    const billingSheetsCalls = spy.mock.calls.filter(
      (args) => JSON.stringify(args[0]).includes("/api/billing-sheets"),
    );
    expect(billingSheetsCalls).toHaveLength(0);
  });

  it("drill-in KPI href points to /wet-check-billings", () => {
    const qc = buildClient([makeWcb()]);
    render(<ManagerWetChecksPage />, { wrapper: wrapper(qc) });

    const hrefEl = screen.getByTestId("kpi-completed-today-href") as HTMLAnchorElement;
    expect(hrefEl.getAttribute("href")).toBe("/wet-check-billings");
  });
});

/**
 * wet-check-billings.test.tsx (Task #791 — Slice 4)
 *
 * Unit tests for the WetCheckBillings page component.
 *
 * Scenarios:
 *   1. Page header renders
 *   2. "Awaiting Invoice" section shows 2 rows, "Billed" section shows 1 row
 *   3. Issues cell format: "N across M zone(s)"
 *   4. Row click opens WetCheckBillingViewModal
 *   5. WC # link has correct href
 *   6. Empty state renders when no data matches
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WetCheckBillings from "./wet-check-billings";

// ── Mock the modal so we can assert it opens without a full render ─────────────

vi.mock("@/components/wet-check-billings/wet-check-billing-view-modal", () => ({
  WetCheckBillingViewModal: ({ open, wetCheckBillingId }: { open: boolean; wetCheckBillingId: number }) =>
    open ? <div data-testid={`modal-open-${wetCheckBillingId}`}>Modal Open</div> : null,
}));

// ── Mock wouter ────────────────────────────────────────────────────────────────

vi.mock("wouter", async (importActual) => {
  const actual = await importActual<typeof import("wouter")>();
  return {
    ...actual,
    Link: ({ href, children, onClick, ...rest }: any) => (
      <a href={href} onClick={onClick} {...rest}>{children}</a>
    ),
  };
});

// ── Fixture data ───────────────────────────────────────────────────────────────

function makeWcb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    billingNumber: "WC-2026-1001",
    customerId: 10,
    customerName: "Acme Corp",
    propertyAddress: "1 Main St",
    technicianName: "Jordan Smith",
    workDate: "2026-05-01T00:00:00.000Z",
    status: "submitted",
    wetCheckId: 55,
    invoiceId: null,
    totalAmount: "250.00",
    laborRate: "75.00",
    laborSubtotal: "150.00",
    partsSubtotal: "100.00",
    totalHours: "2.00",
    issuesCount: 3,
    zonesCount: 2,
    photos: [],
    notes: null,
    branchName: null,
    approvedBy: null,
    approvedByUserId: null,
    approvedAt: null,
    approvedTotal: null,
    noPhotosNeeded: false,
    appliedLaborRate: null,
    billedAt: null,
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-01"),
    ...overrides,
  };
}

const FIXTURE_ROWS = [
  // Two awaiting invoice
  makeWcb({ id: 1, billingNumber: "WC-2026-1001", status: "submitted", invoiceId: null }),
  makeWcb({ id: 2, billingNumber: "WC-2026-1002", status: "approved_passed_to_billing", invoiceId: null, wetCheckId: 56 }),
  // One billed
  makeWcb({ id: 3, billingNumber: "WC-2026-1003", status: "billed", invoiceId: 99, wetCheckId: 57 }),
];

// ── Test helpers ──────────────────────────────────────────────────────────────

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function buildClient(data: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-check-billings"], data);
  return qc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WetCheckBillings page (Task #791)", () => {
  it("renders the page header", () => {
    const qc = buildClient(FIXTURE_ROWS);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });
    expect(screen.getByText("Wet Check Billings")).toBeDefined();
    expect(screen.getByText(/auto-generated from wet check submissions/i)).toBeDefined();
  });

  it("Awaiting Invoice section has 2 rows, Billed section has 1 row", () => {
    const qc = buildClient(FIXTURE_ROWS);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    // Awaiting Invoice section header badge shows 2
    const awaitingSection = screen.getByTestId("section-toggle-awaiting-invoice");
    expect(awaitingSection.textContent).toContain("2");

    // Billed section starts collapsed — toggle it
    const billedToggle = screen.getByTestId("section-toggle-billed");
    fireEvent.click(billedToggle);
    expect(billedToggle.textContent).toContain("1");
  });

  it("Issues cell shows 'N across M zone(s)' format", () => {
    const qc = buildClient(FIXTURE_ROWS);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    const issueCell = screen.getByTestId("wcb-issues-1");
    expect(issueCell.textContent).toBe("3 across 2 zones");
  });

  it("clicking a row (outside WC # link) opens modal", () => {
    const qc = buildClient(FIXTURE_ROWS);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    const row = screen.getByTestId("wcb-row-1");
    fireEvent.click(row);
    expect(screen.getByTestId("modal-open-1")).toBeDefined();
  });

  it("WC # link navigates to /wet-checks/:wetCheckId?from=wet-check-billings", () => {
    const qc = buildClient(FIXTURE_ROWS);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    const link = screen.getByTestId("wcb-wc-link-1") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain(`/wet-checks/55`);
    expect(link.getAttribute("href")).toContain("from=wet-check-billings");
  });

  it("shows empty state when all rows are filtered out by search", () => {
    const qc = buildClient(FIXTURE_ROWS);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    const search = screen.getByTestId("input-search-wcb");
    fireEvent.change(search, { target: { value: "XYZNONEXISTENTQUERY12345" } });

    expect(screen.getByTestId("empty-awaiting-invoice")).toBeDefined();
  });
});

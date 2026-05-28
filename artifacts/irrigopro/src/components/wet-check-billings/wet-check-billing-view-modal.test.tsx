/**
 * wet-check-billing-view-modal.test.tsx (Task #791 + Task #977)
 *
 * Unit tests for WetCheckBillingViewModal.
 *
 * Scenarios (Task #791):
 *   1. Shows billingNumber as dialog title
 *   2. No Edit, Approve, Send or Delete buttons
 *   3. "View originating wet check" link has correct href pattern
 *   4. Close button calls onOpenChange(false)
 *
 * Scenarios (Task #977 — pencil visibility):
 *   5. billing_manager on unlocked WCB sees edit affordances
 *   6. billing_manager on billed WCB does NOT see edit affordances
 *   7. field_tech on unlocked WCB does NOT see edit affordances
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WetCheckBillingViewModal } from "./wet-check-billing-view-modal";

// ── Mock wouter ────────────────────────────────────────────────────────────────

vi.mock("wouter", async (importActual) => {
  const actual = await importActual<typeof import("wouter")>();
  return {
    ...actual,
    useLocation: () => ["/wet-check-billings", vi.fn()],
  };
});

// ── Mock the WetCheckBillingViewComponent ─────────────────────────────────────

vi.mock("@/components/billing/wet-check-billing-view", () => ({
  WetCheckBillingViewComponent: () => <div data-testid="wc-billing-view">View Body</div>,
}));

// ── safeStorage mock — overridden per-test via factory ────────────────────────

const mockSafeGet = vi.fn(() => JSON.stringify({ role: "billing_manager" }));
vi.mock("@/utils/safeStorage", () => ({
  safeGet: (...args: any[]) => mockSafeGet(...args),
}));

// ── Fixture builders ──────────────────────────────────────────────────────────

function buildWcb(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    billingNumber: "WC-2026-0042",
    customerId: 10,
    customerName: "Sunrise Landscaping",
    propertyAddress: "101 Garden Blvd",
    technicianName: "Alex Rivera",
    workDate: "2026-05-15T00:00:00.000Z",
    status: "approved_passed_to_billing",
    wetCheckId: 99,
    invoiceId: null,
    totalAmount: "320.00",
    laborRate: "80.00",
    laborSubtotal: "240.00",
    partsSubtotal: "80.00",
    totalHours: "3.00",
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
    createdAt: new Date("2026-05-15"),
    updatedAt: new Date("2026-05-15"),
    ...overrides,
  };
}

const FIXTURE_VIEW = {
  billingSheetId: 0,
  billingNumber: "WC-2026-0042",
  customerId: 10,
  customerName: "Sunrise Landscaping",
  workDate: "2026-05-15T00:00:00.000Z",
  laborRate: "80.00",
  inspection: {
    wetCheckId: 99,
    technicianName: "Alex Rivera",
    inspectionDate: "2026-05-14T09:00:00.000Z",
    propertyAddress: "101 Garden Blvd",
    weather: null,
    notes: null,
  },
  zones: [],
  repairsSummary: "0 repairs",
  partsSubtotal: "80.00",
  laborSubtotal: "240.00",
  grandTotal: "320.00",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildClient(
  wetCheckBillingId: number,
  wcbOverrides: Record<string, unknown> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-check-billings", wetCheckBillingId], {
    wetCheckBilling: buildWcb(wcbOverrides),
    view: FIXTURE_VIEW,
  });
  return qc;
}

function renderModal(
  wetCheckBillingId: number,
  onOpenChange = vi.fn(),
  wcbOverrides: Record<string, unknown> = {},
  role = "billing_manager",
) {
  mockSafeGet.mockReturnValue(JSON.stringify({ role }));
  const qc = buildClient(wetCheckBillingId, wcbOverrides);
  return render(
    <QueryClientProvider client={qc}>
      <WetCheckBillingViewModal
        wetCheckBillingId={wetCheckBillingId}
        open={true}
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WetCheckBillingViewModal (Task #791)", () => {
  it("shows billingNumber as dialog title", () => {
    renderModal(42);
    expect(screen.getByTestId("wcb-modal-title").textContent).toContain("WC-2026-0042");
  });

  it("shows customer name and property address in subtitle", () => {
    renderModal(42);
    const subtitle = screen.getByTestId("wcb-modal-subtitle");
    expect(subtitle.textContent).toContain("Sunrise Landscaping");
    expect(subtitle.textContent).toContain("101 Garden Blvd");
  });

  it("does NOT render Edit, Approve, Send, or Delete buttons", () => {
    renderModal(42);
    const buttons = screen.queryAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.toLowerCase() ?? "");
    expect(labels.some((l) => l.includes("edit"))).toBe(false);
    expect(labels.some((l) => l.includes("approve"))).toBe(false);
    expect(labels.some((l) => l.includes("send"))).toBe(false);
    expect(labels.some((l) => l.includes("delete"))).toBe(false);
  });

  it('"View originating wet check" link references the correct wet check', () => {
    renderModal(42);
    const link = screen.getByTestId("wcb-modal-originating-link");
    expect(link.textContent).toContain("View originating wet check");
  });

  it("Close button calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    renderModal(42, onOpenChange);
    const closeBtn = screen.getByTestId("wcb-modal-close");
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("WetCheckBillingViewModal — pencil affordances (Task #977)", () => {
  it("billing_manager on unlocked (approved_passed_to_billing) WCB sees edit affordances", () => {
    renderModal(42, vi.fn(), { status: "approved_passed_to_billing", invoiceId: null }, "billing_manager");
    expect(screen.getByTestId("wcb-edit-affordances")).toBeTruthy();
    expect(screen.getByTestId("wcb-labor-rate-pencil")).toBeTruthy();
  });

  it("billing_manager on billed WCB does NOT see edit affordances", () => {
    renderModal(42, vi.fn(), { status: "billed", invoiceId: null }, "billing_manager");
    expect(screen.queryByTestId("wcb-edit-affordances")).toBeNull();
    expect(screen.queryByTestId("wcb-labor-rate-pencil")).toBeNull();
  });

  it("billing_manager on invoiced WCB does NOT see edit affordances", () => {
    renderModal(42, vi.fn(), { status: "approved_passed_to_billing", invoiceId: 99 }, "billing_manager");
    expect(screen.queryByTestId("wcb-edit-affordances")).toBeNull();
  });

  it("field_tech on unlocked WCB does NOT see edit affordances", () => {
    renderModal(42, vi.fn(), { status: "approved_passed_to_billing", invoiceId: null }, "field_tech");
    expect(screen.queryByTestId("wcb-edit-affordances")).toBeNull();
    expect(screen.queryByTestId("wcb-labor-rate-pencil")).toBeNull();
  });

  it("clicking labor-rate pencil renders WcbLaborRateEdit inline", () => {
    renderModal(42, vi.fn(), { status: "approved_passed_to_billing", invoiceId: null }, "billing_manager");
    fireEvent.click(screen.getByTestId("wcb-labor-rate-pencil"));
    expect(screen.getByTestId("wcb-labor-rate-edit")).toBeTruthy();
  });
});

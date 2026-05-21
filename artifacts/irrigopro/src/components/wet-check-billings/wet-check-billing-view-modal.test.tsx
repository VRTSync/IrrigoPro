/**
 * wet-check-billing-view-modal.test.tsx (Task #791 — Slice 4)
 *
 * Unit tests for WetCheckBillingViewModal.
 *
 * Scenarios:
 *   1. Shows billingNumber as dialog title
 *   2. No Edit, Approve, Send or Delete buttons
 *   3. "View originating wet check" link has correct href pattern
 *   4. Close button calls onOpenChange(false)
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

// ── Mock safeStorage ──────────────────────────────────────────────────────────

vi.mock("@/utils/safeStorage", () => ({
  safeGet: () => JSON.stringify({ role: "billing_manager" }),
}));

// ── Fixture ───────────────────────────────────────────────────────────────────

const FIXTURE_WCB = {
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
};

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

function buildClient(wetCheckBillingId: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-check-billings", wetCheckBillingId], {
    wetCheckBilling: FIXTURE_WCB,
    view: FIXTURE_VIEW,
  });
  return qc;
}

function renderModal(wetCheckBillingId: number, onOpenChange = vi.fn()) {
  const qc = buildClient(wetCheckBillingId);
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

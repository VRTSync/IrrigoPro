/**
 * wet-check-billings-parity.test.tsx (Task #1008 — Slice 3)
 *
 * Parity tests for the WetCheckBillings list page:
 *   1. Status pill chrome parity — WetCheckBillingStatusBadge has data-testid="status-badge"
 *   2. Every rendered row has an overflow menu trigger
 *   3. "Edit labor rate" is hidden on invoiced (locked) WCBs
 *   4. "Edit labor rate" is hidden for field_tech role
 *   5. Clicking "Edit labor rate" calls onOpenModal with initialAction="labor-rate"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WetCheckBillings from "./wet-check-billings";
import type { ListRowAction } from "@/components/shared/list-row-overflow-menu";

// ── Mock ListRowOverflowMenu so we can inspect actions without Radix portals ──

let capturedActionsMap: Record<string, ListRowAction[]> = {};

vi.mock("@/components/shared/list-row-overflow-menu", () => ({
  ListRowOverflowMenu: ({
    actions,
    triggerTestId,
  }: {
    actions: ListRowAction[];
    triggerTestId?: string;
  }) => {
    const key = triggerTestId ?? "row-overflow-menu";
    capturedActionsMap[key] = actions;
    return (
      <div data-testid={key}>
        {actions
          .filter((a) => !a.hidden)
          .map((a, i) => (
            <button key={i} onClick={a.onClick} data-label={a.label}>
              {a.label}
            </button>
          ))}
      </div>
    );
  },
}));

// ── Mock modal ────────────────────────────────────────────────────────────────

vi.mock("@/components/wet-check-billings/wet-check-billing-view-modal", () => ({
  WetCheckBillingViewModal: ({
    open,
    wetCheckBillingId,
    initialAction,
  }: {
    open: boolean;
    wetCheckBillingId: number;
    initialAction?: string;
  }) =>
    open ? (
      <div
        data-testid={`modal-open-${wetCheckBillingId}`}
        data-initial-action={initialAction ?? ""}
      >
        Modal Open
      </div>
    ) : null,
}));

// ── Mock wouter ────────────────────────────────────────────────────────────────

vi.mock("wouter", async (importActual) => {
  const actual = await importActual<typeof import("wouter")>();
  return {
    ...actual,
    Link: ({ href, children, onClick, ...rest }: any) => (
      <a href={href} onClick={onClick} {...rest}>
        {children}
      </a>
    ),
  };
});

// ── safeStorage — controlled by mockRole ──────────────────────────────────────

let mockRole = "billing_manager";

vi.mock("@/utils/safeStorage", () => ({
  safeGet: (key: string) => {
    if (key === "user") return JSON.stringify({ id: 1, role: mockRole });
    return null;
  },
  safeSet: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWcb(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    billingNumber: "WCB-001",
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

const UNLOCKED_ROW = makeWcb({ id: 1, status: "submitted", invoiceId: null });
const INVOICED_ROW = makeWcb({ id: 2, status: "billed", invoiceId: 99, wetCheckId: 56 });

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildClient(data: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-check-billings"], data);
  return qc;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function actionsForRow(id: number) {
  return capturedActionsMap[`wcb-overflow-menu-${id}`] ?? [];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WetCheckBillings parity (Task #1008)", () => {
  beforeEach(() => {
    mockRole = "billing_manager";
    capturedActionsMap = {};
  });

  it("status badges have data-testid='status-badge'", () => {
    const qc = buildClient([UNLOCKED_ROW]);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("every rendered row has an overflow menu trigger", () => {
    const qc = buildClient([UNLOCKED_ROW, INVOICED_ROW]);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });
    expect(screen.getByTestId("wcb-overflow-menu-1")).toBeDefined();
    expect(screen.getByTestId("wcb-overflow-menu-2")).toBeDefined();
  });

  it("Edit labor rate action is hidden on invoiced (locked) WCBs", () => {
    mockRole = "billing_manager";
    const qc = buildClient([INVOICED_ROW]);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    const actions = actionsForRow(2);
    const editLaborRate = actions.find((a) => a.label === "Edit labor rate");
    // hidden should be true for a locked (invoiced) WCB
    expect(editLaborRate?.hidden).toBe(true);
  });

  it("Edit labor rate action is hidden for field_tech role", () => {
    mockRole = "field_tech";
    const qc = buildClient([UNLOCKED_ROW]);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    const actions = actionsForRow(1);
    const editLaborRate = actions.find((a) => a.label === "Edit labor rate");
    expect(editLaborRate?.hidden).toBe(true);
  });

  it("clicking Edit labor rate opens modal with initialAction='labor-rate'", () => {
    mockRole = "billing_manager";
    const qc = buildClient([UNLOCKED_ROW]);
    render(<WetCheckBillings />, { wrapper: wrapper(qc) });

    // Click the rendered (visible) Edit labor rate button in the mocked overflow menu
    const editBtn = screen.getByText("Edit labor rate");
    fireEvent.click(editBtn);

    const modal = screen.getByTestId("modal-open-1");
    expect(modal).toBeDefined();
    expect(modal.getAttribute("data-initial-action")).toBe("labor-rate");
  });
});

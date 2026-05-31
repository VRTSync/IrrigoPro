/**
 * zone-labor-edit-inline.test.tsx (Task #1027)
 *
 * Six test cases for ZoneLaborEditInline:
 *   1. Read-only row rendered when canEdit=false
 *   2. Pencil button rendered when canEdit=true (non-editing state)
 *   3. Click pencil opens inline form (Save + Cancel appear)
 *   4. Submit fires PATCH /api/wet-check-billings/:id/zone-labor
 *   5. Manual badge and reset link appear when manuallySet=true
 *   6. Reset link fires POST /api/wet-check-billings/:id/zone-labor/reset
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZoneLaborEditInline } from "./zone-labor-edit-inline";

// ── Mock apiRequest ────────────────────────────────────────────────────────────

const mockApiRequest = vi.fn(() => Promise.resolve({}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: any[]) => mockApiRequest(...args),
  queryClient: { invalidateQueries: vi.fn() },
}));

// ── Mock useToast ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// ── Mock LaborHoursStepper as a plain number input ────────────────────────────

vi.mock("@/components/ui/labor-hours-stepper", () => ({
  LaborHoursStepper: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="labor-hours-stepper"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  ),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderInline(overrides: Partial<{
  wcbId: number;
  zoneRecordId: number;
  valueHours: string;
  manuallySet: boolean;
  laborRate: string;
  canEdit: boolean;
}> = {}) {
  const props = {
    wcbId: 42,
    zoneRecordId: 7,
    valueHours: "1.50",
    manuallySet: false,
    laborRate: "80.00",
    canEdit: true,
    ...overrides,
  };
  return render(
    <QueryClientProvider client={buildQc()}>
      <ZoneLaborEditInline {...props} />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ZoneLaborEditInline", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValue({});
  });

  it("1. renders read-only row (zone-labor-readonly-*) when canEdit=false", () => {
    renderInline({ canEdit: false, zoneRecordId: 7 });
    expect(screen.getByTestId("zone-labor-readonly-7")).toBeInTheDocument();
    expect(screen.queryByTestId("zone-labor-pencil-7")).not.toBeInTheDocument();
  });

  it("2. renders pencil button (zone-labor-pencil-*) when canEdit=true", () => {
    renderInline({ canEdit: true, zoneRecordId: 7 });
    expect(screen.getByTestId("zone-labor-row-7")).toBeInTheDocument();
    expect(screen.getByTestId("zone-labor-pencil-7")).toBeInTheDocument();
  });

  it("3. clicking pencil opens inline form with Save and Cancel buttons", () => {
    renderInline({ canEdit: true, zoneRecordId: 7 });
    fireEvent.click(screen.getByTestId("zone-labor-pencil-7"));
    expect(screen.getByTestId("zone-labor-save-7")).toBeInTheDocument();
    expect(screen.getByTestId("zone-labor-cancel-7")).toBeInTheDocument();
    expect(screen.getByTestId("labor-hours-stepper")).toBeInTheDocument();
  });

  it("4. clicking Save fires PATCH /api/wet-check-billings/:id/zone-labor", async () => {
    renderInline({ canEdit: true, wcbId: 42, zoneRecordId: 7, valueHours: "1.50" });
    fireEvent.click(screen.getByTestId("zone-labor-pencil-7"));

    const stepper = screen.getByTestId("labor-hours-stepper");
    fireEvent.change(stepper, { target: { value: "2.00" } });

    fireEvent.click(screen.getByTestId("zone-labor-save-7"));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/api/wet-check-billings/42/zone-labor",
        "PATCH",
        { zoneRecordId: 7, repairLaborHours: "2.00" },
      );
    });
  });

  it("5. manual badge and reset-to-auto link appear when manuallySet=true", () => {
    renderInline({ canEdit: true, zoneRecordId: 7, manuallySet: true });
    expect(screen.getByText("manual")).toBeInTheDocument();
    expect(screen.getByTestId("zone-labor-reset-7")).toBeInTheDocument();
    expect(screen.getByTestId("zone-labor-reset-7")).toHaveTextContent("Reset to auto");
  });

  it("6. reset-to-auto link fires POST /api/wet-check-billings/:id/zone-labor/reset", async () => {
    renderInline({ canEdit: true, wcbId: 42, zoneRecordId: 7, manuallySet: true });
    fireEvent.click(screen.getByTestId("zone-labor-reset-7"));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/api/wet-check-billings/42/zone-labor/reset",
        "POST",
        { zoneRecordId: 7 },
      );
    });
  });
});

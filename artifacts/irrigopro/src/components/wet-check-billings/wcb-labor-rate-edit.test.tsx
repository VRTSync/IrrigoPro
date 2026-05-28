/**
 * wcb-labor-rate-edit.test.tsx (Task #977)
 *
 * Unit tests for WcbLaborRateEdit component.
 *
 * Scenarios:
 *   1. Submit fires correct PATCH with { newRate }
 *   2. onClose called on successful save
 *   3. Error indicator renders on mutation failure
 *   4. Cancel calls onClose without firing mutation
 *   5. Rejects rate above 1000 with inline error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WcbLaborRateEdit } from "./wcb-labor-rate-edit";

// ── Mock apiRequest ────────────────────────────────────────────────────────────

const mockApiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderEdit(props: Partial<React.ComponentProps<typeof WcbLaborRateEdit>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const defaults = {
    wcbId: 5,
    currentRate: "80.00",
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    ...props,
  };
  const utils = render(
    <QueryClientProvider client={qc}>
      <WcbLaborRateEdit {...defaults} />
    </QueryClientProvider>,
  );
  return { ...utils, ...defaults };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WcbLaborRateEdit (Task #977)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with the current rate pre-filled", () => {
    renderEdit({ currentRate: "80.00" });
    const input = screen.getByTestId("wcb-labor-rate-input") as HTMLInputElement;
    expect(input.value).toBe("80.00");
  });

  it("fires PATCH to correct URL with newRate on save", async () => {
    mockApiRequest.mockResolvedValueOnce({ id: 5, laborRate: "90.00" });
    const onSuccess = vi.fn();
    renderEdit({ wcbId: 5, currentRate: "80.00", onSuccess });
    const input = screen.getByTestId("wcb-labor-rate-input");
    fireEvent.change(input, { target: { value: "90" } });
    fireEvent.click(screen.getByTestId("wcb-labor-rate-save"));
    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "/api/wet-check-billings/5/labor-rate",
        "PATCH",
        { newRate: 90 },
      ),
    );
    expect(onSuccess).toHaveBeenCalledWith({ id: 5, laborRate: "90.00" });
  });

  it("calls onClose on successful save", async () => {
    mockApiRequest.mockResolvedValueOnce({ id: 5, laborRate: "90.00" });
    const onClose = vi.fn();
    renderEdit({ wcbId: 5, onClose });
    fireEvent.click(screen.getByTestId("wcb-labor-rate-save"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows error indicator when mutation fails", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Server error"));
    renderEdit({ wcbId: 5 });
    fireEvent.click(screen.getByTestId("wcb-labor-rate-save"));
    await waitFor(() =>
      expect(screen.getByTestId("wcb-labor-rate-error")).toBeTruthy(),
    );
  });

  it("calls onClose on cancel without firing mutation", () => {
    const onClose = vi.fn();
    renderEdit({ onClose });
    fireEvent.click(screen.getByTestId("wcb-labor-rate-cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("shows inline validation error for rate above 1000", () => {
    renderEdit();
    const input = screen.getByTestId("wcb-labor-rate-input");
    fireEvent.change(input, { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("wcb-labor-rate-save"));
    expect(screen.getByTestId("wcb-labor-rate-error")).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("shows inline validation error for negative rate", () => {
    renderEdit();
    const input = screen.getByTestId("wcb-labor-rate-input");
    fireEvent.change(input, { target: { value: "-10" } });
    fireEvent.click(screen.getByTestId("wcb-labor-rate-save"));
    expect(screen.getByTestId("wcb-labor-rate-error")).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});

import { createElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/queryClient";
import { usePaymentStatusSync } from "./use-payment-status-sync";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

const mockRequest = vi.mocked(apiRequest);

function mountSync(autoRun: boolean) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client: queryClient, children });
  return { ...renderHook(() => usePaymentStatusSync({ autoRun }), { wrapper }), invalidate };
}

describe("usePaymentStatusSync", () => {
  beforeEach(() => {
    mockRequest.mockReset().mockResolvedValue({});
    toast.mockReset();
  });

  it("auto-runs once on mount, invalidates invoices, and stays silent when nothing changed", async () => {
    const { result, rerender, invalidate } = mountSync(true);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/invoices"] }));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    rerender();
    expect(mockRequest.mock.calls).toEqual([["/api/invoices/sync-payment-status", "POST"]]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not auto-run when disabled", async () => {
    await act(async () => { mountSync(false); });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("keeps throttled auto-runs silent and toasts when the user tries again", async () => {
    mockRequest.mockResolvedValue({ throttled: true, nextAllowedIn: 91 });
    const { result } = mountSync(true);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(toast).not.toHaveBeenCalled();

    act(() => result.current.runNow());
    await waitFor(() => expect(toast.mock.calls).toEqual([[{
      title: "Recently synced",
      description: "Next refresh available in 2 minutes.",
    }]]));
  });

  it("confirms a manual refresh even when nothing changed", async () => {
    const { result } = mountSync(false);
    act(() => result.current.runNow());
    await waitFor(() => expect(toast.mock.calls).toEqual([[{
      title: "Payment status refreshed from QuickBooks",
      description: "All invoices are up to date",
    }]]));
  });

  it("reports voids from an auto-run even without paid or partial updates", async () => {
    mockRequest.mockResolvedValue({ qbVoided: 1 });
    mountSync(true);
    await waitFor(() => expect(toast.mock.calls).toEqual([[{
      title: "Payment status refreshed from QuickBooks",
      description: "All invoices are up to date. 1 voided in QuickBooks — review required",
    }]]));
  });

  it("keeps auto-run errors silent but reports manual failures", async () => {
    mockRequest.mockRejectedValue(new Error("Connection lost"));
    const { result } = mountSync(true);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(toast).not.toHaveBeenCalled();

    act(() => result.current.runNow());
    await waitFor(() => expect(toast.mock.calls).toEqual([[{
      title: "Payment sync failed",
      description: "Connection lost",
      variant: "destructive",
    }]]));
  });
});

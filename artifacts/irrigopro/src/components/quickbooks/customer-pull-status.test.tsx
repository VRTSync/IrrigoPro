import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomerPullStatus, QuickBooksIntegration } from "./quickbooks-integration";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: mocks.apiRequest,
}));
vi.mock("wouter", () => ({ useSearch: () => "" }));

const key = ["/api/quickbooks/customer-pull-status"];
const empty: { intervalMinutes: number; lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastError: string | null; lastSummary: unknown } =
  { intervalMinutes: 15, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastSummary: null };
function setup(data = empty, queryFn = async () => data) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity, queryFn,
  } } });
  client.setQueryData(key, data);
  return { client, ui: <QueryClientProvider client={client}><CustomerPullStatus /></QueryClientProvider> };
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); });
describe("CustomerPullStatus", () => {
  it("shows automatic cadence and relative last success", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    const h = setup({ ...empty, lastSuccessAt: "2026-11-05T11:57:00Z" });
    render(h.ui);
    expect(screen.getByText("Customers sync from QuickBooks automatically every 15 minutes.")).toBeTruthy();
    expect(screen.getByText("Last synced 3 minutes ago")).toBeTruthy();
    h.client.clear();
  });
  it("renders exact red error copy alongside the last good sync", () => {
    const h = setup({ ...empty, lastError: "QuickBooks authorization failed; reconnect QuickBooks." });
    render(h.ui);
    expect(screen.getByText("Last attempt failed: QuickBooks authorization failed; reconnect QuickBooks.")
      .className).toContain("text-red-700");
    h.client.clear();
  });
  it("shows Not synced yet with null state", () => {
    const h = setup(); render(h.ui);
    expect(screen.getByText("Not synced yet")).toBeTruthy();
    expect(h.client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(1);
    h.client.clear();
  });
  it("polls the status endpoint at 60 seconds", async () => {
    vi.useFakeTimers();
    const queryFn = vi.fn(async () => empty);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn } } });
    client.setQueryData(key, empty);
    render(<QueryClientProvider client={client}><CustomerPullStatus /></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const initialCalls = queryFn.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(59_998); });
    expect(queryFn).toHaveBeenCalledTimes(initialCalls);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(queryFn).toHaveBeenCalledTimes(initialCalls + 1);
    client.clear();
  });
});

describe("existing QuickBooks card's real sync mutation", () => {
  function card(queryFn?: () => Promise<typeof empty>) {
    localStorage.setItem("user", JSON.stringify({ role: "company_admin", companyId: 7 }));
    const h = setup(empty, queryFn);
    h.client.setQueryData(["/api/quickbooks/connection"], { isConnected: true, companyId: "7",
      companyName: "Fixture", connectionStatus: "connected", lastSync: null });
    h.client.setQueryData(["/api/estimates"], []);
    h.client.setQueryData(["/api/quickbooks/health"], {});
    h.client.setQueryData(["/api/quickbooks/connection/stale"], {});
    render(<QueryClientProvider client={h.client}><QuickBooksIntegration /></QueryClientProvider>);
    return h;
  }
  it("Sync now immediately invalidates status as well as both customer queries", async () => {
    const statusRead = vi.fn(async () => ({ ...empty, lastSuccessAt: new Date().toISOString() }));
    const h = card(statusRead);
    const invalidation = vi.spyOn(h.client, "invalidateQueries");
    mocks.apiRequest.mockResolvedValue({ message: "1 added, 0 updated, 0 unchanged" });
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(invalidation).toHaveBeenCalledWith({ queryKey: key }));
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["/api/customers"] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["/api/customers/billing-preview"] });
    expect(mocks.apiRequest).toHaveBeenCalledWith("/api/quickbooks/sync-customers", "POST");
    await waitFor(() => expect(screen.getByText("Last synced less than a minute ago")).toBeTruthy());
    expect(statusRead).toHaveBeenCalled();
    h.client.clear();
  });
  it("displays the server's exact busy wording in the actual mutation toast", async () => {
    const h = card();
    const message = "A customer sync is already running. Try again in a minute.";
    mocks.apiRequest.mockRejectedValue(new Error(`409: ${JSON.stringify({ success: false, message })}`));
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Sync Failed", description: message, variant: "destructive",
    }));
    h.client.clear();
  });
});

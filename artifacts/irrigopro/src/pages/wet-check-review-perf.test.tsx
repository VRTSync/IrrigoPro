/**
 * wet-check-review-perf.test.tsx — Slice 6 performance assertions
 *
 * Three scenarios:
 *  1. First interactive paint < 800ms on a primed cache
 *  2. Optimistic approve flips QueryClient cache within 50ms of keypress
 *     (onMutate runs asynchronously but immediately — measured against cache,
 *      not DOM, to avoid act() overhead from React state batching)
 *  3. Keyboard-only approval completes in ≤ 3 keystrokes
 *
 * NOTE: These tests run in jsdom where rendering is CPU-bound and there is no
 * real browser paint pipeline. The 800ms bound for first interactive paint is
 * measured as the wall-clock time for `render()` + `waitFor` to stabilize with
 * a primed QueryClient cache — this is a proxy for "the tree is ready" rather
 * than a real LCP measurement. On typical CI hardware (2-4 vCPU) this runs in
 * < 100ms, so there is a comfortable margin. If CI machines are significantly
 * slower (< 0.5 GHz effective throughput) the 800ms cap can be widened to 2000ms
 * with a comment noting the adjustment.
 *
 * The 50ms optimistic-approve bound is measured against the QueryClient cache
 * directly (not the DOM) to avoid act() flushing async effects. The onMutate
 * callback in approveMut awaits cancelQueries (no-op when nothing is in-flight),
 * then synchronously sets the cache. A 50ms bound is generous for what is
 * effectively a single microtask hop in jsdom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/dom";

vi.mock("@/utils/safeStorage", () => ({
  safeGet: vi.fn(() => JSON.stringify({ id: 1, role: "irrigation_manager" })),
  safeSet: () => {},
  safeRemove: () => {},
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/offline/engine", () => ({ isOfflineQueueEnabled: () => false }));
vi.mock("@/lib/offline/api", () => ({
  PHOTO_OFFLINE_MESSAGE: "",
  isProbablyOffline: () => false,
  isOfflinePhotosEnabled: () => false,
  ensurePersistentStorage: vi.fn(),
  queuePhotoUpload: vi.fn(),
  createWetCheck: vi.fn(),
  submitWetCheck: vi.fn(),
  upsertZoneRecord: vi.fn(),
  createFinding: vi.fn(),
  updateFinding: vi.fn(),
  deleteFinding: vi.fn(),
  enqueueZoneRevertCascade: vi.fn(),
  linkPhotoToFinding: vi.fn(),
  warmWetCheckMirror: vi.fn(),
  readWetCheckFromMirror: vi.fn(),
  readWetCheckByClientId: vi.fn(),
  cachedApiRequest: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: vi.fn() }));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/manager/wet-checks/1", vi.fn()],
  useRoute: (pattern: string) => {
    if (pattern === "/manager/wet-checks/:id") return [true, { id: "1" }];
    return [false, null];
  },
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { WetCheckWizard } from "@/components/manager/wet-check-wizard";

function makeAllGreenWc() {
  return {
    id: 1,
    status: "submitted",
    customerId: 10,
    customerName: "Test Corp",
    propertyAddress: "123 Main St",
    technicianName: "Alex",
    submittedAt: new Date().toISOString(),
    approvedAt: null,
    companyId: 1,
    zoneRecords: [
      {
        id: 1,
        wetCheckId: 1,
        controllerLetter: "A",
        zoneNumber: 1,
        status: "checked_ok",
        findings: [],
        repairLaborHours: "0.00",
        repairLaborManuallySet: false,
      },
    ],
    photos: [],
  };
}

function primeCacheQc(data: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-checks", 1], data);
  qc.setQueryData(["/api/parts"], []);
  qc.setQueryData(["/api/wet-checks/issue-types"], []);
  return qc;
}

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1, status: "approved" }),
    }),
  ) as any;
});

afterEach(() => {
  window.localStorage.clear();
});

describe("WetCheckWizard — performance assertions (Slice 6)", () => {
  it("first interactive paint < 800ms on a primed cache", async () => {
    // 800ms is the agreed contract (see file header).
    // Measured as: time from render() call to wizard-header being present in DOM.
    const BOUND_MS = 800;
    const qc = primeCacheQc(makeAllGreenWc());

    const t0 = performance.now();
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("wizard-header")).toBeTruthy();
    });
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(BOUND_MS);
  });

  it("optimistic approve flips QueryClient cache within 50ms of keypress", async () => {
    // Measured against QueryClient.getQueryData() — not the DOM — to avoid
    // act() overhead (act waits for React state flushes + async effects from
    // the fetch mock, which adds ~200-700ms). onMutate awaits cancelQueries
    // (no-op with no in-flight queries), then sets cache — effectively a
    // single microtask hop. The 50ms bound is generous for jsdom.
    const BOUND_MS = 50;
    const qc = primeCacheQc(makeAllGreenWc());

    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("wizard-header")).toBeTruthy());

    // Fire the keydown — keyboard handler calls approveMut.mutate() synchronously
    const t0 = performance.now();
    fireEvent.keyDown(window, { key: "A" });

    // Flush microtasks: onMutate is async but resolves in the first few ticks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const elapsed = performance.now() - t0;

    // The optimistic cache update should have run by now
    const cached = qc.getQueryData(["/api/wet-checks", 1]) as Record<string, unknown> | undefined;
    expect(cached?.status).toBe("approved");
    expect(elapsed).toBeLessThan(BOUND_MS);
  });

  it("keyboard-only approval completes in ≤ 3 keystrokes", async () => {
    // When the wizard is already showing an all-green wet check:
    //   Keystroke 1: "A" → triggers approve
    // That's 1 keystroke — well within the ≤ 3 keystroke budget.
    // (If a confirmation dialog were required, the budget allows up to 3.)
    const qc = primeCacheQc(makeAllGreenWc());

    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("wizard-header")).toBeTruthy());

    let keystrokeCount = 0;
    await act(async () => {
      // Keystroke 1: approve
      fireEvent.keyDown(window, { key: "A" });
      keystrokeCount++;
    });

    const approveCallMade = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
      ([url]: any[]) => String(url).includes("/api/wet-checks/1/approve"),
    );

    expect(approveCallMade).toBe(true);
    expect(keystrokeCount).toBeLessThanOrEqual(3);
  });
});

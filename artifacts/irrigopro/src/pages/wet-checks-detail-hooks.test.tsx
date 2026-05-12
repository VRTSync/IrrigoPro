// Task #561 — regression for the WetCheckDetail "rendered more hooks
// than during the previous render" crash (React error #310).
//
// Before the fix, `WetCheckDetail` returned early on
// `if (isLoading || !wc)` and then called five additional hooks
// (`useState`, two `useRef`s, two `useEffect`s) ~130 lines below the
// guard, for the Task #517 "jump to next needs-decision" feature.
// On the first render `wc` was `undefined` so only the hooks above
// the guard ran; on the next render — often synchronous when the
// IDB mirror has the wet check cached — `wc` resolved and React
// suddenly saw five extra hooks, triggering error #310 and taking
// down the wet-check detail screen via the global error boundary.
//
// The fix hoists all five hooks above the loading guard. This test
// drives `useQuery` through the exact `{ data: undefined,
// isLoading: true } → { data: <wetCheck>, isLoading: false }`
// transition that crashed in production and asserts:
//   1. The component does not throw.
//   2. The post-load UI renders (proof we got past the guard with a
//      stable hook order).

import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Same module mocks used by the other wet-check tests so the heavy
// offline / photo-prep stack doesn't have to bootstrap.
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
  hasPendingMutationsForWetCheck: vi.fn(() => Promise.resolve(false)),
  offlineSubmitWetCheck: vi.fn(),
}));
vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/utils/safeStorage", () => ({
  safeGet: () => null,
  safeSet: () => {},
  safeRemove: () => {},
}));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
  useSyncEngineState: () => ({ online: true, queued: 0, isFlushing: false }),
}));

describe("Task #561 — WetCheckDetail hook order is stable across the wc undefined → defined transition", () => {
  it("does not throw React error #310 when the wet-check query resolves on a re-render and the loaded UI renders", async () => {
    const mod: any = await import("./wet-checks");
    const Page = mod.default;
    expect(typeof Page).toBe("function");

    // Wet check fixture with a "complete but missing part" finding so
    // the Task #517 feature is exercised on the first non-loading
    // render — that path is what introduced the late hooks.
    const wc: any = {
      id: 561,
      clientId: "wc-561",
      customerId: 1,
      customerName: "Acme",
      propertyAddress: "1 Main",
      status: "in_progress",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      zoneRecords: [
        {
          id: 1,
          clientId: "zr-1",
          wetCheckId: 561,
          controllerLetter: "A",
          zoneNumber: 1,
          status: "checked_with_issues",
          ranSuccessfully: false,
          notes: null,
          checkedAt: new Date().toISOString(),
          markedCompleteAt: null,
          findings: [
            {
              id: 9001,
              clientId: "f-9001",
              zoneRecordId: 1,
              resolution: "repaired_in_field",
              partId: null,
              noPartNeeded: false,
              quantity: 1,
              laborHours: "0",
              notes: "",
            },
          ],
        },
      ],
      photos: [],
    };

    // The query client default queryFn drives the wet-check query.
    // The first call rejects immediately so the component commits its
    // loading branch with `wc === undefined`; we then seed the cache
    // with the loaded wet check and re-render to drive the
    // undefined → defined transition that crashed in production
    // (often synchronous via the IDB-mirror fast path).
    let call = 0;
    const queryFn = vi.fn(() => {
      call += 1;
      if (call === 1) {
        return Promise.reject(new Error("first-load placeholder"));
      }
      return Promise.resolve(wc);
    });

    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, queryFn },
      },
    });

    const { Router, Route, Switch } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { hook } = memoryLocation({ path: "/wet-checks/561" });

    // Pre-seed the cache between mounts so the second render path
    // sees `wc` without invoking the queryFn again. This reproduces
    // the exact loading → loaded transition that crashed.
    let view: ReturnType<typeof render>;
    expect(() => {
      view = render(
        <QueryClientProvider client={qc}>
          <Router hook={hook}>
            <Switch>
              <Route path="/wet-checks/:id" component={Page as any} />
            </Switch>
          </Router>
        </QueryClientProvider>,
      );
    }).not.toThrow();

    // Loading spinner is up. Now warm the cache with the loaded wet
    // check and re-render to drive the undefined → defined transition.
    qc.setQueryData(["/api/wet-checks", 561], wc);
    expect(() => {
      view!.rerender(
        <QueryClientProvider client={qc}>
          <Router hook={hook}>
            <Switch>
              <Route path="/wet-checks/:id" component={Page as any} />
            </Switch>
          </Router>
        </QueryClientProvider>,
      );
    }).not.toThrow();

    // Loaded UI is on screen. The submit row is the most reliable
    // post-guard anchor — proving the component got past the early
    // return without React tearing down the tree on a hook-order
    // mismatch.
    await waitFor(() => {
      expect(screen.getAllByText(/Acme/).length).toBeGreaterThan(0);
    });
  });
});

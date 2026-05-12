// Task #540 — regression for the wet-check page crashing with
// `TypeError: Cannot read properties of null (reading 'length')` when
// the cached/server payload had `wc.zoneRecords === null`. The fix is
// a shared `asArray()` helper plus a `useArrayQuery<T>` wrapper that
// pipes list responses through `asArray` via `select`. This file
// covers three angles:
//
//  1. The helper itself collapses null/undefined to [].
//  2. A static-source guard against direct `wc.zoneRecords.<method>` /
//     `wc.photos.<method>` / `previous.zoneRecords.<method>` reads in
//     the wet-checks page so the previous crash pattern can't sneak
//     back in.
//  3. Runtime renders that exercise the previously-crashing payloads:
//     - `useArrayQuery` returning `null` from a 401 `returnNull`
//       queryFn yields `[]` (not null), so consumers can `.map` it.
//     - `ZoneScreen` mounts cleanly with `zoneRecord.findings = null`,
//       which was the exact production crash payload.

import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const safeStorageState: { user: string | null } = { user: null };
vi.mock("@/utils/safeStorage", () => ({
  safeGet: (k: string) => (k === "user" ? safeStorageState.user : null),
  safeSet: () => {},
  safeRemove: () => {},
}));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
}));

import {
  apiRequest,
  asArray,
  clearUnauthenticatedRead,
  markUnauthenticatedRead,
  useArrayQuery,
} from "@/lib/queryClient";

describe("Task #540 — null-safe array reads", () => {
  it("asArray() returns [] for null/undefined and the original array otherwise", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    const xs = [1, 2, 3];
    expect(asArray(xs)).toBe(xs);
    // Non-array values (defensive) coerce to []
    expect(asArray("nope" as unknown as unknown[])).toEqual([]);
  });

  it("useArrayQuery() collapses a `null` payload (the 401 returnNull path) to []", async () => {
    // Mirror the global queryClient default of `getQueryFn({ on401:
    // "returnNull" })` by returning `null` from the queryFn — the
    // production crash payload for an unauthenticated list fetch.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useArrayQuery<{ id: number }>({
          queryKey: ["/api/test/null-list"],
          queryFn: async () => null as unknown as { id: number }[],
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The crash repro: `.map` on a null payload throws. With
    // useArrayQuery, `data` is guaranteed `T[]`, so this is safe.
    expect(result.current.data).toEqual([]);
    expect(() => result.current.data.map((x) => x.id)).not.toThrow();
    expect(result.current.data.length).toBe(0);
  });

  it("useArrayQuery() preserves a real array payload unchanged", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const rows = [{ id: 1 }, { id: 2 }];
    const { result } = renderHook(
      () =>
        useArrayQuery<{ id: number }>({
          queryKey: ["/api/test/list"],
          queryFn: async () => rows,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
  });

  it("wet-checks.tsx no longer reads .length / .map / .filter directly on potentially-null nested arrays", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "wet-checks.tsx"),
      "utf8",
    );
    // Static guard: any direct `wc.zoneRecords.<arrayMethod>` or
    // `wc.photos.<arrayMethod>` regresses the fix. The safe form goes
    // through the locally-extracted `wcZoneRecords` / `wcPhotos`
    // (already wrapped with asArray) or wraps the read inline.
    const unsafeWcZone =
      /\bwc\.zoneRecords\.(map|filter|some|every|length|flatMap|forEach|reduce|find)\b/.exec(
        file,
      );
    expect(
      unsafeWcZone,
      `Unsafe wc.zoneRecords access: ${unsafeWcZone?.[0]}`,
    ).toBeNull();
    const unsafeWcPhotos =
      /\bwc\.photos\.(map|filter|some|every|length|flatMap|forEach|reduce|find)\b/.exec(
        file,
      );
    expect(
      unsafeWcPhotos,
      `Unsafe wc.photos access: ${unsafeWcPhotos?.[0]}`,
    ).toBeNull();
    // Same guard for `previous.zoneRecords` inside the optimistic
    // mutation handlers — those crashed too on null payloads.
    const unsafePrevZone =
      /\bprevious\.zoneRecords\.(map|filter|some|every|length|flatMap)\b/.exec(
        file,
      );
    expect(
      unsafePrevZone,
      `Unsafe previous.zoneRecords access: ${unsafePrevZone?.[0]}`,
    ).toBeNull();
  });

  it("WetCheckDetail mounts with `wc.zoneRecords = null` without throwing (the original incident payload)", async () => {
    const mod: any = await import("./wet-checks");
    const WetCheckDetail = mod.WetCheckDetail ?? mod.__test__WetCheckDetail;
    // WetCheckDetail isn't exported; the default export `WetChecksPage`
    // routes to it. We seed the cache so the queryFn isn't fired and
    // mount the page through the default export.
    const Page = mod.default;
    expect(typeof Page).toBe("function");
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wc: any = {
      id: 99,
      clientId: "wc-99",
      customerId: 1,
      customerName: "Acme",
      propertyAddress: "123 Main",
      status: "in_progress",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Deliberately null — the original crash payload.
      zoneRecords: null,
      photos: null,
    };
    qc.setQueryData(["/api/wet-checks", 99], wc);
    qc.setQueryData(["/api/wet-checks", 99, "submit-preview"], null);

    // Route the page to the detail view by id.
    const { Router, Route, Switch } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { hook } = memoryLocation({ path: "/wet-checks/99" });

    expect(() => {
      render(
        <QueryClientProvider client={qc}>
          <Router hook={hook}>
            <Switch>
              <Route path="/wet-checks/:id" component={Page as any} />
            </Switch>
          </Router>
        </QueryClientProvider>,
      );
    }).not.toThrow();
    // Smoke: anything from WetCheckDetail rendered (controller grid /
    // header / submit area). The proof is no throw on the null
    // `zoneRecords` traversal.
  });

  // Task #556 — `WetCheckList` must not silently render "No wet checks
  // yet." when reads are coming back 401. The global re-login signal
  // (markUnauthenticatedRead) flips the empty state into a "session
  // expired — sign in" affordance instead.
  it("WetCheckList shows the re-login affordance, not 'No wet checks yet.', when reads are 401-ing", async () => {
    const mod: any = await import("./wet-checks");
    const Page = mod.default;
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          // Mirror the production 401 returnNull path.
          queryFn: async () => null as unknown,
        },
      },
    });
    markUnauthenticatedRead();
    try {
      const { Router, Route, Switch } = await import("wouter");
      const { memoryLocation } = await import("wouter/memory-location");
      const { hook } = memoryLocation({ path: "/wet-checks" });
      render(
        <QueryClientProvider client={qc}>
          <Router hook={hook}>
            <Switch>
              <Route path="/wet-checks" component={Page as any} />
            </Switch>
          </Router>
        </QueryClientProvider>,
      );
      // Re-login affordance is shown…
      const banner = await screen.findByTestId("session-expired-empty");
      expect(banner).toBeTruthy();
      // …and the misleading empty-state copy is NOT.
      expect(screen.queryByText(/No wet checks yet\./i)).toBeNull();
    } finally {
      clearUnauthenticatedRead();
    }
  });

  it("WetCheckList still shows 'No wet checks yet.' for a genuinely-empty (200 []) response", async () => {
    const mod: any = await import("./wet-checks");
    const Page = mod.default;
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          queryFn: async () => [] as unknown[],
        },
      },
    });
    // Be defensive in case a previous test left it set.
    clearUnauthenticatedRead();
    const { Router, Route, Switch } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { hook } = memoryLocation({ path: "/wet-checks" });
    render(
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <Switch>
            <Route path="/wet-checks" component={Page as any} />
          </Switch>
        </Router>
      </QueryClientProvider>,
    );
    const empty = await screen.findByText(/No wet checks yet\./i);
    expect(empty).toBeTruthy();
    expect(screen.queryByTestId("session-expired-empty")).toBeNull();
  });

  // Task #556 — apiRequest must trip the unauthenticated-reads signal
  // on 401 too. Many field-tech screens (field-tech-dashboard,
  // notification-system, navigation profile fetch) use custom
  // queryFns built on apiRequest rather than the default getQueryFn,
  // so the signal has to be marked at the apiRequest layer or the
  // global re-login banner never fires for those screens.
  it("apiRequest() flips the unauth signal on 401 when a user is logged in", async () => {
    clearUnauthenticatedRead();
    safeStorageState.user = JSON.stringify({ id: 7, role: "field_tech" });
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;
    try {
      const { useUnauthenticatedReads } = await import("@/lib/queryClient");
      const { result } = renderHook(() => useUnauthenticatedReads());
      expect(result.current).toBe(false);
      await expect(apiRequest("/api/work-orders", "GET")).rejects.toBeTruthy();
      await waitFor(() => expect(result.current).toBe(true));
    } finally {
      global.fetch = realFetch;
      safeStorageState.user = null;
      clearUnauthenticatedRead();
    }
  });

  it("apiRequest() does NOT flip the unauth signal on 401 when no user is logged in", async () => {
    clearUnauthenticatedRead();
    safeStorageState.user = null;
    const realFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;
    try {
      const { useUnauthenticatedReads } = await import("@/lib/queryClient");
      const { result } = renderHook(() => useUnauthenticatedReads());
      await expect(apiRequest("/api/login", "POST", { u: "x" })).rejects.toBeTruthy();
      // Give any microtasks a chance to flush.
      await new Promise((r) => setTimeout(r, 10));
      expect(result.current).toBe(false);
    } finally {
      global.fetch = realFetch;
      clearUnauthenticatedRead();
    }
  });

  it("ZoneScreen renders cleanly with `zoneRecord.findings = null` (the production crash payload)", async () => {
    const mod: any = await import("./wet-checks");
    expect(typeof mod.ZoneScreen).toBe("function");
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const zoneRecord: any = {
      id: 7,
      clientId: "zr-7",
      wetCheckId: 1,
      controllerLetter: "A",
      zoneNumber: 1,
      status: "checked_with_issues",
      ranSuccessfully: false,
      notes: null,
      checkedAt: new Date().toISOString(),
      markedCompleteAt: null,
      // Deliberately null — the regression payload.
      findings: null,
    };
    const ZoneScreen = mod.ZoneScreen;
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ZoneScreen
          key="zone-A-1"
          wetCheckId={1}
          wetCheckClientId="wc-1"
          customerId={1}
          customerName="Acme"
          propertyAddress="123 Main"
          letter="A"
          zoneNumber={1}
          zoneCount={2}
          zoneRecord={zoneRecord}
          photos={[]}
          readOnly={false}
          onBack={() => {}}
          onAdvance={() => {}}
        />
      </QueryClientProvider>,
    );
    // Ran OK / Needs Work / Skip buttons are the proof the screen
    // didn't crash on the null `findings` traversal.
    expect(screen.getByTestId("btn-zone-yes")).toBeTruthy();
    expect(container).toBeTruthy();
  });
});

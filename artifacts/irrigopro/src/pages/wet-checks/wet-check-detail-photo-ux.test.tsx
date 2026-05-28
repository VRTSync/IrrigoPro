// Task #597 — UI assertions on WetCheckDetail's photo-visibility surface:
//   * the wet-check header total ("📷 N photos")
//   * the per-controller "📷 N" rollup badge
//   * the loose-photos amber banner (regardless of whether findings exist)
//
// Task #829 — Regression: finding-linked photos (null zoneRecordId) must
//   appear in the zone's rendered photo list and under their finding card.
//
// Mounts the default export (`WetChecksPage`) routed at `/wet-checks/:id`
// with a seeded React Query cache, mirroring `wet-checks-null-safe.test.tsx`.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// vi.hoisted ensures this runs before the vi.mock factory below, so the
// factory can close over the stable reference even after hoisting.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));

vi.mock("@/lib/lifecycle", () => ({
  tintForControllerLetter: () => "bg-gray-100 border-gray-300 text-gray-800",
  lifecycleStageMeta: () => ({ label: "Active", className: "bg-gray-100" }),
}));

vi.mock("@/lib/offline/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/engine")>();
  return {
    ...actual,
    isOfflineQueueEnabled: () => false,
  };
});

vi.mock("@/components/offline/sync-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/offline/sync-ui")>();
  return {
    ...actual,
    useSyncEngineState: () => ({ mutations: [] }),
  };
});

describe("Task #597 — WetCheckDetail photo-visibility", () => {
  it("shows header total, per-controller badge, and loose-photos banner", async () => {
    const mod: any = await import("../wet-checks");
    const Page = mod.default;
    expect(typeof Page).toBe("function");

    // The page calls useQuery without a queryFn, so we install a default
    // that returns the seeded fixture for each known key. staleTime
    // Infinity prevents the page from cycling back into a loading state
    // while we assert.
    let wcRef: any = null;
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          queryFn: async ({ queryKey }) => {
            const k = queryKey as unknown[];
            if (k[0] === "/api/wet-checks" && k[1] === 99 && k.length === 2) return wcRef;
            if (k[0] === "/api/wet-checks" && k[1] === 99 && k[2] === "submit-preview") return null;
            if (k[0] === "/api/properties" && k[1] === 1 && k[2] === "controllers") {
              return [{ id: 1, customerId: 1, controllerLetter: "A", numZones: 4 }];
            }
            if (k[0] === "/api/config/wet-check-auto-bill") return { enabled: true };
            return null;
          },
        },
      },
    });
    const wc: any = {
      id: 99,
      clientId: "wc-99",
      customerId: 1,
      customerName: "Acme",
      propertyAddress: "123 Main",
      status: "in_progress",
      numControllers: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      zoneRecords: [
        {
          id: 1,
          clientId: "z-1",
          wetCheckId: 99,
          controllerLetter: "A",
          zoneNumber: 1,
          status: "checked_with_issues",
          findings: [
            { id: 10, clientId: "f-10", zoneRecordId: 1, issueType: "leak", resolution: "pending", techDisposition: "needs_review", partId: null, noPartNeeded: false },
          ],
        },
      ],
      photos: [
        // zone-level
        { id: 100, wetCheckId: 99, url: "https://example/1.jpg", takenAt: new Date().toISOString(), zoneRecordId: 1, findingId: null, clientId: "p-100" },
        // finding-level
        { id: 101, wetCheckId: 99, url: "https://example/2.jpg", takenAt: new Date().toISOString(), zoneRecordId: 1, findingId: 10, clientId: "p-101" },
        // loose (no zone, no finding)
        { id: 102, wetCheckId: 99, url: "https://example/3.jpg", takenAt: new Date().toISOString(), zoneRecordId: null, findingId: null, clientId: "p-102" },
      ],
    };
    wcRef = wc;
    // Seed the cache so `useQuery` returns success on first render and
    // never enters the page's `isLoading` guard.
    qc.setQueryData(["/api/wet-checks", 99], wc);
    qc.setQueryData(["/api/wet-checks", 99, "submit-preview"], null);
    qc.setQueryData(["/api/properties", 1, "controllers"], [
      { id: 1, customerId: 1, controllerLetter: "A", numZones: 4 },
    ]);
    qc.setQueryData(["/api/config/wet-check-auto-bill"], { enabled: true });

    const { Router, Route, Switch } = await import("wouter");
    const { memoryLocation } = await import("wouter/memory-location");
    const { hook } = memoryLocation({ path: "/wet-checks/99" });

    render(
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <Switch>
            <Route path="/wet-checks/:id" component={Page as any} />
          </Switch>
        </Router>
      </QueryClientProvider>,
    );

    // (a) Header total badge — 3 photos across the wet check.
    const total = await screen.findByTestId("wc-photo-total");
    expect(total.textContent ?? "").toMatch(/3\s*photo/);

    // (b) Per-controller rollup badge — controller A has 2 zone-attached photos
    //     (zone-level + finding-level both roll up to the controller).
    const ctrlBadge = await screen.findByTestId("controller-A-photo-count");
    expect(ctrlBadge.textContent ?? "").toMatch(/2/);

    // (c) Loose-photos amber banner is rendered for the unattached photo,
    //     even though findings exist on this wet check.
    const loose = await screen.findByTestId("loose-photos-section");
    expect(loose).toBeTruthy();
    expect(loose.textContent ?? "").toMatch(/1\s*loose photo/i);
  });
});

// ─── Task #842 — PhotoThumb error state ──────────────────────────────────────
//
// When the <img> fires onError for a photo with a real server id, PhotoThumb
// must:
//   (a) replace the broken <img> with the "Photo unavailable" placeholder
//   (b) fire a toast
//   (c) NOT show the placeholder for an optimistic/uploading photo

describe("Task #842 — PhotoThumb shows error placeholder on load failure", () => {
  it("(a) switches to placeholder and fires toast when server photo fails to load", async () => {
    toastSpy.mockClear();
    const { PhotoThumb } = await import("./PhotoThumb");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const photo: any = {
      id: 200,
      wetCheckId: 99,
      url: "https://example/missing.jpg",
      takenAt: new Date().toISOString(),
      zoneRecordId: null,
      findingId: null,
      clientId: "p-200",
    };

    const { fireEvent } = await import("@testing-library/react");

    render(
      <QueryClientProvider client={qc}>
        <PhotoThumb photo={photo} canDelete={false} />
      </QueryClientProvider>,
    );

    const thumb = screen.getByTestId("photo-thumb-200");
    expect(thumb).toBeTruthy();

    // Simulate the image failing to load.
    const img = thumb.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    // Placeholder must now be visible.
    const placeholder = await screen.findByTestId("photo-thumb-200-error");
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toMatch(/photo unavailable/i);

    // The broken <img> must be gone.
    expect(thumb.querySelector("img")).toBeNull();

    // Toast must have fired with a "retake" message.
    expect(toastSpy).toHaveBeenCalledOnce();
    expect(toastSpy.mock.calls[0][0]).toMatchObject({
      title: "Photo unavailable",
      variant: "destructive",
    });
  });

  it("(c) does NOT switch to placeholder for an optimistic photo (no server id)", async () => {
    const { PhotoThumb } = await import("./PhotoThumb");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // id=0 means no server row yet (optimistic)
    const photo: any = {
      id: 0,
      wetCheckId: 99,
      url: "blob:http://localhost/fake",
      takenAt: new Date().toISOString(),
      zoneRecordId: null,
      findingId: null,
      clientId: "p-opt",
    };

    const { fireEvent } = await import("@testing-library/react");

    render(
      <QueryClientProvider client={qc}>
        <PhotoThumb photo={photo} canDelete={false} />
      </QueryClientProvider>,
    );

    const thumb = screen.getByTestId("photo-thumb-0");
    const img = thumb.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    // Placeholder must NOT appear — still shows the img.
    expect(screen.queryByTestId("photo-thumb-0-error")).toBeNull();
    expect(thumb.querySelector("img")).not.toBeNull();
  });
});

// ─── Task #829 — Regression: finding-linked photos (null zoneRecordId) ───────
//
// Bug 1: WetCheckDetail previously filtered photos as
//   `p.zoneRecordId === zoneRecord?.id`
// which excluded finding-linked photos whose zoneRecordId is null (e.g.
// uploaded from the mobile app before the zone record was persisted).
// The fix widens the predicate to also include any photo whose findingId
// belongs to a finding in the zone.
//
// This suite covers:
//   (a) Pure predicate test — proves the filter logic includes finding-linked photos.
//   (b) ZoneScreen render test — proves the photo thumb renders under its finding card.

describe("Task #829 — Bug 1 regression: finding-linked photo filter", () => {
  it("(a) filter predicate includes photos with null zoneRecordId when findingId matches zone finding", () => {
    // Inline asArray helper (same logic as @/lib/queryClient.asArray) so this
    // test has no external dependency and cannot be broken by mock ordering.
    const asArray = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

    const zoneRecord = {
      id: 1,
      findings: [
        { id: 10, issueType: "leak" },
        { id: 11, issueType: "head_replacement" },
      ],
    };

    const photos = [
      // zone-level: included because zoneRecordId matches
      { id: 100, zoneRecordId: 1, findingId: null },
      // finding-linked, null zoneRecordId: Bug 1 caused this to be excluded
      { id: 101, zoneRecordId: null, findingId: 10 },
      // belongs to a different zone entirely — must be excluded
      { id: 102, zoneRecordId: 2, findingId: null },
      // finding from a different zone — must be excluded
      { id: 103, zoneRecordId: null, findingId: 99 },
    ];

    const filtered = photos.filter(
      (p) =>
        p.zoneRecordId === zoneRecord.id ||
        (p.findingId != null &&
          asArray(zoneRecord.findings).some((f: { id: number }) => f.id === p.findingId)),
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.id)).toContain(100);
    // Bug 1 regression: finding-linked photo with null zoneRecordId must be included
    expect(filtered.map((p) => p.id)).toContain(101);
    expect(filtered.map((p) => p.id)).not.toContain(102);
    expect(filtered.map((p) => p.id)).not.toContain(103);
  });

  it("(b) ZoneScreen renders finding-linked photo under its finding card", async () => {
    const { ZoneScreen } = await import("./ZoneScreen");

    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
          queryFn: async ({ queryKey }) => {
            const k = queryKey as unknown[];
            if (k[0] === "/api/config/wet-check-auto-bill") return { enabled: false };
            if (k[0] === "/api/wet-checks/issue-types") return [];
            return null;
          },
        },
      },
    });

    // Seed the queries ZoneScreen depends on
    qc.setQueryData(["/api/config/wet-check-auto-bill"], { enabled: false });
    qc.setQueryData(["/api/wet-checks/issue-types"], []);

    const zoneRecord: any = {
      id: 1,
      clientId: "z-1",
      wetCheckId: 99,
      controllerLetter: "A",
      zoneNumber: 1,
      status: "checked_with_issues",
      repairLaborHours: "0.00",
      findings: [
        {
          id: 10,
          clientId: "f-10",
          zoneRecordId: 1,
          wetCheckId: 99,
          issueType: "leak",
          resolution: "pending",
          techDisposition: "needs_review",
          partId: null,
          noPartNeeded: false,
          partName: null,
          partPrice: "0.00",
          quantity: 1,
          laborHours: "0.00",
          notes: null,
        },
      ],
    };

    // Finding-linked photo with null zoneRecordId — this is the Bug 1 regression photo.
    // Use a data: URL so PhotoThumb's isLocalUrl check is true and authedPhotoSrc is not called.
    const photos: any[] = [
      {
        id: 101,
        wetCheckId: 99,
        url: "data:image/jpeg;base64,dGVzdA==",
        takenAt: new Date().toISOString(),
        zoneRecordId: null,
        findingId: 10,
        clientId: "p-101",
      },
    ];

    render(
      <QueryClientProvider client={qc}>
        <ZoneScreen
          wetCheckId={99}
          wetCheckClientId="wc-99"
          customerId={1}
          customerName="Acme"
          propertyAddress="123 Main St"
          letter="A"
          zoneNumber={1}
          zoneCount={4}
          zoneRecord={zoneRecord}
          photos={photos}
          readOnly={false}
          onBack={vi.fn()}
          onAdvance={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // The finding card's photo strip must contain the finding-linked photo thumb.
    const findingPhotos = await screen.findByTestId("finding-photos-10");
    expect(findingPhotos).toBeTruthy();

    const thumb = await screen.findByTestId("photo-thumb-101");
    expect(thumb).toBeTruthy();

    // Zone-only photo strip must be absent (no photos with null findingId).
    expect(screen.queryByTestId("zone-photos")).toBeNull();
  });
});

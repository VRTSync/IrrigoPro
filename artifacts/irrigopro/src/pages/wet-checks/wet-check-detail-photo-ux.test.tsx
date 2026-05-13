// Task #597 — UI assertions on WetCheckDetail's photo-visibility surface:
//   * the wet-check header total ("📷 N photos")
//   * the per-controller "📷 N" rollup badge
//   * the loose-photos amber banner (regardless of whether findings exist)
//
// Mounts the default export (`WetChecksPage`) routed at `/wet-checks/:id`
// with a seeded React Query cache, mirroring `wet-checks-null-safe.test.tsx`.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/lifecycle", () => ({
  tintForControllerLetter: () => "bg-gray-100 border-gray-300 text-gray-800",
  lifecycleStageMeta: () => ({ label: "Active", className: "bg-gray-100" }),
}));

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

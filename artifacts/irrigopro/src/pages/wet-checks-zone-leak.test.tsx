// Task #511 — regression for the wet-check tech flow leaking Needs Work
// info from one zone onto the next. The fix is a `key` prop on the
// <ZoneScreen> JSX in WetCheckDetail (wet-checks.tsx) so React remounts
// ZoneScreen — and the FindingSheet it owns — whenever the active zone
// changes, instead of reusing the same instance with new props.
//
// Coverage:
//  • Real-ZoneScreen test that exercises the per-zone inline "Mark Zone
//    Complete" confirm and asserts the confirm UI does not survive a
//    keyed remount. Also checks that nav-back to Zone 1 is itself a
//    fresh slate (no preserved confirm state).
//  • Static source guard: <ZoneScreen> in wet-checks.tsx still has a
//    `key` referencing both `activeLetter` and `activeZone`. Removing
//    the key would silently reintroduce the bug.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

// ZoneScreen pulls in the queryClient + offline + photo-prep stack. We
// only exercise local-state UI here, so stub those modules to no-ops.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  authedPhotoSrc: (u: string) => u,
  queryClient: { invalidateQueries: vi.fn(), cancelQueries: vi.fn(), getQueryData: vi.fn(), setQueryData: vi.fn() },
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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/utils/safeStorage", () => ({ safeGet: () => null }));
vi.mock("@/components/offline/sync-ui", () => ({ OfflineStrip: () => null, OfflineSyncUI: () => null }));

import { ZoneScreen } from "./wet-checks";

function makeZoneRecord(overrides: Partial<any> = {}): any {
  return {
    id: 1001,
    clientId: "zr-client-1",
    wetCheckId: 42,
    controllerLetter: "A",
    zoneNumber: 1,
    status: "checked_with_issues",
    ranSuccessfully: false,
    notes: null,
    checkedAt: new Date().toISOString(),
    markedCompleteAt: null,
    findings: [],
    ...overrides,
  };
}

function ZoneHarness({ zoneNumber, zoneRecord }: { zoneNumber: number; zoneRecord: any }) {
  return (
    <ZoneScreen
      // Mirrors the parent JSX in WetCheckDetail.
      key={`zone-A-${zoneNumber}`}
      wetCheckId={42}
      wetCheckClientId="wc-client"
      customerId={1}
      customerName="Test Customer"
      propertyAddress="1 Main St"
      letter="A"
      zoneNumber={zoneNumber}
      zoneCount={12}
      zoneRecord={zoneRecord}
      photos={[]}
      readOnly={false}
      onBack={() => {}}
      onAdvance={() => {}}
    />
  );
}

function renderHarness(initial: { zoneNumber: number; zoneRecord: any }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ZoneHarness {...initial} />
    </QueryClientProvider>,
  );
  const rerender = (next: { zoneNumber: number; zoneRecord: any }) =>
    utils.rerender(
      <QueryClientProvider client={qc}>
        <ZoneHarness {...next} />
      </QueryClientProvider>,
    );
  return { ...utils, rerender };
}

describe("Task #511 — needs-work info must not leak to the next zone", () => {
  it("the inline 'no work added' confirm does not survive zone-advance with the keyed remount", async () => {
    const user = userEvent.setup();
    const z1 = makeZoneRecord({ id: 1001, clientId: "zr-1", zoneNumber: 1 });
    const z2 = makeZoneRecord({ id: 1002, clientId: "zr-2", zoneNumber: 2 });

    const { rerender } = renderHarness({ zoneNumber: 1, zoneRecord: z1 });

    // First tap on a Needs Work zone with no findings flips into the
    // inline "No work added — Mark this zone complete anyway? Tap again
    // to confirm." state.
    await user.click(screen.getByTestId("btn-mark-zone-complete"));
    expect(screen.getByTestId("mark-zone-complete-confirm")).toBeInTheDocument();

    // Tech advances to Zone 2. Because the parent re-keys ZoneScreen on
    // every zone change, the confirm UI must NOT carry over.
    rerender({ zoneNumber: 2, zoneRecord: z2 });
    expect(screen.queryByTestId("mark-zone-complete-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("btn-mark-zone-complete")).toHaveTextContent(/^Mark Zone Complete$/);
  });

  it("navigating back to Zone 1 also opens fresh — no leftover confirm state", async () => {
    const user = userEvent.setup();
    const z1 = makeZoneRecord({ id: 1001, clientId: "zr-1", zoneNumber: 1 });
    const z2 = makeZoneRecord({ id: 1002, clientId: "zr-2", zoneNumber: 2 });

    const { rerender } = renderHarness({ zoneNumber: 1, zoneRecord: z1 });
    await user.click(screen.getByTestId("btn-mark-zone-complete"));
    rerender({ zoneNumber: 2, zoneRecord: z2 });
    rerender({ zoneNumber: 1, zoneRecord: z1 });
    expect(screen.queryByTestId("mark-zone-complete-confirm")).not.toBeInTheDocument();
  });

  it("static guard: wet-checks.tsx keys <ZoneScreen> by both letter and zone number", () => {
    // Backstop: if a future refactor drops or weakens the key, this
    // fails loudly even if no one re-runs the behavioral test.
    const src = fs.readFileSync(path.resolve(__dirname, "wet-checks.tsx"), "utf8");
    const tag = src.match(/<ZoneScreen\b[\s\S]*?\/>/);
    expect(tag).not.toBeNull();
    const tagText = tag![0];
    const keyStart = tagText.indexOf("key={");
    expect(keyStart).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = -1;
    for (let i = keyStart + "key=".length; i < tagText.length; i++) {
      const ch = tagText[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    expect(end).toBeGreaterThan(keyStart);
    const keyExpr = tagText.slice(keyStart + "key={".length, end);
    expect(keyExpr).toMatch(/activeLetter/);
    expect(keyExpr).toMatch(/activeZone/);
  });
});

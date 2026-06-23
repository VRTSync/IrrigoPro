// Task #1498 — regression for the false loose-photo alarm.
//
// `isPhotoAttachedToFinding` matches by `findingClientId` when a finding
// hasn't synced yet (id ≤ 0). Without this coverage a future refactor of
// the filter logic or the optimistic-photo shape could silently re-introduce
// the false alarm. Three angles:
//
//  1. In-flight finding (clientId match, id ≤ 0): photo with matching
//     `findingClientId` must appear under the finding's gallery and NOT in
//     the loose-photos section.
//  2. Truly loose photo (no findingId, no findingClientId): must appear in
//     the loose-photos section.
//  3. Synced finding (positive numeric id match): photo must appear under
//     the finding's gallery and NOT in the loose-photos section.
//
// Pattern mirrors wet-checks-zone-leak.test.tsx: fully mock @/lib/queryClient
// to avoid the real module's async initialisation hanging the test runner.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  authedPhotoSrc: (u: string) => u,
  asArray: <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []),
  useArrayQuery: <T,>(_opts: unknown) =>
    ({ data: [] as T[], isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() }) as any,
  queryClient: {
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  },
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
  patchZoneRecordRepairLabor: vi.fn(),
  patchZoneRecordReadings: vi.fn(),
  cachedApiRequest: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/offline/db", () => ({
  openOfflineDB: vi.fn(() => Promise.resolve({ put: vi.fn(), get: vi.fn(), getAll: vi.fn() })),
  putFindingMirror: vi.fn(),
}));
vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/utils/safeStorage", () => ({ safeGet: () => null, safeSet: vi.fn(), safeRemove: vi.fn() }));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
  // PhotoThumb calls useSyncEngineState to check in-flight upload mutations.
  useSyncEngineState: () => ({ mutations: [], pendingCount: 0, syncingCount: 0 }),
}));

// Static import AFTER all vi.mock() declarations are hoisted.
import { ZoneScreen } from "./wet-checks";

// ─── Fixture builders ─────────────────────────────────────────────────────────

function makeZoneRecord(overrides: Record<string, unknown> = {}) {
  return {
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
    observedPressure: null,
    observedFlow: null,
    repairLaborHours: "0.00",
    findings: [],
    ...overrides,
  };
}

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    clientId: "finding-cid-10",
    wetCheckZoneRecordId: 7,
    issueType: "broken_head",
    partId: null,
    partName: null,
    quantity: "1",
    laborHours: "0.00",
    notes: null,
    repairedInField: false,
    cost: null,
    status: "open",
    autoBillToInvoiceId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    wetCheckId: 1,
    zoneRecordId: 7,
    findingId: null,
    filePath: "/uploads/photo.jpg",
    clientId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderZoneScreen(
  zoneRecord: ReturnType<typeof makeZoneRecord>,
  photos: ReturnType<typeof makePhoto>[],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
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
        zoneRecord={zoneRecord as any}
        photos={photos as any}
        readOnly={false}
        onBack={() => {}}
        onAdvance={() => {}}
      />
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Task #1498 — in-flight finding photos never show as loose", () => {
  it("photo with findingClientId matching an unsynced finding (id ≤ 0) appears under the finding gallery and NOT in the loose-photos section", () => {
    // id: -1 simulates a finding that was created offline and hasn't
    // received a server id yet. The photo carries findingClientId (not
    // findingId) because there's nothing to link against numerically.
    const finding = makeFinding({ id: -1, clientId: "finding-cid-unsynced" });
    const photo = makePhoto({
      id: -2,
      findingId: null,
      // PhotoClientLinked extension field — set by PhotoCaptureButton
      // when the finding is still queued.
      findingClientId: "finding-cid-unsynced",
    });
    const zoneRecord = makeZoneRecord({ findings: [finding] });

    renderZoneScreen(zoneRecord, [photo]);

    // The gallery section uses data-testid="finding-photos-{f.id}".
    // For an unsynced finding f.id = -1, so the testid is "finding-photos--1".
    expect(screen.getByTestId("finding-photos--1")).toBeTruthy();

    // The false alarm: the photo must NOT appear in the loose section.
    expect(screen.queryByTestId("loose-photos-section")).toBeNull();
  });

  it("photo with no findingId AND no findingClientId appears in the loose-photos section", () => {
    // A real synced finding that the photo is NOT attached to.
    const finding = makeFinding({ id: 42, clientId: "finding-cid-42" });
    // Photo carries no link at all — it is genuinely loose.
    const photo = makePhoto({
      id: -3,
      clientId: "photo-loose-1",
      findingId: null,
      // No findingClientId field.
    });
    const zoneRecord = makeZoneRecord({ findings: [finding] });

    renderZoneScreen(zoneRecord, [photo]);

    // With at least one finding present, LoosePhotosSection renders
    // (data-testid="loose-photos-section") for unlinked photos.
    expect(screen.getByTestId("loose-photos-section")).toBeTruthy();
  });

  it("photo with findingId matching a synced finding's positive id appears under the finding gallery and NOT in the loose-photos section", () => {
    const finding = makeFinding({ id: 42, clientId: "finding-cid-42" });
    const photo = makePhoto({
      id: 5,
      findingId: 42,
    });
    const zoneRecord = makeZoneRecord({ findings: [finding] });

    renderZoneScreen(zoneRecord, [photo]);

    // Numeric id match → gallery section for finding 42.
    expect(screen.getByTestId("finding-photos-42")).toBeTruthy();

    // Definitively not loose.
    expect(screen.queryByTestId("loose-photos-section")).toBeNull();
  });
});

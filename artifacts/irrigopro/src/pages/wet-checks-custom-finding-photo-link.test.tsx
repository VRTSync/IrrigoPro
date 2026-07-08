// Regression — custom "Flag for Manager" findings must link their
// pre-uploaded photos.
//
// The CustomFindingEditor (ZoneScreen) lets a tech attach photos BEFORE the
// finding exists: each photo is uploaded with findingId=null and only the
// finding's pre-generated clientId (findingClientId) to tie it back. Once the
// finding is created we must link those loose photos to the real finding —
// offline via the engine's photo.link ({{f}} placeholder), online via a
// PATCH. A previous version created the finding but never linked the photos,
// so every field photo landed loose on the server (findingId stayed NULL).
//
// This test drives the production path (offline queue enabled): open the
// custom editor, save a flag that already has one pending photo, and assert
// the photo→finding link is dispatched with the finding's clientId.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const FIXED_FINDING_CID = "fixed-finding-cid-uuid";

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(() => Promise.resolve({})),
  authedPhotoSrc: (u: string) => u,
  asArray: <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []),
  parseApiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  useArrayQuery: <T,>(_opts: unknown) =>
    ({ data: [] as T[], isLoading: false, isError: false, isSuccess: true, error: null, refetch: vi.fn() }) as any,
  queryClient: {
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  },
}));

// Production path: offline queue is ON, so linking routes through the engine.
vi.mock("@/lib/offline/engine", () => ({ isOfflineQueueEnabled: () => true }));

const createFindingMock = vi.fn(() => Promise.resolve({ id: 99 }));
const linkPhotoToFindingMock = vi.fn(() => Promise.resolve());

vi.mock("@/lib/offline/api", () => ({
  PHOTO_OFFLINE_MESSAGE: "",
  isProbablyOffline: () => false,
  isOfflinePhotosEnabled: () => true,
  ensurePersistentStorage: vi.fn(),
  queuePhotoUpload: vi.fn(),
  createWetCheck: vi.fn(),
  submitWetCheck: vi.fn(),
  upsertZoneRecord: vi.fn(),
  createFinding: (...args: unknown[]) => createFindingMock(...args),
  updateFinding: vi.fn(),
  deleteFinding: vi.fn(),
  enqueueZoneRevertCascade: vi.fn(),
  linkPhotoToFinding: (...args: unknown[]) => linkPhotoToFindingMock(...args),
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
// Pin the finding's pre-generated clientId so the pending photo's
// findingClientId can be set up deterministically. withRetry stays real.
vi.mock("./wet-checks/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wet-checks/helpers")>();
  return { ...actual, newClientId: () => FIXED_FINDING_CID };
});
vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/utils/safeStorage", () => ({ safeGet: () => null, safeSet: vi.fn(), safeRemove: vi.fn() }));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
  useSyncEngineState: () => ({ mutations: [], pendingCount: 0, syncingCount: 0 }),
}));

// Static import AFTER all vi.mock() declarations are hoisted.
import { ZoneScreen } from "./wet-checks";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

function makePhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    wetCheckId: 1,
    zoneRecordId: 7,
    findingId: null,
    url: "/uploads/photo.jpg",
    clientId: "photo-cid-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderZoneScreen(photos: ReturnType<typeof makePhoto>[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
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
        zoneRecord={makeZoneRecord() as any}
        photos={photos as any}
        readOnly={false}
        onBack={() => {}}
        onAdvance={() => {}}
      />
    </QueryClientProvider>,
  );
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe("CustomFindingEditor — pre-uploaded photos link to the new finding", () => {
  beforeEach(() => {
    createFindingMock.mockClear();
    linkPhotoToFindingMock.mockClear();
  });

  it("saving a custom flag links its pending photo (findingClientId match) to the created finding", async () => {
    // Photo captured before the finding existed: findingId is null and it is
    // tied to the finding only by findingClientId (the pinned clientId).
    const pendingPhoto = makePhoto({ findingId: null, findingClientId: FIXED_FINDING_CID });

    renderZoneScreen([pendingPhoto]);

    // Open the "Custom — Flag for Manager" editor.
    fireEvent.click(screen.getByTestId("chip-custom_review"));

    // Description gate.
    fireEvent.change(screen.getByTestId("custom-finding-description"), {
      target: { value: "Sprinkler head buried — needs manager review" },
    });

    // Photo gate is already satisfied (the pending photo matches by clientId),
    // so Save Flag is enabled.
    const saveBtn = screen.getByTestId("custom-finding-save");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(createFindingMock).toHaveBeenCalledTimes(1);
      expect(linkPhotoToFindingMock).toHaveBeenCalledTimes(1);
    });

    // The finding was created under the pinned clientId…
    expect(createFindingMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: FIXED_FINDING_CID }),
    );
    // …and the pending photo was linked to it by clientId (offline path uses
    // the {{f}} placeholder, so no numeric findingId is passed).
    expect(linkPhotoToFindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        photoClientId: "photo-cid-1",
        photoId: 5,
        findingClientId: FIXED_FINDING_CID,
      }),
    );
  });
});

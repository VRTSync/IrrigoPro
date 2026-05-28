// Regression guard: wet-check photo upload drain preserves FK anchors.
//
// Field techs reported that photos captured inside FindingSheet or ZoneScreen
// appeared in LoosePhotosSection (both zoneRecordId and findingId null in DB).
//
// Root cause (offline/api.ts:648-655): queuePhotoUpload must include
// zoneRecordId and findingId in the mutation body so the engine's
// placeholder resolver can substitute the real server ids at drain time.
// If those lines are absent, the metadata POST sends null FKs and the photo
// is stored as loose regardless of which screen captured it.
//
// Test suites:
//
//   Suite A — "queuePhotoUpload enqueue body" (root-cause guard):
//     Calls queuePhotoUpload directly and reads the IDB queue to assert
//     FK placeholder fields are present in the stored mutation body.
//     THESE TESTS FAIL if lines 653-654 of offline/api.ts are removed.
//
//   Suite B — "photo upload drain" (end-to-end guard):
//     Drives the SyncEngine with pre-built mutations and asserts the final
//     metadata POST body received by the mock server has the resolved FK ids.

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

// photo-prep uses browser-image-compression which spawns a web worker — in
// vitest/jsdom the worker never resolves, so queuePhotoUpload hangs unless we
// stub it out. Suite A tests only care about what body is enqueued, not about
// compression, so returning the file unchanged is correct here.
vi.mock("@/lib/photo-prep", () => ({
  preparePhotoForUpload: async (file: File) => ({ displayFile: file, usedFallback: false }),
}));

import { SyncEngine, __resetEngineForTests, __setEngineForTests } from "@/lib/offline/engine";
import {
  __resetOfflineDBForTests,
  openOfflineDB,
  listAllMutations,
  putPhotoBlob,
  putFindingMirror,
  putZoneRecordMirror,
  putWetCheckMirror,
} from "@/lib/offline/db";
import { queuePhotoUpload } from "@/lib/offline/api";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function freshDb() {
  __resetOfflineDBForTests();
  const db = await openOfflineDB();
  await db.clear("mutationQueue");
  await db.clear("photoBlobs");
  await db.clear("wetChecks");
  await db.clear("wetCheckZoneRecords");
  await db.clear("wetCheckFindings");
  return db;
}

const WET_CHECK_CLIENT_ID = "wc-cid-1";
const WET_CHECK_ID = 123;
const ZONE_RECORD_CLIENT_ID = "zr-cid-1";
const ZONE_RECORD_ID = 42;
const FINDING_CLIENT_ID = "finding-cid-1";
const FINDING_ID = 77;

async function seedMirrors(db: Awaited<ReturnType<typeof openOfflineDB>>, opts: {
  zoneRecord?: boolean;
  finding?: boolean;
}) {
  await putWetCheckMirror(db, {
    clientId: WET_CHECK_CLIENT_ID,
    id: WET_CHECK_ID,
    data: {} as any,
    updatedAt: 1000,
  });
  if (opts.zoneRecord) {
    await putZoneRecordMirror(db, {
      clientId: ZONE_RECORD_CLIENT_ID,
      id: ZONE_RECORD_ID,
      wetCheckClientId: WET_CHECK_CLIENT_ID,
      data: {} as any,
      updatedAt: 1000,
    });
  }
  if (opts.finding) {
    await putFindingMirror(db, {
      clientId: FINDING_CLIENT_ID,
      id: FINDING_ID,
      zoneRecordClientId: ZONE_RECORD_CLIENT_ID,
      zoneRecordId: ZONE_RECORD_ID,
      wetCheckId: WET_CHECK_ID,
      data: {} as any,
      updatedAt: 1000,
    });
  }
}

// Shared photo blob for all tests — content doesn't matter for this
// regression; the engine only reads it to PUT to the signed URL.
async function seedPhotoBlob(db: Awaited<ReturnType<typeof openOfflineDB>>, clientId: string) {
  await putPhotoBlob(db, {
    clientId,
    blob: new Blob(["pixel"], { type: "image/jpeg" }),
    contentType: "image/jpeg",
    name: "shot.jpg",
    byteSize: 5,
    capturedAt: 1000,
    compressed: true,
  });
}

// Build a mock fetch that handles the 4-step photo upload pipeline:
// sign → PUT → finalize → metadata POST.
// Returns a reference to the captured `calls` array so callers can assert on it.
function buildPhotoFetch(photoClientId: string, metadataPath: string) {
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: any = undefined;
    if (init?.body && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ method, url, body });

    if (url.startsWith("/api/upload/photo?")) {
      return new Response(
        JSON.stringify({ signedUrl: "https://signed.example/put", url: "https://cdn.example/p.jpg" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url === "https://signed.example/put") {
      return new Response("", { status: 200 });
    }
    if (url === "/api/upload/photo/finalize") {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === metadataPath) {
      return new Response(
        JSON.stringify({ id: 9001, clientId: photoClientId, url: "https://cdn.example/p.jpg" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(`unexpected: ${url}`, { status: 500 });
  };
  return { fetchImpl, calls };
}

// ─── Suite A — root-cause guard: queuePhotoUpload enqueue body ───────────────
//
// These tests call queuePhotoUpload() directly and inspect what it writes to
// the IDB mutation queue. They FAIL if lines 653-654 in offline/api.ts are
// removed (i.e. if zoneRecordId / findingId are no longer included in the
// mutation body). The drain-path tests (Suite B) would not catch that
// regression because they manually enqueue mutations with FK fields.

describe("queuePhotoUpload — enqueue body has FK anchor fields (root-cause regression guard)", () => {
  beforeEach(async () => {
    // Reset IDB and engine singleton so each test starts clean.
    __resetOfflineDBForTests();
    __resetEngineForTests();
    const db = await openOfflineDB();
    await db.clear("mutationQueue");
    await db.clear("photoBlobs");
    // Inject a no-op engine that never auto-drains — we only care what was enqueued.
    const noopEngine = new SyncEngine({
      fetchImpl: async () => new Response("{}", { status: 200 }),
      heartbeatIntervalMs: 0,
    });
    __setEngineForTests(noopEngine);
  });

  it("finding-anchored: mutation body uses {{zr}} and {{f}} placeholders when clientIds are provided", async () => {
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const result = await queuePhotoUpload({
      file,
      wetCheckClientId: "wc-a",
      wetCheckId: 1,
      zoneRecordClientId: "zr-a",
      zoneRecordId: 10,
      findingClientId: "f-a",
      findingId: 20,
    });

    const db = await openOfflineDB();
    const mutations = await listAllMutations(db);
    const upload = mutations.find(
      (m) => m.kind === "photo.upload" && m.clientId === result.clientId,
    );

    expect(upload, "photo.upload mutation enqueued").toBeDefined();
    const body = upload!.body as Record<string, unknown>;
    // Root-cause fix lives at offline/api.ts:653-654. Without those lines:
    //   body.zoneRecordId and body.findingId are absent/undefined,
    //   the drain POST sends null FKs, and the photo is stored as loose.
    expect(body.zoneRecordId, "zoneRecordId placeholder present").toBe("{{zr}}");
    expect(body.findingId, "findingId placeholder present").toBe("{{f}}");
    // Placeholder map must resolve both client ids so the engine can sub in server ids.
    expect(upload!.placeholders.zr, "zr placeholder maps to zone record clientId").toBe("zr-a");
    expect(upload!.placeholders.f, "f placeholder maps to finding clientId").toBe("f-a");
  });

  it("zone-only: mutation body has {{zr}} for zoneRecordId and findingId: null", async () => {
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const result = await queuePhotoUpload({
      file,
      wetCheckClientId: "wc-b",
      wetCheckId: 2,
      zoneRecordClientId: "zr-b",
      zoneRecordId: 11,
      // No findingClientId / findingId — zone-only photo.
    });

    const db = await openOfflineDB();
    const mutations = await listAllMutations(db);
    const upload = mutations.find(
      (m) => m.kind === "photo.upload" && m.clientId === result.clientId,
    );

    expect(upload, "photo.upload mutation enqueued").toBeDefined();
    const body = upload!.body as Record<string, unknown>;
    expect(body.zoneRecordId, "zoneRecordId placeholder present").toBe("{{zr}}");
    expect(body.findingId, "findingId null for zone-only photo").toBeNull();
  });

  it("intentionally-loose: mutation body has null for both FK fields (header-level photo)", async () => {
    const file = new File(["pixel"], "photo.jpg", { type: "image/jpeg" });
    const result = await queuePhotoUpload({
      file,
      wetCheckClientId: "wc-c",
      wetCheckId: 3,
      // No zone record or finding — header-level photo, intentionally loose.
    });

    const db = await openOfflineDB();
    const mutations = await listAllMutations(db);
    const upload = mutations.find(
      (m) => m.kind === "photo.upload" && m.clientId === result.clientId,
    );

    expect(upload, "photo.upload mutation enqueued").toBeDefined();
    const body = upload!.body as Record<string, unknown>;
    expect(body.zoneRecordId, "zoneRecordId null for loose photo").toBeNull();
    expect(body.findingId, "findingId null for loose photo").toBeNull();
  });
});

// ─── Suite B — end-to-end drain guard ────────────────────────────────────────

describe("photo upload drain — FK anchor propagation (regression guard)", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("finding-anchored: metadata POST body has findingId and zoneRecordId resolved from mirrors", async () => {
    const photoClientId = "photo-finding-1";
    const db = await openOfflineDB();
    await seedPhotoBlob(db, photoClientId);
    await seedMirrors(db, { zoneRecord: true, finding: true });

    const metadataPath = `/api/wet-checks/${WET_CHECK_ID}/photos`;
    const { fetchImpl, calls } = buildPhotoFetch(photoClientId, metadataPath);

    const engine = new SyncEngine({ fetchImpl, now: () => 1000, heartbeatIntervalMs: 0, maxConcurrent: 2 });
    engine.setOnline(true);

    await engine.enqueue({
      id: "mut-finding-photo-1",
      kind: "photo.upload",
      method: "POST",
      urlTemplate: `/api/wet-checks/{{wc}}/photos`,
      body: {
        takenAt: "2026-05-28T12:00:00.000Z",
        clientId: photoClientId,
        zoneRecordId: "{{zr}}",
        findingId: "{{f}}",
      },
      clientId: photoClientId,
      parentClientId: null,
      placeholders: {
        wc: WET_CHECK_CLIENT_ID,
        zr: ZONE_RECORD_CLIENT_ID,
        f: FINDING_CLIENT_ID,
      },
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: 1000,
      resolvedId: null,
    });

    await engine.drainAll();

    const metadataPost = calls.find(
      (c) => c.method === "POST" && c.url === metadataPath,
    );
    expect(metadataPost, "metadata POST was issued").toBeDefined();
    expect(metadataPost!.body.zoneRecordId, "zoneRecordId resolved from mirror").toBe(ZONE_RECORD_ID);
    expect(metadataPost!.body.findingId, "findingId resolved from mirror").toBe(FINDING_ID);
    expect(metadataPost!.body.url, "url filled in by engine").toBe("https://cdn.example/p.jpg");
    // Must NOT post negative/unresolved id.
    expect(
      calls.some((c) => c.method === "POST" && /\/photos/.test(c.url) && c.body?.zoneRecordId < 0),
      "no negative zoneRecordId in any metadata POST",
    ).toBe(false);
  });

  it("zone-only: metadata POST body has zoneRecordId resolved from mirror and findingId null", async () => {
    const photoClientId = "photo-zone-1";
    const db = await openOfflineDB();
    await seedPhotoBlob(db, photoClientId);
    await seedMirrors(db, { zoneRecord: true, finding: false });

    const metadataPath = `/api/wet-checks/${WET_CHECK_ID}/photos`;
    const { fetchImpl, calls } = buildPhotoFetch(photoClientId, metadataPath);

    const engine = new SyncEngine({ fetchImpl, now: () => 1000, heartbeatIntervalMs: 0, maxConcurrent: 2 });
    engine.setOnline(true);

    await engine.enqueue({
      id: "mut-zone-photo-1",
      kind: "photo.upload",
      method: "POST",
      urlTemplate: `/api/wet-checks/{{wc}}/photos`,
      body: {
        takenAt: "2026-05-28T12:00:00.000Z",
        clientId: photoClientId,
        zoneRecordId: "{{zr}}",
        findingId: null,
      },
      clientId: photoClientId,
      parentClientId: null,
      placeholders: {
        wc: WET_CHECK_CLIENT_ID,
        zr: ZONE_RECORD_CLIENT_ID,
      },
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: 1000,
      resolvedId: null,
    });

    await engine.drainAll();

    const metadataPost = calls.find(
      (c) => c.method === "POST" && c.url === metadataPath,
    );
    expect(metadataPost, "metadata POST was issued").toBeDefined();
    expect(metadataPost!.body.zoneRecordId, "zoneRecordId resolved from mirror").toBe(ZONE_RECORD_ID);
    expect(metadataPost!.body.findingId, "findingId is null (zone-only photo)").toBeNull();
  });

  it("intentionally-loose: metadata POST body has both zoneRecordId and findingId as null", async () => {
    const photoClientId = "photo-loose-1";
    const db = await openOfflineDB();
    await seedPhotoBlob(db, photoClientId);
    await seedMirrors(db, { zoneRecord: false, finding: false });

    const metadataPath = `/api/wet-checks/${WET_CHECK_ID}/photos`;
    const { fetchImpl, calls } = buildPhotoFetch(photoClientId, metadataPath);

    const engine = new SyncEngine({ fetchImpl, now: () => 1000, heartbeatIntervalMs: 0, maxConcurrent: 2 });
    engine.setOnline(true);

    await engine.enqueue({
      id: "mut-loose-photo-1",
      kind: "photo.upload",
      method: "POST",
      urlTemplate: `/api/wet-checks/{{wc}}/photos`,
      body: {
        takenAt: "2026-05-28T12:00:00.000Z",
        clientId: photoClientId,
        zoneRecordId: null,
        findingId: null,
      },
      clientId: photoClientId,
      parentClientId: null,
      placeholders: {
        wc: WET_CHECK_CLIENT_ID,
      },
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: 1000,
      resolvedId: null,
    });

    await engine.drainAll();

    const metadataPost = calls.find(
      (c) => c.method === "POST" && c.url === metadataPath,
    );
    expect(metadataPost, "metadata POST was issued").toBeDefined();
    expect(metadataPost!.body.zoneRecordId, "zoneRecordId is intentionally null").toBeNull();
    expect(metadataPost!.body.findingId, "findingId is intentionally null").toBeNull();
  });
});

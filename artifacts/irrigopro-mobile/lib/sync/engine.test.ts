// Regression tests for wet-check-photo drain survival across app restarts
// (Task #1485).
//
// The billing-sheet photo pipeline has long been covered by the queue
// persistence contract (queue.test.ts). These tests exercise the *engine*
// side — the `sendEntry` / `drainQueue` logic that processes a
// `wet-check-photo` entry — to confirm:
//
//   1. A photo entry persisted to the durable queue (simulating what remains
//      after an app kill mid-upload) is re-attempted on the next drain call.
//   2. The upload helper and POST endpoint are called with the correct
//      arguments (localUri, path, body including clientId / zoneRecordId /
//      findingId).
//   3. On success the entry is removed from the queue and the local file is
//      cleaned up.
//   4. On a network error during upload the entry stays `pending` with an
//      incremented attempt count so the next drain can retry (survival
//      contract).
//   5. On a hard server error (non-network) the entry is marked `failed`.
//
// The app-kill scenario is represented by tests 1 and 4: we seed the entry
// directly into the in-memory store (bypassing the originating mutation) as
// if it had been read back from AsyncStorage after a fresh launch, then call
// `drainQueue()`.
//
// IMPLEMENTATION NOTE: engine.ts lazy-loads photo-upload via a dynamic
// import so its static import graph no longer pulls in react-native modules.
// The __setEngine*ForTests seams (same adapter pattern as
// __setQueueStorageForTests in queue.ts) let tests inject fakes before any
// drain call, ensuring the lazy import is never triggered in tests.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  __setQueueStorageForTests,
  __resetQueueStateForTests,
  enqueue,
  listEntries,
  setActiveSession,
} from "./queue";
import {
  __setEngineUploaderForTests,
  __setEngineDeleterForTests,
  __setEngineApiRequestForTests,
  __setEngineSetOnlineForTests,
  __resetEngineSeamsForTests,
  drainQueue,
  attemptEntry,
} from "./engine";
import { ApiError } from "../api";

// ── In-memory storage adapter (same as queue.test.ts) ────────────────
const memory = new Map<string, string>();
__setQueueStorageForTests({
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => {
    memory.set(key, value);
  },
});

// ── Constants ────────────────────────────────────────────────────────
const STORAGE_URL = "https://storage.example.com/photos/abc123.jpg";
const PHOTO_PATH = "/api/wet-checks/7/photos";
const LOCAL_URI = "file:///documents/wet-check/7/clientid.jpg";
const TAKEN_AT = "2026-06-22T10:00:00.000Z";

// ── Helpers ──────────────────────────────────────────────────────────
async function seedPhotoEntry(opts: {
  zoneRecordId?: number | null;
  findingId?: number | null;
} = {}) {
  return enqueue({
    kind: "wet-check-photo",
    scopeKey: "wc:7",
    path: PHOTO_PATH,
    method: "POST",
    body: null,
    photo: {
      localUri: LOCAL_URI,
      takenAt: TAKEN_AT,
      // Use explicit `!== undefined` so callers can pass null intentionally
      // (null ?? 42 would incorrectly resolve to 42 — the ?. default).
      zoneRecordId: opts.zoneRecordId !== undefined ? opts.zoneRecordId : 42,
      findingId: opts.findingId !== undefined ? opts.findingId : null,
    },
    label: "Add zone photo",
  });
}

// ── Test lifecycle ────────────────────────────────────────────────────
beforeEach(async () => {
  memory.clear();
  __resetQueueStateForTests();
  __resetEngineSeamsForTests();
  // Prevent lazy loader from pulling in @react-native-community/netinfo.
  __setEngineSetOnlineForTests(() => undefined);
  await setActiveSession("tech1");
});

afterEach(() => {
  __resetEngineSeamsForTests();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("wet-check-photo drain — success path", () => {
  it("calls upload then POST with the correct args and removes the entry", async () => {
    let uploadCalledWith: string | null = null;
    let postCalledWith: { path: string; body: Record<string, unknown> } | null = null;
    let deleteCalledWith: string | null = null;

    __setEngineUploaderForTests(async (uri) => {
      uploadCalledWith = uri;
      return STORAGE_URL;
    });
    __setEngineApiRequestForTests(async (path, opts) => {
      const o = opts as { method?: string; body?: Record<string, unknown> } | undefined;
      postCalledWith = { path: String(path), body: (o?.body as Record<string, unknown>) ?? {} };
      return { id: 99, url: STORAGE_URL } as unknown;
    });
    __setEngineDeleterForTests((uri) => {
      deleteCalledWith = uri;
    });

    const entry = await seedPhotoEntry({ zoneRecordId: 42, findingId: null });

    // Simulate re-drain after app restart: call drainQueue directly.
    await drainQueue();

    // Upload was driven with the stored localUri.
    assert.equal(uploadCalledWith, LOCAL_URI);

    // Narrow postCalledWith — it is set by the mock above.
    assert.ok(postCalledWith !== null, "POST was not called");
    const called = postCalledWith as { path: string; body: Record<string, unknown> };

    // POST was sent to the right path.
    assert.equal(called.path, PHOTO_PATH);

    // Body carries the resolved storage URL, metadata, and the
    // clientId (used server-side for idempotency).
    assert.equal(called.body.url, STORAGE_URL);
    assert.equal(called.body.takenAt, TAKEN_AT);
    assert.equal(called.body.zoneRecordId, 42);
    assert.equal(called.body.findingId, null);
    assert.equal(called.body.clientId, entry.id);

    // Local file cleaned up after successful send.
    assert.equal(deleteCalledWith, LOCAL_URI);

    // Entry removed from the durable queue.
    const remaining = await listEntries();
    assert.equal(remaining.length, 0);
  });

  it("includes findingId in the POST body when the photo is finding-scoped", async () => {
    let postBody: Record<string, unknown> = {};
    __setEngineUploaderForTests(async () => STORAGE_URL);
    __setEngineApiRequestForTests(async (_path, opts) => {
      const o = opts as { body?: Record<string, unknown> } | undefined;
      postBody = (o?.body as Record<string, unknown>) ?? {};
      return { id: 100 } as unknown;
    });
    __setEngineDeleterForTests(() => undefined);

    await seedPhotoEntry({ zoneRecordId: null, findingId: 17 });
    await drainQueue();

    assert.equal(postBody.zoneRecordId, null);
    assert.equal(postBody.findingId, 17);
  });
});

describe("wet-check-photo drain — app-kill / restart scenario", () => {
  it("re-drains an entry that was persisted to storage before the kill", async () => {
    // Enqueue normally (persists to mocked AsyncStorage).
    const entry = await seedPhotoEntry();

    // Simulate app kill + restart: drop the in-memory cache so the next
    // call reads back from the mocked AsyncStorage (same key still in
    // `memory`).
    __resetQueueStateForTests();
    await setActiveSession("tech1"); // reloads from storage

    let uploadCalled = false;
    __setEngineUploaderForTests(async () => {
      uploadCalled = true;
      return STORAGE_URL;
    });
    __setEngineApiRequestForTests(async () => ({ id: 55 } as unknown));
    __setEngineDeleterForTests(() => undefined);

    // First drain after the simulated restart must process the entry.
    await drainQueue();

    assert.ok(uploadCalled, "upload was NOT called after simulated restart");

    // Entry gone from the queue.
    const remaining = await listEntries();
    assert.equal(remaining.length, 0, "entry still present after successful drain");

    // Confirm the queue key in storage is also cleared.
    const raw = JSON.parse(
      memory.get("irrigopro.sync.queue.v3.tech1") ?? "[]",
    ) as Array<{ id: string }>;
    assert.equal(
      raw.find((e) => e.id === entry.id),
      undefined,
      "entry still present in persisted storage",
    );
  });
});

describe("wet-check-photo drain — upload network failure (retry path)", () => {
  it("leaves entry pending with incremented attempts when upload throws a network error", async () => {
    __setEngineUploaderForTests(async () => {
      // TypeError is classified as a network error by isNetworkError().
      throw new TypeError("Network request failed");
    });
    __setEngineApiRequestForTests(async () => {
      throw new Error("should not be reached");
    });
    __setEngineDeleterForTests(() => undefined);

    const entry = await seedPhotoEntry();
    const result = await attemptEntry(entry);

    // Engine signals the entry is re-queued (not lost).
    assert.equal(result.kind, "queued");

    // Entry is still present and still pending — survived the failure.
    const [after] = await listEntries();
    assert.equal(after?.id, entry.id);
    assert.equal(after?.status, "pending");
    assert.equal(after?.attempts, 1);
  });

  it("retries successfully on the next drain after a prior upload failure", async () => {
    // First drain: network error → stays pending.
    __setEngineUploaderForTests(async () => {
      throw new TypeError("Network request failed");
    });
    __setEngineApiRequestForTests(async () => ({ id: 0 } as unknown));
    __setEngineDeleterForTests(() => undefined);

    await seedPhotoEntry();
    await drainQueue();

    // Confirm still pending.
    let entries = await listEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].status, "pending");

    // Second drain: network recovered → should succeed.
    let secondUploadCalled = false;
    __setEngineUploaderForTests(async () => {
      secondUploadCalled = true;
      return STORAGE_URL;
    });

    await drainQueue();

    assert.ok(secondUploadCalled, "second drain did not retry the upload");

    entries = await listEntries();
    assert.equal(entries.length, 0, "entry not removed after successful retry");
  });
});

describe("wet-check-photo drain — hard server error (non-network failure)", () => {
  it("marks the entry failed when the POST endpoint returns a 4xx", async () => {
    __setEngineUploaderForTests(async () => STORAGE_URL);
    __setEngineApiRequestForTests(async () => {
      throw new ApiError(422, "Unprocessable Entity", null);
    });
    __setEngineDeleterForTests(() => undefined);

    const entry = await seedPhotoEntry();
    const result = await attemptEntry(entry);

    assert.equal(result.kind, "failed");

    const [after] = await listEntries();
    assert.equal(after?.status, "failed");
    assert.equal(after?.attempts, 1);
    assert.ok(after?.lastError !== null, "lastError should be set");
  });
});

describe("wet-check-photo drain — missing photo payload guard", () => {
  it("marks the entry failed when the photo payload is null", async () => {
    const entry = await enqueue({
      kind: "wet-check-photo",
      scopeKey: "wc:7",
      path: PHOTO_PATH,
      method: "POST",
      body: null,
      photo: null,
      label: "Broken photo entry",
    });

    __setEngineUploaderForTests(async () => {
      throw new Error("upload should not be called for null payload");
    });
    __setEngineApiRequestForTests(async () => {
      throw new Error("request should not be called for null payload");
    });
    __setEngineDeleterForTests(() => undefined);

    const result = await attemptEntry(entry);

    assert.equal(result.kind, "failed");

    const [after] = await listEntries();
    assert.equal(after?.status, "failed");
  });
});

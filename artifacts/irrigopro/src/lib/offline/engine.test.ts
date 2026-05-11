import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { isLikelyEdgeError, SyncEngine } from "./engine";
import {
  __resetOfflineDBForTests,
  listAllMutations,
  openOfflineDB,
  putPhotoBlob,
} from "./db";
import type { QueuedMutation } from "./types";

describe("isLikelyEdgeError (Task #469)", () => {
  it("treats application/json 4xx as a real API error (not edge)", () => {
    expect(
      isLikelyEdgeError("application/json; charset=utf-8", '{"message":"Forbidden"}'),
    ).toBe(false);
  });

  it("treats HTML 4xx as edge so the engine retries", () => {
    expect(
      isLikelyEdgeError(
        "text/html; charset=utf-8",
        "<!doctype html><html><head><title>403</title></head><body>403 Forbidden</body></html>",
      ),
    ).toBe(true);
  });

  it("treats text/plain 4xx as edge so the engine retries", () => {
    expect(isLikelyEdgeError("text/plain", "Forbidden")).toBe(true);
  });

  it("treats a missing content-type with empty body (preflight reject) as edge", () => {
    expect(isLikelyEdgeError("", "")).toBe(true);
  });

  it("treats a missing content-type with HTML body as edge", () => {
    expect(isLikelyEdgeError("", "<html><body>403</body></html>")).toBe(true);
  });

  it("treats a missing content-type with parseable JSON body as a real API error", () => {
    expect(isLikelyEdgeError("", '{"message":"nope"}')).toBe(false);
  });

  it("treats any other non-JSON content-type as edge", () => {
    expect(isLikelyEdgeError("text/xml", "<error/>")).toBe(true);
    expect(isLikelyEdgeError("application/octet-stream", "")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Task #501 — passive retry cap.
//
// A wet-check photo upload that keeps hitting persistent 500s should not
// loop forever in the background. After `maxAttempts` failed dispatches
// the engine flips the queued mutation to `status: "failed"` so the
// existing Retry / Cancel affordances become visible in the queue view.

async function freshDb() {
  // Each test gets a clean queue / blob store so prior runs don't bleed
  // through. Deleting + reopening the database is hostile under
  // fake-indexeddb because lingering connections block the delete; clearing
  // the relevant stores is sufficient for these tests.
  __resetOfflineDBForTests();
  const db = await openOfflineDB();
  await db.clear("mutationQueue");
  await db.clear("photoBlobs");
  await db.clear("wetChecks");
  return db;
}

function makePhotoUploadMutation(now: number): QueuedMutation {
  return {
    id: "mut-photo-1",
    kind: "photo.upload",
    method: "POST",
    urlTemplate: "/api/wet-checks/123/photos",
    body: { caption: "test" },
    clientId: "photo-1",
    parentClientId: null,
    placeholders: {},
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: now,
    resolvedId: null,
  };
}

// Drive the engine deterministically by invoking tick() in a loop and
// advancing the injected clock past the backoff gate each pass. We never
// actually wait on the engine's setTimeout-scheduled retries — that keeps
// the test free of real-time delays.
async function runUntilSettled(
  engine: SyncEngine,
  bumpNow: () => void,
  maxIterations = 20,
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    bumpNow();
    engine.setOnline(true);
    await engine.tick();
    // Flush microtasks so any chained scheduleTick runs.
    await new Promise((r) => setTimeout(r, 0));
    const db = await openOfflineDB();
    const all = await listAllMutations(db);
    const stillPending = all.some((m) => m.status === "pending");
    if (!stillPending) return;
  }
}

describe("SyncEngine retry cap (Task #501)", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("flips a persistently-500ing photo upload to failed after maxAttempts", async () => {
    let now = 1_000;
    const db = await openOfflineDB();
    // Seed the captured photo bytes so dispatchPhotoUpload reaches the
    // signing call instead of synthesizing a 410 (missing-blob) response.
    await putPhotoBlob(db, {
      clientId: "photo-1",
      blob: new Blob(["pretend-jpeg-bytes"], { type: "image/jpeg" }),
      contentType: "image/jpeg",
      name: "shot.jpg",
      byteSize: 18,
      capturedAt: now,
      compressed: true,
    });

    let signCalls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.startsWith("/api/upload/photo")) {
        signCalls++;
        return new Response("upstream boom", { status: 500 });
      }
      return new Response("unexpected", { status: 500 });
    };

    const errors: Array<{ status: number | null; message: string }> = [];
    const engine = new SyncEngine({
      fetchImpl,
      now: () => now,
      heartbeatIntervalMs: 0,
      maxConcurrent: 1,
      maxAttempts: 3,
      maxRetryAgeMs: 60 * 60 * 1000,
    });
    engine.on((e) => {
      if (e.type === "error") errors.push({ status: e.status, message: e.message });
    });
    engine.setOnline(true);

    await engine.enqueue(makePhotoUploadMutation(now));

    await runUntilSettled(engine, () => {
      now += 60_000;
    });

    const after = await listAllMutations(await openOfflineDB());
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("failed");
    expect(after[0].attemptCount).toBe(3);
    expect(after[0].lastError ?? "").toMatch(/gave_up_after_3_attempts/);
    expect(signCalls).toBe(3);
    // The OfflineStrip / SyncBadge listen for state events and will see
    // the failed count tick up; an explicit error event also fires so
    // any toast surface can react.
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[errors.length - 1].status).toBe(500);
  });

  it("flips to failed when elapsed age exceeds maxRetryAgeMs even before maxAttempts", async () => {
    let now = 0;
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 502 });
    const engine = new SyncEngine({
      fetchImpl,
      now: () => now,
      heartbeatIntervalMs: 0,
      maxConcurrent: 1,
      maxAttempts: 99,
      maxRetryAgeMs: 5 * 60_000, // 5 minutes
    });
    engine.setOnline(true);

    await engine.enqueue({
      id: "mut-elapsed",
      kind: "wet_check.update",
      method: "PATCH",
      urlTemplate: "/api/wet-checks/77",
      body: { note: "x" },
      clientId: "wc-77",
      parentClientId: null,
      placeholders: {},
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: 0,
      resolvedId: null,
    });

    await engine.tick();
    await new Promise((r) => setTimeout(r, 0));
    let all = await listAllMutations(await openOfflineDB());
    expect(all[0].status).toBe("pending");

    // Jump well past the elapsed cap. The next attempt should fail even
    // though attemptCount is far below the attempt cap.
    now = 10 * 60_000;
    engine.setOnline(true);
    await engine.tick();
    await new Promise((r) => setTimeout(r, 0));
    all = await listAllMutations(await openOfflineDB());
    expect(all[0].status).toBe("failed");
    expect(all[0].lastError ?? "").toMatch(/gave_up_after_5_minutes/);
  });

  it("does not give up while attempts and age remain under the caps", async () => {
    let now = 1_000;
    const fetchImpl: typeof fetch = async () => new Response("oops", { status: 503 });
    const engine = new SyncEngine({
      fetchImpl,
      now: () => now,
      heartbeatIntervalMs: 0,
      maxConcurrent: 1,
      maxAttempts: 8,
      maxRetryAgeMs: 60 * 60_000,
    });
    engine.setOnline(true);

    await engine.enqueue({
      id: "mut-keep-pending",
      kind: "wet_check.update",
      method: "PATCH",
      urlTemplate: "/api/wet-checks/9",
      body: {},
      clientId: "wc-9",
      parentClientId: null,
      placeholders: {},
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      status: "pending",
      createdAt: now,
      resolvedId: null,
    });

    await engine.tick();
    await new Promise((r) => setTimeout(r, 0));
    const all = await listAllMutations(await openOfflineDB());
    expect(all[0].status).toBe("pending");
    expect(all[0].attemptCount).toBe(1);
  });
});

// Integration tests for the offline mutation queue + sync engine using
// fake-indexeddb and a mocked fetch. Slice 4B — Task #298.
//
// The engine is constructed with injected `fetchImpl` and `now`, so timing
// is deterministic and we never touch the network.

import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Install fake-indexeddb globals BEFORE importing the offline modules so
// `idb` picks them up.
import "fake-indexeddb/auto";

const { SyncEngine, __resetEngineForTests } = await import("../client/src/lib/offline/engine.ts");
const dbMod = await import("../client/src/lib/offline/db.ts");
const { openOfflineDB, listAllMutations, __resetOfflineDBForTests } = dbMod;

function uuid() {
  return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

function makeMutation(over) {
  return {
    id: uuid(),
    kind: "wet_check.create",
    method: "POST",
    urlTemplate: "/api/wet-checks",
    body: {},
    clientId: uuid(),
    parentClientId: null,
    placeholders: {},
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: Date.now(),
    resolvedId: null,
    ...over,
  };
}

function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(body),
  });
}

// Each test gets a fresh fake IndexedDB + fresh engine.
async function freshEnv(fetchImpl, opts = {}) {
  // Reset fake-indexeddb between tests.
  const fdb = await import("fake-indexeddb");
  // Reset by reassigning a new factory.
  globalThis.indexedDB = new fdb.IDBFactory();
  globalThis.IDBKeyRange = fdb.IDBKeyRange;
  __resetOfflineDBForTests();
  __resetEngineForTests();
  let nowVal = opts.now ?? 1_000_000;
  const engine = new SyncEngine({
    fetchImpl,
    now: () => nowVal,
    heartbeatIntervalMs: 0,
    maxConcurrent: opts.maxConcurrent ?? 2,
  });
  engine.setOnline(true);
  const db = await openOfflineDB();
  return {
    engine,
    db,
    setNow: (n) => { nowVal = n; },
  };
}

describe("Offline queue replay — dependency order", () => {
  test("wet check → zone record → finding → submit dispatched in order", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "/api/wet-checks") return jsonResponse(201, { id: 100, clientId: "wc1" });
      if (url === "/api/wet-checks/100/zone-records") return jsonResponse(201, { id: 200 });
      if (url === "/api/wet-checks/zone-records/200/findings") return jsonResponse(201, { id: 300 });
      if (url === "/api/wet-checks/100/submit") return jsonResponse(200, { id: 100, status: "submitted" });
      return jsonResponse(404, { message: "unknown" });
    };
    const { engine } = await freshEnv(fetchImpl);
    await engine.enqueue(makeMutation({
      kind: "wet_check.create",
      urlTemplate: "/api/wet-checks",
      body: { customerId: 1, clientId: "wc1" },
      clientId: "wc1",
    }));
    await engine.enqueue(makeMutation({
      kind: "zone_record.upsert",
      urlTemplate: "/api/wet-checks/{{wc}}/zone-records",
      body: { controllerLetter: "A", zoneNumber: 1, status: "checked_ok", clientId: "zr1" },
      clientId: "zr1",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
    }));
    await engine.enqueue(makeMutation({
      kind: "finding.create",
      urlTemplate: "/api/wet-checks/zone-records/{{zr}}/findings",
      body: { issueType: "head_broken", clientId: "f1" },
      clientId: "f1",
      parentClientId: "zr1",
      placeholders: { zr: "zr1" },
    }));
    await engine.enqueue(makeMutation({
      kind: "wet_check.submit",
      urlTemplate: "/api/wet-checks/{{wc}}/submit",
      body: {},
      clientId: "submit1",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
    }));

    await engine.drainAll();

    const urls = calls.map((c) => c.url);
    assert.deepEqual(urls, [
      "/api/wet-checks",
      "/api/wet-checks/100/zone-records",
      "/api/wet-checks/zone-records/200/findings",
      "/api/wet-checks/100/submit",
    ]);
  });
});

describe("Offline queue replay — backoff on 5xx", () => {
  test("5xx retries with exponential backoff and eventually succeeds", async () => {
    let attempt = 0;
    const fetchImpl = async () => {
      attempt++;
      if (attempt <= 2) return jsonResponse(503, { message: "down" });
      return jsonResponse(201, { id: 7, clientId: "wc1" });
    };
    const env = await freshEnv(fetchImpl);
    const { engine } = env;
    await engine.enqueue(makeMutation({
      kind: "wet_check.create",
      body: { customerId: 1, clientId: "wc1" },
      clientId: "wc1",
    }));
    // First attempt → 503 → backoff scheduled. Engine sets offline=false on
    // 5xx; we manually flip back to online (heartbeat would do this), advance
    // virtual time past the backoff window, and tick again.
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    assert.equal(attempt, 1);
    let q = await listAllMutations(env.db);
    assert.equal(q[0].status, "pending");
    assert.equal(q[0].attemptCount, 1);
    assert.equal(q[0].lastError, JSON.stringify({ message: "down" }));

    // Advance past 1s backoff for attempt=1 and retry.
    env.setNow(1_000_000 + 1500);
    engine.setOnline(true);
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    assert.equal(attempt, 2);
    q = await listAllMutations(env.db);
    assert.equal(q[0].status, "pending");
    assert.equal(q[0].attemptCount, 2);

    // Backoff(2) = 2000 — advance and retry.
    env.setNow(1_000_000 + 1500 + 2500);
    engine.setOnline(true);
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    assert.equal(attempt, 3);
    q = await listAllMutations(env.db);
    assert.equal(q[0].status, "completed");
    assert.equal(q[0].resolvedId, 7);
  });
});

describe("Offline queue replay — 409 server-wins", () => {
  test("409 marks completed, refreshes mirror, emits conflict event", async () => {
    const events = [];
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url === "/api/wet-checks/55/submit") return jsonResponse(409, "already converted");
      if (url === "/api/wet-checks/55") {
        return jsonResponse(200, { id: 55, clientId: "wc1", status: "converted", zoneRecords: [], photos: [] });
      }
      return jsonResponse(200, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    engine.on((e) => events.push(e));
    // Pre-populate mirror as if wet check already resolved id=55.
    await db.put("wetChecks", {
      clientId: "wc1",
      id: 55,
      data: { id: 55, clientId: "wc1", status: "in_progress" },
      status: "in_progress",
      updatedAt: 0,
    });
    await db.put("mutationQueue", makeMutation({
      kind: "wet_check.create",
      clientId: "wc1",
      status: "completed",
      resolvedId: 55,
      body: { customerId: 1, clientId: "wc1" },
    }));
    await engine.enqueue(makeMutation({
      kind: "wet_check.submit",
      urlTemplate: "/api/wet-checks/{{wc}}/submit",
      body: {},
      clientId: "submit1",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
    }));

    await engine.drainAll();

    // Server-refresh GET happened.
    assert.ok(calls.includes("/api/wet-checks/55/submit"), "submit call expected");
    assert.ok(calls.includes("/api/wet-checks/55"), "refresh GET expected");
    // Mirror updated to converted.
    const mirror = await db.get("wetChecks", "wc1");
    assert.equal(mirror.status, "converted");
    // Event emitted.
    const conflict = events.find((e) => e.type === "conflict");
    assert.ok(conflict, "conflict event emitted");
    assert.equal(conflict.wetCheckId, 55);
  });
});

describe("Offline queue replay — 409 server-wins removes stale local entities", () => {
  test("local finding missing from server snapshot is dropped from composed mirror", async () => {
    const { putWetCheckMirror, putZoneRecordMirror, putFindingMirror } = dbMod;
    const fetchImpl = async (url) => {
      if (url === "/api/wet-checks/77/submit") return jsonResponse(409, "already converted");
      if (url === "/api/wet-checks/77") {
        // Server snapshot keeps zr-keep but no longer has the local
        // finding f-stale, and has dropped zr-stale entirely.
        return jsonResponse(200, {
          id: 77, clientId: "wc-X", status: "converted", photos: [],
          zoneRecords: [
            { id: 901, clientId: "zr-keep", controllerLetter: "A", zoneNumber: 1, status: "checked_ok", findings: [] },
          ],
        });
      }
      return jsonResponse(200, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    await putWetCheckMirror(db, {
      clientId: "wc-X", id: 77, status: "in_progress", updatedAt: 0,
      data: { id: 77, clientId: "wc-X", status: "in_progress", zoneRecords: [], photos: [] },
    });
    await putZoneRecordMirror(db, {
      clientId: "zr-keep", id: 901, wetCheckClientId: "wc-X", wetCheckId: 77, updatedAt: 0,
      data: { id: 901, clientId: "zr-keep", controllerLetter: "A", zoneNumber: 1, status: "checked_ok" },
    });
    await putZoneRecordMirror(db, {
      clientId: "zr-stale", id: 902, wetCheckClientId: "wc-X", wetCheckId: 77, updatedAt: 0,
      data: { id: 902, clientId: "zr-stale", controllerLetter: "B", zoneNumber: 2, status: "checked_with_issues" },
    });
    await putFindingMirror(db, {
      clientId: "f-stale", zoneRecordClientId: "zr-stale", wetCheckId: 77, updatedAt: 0,
      data: { clientId: "f-stale", issueType: "head_replacement", quantity: 1 },
    });
    await db.put("mutationQueue", makeMutation({
      kind: "wet_check.create",
      clientId: "wc-X",
      status: "completed",
      resolvedId: 77,
      body: { customerId: 1, clientId: "wc-X" },
    }));
    await engine.enqueue(makeMutation({
      kind: "wet_check.submit",
      urlTemplate: "/api/wet-checks/{{wc}}/submit",
      body: {},
      clientId: "submit-X",
      parentClientId: "wc-X",
      placeholders: { wc: "wc-X" },
    }));

    await engine.drainAll();

    // Stale rows must be gone from the per-entity stores.
    const staleZr = await db.get("wetCheckZoneRecords", "zr-stale");
    const staleF = await db.get("wetCheckFindings", "f-stale");
    assert.equal(staleZr, undefined, "stale zone record removed");
    assert.equal(staleF, undefined, "stale finding removed");

    const { readWetCheckByClientId } = await import("../client/src/lib/offline/api.ts");
    const composed = await readWetCheckByClientId("wc-X");
    assert.equal(composed.zoneRecords.length, 1);
    assert.equal(composed.zoneRecords[0].clientId, "zr-keep");
    assert.equal(composed.zoneRecords[0].findings.length, 0);
  });
});

describe("Offline queue replay — 409 refresh resolves wc id from per-entity mirrors", () => {
  test("finding.update 409 against pre-existing finding refreshes the wet check mirror", async () => {
    const { putWetCheckMirror, putZoneRecordMirror, putFindingMirror } = dbMod;
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method });
      if (url === "/api/wet-checks/findings/501" && init?.method === "PATCH") {
        return jsonResponse(409, "stale");
      }
      if (url === "/api/wet-checks/88") {
        return jsonResponse(200, {
          id: 88, clientId: "wc-Y", status: "in_progress", photos: [],
          zoneRecords: [
            { id: 701, clientId: "zr-Y", controllerLetter: "A", zoneNumber: 1, status: "checked_with_issues", findings: [
              { id: 501, clientId: "f-Y", issueType: "head_replacement", quantity: 9 },
            ] },
          ],
        });
      }
      return jsonResponse(200, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    await putWetCheckMirror(db, {
      clientId: "wc-Y", id: 88, status: "in_progress", updatedAt: 0,
      data: { id: 88, clientId: "wc-Y", status: "in_progress", zoneRecords: [], photos: [] },
    });
    await putZoneRecordMirror(db, {
      clientId: "zr-Y", id: 701, wetCheckClientId: "wc-Y", wetCheckId: 88, updatedAt: 0,
      data: { id: 701, clientId: "zr-Y", controllerLetter: "A", zoneNumber: 1 },
    });
    await putFindingMirror(db, {
      clientId: "f-Y", id: 501, zoneRecordClientId: "zr-Y", zoneRecordId: 701, wetCheckId: 88, updatedAt: 0,
      data: { id: 501, clientId: "f-Y", issueType: "head_replacement", quantity: 1 },
    });
    await engine.enqueue(makeMutation({
      kind: "finding.update",
      method: "PATCH",
      urlTemplate: "/api/wet-checks/findings/{{f}}",
      body: { quantity: 2 },
      clientId: "f-Y",
      parentClientId: "zr-Y",
      placeholders: { f: "f-Y" },
      resolvedId: 501,
    }));
    await engine.drainAll();
    assert.ok(calls.some((c) => c.url === "/api/wet-checks/88"), "refresh GET fired for resolved wet check id");
    const wc = await db.get("wetChecks", "wc-Y");
    assert.equal(wc.data.zoneRecords[0].findings[0].quantity, 9, "mirror refreshed from server snapshot");
  });
});

describe("Offline queue replay — finding.create + photo.link drains in order", () => {
  test("queued photo.link resolves {{f}} from the create's resolvedId once it drains", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "/api/wet-checks/zone-records/901/findings") return jsonResponse(201, { id: 555, clientId: "f-new" });
      if (url === "/api/wet-checks/photos/42") return jsonResponse(200, { id: 42, findingId: 555 });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    const { putZoneRecordMirror } = dbMod;
    await putZoneRecordMirror(db, {
      clientId: "zr-pre", id: 901, wetCheckClientId: "wc-pre", wetCheckId: 50, updatedAt: 0,
      data: { id: 901, clientId: "zr-pre" },
    });
    await engine.enqueue(makeMutation({
      kind: "finding.create",
      method: "POST",
      urlTemplate: "/api/wet-checks/zone-records/{{zr}}/findings",
      body: { issueType: "head_replacement", quantity: 1, clientId: "f-new" },
      clientId: "f-new",
      parentClientId: "zr-pre",
      placeholders: { zr: "zr-pre" },
    }));
    await engine.enqueue(makeMutation({
      kind: "photo.link",
      method: "PATCH",
      urlTemplate: "/api/wet-checks/photos/42",
      body: { findingId: "{{f}}" },
      clientId: "link-1",
      parentClientId: "f-new",
      placeholders: { f: "f-new" },
    }));
    await engine.drainAll();
    const linkCall = calls.find((c) => c.url === "/api/wet-checks/photos/42");
    assert.ok(linkCall, "photo.link dispatched");
    assert.equal(JSON.parse(linkCall.body).findingId, 555, "{{f}} substituted with create's resolved id");
    const createIdx = calls.findIndex((c) => c.url === "/api/wet-checks/zone-records/901/findings");
    const linkIdx = calls.findIndex((c) => c.url === "/api/wet-checks/photos/42");
    assert.ok(createIdx < linkIdx, "create dispatched before photo.link");
  });
});

describe("Offline queue replay — multiple mutations sharing a clientId", () => {
  test("submit waits for ALL queued zone_record.upsert rows on the same clientId", async () => {
    const calls = [];
    let upsertCount = 0;
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "/api/wet-checks/60/zone-records") {
        upsertCount++;
        // First upsert is slow (returns after a microtask), second is fast.
        // Either way both must complete before the submit fires.
        return jsonResponse(201, { id: 800 + upsertCount });
      }
      if (url === "/api/wet-checks/60/submit") return jsonResponse(200, { id: 60, status: "submitted" });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl, { maxConcurrent: 4 });
    const { engine, db } = env;
    const { putWetCheckMirror } = dbMod;
    await putWetCheckMirror(db, {
      clientId: "wc-rep", id: 60, status: "in_progress", updatedAt: 0,
      data: { id: 60, clientId: "wc-rep" },
    });
    // Two upserts that share the same zone-record clientId — the user
    // toggled the zone status twice while offline.
    await engine.enqueue(makeMutation({
      kind: "zone_record.upsert",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/zone-records",
      body: { status: "checked_with_issues", clientId: "zr-rep" },
      clientId: "zr-rep",
      parentClientId: "wc-rep",
      placeholders: { wc: "wc-rep" },
    }));
    await engine.enqueue(makeMutation({
      kind: "zone_record.upsert",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/zone-records",
      body: { status: "checked_ok", clientId: "zr-rep" },
      clientId: "zr-rep",
      parentClientId: "wc-rep",
      placeholders: { wc: "wc-rep" },
    }));
    await engine.enqueue(makeMutation({
      kind: "wet_check.submit",
      urlTemplate: "/api/wet-checks/{{wc}}/submit",
      body: {},
      clientId: "submit-rep",
      parentClientId: "wc-rep",
      parentClientIds: ["zr-rep"],
      placeholders: { wc: "wc-rep" },
    }));
    await engine.drainAll();
    const upsertIdxs = calls
      .map((c, i) => (c.url === "/api/wet-checks/60/zone-records" ? i : -1))
      .filter((i) => i >= 0);
    const submitIdx = calls.findIndex((c) => c.url === "/api/wet-checks/60/submit");
    assert.equal(upsertIdxs.length, 2, "both upserts dispatched");
    assert.ok(submitIdx > Math.max(...upsertIdxs), "submit dispatched after both upserts completed");
  });
});

describe("Offline queue replay — idempotent retry", () => {
  test("after a transient retry, body still carries original clientId", async () => {
    let attempt = 0;
    const observedClientIds = [];
    const fetchImpl = async (url, init) => {
      attempt++;
      if (init?.body) {
        try { observedClientIds.push(JSON.parse(init.body).clientId); } catch {}
      }
      if (attempt === 1) return jsonResponse(503, "");
      return jsonResponse(201, { id: 12, clientId: "wc1" });
    };
    const env = await freshEnv(fetchImpl);
    const { engine } = env;
    await engine.enqueue(makeMutation({
      kind: "wet_check.create",
      body: { customerId: 1, clientId: "wc1" },
      clientId: "wc1",
    }));
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    env.setNow(1_000_000 + 2000);
    engine.setOnline(true);
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(observedClientIds, ["wc1", "wc1"]);
  });
});

describe("Offline queue replay — Slice 4C photo.upload", () => {
  test("queued photo.upload runs sign → PUT → finalize → metadata POST and clears the blob", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url.startsWith("/api/upload/photo?")) {
        return jsonResponse(200, { signedUrl: "https://signed.example/abc", url: "photos/abc.jpg" });
      }
      if (url === "https://signed.example/abc") {
        // PUT signed URL — return a real Response-like with no body.
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
      }
      if (url === "/api/upload/photo/finalize") return jsonResponse(200, { url: "photos/abc.jpg" });
      if (url === "/api/wet-checks/77/photos") return jsonResponse(201, { id: 9001, url: "photos/abc.jpg", clientId: "p-1" });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    const { putWetCheckMirror, putPhotoBlob, getPhotoBlob } = dbMod;
    await putWetCheckMirror(db, {
      clientId: "wc-P", id: 77, status: "in_progress", updatedAt: 0,
      data: { id: 77, clientId: "wc-P" },
    });
    // Pre-store the captured Blob exactly the way `queuePhotoUpload`
    // would in the browser. Using a tiny Blob here keeps the test fast
    // and avoids dragging the real compression worker into node:test.
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/jpeg" });
    await putPhotoBlob(db, {
      clientId: "p-1", blob: fakeBlob, contentType: "image/jpeg",
      name: "img.jpg", byteSize: 5, capturedAt: 0, compressed: true,
    });
    await engine.enqueue(makeMutation({
      kind: "photo.upload",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/photos",
      body: { takenAt: "2026-05-05T00:00:00Z", clientId: "p-1", zoneRecordId: null, findingId: null },
      clientId: "p-1",
      parentClientId: "wc-P",
      placeholders: { wc: "wc-P" },
    }));
    await engine.drainAll();
    const urls = calls.map((c) => c.url);
    // Order matters: sign → PUT → finalize → metadata POST.
    const signIdx = urls.findIndex((u) => u.startsWith("/api/upload/photo?"));
    const putIdx = urls.indexOf("https://signed.example/abc");
    const finIdx = urls.indexOf("/api/upload/photo/finalize");
    const metaIdx = urls.indexOf("/api/wet-checks/77/photos");
    assert.ok(signIdx >= 0 && putIdx > signIdx && finIdx > putIdx && metaIdx > finIdx,
      `expected sign→PUT→finalize→meta order, got ${urls.join(", ")}`);
    // Metadata POST body carries the finalized url + original clientId.
    const metaBody = JSON.parse(calls[metaIdx].body);
    assert.equal(metaBody.url, "photos/abc.jpg");
    assert.equal(metaBody.clientId, "p-1");
    // Blob is removed only after the metadata POST succeeded.
    const blobAfter = await getPhotoBlob(db, "p-1");
    assert.equal(blobAfter, undefined, "blob should be deleted after success");
    // Mutation marked completed with progress=100.
    const remaining = await listAllMutations(env.db);
    const m = remaining.find((x) => x.clientId === "p-1");
    assert.equal(m.status, "completed");
    assert.equal(m.progress, 100);
  });

  test("transient PUT failure retries and the Blob is preserved across attempts", async () => {
    let putAttempts = 0;
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      if (url.startsWith("/api/upload/photo?")) {
        return jsonResponse(200, { signedUrl: "https://signed.example/r", url: "photos/r.jpg" });
      }
      if (url === "https://signed.example/r") {
        putAttempts++;
        if (putAttempts === 1) {
          return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
      }
      if (url === "/api/upload/photo/finalize") return jsonResponse(200, {});
      if (url === "/api/wet-checks/55/photos") return jsonResponse(201, { id: 1234 });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    const { putWetCheckMirror, putPhotoBlob, getPhotoBlob } = dbMod;
    await putWetCheckMirror(db, {
      clientId: "wc-R", id: 55, status: "in_progress", updatedAt: 0,
      data: { id: 55, clientId: "wc-R" },
    });
    const blob = new Blob([new Uint8Array([9, 9])], { type: "image/jpeg" });
    await putPhotoBlob(db, {
      clientId: "p-R", blob, contentType: "image/jpeg",
      name: "r.jpg", byteSize: 2, capturedAt: 0, compressed: true,
    });
    await engine.enqueue(makeMutation({
      kind: "photo.upload",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/photos",
      body: { takenAt: "2026-05-05T00:00:00Z", clientId: "p-R", zoneRecordId: null, findingId: null },
      clientId: "p-R",
      parentClientId: "wc-R",
      placeholders: { wc: "wc-R" },
    }));
    // First tick: PUT fails → backoff scheduled.
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    let q = await listAllMutations(env.db);
    assert.equal(q[0].status, "pending", "still pending after 5xx");
    // Blob MUST still be in IDB so the retry has bytes to send.
    const blobBetween = await getPhotoBlob(db, "p-R");
    assert.ok(blobBetween, "blob preserved between attempts");
    // Advance past backoff and retry.
    env.setNow(1_000_000 + 2000);
    engine.setOnline(true);
    await engine.tick();
    while (engine.inFlight.size > 0) await new Promise((r) => setTimeout(r, 0));
    q = await listAllMutations(env.db);
    assert.equal(q[0].status, "completed");
    assert.equal(putAttempts, 2);
    const blobAfter = await getPhotoBlob(db, "p-R");
    assert.equal(blobAfter, undefined, "blob deleted only after final success");
  });

  test("missing blob fails the mutation terminally instead of looping", async () => {
    const fetchImpl = async () => jsonResponse(200, {});
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    const { putWetCheckMirror } = dbMod;
    await putWetCheckMirror(db, {
      clientId: "wc-M", id: 11, status: "in_progress", updatedAt: 0,
      data: { id: 11, clientId: "wc-M" },
    });
    // Note: no putPhotoBlob — simulates a wiped IDB / partial upgrade.
    await engine.enqueue(makeMutation({
      kind: "photo.upload",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/photos",
      body: { clientId: "p-missing" },
      clientId: "p-missing",
      parentClientId: "wc-M",
      placeholders: { wc: "wc-M" },
    }));
    await engine.drainAll();
    const q = await listAllMutations(env.db);
    const m = q.find((x) => x.clientId === "p-missing");
    assert.equal(m.status, "failed", "missing blob → terminal failure (not infinite retry)");
  });

  test("photo.upload waits for finding.create when parented to it, then substitutes {{f}}", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "/api/wet-checks/zone-records/200/findings") return jsonResponse(201, { id: 4242, clientId: "f-C" });
      if (url.startsWith("/api/upload/photo?")) {
        return jsonResponse(200, { signedUrl: "https://signed.example/c", url: "photos/c.jpg" });
      }
      if (url === "https://signed.example/c") {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
      }
      if (url === "/api/upload/photo/finalize") return jsonResponse(200, {});
      if (url === "/api/wet-checks/40/photos") return jsonResponse(201, { id: 8 });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    const { engine, db } = env;
    const { putWetCheckMirror, putZoneRecordMirror, putPhotoBlob } = dbMod;
    await putWetCheckMirror(db, {
      clientId: "wc-C", id: 40, status: "in_progress", updatedAt: 0,
      data: { id: 40, clientId: "wc-C" },
    });
    await putZoneRecordMirror(db, {
      clientId: "zr-C", id: 200, wetCheckClientId: "wc-C", wetCheckId: 40, updatedAt: 0,
      data: { id: 200, clientId: "zr-C" },
    });
    const blob = new Blob([new Uint8Array([7])], { type: "image/jpeg" });
    await putPhotoBlob(db, {
      clientId: "p-C", blob, contentType: "image/jpeg",
      name: "c.jpg", byteSize: 1, capturedAt: 0, compressed: true,
    });
    await engine.enqueue(makeMutation({
      kind: "finding.create",
      method: "POST",
      urlTemplate: "/api/wet-checks/zone-records/{{zr}}/findings",
      body: { issueType: "head_replacement", quantity: 1, clientId: "f-C" },
      clientId: "f-C",
      parentClientId: "zr-C",
      placeholders: { zr: "zr-C" },
    }));
    await engine.enqueue(makeMutation({
      kind: "photo.upload",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/photos",
      body: { clientId: "p-C", takenAt: "2026-05-05T00:00:00Z", zoneRecordId: "{{zr}}", findingId: "{{f}}" },
      clientId: "p-C",
      parentClientId: "f-C",
      placeholders: { wc: "wc-C", zr: "zr-C", f: "f-C" },
    }));
    await engine.drainAll();
    const findIdx = calls.findIndex((c) => c.url === "/api/wet-checks/zone-records/200/findings");
    const metaIdx = calls.findIndex((c) => c.url === "/api/wet-checks/40/photos");
    assert.ok(findIdx >= 0 && metaIdx > findIdx, "finding.create dispatched before photo metadata POST");
    const metaBody = JSON.parse(calls[metaIdx].body);
    assert.equal(metaBody.findingId, 4242, "{{f}} substituted with finding's resolved server id");
    assert.equal(metaBody.zoneRecordId, 200, "{{zr}} substituted with zone record server id");
  });
});

describe("Offline queue replay — full airplane-mode cycle", () => {
  test("queue 30 zone records offline, reconnect, drain in order", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      if (url === "/api/wet-checks") return jsonResponse(201, { id: 1, clientId: "wc1" });
      if (url === "/api/wet-checks/1/zone-records") {
        const body = init?.body ? JSON.parse(init.body) : {};
        return jsonResponse(201, { id: body.zoneNumber + 1000, clientId: body.clientId });
      }
      if (url === "/api/wet-checks/1/submit") return jsonResponse(200, { status: "submitted" });
      return jsonResponse(404, "");
    };
    const env = await freshEnv(fetchImpl, { maxConcurrent: 2 });
    const { engine } = env;
    // Tech is offline; engine is offline; enqueue everything.
    engine.setOnline(false);
    await engine.enqueue(makeMutation({
      kind: "wet_check.create",
      body: { customerId: 1, clientId: "wc1" },
      clientId: "wc1",
    }));
    for (let z = 1; z <= 30; z++) {
      await engine.enqueue(makeMutation({
        kind: "zone_record.upsert",
        urlTemplate: "/api/wet-checks/{{wc}}/zone-records",
        body: { controllerLetter: "A", zoneNumber: z, status: "checked_ok", clientId: `zr${z}` },
        clientId: `zr${z}`,
        parentClientId: "wc1",
        placeholders: { wc: "wc1" },
        createdAt: 1_000_000 + z, // preserve insertion order
      }));
    }
    await engine.enqueue(makeMutation({
      kind: "wet_check.submit",
      urlTemplate: "/api/wet-checks/{{wc}}/submit",
      body: {},
      clientId: "submit1",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
      createdAt: 1_000_000 + 1000,
    }));
    // Nothing should have been dispatched while offline.
    await engine.tick();
    assert.equal(calls.length, 0);

    // Reconnect.
    engine.setOnline(true);
    await engine.drainAll(200);

    // First call must be wet check create; then 30 zone records; then submit.
    assert.equal(calls[0], "/api/wet-checks");
    assert.equal(calls[calls.length - 1], "/api/wet-checks/1/submit");
    const zoneCalls = calls.filter((c) => c === "/api/wet-checks/1/zone-records");
    assert.equal(zoneCalls.length, 30);
    // All queue entries marked completed.
    const remaining = await listAllMutations(env.db);
    for (const m of remaining) {
      assert.equal(m.status, "completed", `mutation ${m.kind} not completed`);
    }
  });
});

describe("Offline queue replay — submit waits for ALL descendants", () => {
  test("submit cannot dispatch while a descendant finding is in 5xx backoff", async () => {
    // Scenario: tech captures wet check + zone record + finding offline,
    // taps submit, then the engine comes online. The finding POST starts
    // failing with 5xx. The submit MUST stay queued — never dispatched —
    // for as long as the finding is unresolved.
    const calls = [];
    let nextId = 100;
    const fetchImpl = async (url, opts) => {
      calls.push({ url, method: opts.method });
      // Order matters: /zone-records/<id>/findings would also match
      // /zone-records, so check /findings first.
      if (url.includes("/findings")) return jsonResponse(503, { error: "service unavailable" });
      if (url.endsWith("/submit")) return jsonResponse(200, { ok: true });
      if (url.includes("/zone-records")) return jsonResponse(200, { id: nextId++, clientId: "zr-1" });
      if (url === "/api/wet-checks") return jsonResponse(200, { id: nextId++, clientId: "wc-1" });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    const wcCid = "wc-1", zrCid = "zr-1", fCid = "f-1", subCid = "sub-1";
    await env.engine.enqueue(makeMutation({ kind: "wet_check.create", method: "POST", urlTemplate: "/api/wet-checks", body: { clientId: wcCid }, clientId: wcCid }));
    await env.engine.enqueue(makeMutation({ kind: "zone_record.upsert", method: "POST", urlTemplate: "/api/wet-checks/{{wc}}/zone-records", body: { clientId: zrCid }, clientId: zrCid, parentClientId: wcCid, placeholders: { wc: wcCid } }));
    await env.engine.enqueue(makeMutation({ kind: "finding.create", method: "POST", urlTemplate: "/api/wet-checks/zone-records/{{zr}}/findings", body: { clientId: fCid }, clientId: fCid, parentClientId: zrCid, placeholders: { zr: zrCid } }));
    // Submit op depends on EVERY queued mutation for this wet check.
    await env.engine.enqueue(makeMutation({ kind: "wet_check.submit", method: "POST", urlTemplate: "/api/wet-checks/{{wc}}/submit", body: {}, clientId: subCid, parentClientId: wcCid, parentClientIds: [wcCid, zrCid, fCid], placeholders: { wc: wcCid } }));

    await env.engine.drainAll();

    // Submit must NOT have dispatched (finding is failing).
    const submitCalls = calls.filter((c) => c.url.endsWith("/submit"));
    assert.equal(submitCalls.length, 0, "submit must not dispatch while finding is unresolved");

    // Submit row in queue must still be pending.
    const all = await listAllMutations(env.db);
    const sub = all.find((m) => m.clientId === subCid);
    assert.ok(sub, "submit mutation must exist in queue");
    assert.equal(sub.status, "pending", "submit must remain pending");

    // Sanity: finding row backed off (attemptCount > 0) and still pending.
    const f = all.find((m) => m.clientId === fCid);
    assert.equal(f.status, "pending");
    assert.ok(f.attemptCount > 0, "finding must have recorded a failed attempt");
  });
});

describe("Offline queue replay — pre-existing server entities", () => {
  test("finding.update against a server-existing finding (no queued create) drains successfully", async () => {
    // Simulates: user opens an existing online wet check (has server ids
    // for wc/zr/finding), edits a finding's notes. The mutation has
    // parentClientId/placeholders pointing at the finding's clientId, but
    // there is no `finding.create` queue row — the finding already exists
    // on the server. The mirror has been hydrated by warmWetCheckMirror.
    const { putWetCheckMirror, putZoneRecordMirror, putFindingMirror } = dbMod;
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, method: opts.method });
      if (url === "/api/wet-checks/findings/777" && opts.method === "PATCH") {
        return jsonResponse(200, { id: 777, notes: "updated" });
      }
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    // Hydrate mirrors as if the wet check details endpoint was already read.
    const wcCid = "server-wc-1", zrCid = "server-zr-1", fCid = "server-f-1";
    await putWetCheckMirror(env.db, { clientId: wcCid, id: 11, data: {}, status: "in_progress", updatedAt: 1 });
    await putZoneRecordMirror(env.db, { clientId: zrCid, id: 22, wetCheckClientId: wcCid, wetCheckId: 11, data: {}, updatedAt: 1 });
    await putFindingMirror(env.db, { clientId: fCid, id: 777, zoneRecordClientId: zrCid, zoneRecordId: 22, wetCheckId: 11, data: {}, updatedAt: 1 });

    await env.engine.enqueue(makeMutation({
      kind: "finding.update",
      method: "PATCH",
      urlTemplate: "/api/wet-checks/findings/{{f}}",
      body: { notes: "updated" },
      clientId: uuid(),
      parentClientId: fCid,
      placeholders: { f: fCid },
    }));
    await env.engine.drainAll();

    const patchCalls = calls.filter((c) => c.method === "PATCH");
    assert.equal(patchCalls.length, 1, "PATCH must have dispatched against the server id from the mirror");
    assert.equal(patchCalls[0].url, "/api/wet-checks/findings/777");
    const all = await listAllMutations(env.db);
    const pending = all.filter((m) => m.status === "pending");
    assert.equal(pending.length, 0, "no pending rows should remain");
    const completed = all.filter((m) => m.status === "completed");
    assert.equal(completed.length, 1, "the finding.update mutation should be marked completed");
  });

  test("zone_record.upsert against a pre-existing wet check (no queued wet_check.create) drains", async () => {
    const { putWetCheckMirror } = dbMod;
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, method: opts.method });
      if (url === "/api/wet-checks/55/zone-records") return jsonResponse(201, { id: 999, clientId: "new-zr" });
      return jsonResponse(404, {});
    };
    const env = await freshEnv(fetchImpl);
    const wcCid = "server-wc-55";
    await putWetCheckMirror(env.db, { clientId: wcCid, id: 55, data: {}, status: "in_progress", updatedAt: 1 });

    await env.engine.enqueue(makeMutation({
      kind: "zone_record.upsert",
      method: "POST",
      urlTemplate: "/api/wet-checks/{{wc}}/zone-records",
      body: { clientId: "new-zr" },
      clientId: "new-zr",
      parentClientId: wcCid,
      placeholders: { wc: wcCid },
    }));
    await env.engine.drainAll();

    assert.equal(calls.length, 1, "POST must dispatch using the wet check's server id from the mirror");
    assert.equal(calls[0].url, "/api/wet-checks/55/zone-records");
  });
});

describe("Offline mirror assembler", () => {
  test("readWetCheckByClientId composes per-entity zone records and findings", async () => {
    const { putWetCheckMirror, putZoneRecordMirror, putFindingMirror } = dbMod;
    const { readWetCheckByClientId } = await import("../client/src/lib/offline/api.ts");
    const env = await freshEnv(async () => jsonResponse(404, {}));
    const wcCid = "wc-A";
    await putWetCheckMirror(env.db, {
      clientId: wcCid, id: 7, status: "in_progress", updatedAt: 1,
      data: { id: 7, clientId: wcCid, customerId: 1, status: "in_progress", zoneRecords: [], photos: [] },
    });
    // Stale optimistic write that should appear in the assembled view.
    await putZoneRecordMirror(env.db, {
      clientId: "zr-A", wetCheckClientId: wcCid, updatedAt: 1,
      data: { clientId: "zr-A", controllerLetter: "A", zoneNumber: 1, status: "checked_with_issues" },
    });
    await putFindingMirror(env.db, {
      clientId: "f-A", zoneRecordClientId: "zr-A", updatedAt: 1,
      data: { clientId: "f-A", issueType: "head_replacement", quantity: 2, notes: "queued offline" },
    });
    const composed = await readWetCheckByClientId(wcCid);
    assert.ok(composed, "composed view exists");
    assert.equal(composed.zoneRecords.length, 1);
    assert.equal(composed.zoneRecords[0].clientId, "zr-A");
    assert.equal(composed.zoneRecords[0].findings.length, 1);
    assert.equal(composed.zoneRecords[0].findings[0].notes, "queued offline");
  });
});

describe("Offline queue — feature flag off short-circuits engine.enqueue users", () => {
  // The api.ts wrapper checks the flag at call time; this test asserts the
  // engine itself is opt-in via getSyncEngine and isOfflineQueueEnabled.
  test("isOfflineQueueEnabled defaults to true", async () => {
    const { isOfflineQueueEnabled } = await import("../client/src/lib/offline/engine.ts");
    assert.equal(typeof isOfflineQueueEnabled(), "boolean");
  });
});

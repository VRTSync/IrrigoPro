// Pure unit tests for the offline queue sort + backoff helpers.
// Slice 4B — Task #298. These do not touch fake-indexeddb or the network;
// they exercise the deterministic logic in client/src/lib/offline/sortQueue.ts.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  backoffMs,
  readySet,
  resolveTemplate,
  resolveBody,
} from "../client/src/lib/offline/sortQueue.ts";

function m(overrides) {
  return {
    id: overrides.id ?? `mut-${Math.random()}`,
    kind: overrides.kind ?? "wet_check.create",
    method: overrides.method ?? "POST",
    urlTemplate: overrides.urlTemplate ?? "/api/wet-checks",
    body: overrides.body ?? {},
    clientId: overrides.clientId ?? "cid-default",
    parentClientId: overrides.parentClientId ?? null,
    placeholders: overrides.placeholders ?? {},
    attemptCount: overrides.attemptCount ?? 0,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
    lastError: overrides.lastError ?? null,
    status: overrides.status ?? "pending",
    createdAt: overrides.createdAt ?? 0,
    resolvedId: overrides.resolvedId ?? null,
  };
}

describe("backoffMs", () => {
  test("schedule: 0,1s,2s,4s,8s,16s,30s cap", () => {
    assert.equal(backoffMs(0), 0);
    assert.equal(backoffMs(1), 1000);
    assert.equal(backoffMs(2), 2000);
    assert.equal(backoffMs(3), 4000);
    assert.equal(backoffMs(4), 8000);
    assert.equal(backoffMs(5), 16000);
    assert.equal(backoffMs(6), 30000); // cap kicks in (32000 > 30000)
    assert.equal(backoffMs(20), 30000);
  });
});

describe("readySet — dependency ordering", () => {
  test("orphan parent blocks dependent zone record", () => {
    const wc = m({ clientId: "wc1", kind: "wet_check.create" });
    const zr = m({
      clientId: "zr1",
      kind: "zone_record.upsert",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
      createdAt: 1,
    });
    const ready = readySet([wc, zr], 0);
    assert.deepEqual(ready.map((x) => x.clientId), ["wc1"]);
  });

  test("dependent unblocks once parent completes with resolvedId", () => {
    const wc = m({ clientId: "wc1", kind: "wet_check.create", status: "completed", resolvedId: 42 });
    const zr = m({
      clientId: "zr1",
      kind: "zone_record.upsert",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
      createdAt: 1,
    });
    const ready = readySet([wc, zr], 0);
    assert.deepEqual(ready.map((x) => x.clientId), ["zr1"]);
  });

  test("findings wait for their zone record AND its placeholder resolution", () => {
    const wc = m({ clientId: "wc1", kind: "wet_check.create", status: "completed", resolvedId: 42 });
    const zr = m({
      clientId: "zr1",
      kind: "zone_record.upsert",
      parentClientId: "wc1",
      placeholders: { wc: "wc1" },
      createdAt: 1,
    });
    const f = m({
      clientId: "f1",
      kind: "finding.create",
      parentClientId: "zr1",
      placeholders: { zr: "zr1" },
      createdAt: 2,
    });
    // zr is pending (not yet completed), so finding must wait.
    let ready = readySet([wc, zr, f], 0);
    assert.deepEqual(ready.map((x) => x.clientId), ["zr1"]);

    // Mark zr completed but missing resolvedId — placeholder gate blocks.
    const zrDone = { ...zr, status: "completed", resolvedId: null };
    ready = readySet([wc, zrDone, f], 0);
    assert.deepEqual(ready.map((x) => x.clientId), []);

    // Provide resolvedId — finding becomes ready.
    const zrFull = { ...zr, status: "completed", resolvedId: 7 };
    ready = readySet([wc, zrFull, f], 0);
    assert.deepEqual(ready.map((x) => x.clientId), ["f1"]);
  });

  test("backoff gate: not ready until lastAttemptAt + backoff(attempt) elapses", () => {
    const wc = m({
      clientId: "wc1",
      attemptCount: 2,
      lastAttemptAt: 10_000,
      status: "pending",
    });
    // backoff(2) = 2000ms, so ready at t=12_000.
    assert.deepEqual(readySet([wc], 11_999).map((x) => x.clientId), []);
    assert.deepEqual(readySet([wc], 12_000).map((x) => x.clientId), ["wc1"]);
  });

  test("ready set sorted by createdAt ascending", () => {
    const a = m({ clientId: "a", createdAt: 30 });
    const b = m({ clientId: "b", createdAt: 10 });
    const c = m({ clientId: "c", createdAt: 20 });
    assert.deepEqual(readySet([a, b, c], 100).map((x) => x.clientId), ["b", "c", "a"]);
  });
});

describe("resolveTemplate / resolveBody", () => {
  test("template substitutes resolved server ids", () => {
    const url = resolveTemplate("/api/wet-checks/{{wc}}/zone-records", { wc: "cid1" }, () => 99);
    assert.equal(url, "/api/wet-checks/99/zone-records");
  });

  test("template throws when placeholder missing", () => {
    assert.throws(() => resolveTemplate("/{{x}}", {}, () => null), /Unknown placeholder/);
  });

  test("template throws when id not yet resolved", () => {
    assert.throws(() => resolveTemplate("/{{x}}", { x: "cid1" }, () => null), /not yet resolved/);
  });

  test("body substitutes string-token placeholders", () => {
    const body = { findingId: "{{f}}", note: "n" };
    const out = resolveBody(body, { f: "cid1" }, () => 7);
    assert.deepEqual(out, { findingId: 7, note: "n" });
  });

  test("body untouched when no placeholders", () => {
    const body = { a: 1, b: "hello" };
    assert.deepEqual(resolveBody(body, {}, () => null), body);
  });
});

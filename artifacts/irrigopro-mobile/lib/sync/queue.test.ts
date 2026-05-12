// Task #521 — Offline queue auth-failure auto-replay regression tests.
//
// Locks in the contract for `resetAuthFailedEntries`:
//
//   1. Entries explicitly tagged with `failureReason: "auth"` (the
//      post-Task #521 shape) flip back to pending and clear lastError.
//   2. Legacy rows persisted by older builds (no failureReason field,
//      just an auth-shaped lastError string) are also reset so an
//      upgrade doesn't strand them.
//   3. Failed entries that are NOT auth failures (e.g. 500s, validation
//      errors) are left alone.
//   4. `markAllPending` (Force Resync) clears the failureReason tag too.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Swap AsyncStorage for an in-memory map BEFORE the queue module loads
// any state that depends on it.
import {
  __setQueueStorageForTests,
  __resetQueueStateForTests,
  enqueue,
  listEntries,
  markAllPending,
  resetAuthFailedEntries,
  setActiveSession,
  updateEntry,
} from "./queue";

const memory = new Map<string, string>();
__setQueueStorageForTests({
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => {
    memory.set(key, value);
  },
});

beforeEach(async () => {
  memory.clear();
  __resetQueueStateForTests();
  await setActiveSession("u1");
});

describe("resetAuthFailedEntries (Task #521)", () => {
  it("resets entries tagged with failureReason=auth back to pending", async () => {
    const entry = await enqueue({
      scopeKey: "wc:1",
      kind: "wet-check",
      path: "/api/wet-checks/1/findings",
      method: "POST",
      body: { foo: "bar" },
      photo: null,
      label: "Add finding",
    });
    await updateEntry(entry.id, {
      status: "failed",
      attempts: 3,
      lastError: "Request failed (401)",
      failureReason: "auth",
    });

    const reset = await resetAuthFailedEntries();
    assert.equal(reset, 1);
    const after = (await listEntries()).find((e) => e.id === entry.id)!;
    assert.equal(after.status, "pending");
    assert.equal(after.lastError, null);
    assert.equal(after.failureReason, null);
    // Persisted to (mocked) storage.
    const persisted = JSON.parse(memory.get("irrigopro.sync.queue.v3.u1")!) as Array<{
      id: string;
      status: string;
    }>;
    assert.equal(persisted.find((e) => e.id === entry.id)!.status, "pending");
  });

  it("resets legacy rows (no failureReason field) when lastError looks like an auth failure", async () => {
    const entry = await enqueue({
      scopeKey: "bs:42",
      kind: "billing-sheet",
      path: "/api/billing-sheets/42",
      method: "PATCH",
      body: { foo: "bar" },
      photo: null,
      label: "Edit sheet",
    });
    // Simulate a row written by a pre-Task #521 build: no failureReason.
    await updateEntry(entry.id, {
      status: "failed",
      attempts: 1,
      lastError: "Authentication required",
    });
    // Strip the field so the row truly looks legacy.
    memory.set(
      "irrigopro.sync.queue.v3.u1",
      JSON.stringify(
        (await listEntries()).map((e) => {
          const { failureReason: _ignored, ...rest } = e;
          return rest;
        }),
      ),
    );
    __resetQueueStateForTests();
    await setActiveSession("u1");

    const reset = await resetAuthFailedEntries();
    assert.equal(reset, 1);
    const after = (await listEntries()).find((e) => e.id === entry.id)!;
    assert.equal(after.status, "pending");
  });

  it("leaves non-auth failures alone", async () => {
    const entry = await enqueue({
      scopeKey: "wc:9",
      kind: "wet-check",
      path: "/api/wet-checks/9",
      method: "PATCH",
      body: null,
      photo: null,
      label: "Edit",
    });
    await updateEntry(entry.id, {
      status: "failed",
      attempts: 2,
      lastError: "Request failed (500)",
      failureReason: null,
    });

    const reset = await resetAuthFailedEntries();
    assert.equal(reset, 0);
    const after = (await listEntries()).find((e) => e.id === entry.id)!;
    assert.equal(after.status, "failed");
    assert.equal(after.lastError, "Request failed (500)");
  });

  it("returns 0 when nothing matches", async () => {
    const reset = await resetAuthFailedEntries();
    assert.equal(reset, 0);
  });
});

describe("markAllPending also clears failureReason (Task #521)", () => {
  it("blanks out failureReason on Force Resync", async () => {
    const entry = await enqueue({
      scopeKey: "wc:1",
      kind: "wet-check",
      path: "/api/wet-checks/1",
      method: "POST",
      body: null,
      photo: null,
      label: "x",
    });
    await updateEntry(entry.id, {
      status: "failed",
      attempts: 1,
      lastError: "Request failed (401)",
      failureReason: "auth",
    });
    await markAllPending();
    const after = (await listEntries()).find((e) => e.id === entry.id)!;
    assert.equal(after.status, "pending");
    assert.equal(after.failureReason, null);
    assert.equal(after.lastError, null);
  });
});

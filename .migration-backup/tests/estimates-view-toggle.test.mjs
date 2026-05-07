/**
 * Tests for Task #374 — Slice 10c Board↔List view toggle persistence.
 *
 * The estimates page persists the selected view ("board" or "list") via
 * the safeStorage wrapper so that a Safari Private Browsing user (who has
 * a 0-byte localStorage quota) still gets a working session. These tests
 * pin down both the wrapper's fallback behavior and the read/write
 * pattern the page uses to choose the initial view.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const VIEW_PREF_KEY = "estimates_view_preference";

function makeMemoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
    _dump: () => Object.fromEntries(data),
  };
}

function makeQuotaExceededStorage() {
  return {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => {},
  };
}

let safeGet, safeSet, safeRemove;

async function importSafeStorageFresh() {
  // tsx imports are cached; cache-bust with a query string so each test
  // re-evaluates the module against the freshly stubbed globals.
  const mod = await import(
    `../client/src/utils/safeStorage.ts?t=${Date.now()}-${Math.random()}`
  );
  safeGet = mod.safeGet;
  safeSet = mod.safeSet;
  safeRemove = mod.safeRemove;
}

describe("safeStorage view-toggle persistence (Slice 10c)", () => {
  beforeEach(() => {
    globalThis.localStorage = makeMemoryStorage();
    globalThis.sessionStorage = makeMemoryStorage();
  });

  test("initial read with no stored value returns null (board is the page default)", async () => {
    await importSafeStorageFresh();
    assert.equal(safeGet(VIEW_PREF_KEY), null);
  });

  test("safeSet writes to localStorage and safeGet reads it back", async () => {
    await importSafeStorageFresh();
    safeSet(VIEW_PREF_KEY, "list");
    assert.equal(globalThis.localStorage.getItem(VIEW_PREF_KEY), "list");
    assert.equal(safeGet(VIEW_PREF_KEY), "list");
  });

  test("toggling list → board persists the new value", async () => {
    await importSafeStorageFresh();
    safeSet(VIEW_PREF_KEY, "list");
    safeSet(VIEW_PREF_KEY, "board");
    assert.equal(safeGet(VIEW_PREF_KEY), "board");
  });

  test("Safari Private Browsing fallback: setItem throws → sessionStorage takes over", async () => {
    globalThis.localStorage = makeQuotaExceededStorage();
    globalThis.sessionStorage = makeMemoryStorage();
    await importSafeStorageFresh();
    safeSet(VIEW_PREF_KEY, "list");
    assert.equal(globalThis.sessionStorage.getItem(VIEW_PREF_KEY), "list");
    assert.equal(safeGet(VIEW_PREF_KEY), "list");
  });

  test("safeRemove clears both storages", async () => {
    await importSafeStorageFresh();
    safeSet(VIEW_PREF_KEY, "list");
    globalThis.sessionStorage.setItem(VIEW_PREF_KEY, "list");
    safeRemove(VIEW_PREF_KEY);
    assert.equal(safeGet(VIEW_PREF_KEY), null);
  });
});

describe("Estimates page initial-view selection", () => {
  // Mirrors the inline selector in client/src/pages/estimates.tsx:
  //   const stored = safeGet(VIEW_PREF_KEY);
  //   return stored === "list" ? "list" : "board";
  function pickInitialView(stored) {
    return stored === "list" ? "list" : "board";
  }

  test("missing storage value defaults to board", () => {
    assert.equal(pickInitialView(null), "board");
  });

  test("'list' restores the list view", () => {
    assert.equal(pickInitialView("list"), "list");
  });

  test("'board' (or any other value) returns board", () => {
    assert.equal(pickInitialView("board"), "board");
    assert.equal(pickInitialView("nonsense"), "board");
  });
});

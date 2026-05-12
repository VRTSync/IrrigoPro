// Persist a small whitelist of read-side queries to AsyncStorage so the
// app opens to real data offline (Task #493 / M8 step 5).
//
// Whitelist:
//   * ["work-orders","by-technician", techId]   — Today's work orders.
//   * ["wet-checks","open", techId]              — Open wet checks list.
//   * ["wet-check", id]                          — Last-loaded wet checks.
//   * ["wet-check","issue-types"]                — Issue type catalog.
//   * ["parts","field-tech"]                     — Parts catalog.
//
// **Per-user isolation.** The storage key is namespaced by the active
// session id (set via `setActiveCacheSession`). On sign-out we clear
// the previous user's persisted snapshot AND the in-memory cache so
// the next tech to sign in never sees data from the previous session.
//
// We intentionally do NOT persist mutation cache state — every in-
// flight mutation is captured in the durable offline queue instead, so
// React Query restarting from a clean mutation cache after a relaunch
// is fine.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";

const STORAGE_KEY_BASE = "irrigopro.qcache.v2";
const ANON_SESSION = "_anon";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_DELAY_MS = 800;

let activeSession: string = ANON_SESSION;

function storageKey(): string {
  return `${STORAGE_KEY_BASE}.${activeSession}`;
}

type PersistedEntry = {
  key: unknown[];
  data: unknown;
  ts: number;
};

function isWhitelisted(key: readonly unknown[]): boolean {
  if (!Array.isArray(key) || key.length === 0) return false;
  const k0 = key[0];
  const k1 = key[1];
  if (k0 === "work-orders" && k1 === "by-technician") return true;
  if (k0 === "wet-checks" && k1 === "open") return true;
  if (k0 === "wet-check" && (k1 === "issue-types" || typeof k1 === "number")) {
    return true;
  }
  if (k0 === "parts" && k1 === "field-tech") return true;
  return false;
}

export async function hydrateQueryClient(qc: QueryClient): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(storageKey());
    if (!raw) return;
    const entries = JSON.parse(raw) as PersistedEntry[];
    if (!Array.isArray(entries)) return;
    const now = Date.now();
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.key)) continue;
      if (entry.data === undefined || entry.data === null) continue;
      if (now - entry.ts > TTL_MS) continue;
      qc.setQueryData(entry.key, entry.data);
    }
  } catch {
    /* corrupt/missing cache is non-fatal */
  }
}

export function attachQueryPersistence(qc: QueryClient): () => void {
  const cache = qc.getQueryCache();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const out: PersistedEntry[] = [];
    for (const q of cache.getAll()) {
      const data = q.state.data;
      if (data === undefined) continue;
      const key = q.queryKey;
      if (!isWhitelisted(key as readonly unknown[])) continue;
      out.push({
        key: [...(key as readonly unknown[])],
        data,
        ts: q.state.dataUpdatedAt || Date.now(),
      });
    }
    AsyncStorage.setItem(storageKey(), JSON.stringify(out)).catch(
      () => undefined,
    );
  };

  const unsub = cache.subscribe(() => {
    if (timer) return;
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  });

  return () => {
    unsub();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export async function clearPersistedCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey());
  } catch {
    /* best-effort */
  }
}

/**
 * Switch to the cache namespace for the given session id. Called from
 * `useSyncEngine` whenever the authenticated user changes. The
 * previous session's in-memory React Query cache is wiped and the new
 * session's persisted snapshot is hydrated.
 */
export async function setActiveCacheSession(
  qc: QueryClient,
  sessionId: string | null,
): Promise<void> {
  const next = sessionId ?? ANON_SESSION;
  if (activeSession === next) return;
  // Clear in-memory state from the previous session before rebinding,
  // so a re-render between switch and hydrate doesn't briefly show the
  // wrong user's data.
  qc.clear();
  activeSession = next;
  await hydrateQueryClient(qc);
}

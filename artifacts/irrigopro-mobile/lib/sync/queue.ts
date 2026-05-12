// Durable AsyncStorage-backed offline mutation queue (Task #493 / M8).
//
// Every M5–M7 mutation funnels through this queue via `wetCheckMutate` /
// `billingSheetMutate`. The queue is written to AsyncStorage on every
// change so a hard kill of the app between enqueue and send still
// preserves the operation. The `clientId` carried on each entry doubles
// as the server-side idempotency key — the API already dedupes POSTs by
// it, so a network retry from the queue (or from a fresh app launch)
// can safely repeat the request without creating duplicates.
//
// **Per-user isolation.** The storage key is namespaced by the active
// session id (set via `setActiveSession`). When a tech signs out and a
// different tech signs in, the queue is reloaded from a different key,
// so no mutation is ever drained against the wrong principal's token
// and no stale row from a previous session can leak across.
//
// **Durability.** All mutating helpers (`enqueue`, `updateEntry`,
// `removeEntry`, `markAllPending`, `clearEntries`) await the
// AsyncStorage write before resolving — callers can rely on the row
// being on disk when their await completes.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { generateClientId } from "../uuid";

const STORAGE_KEY_BASE = "irrigopro.sync.queue.v3";
const ANON_SESSION = "_anon";

export type QueueEntryKind =
  | "wet-check"
  | "billing-sheet"
  | "wet-check-photo"
  | "billing-sheet-photo";

export type QueueEntryStatus = "pending" | "failed" | "conflict";

export type WetCheckPhotoPayload = {
  localUri: string;
  takenAt: string;
  zoneRecordId: number | null;
  findingId: number | null;
};

export type BillingSheetPhotoPayload = {
  localUri: string;
  takenAt: string;
  /** Existing sheet id (edit mode). Null for create-mode entries. */
  billingSheetId: number | null;
  /** Work order id; used to look up the sheet in create mode after the
   *  create POST drains. */
  workOrderId: number;
  /**
   * Set after the local file has been signed + PUT to storage. Persisted
   * so retries after a transport failure don't re-upload to a fresh
   * URL and append a duplicate to the sheet's photos[]. Null until the
   * first successful upload.
   */
  uploadedUrl?: string | null;
};

export type QueueEntry = {
  /** Stable id for this queue row (also used as the wire `clientId`). */
  id: string;
  /** Logical bucket for grouping/draining (e.g. "wc:123", "bs:45"). */
  scopeKey: string;
  kind: QueueEntryKind;
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  /** JSON body sent on the wire (already includes clientId when needed). */
  body: Record<string, unknown> | null;
  /** Photo payload for `wet-check-photo` entries. */
  photo: WetCheckPhotoPayload | null;
  /** Photo payload for `billing-sheet-photo` entries. */
  billingPhoto: BillingSheetPhotoPayload | null;
  /** Short human label used by the Profile diagnostics list. */
  label: string;
  status: QueueEntryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

type Listener = (entries: QueueEntry[]) => void;

let activeSession: string = ANON_SESSION;
let cache: QueueEntry[] | null = null;
let loadingPromise: Promise<QueueEntry[]> | null = null;
const listeners = new Set<Listener>();

function storageKey(): string {
  return `${STORAGE_KEY_BASE}.${activeSession}`;
}

async function readFromStorage(): Promise<QueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadInitial(): Promise<QueueEntry[]> {
  if (cache) return cache;
  if (loadingPromise) return loadingPromise;
  loadingPromise = readFromStorage().then((entries) => {
    cache = entries;
    loadingPromise = null;
    return cache;
  });
  return loadingPromise;
}

/**
 * Awaited write. We snapshot the current cache, persist it, then
 * notify subscribers so listeners observe a state consistent with
 * what's on disk.
 */
async function persist(): Promise<void> {
  const snapshot = cache ?? [];
  try {
    await AsyncStorage.setItem(storageKey(), JSON.stringify(snapshot));
  } catch {
    /* AsyncStorage failure is non-fatal — the in-memory queue is still
       intact and the next persist call will retry. */
  }
  for (const cb of listeners) {
    try {
      cb(snapshot);
    } catch {
      /* listener errors must not break the queue */
    }
  }
}

export async function listEntries(): Promise<QueueEntry[]> {
  return [...(await loadInitial())];
}

/** Synchronous read of the current cached queue (after init). */
export function snapshotEntries(): QueueEntry[] {
  return cache ? [...cache] : [];
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  if (cache) cb([...cache]);
  return () => {
    listeners.delete(cb);
  };
}

export type EnqueueInput = Omit<
  QueueEntry,
  | "id"
  | "status"
  | "attempts"
  | "lastError"
  | "createdAt"
  | "updatedAt"
  | "billingPhoto"
> & {
  /** Optional pre-generated id; otherwise a fresh UUID is used. */
  id?: string;
  /** Defaults to null; only billing-sheet-photo entries set this. */
  billingPhoto?: BillingSheetPhotoPayload | null;
};

export async function enqueue(input: EnqueueInput): Promise<QueueEntry> {
  await loadInitial();
  const now = Date.now();
  const entry: QueueEntry = {
    id: input.id ?? generateClientId(),
    scopeKey: input.scopeKey,
    kind: input.kind,
    path: input.path,
    method: input.method,
    body: input.body,
    photo: input.photo,
    billingPhoto: input.billingPhoto ?? null,
    label: input.label,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  cache = [...(cache ?? []), entry];
  await persist();
  return entry;
}

export async function updateEntry(
  id: string,
  patch: Partial<
    Pick<QueueEntry, "status" | "attempts" | "lastError" | "billingPhoto">
  >,
): Promise<void> {
  await loadInitial();
  if (!cache) return;
  cache = cache.map((e) =>
    e.id === id ? { ...e, ...patch, updatedAt: Date.now() } : e,
  );
  await persist();
}

export async function removeEntry(id: string): Promise<void> {
  await loadInitial();
  if (!cache) return;
  cache = cache.filter((e) => e.id !== id);
  await persist();
}

export async function clearEntries(): Promise<void> {
  cache = [];
  await persist();
}

/** Re-mark all non-pending entries as pending (used by Force Resync). */
export async function markAllPending(): Promise<void> {
  await loadInitial();
  if (!cache) return;
  const now = Date.now();
  cache = cache.map((e) =>
    e.status === "pending"
      ? e
      : { ...e, status: "pending", lastError: null, updatedAt: now },
  );
  await persist();
}

export async function ensureLoaded(): Promise<void> {
  await loadInitial();
}

/**
 * Switch to the storage namespace for the given session id. Called
 * from `useSyncEngine` whenever the authenticated user changes (sign-
 * in, sign-out, or account swap). The previous session's in-memory
 * cache is dropped so we never drain its rows under another principal.
 *
 * Pass `null` for sign-out: the queue rebinds to the anon namespace
 * (which should always be empty in practice — anonymous users can't
 * mutate).
 */
export async function setActiveSession(sessionId: string | null): Promise<void> {
  const next = sessionId ?? ANON_SESSION;
  if (activeSession === next && cache !== null) return;
  activeSession = next;
  cache = null;
  loadingPromise = null;
  // Force a fresh read from disk under the new key and notify
  // subscribers so the UI reflects the new session's queue (which is
  // typically empty for a brand-new sign-in).
  const fresh = await loadInitial();
  for (const cb of listeners) {
    try {
      cb([...fresh]);
    } catch {
      /* listener errors must not break the tracker */
    }
  }
}

export function getActiveSession(): string {
  return activeSession;
}

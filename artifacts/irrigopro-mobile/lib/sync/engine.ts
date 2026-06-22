// Sync engine — drains the offline queue serially against the network
// (Task #493 / M8). Triggered by:
//
//   * The originating mutation call (best-effort immediate flush so
//     mutations feel synchronous when the device is online).
//   * AppState transitions to `active` (wired in `lib/sync/init.tsx`).
//   * A 30s background timer while the app is foregrounded.
//   * Manual taps from Today's pull-to-refresh and Profile's Force
//     Resync button.

import type { QueryClient } from "@tanstack/react-query";

import { ApiError, apiRequest as _apiRequest } from "../api";
import {
  type QueueEntry,
  ensureLoaded,
  listEntries,
  removeEntry,
  snapshotEntries,
  updateEntry,
} from "./queue";
import { isNetworkError } from "./network-error";

// setOnline is lazy-loaded to avoid pulling @react-native-community/netinfo
// into the tsx/esbuild test runner through the static import chain.
// Tests override this via __setEngineSetOnlineForTests before any drain call.
type SetOnlineFn = (online: boolean) => void;
let _setOnline: SetOnlineFn | null = null;

async function getSetOnline(): Promise<SetOnlineFn> {
  if (_setOnline) return _setOnline;
  const { setOnline } = await import("./network");
  _setOnline = setOnline;
  return _setOnline;
}

export function __setEngineSetOnlineForTests(fn: SetOnlineFn): void {
  _setOnline = fn;
}

// ── Photo-upload module (lazy) ────────────────────────────────────────
// photo-upload.ts has a deep import chain into expo-image-picker →
// react-native that breaks the tsx/esbuild test runner. We lazy-load
// it via a dynamic import the first time a wet-check-photo entry is
// actually sent (only ever reached on a real device). Tests set the
// seam variables below BEFORE calling drainQueue/attemptEntry so the
// lazy import is never triggered during test runs.

type UploadFn = (localUri: string) => Promise<string>;
type DeleteFn = (uri: string) => void;
type RequestFn = (
  path: string,
  opts?: { method?: string; body?: unknown },
) => Promise<unknown>;

let _upload: UploadFn | null = null;
let _delete: DeleteFn | null = null;
let _request: RequestFn = _apiRequest as RequestFn;

async function getUploadFns(): Promise<{ upload: UploadFn; del: DeleteFn }> {
  if (_upload && _delete) return { upload: _upload, del: _delete };
  const mod = await import("../photo-upload");
  if (!_upload) _upload = mod.uploadLocalPhotoToStorage;
  if (!_delete) _delete = mod.deleteLocalPhoto;
  return { upload: _upload!, del: _delete! };
}

// ── Test seams ───────────────────────────────────────────────────────
// Swappable adapters (same pattern as `__setQueueStorageForTests` in
// queue.ts) so unit tests can exercise the engine without a live
// network or the React Native photo pipeline. Set these BEFORE calling
// drainQueue/attemptEntry so the lazy getUploadFns() import is never
// triggered during test runs.
export function __setEngineUploaderForTests(fn: UploadFn): void {
  _upload = fn;
}
export function __setEngineDeleterForTests(fn: DeleteFn): void {
  _delete = fn;
}
export function __setEngineApiRequestForTests(fn: RequestFn): void {
  _request = fn;
}
/** Reset all seams (call in afterEach). Lazy loaders will re-fetch on next use. */
export function __resetEngineSeamsForTests(): void {
  _upload = null;
  _delete = null;
  _request = _apiRequest as RequestFn;
  _setOnline = null;
}

let queryClientRef: QueryClient | null = null;

export function setEngineQueryClient(qc: QueryClient | null): void {
  queryClientRef = qc;
}

// ── Conflict pub/sub ────────────────────────────────────────────────
//
// 409s surfaced inline by the originating mutation are handled by each
// screen's `WetCheckConflictError` / `BillingSheetConflictError`
// catcher. But 409s discovered by background drains have no in-flight
// mutation to bubble through; we publish them here so any open screen
// for that resource can flip into the "edited in office — refresh"
// banner UX consistent with M5/M7.

type ConflictListener = (entry: QueueEntry, error: ApiError) => void;
const conflictListeners = new Set<ConflictListener>();

export function subscribeConflict(cb: ConflictListener): () => void {
  conflictListeners.add(cb);
  return () => {
    conflictListeners.delete(cb);
  };
}

/**
 * Thrown by `sendEntry` when an entry can't be processed yet but is
 * not a hard failure — e.g. a billing-sheet photo waiting on its
 * parent `create` POST to drain. Engine treats these as soft retries:
 * leaves the entry pending and continues draining other entries.
 */
class DeferredEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeferredEntryError";
  }
}

function fireConflict(entry: QueueEntry, error: ApiError): void {
  for (const cb of conflictListeners) {
    try {
      cb(entry, error);
    } catch {
      /* listener errors must not break the engine */
    }
  }
}

function invalidateForEntry(entry: QueueEntry): void {
  const qc = queryClientRef;
  if (!qc) return;
  if (entry.kind === "wet-check" || entry.kind === "wet-check-photo") {
    const wcId = wetCheckIdFromScope(entry.scopeKey);
    if (wcId != null) {
      qc.invalidateQueries({ queryKey: ["wet-check", wcId] });
    }
    qc.invalidateQueries({ queryKey: ["wet-checks", "open"] });
  }
  if (entry.kind === "billing-sheet" || entry.kind === "billing-sheet-photo") {
    const bsId =
      entry.kind === "billing-sheet-photo"
        ? entry.billingPhoto?.billingSheetId ??
          billingSheetIdFromScope(entry.scopeKey)
        : billingSheetIdFromScope(entry.scopeKey);
    if (bsId != null) {
      qc.invalidateQueries({ queryKey: ["billing-sheet", bsId] });
    }
    qc.invalidateQueries({ queryKey: ["work-order"] });
  }
}

function wetCheckIdFromScope(scope: string): number | null {
  if (!scope.startsWith("wc:")) return null;
  const n = Number(scope.slice(3));
  return Number.isFinite(n) ? n : null;
}

function billingSheetIdFromScope(scope: string): number | null {
  if (!scope.startsWith("bs:")) return null;
  const n = Number(scope.slice(3));
  return Number.isFinite(n) ? n : null;
}

async function sendEntry(entry: QueueEntry): Promise<unknown> {
  if (entry.kind === "wet-check-photo") {
    if (!entry.photo) throw new Error("wet-check-photo entry missing payload");
    // Sign + PUT the local file to storage, then POST the metadata row.
    const { upload, del } = await getUploadFns();
    const url = await upload(entry.photo.localUri);
    const body = {
      ...(entry.body ?? {}),
      url,
      takenAt: entry.photo.takenAt,
      zoneRecordId: entry.photo.zoneRecordId,
      findingId: entry.photo.findingId,
      clientId: entry.id,
    };
    const result = await _request(entry.path, {
      method: "POST",
      body,
    });
    del(entry.photo.localUri);
    return result;
  }
  if (entry.kind === "billing-sheet-photo") {
    if (!entry.billingPhoto) {
      throw new Error("billing-sheet-photo entry missing payload");
    }
    const { upload: bsUpload, del: bsDel } = await getUploadFns();
    const { localUri, billingSheetId, workOrderId } = entry.billingPhoto;
    // Resolve the target sheet. In create mode the sheet doesn't exist
    // until the create POST drains; we look it up via the work-order
    // route and defer if it's still 404 so we retry after the create.
    let sheetId: number | null = billingSheetId;
    if (sheetId == null) {
      // Resolve the just-created sheet via the plural list endpoint
      // (`/api/work-orders/:id/billing-sheets`), which queries by the
      // canonical `billing_sheets.work_order_id` link and is ordered by
      // workDate desc. The singular `/billing-sheet` route on the
      // server is broken — it treats `:id` as a billing-sheet PK, not a
      // work-order FK — so we cannot rely on it for create-mode
      // resolution.
      //
      // While the create POST is still queued we expect either an empty
      // array or a 404 (work order not visible to this user yet); both
      // are treated as `defer and retry on the next drain pass`.
      try {
        const rows = await _request(
          `/api/work-orders/${workOrderId}/billing-sheets`,
        ) as Array<{ id: number; workDate: string | null }>;
        const list = Array.isArray(rows) ? rows : [];
        if (list.length === 0) {
          throw new DeferredEntryError(
            "billing sheet not yet created (waiting for create POST to drain)",
          );
        }
        // Endpoint already returns workDate desc; fall back to max id
        // if workDate is missing on every row.
        const newest =
          list.find((r) => r.workDate != null) ??
          list.reduce((a, b) => (a.id > b.id ? a : b), list[0]);
        sheetId = newest.id;
      } catch (err) {
        if (err instanceof DeferredEntryError) throw err;
        if (err instanceof ApiError && err.status === 404) {
          throw new DeferredEntryError(
            "billing sheet not yet created (waiting for create POST to drain)",
          );
        }
        throw err;
      }
    }
    if (sheetId == null) {
      throw new DeferredEntryError("billing sheet id unresolved");
    }
    // Resolve a stable, persisted upload URL for this entry. The first
    // successful upload writes `billingPhoto.uploadedUrl` back to the
    // queue *before* we attempt the PATCH so a transport failure on the
    // PATCH (or anywhere afterwards) replays against the same URL on
    // retry — without this, retries would re-upload to a fresh storage
    // key and append a duplicate to the sheet's photos[].
    let url = entry.billingPhoto.uploadedUrl ?? null;
    if (!url) {
      url = await bsUpload(localUri);
      await updateEntry(entry.id, {
        billingPhoto: { ...entry.billingPhoto, uploadedUrl: url },
      });
    }
    // GET the current photos fresh to avoid stomping a concurrent edit;
    // skip the PATCH if the url is already present (server-confirmed
    // success on a previous attempt that the client never saw).
    //
    // The PATCH body is intentionally `{ photos }` only — the billing-
    // sheet PATCH route doesn't allowlist a `clientId` field; extra
    // keys flow straight into the DB update and would also defeat the
    // photos-only bypass (`keys.length === 1 && key === 'photos'`) used
    // to backfill photos onto already-billed sheets.
    const sheet = await _request(
      `/api/billing-sheets/${sheetId}`,
    ) as { photos: string[] | null };
    const current = Array.isArray(sheet.photos) ? sheet.photos : [];
    let result: unknown = sheet;
    if (!current.includes(url)) {
      result = await _request(`/api/billing-sheets/${sheetId}`, {
        method: "PATCH",
        body: { photos: [...current, url] },
      });
    }
    bsDel(localUri);
    return result;
  }
  return _request(entry.path, {
    method: entry.method,
    body: entry.body ?? undefined,
  });
}

export type AttemptResult =
  | { kind: "sent"; data: unknown }
  | { kind: "queued" }
  | { kind: "deferred"; reason: string }
  | { kind: "conflict"; error: ApiError }
  | { kind: "failed"; error: unknown };

/**
 * Send a single entry now. The originating mutation calls this so that
 * online callers get the real server response (and React Query's
 * onSuccess fires with real data).
 */
export async function attemptEntry(entry: QueueEntry): Promise<AttemptResult> {
  try {
    const data = await sendEntry(entry);
    await removeEntry(entry.id);
    (await getSetOnline())(true);
    invalidateForEntry(entry);
    return { kind: "sent", data };
  } catch (err) {
    if (err instanceof DeferredEntryError) {
      // Soft retry — the entry is waiting on a sibling entry to drain
      // first (e.g. billing-sheet-photo waiting on the create POST).
      // Leave it pending and continue draining other rows.
      await updateEntry(entry.id, {
        status: "pending",
        attempts: entry.attempts + 1,
        lastError: err.message,
      });
      return { kind: "deferred", reason: err.message };
    }
    if (isNetworkError(err)) {
      (await getSetOnline())(false);
      await updateEntry(entry.id, {
        status: "pending",
        attempts: entry.attempts + 1,
        lastError: err instanceof Error ? err.message : "Network error",
      });
      return { kind: "queued" };
    }
    (await getSetOnline())(true);
    if (err instanceof ApiError && err.status === 409) {
      await updateEntry(entry.id, {
        status: "conflict",
        attempts: entry.attempts + 1,
        lastError: err.message,
      });
      invalidateForEntry(entry);
      fireConflict(entry, err);
      return { kind: "conflict", error: err };
    }
    // Task #521 — tag 401s so a fresh sign-in can auto-replay them.
    const isAuthFailure = err instanceof ApiError && err.status === 401;
    await updateEntry(entry.id, {
      status: "failed",
      attempts: entry.attempts + 1,
      lastError: err instanceof Error ? err.message : String(err),
      failureReason: isAuthFailure ? "auth" : null,
    });
    return { kind: "failed", error: err };
  }
}

let draining = false;
let drainQueued = false;

/**
 * Drain every pending entry serially in createdAt order. Stops on the
 * first network failure (callers re-trigger via AppState/manual sync).
 * If called while a drain is already running, the new request is
 * coalesced into a single follow-up pass.
 */
export async function drainQueue(): Promise<void> {
  if (draining) {
    drainQueued = true;
    return;
  }
  draining = true;
  try {
    do {
      drainQueued = false;
      await ensureLoaded();
      const all = await listEntries();
      const pending = all
        .filter((e) => e.status === "pending")
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of pending) {
        const fresh = snapshotEntries().find((e) => e.id === entry.id);
        if (!fresh || fresh.status !== "pending") continue;
        const result = await attemptEntry(fresh);
        if (result.kind === "queued") {
          // Lost the network mid-drain; bail and wait for next trigger.
          return;
        }
        if (result.kind === "sent") {
          // A successful send may unblock previously-deferred entries
          // (e.g. billing-sheet-photo rows waiting on the create POST).
          // Re-queue another pass so we retry them in the same drain.
          drainQueued = true;
        }
        // Otherwise (deferred/conflict/failed) continue to the next entry.
      }
    } while (drainQueued);
  } finally {
    draining = false;
  }
}

/**
 * Discard a queue entry without sending it. Used by the Profile screen
 * for entries that are stuck on a 4xx (e.g. validation regression on
 * the server) so the tech can unstick the queue.
 */
export async function discardEntry(id: string): Promise<void> {
  const entry = snapshotEntries().find((e) => e.id === id);
  if (
    (entry?.kind === "wet-check-photo" && entry.photo) ||
    (entry?.kind === "billing-sheet-photo" && entry.billingPhoto)
  ) {
    const localUri =
      entry.kind === "wet-check-photo"
        ? entry.photo!.localUri
        : entry.billingPhoto!.localUri;
    const { del } = await getUploadFns();
    del(localUri);
  }
  await removeEntry(id);
  if (entry) invalidateForEntry(entry);
}

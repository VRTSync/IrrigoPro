// Shared wet-check mutation helpers for the mobile app.
//
// Every wet-check mutation funnels through `wetCheckMutate` so the M8
// offline queue (`lib/sync`) can intercept transparently. The helper:
//
//   * generates a UUID `clientId` for create-shaped requests so a retry
//     is deduped server-side via the schema's per-row unique index,
//   * enqueues the mutation in the durable AsyncStorage queue before
//     attempting the network so a hard kill mid-request still ships,
//   * normalizes 409 Conflicts into a typed `WetCheckConflictError` so
//     each screen can surface the "edited in the office — refresh"
//     banner without re-classifying ApiError statuses by hand.

import { ApiError } from "./api";
import { attemptEntry } from "./sync/engine";
import { type WetCheckPhotoPayload, enqueue } from "./sync/queue";
import { drainQueue } from "./sync/engine";
import { generateClientId } from "./uuid";

export class WetCheckConflictError extends Error {
  status: 409;
  data: unknown;
  constructor(message: string, data: unknown) {
    super(message);
    this.name = "WetCheckConflictError";
    this.status = 409;
    this.data = data;
  }
}

export type WetCheckMutationOptions<TBody extends Record<string, unknown> | undefined> = {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: TBody;
  /**
   * Optional pre-generated id to use for the queue entry (and the wire
   * `clientId`). When the caller already minted a client-side id —
   * e.g. a captured photo's `clientId` from the camera pipeline — we
   * reuse it so retry/cancel UI keying off that id can address the
   * exact queue row, instead of enqueueing a brand-new entry on every
   * retry (which would defeat server-side per-row idempotency).
   */
  id?: string;
  /** When true (default), attach the queue entry id as the wire `clientId`. */
  withClientId?: boolean;
  /**
   * Wet-check id this mutation belongs to. Used to scope the queue
   * entry so drains can preserve intra-resource ordering. Optional —
   * helpers that don't have it (e.g. delete-finding) pass undefined and
   * the entry scopes by path instead.
   */
  wetCheckId?: number;
  /** Short label shown in Profile diagnostics (e.g. "Add finding"). */
  label: string;
  /** Photo payload for `wet-check-photo` entries (uploaded by the engine). */
  photo?: WetCheckPhotoPayload | null;
  /**
   * If true, the entry is treated as a wet-check-photo (sign+PUT+POST).
   * Defaults to false (regular JSON mutation).
   */
  isPhoto?: boolean;
};

export type WetCheckMutateResult<T> = T & { _offlineQueued?: boolean };

function scopeKey(wetCheckId: number | undefined, path: string): string {
  if (wetCheckId != null) return `wc:${wetCheckId}`;
  // Path-based fallback for endpoints whose id can't be derived (e.g.
  // /api/wet-checks/findings/:id). Drains group these together too.
  return `wc-path:${path}`;
}

function makeOptimistic<T>(opts: WetCheckMutationOptions<Record<string, unknown> | undefined>): T {
  if (opts.method === "DELETE" || opts.method === "PATCH") {
    return { ok: true, _offlineQueued: true } as unknown as T;
  }
  // POST: synthesize a placeholder id so optimistic UI can render.
  // Negative ids never collide with real server ids.
  const tempId = -Math.floor(Date.now() + Math.random() * 1000);
  return {
    id: tempId,
    ...((opts.body as Record<string, unknown> | undefined) ?? {}),
    _offlineQueued: true,
  } as unknown as T;
}

export async function wetCheckMutate<TResponse, TBody extends Record<string, unknown> | undefined = undefined>(
  opts: WetCheckMutationOptions<TBody>,
): Promise<WetCheckMutateResult<TResponse>> {
  const attachId = opts.withClientId ?? true;
  const baseBody = (opts.body as Record<string, unknown> | undefined) ?? null;

  // Pre-generate the id and bake `clientId` into the body BEFORE the
  // entry is persisted, so a hard kill between enqueue and send still
  // leaves a fully replayable row in storage. The entry id doubles as
  // the wire `clientId` so the server's per-row uniqueness index
  // dedupes any retries.
  const id = opts.id ?? generateClientId();
  const wireBody = attachId
    ? { ...(baseBody ?? {}), clientId: id }
    : baseBody;

  const entry = await enqueue({
    id,
    kind: opts.isPhoto ? "wet-check-photo" : "wet-check",
    scopeKey: scopeKey(opts.wetCheckId, opts.path),
    path: opts.path,
    method: opts.method,
    body: wireBody,
    photo: opts.photo ?? null,
    label: opts.label,
  });

  const result = await attemptEntry(entry);
  if (result.kind === "sent") {
    // Schedule a drain in case other entries are now eligible.
    drainQueue().catch(() => undefined);
    return result.data as WetCheckMutateResult<TResponse>;
  }
  if (result.kind === "queued" || result.kind === "deferred") {
    // `deferred` is unreachable for wet-check kinds (only billing-sheet-photo
    // defers), but the union forces us to handle it; treat like `queued`
    // so the UI gets an optimistic placeholder.
    return makeOptimistic<WetCheckMutateResult<TResponse>>(opts);
  }
  if (result.kind === "conflict") {
    throw new WetCheckConflictError(result.error.message, result.error.data);
  }
  // failed
  if (result.error instanceof ApiError) throw result.error;
  if (result.error instanceof Error) throw result.error;
  throw new Error(typeof result.error === "string" ? result.error : "Request failed");
}

export const wetCheckDetailQueryKey = (id: number) =>
  ["wet-check", id] as const;

export const wetCheckIssueTypesQueryKey = ["wet-check", "issue-types"] as const;

export const wetCheckPartsByIssueQueryKey = (
  issueType: string,
  customerId: number | null,
) => ["wet-check", "parts-by-issue", issueType, customerId ?? null] as const;

export const wetCheckMutationKeyPrefix = (wetCheckId: number) =>
  ["wet-check", "mutation", wetCheckId] as const;

export type WetCheckMutationOp =
  | "submit"
  | "zone-status"
  | "finding-add"
  | "finding-delete"
  | "photo-add"
  | "photo-delete";

export const wetCheckMutationKey = (
  wetCheckId: number,
  op: WetCheckMutationOp,
  subId?: number,
) =>
  subId == null
    ? ([...wetCheckMutationKeyPrefix(wetCheckId), op] as const)
    : ([...wetCheckMutationKeyPrefix(wetCheckId), op, subId] as const);

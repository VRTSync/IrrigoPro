// Shared billing-sheet mutation helpers for the mobile app (Task #492 / M7).
//
// Mirrors `wet-check.ts`: every billing-sheet mutation funnels through
// `billingSheetMutate` so the M8 offline queue (`lib/sync`) can wrap
// them transparently. The queue entry id is reused as the wire
// `clientId` so a server retry is deduped via the existing per-row
// uniqueness index.

import { ApiError } from "./api";
import { attemptEntry, drainQueue } from "./sync/engine";
import { enqueue } from "./sync/queue";
import { generateClientId } from "./uuid";

export class BillingSheetConflictError extends Error {
  status: 409;
  data: unknown;
  constructor(message: string, data: unknown) {
    super(message);
    this.name = "BillingSheetConflictError";
    this.status = 409;
    this.data = data;
  }
}

export type BillingSheetMutationOptions<
  TBody extends Record<string, unknown> | undefined,
> = {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: TBody;
  withClientId?: boolean;
  /** Stable scope id used by the queue (existing sheet id when known). */
  billingSheetId?: number;
  /** Fallback scope key when sheet has no id yet (e.g. work order id). */
  scopeFallback?: string;
  /** Short label shown in Profile diagnostics. */
  label: string;
};

export type BillingSheetMutateResult<T> = T & { _offlineQueued?: boolean };

function scopeKey(opts: BillingSheetMutationOptions<Record<string, unknown> | undefined>): string {
  if (opts.billingSheetId != null) return `bs:${opts.billingSheetId}`;
  if (opts.scopeFallback) return `bs-${opts.scopeFallback}`;
  return `bs-path:${opts.path}`;
}

function makeOptimistic<T>(
  opts: BillingSheetMutationOptions<Record<string, unknown> | undefined>,
): T {
  if (opts.method === "DELETE" || opts.method === "PATCH") {
    return { ok: true, _offlineQueued: true } as unknown as T;
  }
  const tempId = -Math.floor(Date.now() + Math.random() * 1000);
  return {
    id: tempId,
    billingNumber: "PENDING",
    status: "draft",
    ...((opts.body as Record<string, unknown> | undefined) ?? {}),
    _offlineQueued: true,
  } as unknown as T;
}

export async function billingSheetMutate<
  TResponse,
  TBody extends Record<string, unknown> | undefined = undefined,
>(opts: BillingSheetMutationOptions<TBody>): Promise<BillingSheetMutateResult<TResponse>> {
  const attachId = opts.withClientId ?? true;
  const baseBody = (opts.body as Record<string, unknown> | undefined) ?? null;

  // Pre-generate the id and bake `clientId` into the body BEFORE the
  // entry hits storage, so a hard kill between enqueue and send still
  // leaves a fully replayable row. The entry id doubles as the wire
  // `clientId` so the server's per-row uniqueness index dedupes any
  // retries.
  const id = generateClientId();
  const wireBody = attachId
    ? { ...(baseBody ?? {}), clientId: id }
    : baseBody;

  const entry = await enqueue({
    id,
    kind: "billing-sheet",
    scopeKey: scopeKey(opts),
    path: opts.path,
    method: opts.method,
    body: wireBody,
    photo: null,
    label: opts.label,
  });

  const result = await attemptEntry(entry);
  if (result.kind === "sent") {
    drainQueue().catch(() => undefined);
    return result.data as BillingSheetMutateResult<TResponse>;
  }
  if (result.kind === "queued" || result.kind === "deferred") {
    // `deferred` is unreachable for billing-sheet (only billing-sheet-photo
    // entries defer), but the union forces us to handle it; treat like
    // `queued` so the UI gets an optimistic placeholder.
    return makeOptimistic<BillingSheetMutateResult<TResponse>>(opts);
  }
  if (result.kind === "conflict") {
    throw new BillingSheetConflictError(result.error.message, result.error.data);
  }
  if (result.error instanceof ApiError) throw result.error;
  if (result.error instanceof Error) throw result.error;
  throw new Error(typeof result.error === "string" ? result.error : "Request failed");
}

export const billingSheetDetailQueryKey = (id: number) =>
  ["billing-sheet", id] as const;

export const billingSheetItemsQueryKey = (id: number) =>
  ["billing-sheet", id, "items"] as const;

export const fieldTechPartsQueryKey = ["parts", "field-tech"] as const;

export const billingSheetMutationKeyPrefix = (
  scopeId: number | string,
) => ["billing-sheet", "mutation", scopeId] as const;

export type BillingSheetMutationOp =
  | "create"
  | "update"
  | "submit"
  | "photo-add"
  | "photo-delete";

export const billingSheetMutationKey = (
  scopeId: number | string,
  op: BillingSheetMutationOp,
  subId?: number | string,
) =>
  subId == null
    ? ([...billingSheetMutationKeyPrefix(scopeId), op] as const)
    : ([...billingSheetMutationKeyPrefix(scopeId), op, subId] as const);

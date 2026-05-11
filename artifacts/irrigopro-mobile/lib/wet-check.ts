// Shared wet-check mutation helpers for the mobile app.
//
// All wet-check mutations funnel through `wetCheckMutate` so the M8 offline
// queue can wrap them later without touching every call site. The helper:
//
//   * generates a UUID `clientId` for create-shaped requests so a retry is
//     deduped server-side via the schema's per-row unique index, and
//   * normalizes 409 Conflicts into a typed `WetCheckConflictError` so each
//     screen can surface the "edited in the office — refresh to see latest"
//     banner without re-classifying ApiError statuses by hand.

import { ApiError, apiRequest } from "./api";
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
   * When true (default), attach a freshly-generated UUID `clientId` to the
   * request body so an offline-queue retry (M8) is deduped server-side. For
   * POST endpoints the API uses it as a per-row uniqueness key; for PATCH it
   * is accepted by the strict allow-list and ignored (the resource id +
   * payload is already idempotent). DELETE sends the clientId in the body too
   * even though the server doesn't read it — this keeps every wet-check
   * mutation log line on the device traceable through a single id field.
   */
  withClientId?: boolean;
};

export async function wetCheckMutate<TResponse, TBody extends Record<string, unknown> | undefined = undefined>(
  opts: WetCheckMutationOptions<TBody>,
): Promise<TResponse> {
  const attachId = opts.withClientId ?? true;
  const body = attachId
    ? { ...((opts.body as Record<string, unknown> | undefined) ?? {}), clientId: generateClientId() }
    : opts.body;

  try {
    return await apiRequest<TResponse>(opts.path, {
      method: opts.method,
      body,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      throw new WetCheckConflictError(err.message, err.data);
    }
    throw err;
  }
}

export const wetCheckDetailQueryKey = (id: number) =>
  ["wet-check", id] as const;

export const wetCheckIssueTypesQueryKey = ["wet-check", "issue-types"] as const;

export const wetCheckPartsByIssueQueryKey = (
  issueType: string,
  customerId: number | null,
) => ["wet-check", "parts-by-issue", issueType, customerId ?? null] as const;

/**
 * Stable per-operation mutationKey for every wet-check mutation. Splitting
 * the key by `op` (and the affected resource id, when applicable) lets the
 * detail screen do two things via `useMutationState`:
 *
 *   1. Observe all in-flight or errored mutations for the wet check by
 *      filtering on the shared `wetCheckMutationKeyPrefix`.
 *   2. Prune *only* the errored entries for the *same logical operation*
 *      when that operation later succeeds — e.g. successfully retrying the
 *      zone-status flip for zone 5 clears its prior error, but doesn't hide
 *      an unrelated failed "add finding" on zone 7.
 */
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

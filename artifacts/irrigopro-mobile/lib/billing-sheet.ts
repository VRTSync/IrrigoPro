// Shared billing-sheet mutation helpers for the mobile app (Task #492 / M7).
//
// Mirrors `wet-check.ts`: every billing-sheet mutation funnels through
// `billingSheetMutate` so the M8 offline queue can wrap them later
// without touching every call site. Each request gets a fresh UUID
// `clientId` (server may ignore it for endpoints without dedupe; sending
// it keeps every device-side mutation log line traceable through one
// shared id field, identical to the wet-check pipeline).

import { ApiError, apiRequest } from "./api";
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
};

export async function billingSheetMutate<
  TResponse,
  TBody extends Record<string, unknown> | undefined = undefined,
>(opts: BillingSheetMutationOptions<TBody>): Promise<TResponse> {
  const attachId = opts.withClientId ?? true;
  const body = attachId
    ? {
        ...((opts.body as Record<string, unknown> | undefined) ?? {}),
        clientId: generateClientId(),
      }
    : opts.body;
  try {
    return await apiRequest<TResponse>(opts.path, {
      method: opts.method,
      body,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      throw new BillingSheetConflictError(err.message, err.data);
    }
    throw err;
  }
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

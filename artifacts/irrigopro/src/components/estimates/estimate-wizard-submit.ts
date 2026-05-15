export type SubmitMode = "draft" | "submit";

export interface SubmitContext {
  isEdit: boolean;
  isDraftEdit: boolean;
  estimateId: number | null;
}

export interface SubmitResult {
  mode: SubmitMode;
  id: number | null;
}

export type ApiRequest = (
  url: string,
  method: string,
  body?: unknown,
) => Promise<unknown>;

// Wizard save path. There are three cases:
//   1. New estimate (POST /api/estimates) — already a single atomic
//      insert, so draft-vs-submit just toggles the internalStatus the
//      server stamps.
//   2. Edit-as-draft / non-draft edit (PUT /api/estimates/:id) — pure
//      content update with no review-status transition.
//   3. Draft edit + submit → single atomic call to
//      POST /api/estimates/:id/submit-for-review (Task #606). This
//      replaces the old PUT-then-/transition pair so the wizard can
//      never leave a draft with new content but stale status if the
//      second leg fails. On error we throw — the caller's mutation
//      onError shows a retry toast and keeps the wizard open.
export async function submitEstimate(
  payload: unknown,
  mode: SubmitMode,
  ctx: SubmitContext,
  apiRequest: ApiRequest,
): Promise<SubmitResult> {
  if (!ctx.isEdit) {
    const created = (await apiRequest("/api/estimates", "POST", payload)) as
      | { id?: number }
      | undefined;
    return { mode, id: created?.id ?? null };
  }
  const estimateId = ctx.estimateId;
  if (ctx.isDraftEdit && mode === "submit" && estimateId != null) {
    const updated = (await apiRequest(
      `/api/estimates/${estimateId}/submit-for-review`,
      "POST",
      payload,
    )) as { id?: number } | undefined;
    return { mode, id: updated?.id ?? estimateId };
  }
  await apiRequest(`/api/estimates/${estimateId}`, "PUT", payload);
  return { mode, id: estimateId };
}

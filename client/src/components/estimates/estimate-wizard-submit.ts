export type SubmitMode = "draft" | "submit";

export interface SubmitContext {
  isEdit: boolean;
  isDraftEdit: boolean;
  estimateId: number | null;
}

export interface SubmitResult {
  mode: SubmitMode;
  id: number | null;
  transitionFailed?: boolean;
}

export type ApiRequest = (
  url: string,
  method: string,
  body?: unknown,
) => Promise<unknown>;

export async function submitEstimate(
  payload: unknown,
  mode: SubmitMode,
  ctx: SubmitContext,
  apiRequest: ApiRequest,
): Promise<SubmitResult> {
  let savedId: number | null = ctx.estimateId ?? null;
  if (ctx.isEdit) {
    await apiRequest(`/api/estimates/${ctx.estimateId}`, "PUT", payload);
  } else {
    const created = (await apiRequest("/api/estimates", "POST", payload)) as
      | { id?: number }
      | undefined;
    savedId = created?.id ?? null;
  }
  if (ctx.isEdit && ctx.isDraftEdit && mode === "submit" && savedId != null) {
    try {
      await apiRequest(`/api/estimates/${savedId}/transition`, "POST", {
        action: "submit_for_review",
      });
    } catch {
      return { mode, id: savedId, transitionFailed: true };
    }
  }
  return { mode, id: savedId };
}

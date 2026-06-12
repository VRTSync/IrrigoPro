// Task #495 — Sanitize wet-check photo handler errors so the field tech
// never sees Drizzle's raw "Failed query: select ..." string in the
// red sync-failed toast, and so the full underlying error is captured
// server-side via req.log with enough context to debug.
//
// Lives in its own module (instead of inside the routes.ts closure) so
// it can be exercised by route-level regression tests without mounting
// the whole 10k-line routes file.

export type ClassifiedPhotoError = { status: number; message: string };

export function classifyWetCheckPhotoError(e: any): ClassifiedPhotoError {
  const code = e?.code ?? e?.cause?.code;
  const raw = typeof e?.message === "string" ? e.message : "";
  if (code === "WET_CHECK_PHOTO_CLIENT_ID_COLLISION") {
    return { status: 409, message: "Photo already attached to a different wet check" };
  }
  // assertWetCheckEditableByTech / assertWetCheckBelongsToCompany throw
  // plain Errors with informative messages — treat the recognizable
  // shapes as expected and surface a tech-friendly version.
  if (code === "WET_CHECK_PHOTO_NOT_LOOSE") {
    return { status: 409, message: "Only unattached photos can be removed after a wet check is submitted" };
  }
  if (/only in-progress wet checks can be edited/i.test(raw)) {
    return { status: 409, message: "This wet check is no longer editable" };
  }
  if (/does not belong to wet check/i.test(raw)) {
    return { status: 400, message: "Photo target doesn't belong to this wet check" };
  }
  if (/not found/i.test(raw) && /wet check/i.test(raw)) {
    return { status: 404, message: "Wet check not found" };
  }
  // Drizzle wraps DB errors as `Failed query: ...` with the real
  // postgres error on `.cause`. Anything that reaches here is by
  // definition unexpected — never echo the SQL.
  return { status: 500, message: "Couldn't attach photo — please retry" };
}

export function logPhotoErrorContext(
  req: any,
  e: any,
  ctx: Record<string, unknown>,
): void {
  const cause = e?.cause;
  req.log?.error?.(
    {
      ...ctx,
      userId: req.authenticatedUserId ?? null,
      companyId: req.authenticatedUserCompanyId ?? null,
      err: {
        name: e?.name,
        message: e?.message,
        code: e?.code ?? cause?.code,
        // Postgres-side detail/constraint info when present; safe to
        // log because it never reaches the client.
        pg: cause
          ? {
              code: cause.code,
              detail: cause.detail,
              constraint: cause.constraint,
              table: cause.table,
              column: cause.column,
            }
          : undefined,
      },
    },
    "Wet check photo handler failed",
  );
}

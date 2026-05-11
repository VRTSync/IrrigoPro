// Task #502 — Reusable SQL-leak guard for wet-check / finding /
// zone-record / submit handlers. Generalizes the per-photo
// classify/log helpers from Task #495 so every handler in this slice
// can sanitize unexpected DB errors (Drizzle wraps them as
// `Failed query: select ...` strings whose message would otherwise be
// echoed straight into the field tech's red sync-failed toast) while
// still surfacing recognized, tech-friendly errors with the right
// status code.
//
// Lives in its own module — instead of inside the routes.ts closure —
// so it can be exercised by route-level regression tests without
// mounting the whole 10k-line routes file.

export type RecognizedError = {
  /** Returns true when this rule matches the thrown error. */
  test: (e: any, raw: string) => boolean;
  /** HTTP status to return when matched. */
  status: number;
  /**
   * Tech-friendly message to return when matched. Either a literal
   * string or a function that derives one from the error. Functions
   * MUST return a curated string — never the raw `e.message` for an
   * unknown shape, or the SQL leak guard is defeated.
   */
  message: string | ((e: any, raw: string) => string);
};

export type ClassifyOptions = {
  /** Operation name for server-side logs. */
  op: string;
  /** Extra structured context to attach to the log line. */
  ctx?: Record<string, unknown>;
  /** Status returned when no rule matches. Defaults to 500. */
  fallbackStatus?: number;
  /**
   * Tech-friendly message returned when no rule matches.
   * Defaults to a generic "please retry" string. NEVER set this to
   * `e.message` — that's the leak we're guarding against.
   */
  fallbackMessage?: string;
  /** Ordered match list; first matching rule wins. */
  recognized?: RecognizedError[];
};

export type ClassifiedError = { status: number; message: string };

/**
 * Classify a thrown error and (when unrecognized) log full context
 * server-side. Returns the sanitized `{ status, message }` to send
 * back to the client.
 *
 * Invariant: when no `recognized` rule matches, the returned message
 * is the curated `fallbackMessage` — never `e.message`. This is the
 * SQL-leak guard: Drizzle's "Failed query: select ..." strings cannot
 * reach the client through this helper.
 */
export function classifyAndLog(
  req: any,
  e: any,
  opts: ClassifyOptions,
): ClassifiedError {
  const raw = typeof e?.message === "string" ? e.message : "";
  for (const r of opts.recognized ?? []) {
    if (r.test(e, raw)) {
      return {
        status: r.status,
        message: typeof r.message === "function" ? r.message(e, raw) : r.message,
      };
    }
  }
  logRouteErrorContext(req, e, { op: opts.op, ...(opts.ctx ?? {}) });
  return {
    status: opts.fallbackStatus ?? 500,
    message: opts.fallbackMessage ?? "Something went wrong — please retry",
  };
}

/**
 * Server-side structured log for an unexpected route error. Captures
 * Drizzle's wrapped pg error (`.cause.code/detail/constraint/...`)
 * which is safe to log because it never reaches the client.
 */
export function logRouteErrorContext(
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
    "Wet check route handler failed",
  );
}

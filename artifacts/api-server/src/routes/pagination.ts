// Task #532 — small helper for opt-in pagination on the legacy list
// endpoints. Reads `limit` and `offset` from the query string, clamps
// them into sane bounds, and returns a sliced view of the array along
// with an `X-Total-Count` header so clients can drive `useInfiniteQuery`
// without a separate count round-trip. Endpoints stay backwards
// compatible — when neither `limit` nor `offset` is provided the full
// array is returned and no header is set.
//
// Lifted out of routes.ts so estimate-routes.ts and any future
// extracted route module can share the same opt-in pagination
// semantics without duplicating the helper.

import type { Request, Response } from "express";

export function paginate<T>(
  req: Request,
  res: Response,
  rows: T[],
  defaults: { limit?: number; max?: number } = {},
): T[] {
  const hasLimit = req.query.limit != null && req.query.limit !== "";
  const hasOffset = req.query.offset != null && req.query.offset !== "";
  if (!hasLimit && !hasOffset) return rows;
  const max = defaults.max ?? 500;
  const limitRaw = hasLimit ? Number(req.query.limit) : (defaults.limit ?? max);
  const offsetRaw = hasOffset ? Number(req.query.offset) : 0;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(max, Math.trunc(limitRaw)))
    : max;
  const offset = Number.isFinite(offsetRaw)
    ? Math.max(0, Math.trunc(offsetRaw))
    : 0;
  res.setHeader("X-Total-Count", String(rows.length));
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count");
  return rows.slice(offset, offset + limit);
}

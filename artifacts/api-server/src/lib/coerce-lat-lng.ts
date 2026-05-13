// Belt-and-braces coercion for the work-order create/update endpoints.
//
// `work_orders.workLocationLat` / `workLocationLng` are decimal(10,7)
// columns, so drizzle-zod's `insertWorkOrderSchema` requires strings.
// Some clients (and historically the web Create Work Order wizard —
// see Task #596) send the LocationPicker's raw JS numbers, which then
// 400 with `expected string, received number`. This helper normalises
// numeric coordinates to their string form before schema validation
// so a future caller can't reintroduce the same regression.
//
// `null` / `undefined` pass through untouched. Strings are left as-is.
// Non-finite numbers (NaN / ±Infinity) are intentionally left in place so
// that downstream `insertWorkOrderSchema` validation rejects them with a
// 400 instead of us silently persisting a bogus coordinate.

const KEYS = ["workLocationLat", "workLocationLng"] as const;

export function coerceLatLngStrings<T extends Record<string, unknown>>(
  body: T,
): T {
  if (!body || typeof body !== "object") return body;
  for (const k of KEYS) {
    if (!(k in body)) continue;
    const v = (body as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      (body as Record<string, unknown>)[k] = String(v);
    }
  }
  return body;
}

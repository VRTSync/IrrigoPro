/**
 * Coerce any nullable/NaN value to a finite JS number safe for arithmetic.
 * Postgres stores NaN in decimal columns as the special string "NaN".
 * parseFloat("NaN") → NaN, which poisons any sum it joins.
 * This helper ensures every item-price / total read returns 0 when the
 * stored value is null, undefined, empty, or non-finite.
 *
 * Usage:
 *   const price = money(item.totalPrice);   // number, never NaN
 *   const total = money(parts) + money(labor);
 */
export function money(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
}

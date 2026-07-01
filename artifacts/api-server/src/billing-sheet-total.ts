// Task #1669 — Shared helper for non-item billing-sheet total recomputes.
//
// Structural invariant: totalAmount must always equal partsSubtotal + laborSubtotal.
// Any absent field in the patch body falls back to the stored record so that
// a totalHours-only PATCH never zeroes stored parts, and a partsSubtotal-only
// PATCH never zeroes stored labor.
//
// IMPORTANT — do NOT route non-item mutation paths through
// _resyncBillingSheetTotalsTx. That function re-derives partsSubtotal from
// billing_sheet_items rows and would zero parts on sheets that carry a
// partsSubtotal without item rows (e.g. createBillingSheet without items, or
// the "no items table" parts source in storage.ts). Keep
// _resyncBillingSheetTotalsTx exclusively on item-mutation paths (add / update /
// delete / replace items), where items are the authoritative source of parts.

/**
 * Compute `totalAmount` for a billing sheet from two sources:
 *
 *   `patched`  — values being written (from the patch body or the in-progress
 *                storage update). May be partial — any undefined/null field is
 *                absent from the current mutation.
 *   `stored`   — the currently-persisted billing sheet row. Provides the
 *                fallback for any field absent from `patched`.
 *
 * Uses nullish-coalescing (`??`) so an explicit `'0'` value in `patched` is
 * honoured (only `null` / `undefined` falls back to `stored`), preserving the
 * ability to deliberately zero a subtotal via an explicit write.
 *
 * Returns the total as a two-decimal string (e.g. `"821.72"`).
 */
export function computeBillingSheetTotal(
  patched: { partsSubtotal?: string | null; laborSubtotal?: string | null },
  stored: { partsSubtotal?: string | null; laborSubtotal?: string | null } | null | undefined,
): string {
  const parts = parseFloat(String(patched.partsSubtotal ?? stored?.partsSubtotal ?? '0')) || 0;
  const labor = parseFloat(String(patched.laborSubtotal ?? stored?.laborSubtotal ?? '0')) || 0;
  return (parts + labor).toFixed(2);
}

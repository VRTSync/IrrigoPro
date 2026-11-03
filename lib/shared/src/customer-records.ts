/** Customer fields owned by QuickBooks when a company's customer records are locked.
 * The QuickBooks customer sync writes exactly these. Customer Records Slice 4 appends to it.
 * Every lock check (server and client) reads this list. Never copy it. */
export const QB_OWNED_CUSTOMER_FIELDS = [
  "name", "email", "phone", "address", "street", "city", "state", "zip", "country",
] as const;
export type QbOwnedCustomerField = (typeof QB_OWNED_CUSTOMER_FIELDS)[number];

export function customerRecordsLabel(systemName: string | null | undefined): string {
  const trimmed = (systemName ?? "").trim();
  return trimmed === "" ? "your customer system" : trimmed;
}

const norm = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Changed locked keys present in patch, in QB_OWNED_CUSTOMER_FIELDS order. */
export function changedLockedFields(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): QbOwnedCustomerField[] {
  return QB_OWNED_CUSTOMER_FIELDS.filter((f) => f in patch && norm(patch[f]) !== norm(current[f]));
}

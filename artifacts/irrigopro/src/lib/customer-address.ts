import type { Customer } from "@workspace/db/schema";

/**
 * Build a Nominatim-friendly address query from a customer record.
 *
 * The customers table currently only has a single `address` text field.
 * To improve geocoding success on partial single-line addresses, append
 * a country hint when one isn't already present.
 */
export function composeCustomerAddress(
  customer: Pick<Customer, "address"> | null | undefined,
): string {
  if (!customer) return "";
  const raw = (customer.address ?? "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  const hasCountry =
    lower.endsWith(", usa") ||
    lower.endsWith(" usa") ||
    lower.endsWith(", united states") ||
    lower.endsWith(" united states");

  return hasCountry ? raw : `${raw}, USA`;
}

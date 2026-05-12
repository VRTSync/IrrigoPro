import type { Customer } from "@workspace/db/schema";

type Nullable<T> = T | null | undefined;

// Loose shape so callers can pass either a real Customer (where parts
// are `string | null` from drizzle) or a form-data object (where parts
// are `string | undefined`). The `satisfies` line below verifies that
// a real Customer is structurally assignable to this shape.
interface AddressPartsCustomer {
  address?: Nullable<string>;
  street?: Nullable<string>;
  city?: Nullable<string>;
  state?: Nullable<string>;
  zip?: Nullable<string>;
  country?: Nullable<string>;
}

const _customerSatisfiesShape = (c: Customer): AddressPartsCustomer => c;
void _customerSatisfiesShape;

/**
 * Combine the structured city/state/zip parts (Task #347) into a single
 * line. Returns an empty string when nothing useful is set so callers can
 * cleanly fall back to the legacy single-line `address`.
 */
export function composeStructuredAddress(
  customer: Omit<AddressPartsCustomer, "address"> | null | undefined,
): string {
  if (!customer) return "";
  const street = (customer.street ?? "").trim();
  const city = (customer.city ?? "").trim();
  const state = (customer.state ?? "").trim();
  const zip = (customer.zip ?? "").trim();
  const country = (customer.country ?? "").trim();

  // Need at least one part to build anything meaningful.
  if (!street && !city && !state && !zip && !country) return "";

  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ").trim()]
    .filter(Boolean)
    .join(", ");

  return [street, cityStateZip, country].filter(Boolean).join(", ");
}

/**
 * Build a Nominatim-friendly address query from a customer record.
 *
 * Prefers the structured city/state/zip/country fields when present, since
 * those geocode far more reliably than partial single-line addresses.
 * Falls back to the legacy `address` field, appending a country hint when
 * one isn't already present.
 */
export function composeCustomerAddress(
  customer: AddressPartsCustomer | null | undefined,
): string {
  if (!customer) return "";

  const structured = composeStructuredAddress(customer);
  if (structured) {
    // If the user gave us an explicit `country`, trust it — even if it's
    // not the US. Only append the USA hint when no structured country
    // was set (the common case for legacy / US-only data) so geocoding
    // still has a country to anchor on.
    const explicitCountry = (customer.country ?? "").trim();
    if (explicitCountry) return structured;
    return `${structured}, USA`;
  }

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

/**
 * The address line shown to humans (customer profile, list rows, etc).
 * Same fallback order as {@link composeCustomerAddress} but does not
 * append a country hint — that's only needed for geocoding.
 */
export function displayCustomerAddress(
  customer: AddressPartsCustomer | null | undefined,
): string {
  if (!customer) return "";
  const structured = composeStructuredAddress(customer);
  if (structured) return structured;
  return (customer.address ?? "").trim();
}

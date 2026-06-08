import { useQuery } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";
import { useCustomerBoundary } from "@/hooks/use-customer-boundary";
import { LocationPicker, type LocationPickerProps } from "@/components/ui/location-picker";

type OmittedProps = "customerBoundary" | "companyFallbackAddress";

export interface CustomerLocationPickerProps extends Omit<LocationPickerProps, OmittedProps> {
  customerId: number | null | undefined;
  /**
   * Optional — if provided, used to look up the company address for the
   * map centering fallback (when the customer has no pin and no boundary).
   * When omitted the component reads `companyId` from the session user in
   * localStorage, which covers all standard wizard callers.
   */
  companyId?: number | null;
}

interface CompanyProfile {
  address?: string | null;
  name?: string | null;
}

/**
 * Drop-in replacement for LocationPicker that fetches and wires the customer's
 * property boundary automatically. Callers only need to supply customerId —
 * they never have to call useCustomerBoundary themselves.
 *
 * Centering priority (inherited from LocationPicker):
 *   1. existing pin  → center on pin
 *   2. property boundary → fitBounds
 *   3. company address → geocode at zoom 12, show yellow notice
 *   4. regional fallback (US center)
 * The map always mounts — no dead-end mapless state.
 */
export function CustomerLocationPicker({
  customerId,
  companyId,
  ...rest
}: CustomerLocationPickerProps) {
  const { data: customerBoundary, isLoading: isBoundaryLoading } = useCustomerBoundary(customerId);

  // Resolve companyId: prefer explicit prop, fall back to session user.
  const resolvedCompanyId = companyId ?? (() => {
    try {
      const raw = safeGet("user");
      return raw ? (JSON.parse(raw) as { companyId?: number }).companyId ?? null : null;
    } catch {
      return null;
    }
  })();

  const { data: companyProfile } = useQuery<CompanyProfile>({
    queryKey: [`/api/company/${resolvedCompanyId}/profile`],
    enabled: !!resolvedCompanyId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return (
    <LocationPicker
      {...rest}
      customerBoundary={customerBoundary}
      companyFallbackAddress={companyProfile?.address ?? null}
      boundaryResolved={!isBoundaryLoading}
    />
  );
}

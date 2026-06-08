import { useCustomerBoundary } from "@/hooks/use-customer-boundary";
import { LocationPicker, type LocationPickerProps } from "@/components/ui/location-picker";

type OmittedProps = "customerBoundary";

export interface CustomerLocationPickerProps extends Omit<LocationPickerProps, OmittedProps> {
  customerId: number | null | undefined;
}

/**
 * Drop-in replacement for LocationPicker that fetches and wires the customer's
 * property boundary automatically. Callers only need to supply customerId —
 * they never have to call useCustomerBoundary themselves.
 *
 * Centering priority (inherited from LocationPicker):
 *   1. existing pin  → center on pin
 *   2. property boundary → fitBounds
 *   3. regional fallback
 * The map always mounts — no dead-end mapless state.
 */
export function CustomerLocationPicker({
  customerId,
  ...rest
}: CustomerLocationPickerProps) {
  const { data: customerBoundary } = useCustomerBoundary(customerId);

  return (
    <LocationPicker
      {...rest}
      customerBoundary={customerBoundary}
    />
  );
}

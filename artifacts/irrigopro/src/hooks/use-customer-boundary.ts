import { useQuery } from "@tanstack/react-query";
import {
  hydrateStoredBoundary,
  type PropertyBoundary,
  type StoredBoundaryFields,
} from "@/lib/property-boundary";
import type { Customer } from "@workspace/db/schema";

export function useCustomerBoundary(customerId: number | null | undefined) {
  return useQuery<StoredBoundaryFields, Error, PropertyBoundary | null>({
    queryKey: customerId ? [`/api/customers/${customerId}/property-boundary`] : ["__no_customer__"],
    enabled: !!customerId,
    select: (data) => hydrateStoredBoundary(data),
  });
}

export function customerToBoundary(
  customer: Customer | null | undefined,
): PropertyBoundary | null {
  if (!customer) return null;
  return hydrateStoredBoundary({
    propertyBoundary: customer.propertyBoundary,
    propertyBoundaryKml: customer.propertyBoundaryKml,
    propertyBoundaryFileName: customer.propertyBoundaryFileName,
    propertyBoundaryCenterLat: customer.propertyBoundaryCenterLat,
    propertyBoundaryCenterLng: customer.propertyBoundaryCenterLng,
    propertyBoundaryZoom: customer.propertyBoundaryZoom,
    propertyBoundaryAreaAcres: customer.propertyBoundaryAreaAcres,
  });
}

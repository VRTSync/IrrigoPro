import { useQuery } from "@tanstack/react-query";
import { customerRecordsLabel } from "@workspace/shared";

export type CustomerRecordsLockState = { locked: boolean; systemName: string | null; quickbooksConnected: boolean };

export function useCustomerRecordsLock() {
  const { data, isLoading } = useQuery<CustomerRecordsLockState | null>({
    queryKey: ["/api/company/customer-records"],
    staleTime: 60_000,
  });
  const locked = data?.locked ?? false;
  return {
    isLoading,
    locked,
    systemName: data?.systemName ?? null,
    label: customerRecordsLabel(data?.systemName),
    quickbooksConnected: data?.quickbooksConnected ?? false,
    canCreateCustomers: !isLoading && !locked,
  };
}

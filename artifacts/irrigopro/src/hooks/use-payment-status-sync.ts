import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PaymentStatusSyncResult {
  throttled?: boolean;
  nextAllowedIn?: number;
  paid?: number;
  partiallyPaid?: number;
  qbVoided?: number;
}

export function usePaymentStatusSync({ autoRun }: { autoRun: boolean }): {
  runNow: () => void;
  isPending: boolean;
} {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAutoSyncRef = useRef(false);
  const { mutate, isPending } = useMutation<PaymentStatusSyncResult, Error>({
    mutationFn: () => apiRequest("/api/invoices/sync-payment-status", "POST"),
    onSuccess: (result) => {
      const wasAuto = isAutoSyncRef.current;
      isAutoSyncRef.current = false;

      if (result?.throttled) {
        if (!wasAuto) {
          const mins = Math.ceil((result.nextAllowedIn ?? 0) / 60);
          toast({
            title: "Recently synced",
            description: `Next refresh available in ${mins} minute${mins !== 1 ? "s" : ""}.`,
          });
        }
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });

      const paid = result?.paid ?? 0;
      const partial = result?.partiallyPaid ?? 0;
      const voided = result?.qbVoided ?? 0;
      const hasChanges = paid > 0 || partial > 0;
      if (wasAuto && !hasChanges && voided === 0) return;

      const parts = [hasChanges
        ? `Updated ${paid} paid, ${partial} partially paid`
        : "All invoices are up to date"];
      if (voided > 0) parts.push(`${voided} voided in QuickBooks — review required`);
      toast({ title: "Payment status refreshed from QuickBooks", description: parts.join(". ") });
    },
    onError: (err) => {
      const wasAuto = isAutoSyncRef.current;
      isAutoSyncRef.current = false;
      if (wasAuto) return;

      toast({
        title: "Payment sync failed",
        description: err.message || "Could not read payment status from QuickBooks.",
        variant: "destructive",
      });
    },
  });

  // The server throttles refreshes per company. Callers only enable auto-run
  // for invoice editors because the refresh writes payment status.
  useEffect(() => {
    if (!autoRun) return;
    isAutoSyncRef.current = true;
    mutate();
  }, [autoRun, mutate]);

  return { runNow: () => mutate(), isPending };
}

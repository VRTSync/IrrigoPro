import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";
import { WetCheckBillingViewComponent } from "@/components/billing/wet-check-billing-view";
import type { WetCheckBillingView } from "@/components/billing/wet-check-billing-view";
import type { WetCheckBilling } from "@workspace/db/schema";
import { safeGet } from "@/utils/safeStorage";

// ── Helpers ───────────────────────────────────────────────────────────────────

function canSeePricing(): boolean {
  try {
    const raw = safeGet("user");
    if (!raw) return true;
    const user = JSON.parse(raw);
    return user?.role !== "field_tech";
  } catch {
    return true;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface WetCheckBillingViewModalProps {
  wetCheckBillingId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WetCheckBillingViewModal({
  wetCheckBillingId,
  open,
  onOpenChange,
}: WetCheckBillingViewModalProps) {
  const [, navigate] = useLocation();

  const { data, isLoading, isError } = useQuery<{
    wetCheckBilling: WetCheckBilling;
    view: WetCheckBillingView | null;
  }>({
    queryKey: ["/api/wet-check-billings", wetCheckBillingId],
    queryFn: () => apiRequest(`/api/wet-check-billings/${wetCheckBillingId}`),
    enabled: open,
  });

  const wcb = data?.wetCheckBilling;
  const view = data?.view ?? null;

  function handleViewOriginating(e: React.MouseEvent) {
    e.preventDefault();
    if (!wcb) return;
    onOpenChange(false);
    navigate(`/wet-checks/${wcb.wetCheckId}?from=wet-check-billings`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="wcb-modal-title">
            {wcb ? wcb.billingNumber : <Skeleton className="h-6 w-40" />}
          </DialogTitle>
          <DialogDescription data-testid="wcb-modal-subtitle">
            {wcb ? (
              <>
                {wcb.customerName}
                {wcb.propertyAddress ? ` · ${wcb.propertyAddress}` : ""}
              </>
            ) : (
              <Skeleton className="h-4 w-64 mt-1" />
            )}
          </DialogDescription>
        </DialogHeader>

        {/* View originating wet check link */}
        {wcb && (
          <div className="mb-2">
            <Button
              variant="link"
              className="p-0 h-auto text-blue-600 hover:text-blue-800 text-sm"
              onClick={handleViewOriginating}
              data-testid="wcb-modal-originating-link"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1" />
              View originating wet check
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="mt-1">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {isError && (
            <p className="text-sm text-red-600 py-4 text-center" data-testid="wcb-modal-error">
              Failed to load wet check billing details.
            </p>
          )}

          {!isLoading && !isError && view && (
            <WetCheckBillingViewComponent
              view={view}
              canSeePricing={canSeePricing()}
            />
          )}

          {!isLoading && !isError && wcb && !view && (
            <p className="text-sm text-gray-500 py-4 text-center italic">
              No zone-grouped view available for this billing yet.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="wcb-modal-close"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

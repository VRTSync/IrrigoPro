import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import type { WetCheckBillingView, WcvZone } from "@/components/billing/wet-check-billing-view";
import type { WetCheckBilling } from "@workspace/db/schema";
import { safeGet } from "@/utils/safeStorage";
import { useToast } from "@/hooks/use-toast";
import { LaborHoursStepper } from "@/components/ui/labor-hours-stepper";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getUserRole(): string | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    return JSON.parse(raw)?.role ?? null;
  } catch {
    return null;
  }
}

function canSeePricing(): boolean {
  const role = getUserRole();
  return role !== "field_tech";
}

function canEditZoneLabor(): boolean {
  const role = getUserRole();
  return role === "billing_manager" || role === "company_admin" || role === "super_admin";
}

// ── Zone labor editor (billing-manager tier, Task #891) ───────────────────────

function ZoneLaborEditorRow({
  zone,
  wcbId,
  onSaved,
}: {
  zone: WcvZone;
  wcbId: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [localHours, setLocalHours] = useState(zone.repairLaborHours);
  useEffect(() => { setLocalHours(zone.repairLaborHours); }, [zone.repairLaborHours]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMut = useMutation({
    mutationFn: (hours: string) =>
      apiRequest(`/api/wet-check-billings/${wcbId}/zone-labor`, "PATCH", {
        zoneRecordId: zone.zoneRecordId,
        repairLaborHours: hours,
      }),
    onSuccess: () => onSaved(),
    onError: (e: any) => {
      toast({
        title: "Couldn't save zone labor",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleChange = (val: string) => {
    setLocalHours(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveMut.mutate(val), 600);
  };

  const isManual = zone.repairLaborManuallySet;
  const hrs = parseFloat(localHours) || 0;

  return (
    <div
      className="flex items-center justify-between gap-4 py-2 border-b border-gray-100 last:border-0"
      data-testid={`wcb-zone-labor-row-${zone.zoneLabel}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Zone {zone.zoneLabel}
        </span>
        {isManual ? (
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px] font-semibold shrink-0">
            manual
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-semibold shrink-0">
            auto
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {hrs === 0 ? "—" : `${hrs.toFixed(2)} hr`}
        </span>
        <div className="w-36">
          <LaborHoursStepper
            value={localHours}
            onChange={handleChange}
            min="0.00"
            disabled={saveMut.isPending}
          />
        </div>
      </div>
    </div>
  );
}

function ZoneLaborEditorPanel({
  view,
  wcbId,
  onSaved,
}: {
  view: WetCheckBillingView;
  wcbId: number;
  onSaved: () => void;
}) {
  if (view.zones.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-4"
      data-testid="wcb-zone-labor-editor"
    >
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-3">
        Edit Zone Repair Labor
      </p>
      {view.zones.map((z) => (
        <ZoneLaborEditorRow key={z.zoneRecordId} zone={z} wcbId={wcbId} onSaved={onSaved} />
      ))}
    </div>
  );
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
  const queryClient = useQueryClient();

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
  const showLaborEditor = canEditZoneLabor() && !!view && view.zones.length > 0;

  function handleViewOriginating(e: React.MouseEvent) {
    e.preventDefault();
    if (!wcb) return;
    onOpenChange(false);
    navigate(`/wet-checks/${wcb.wetCheckId}?from=wet-check-billings`);
  }

  function handleLaborSaved() {
    queryClient.invalidateQueries({ queryKey: ["/api/wet-check-billings", wetCheckBillingId] });
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
        <div className="mt-1 space-y-4">
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
            <>
              {/* Task #891 — billing-manager zone labor editor (shown before view for prominence) */}
              {showLaborEditor && (
                <ZoneLaborEditorPanel view={view} wcbId={wetCheckBillingId} onSaved={handleLaborSaved} />
              )}
              <WetCheckBillingViewComponent
                view={view}
                canSeePricing={canSeePricing()}
              />
            </>
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

/**
 * ZoneLaborEditInline — Task #1027
 *
 * Inline zone labor row rendered inside each zone block in
 * WetCheckBillingViewComponent, immediately above ZONE SUBTOTAL.
 *
 * Props:
 *   wcbId           — wet check billing ID (used for mutation URLs)
 *   zoneRecordId    — PK of the zone record
 *   valueHours      — current repairLaborHours (string, e.g. "1.50")
 *   manuallySet     — whether the value was manually overridden
 *   laborRate       — $/hr snapshot rate for dollar-value display
 *   canEdit         — billing_manager+ on an unlocked (not billed / invoiced) WCB
 *   canSeePricing   — false for field_tech (suppresses dollar value display)
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LaborHoursStepper } from "@/components/ui/labor-hours-stepper";

const currency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

export interface ZoneLaborEditInlineProps {
  wcbId: number;
  zoneRecordId: number;
  valueHours: string;
  manuallySet: boolean;
  laborRate: string;
  canEdit: boolean;
  /** When false (field_tech), the dollar-value column is hidden. Default: true. */
  canSeePricing?: boolean;
}

export function ZoneLaborEditInline({
  wcbId,
  zoneRecordId,
  valueHours,
  manuallySet,
  laborRate,
  canEdit,
  canSeePricing = true,
}: ZoneLaborEditInlineProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [localHours, setLocalHours] = useState(valueHours);

  // Resync local state when the server value changes (after save/reset invalidates the query).
  useEffect(() => {
    setLocalHours(valueHours);
  }, [valueHours]);

  const hrs = parseFloat(localHours) || 0;
  const rate = parseFloat(laborRate) || 0;
  const dollarValue = hrs * rate;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/wet-check-billings", wcbId] });
    queryClient.invalidateQueries({ queryKey: ["/api/wet-check-billings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/customers/billing-preview"] });
  }

  const saveMut = useMutation({
    mutationFn: (hours: string) =>
      apiRequest(`/api/wet-check-billings/${wcbId}/zone-labor`, "PATCH", {
        zoneRecordId,
        repairLaborHours: hours,
      }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save zone labor",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const resetMut = useMutation({
    mutationFn: () =>
      apiRequest(`/api/wet-check-billings/${wcbId}/zone-labor/reset`, "POST", {
        zoneRecordId,
      }),
    onSuccess: () => { invalidate(); },
    onError: (e: any) => {
      toast({
        title: "Couldn't reset zone labor",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const BadgeManual = () => (
    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 text-[10px] font-semibold shrink-0">
      manual
    </span>
  );
  const BadgeAuto = () => (
    <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-semibold shrink-0">
      auto
    </span>
  );

  if (!canEdit) {
    return (
      <div
        className="flex items-center justify-between pt-1 border-t border-dashed border-gray-200 mt-1"
        data-testid={`zone-labor-readonly-${zoneRecordId}`}
      >
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500">
            Zone Labor ({hrs.toFixed(2)} hr{hrs !== 1 ? "s" : ""})
          </span>
          {manuallySet ? <BadgeManual /> : <BadgeAuto />}
        </div>
        {canSeePricing && (
          <span className="text-sm font-medium text-gray-700">{currency(dollarValue)}</span>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div
        className="pt-1 border-t border-dashed border-gray-200 mt-1 space-y-2"
        data-testid={`zone-labor-row-${zoneRecordId}`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-600">Zone Labor (hrs)</span>
          <div className="flex items-center gap-2">
            <div className="w-36">
              <LaborHoursStepper
                value={localHours}
                onChange={setLocalHours}
                min="0.00"
                disabled={saveMut.isPending}
              />
            </div>
            <button
              type="button"
              onClick={() => saveMut.mutate(localHours)}
              disabled={saveMut.isPending}
              className="px-2.5 py-1 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              data-testid={`zone-labor-save-${zoneRecordId}`}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setLocalHours(valueHours); setEditing(false); }}
              className="px-2.5 py-1 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
              data-testid={`zone-labor-cancel-${zoneRecordId}`}
            >
              Cancel
            </button>
          </div>
        </div>
        {canSeePricing && (
          <div className="text-right text-sm font-medium text-gray-700">
            ≈ {currency(dollarValue)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between pt-1 border-t border-dashed border-gray-200 mt-1"
      data-testid={`zone-labor-row-${zoneRecordId}`}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-500">
          Zone Labor ({hrs.toFixed(2)} hr{hrs !== 1 ? "s" : ""})
        </span>
        {manuallySet ? <BadgeManual /> : <BadgeAuto />}
        {manuallySet && (
          <button
            type="button"
            onClick={() => resetMut.mutate()}
            disabled={resetMut.isPending}
            className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-50"
            data-testid={`zone-labor-reset-${zoneRecordId}`}
          >
            <RotateCcw className="w-3 h-3" />
            Reset to auto
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canSeePricing && (
          <span className="text-sm font-medium text-gray-700">{currency(dollarValue)}</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          data-testid={`zone-labor-pencil-${zoneRecordId}`}
          aria-label="Edit zone labor hours"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

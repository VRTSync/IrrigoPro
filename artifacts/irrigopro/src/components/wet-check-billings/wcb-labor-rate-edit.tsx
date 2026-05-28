/**
 * WcbLaborRateEdit — Task #977
 *
 * Inline form that lets billing_manager / company_admin / super_admin
 * override the labor rate on an unbilled WCB.  Fires
 * PATCH /api/wet-check-billings/:wcbId/labor-rate { newRate }.
 *
 * Props:
 *   wcbId      — ID of the wet-check billing row
 *   currentRate — display value for the existing rate (string "$XX.XX")
 *   onClose    — called on successful save or cancel
 *   onSuccess  — called after a successful mutation so callers can
 *                invalidate caches before onClose fires
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

interface WcbLaborRateEditProps {
  wcbId: number;
  currentRate: string;
  onClose: () => void;
  onSuccess?: (updated: unknown) => void;
}

export function WcbLaborRateEdit({
  wcbId,
  currentRate,
  onClose,
  onSuccess,
}: WcbLaborRateEditProps) {
  const initValue = parseFloat(currentRate) || 0;
  const [rate, setRate] = useState<string>(initValue.toFixed(2));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (newRate: number) =>
      apiRequest(`/api/wet-check-billings/${wcbId}/labor-rate`, "PATCH", { newRate }),
    onSuccess: (data) => {
      onSuccess?.(data);
      onClose();
    },
    onError: (e: any) => {
      setErrorMsg(e?.message ?? "Couldn't save labor rate. Please try again.");
    },
  });

  function handleSave() {
    const parsed = parseFloat(rate);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
      setErrorMsg("Rate must be between $0.00 and $1000.00.");
      return;
    }
    setErrorMsg(null);
    mutation.mutate(parsed);
  }

  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
      data-testid="wcb-labor-rate-edit"
    >
      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
        Override Labor Rate
      </p>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[180px]">
          <span className="absolute inset-y-0 left-3 flex items-center text-gray-500 text-sm pointer-events-none">
            $
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1000"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              setErrorMsg(null);
            }}
            disabled={mutation.isPending}
            className="w-full pl-7 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-white"
            data-testid="wcb-labor-rate-input"
            aria-label="Labor rate per hour"
          />
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap">/hr</span>
      </div>

      {errorMsg && (
        <p
          className="text-xs text-red-600"
          data-testid="wcb-labor-rate-error"
        >
          {errorMsg}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={mutation.isPending}
          data-testid="wcb-labor-rate-save"
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onClose}
          disabled={mutation.isPending}
          data-testid="wcb-labor-rate-cancel"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

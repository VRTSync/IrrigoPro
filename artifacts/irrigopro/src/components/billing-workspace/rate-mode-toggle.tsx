/**
 * RateModeToggle — Task #1093
 *
 * Two-segment control that lets billing_manager / company_admin / super_admin
 * flip between "normal" (customer.laborRate) and "emergency"
 * (customer.emergencyLaborRate) on a billing sheet, work order, or WCB.
 *
 * Fires PATCH /api/{entityPath}/{id}/rate-mode { mode }.
 * Optimistically flips locally; reverts on error.
 * Invalidates the detail query key on success.
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type EntityPath = "billing-sheets" | "work-orders" | "wet-check-billings";
type Mode = "normal" | "emergency";

interface RateModeToggleProps {
  entityPath: EntityPath;
  entityId: number;
  currentMode: Mode;
  normalRate: string | null;
  emergencyRate: string | null;
  detailQueryKey: unknown[];
  disabled?: boolean;
}

export function RateModeToggle({
  entityPath,
  entityId,
  currentMode,
  normalRate,
  emergencyRate,
  detailQueryKey,
  disabled = false,
}: RateModeToggleProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Optimistic local mode: flips immediately on click, reverts on error.
  const [localMode, setLocalMode] = useState<Mode>(currentMode);

  // Keep in sync if the parent re-renders with a new confirmed mode (e.g.
  // after a successful mutation invalidates and refetches the detail query).
  useEffect(() => {
    setLocalMode(currentMode);
  }, [currentMode]);

  const mutation = useMutation({
    mutationFn: (mode: Mode) =>
      apiRequest(`/api/${entityPath}/${entityId}/rate-mode`, "PATCH", { mode }),
    onMutate: (mode: Mode) => {
      setLocalMode(mode);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
      // Task #1097 — refresh the activity feed for WCBs so the new
      // rate_mode_changed row appears immediately without reopening.
      if (entityPath === "wet-check-billings") {
        queryClient.invalidateQueries({
          queryKey: [`/api/wet-check-billings/${entityId}/activity`],
        });
      }
    },
    onError: (e: any) => {
      // Revert the optimistic flip
      setLocalMode(currentMode);
      toast({
        title: "Couldn't update rate mode",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const fmtRate = (r: string | null | undefined) =>
    r != null ? `$${parseFloat(r).toFixed(2)}/hr` : "—";

  const isLoading = mutation.isPending;

  return (
    <div className="flex items-center gap-2" data-testid="rate-mode-toggle">
      <span className="text-xs font-medium text-gray-600 shrink-0">Rate mode</span>
      <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => !isLoading && localMode !== "normal" && mutation.mutate("normal")}
          disabled={disabled || isLoading || localMode === "normal"}
          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
            localMode === "normal"
              ? "bg-white shadow-sm text-gray-900 border border-gray-200"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
          data-testid="rate-mode-normal"
          aria-pressed={localMode === "normal"}
        >
          Normal {fmtRate(normalRate)}
        </button>
        <button
          type="button"
          onClick={() => !isLoading && localMode !== "emergency" && mutation.mutate("emergency")}
          disabled={disabled || isLoading || localMode === "emergency"}
          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
            localMode === "emergency"
              ? "bg-amber-500 text-white shadow-sm border border-amber-600"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
          data-testid="rate-mode-emergency"
          aria-pressed={localMode === "emergency"}
        >
          <Zap className="w-3 h-3" />
          Emergency {fmtRate(emergencyRate)}
        </button>
      </div>
      {isLoading && (
        <span className="text-xs text-gray-400 animate-pulse" aria-live="polite">
          Updating…
        </span>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Droplets, ClipboardList, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type WetCheckMode = "service" | "inspection";

const SESSION_KEY = "wc_pending_mode";
const CUSTOMER_KEY = "wc_pending_customer_id";

function readPendingCustomerId(remove = false): number | null {
  try {
    const raw = sessionStorage.getItem(CUSTOMER_KEY);
    if (remove) sessionStorage.removeItem(CUSTOMER_KEY);
    const id = parseInt(raw ?? "", 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export default function WetCheckModeSelectorPage() {
  const [, navigate] = useLocation();
  const [selected, setSelected] = useState<WetCheckMode>("service");
  const [customerId] = useState(() => readPendingCustomerId());
  const {
    data: modePreview,
    isLoading: isModeLoading,
    isError: isModeError,
  } = useQuery<{ mode: WetCheckMode; forcedByBudget: boolean }>({
    queryKey: [`/api/wet-checks/customer/${customerId}/create-mode`],
    queryFn: () => apiRequest(`/api/wet-checks/customer/${customerId}/create-mode`),
    enabled: customerId !== null,
  });
  const inspectionOnly = modePreview?.forcedByBudget === true;
  const effectiveSelection: WetCheckMode = inspectionOnly ? "inspection" : selected;

  function handleContinue() {
    try {
      sessionStorage.setItem(SESSION_KEY, effectiveSelection);
    } catch {
      // sessionStorage unavailable — ControllerSelectionPage defaults to 'service'
    }
    const pendingCustomerId = readPendingCustomerId(true) ?? customerId;
    if (pendingCustomerId) {
      navigate(`/wet-checks/c/${pendingCustomerId}/new`);
    } else {
      navigate("/wet-checks");
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10 flex flex-col items-center gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">New Wet Check</h1>
        <p className="text-sm text-gray-500 mt-1">What type of inspection is this?</p>
      </div>

      {inspectionOnly && (
        <div
          className="w-full rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          data-testid="over-budget-inspection-notice"
          role="status"
        >
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">This visit will be an inspection</p>
              <p className="mt-1 text-sm">
                This customer has no monthly budget headroom. Document issues, do not make repairs,
                and the visit will return as an estimate for approval.
              </p>
            </div>
          </div>
        </div>
      )}

      {customerId !== null && isModeError && (
        <div className="w-full rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
          Couldn't check this customer's budget mode. Retry before starting the wet check.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 w-full">
        <button
          type="button"
          onClick={() => setSelected("service")}
          disabled={inspectionOnly}
          className={[
            "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
            effectiveSelection === "service"
              ? "border-blue-500 bg-blue-50 shadow-sm"
              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
          ].join(" ")}
          data-testid="mode-btn-service"
          aria-pressed={effectiveSelection === "service"}
        >
          <Droplets
            className={`h-10 w-10 ${effectiveSelection === "service" ? "text-blue-600" : "text-gray-400"}`}
          />
          <div className="text-center">
            <div
              className={`font-semibold text-base ${effectiveSelection === "service" ? "text-blue-900" : "text-gray-800"}`}
            >
              Service
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Repair &amp; billing</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSelected("inspection")}
          className={[
            "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
            effectiveSelection === "inspection"
              ? "border-violet-500 bg-violet-50 shadow-sm"
              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
          ].join(" ")}
          data-testid="mode-btn-inspection"
          aria-pressed={effectiveSelection === "inspection"}
        >
          <ClipboardList
            className={`h-10 w-10 ${effectiveSelection === "inspection" ? "text-violet-600" : "text-gray-400"}`}
          />
          <div className="text-center">
            <div
              className={`font-semibold text-base ${effectiveSelection === "inspection" ? "text-violet-900" : "text-gray-800"}`}
            >
              Inspection
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Assessment only</div>
          </div>
        </button>
      </div>

      <Button
        className="w-full h-12 text-base font-semibold"
        onClick={handleContinue}
        disabled={customerId !== null && (isModeLoading || isModeError)}
        data-testid="mode-continue-btn"
      >
        {isModeLoading ? "Checking budget…" : "Continue"}
      </Button>
    </div>
  );
}

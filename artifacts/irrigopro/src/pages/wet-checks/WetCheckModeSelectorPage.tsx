import { useState } from "react";
import { useLocation } from "wouter";
import { Droplets, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";

type WetCheckMode = "service" | "inspection";

const SESSION_KEY = "wc_pending_mode";
const CUSTOMER_KEY = "wc_pending_customer_id";

function consumePendingCustomerId(): number | null {
  try {
    const raw = sessionStorage.getItem(CUSTOMER_KEY);
    sessionStorage.removeItem(CUSTOMER_KEY);
    const id = parseInt(raw ?? "", 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export default function WetCheckModeSelectorPage() {
  const [, navigate] = useLocation();
  const [selected, setSelected] = useState<WetCheckMode>("service");

  function handleContinue() {
    try {
      sessionStorage.setItem(SESSION_KEY, selected);
    } catch {
      // sessionStorage unavailable — ControllerSelectionPage defaults to 'service'
    }
    const customerId = consumePendingCustomerId();
    if (customerId) {
      navigate(`/wet-checks/c/${customerId}/new`);
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

      <div className="grid grid-cols-2 gap-4 w-full">
        <button
          type="button"
          onClick={() => setSelected("service")}
          className={[
            "flex flex-col items-center gap-3 rounded-2xl border-2 p-6 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
            selected === "service"
              ? "border-blue-500 bg-blue-50 shadow-sm"
              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
          ].join(" ")}
          data-testid="mode-btn-service"
          aria-pressed={selected === "service"}
        >
          <Droplets
            className={`h-10 w-10 ${selected === "service" ? "text-blue-600" : "text-gray-400"}`}
          />
          <div className="text-center">
            <div
              className={`font-semibold text-base ${selected === "service" ? "text-blue-900" : "text-gray-800"}`}
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
            selected === "inspection"
              ? "border-violet-500 bg-violet-50 shadow-sm"
              : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
          ].join(" ")}
          data-testid="mode-btn-inspection"
          aria-pressed={selected === "inspection"}
        >
          <ClipboardList
            className={`h-10 w-10 ${selected === "inspection" ? "text-violet-600" : "text-gray-400"}`}
          />
          <div className="text-center">
            <div
              className={`font-semibold text-base ${selected === "inspection" ? "text-violet-900" : "text-gray-800"}`}
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
        data-testid="mode-continue-btn"
      >
        Continue
      </Button>
    </div>
  );
}

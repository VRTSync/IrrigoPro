import { useLocation, useRoute } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Slice 3 placeholder ───────────────────────────────────────────────────────
// This route (`/wet-checks/c/:customerId/new`) is wired but the Controller
// Selection UI lives in Slice 3. For now it bounces back to the customer hub
// so that tapping "Start New Wet Check" on the hub doesn't dead-end the user.

export default function NewWetCheckPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute<{ customerId: string }>("/wet-checks/c/:customerId/new");
  const customerId = params?.customerId ?? "";

  return (
    <div className="max-w-3xl mx-auto py-8 px-3 sm:px-4 flex flex-col items-center gap-4 text-center">
      <Loader2 className="h-10 w-10 text-blue-300 animate-spin" />
      <p className="text-gray-600 font-medium">Controller Selection</p>
      <p className="text-sm text-gray-400">Coming in Slice 3 — this screen is not yet available.</p>
      {customerId && (
        <Button variant="outline" size="sm" onClick={() => navigate(`/wet-checks/c/${customerId}`)}>
          Back to Property Hub
        </Button>
      )}
    </div>
  );
}

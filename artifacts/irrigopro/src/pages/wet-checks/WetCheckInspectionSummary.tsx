import { Link } from "wouter";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WetCheckInspectionSummaryProps {
  id: number;
}

export function WetCheckInspectionSummary({ id }: WetCheckInspectionSummaryProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 className="w-9 h-9 text-green-600" aria-hidden />
      </div>
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">All zones checked</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Review and submit your inspection. The full summary and submission flow
          will be available in the next update.
        </p>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link href={`/wet-checks/${id}`}>
          <Button
            variant="outline"
            className="w-full flex items-center gap-2"
            data-testid="btn-back-to-inspection"
          >
            <ClipboardList className="w-4 h-4" aria-hidden />
            Back to Inspection
          </Button>
        </Link>
      </div>
    </div>
  );
}

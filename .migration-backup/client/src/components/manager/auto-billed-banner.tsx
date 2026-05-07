import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

export interface AutoBilledBannerProps {
  count: number;
  total: number;
  technicianName: string;
  billingSheetId: number | null;
}

export function AutoBilledBanner({ count, total, technicianName, billingSheetId }: AutoBilledBannerProps) {
  if (count <= 0) return null;
  return (
    <Card className="border-green-200 bg-green-50/60" data-testid="wizard-auto-billed-banner">
      <CardContent className="py-3 flex items-start gap-2 text-sm">
        <CheckCircle2 className="w-4 h-4 text-green-700 mt-0.5 shrink-0" />
        <div className="text-green-900">
          <span className="font-medium">Wet check work completed in field</span>
          <div className="text-xs mt-0.5 text-green-800">
            {count} finding{count === 1 ? "" : "s"} finished by {technicianName}
            {billingSheetId != null && (
              <>
                {" · "}
                <Link
                  href={`/billing-sheets?openSheet=${billingSheetId}`}
                  className="underline hover:text-green-700"
                  data-testid="wizard-auto-billed-link"
                >
                  billing sheet #{billingSheetId}
                </Link>
              </>
            )}
            {" · "}
            <span data-testid="wizard-auto-billed-total">${total.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

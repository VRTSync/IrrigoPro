import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";

interface BilledIndicatorProps {
  invoiceId?: number | null;
  invoiceNumber?: string | null;
  billedAt?: string | Date | null;
  compact?: boolean;
}

export function BilledBadge() {
  return (
    <Badge className="bg-purple-100 text-purple-800 border-purple-200 flex-shrink-0">
      Billed
    </Badge>
  );
}

export function BilledIndicator({ invoiceId, invoiceNumber, billedAt, compact = false }: BilledIndicatorProps) {
  const invoiceLabel = invoiceNumber
    ? `Invoice #${invoiceNumber}`
    : invoiceId
    ? `Invoice #${invoiceId}`
    : null;

  const billingPeriod = billedAt
    ? new Date(billedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-purple-700 font-medium">
        <Lock className="w-3 h-3 text-purple-500 flex-shrink-0" />
        <span>Billed{invoiceLabel ? ` · ${invoiceLabel}` : ""}{billingPeriod ? ` · ${billingPeriod}` : ""}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
      <Lock className="w-4 h-4 text-purple-600 flex-shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-semibold text-purple-800">Billing complete — read only</span>
        {(invoiceLabel || billingPeriod) && (
          <span className="text-xs text-purple-600 truncate">
            {[invoiceLabel, billingPeriod].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

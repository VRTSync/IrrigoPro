import { CheckCircle, EyeOff } from "lucide-react";
import type { Customer } from "@workspace/db/schema";

export function CustomerVisibilityChip({ customer }: {
  customer: Pick<Customer, "hiddenFromBilling" | "hiddenByQuickbooks">;
}) {
  const hidden = customer.hiddenFromBilling;
  const Icon = hidden ? EyeOff : CheckCircle;
  return (
    <span
      title={hidden && customer.hiddenByQuickbooks ? "Inactive in QuickBooks" : undefined}
      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${
        hidden ? "bg-slate-100 text-slate-600 border-slate-200" : "bg-green-100 text-green-700 border-green-200"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />{hidden ? "Hidden" : "Visible"}
    </span>
  );
}

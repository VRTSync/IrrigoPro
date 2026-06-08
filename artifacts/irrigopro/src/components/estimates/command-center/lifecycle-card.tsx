import { Badge } from "@/components/ui/badge";
import { LIFECYCLE_TINTS, lifecycleOf } from "@workspace/shared";
import { formatEstimateNumber } from "@workspace/shared";
import type { Estimate } from "@workspace/db/schema";

function formatCurrency(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function ageInDays(d: string | Date | null | undefined): number {
  if (!d) return 0;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)));
}

function initialsOf(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "—";
  const parts = s.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase().slice(0, 2);
}

interface LifecycleCardProps {
  estimate: Estimate;
  onOpen: (id: number) => void;
}

export function LifecycleCard({ estimate, onOpen }: LifecycleCardProps) {
  const lc = lifecycleOf(estimate);
  const tint = LIFECYCLE_TINTS[lc];

  return (
    <button
      type="button"
      onClick={() => onOpen(estimate.id)}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md hover:border-gray-300 transition-all"
      data-testid={`lifecycle-card-${estimate.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {formatEstimateNumber(estimate.estimateNumber)}
          </div>
          <div className="text-xs text-gray-500 truncate">{estimate.customerName ?? "—"}</div>
        </div>
        <Badge variant="outline" className={`${tint.bg} ${tint.text} ${tint.border} text-[10px]`}>
          {tint.label}
        </Badge>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-900">{formatCurrency(estimate.totalAmount)}</span>
        <div className="flex items-center gap-2">
          <span
            title={estimate.createdBy ?? "—"}
            className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-gray-100 text-[10px] font-semibold text-gray-700"
            data-testid={`lifecycle-card-owner-${estimate.id}`}
          >
            {initialsOf(estimate.createdBy)}
          </span>
          <span className="text-gray-500">{ageInDays(estimate.createdAt)}d</span>
        </div>
      </div>
    </button>
  );
}

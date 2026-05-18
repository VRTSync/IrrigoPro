// Task #683 — Attention strip for the Estimate Command Center.
//
// Renders up to 8 per-estimate rows surfaced by the server-side
// aggregator (`summary.attention[]`). Each row carries a reason
// chip + icon, customer, total $, sinceDays, and an Open action
// that launches the existing EstimateDetailModal. Tones follow
// the spec contract: expiring_soon → red, stuck_in_review →
// amber, high_value_silent → indigo. Empty state uses the exact
// copy required by the spec.

import { AlertTriangle, CheckCircle2, Clock, DollarSign, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEstimateNumber } from "@/lib/estimate-number";
import type { EstimateAttentionReason } from "@workspace/db";

export type AttentionReason = EstimateAttentionReason;

export interface AttentionItem {
  estimateId: number;
  estimateNumber: string | null;
  customerName: string | null;
  totalAmount: number;
  reason: AttentionReason;
  sinceDays: number;
  lifecycle: string;
}

const REASON_META: Record<
  AttentionReason,
  {
    label: string;
    bg: string;
    border: string;
    iconBg: string;
    text: string;
    badge: string;
    icon: typeof AlertTriangle;
  }
> = {
  expiring_soon: {
    label: "Expiring soon",
    bg: "bg-red-50",
    border: "border-red-200",
    iconBg: "bg-red-100",
    text: "text-red-700",
    badge: "bg-red-100 text-red-800 border-red-200",
    icon: AlertTriangle,
  },
  stuck_in_review: {
    label: "Stuck in review",
    bg: "bg-amber-50",
    border: "border-amber-200",
    iconBg: "bg-amber-100",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    icon: Clock,
  },
  high_value_silent: {
    label: "High value, no reply",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    iconBg: "bg-indigo-100",
    text: "text-indigo-700",
    badge: "bg-indigo-100 text-indigo-800 border-indigo-200",
    icon: DollarSign,
  },
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

interface AttentionStripProps {
  items: AttentionItem[];
  isLoading?: boolean;
  onOpenEstimate: (id: number) => void;
}

const MAX_ITEMS = 8;

export function AttentionStrip({ items, isLoading, onOpenEstimate }: AttentionStripProps) {
  if (isLoading) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400"
        data-testid="attention-strip-loading"
      >
        Loading attention items…
      </div>
    );
  }
  const visible = items.slice(0, MAX_ITEMS);
  if (visible.length === 0) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center"
        data-testid="attention-strip-empty"
      >
        <CheckCircle2 className="w-8 h-8 mx-auto mb-1 text-green-400" />
        <p className="text-sm text-gray-700">
          All clear — nothing needs your attention right now.
        </p>
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" data-testid="attention-strip">
      {visible.map((it) => {
        const meta = REASON_META[it.reason];
        const Icon = meta.icon;
        return (
          <div
            key={`${it.estimateId}-${it.reason}`}
            className={`shrink-0 w-72 rounded-lg border ${meta.bg} ${meta.border} px-3 pt-2 pb-2 flex flex-col gap-1`}
            data-testid={`attention-item-${it.estimateId}-${it.reason}`}
          >
            <div className="flex items-center gap-2">
              <span className={`${meta.iconBg} p-1.5 rounded`}>
                <Icon className={`h-3.5 w-3.5 ${meta.text}`} />
              </span>
              <Badge variant="outline" className={`text-[10px] ${meta.badge}`}>
                {meta.label}
              </Badge>
              <span className="text-[11px] text-gray-500 ml-auto">{it.sinceDays}d</span>
            </div>
            <div className="text-sm font-semibold text-gray-900 truncate">
              {formatEstimateNumber(it.estimateNumber)}
            </div>
            <div className="text-xs text-gray-600 truncate">{it.customerName ?? "—"}</div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-900">
                {formatCurrency(it.totalAmount)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => onOpenEstimate(it.estimateId)}
                data-testid={`attention-open-${it.estimateId}`}
              >
                Open <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

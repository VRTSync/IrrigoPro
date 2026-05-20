// Task #688 — Financial Pulse Slice 2.
//
// Shared metric tile used by the Financial Pulse KPI band. Separate
// from `components/admin-dashboard/kpi-tile.tsx` because that tile is
// link-first (every tile navigates somewhere) and doesn't carry a
// delta indicator. This tile renders a formatted value, an optional
// signed delta with intent-aware color, and an optional warning slot
// (used by the Gross Margin tile when techs lack `hourlyWage`).

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, AlertTriangle, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type MetricFormat = "currency" | "percent" | "days" | "number";
export type MetricIntent = "neutral" | "good" | "bad";

export interface MetricTileProps {
  label: string;
  value: number | string | null | undefined;
  format: MetricFormat;
  deltaPct?: number | null;
  deltaLabel?: string;
  /** Direction of "good" — used to color delta. */
  deltaGoodDirection?: "up" | "down";
  warning?: string;
  isLoading?: boolean;
  isError?: boolean;
  testId?: string;
  helper?: string;
  /**
   * Task #720 — small "where does this number come from" tooltip.
   * Rendered as an Info icon next to the label. Keep the wording
   * aligned with `docs/financial-metrics.md` so the page and the
   * doc stay in lockstep.
   */
  infoTip?: string;
  /**
   * Compact window badge ("7d", "24h", "MTD", "YTD") rendered
   * inline next to the label so rolling tiles aren't confused
   * with MTD/YTD tiles.
   */
  windowBadge?: string;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatMetricValue(
  v: number | string | null | undefined,
  format: MetricFormat,
): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return "—";
  switch (format) {
    case "currency":
      return CURRENCY.format(n);
    case "percent":
      return `${n.toFixed(1)}%`;
    case "days":
      return `${n.toFixed(1)} days`;
    case "number":
    default:
      return n.toLocaleString();
  }
}

export function MetricTile({
  label,
  value,
  format,
  deltaPct,
  deltaLabel = "vs last month",
  deltaGoodDirection = "up",
  warning,
  isLoading,
  isError,
  testId,
  helper,
  infoTip,
  windowBadge,
}: MetricTileProps) {
  const formatted = formatMetricValue(value, format);
  const hasDelta = deltaPct != null && Number.isFinite(deltaPct);
  const up = hasDelta && (deltaPct as number) >= 0;
  const intent: MetricIntent = hasDelta
    ? up === (deltaGoodDirection === "up")
      ? "good"
      : "bad"
    : "neutral";
  const deltaColor =
    intent === "good"
      ? "text-emerald-600"
      : intent === "bad"
        ? "text-rose-600"
        : "text-gray-500";

  return (
    <Card className="h-full" data-testid={testId}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">
              {label}
            </p>
            {windowBadge ? (
              <Badge
                variant="outline"
                className="h-4 px-1 text-[10px] font-medium text-gray-500 border-gray-200 bg-gray-50 shrink-0"
                data-testid={testId ? `${testId}-window-badge` : undefined}
              >
                {windowBadge}
              </Badge>
            ) : null}
            {infoTip ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info
                    className="w-3.5 h-3.5 text-gray-400 shrink-0 cursor-help"
                    data-testid={testId ? `${testId}-info` : undefined}
                    aria-label="About this metric"
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs whitespace-pre-line">
                  {infoTip}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          {warning ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle
                  className="w-4 h-4 text-amber-500 shrink-0"
                  data-testid={testId ? `${testId}-warning` : undefined}
                  aria-label="Warning"
                />
              </TooltipTrigger>
              <TooltipContent>{warning}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="mt-1">
          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : isError ? (
            <p className="text-2xl font-bold text-gray-300">—</p>
          ) : (
            <p className="text-2xl font-bold text-gray-900">{formatted}</p>
          )}
        </div>
        {hasDelta && !isLoading && (
          <div
            className={cn("flex items-center text-xs mt-1", deltaColor)}
            data-testid={testId ? `${testId}-delta` : undefined}
          >
            {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            <span className="ml-0.5">
              {Math.abs(deltaPct as number).toFixed(1)}% {deltaLabel}
            </span>
          </div>
        )}
        {helper && !isLoading && (
          <p className="text-xs text-gray-400 mt-1 truncate">{helper}</p>
        )}
      </CardContent>
    </Card>
  );
}

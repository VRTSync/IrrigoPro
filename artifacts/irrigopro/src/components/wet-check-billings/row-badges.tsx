import { Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Partial badge ─────────────────────────────────────────────────────────────
// Shown when the parent wet check is still "partially_converted" — meaning the
// manager has not finished routing all findings.

export function PartialBadge() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200 cursor-default"
            data-testid="partial-badge"
          >
            Partial
          </span>
        </TooltipTrigger>
        <TooltipContent>Manager hasn't finished routing all findings.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Stale badge ───────────────────────────────────────────────────────────────
// A quiet red clock chip showing the age in days. Only rendered when the row
// has been sitting at "submitted" or "pending_manager_review" for more than 7
// days. Returns null for rows under the threshold.

interface StaleBadgeProps {
  daysInQueue: number;
  status: string;
}

const STALE_STATUSES = new Set(["submitted", "pending_manager_review"]);
const STALE_THRESHOLD_DAYS = 7;

export function StaleBadge({ daysInQueue, status }: StaleBadgeProps) {
  if (!STALE_STATUSES.has(status) || daysInQueue <= STALE_THRESHOLD_DAYS) {
    return null;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 border border-red-200 cursor-default"
            data-testid="stale-badge"
          >
            <Clock className="w-3 h-3" />
            {daysInQueue}d
          </span>
        </TooltipTrigger>
        <TooltipContent>Waiting {daysInQueue} days — needs attention</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Routing summary ───────────────────────────────────────────────────────────
// Replaces the plain "N across M zones" cell with a compact breakdown of how
// findings have been routed. Collapses back to the existing style when all
// findings are "repaired in field" (the most common case) or when there are no
// findings at all.

interface RoutingSummaryProps {
  issuesCount: number;
  zonesCount: number;
  findingsRepaired: number;
  findingsToEstimate: number;
  findingsDeferred: number;
}

export function RoutingSummary({
  issuesCount,
  zonesCount,
  findingsRepaired = 0,
  findingsToEstimate = 0,
  findingsDeferred = 0,
}: RoutingSummaryProps) {
  const zoneLabel = `${zonesCount} zone${zonesCount !== 1 ? "s" : ""}`;

  // Collapse to the existing style when:
  //   • No findings at all
  //   • All findings are repaired (most common case)
  //   • No routing has happened yet (all disposition counts are 0) — this also
  //     covers legacy payloads where the disposition fields may be absent.
  const hasRouting = findingsRepaired > 0 || findingsToEstimate > 0 || findingsDeferred > 0;
  if (issuesCount === 0 || !hasRouting || findingsRepaired === issuesCount) {
    return (
      <span>
        {issuesCount} across {zoneLabel}
      </span>
    );
  }

  const parts: string[] = [];
  if (findingsRepaired > 0) parts.push(`${findingsRepaired} repaired`);
  if (findingsToEstimate > 0) parts.push(`${findingsToEstimate} → estimate`);
  if (findingsDeferred > 0) parts.push(`${findingsDeferred} deferred`);
  const other =
    issuesCount - findingsRepaired - findingsToEstimate - findingsDeferred;
  if (other > 0) parts.push(`${other} pending`);

  return <span data-testid="routing-summary">{parts.join(" · ")}</span>;
}

// ── QuickBooks sync icon ──────────────────────────────────────────────────────
// Small green "QB" badge shown inline in the Status cell when invoiceId is set.

export function QbSyncIcon() {
  return (
    <span
      className="inline-flex items-center justify-center w-[22px] h-[16px] rounded-sm bg-green-600 text-white text-[9px] font-bold ml-1.5 align-middle"
      title="Synced to QuickBooks"
      aria-label="Synced to QuickBooks"
      data-testid="qb-sync-icon"
    >
      QB
    </span>
  );
}

// Task #683 — Lifecycle kanban for the Estimate Command Center.
// One column per LifecycleStatus. Cards sorted by total $ desc and
// capped at 6 per column. Column header shows count + summed $; the
// "View all →" deep-link is always rendered and filters the table
// below to that lifecycle. Cards open the existing
// EstimateDetailModal — they do NOT navigate. The whole board is a
// collapsible section (default open).

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { LIFECYCLE_TINTS, lifecycleOf, type LifecycleStatus } from "@workspace/shared";
import { LifecycleCard } from "./lifecycle-card";
import type { Estimate } from "@workspace/db/schema";
import type { EstimateSummary } from "@workspace/db";

const COLUMNS: LifecycleStatus[] = [
  "draft",
  "pending_review",
  "sent",
  "approved",
  "rejected",
  "expired",
];

const COLUMN_CAP = 6;

interface LifecycleKanbanProps {
  estimates: Estimate[];
  // Drives per-column count + summed $ off the server-side
  // aggregator so the kanban headers match the KPI tiles exactly,
  // even when the estimates list is larger than the 500-row page
  // cap the page fetches for card rendering. Optional — falls
  // back to deriving from the visible cards when summary hasn't
  // loaded yet.
  summary?: EstimateSummary | null;
  onOpenEstimate: (id: number) => void;
  onViewAll: (lifecycle: LifecycleStatus) => void;
  buildViewAllHref?: (lifecycle: LifecycleStatus) => string;
}

function totalNum(e: Estimate): number {
  const n = parseFloat(String(e.totalAmount ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function formatCurrencyCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(n) ? n : 0);
}

export function LifecycleKanban({
  estimates,
  summary,
  onOpenEstimate,
  onViewAll,
  buildViewAllHref,
}: LifecycleKanbanProps) {
  const [open, setOpen] = useState(true);
  const grouped = useMemo(() => {
    const out: Record<LifecycleStatus, Estimate[]> = {
      draft: [],
      pending_review: [],
      sent: [],
      approved: [],
      rejected: [],
      expired: [],
    };
    for (const e of estimates) {
      out[lifecycleOf(e)].push(e);
    }
    for (const k of COLUMNS) {
      out[k].sort((a, b) => totalNum(b) - totalNum(a));
    }
    return out;
  }, [estimates]);

  return (
    <div data-testid="lifecycle-kanban-section">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 mb-2"
        data-testid="lifecycle-kanban-toggle"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? "Hide board" : "Show board"}
      </button>
      {open && (
        <div className="flex gap-3 overflow-x-auto pb-2" data-testid="lifecycle-kanban">
          {COLUMNS.map((col) => {
            const rows = grouped[col];
            const tint = LIFECYCLE_TINTS[col];
            // Header count / total come from the server-side summary
            // (canonical, unpaginated) so KPI tiles and kanban
            // columns are guaranteed to agree. Falls back to the
            // visible cards only while summary is still loading.
            const bucket = summary?.byLifecycle?.[col];
            const colCount = bucket ? bucket.count : rows.length;
            const total = bucket
              ? bucket.totalAmount
              : rows.reduce((acc, e) => acc + totalNum(e), 0);
            return (
              <div
                key={col}
                className="w-72 shrink-0 bg-gray-50 rounded-lg border border-gray-200 flex flex-col max-h-[600px]"
                data-testid={`kanban-column-${col}`}
              >
                <div className={`px-3 py-2 border-b ${tint.border}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${tint.text}`}>{tint.label}</span>
                    <span
                      className="text-xs text-gray-500 font-medium"
                      data-testid={`kanban-count-${col}`}
                    >
                      {colCount} · {formatCurrencyCompact(total)}
                    </span>
                  </div>
                </div>
                <div className="p-2 flex-1 overflow-y-auto space-y-2">
                  {rows.length === 0 ? (
                    <div className="text-xs text-gray-400 px-2 py-4 text-center">
                      No estimates
                    </div>
                  ) : (
                    <>
                      {rows.slice(0, COLUMN_CAP).map((e) => (
                        <LifecycleCard key={e.id} estimate={e} onOpen={onOpenEstimate} />
                      ))}
                      {colCount > COLUMN_CAP && (
                        <div
                          className="text-xs text-gray-500 px-2 py-1 text-center italic"
                          data-testid={`kanban-more-${col}`}
                        >
                          +{colCount - COLUMN_CAP} more
                        </div>
                      )}
                    </>
                  )}
                </div>
                <a
                  href={buildViewAllHref ? buildViewAllHref(col) : "#"}
                  onClick={(ev) => {
                    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
                    ev.preventDefault();
                    onViewAll(col);
                  }}
                  className="border-t border-gray-200 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 text-left"
                  data-testid={`kanban-view-all-${col}`}
                >
                  View all {colCount > COLUMN_CAP ? `${colCount} ` : ""}→
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

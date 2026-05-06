import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Estimate, Customer } from "@shared/schema";
import type { LifecycleStatus } from "@shared/lifecycle";
import { computeLifecycleStatus } from "@shared/lifecycle";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Plus, ChevronLeft, RefreshCw } from "lucide-react";
import {
  COLUMN_THEMES,
  EstimateBoardColumn,
} from "./estimate-board-column";
import { EstimateBoardCard } from "./estimate-board-card";
import { EstimateBoardFilter } from "./estimate-board-filter";
import { EstimateBoardExpiredStrip } from "./estimate-board-expired-strip";

interface EstimateBoardProps {
  estimates: Estimate[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onCardClick: (estimateId: number) => void;
  onRefresh: () => void;
  onNewEstimate: () => void;
  refreshing?: boolean;
}

function getLifecycle(est: Estimate): LifecycleStatus {
  if (est.lifecycleStatus) return est.lifecycleStatus;
  return computeLifecycleStatus({
    status: est.status,
    internalStatus: est.internalStatus,
    estimateDate: est.estimateDate,
  });
}

function sortByDateDesc(a: Estimate, b: Estimate) {
  const aDate = new Date(a.estimateDate ?? a.createdAt).getTime();
  const bDate = new Date(b.estimateDate ?? b.createdAt).getTime();
  return bDate - aDate;
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 768 : true,
  );
  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return desktop;
}

export function EstimateBoard({
  estimates,
  isLoading,
  isError,
  onCardClick,
  onRefresh,
  onNewEstimate,
  refreshing,
}: EstimateBoardProps) {
  const [filterCustomerIds, setFilterCustomerIds] = useState<number[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<LifecycleStatus[]>([]);
  const [expandedColumn, setExpandedColumn] =
    useState<LifecycleStatus | null>(null);
  const [mobileExpandedSections, setMobileExpandedSections] = useState<
    Set<LifecycleStatus>
  >(new Set());

  const isDesktop = useIsDesktop();

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Esc clears expanded column on desktop.
  useEffect(() => {
    if (!expandedColumn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedColumn(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expandedColumn]);

  const { buckets, expired, activeCount } = useMemo(() => {
    const list = estimates ?? [];
    const matchesFilters = (est: Estimate, lifecycle: LifecycleStatus) => {
      if (
        filterCustomerIds.length > 0 &&
        (est.customerId == null || !filterCustomerIds.includes(est.customerId))
      ) {
        return false;
      }
      if (
        filterStatuses.length > 0 &&
        !filterStatuses.includes(lifecycle)
      ) {
        return false;
      }
      return true;
    };

    const buckets: Record<LifecycleStatus, Estimate[]> = {
      draft: [],
      pending_review: [],
      sent: [],
      approved: [],
      rejected: [],
      expired: [],
    };
    let activeCount = 0;
    for (const est of list) {
      const lifecycle = getLifecycle(est);
      if (lifecycle !== "rejected" && lifecycle !== "expired") activeCount++;
      if (!matchesFilters(est, lifecycle)) continue;
      buckets[lifecycle].push(est);
    }
    for (const k of Object.keys(buckets) as LifecycleStatus[]) {
      buckets[k].sort(sortByDateDesc);
    }
    return { buckets, expired: buckets.expired, activeCount };
  }, [estimates, filterCustomerIds, filterStatuses]);

  const totalEstimates = estimates?.length ?? 0;

  const headerStrip = (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        {expandedColumn && isDesktop && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpandedColumn(null)}
            data-testid="board-back-to-board"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back to board
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estimates</h1>
          <p className="text-sm text-gray-600">
            {activeCount} active · last 90 days
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onRefresh}
          disabled={refreshing}
          className="focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          data-testid="board-refresh"
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "Checking…" : "Check Status"}
        </Button>
        <EstimateBoardFilter
          customers={customers}
          selectedCustomerIds={filterCustomerIds}
          selectedStatuses={filterStatuses}
          onChange={({ customerIds, statuses }) => {
            setFilterCustomerIds(customerIds);
            setFilterStatuses(statuses);
          }}
        />
        <Button
          type="button"
          onClick={onNewEstimate}
          className="bg-blue-600 hover:bg-blue-700 text-white focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          data-testid="board-new-estimate"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Estimate
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {headerStrip}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {COLUMN_THEMES.map((c) => (
            <div key={c.status} className="flex flex-col">
              <div className={`h-9 rounded-t-md ${c.headerBg} border border-b-0 border-gray-200`} />
              <div className="border border-gray-200 rounded-b-md bg-white p-2 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-14 rounded-md bg-gray-100 animate-pulse"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        {headerStrip}
        <div className="border border-red-200 bg-red-50 rounded-md p-6 text-center">
          <p className="text-sm text-red-800 mb-3">
            Couldn't load estimates.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            data-testid="board-error-retry"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (totalEstimates === 0) {
    return (
      <div className="space-y-4">
        {headerStrip}
        <div className="border border-dashed border-gray-300 rounded-md p-12 text-center bg-white">
          <p className="text-sm text-gray-600 mb-3">No estimates yet</p>
          <Button
            type="button"
            onClick={onNewEstimate}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Estimate
          </Button>
        </div>
      </div>
    );
  }

  // Desktop: 5 columns at lg, 3-2 at md
  const desktopBoard = (
    <div className="space-y-4">
      {expandedColumn ? (
        <div className="grid grid-cols-1 gap-2">
          {(() => {
            const theme = COLUMN_THEMES.find(
              (t) => t.status === expandedColumn,
            )!;
            return (
              <EstimateBoardColumn
                theme={theme}
                estimates={buckets[expandedColumn]}
                onCardClick={onCardClick}
                showCap={false}
              />
            );
          })()}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {COLUMN_THEMES.map((theme) => (
              <EstimateBoardColumn
                key={theme.status}
                theme={theme}
                estimates={buckets[theme.status]}
                onCardClick={onCardClick}
                onExpand={() => setExpandedColumn(theme.status)}
              />
            ))}
          </div>
          <EstimateBoardExpiredStrip
            estimates={expired}
            onCardClick={onCardClick}
          />
        </>
      )}
    </div>
  );

  // Mobile: vertical accordion
  const firstNonEmpty = COLUMN_THEMES.find(
    (t) => buckets[t.status].length > 0,
  )?.status;

  const mobileBoard = (
    <div className="space-y-4">
      <Accordion
        type="multiple"
        defaultValue={firstNonEmpty ? [firstNonEmpty] : []}
        className="space-y-2"
      >
        {COLUMN_THEMES.map((theme) => {
          const items = buckets[theme.status];
          const isExpanded = mobileExpandedSections.has(theme.status);
          const cap = 6;
          const visible = isExpanded ? items : items.slice(0, cap);
          const overflow = Math.max(0, items.length - visible.length);
          return (
            <AccordionItem
              key={theme.status}
              value={theme.status}
              className={`border border-gray-200 rounded-md ${theme.headerBg} overflow-hidden`}
            >
              <AccordionTrigger
                className={`px-3 py-2 hover:no-underline ${theme.headerText}`}
                data-testid={`board-accordion-${theme.status}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {theme.label}
                  <span className="inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-white text-xs font-semibold">
                    {items.length}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="bg-white">
                <div className="p-2 space-y-2">
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">
                      No estimates
                    </p>
                  ) : (
                    <>
                      {visible.map((est) => (
                        <EstimateBoardCard
                          key={est.id}
                          estimate={est}
                          onClick={onCardClick}
                        />
                      ))}
                      {overflow > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setMobileExpandedSections((prev) => {
                              const next = new Set(prev);
                              next.add(theme.status);
                              return next;
                            })
                          }
                          className="w-full text-xs text-blue-600 font-medium py-1.5 rounded hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                          data-testid={`board-accordion-${theme.status}-more`}
                        >
                          + {overflow} more
                        </button>
                      )}
                    </>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      <EstimateBoardExpiredStrip
        estimates={expired}
        onCardClick={onCardClick}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {headerStrip}
      <div className="hidden md:block">{desktopBoard}</div>
      <div className="md:hidden">{mobileBoard}</div>
    </div>
  );
}

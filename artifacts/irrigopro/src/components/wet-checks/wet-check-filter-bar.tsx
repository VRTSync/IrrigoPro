import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const WC_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "submitted,pending_manager_review", label: "Needs Review" },
  { value: "approved_passed_to_billing,billed", label: "Ready to Bill / Billed" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "pending_manager_review", label: "Pending manager review" },
  { value: "approved", label: "Approved" },
  { value: "approved_passed_to_billing", label: "Approved (passed to billing)" },
  { value: "partially_converted", label: "Partially converted" },
  { value: "converted", label: "Converted" },
  { value: "billed", label: "Billed" },
] as const;

const GRANULAR_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "in_progress", label: "In Progress" },
  { value: "submitted", label: "Submitted" },
  { value: "pending_manager_review", label: "Pending Manager Review" },
  { value: "approved", label: "Approved" },
  { value: "approved_passed_to_billing", label: "Approved — Passed to Billing" },
  { value: "partially_converted", label: "Partially Converted" },
  { value: "converted", label: "Converted" },
  { value: "billed", label: "Billed" },
];

export type WcCounts = {
  needsReview: number;
  inProgress: number;
  readyToBill: number;
  billed: number;
  all: number;
  perStatus?: Record<string, number>;
};

type WcCountBucketKey = "needsReview" | "inProgress" | "readyToBill" | "billed" | "all";

type TabDef = {
  value: string;
  label: string;
  countKey: WcCountBucketKey;
  activeClass: string;
  inactiveClass: string;
  badgeClass: string;
  pulseDot?: boolean;
};

const TABS: TabDef[] = [
  {
    value: "submitted,pending_manager_review",
    label: "Needs Review",
    countKey: "needsReview",
    activeClass: "bg-amber-600 text-white border-amber-600 shadow-sm",
    inactiveClass: "bg-white text-amber-700 border-amber-300 hover:bg-amber-50",
    badgeClass: "bg-amber-100 text-amber-800 ring-1 ring-amber-300",
    pulseDot: true,
  },
  {
    value: "in_progress",
    label: "In Progress",
    countKey: "inProgress",
    activeClass: "bg-blue-600 text-white border-blue-600 shadow-sm",
    inactiveClass: "bg-white text-blue-700 border-blue-300 hover:bg-blue-50",
    badgeClass: "bg-blue-100 text-blue-800 ring-1 ring-blue-300",
  },
  {
    value: "approved,approved_passed_to_billing,partially_converted,converted",
    label: "Ready to Bill",
    countKey: "readyToBill",
    activeClass: "bg-emerald-600 text-white border-emerald-600 shadow-sm",
    inactiveClass: "bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50",
    badgeClass: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300",
  },
  {
    value: "billed",
    label: "Billed",
    countKey: "billed",
    activeClass: "bg-slate-500 text-white border-slate-500 shadow-sm",
    inactiveClass: "bg-white text-slate-600 border-slate-300 hover:bg-slate-50",
    badgeClass: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
  },
  {
    value: "all",
    label: "All",
    countKey: "all",
    activeClass: "bg-gray-500 text-white border-gray-500 shadow-sm",
    inactiveClass: "bg-white text-gray-600 border-gray-300 hover:bg-gray-100",
    badgeClass: "bg-gray-100 text-gray-700 ring-1 ring-gray-300",
  },
];

function WcStatusTabs({
  status,
  onStatusChange,
  counts,
  granularActive,
  moreFiltersOpen,
  onToggleMoreFilters,
}: {
  status: string;
  onStatusChange: (v: string) => void;
  counts?: WcCounts;
  granularActive: boolean;
  moreFiltersOpen: boolean;
  onToggleMoreFilters: () => void;
}) {
  return (
    <div className="relative flex items-center gap-2">
      <div
        className="overflow-x-auto scrollbar-none flex-1 min-w-0"
        style={{ maskImage: "linear-gradient(to right, transparent 0%, black 3%, black 94%, transparent 100%)" }}
      >
        <div className="flex items-center gap-2 whitespace-nowrap pb-0.5 px-1">
          {TABS.map((tab) => {
            const isActive = status === tab.value;
            const count = counts?.[tab.countKey] ?? 0;
            const showPulse = tab.pulseDot && count > 0 && !isActive;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onStatusChange(tab.value)}
                data-testid={`tab-wc-status-${tab.countKey}`}
                className={[
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                  isActive ? tab.activeClass : tab.inactiveClass,
                ].join(" ")}
              >
                {showPulse && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                )}
                {tab.label}
                <span
                  className={[
                    "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold",
                    isActive
                      ? "bg-white/25 text-inherit"
                      : tab.badgeClass,
                  ].join(" ")}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleMoreFilters}
        data-testid="button-wc-more-filters-toggle"
        title={moreFiltersOpen ? "Hide granular filters" : "More filters"}
        className={[
          "flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
          moreFiltersOpen || granularActive
            ? "bg-violet-600 text-white border-violet-600 shadow-sm"
            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100",
        ].join(" ")}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">More filters</span>
      </button>
    </div>
  );
}

function MoreFiltersPanel({
  granularStatuses,
  onToggle,
  onClear,
  perStatus,
}: {
  granularStatuses: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
  perStatus?: Record<string, number>;
}) {
  const activeCount = granularStatuses.size;

  return (
    <div
      className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 space-y-3"
      data-testid="wc-more-filters-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-violet-800">Filter by specific status</span>
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-violet-100 text-violet-700 border border-violet-300 text-xs"
              data-testid="badge-wc-granular-active-count"
            >
              {activeCount} active
            </Badge>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            data-testid="button-wc-granular-clear"
            className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {GRANULAR_STATUS_OPTIONS.map((opt) => {
          const checked = granularStatuses.has(opt.value);
          const count = perStatus?.[opt.value] ?? 0;
          return (
            <label
              key={opt.value}
              data-testid={`label-wc-granular-${opt.value}`}
              className={[
                "flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors select-none",
                checked
                  ? "border-violet-400 bg-violet-100 text-violet-800 font-medium"
                  : "border-gray-200 bg-white text-gray-700 hover:border-violet-300 hover:bg-violet-50",
              ].join(" ")}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(opt.value)}
                data-testid={`checkbox-wc-granular-${opt.value}`}
                className="data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
              />
              <span className="flex-1 leading-tight">{opt.label}</span>
              <span
                data-testid={`badge-wc-granular-count-${opt.value}`}
                className={[
                  "inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-xs font-semibold tabular-nums",
                  checked
                    ? "bg-violet-600 text-white"
                    : "bg-gray-100 text-gray-500 ring-1 ring-gray-200",
                ].join(" ")}
              >
                {count}
              </span>
            </label>
          );
        })}
      </div>

      {activeCount === 0 && (
        <p className="text-xs text-violet-600/70">
          Select one or more statuses to narrow the list. The tab strip filters by
          broad bucket; these let you target individual sub-statuses.
        </p>
      )}
    </div>
  );
}

export interface WetCheckFilterBarProps {
  status: string;
  onStatusChange: (v: string) => void;
  customer: string;
  onCustomerChange: (v: string) => void;
  tech: string;
  onTechChange: (v: string) => void;
  company?: string;
  onCompanyChange?: (v: string) => void;
  companies?: Array<{ id: number; name: string }>;
  counts?: WcCounts;
}

export function WetCheckFilterBar({
  status,
  onStatusChange,
  customer,
  onCustomerChange,
  tech,
  onTechChange,
  company,
  onCompanyChange,
  companies = [],
  counts,
}: WetCheckFilterBarProps) {
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [granularStatuses, setGranularStatuses] = useState<Set<string>>(new Set());
  const [lastTabValue, setLastTabValue] = useState(status);

  const granularActive = granularStatuses.size > 0;

  function handleTabChange(v: string) {
    setGranularStatuses(new Set());
    setLastTabValue(v);
    onStatusChange(v);
  }

  function handleToggleMoreFilters() {
    const willOpen = !moreFiltersOpen;
    setMoreFiltersOpen(willOpen);
    if (!willOpen && granularActive) {
      setGranularStatuses(new Set());
      onStatusChange(lastTabValue);
    }
  }

  function handleGranularToggle(value: string) {
    setGranularStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      if (next.size === 0) {
        onStatusChange(lastTabValue);
      } else {
        onStatusChange([...next].join(","));
      }
      return next;
    });
  }

  function handleGranularClear() {
    setGranularStatuses(new Set());
    onStatusChange(lastTabValue);
  }

  const effectiveTabStatus = granularActive ? "all" : status;

  return (
    <Card data-testid="wc-filter-bar">
      <CardContent className="pt-4 flex flex-col gap-3">
        <WcStatusTabs
          status={effectiveTabStatus}
          onStatusChange={handleTabChange}
          counts={counts}
          granularActive={granularActive}
          moreFiltersOpen={moreFiltersOpen}
          onToggleMoreFilters={handleToggleMoreFilters}
        />

        {moreFiltersOpen && (
          <MoreFiltersPanel
            granularStatuses={granularStatuses}
            onToggle={handleGranularToggle}
            onClear={handleGranularClear}
            perStatus={counts?.perStatus}
          />
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Customer, address, or id…"
              value={customer}
              onChange={(e) => onCustomerChange(e.target.value)}
              className="pl-8"
              data-testid="input-wc-customer-filter"
            />
          </div>

          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Technician…"
              value={tech}
              onChange={(e) => onTechChange(e.target.value)}
              className="pl-8"
              data-testid="input-wc-tech-filter"
            />
          </div>

          {onCompanyChange !== undefined && (
            <Select value={company ?? "all"} onValueChange={onCompanyChange}>
              <SelectTrigger className="w-full sm:w-52" data-testid="select-wc-company-filter">
                <SelectValue placeholder="All companies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

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

export type WcCounts = {
  needsReview: number;
  inProgress: number;
  readyToBill: number;
  billed: number;
  all: number;
};

type TabDef = {
  value: string;
  label: string;
  countKey: keyof WcCounts;
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
}: {
  status: string;
  onStatusChange: (v: string) => void;
  counts?: WcCounts;
}) {
  return (
    <div className="relative">
      <div className="overflow-x-auto scrollbar-none" style={{ maskImage: "linear-gradient(to right, transparent 0%, black 3%, black 94%, transparent 100%)" }}>
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
  return (
    <Card data-testid="wc-filter-bar">
      <CardContent className="pt-4 flex flex-col gap-3">
        <WcStatusTabs status={status} onStatusChange={onStatusChange} counts={counts} />

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

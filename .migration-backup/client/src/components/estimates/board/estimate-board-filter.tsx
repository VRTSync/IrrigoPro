import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Filter } from "lucide-react";
import type { Customer } from "@shared/schema";
import type { LifecycleStatus } from "@shared/lifecycle";
import { COLUMN_THEMES } from "./estimate-board-column";

const STATUS_CHIP_THEMES: Record<
  LifecycleStatus,
  { bg: string; text: string; border: string; activeBg: string; activeText: string }
> = {
  draft: {
    bg: "bg-white",
    text: "text-gray-700",
    border: "border-gray-300",
    activeBg: "bg-gray-200",
    activeText: "text-gray-800",
  },
  pending_review: {
    bg: "bg-white",
    text: "text-amber-700",
    border: "border-amber-300",
    activeBg: "bg-amber-100",
    activeText: "text-amber-800",
  },
  sent: {
    bg: "bg-white",
    text: "text-blue-700",
    border: "border-blue-300",
    activeBg: "bg-blue-100",
    activeText: "text-blue-800",
  },
  approved: {
    bg: "bg-white",
    text: "text-green-700",
    border: "border-green-300",
    activeBg: "bg-green-100",
    activeText: "text-green-800",
  },
  rejected: {
    bg: "bg-white",
    text: "text-red-700",
    border: "border-red-300",
    activeBg: "bg-red-100",
    activeText: "text-red-800",
  },
  expired: {
    bg: "bg-white",
    text: "text-orange-700",
    border: "border-orange-300",
    activeBg: "bg-orange-100",
    activeText: "text-orange-800",
  },
};

const ALL_STATUSES: LifecycleStatus[] = [
  ...COLUMN_THEMES.map((c) => c.status),
  "expired",
];

const STATUS_LABELS: Record<LifecycleStatus, string> = {
  draft: "Drafts",
  pending_review: "Pending review",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};

interface EstimateBoardFilterProps {
  customers: Customer[];
  selectedCustomerIds: number[];
  selectedStatuses: LifecycleStatus[];
  onChange: (next: {
    customerIds: number[];
    statuses: LifecycleStatus[];
  }) => void;
}

export function EstimateBoardFilter({
  customers,
  selectedCustomerIds,
  selectedStatuses,
  onChange,
}: EstimateBoardFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const hasActiveFilter =
    selectedCustomerIds.length > 0 || selectedStatuses.length > 0;

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name?.toLowerCase().includes(q));
  }, [customers, search]);

  const toggleCustomer = (id: number) => {
    const next = selectedCustomerIds.includes(id)
      ? selectedCustomerIds.filter((c) => c !== id)
      : [...selectedCustomerIds, id];
    onChange({ customerIds: next, statuses: selectedStatuses });
  };

  const toggleStatus = (status: LifecycleStatus) => {
    const next = selectedStatuses.includes(status)
      ? selectedStatuses.filter((s) => s !== status)
      : [...selectedStatuses, status];
    onChange({ customerIds: selectedCustomerIds, statuses: next });
  };

  const clearAll = () => {
    onChange({ customerIds: [], statuses: [] });
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="relative flex items-center gap-2 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          data-testid="board-filter-trigger"
        >
          <Filter className="w-4 h-4" />
          Filter
          {hasActiveFilter && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-2 ring-white" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        data-testid="board-filter-popover"
      >
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900">Customer</h4>
            {selectedCustomerIds.length > 0 && (
              <span className="text-xs text-gray-500">
                {selectedCustomerIds.length} selected
              </span>
            )}
          </div>
          <Input
            placeholder="Search customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm mb-2"
            data-testid="board-filter-customer-search"
          />
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {filteredCustomers.length === 0 ? (
              <p className="text-xs text-gray-500 py-2">No customers match.</p>
            ) : (
              filteredCustomers.map((c) => {
                const checked = selectedCustomerIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleCustomer(c.id)}
                      data-testid={`board-filter-customer-${c.id}`}
                    />
                    <span className="text-sm text-gray-700 truncate">
                      {c.name}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <Separator />
        <div className="p-3">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Status</h4>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((status) => {
              const theme = STATUS_CHIP_THEMES[status];
              const active = selectedStatuses.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                    active
                      ? `${theme.activeBg} ${theme.activeText} ${theme.border}`
                      : `${theme.bg} ${theme.text} ${theme.border} hover:bg-gray-50`
                  }`}
                  data-testid={`board-filter-status-${status}`}
                >
                  {STATUS_LABELS[status]}
                </button>
              );
            })}
          </div>
        </div>
        <Separator />
        <div className="p-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={!hasActiveFilter}
            data-testid="board-filter-clear"
          >
            Clear all
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setOpen(false)}
            data-testid="board-filter-done"
          >
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

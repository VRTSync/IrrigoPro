import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, Droplets, AlertCircle } from "lucide-react";
import { useArrayQuery, useUnauthenticatedReads } from "@/lib/queryClient";
import { SessionExpiredEmptyState } from "@/components/auth/session-expired-banner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { OfflineStrip } from "@/components/offline/sync-ui";
import type { Customer, WetCheck } from "@workspace/db/schema";

// ─── Per-customer status derived from wet check records ──────────────────────

type CustomerStatus =
  | { kind: "in_progress"; checkId: number | null; clientId: string | null; lastDate: Date | null }
  | { kind: "awaiting_review"; lastDate: Date | null }
  | { kind: "up_to_date"; lastDate: Date }
  | { kind: "never_checked" };

function latestDate(checks: WetCheck[]): Date | null {
  if (checks.length === 0) return null;
  const sorted = [...checks].sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  return new Date(sorted[0].startedAt);
}

function deriveStatus(checks: WetCheck[]): CustomerStatus {
  if (checks.length === 0) return { kind: "never_checked" };

  const last = latestDate(checks);

  const inProgress = checks.find((c) => c.status === "in_progress");
  if (inProgress) {
    return {
      kind: "in_progress",
      checkId: inProgress.id ?? null,
      clientId: inProgress.clientId ?? null,
      lastDate: last,
    };
  }

  const submitted = checks.find((c) => c.status === "submitted");
  if (submitted) return { kind: "awaiting_review", lastDate: last };

  // approved / partially_converted / converted
  return { kind: "up_to_date", lastDate: last! };
}

function formatLastDate(d: Date): string {
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Status chip ─────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: CustomerStatus }) {
  if (status.kind === "in_progress") {
    return (
      <Badge className="bg-blue-600 text-white text-xs shrink-0">
        In Progress
      </Badge>
    );
  }
  if (status.kind === "awaiting_review") {
    return (
      <Badge className="bg-amber-500 text-white text-xs shrink-0">
        Awaiting Review
      </Badge>
    );
  }
  if (status.kind === "up_to_date") {
    return (
      <Badge
        variant="secondary"
        className="bg-green-100 text-green-800 text-xs shrink-0"
      >
        Up to date
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-gray-100 text-gray-500 text-xs shrink-0"
    >
      Never checked
    </Badge>
  );
}

// ─── Customer card ────────────────────────────────────────────────────────────

interface CustomerCardProps {
  customer: Customer;
  status: CustomerStatus;
  onClick: () => void;
}

function CustomerCard({ customer, status, onClick }: CustomerCardProps) {
  const isInProgress = status.kind === "in_progress";

  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left rounded-xl border bg-white p-4 shadow-sm transition-all",
        "hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        isInProgress
          ? "border-blue-400 ring-2 ring-blue-200"
          : "border-gray-200",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`customer-card-${customer.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 truncate">
              {customer.name}
            </span>
            {isInProgress && (
              <Badge className="bg-blue-600 text-white text-xs shrink-0 px-2 py-0.5">
                Resume
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            {customer.address ?? "No address on file"}
          </p>
        </div>
        <StatusChip status={status} />
      </div>

      <div className="mt-2 text-xs text-gray-400 flex items-center gap-2 flex-wrap">
        {/* Last check date — shown on every card that has history */}
        {status.kind !== "never_checked" && status.lastDate && (
          <span>Last check: {formatLastDate(status.lastDate)}</span>
        )}
        {status.kind === "never_checked" && (
          <span>No wet checks on record</span>
        )}
        {/* Status-specific action hint */}
        {status.kind === "in_progress" && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-blue-600 font-medium">Tap to resume</span>
          </>
        )}
        {status.kind === "awaiting_review" && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-amber-600">Awaiting review</span>
          </>
        )}
      </div>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerPickerPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const unauthenticated = useUnauthenticatedReads();

  const { data: customers = [], isLoading: loadingCustomers } =
    useArrayQuery<Customer>({
      queryKey: ["/api/customers"],
    });

  const { data: wetChecks = [], isLoading: loadingWcs } =
    useArrayQuery<WetCheck>({
      queryKey: ["/api/wet-checks"],
    });

  // Build per-customer wet check index
  const checksByCustomer = useMemo(() => {
    const map = new Map<number, WetCheck[]>();
    for (const wc of wetChecks) {
      const list = map.get(wc.customerId) ?? [];
      list.push(wc);
      map.set(wc.customerId, list);
    }
    return map;
  }, [wetChecks]);

  // Sorted: in-progress first, then alphabetical
  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) => {
      const aChecks = checksByCustomer.get(a.id) ?? [];
      const bChecks = checksByCustomer.get(b.id) ?? [];
      const aInProgress = aChecks.some((c) => c.status === "in_progress");
      const bInProgress = bChecks.some((c) => c.status === "in_progress");
      if (aInProgress && !bInProgress) return -1;
      if (!aInProgress && bInProgress) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [customers, checksByCustomer]);

  // Client-side filter
  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedCustomers;
    return sortedCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q)
    );
  }, [sortedCustomers, search]);

  const isLoading = loadingCustomers || loadingWcs;

  function handleCardClick(customer: Customer) {
    navigate(`/wet-checks/c/${customer.id}`);
  }

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">
      <OfflineStrip />

      <div className="flex items-center gap-3">
        <Droplets className="h-6 w-6 text-blue-600 shrink-0" />
        <h1 className="text-2xl font-bold text-gray-900">Wet Checks</h1>
      </div>

      {/* Sticky search bar */}
      <div className="sticky top-0 z-10 bg-gray-50 pt-1 pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Search by customer name or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11 text-base bg-white"
            data-testid="input-customer-search"
          />
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="customer-grid-skeleton"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-gray-200 animate-pulse"
            />
          ))}
        </div>
      ) : unauthenticated ? (
        <SessionExpiredEmptyState message="Your session expired — sign in again to load customers." />
      ) : filteredCustomers.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-16 text-center gap-3"
          data-testid="customer-empty-state"
        >
          <AlertCircle className="h-10 w-10 text-gray-300" />
          {search.trim() ? (
            <>
              <p className="text-gray-600 font-medium">No customers match "{search}"</p>
              <p className="text-sm text-gray-400">Try a different name or address.</p>
            </>
          ) : (
            <>
              <p className="text-gray-600 font-medium">No customers yet</p>
              <p className="text-sm text-gray-400">
                Ask your admin to add one.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {search.trim() === "" && (
            <p className="text-xs text-gray-400 -mt-1">
              {filteredCustomers.length}{" "}
              {filteredCustomers.length === 1 ? "customer" : "customers"}
              {filteredCustomers.some(
                (c) =>
                  (checksByCustomer.get(c.id) ?? []).some(
                    (wc) => wc.status === "in_progress"
                  )
              ) && (
                <span className="ml-1 text-blue-600 font-medium">
                  · In-progress checks shown first
                </span>
              )}
            </p>
          )}
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="customer-grid"
          >
            {filteredCustomers.map((customer) => {
              const checks = checksByCustomer.get(customer.id) ?? [];
              const status = deriveStatus(checks);
              return (
                <CustomerCard
                  key={customer.id}
                  customer={customer}
                  status={status}
                  onClick={() => handleCardClick(customer)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

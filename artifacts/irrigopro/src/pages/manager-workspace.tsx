// Task #1005 — Manager Workspace.
//
// The irrigation manager's daily home page — a sibling to /billing-workspace
// that surfaces wet checks, work orders, and unrouted findings.
//
// Navigation targets (hrefs are built by the API endpoint):
//   wet_check  → /wet-checks/:id
//   work_order → /work-orders?id=:id
//   finding    → /wet-checks/:wetCheckId#finding-:id
//
// Zones:
//   Zone A — 4-indicator status strip (wcs pending review, wos awaiting
//             approval, findings needing routing, approved this week).
//   Zone B — unified queue with filter bar (type, customer, tech, age,
//             status), sort, sticky header, 50/page.
//   Zone C — right-hand detail pane with navigation link.

import irrigoLogoUrl from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Droplets,
  ExternalLink,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { adaptiveRefetchInterval } from "@/lib/queryClient";

type QueueType = "all" | "wet_check" | "work_order" | "finding";

interface ManagerQueueItem {
  id: string;
  type: "wet_check" | "work_order" | "finding";
  refId: number;
  number: string | null;
  customerId: number | null;
  customerName: string | null;
  technicianId: number | null;
  technicianName: string | null;
  total: number;
  status: string;
  hasPhotos: boolean | null;
  flags: string[];
  ageDays: number | null;
  createdAt: string | null;
  href: string;
  wetCheckId?: number | null;
}

interface QueueResponse {
  items: ManagerQueueItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface StatusIndicators {
  wcsPendingReview: number;
  wosAwaitingApproval: number;
  findingsNeedingRouting: number;
  approvedThisWeek: number;
}

interface StatusStrip {
  indicators: StatusIndicators;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const fmt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : CURRENCY.format(n);

const TYPE_FILTER_PARAM: Record<QueueType, string> = {
  all: "all",
  wet_check: "wc",
  work_order: "wo",
  finding: "finding",
};

const TYPE_LABEL: Record<QueueType, string> = {
  all: "All",
  wet_check: "Wet Checks",
  work_order: "Work Orders",
  finding: "Findings",
};

const TYPE_ICON: Record<ManagerQueueItem["type"], React.ReactNode> = {
  wet_check: <Droplets className="w-4 h-4 text-cyan-600" />,
  work_order: <Wrench className="w-4 h-4 text-purple-600" />,
  finding: <AlertTriangle className="w-4 h-4 text-amber-600" />,
};

const AGE_BUCKETS = ["", "<1", "1-3", "3-7", "7+"] as const;
type AgeBucket = (typeof AGE_BUCKETS)[number];

const SORT_OPTIONS = [
  { value: "age_desc", label: "Oldest first" },
  { value: "age_asc", label: "Newest first" },
  { value: "total_desc", label: "Highest $" },
  { value: "total_asc", label: "Lowest $" },
  { value: "customer", label: "Customer A→Z" },
  { value: "tech", label: "Technician A→Z" },
] as const;

const PAGE_SIZE = 50;

function StatusTile({
  label,
  value,
  intent,
  icon,
  testId,
  windowBadge,
  infoTip,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  intent: "ok" | "warn" | "bad" | "neutral";
  icon: React.ReactNode;
  testId: string;
  windowBadge?: string;
  infoTip?: string;
  onClick?: () => void;
}) {
  const border =
    intent === "ok"
      ? "border-l-jobtype-wo"
      : intent === "warn"
        ? "border-l-jobtype-bs"
        : intent === "bad"
          ? "border-l-red-500"
          : "border-l-gray-300";
  const bg =
    intent === "ok"
      ? "bg-green-100 text-green-600"
      : intent === "warn"
        ? "bg-amber-100 text-amber-600"
        : intent === "bad"
          ? "bg-red-100 text-red-600"
          : "bg-gray-100 text-gray-500";
  const interactive = !!onClick;
  return (
    <Card
      className={`border-l-4 ${border} ${interactive ? "cursor-pointer hover:bg-gray-50 transition-colors" : ""}`}
      data-testid={testId}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                {label}
              </p>
              {windowBadge ? (
                <Badge
                  variant="outline"
                  className="h-4 px-1 text-[10px] font-medium text-gray-500 border-gray-200 bg-gray-50"
                  data-testid={`${testId}-window-badge`}
                >
                  {windowBadge}
                </Badge>
              ) : null}
              {infoTip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="w-3.5 h-3.5 text-gray-400 cursor-help inline-flex items-center"
                      data-testid={`${testId}-info`}
                      aria-label="About this metric"
                    >
                      ℹ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {infoTip}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          </div>
          <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueRow({
  item,
  active,
  onSelect,
}: {
  item: ManagerQueueItem;
  active: boolean;
  onSelect: (item: ManagerQueueItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 flex items-center gap-3 transition-colors ${
        active ? "bg-blue-50" : "hover:bg-gray-50"
      }`}
      data-testid={`queue-row-${item.id}`}
    >
      <div className="shrink-0">{TYPE_ICON[item.type]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900 truncate">
            {item.type === "finding"
              ? `Finding #${item.refId}`
              : item.number || `#${item.refId}`}
          </span>
          {item.flags.includes("missing_photos") ? (
            <Badge
              variant="outline"
              className="h-5 px-1.5 border-amber-300 text-amber-700 gap-1"
            >
              <Camera className="w-3 h-3" /> photos
            </Badge>
          ) : null}
          {item.flags.includes("stale") ? (
            <Badge
              variant="outline"
              className="h-5 px-1.5 border-red-300 text-red-700"
            >
              {item.ageDays}d
            </Badge>
          ) : null}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {item.customerName ?? "—"}
          {item.technicianName ? ` · ${item.technicianName}` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {item.total > 0 ? (
          <div className="font-semibold tabular-nums text-sm text-gray-900">
            {fmt(item.total)}
          </div>
        ) : null}
        <div className="text-xs text-gray-400 capitalize">
          {item.status.replace(/_/g, " ")}
        </div>
      </div>
    </button>
  );
}

function DetailPane({
  item,
  onClose,
}: {
  item: ManagerQueueItem;
  onClose: () => void;
}) {
  const typeLabel =
    item.type === "wet_check"
      ? "Wet Check"
      : item.type === "work_order"
        ? "Work Order"
        : "Finding";

  return (
    <div className="p-4 space-y-4" data-testid="manager-detail-pane">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {TYPE_ICON[item.type]}
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {typeLabel}
            </span>
          </div>
          <h2 className="text-lg font-bold text-gray-900">
            {item.type === "finding"
              ? `Finding #${item.refId}`
              : item.number || `#${item.refId}`}
          </h2>
          {item.customerName ? (
            <p className="text-sm text-gray-600">{item.customerName}</p>
          ) : null}
          {item.technicianName ? (
            <p className="text-xs text-gray-400">{item.technicianName}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          data-testid="detail-pane-close"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div>
        <span className="text-xs text-gray-500">Status</span>
        <p className="text-sm font-medium capitalize">
          {item.status.replace(/_/g, " ")}
        </p>
      </div>

      {item.ageDays != null ? (
        <div>
          <span className="text-xs text-gray-500">Age</span>
          <p className="text-sm font-medium">{item.ageDays}d</p>
        </div>
      ) : null}

      <Link href={item.href}>
        <Button className="w-full gap-2" data-testid="detail-open-link">
          <ExternalLink className="w-4 h-4" />
          Open {typeLabel}
        </Button>
      </Link>
    </div>
  );
}

export default function ManagerWorkspacePage() {
  const [, navigate] = useLocation();
  const [type, setType] = useState<QueueType>("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [customer, setCustomer] = useState<string>("");
  const [tech, setTech] = useState<string>("");
  const [age, setAge] = useState<AgeBucket>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sort, setSort] = useState<string>("age_desc");
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 200);
    return () => window.clearTimeout(id);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [type, customer, tech, age, statusFilter, sort]);

  const queueUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (type !== "all") params.set("type", TYPE_FILTER_PARAM[type]);
    if (debouncedQ) params.set("q", debouncedQ);
    if (customer.trim()) params.set("customer", customer.trim());
    if (tech.trim()) params.set("tech", tech.trim());
    if (age) params.set("age", age);
    if (statusFilter.trim()) params.set("status", statusFilter.trim());
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return `/api/manager-workspace/queue?${params.toString()}`;
  }, [type, debouncedQ, customer, tech, age, statusFilter, sort, page]);

  const { data: queue, isLoading: queueLoading } =
    useQuery<QueueResponse | null>({
      queryKey: [queueUrl],
      refetchInterval: adaptiveRefetchInterval(30_000),
    });

  const { data: strip } = useQuery<StatusStrip | null>({
    queryKey: ["/api/manager-workspace/status-strip"],
    refetchInterval: adaptiveRefetchInterval(30_000),
  });

  const items = queue?.items ?? [];
  const total = queue?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (items.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !items.some((x) => x.id === activeId)) {
      setActiveId(items[0].id);
    }
  }, [items, activeId]);

  const activeIndex = activeId
    ? items.findIndex((x) => x.id === activeId)
    : -1;
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  const moveSelection = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const next = Math.max(
        0,
        Math.min(
          items.length - 1,
          (activeIndex < 0 ? 0 : activeIndex) + delta,
        ),
      );
      setActiveId(items[next].id);
    },
    [items, activeIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      if (inField) {
        if (e.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        if (active) setDetailOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (detailOpen) setDetailOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveSelection, active, detailOpen]);

  const ind = strip?.indicators;

  return (
    <div
      className="max-w-7xl mx-auto py-4 px-4 space-y-4"
      data-testid="manager-workspace"
    >
      {/* Header — same gradient chrome as billing-workspace */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-brand px-6 py-5 shadow-lg">
        <img
          src={irrigoLogoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute right-4 top-1/2 -translate-y-1/2 h-[70%] max-h-28 object-contain opacity-[0.07]"
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Manager Workspace</h1>
            <p className="text-sm mt-1" style={{ color: "hsl(var(--primary-light))" }}>
              Review wet checks, work orders, and route findings.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link href="/manager-dashboard">
              <Button
                variant="outline"
                size="sm"
                className="border-white/30 text-white bg-white/10 hover:bg-white/20 hover:text-white"
              >
                Classic View
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Zone A — 4-tile status strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusTile
          label="Wet Checks Pending Review"
          value={
            ind ? (
              ind.wcsPendingReview
            ) : (
              <Skeleton className="h-7 w-12" />
            )
          }
          intent={
            !ind
              ? "neutral"
              : ind.wcsPendingReview === 0
                ? "ok"
                : ind.wcsPendingReview < 5
                  ? "warn"
                  : "bad"
          }
          icon={<Droplets className="w-5 h-5" />}
          testId="status-wcs-pending"
          infoTip="Wet checks with status 'submitted' awaiting manager review (point-in-time)."
          onClick={() => {
            setType("wet_check");
            setStatusFilter("");
          }}
        />
        <StatusTile
          label="Work Orders Awaiting Approval"
          value={
            ind ? (
              ind.wosAwaitingApproval
            ) : (
              <Skeleton className="h-7 w-12" />
            )
          }
          intent={
            !ind
              ? "neutral"
              : ind.wosAwaitingApproval === 0
                ? "ok"
                : ind.wosAwaitingApproval < 5
                  ? "warn"
                  : "bad"
          }
          icon={<Wrench className="w-5 h-5" />}
          testId="status-wos-awaiting"
          infoTip="Work orders in 'pending_manager_review' or 'work_completed' status (point-in-time)."
          onClick={() => {
            setType("work_order");
            setStatusFilter("");
          }}
        />
        <StatusTile
          label="Findings Needing Routing"
          value={
            ind ? (
              ind.findingsNeedingRouting
            ) : (
              <Skeleton className="h-7 w-12" />
            )
          }
          intent={
            !ind
              ? "neutral"
              : ind.findingsNeedingRouting === 0
                ? "ok"
                : ind.findingsNeedingRouting < 10
                  ? "warn"
                  : "bad"
          }
          icon={<AlertTriangle className="w-5 h-5" />}
          testId="status-findings-routing"
          infoTip="Wet-check findings with no routing target set (no billing sheet, estimate, or work order)."
          onClick={() => {
            setType("finding");
            setStatusFilter("");
          }}
        />
        <StatusTile
          label="Approved This Week"
          value={
            ind ? (
              ind.approvedThisWeek
            ) : (
              <Skeleton className="h-7 w-12" />
            )
          }
          intent="ok"
          icon={<CheckCircle2 className="w-5 h-5" />}
          testId="status-approved-this-week"
          windowBadge="7d"
          infoTip="Wet checks, work orders, and billing sheets approved in the last 7 days (rolling window)."
        />
      </div>

      {/* Zone B — unified queue + Zone C inline pane */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <Card>
            {/* Sticky filter / sort bar */}
            <div
              className="sticky top-0 z-10 bg-white border-b border-gray-200 p-3 flex flex-col gap-2"
              data-testid="queue-filter-bar"
            >
              {/* Type filter chips */}
              <div className="flex flex-wrap gap-1.5">
                {(
                  ["all", "wet_check", "work_order", "finding"] as QueueType[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      type === t
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                    }`}
                    data-testid={`filter-chip-${t}`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
              {/* Row 2 — search + filters */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    ref={searchRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search customer, technician… (/ to focus)"
                    className="pl-8 h-9"
                    data-testid="queue-search"
                  />
                </div>
                <Input
                  value={customer}
                  onChange={(e) =>
                    setCustomer(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="Customer #"
                  className="h-9 w-28"
                  data-testid="filter-customer"
                />
                <Input
                  value={tech}
                  onChange={(e) =>
                    setTech(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="Tech #"
                  className="h-9 w-24"
                  data-testid="filter-tech"
                />
                <select
                  value={age}
                  onChange={(e) => setAge(e.target.value as AgeBucket)}
                  className="h-9 rounded-md border border-gray-200 text-sm px-2"
                  data-testid="filter-age"
                >
                  <option value="">Any age</option>
                  <option value="<1">&lt; 1 day</option>
                  <option value="1-3">1–3 days</option>
                  <option value="3-7">3–7 days</option>
                  <option value="7+">7+ days</option>
                </select>
                <Input
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  placeholder="Status"
                  className="h-9 w-32"
                  data-testid="filter-status"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="h-9 rounded-md border border-gray-200 text-sm px-2"
                  data-testid="sort-select"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className="max-h-[640px] overflow-y-auto"
              data-testid="queue-list"
            >
              {queueLoading ? (
                <div className="p-4 space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                  Queue clear. Nothing to review.
                </div>
              ) : (
                items.map((it) => (
                  <QueueRow
                    key={it.id}
                    item={it}
                    active={it.id === activeId}
                    onSelect={(x) => {
                      setActiveId(x.id);
                      setDetailOpen(true);
                    }}
                  />
                ))
              )}
            </div>

            {/* Pager */}
            <div className="flex items-center justify-between p-2 border-t border-gray-100 text-xs text-gray-600">
              <span data-testid="queue-pager-total">
                {total > 0
                  ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`
                  : "0 items"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  data-testid="queue-prev"
                >
                  Prev
                </Button>
                <span>
                  Page {page} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  data-testid="queue-next"
                >
                  Next
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Zone C — detail pane */}
        <div className="hidden lg:block lg:col-span-2">
          <Card className="sticky top-4">
            <CardContent className="pt-4">
              {active && detailOpen ? (
                <DetailPane
                  item={active}
                  onClose={() => setDetailOpen(false)}
                />
              ) : active ? (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    {TYPE_ICON[active.type]}
                    <span className="font-medium text-sm text-gray-900 truncate">
                      {active.type === "finding"
                        ? `Finding #${active.refId}`
                        : active.number || `#${active.refId}`}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {active.customerName ?? "—"}
                  </p>
                  <Button
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => setDetailOpen(true)}
                    data-testid="detail-expand"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Details
                  </Button>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-400">
                  Select a row to preview
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

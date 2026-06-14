// Task #709 — Billing Workspace.
//
// Replaces the legacy /billing-dashboard with a single focused page
// composed of four zones:
//   Zone 0 — slim Financial Pulse header (Billed/Collected/A/R).
//   Zone A — 4-indicator status strip (awaiting approval, approved
//             this week, drafts last 24h, QuickBooks + overdue pill).
//   Zone B — unified approval queue with filter bar (type, customer,
//             tech, age, status), sort, sticky header, 50/page.
//   Zone C — right-hand detail drawer (~40% width) with approve,
//             kickback (reason), save edits, flag, and activity log.
//   Zone D — keyboard shortcuts: J/K row nav, A approve, F open
//             detail, "/" focus search, Esc close, ? cheat sheet,
//             Ctrl+S save edits (NOT approve), B kickback.

import irrigoLogoUrl from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  DollarSign,
  Droplets,
  Flag,
  Info,
  Keyboard,
  Loader2,
  Package,
  RotateCcw,
  Save,
  Search,
  Square,
  Tag,
  Wrench,
  X,
} from "lucide-react";
import { BulkApproveBar } from "@/components/billing-workspace/bulk-approve-bar";
import { DetailPaneInline } from "@/components/billing-workspace/detail-pane-inline";
import { WetChecksTab } from "@/components/billing-workspace/wet-checks-tab";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  adaptiveRefetchInterval,
  apiRequest,
} from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";
import { useAuth } from "@/lib/auth-context";

type QueueType =
  | "all"
  | "billing_sheet"
  | "work_order"
  | "wet_check_billing"
  | "part"
  | "manual_review";

interface QueueItem {
  id: string;
  type: "billing_sheet" | "work_order" | "wet_check_billing" | "part" | "manual_review";
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
  items: QueueItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface StatusStrip {
  awaitingApproval: number;
  approvedThisWeek: number;
  draftsLast24h: number;
  quickbooks: {
    state: "ok" | "degraded" | "down" | "unknown";
    lastSyncAt: string | null;
    pendingSync: number;
    overdueCount: number;
    connectionStatus: string | null;
    recentErrorCount: number;
  };
}

interface QbSyncError {
  id: number;
  estimateId: number | null;
  errorMessage: string;
  occurredAt: string | null;
  source: "estimate_sync" | "integration";
}

interface QbSyncDetail {
  state: "ok" | "degraded" | "down" | "unknown";
  connectionStatus: string | null;
  reconnectRequiredReason: string | null;
  lastSyncAt: string | null;
  pendingSync: number;
  recentErrors: QbSyncError[];
}

interface OverdueSummary {
  overdueCount: number;
  overdueAmount: number;
  agingReportUrl: string;
  // Task #720 — snapshot freshness for the QuickBooks-overdue tile.
  // Server caches the rollup for 15 minutes per role+companyId.
  asOf?: string;
}

// Task #720 — short "HH:MM" label for the overdue tile freshness pill.
function formatAsOfTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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
  billing_sheet: "bs",
  work_order: "wo",
  wet_check_billing: "wcb",
  part: "part",
  manual_review: "review",
};

const TYPE_LABEL: Record<QueueType, string> = {
  all: "All",
  billing_sheet: "Billing Sheets",
  work_order: "Work Orders",
  wet_check_billing: "Wet Check Billings",
  part: "Parts",
  manual_review: "Reviews",
};

const TYPE_ICON: Record<QueueItem["type"], React.ReactNode> = {
  billing_sheet: <ClipboardList className="w-4 h-4 text-blue-600" />,
  work_order: <Wrench className="w-4 h-4 text-purple-600" />,
  wet_check_billing: <Droplets className="w-4 h-4 text-cyan-600" />,
  part: <Package className="w-4 h-4 text-amber-600" />,
  manual_review: <Tag className="w-4 h-4 text-amber-600" />,
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
  pill,
  onClick,
  windowBadge,
  infoTip,
}: {
  label: string;
  value: React.ReactNode;
  intent: "ok" | "warn" | "bad" | "neutral";
  icon: React.ReactNode;
  testId: string;
  pill?: React.ReactNode;
  onClick?: () => void;
  /** Task #720 — small "7d" / "24h" badge for rolling-window tiles. */
  windowBadge?: string;
  /** Task #720 — info tooltip mirroring docs/financial-metrics.md. */
  infoTip?: string;
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
                    <Info
                      className="w-3.5 h-3.5 text-gray-400 cursor-help"
                      data-testid={`${testId}-info`}
                      aria-label="About this metric"
                    />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {infoTip}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
            {pill}
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
  selected,
  onToggle,
}: {
  item: QueueItem;
  active: boolean;
  onSelect: (item: QueueItem) => void;
  selected?: boolean;
  onToggle?: (item: QueueItem) => void;
}) {
  const isSelectable =
    item.type === "billing_sheet" ||
    item.type === "work_order" ||
    item.type === "wet_check_billing";
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 flex items-center gap-3 transition-colors ${
        active ? "bg-blue-50" : selected ? "bg-green-50" : "hover:bg-gray-50"
      }`}
      data-testid={`queue-row-${item.id}`}
    >
      {isSelectable && onToggle && (
        <span
          role="checkbox"
          aria-checked={selected}
          data-testid={`queue-row-checkbox-${item.id}`}
          className="shrink-0 text-gray-400 hover:text-blue-600 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item);
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              onToggle(item);
            }
          }}
          tabIndex={0}
        >
          {selected ? (
            <CheckSquare className="w-4 h-4 text-blue-600" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </span>
      )}
      <div className="shrink-0">{TYPE_ICON[item.type]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-gray-900 truncate">
            {item.number || `#${item.refId}`}
          </span>
          {item.flags.includes("missing_photos") ? (
            <Badge variant="outline" className="h-5 px-1.5 border-amber-300 text-amber-700 gap-1">
              <Camera className="w-3 h-3" /> photos
            </Badge>
          ) : null}
          {item.flags.includes("unpriced") ? (
            <Badge variant="outline" className="h-5 px-1.5 border-amber-300 text-amber-700">
              unpriced
            </Badge>
          ) : null}
          {item.flags.includes("stale") ? (
            <Badge variant="outline" className="h-5 px-1.5 border-red-300 text-red-700">
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
        <div className="font-semibold tabular-nums text-sm text-gray-900">{fmt(item.total)}</div>
        <div className="text-xs text-gray-400 capitalize">{item.status.replace(/_/g, " ")}</div>
      </div>
    </button>
  );
}

function ShortcutsCheatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="shortcuts-cheatsheet"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Keyboard className="w-5 h-5" /> Keyboard Shortcuts
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <dl className="space-y-2 text-sm">
          {[
            ["J", "Next row"],
            ["K", "Previous row (or Kickback when drawer is open)"],
            ["A", "Approve highlighted item"],
            ["Shift+A", "Bulk-approve all selected items (checkboxes)"],
            ["B", "Open kickback drawer"],
            ["F", "Open detail drawer"],
            ["/", "Focus search"],
            ["Ctrl+S", "Save edits (no approve)"],
            ["Esc", "Close drawer / search"],
            ["?", "Show this list"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <kbd className="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs">{k}</kbd>
              <span className="text-gray-700">{v}</span>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export default function BillingWorkspacePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const userRole = user?.role ?? "";

  // Seed initial filter state from URL search params so that drill-down
  // links from Command Center / Customer Billing land with the correct
  // preset.  We read the params once at construction time — no reactive
  // subscription needed because the user stays on this page.
  const _initParams = useMemo(() => new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ), []);
  const _initStatusRaw = _initParams.get("status");
  const _initCustomer = _initParams.get("customer") ?? "";
  // status=approved → approved_passed_to_billing; status=unapproved → "" (default pending view)
  const _initStatus =
    _initStatusRaw === "approved"
      ? "approved_passed_to_billing"
      : _initStatusRaw === "unapproved"
        ? ""
        : "";

  const [type, setType] = useState<QueueType>("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [customer, setCustomer] = useState<string>(_initCustomer);
  const [tech, setTech] = useState<string>("");
  const [age, setAge] = useState<AgeBucket>("");
  const [statusFilter, setStatusFilter] = useState<string>(_initStatus);
  const [sort, setSort] = useState<string>("age_desc");
  const [page, setPage] = useState(1);
  const [minTotal, setMinTotal] = useState<number>(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const _initTab = _initParams.get("tab") === "wet_checks" ? "wet_checks" : "queue";
  const [workspaceTab, setWorkspaceTab] = useState<"queue" | "wet_checks">(_initTab);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [qbDrawerOpen, setQbDrawerOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [approving, setApproving] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // selectedItemsMap persists full QueueItem metadata across page turns so that
  // bulkApprove can resolve IDs that are no longer in the current items slice.
  const [selectedItemsMap, setSelectedItemsMap] = useState<Map<string, QueueItem>>(new Map());
  const [kickingBack, setKickingBack] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kickbackReason, setKickbackReason] = useState("");
  const [editedNote, setEditedNote] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const toggleSelected = useCallback((item: QueueItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    setSelectedItemsMap((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }, []);

  const clearSelected = useCallback(() => {
    setSelected(new Set());
    setSelectedItemsMap(new Map());
  }, []);

  // Debounce free-text search.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 200);
    return () => window.clearTimeout(id);
  }, [q]);

  // Reset to page 1 on any filter/sort change.
  useEffect(() => {
    setPage(1);
  }, [type, customer, tech, age, statusFilter, sort]);

  // Sync statusFilter + customer + workspaceTab back to the URL so drill-down
  // links remain bookmarkable after the user changes filters (canonical round-trip).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (statusFilter === "approved_passed_to_billing") {
      params.set("status", "approved");
    } else if (statusFilter === "") {
      // Canonicalize empty statusFilter as status=unapproved so drill-down
      // URLs remain bookmarkable and round-trip correctly.
      params.set("status", "unapproved");
    } else {
      params.delete("status");
    }
    if (customer.trim()) {
      params.set("customer", customer.trim());
    } else {
      params.delete("customer");
    }
    if (workspaceTab === "wet_checks") {
      params.set("tab", "wet_checks");
    } else {
      params.delete("tab");
    }
    const search = params.toString();
    const newUrl = search
      ? `${window.location.pathname}?${search}`
      : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [statusFilter, customer, workspaceTab]);

  const queueUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (type !== "all") params.set("type", TYPE_FILTER_PARAM[type]);
    if (debouncedQ) params.set("q", debouncedQ);
    if (customer.trim()) params.set("customer", customer.trim());
    if (tech.trim()) params.set("tech", tech.trim());
    if (age) params.set("age", age);
    if (statusFilter.trim()) params.set("status", statusFilter.trim());
    if (sort) params.set("sort", sort);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return `/api/billing-workspace/queue?${params.toString()}`;
  }, [type, debouncedQ, customer, tech, age, statusFilter, sort, page]);

  const { data: queue, isLoading: queueLoading } = useQuery<QueueResponse | null>({
    queryKey: [queueUrl],
    refetchInterval: adaptiveRefetchInterval(30_000),
  });

  const { data: strip } = useQuery<StatusStrip | null>({
    queryKey: ["/api/billing-workspace/status-strip"],
    refetchInterval: adaptiveRefetchInterval(30_000),
  });

  const { data: overdue } = useQuery<OverdueSummary | null>({
    queryKey: ["/api/quickbooks/overdue-summary"],
    refetchInterval: adaptiveRefetchInterval(60_000),
  });

  const { data: qbDetail, isLoading: qbDetailLoading } = useQuery<QbSyncDetail | null>({
    queryKey: ["/api/billing-workspace/quickbooks-sync"],
    enabled: qbDrawerOpen,
    refetchInterval: qbDrawerOpen ? adaptiveRefetchInterval(30_000) : false,
  });

  const retrySync = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const data = (await apiRequest(
        "/api/billing-workspace/quickbooks-sync/retry",
        "POST",
        {},
      )) as { requeued?: number };
      const n = data?.requeued ?? 0;
      toast({
        title: "Sync requeued",
        description: n > 0 ? `${n} item${n === 1 ? "" : "s"} queued for retry.` : "No failed syncs to retry.",
      });
      qc.invalidateQueries({ queryKey: ["/api/billing-workspace/quickbooks-sync"] });
      qc.invalidateQueries({ queryKey: ["/api/billing-workspace/status-strip"] });
    } catch (err) {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRetrying(false);
    }
  }, [retrying, toast, qc]);

  const items = (queue?.items ?? []).filter((it) =>
    minTotal > 0 ? Number(it.total ?? 0) > minTotal : true,
  );
  const total = queue?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Auto-select first row when list changes.
  useEffect(() => {
    if (items.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !items.some((x) => x.id === activeId)) {
      setActiveId(items[0].id);
    }
  }, [items, activeId]);

  const activeIndex = activeId ? items.findIndex((x) => x.id === activeId) : -1;
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  // Reset drawer-local edit state when the active row changes.
  useEffect(() => {
    setEditedNote("");
    setKickbackReason("");
    setIsDirty(false);
  }, [activeId]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const next = Math.max(0, Math.min(items.length - 1, (activeIndex < 0 ? 0 : activeIndex) + delta));
      setActiveId(items[next].id);
    },
    [items, activeIndex],
  );

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ predicate: (qq) =>
      typeof qq.queryKey[0] === "string" &&
      (qq.queryKey[0] as string).startsWith("/api/billing-workspace/"),
    });
    qc.invalidateQueries({ queryKey: ["/api/quickbooks/overdue-summary"] });
  }, [qc]);

  const advanceToNext = useCallback(() => {
    // Auto-advance after approve/kickback: the row will fall off the
    // refetch but we move immediately for snappiness.
    const nextIdx = Math.min(activeIndex + 1, items.length - 1);
    setActiveId(items[nextIdx]?.id ?? null);
  }, [activeIndex, items]);

  const approveActive = useCallback(async () => {
    if (!active || approving) return;
    setApproving(true);
    try {
      let path: string | null = null;
      if (active.type === "billing_sheet") path = `/api/billing-sheets/${active.refId}/approve`;
      else if (active.type === "work_order") path = `/api/work-orders/${active.refId}/approve`;
      else if (active.type === "wet_check_billing" && active.wetCheckId) {
        // Wet check billings no longer have a standalone approve step (Task #1090).
        // The manager must convert the wet check via the triage wizard before the
        // WCB becomes eligible for invoicing.
        window.location.href = `/manager/wet-checks/${active.wetCheckId}`;
        return;
      } else {
        window.location.href = "/parts-pending-approval";
        return;
      }
      await apiRequest(path, "POST", {});
      toast({ title: "Approved", description: `${active.number ?? active.id} approved.` });
      advanceToNext();
      invalidateAll();
    } catch (err) {
      toast({
        title: "Approve failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setApproving(false);
    }
  }, [active, approving, advanceToNext, invalidateAll, toast]);

  const kickbackActive = useCallback(
    async (reason: string) => {
      if (!active || kickingBack) return;
      const trimmed = reason.trim();
      if (!trimmed) {
        toast({
          title: "Reason required",
          description: "Tell the tech what needs to change.",
          variant: "destructive",
        });
        return;
      }
      setKickingBack(true);
      try {
        let path: string | null = null;
        if (active.type === "billing_sheet") path = `/api/billing-sheets/${active.refId}/return-for-correction`;
        else if (active.type === "work_order") path = `/api/work-orders/${active.refId}/return-for-correction`;
        else {
          toast({ title: "Not supported", description: "Use Open to handle this item." });
          return;
        }
        await apiRequest(path, "POST", { notes: trimmed });
        toast({ title: "Kicked back", description: "Technician notified." });
        setKickbackReason("");
        advanceToNext();
        invalidateAll();
      } catch (err) {
        toast({
          title: "Kickback failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setKickingBack(false);
      }
    },
    [active, kickingBack, advanceToNext, invalidateAll, toast],
  );

  const saveActiveEdits = useCallback(async () => {
    if (!active || saving) return;
    if (!isDirty) {
      toast({ title: "Nothing to save", description: "No edits pending." });
      return;
    }
    setSaving(true);
    try {
      let path: string | null = null;
      if (active.type === "billing_sheet") path = `/api/billing-sheets/${active.refId}`;
      else if (active.type === "work_order") path = `/api/work-orders/${active.refId}`;
      else {
        toast({ title: "Not editable here", description: "Open the dedicated screen." });
        return;
      }
      await apiRequest(path, "PATCH", { note: editedNote });
      toast({ title: "Saved", description: "Edits saved without approving." });
      setIsDirty(false);
      invalidateAll();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [active, saving, isDirty, editedNote, invalidateAll, toast]);

  const flagActive = useCallback(async () => {
    if (!active) return;
    try {
      await apiRequest(`/api/billing-workspace/flag`, "POST", {
        id: active.id,
        type: active.type,
        refId: active.refId,
      });
      toast({ title: "Flagged", description: "Item flagged for review." });
      invalidateAll();
    } catch (err) {
      toast({
        title: "Flag failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [active, invalidateAll, toast]);

  // Task #1083 — Bulk approve all selected items via the dedicated endpoint.
  const bulkApprove = useCallback(async (overrideItems?: QueueItem[]) => {
    if (bulkApproving) return;
    // Use selectedItemsMap so cross-page selections survive a page turn;
    // overrideItems (per-customer approve-all) bypasses the selection set.
    const targets = overrideItems ?? Array.from(selectedItemsMap.values());
    const eligible = targets.filter(
      (it) =>
        it.type === "billing_sheet" ||
        it.type === "work_order" ||
        it.type === "wet_check_billing",
    );
    if (eligible.length === 0) {
      toast({ title: "Nothing to approve", description: "No eligible items selected." });
      return;
    }
    setBulkApproving(true);
    try {
      const result = (await apiRequest(
        "/api/billing-workspace/bulk-approve",
        "POST",
        { items: eligible.map((it) => ({ type: it.type, id: it.refId })) },
      )) as { approved: number; skipped: { id: number; type: string; reason: string }[] };
      const n = result.approved;
      toast({
        title: `Approved ${n} item${n === 1 ? "" : "s"}`,
        description:
          result.skipped.length > 0
            ? `${result.skipped.length} item${result.skipped.length === 1 ? "" : "s"} skipped.`
            : undefined,
      });
      setSelected(new Set());
      setSelectedItemsMap(new Map());
      invalidateAll();
    } catch (err) {
      toast({
        title: "Bulk approve failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBulkApproving(false);
    }
  }, [bulkApproving, selectedItemsMap, toast, invalidateAll]);

  // Zone D — keyboard shortcuts. Spec:
  //   J=next, K=previous, A=approve, B=kickback, F=open drawer,
  //   "/"=focus search, Esc=close, ?=help, Ctrl+S=save edits.
  // While focus is in an input/textarea, only Ctrl+S and Esc fire so
  // the user can type normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField =
        tag === "input" || tag === "textarea" || target?.isContentEditable;
      // Ctrl/Cmd+S — save edits (does NOT approve).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActiveEdits();
        return;
      }
      if (inField) {
        if (e.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === "k" || e.key === "K") {
        // K disambiguation: with the drawer open, K kicks back the
        // focused row using whatever reason has been typed (or opens
        // the drawer / focuses the reason field if none yet). With
        // the drawer closed, K is plain previous-row navigation so
        // the operator can still walk the queue from the keyboard.
        e.preventDefault();
        if (drawerOpen && active) {
          if (kickbackReason.trim()) {
            void kickbackActive(kickbackReason);
          } else {
            const ta = document.querySelector<HTMLTextAreaElement>(
              '[data-testid="kickback-reason"]',
            );
            ta?.focus();
          }
        } else {
          moveSelection(-1);
        }
      } else if ((e.key === "A") && e.shiftKey) {
        // Shift+A — bulk-approve all selected items.
        e.preventDefault();
        void bulkApprove();
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void approveActive();
      } else if (e.key === "b" || e.key === "B") {
        // B opens the drawer and pre-focuses the kickback reason —
        // alias kept so muscle memory works either way.
        e.preventDefault();
        setDrawerOpen(true);
        setTimeout(() => {
          document.querySelector<HTMLTextAreaElement>(
            '[data-testid="kickback-reason"]',
          )?.focus();
        }, 50);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (active) setDrawerOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
      } else if (e.key === "Escape") {
        if (cheatsheetOpen) setCheatsheetOpen(false);
        else if (drawerOpen) setDrawerOpen(false);
      } else if (e.key === "Enter") {
        if (active) setDrawerOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    moveSelection,
    approveActive,
    bulkApprove,
    saveActiveEdits,
    cheatsheetOpen,
    drawerOpen,
    active,
    kickbackReason,
    kickbackActive,
  ]);

  const qbState = strip?.quickbooks?.state ?? "unknown";
  const qbIntent: "ok" | "warn" | "bad" | "neutral" =
    qbState === "ok"
      ? "ok"
      : qbState === "degraded"
        ? "warn"
        : qbState === "down"
          ? "bad"
          : "neutral";

  const overdueCount = strip?.quickbooks?.overdueCount ?? overdue?.overdueCount ?? 0;
  const overdueAmount = overdue?.overdueAmount ?? 0;

  return (
    <div className="max-w-7xl mx-auto py-4 px-4 space-y-4" data-testid="billing-workspace">
      {/* Header — Task #818: brand-palette gradient with logo watermark */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-brand px-6 py-5 shadow-lg">
        {/* Decorative logo watermark */}
        <img
          src={irrigoLogoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute right-4 top-1/2 -translate-y-1/2 h-[70%] max-h-28 object-contain opacity-[0.07]"
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Billing Workspace</h1>
            <p className="text-sm mt-1" style={{ color: "hsl(var(--primary-light))" }}>
              Approve, kick back, and clear the queue.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCheatsheetOpen(true)}
              data-testid="shortcuts-button"
              className="border-white/30 text-white bg-white/10 hover:bg-white/20 hover:text-white"
            >
              <Keyboard className="w-4 h-4 mr-1" /> Shortcuts
            </Button>
            <Link href="/billing/command-center">
              <Button
                variant="outline"
                size="sm"
                className="border-white/30 text-white bg-white/10 hover:bg-white/20 hover:text-white"
              >
                Command Center
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Zone 0 — FP billing-header */}
      <FinancialPulseWidget variant="billing-header" />

      {/* Zone A — 4-tile status strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusTile
          label="Awaiting Action"
          value={strip ? strip.awaitingApproval : <Skeleton className="h-7 w-12" />}
          intent={
            !strip
              ? "neutral"
              : strip.awaitingApproval === 0
                ? "ok"
                : strip.awaitingApproval < 10
                  ? "warn"
                  : "bad"
          }
          icon={<ClipboardList className="w-5 h-5" />}
          testId="status-awaiting-approval"
          infoTip="Open billing sheets, work orders, and wet-check billings awaiting billing action (point-in-time)."
        />
        <StatusTile
          label="Approved This Week"
          value={strip ? strip.approvedThisWeek : <Skeleton className="h-7 w-12" />}
          intent="ok"
          icon={<CheckCircle2 className="w-5 h-5" />}
          testId="status-approved-this-week"
          windowBadge="7d"
          infoTip="Billing sheets and work orders approved in the last 7 days (rolling window)."
        />
        <StatusTile
          label="Drafts Last 24h"
          value={strip ? strip.draftsLast24h : <Skeleton className="h-7 w-12" />}
          intent={!strip ? "neutral" : strip.draftsLast24h === 0 ? "neutral" : "warn"}
          icon={<Tag className="w-5 h-5" />}
          testId="status-drafts-24h"
          windowBadge="24h"
          infoTip="Billing sheets and work orders created in the last 24 hours (rolling window)."
        />
        <StatusTile
          label="QuickBooks"
          value={
            <span className="capitalize text-base" data-testid="qb-state-label">
              {qbState}
            </span>
          }
          pill={
            <div className="mt-1 space-y-0.5">
              {strip?.quickbooks?.lastSyncAt ? (
                <span className="block text-xs font-normal text-gray-500" data-testid="qb-last-sync">
                  Synced {new Date(strip.quickbooks.lastSyncAt).toLocaleString()}
                </span>
              ) : strip?.quickbooks ? (
                <span className="block text-xs font-normal text-gray-400" data-testid="qb-last-sync">
                  Never synced
                </span>
              ) : null}
              {strip?.quickbooks && strip.quickbooks.pendingSync > 0 ? (
                <span className="block text-xs font-normal text-amber-700" data-testid="qb-pending-count">
                  {strip.quickbooks.pendingSync} queued
                </span>
              ) : null}
              {strip?.quickbooks && strip.quickbooks.recentErrorCount > 0 ? (
                <span className="block text-xs font-normal text-red-700" data-testid="qb-error-count">
                  {strip.quickbooks.recentErrorCount} sync error{strip.quickbooks.recentErrorCount === 1 ? "" : "s"}
                </span>
              ) : null}
              {overdueCount > 0 ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link href={overdue?.agingReportUrl ?? "/financial-pulse/ar-aging"}>
                    <Badge
                      variant="outline"
                      className="border-red-300 text-red-700 cursor-pointer"
                      data-testid="qb-overdue-pill"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {overdueCount} overdue in QuickBooks · {fmt(overdueAmount)}
                    </Badge>
                  </Link>
                  {formatAsOfTime(overdue?.asOf) ? (
                    <span
                      className="text-[10px] text-gray-400"
                      data-testid="qb-overdue-asof"
                    >
                      as of {formatAsOfTime(overdue?.asOf)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
          intent={qbIntent}
          icon={<DollarSign className="w-5 h-5" />}
          testId="status-quickbooks"
          onClick={() => setQbDrawerOpen(true)}
        />
      </div>

      {/* Zone B tab strip (Task #1093) */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setWorkspaceTab("queue")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            workspaceTab === "queue"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
          data-testid="tab-queue"
        >
          Approval Queue
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceTab("wet_checks")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
            workspaceTab === "wet_checks"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          }`}
          data-testid="tab-wet-checks"
        >
          <Droplets className="w-3.5 h-3.5" />
          Wet Checks
        </button>
      </div>

      {/* Zone B — Wet Checks tab */}
      {workspaceTab === "wet_checks" && (
        <WetChecksTab />
      )}

      {/* Zone B — unified queue + Zone C drawer */}
      <div className={`grid grid-cols-1 lg:grid-cols-5 gap-4 ${workspaceTab !== "queue" ? "hidden" : ""}`}>
        <div className="lg:col-span-3">
          <Card>
            {/* Sticky filter / sort bar */}
            <div
              className="sticky top-0 z-10 bg-white border-b border-gray-200 p-3 flex flex-col gap-2"
              data-testid="queue-filter-bar"
            >
              {/* Preset filter buttons */}
              <div className="flex flex-wrap gap-1.5" data-testid="queue-presets">
                <button
                  type="button"
                  onClick={() => { setType("all"); setMinTotal(0); setStatusFilter(""); }}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 bg-gray-50 hover:bg-gray-100"
                  data-testid="preset-all-pending"
                >
                  All Pending
                </button>
                <button
                  type="button"
                  onClick={() => { setType("part"); setMinTotal(0); setStatusFilter(""); }}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 bg-gray-50 hover:bg-gray-100"
                  data-testid="preset-just-parts"
                >
                  Just Parts
                </button>
                <button
                  type="button"
                  onClick={() => { setType("all"); setMinTotal(1000); }}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border border-gray-200 bg-gray-50 hover:bg-gray-100"
                  data-testid="preset-over-1000"
                >
                  &gt; $1,000
                </button>
                {/* Task #1083 — per-customer bulk approve */}
                {customer.trim() !== "" && items.length > 0 && total <= PAGE_SIZE && (
                  <button
                    type="button"
                    onClick={() => void bulkApprove(items)}
                    disabled={bulkApproving}
                    className="px-2.5 py-1 rounded-md text-xs font-medium border border-green-300 bg-green-50 text-green-800 hover:bg-green-100 disabled:opacity-50"
                    data-testid="preset-approve-all-customer"
                  >
                    {bulkApproving ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Approving…
                      </span>
                    ) : (
                      `Approve all (${items.length})`
                    )}
                  </button>
                )}
                {customer.trim() !== "" && total > PAGE_SIZE && (
                  <span
                    className="px-2.5 py-1 text-xs text-amber-700 italic"
                    data-testid="preset-approve-all-refine-note"
                  >
                    Showing first {PAGE_SIZE} — refine filter to bulk-approve.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "billing_sheet", "work_order", "wet_check_billing", "part", "manual_review"] as QueueType[]).map((t) => (
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
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    ref={searchRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search number, customer, technician… (/ to focus)"
                    className="pl-8 h-9"
                    data-testid="queue-search"
                  />
                </div>
                <Input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Customer #"
                  className="h-9 w-28"
                  data-testid="filter-customer"
                />
                <Input
                  value={tech}
                  onChange={(e) => setTech(e.target.value.replace(/[^0-9]/g, ""))}
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
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="max-h-[640px] overflow-y-auto" data-testid="queue-list">
              {queueLoading ? (
                <div className="p-4 space-y-2">
                  {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                  Inbox zero. Nothing to approve.
                </div>
              ) : (
                <>
                  {/* Select-all header row */}
                  {(() => {
                    const selectable = items.filter(
                      (it) =>
                        it.type === "billing_sheet" ||
                        it.type === "work_order" ||
                        it.type === "wet_check_billing",
                    );
                    const allSelected =
                      selectable.length > 0 &&
                      selectable.every((it) => selected.has(it.id));
                    const handleSelectAll = () => {
                      if (allSelected) {
                        // Deselect only current-page selectable items
                        setSelected((prev) => {
                          const next = new Set(prev);
                          selectable.forEach((it) => next.delete(it.id));
                          return next;
                        });
                        setSelectedItemsMap((prev) => {
                          const next = new Map(prev);
                          selectable.forEach((it) => next.delete(it.id));
                          return next;
                        });
                      } else {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          selectable.forEach((it) => next.add(it.id));
                          return next;
                        });
                        setSelectedItemsMap((prev) => {
                          const next = new Map(prev);
                          selectable.forEach((it) => next.set(it.id, it));
                          return next;
                        });
                      }
                    };
                    return (
                      <div className="px-3 py-1.5 border-b border-gray-200 bg-gray-50 flex items-center gap-2 text-xs text-gray-600 select-none">
                        <span
                          role="checkbox"
                          aria-checked={allSelected}
                          aria-label="Select all on this page"
                          tabIndex={0}
                          data-testid="select-all-checkbox"
                          className="cursor-pointer text-gray-400 hover:text-blue-600"
                          onClick={handleSelectAll}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                              e.preventDefault();
                              handleSelectAll();
                            }
                          }}
                        >
                          {allSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </span>
                        <span>Select page</span>
                        {selected.size > 0 && (
                          <span className="text-blue-600 font-medium" data-testid="selected-count-label">
                            {selected.size} selected
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {items.map((it) => (
                    <QueueRow
                      key={it.id}
                      item={it}
                      active={it.id === activeId}
                      onSelect={(x) => {
                        setActiveId(x.id);
                        setDrawerOpen(true);
                      }}
                      selected={selected.has(it.id)}
                      onToggle={toggleSelected}
                    />
                  ))}
                </>
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
                <span>Page {page} / {pageCount}</span>
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

        {/* Inline preview pane on lg+ */}
        <div className="hidden lg:block lg:col-span-2">
          <Card className="sticky top-4">
            <CardContent className="pt-4">
              {active ? (
                <DetailPaneInline item={active} userRole={userRole}>
                  <DetailPane
                    item={active}
                    userRole={userRole}
                    approving={approving}
                    kickingBack={kickingBack}
                    saving={saving}
                    kickbackReason={kickbackReason}
                    editedNote={editedNote}
                    isDirty={isDirty}
                    onApprove={approveActive}
                    onKickback={kickbackActive}
                    onSave={saveActiveEdits}
                    onFlag={flagActive}
                    onChangeKickbackReason={setKickbackReason}
                    onChangeNote={(v) => { setEditedNote(v); setIsDirty(true); }}
                  />
                </DetailPaneInline>
              ) : (
                <div className="text-sm text-gray-500 text-center py-10">
                  Select a row to preview details.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Zone C — drawer for narrow viewports */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[55%] sm:min-w-[560px] overflow-y-auto"
          data-testid="detail-drawer"
        >
          <SheetHeader>
            <SheetTitle>{active?.number ?? `Item ${active?.refId ?? ""}`}</SheetTitle>
            <SheetDescription>
              {active?.customerName ?? "—"}
              {active?.technicianName ? ` · ${active.technicianName}` : ""}
            </SheetDescription>
          </SheetHeader>
          {active ? (
            <div className="mt-4">
              <DetailPaneInline item={active} userRole={userRole}>
                <DetailPane
                  item={active}
                  userRole={userRole}
                  approving={approving}
                  kickingBack={kickingBack}
                  saving={saving}
                  kickbackReason={kickbackReason}
                  editedNote={editedNote}
                  isDirty={isDirty}
                  onApprove={approveActive}
                  onKickback={kickbackActive}
                  onSave={saveActiveEdits}
                  onFlag={flagActive}
                  onChangeKickbackReason={setKickbackReason}
                  onChangeNote={(v) => { setEditedNote(v); setIsDirty(true); }}
                />
              </DetailPaneInline>
            </div>
          ) : null}
          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* QuickBooks sync details drawer */}
      <Sheet open={qbDrawerOpen} onOpenChange={setQbDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[40%] sm:min-w-[420px] overflow-y-auto"
          data-testid="qb-sync-drawer"
        >
          <SheetHeader>
            <SheetTitle>QuickBooks sync</SheetTitle>
            <SheetDescription>
              Last sync, queue depth, and recent sync errors.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-gray-500">Connection</dt>
              <dd className="text-right capitalize" data-testid="qb-drawer-connection">
                {qbDetail?.connectionStatus
                  ? qbDetail.connectionStatus.replace(/_/g, " ")
                  : "—"}
              </dd>
              <dt className="text-gray-500">State</dt>
              <dd className="text-right capitalize">{qbDetail?.state ?? "—"}</dd>
              <dt className="text-gray-500">Last sync</dt>
              <dd className="text-right" data-testid="qb-drawer-last-sync">
                {qbDetail?.lastSyncAt
                  ? new Date(qbDetail.lastSyncAt).toLocaleString()
                  : "Never"}
              </dd>
              <dt className="text-gray-500">Queued</dt>
              <dd className="text-right tabular-nums" data-testid="qb-drawer-pending">
                {qbDetail?.pendingSync ?? 0}
              </dd>
            </dl>

            {qbDetail?.reconnectRequiredReason ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                <strong className="block mb-1">Reconnect required</strong>
                {qbDetail.reconnectRequiredReason}
              </div>
            ) : null}

            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">
                Recent sync errors
              </p>
              {qbDetailLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              ) : (qbDetail?.recentErrors?.length ?? 0) === 0 ? (
                <p className="text-xs text-gray-400" data-testid="qb-drawer-empty">
                  No recent sync errors.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="qb-drawer-errors">
                  {qbDetail!.recentErrors.map((e) => (
                    <li
                      key={`${e.source}-${e.id}`}
                      className="rounded border border-gray-200 p-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-gray-800 capitalize">
                          {e.source.replace(/_/g, " ")}
                          {e.estimateId ? ` · estimate #${e.estimateId}` : ""}
                        </span>
                        {e.occurredAt ? (
                          <span className="text-gray-400 shrink-0">
                            {new Date(e.occurredAt).toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-gray-700 break-words">
                        {e.errorMessage}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <SheetFooter className="mt-6 gap-2">
            <Button
              size="sm"
              onClick={retrySync}
              disabled={retrying}
              data-testid="qb-retry-button"
            >
              {retrying ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <RotateCcw className="w-4 h-4 mr-1" />
              )}
              Retry sync
            </Button>
            <Button variant="outline" onClick={() => setQbDrawerOpen(false)}>
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ShortcutsCheatSheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />

      {/* Task #1083 — floating bulk-approve bar */}
      <BulkApproveBar
        selectedCount={selected.size}
        approving={bulkApproving}
        onApprove={() => void bulkApprove()}
        onClear={clearSelected}
      />
    </div>
  );
}

function DetailPane({
  item,
  userRole,
  approving,
  kickingBack,
  saving,
  kickbackReason,
  editedNote,
  isDirty,
  onApprove,
  onKickback,
  onSave,
  onFlag,
  onChangeKickbackReason,
  onChangeNote,
}: {
  item: QueueItem;
  userRole: string;
  approving: boolean;
  kickingBack: boolean;
  saving: boolean;
  kickbackReason: string;
  editedNote: string;
  isDirty: boolean;
  onApprove: () => void;
  onKickback: (reason: string) => void;
  onSave: () => void;
  onFlag: () => void;
  onChangeKickbackReason: (v: string) => void;
  onChangeNote: (v: string) => void;
}) {
  const canApprove =
    item.type === "billing_sheet" ||
    item.type === "work_order" ||
    (item.type === "wet_check_billing" && userRole !== "billing_manager");
  const activityUrl =
    item.type === "billing_sheet"
      ? `/api/billing-sheets/${item.refId}/activity`
      : item.type === "work_order"
        ? `/api/work-orders/${item.refId}/activity`
        : null;
  const { data: activity } = useQuery<Array<{
    id: number | string;
    at: string;
    actor?: string;
    message: string;
  }> | null>({
    queryKey: activityUrl ? [activityUrl] : ["__no_activity__"],
    enabled: !!activityUrl,
  });
  const activityRows = Array.isArray(activity) ? activity : [];

  return (
    <div className="space-y-3" data-testid="detail-pane">
      <div className="flex items-center gap-2">
        {TYPE_ICON[item.type]}
        <span className="text-sm font-medium capitalize text-gray-800">
          {item.type.replace(/_/g, " ")}
        </span>
        <Badge variant="outline" className="ml-auto capitalize">
          {item.status.replace(/_/g, " ")}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <dt className="text-gray-500">Number</dt>
        <dd className="font-medium text-gray-900 text-right">{item.number ?? `#${item.refId}`}</dd>
        <dt className="text-gray-500">Customer</dt>
        <dd className="font-medium text-gray-900 text-right truncate">{item.customerName ?? "—"}</dd>
        <dt className="text-gray-500">Technician</dt>
        <dd className="font-medium text-gray-900 text-right truncate">{item.technicianName ?? "—"}</dd>
        <dt className="text-gray-500">Total</dt>
        <dd className="font-semibold text-gray-900 text-right tabular-nums">{fmt(item.total)}</dd>
        <dt className="text-gray-500">Age</dt>
        <dd className="font-medium text-gray-900 text-right">
          {item.ageDays != null ? `${item.ageDays}d` : "—"}
        </dd>
      </dl>

      {item.flags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {item.flags.map((f) => (
            <Badge key={f} variant="outline" className="text-amber-700 border-amber-300 gap-1">
              <AlertTriangle className="w-3 h-3" /> {f.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* Inline edit — keeps the most common quick edit (note) right in
          the drawer; full-fidelity labor/parts editing is one click
          away via the Open link to keep approval flow tight. */}
      {canApprove ? (
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Inline note</label>
          <Textarea
            value={editedNote}
            onChange={(e) => onChangeNote(e.target.value)}
            placeholder="Quick correction or context for billing…"
            className="min-h-[60px]"
            data-testid="inline-note"
          />
        </div>
      ) : null}

      {/* Kickback */}
      {canApprove ? (
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Kick back to technician</label>
          <Textarea
            value={kickbackReason}
            onChange={(e) => onChangeKickbackReason(e.target.value)}
            placeholder="Reason (required) — what needs to change?"
            className="min-h-[60px]"
            data-testid="kickback-reason"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        {canApprove ? (
          <Button size="sm" onClick={onApprove} disabled={approving} data-testid="approve-button">
            {approving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
            Approve
          </Button>
        ) : null}
        {canApprove ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onKickback(kickbackReason)}
            disabled={kickingBack || !kickbackReason.trim()}
            data-testid="kickback-button"
          >
            {kickingBack ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
            Kickback
          </Button>
        ) : null}
        {canApprove ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={saving || !isDirty}
            data-testid="save-button"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
            Save
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onFlag} data-testid="flag-button">
          <Flag className="w-4 h-4 mr-1" /> Flag
        </Button>
        <Link href={item.href}>
          <Button variant="outline" size="sm">Open</Button>
        </Link>
      </div>

      {/* Activity log */}
      {activityUrl ? (
        <div className="pt-3 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-600 mb-2">Activity</p>
          {activityRows.length === 0 ? (
            <p className="text-xs text-gray-400">No activity yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs" data-testid="activity-log">
              {activityRows.slice(0, 8).map((row) => (
                <li key={row.id} className="flex items-start gap-2">
                  <span className="text-gray-400 shrink-0">
                    {new Date(row.at).toLocaleString()}
                  </span>
                  <span className="text-gray-700">
                    {row.actor ? <strong>{row.actor}: </strong> : null}
                    {row.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

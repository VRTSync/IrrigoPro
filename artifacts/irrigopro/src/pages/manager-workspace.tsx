// Task #1238 — Manager Workspace (merged).
//
// Replaces the legacy /manager-workspace + /billing-workspace split with a
// single stage-based page for four roles:
//   irrigation_manager, company_admin, super_admin, billing_manager
//
// Five stage sections (vertical lane grouping):
//   1. Needs my review   — items awaiting manager action
//   2. Waiting on tech   — kicked-back items (returnedForCorrectionAt set)
//   3. Findings to route — unrouted wet-check findings (hidden for billing_manager)
//   4. Passed to billing — approved_passed_to_billing without invoice
//   5. Billed (7d)       — billed within the last 7 days (collapsed by default)
//
// Keyboard: J/K navigate rows, A approve, B kickback, F detail, / search,
//           Ctrl+S save edits, Esc close, Shift+A bulk approve, ? cheatsheet.

import irrigoLogoUrl from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  Droplets,
  Keyboard,
  Loader2,
  Package,
  RotateCcw,
  Save,
  Search,
  SquareCheck,
  Square,
  Tag,
  Wrench,
  X,
} from "lucide-react";
import { DetailPaneInline } from "@/components/billing-workspace/detail-pane-inline";
import { BulkApproveBar } from "@/components/billing-workspace/bulk-approve-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { adaptiveRefetchInterval, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FinancialPulseWidget } from "@/components/financial-pulse/financial-pulse-widget";
import { useAuth } from "@/lib/auth-context";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Stage =
  | "needs_review"
  | "waiting_on_tech"
  | "findings_to_route"
  | "passed_to_billing"
  | "billed_7d";

interface ManagerQueueItem {
  id: string;
  type:
    | "wet_check"
    | "work_order"
    | "finding"
    | "billing_sheet"
    | "wet_check_billing"
    | "part"
    | "manual_review";
  stage: Stage;
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
  returnedForCorrectionAt?: string | null;
  invoiceId?: number | null;
}

interface QueueResponse {
  items: ManagerQueueItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface StageCountsShape {
  needsReview?: number;
  waitingOnTech?: number;
  findingsToRoute?: number;
  passedToBilling?: number;
  billed7d?: number;
}

interface StatusStripResponse {
  indicators: {
    wcsPendingReview: number;
    wosAwaitingApproval: number;
    findingsNeedingRouting: number;
    approvedThisWeek: number;
  };
  stageCounts: StageCountsShape;
  quickbooks: {
    state: "ok" | "degraded" | "down" | "unknown";
    lastSyncAt: string | null;
    pendingSync: number;
    connectionStatus: string | null;
    recentErrorCount: number;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage configuration
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_ORDER: Stage[] = [
  "needs_review",
  "waiting_on_tech",
  "findings_to_route",
  "passed_to_billing",
  "billed_7d",
];

const STAGE_META: Record<
  Stage,
  { label: string; borderClass: string; badgeClass: string; icon: React.ReactNode }
> = {
  needs_review: {
    label: "Needs my review",
    borderClass: "border-l-blue-500",
    badgeClass: "bg-blue-100 text-blue-700",
    icon: <ClipboardList className="w-4 h-4" />,
  },
  waiting_on_tech: {
    label: "Waiting on tech",
    borderClass: "border-l-orange-400",
    badgeClass: "bg-orange-100 text-orange-700",
    icon: <Clock className="w-4 h-4" />,
  },
  findings_to_route: {
    label: "Findings to route",
    borderClass: "border-l-yellow-400",
    badgeClass: "bg-yellow-100 text-yellow-700",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  passed_to_billing: {
    label: "Passed to billing",
    borderClass: "border-l-purple-500",
    badgeClass: "bg-purple-100 text-purple-700",
    icon: <DollarSign className="w-4 h-4" />,
  },
  billed_7d: {
    label: "Billed (7d)",
    borderClass: "border-l-green-500",
    badgeClass: "bg-green-100 text-green-700",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const fmt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : CURRENCY.format(n);

const TYPE_ICON: Record<ManagerQueueItem["type"], React.ReactNode> = {
  wet_check: <Droplets className="w-4 h-4 text-cyan-600" />,
  work_order: <Wrench className="w-4 h-4 text-purple-600" />,
  finding: <AlertTriangle className="w-4 h-4 text-yellow-600" />,
  billing_sheet: <ClipboardList className="w-4 h-4 text-blue-600" />,
  wet_check_billing: <Droplets className="w-4 h-4 text-teal-600" />,
  part: <Package className="w-4 h-4 text-amber-600" />,
  manual_review: <Tag className="w-4 h-4 text-amber-600" />,
};

const PAGE_SIZE = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StageTile({
  stage,
  count,
  active,
  onClick,
}: {
  stage: Stage;
  count: number | undefined;
  active: boolean;
  onClick: () => void;
}) {
  const meta = STAGE_META[stage];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`stage-tile-${stage}`}
      className={`flex flex-col items-start p-3 rounded-lg border-l-4 ${meta.borderClass} bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer text-left w-full ${
        active ? "ring-2 ring-blue-400 ring-offset-1" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`p-1 rounded ${meta.badgeClass}`}>{meta.icon}</span>
        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide leading-none">
          {meta.label}
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">
        {count == null ? <Skeleton className="h-7 w-10 inline-block" /> : count}
      </div>
    </button>
  );
}

function QueueRow({
  item,
  active,
  selected,
  onSelect,
  onToggle,
}: {
  item: ManagerQueueItem;
  active: boolean;
  selected?: boolean;
  onSelect: (item: ManagerQueueItem) => void;
  onToggle?: (item: ManagerQueueItem) => void;
}) {
  const isSelectable =
    item.type === "billing_sheet" ||
    item.type === "work_order" ||
    item.type === "wet_check_billing";

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      data-testid={`queue-row-${item.id}`}
      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 flex items-center gap-3 transition-colors ${
        active ? "bg-blue-50" : selected ? "bg-green-50" : "hover:bg-gray-50"
      }`}
    >
      {isSelectable && onToggle && (
        <span
          role="checkbox"
          aria-checked={selected}
          data-testid={`queue-row-checkbox-${item.id}`}
          className="shrink-0 text-gray-400 hover:text-blue-600 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onToggle(item); }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              onToggle(item);
            }
          }}
          tabIndex={0}
        >
          {selected
            ? <SquareCheck className="w-4 h-4 text-blue-600" />
            : <Square className="w-4 h-4" />}
        </span>
      )}
      <div className="shrink-0">{TYPE_ICON[item.type]}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-sm text-gray-900 truncate">
            {item.number || `#${item.refId}`}
          </span>
          {item.flags.includes("missing_photos") && (
            <Badge variant="outline" className="h-5 px-1.5 border-amber-300 text-amber-700 gap-1">
              <Camera className="w-3 h-3" /> photos
            </Badge>
          )}
          {item.flags.includes("kicked_back") && (
            <Badge variant="outline" className="h-5 px-1.5 border-orange-300 text-orange-700">
              kicked back
            </Badge>
          )}
          {item.flags.includes("unpriced") && (
            <Badge variant="outline" className="h-5 px-1.5 border-amber-300 text-amber-700">
              unpriced
            </Badge>
          )}
          {item.flags.includes("stale") && (
            <Badge variant="outline" className="h-5 px-1.5 border-red-300 text-red-700">
              {item.ageDays}d
            </Badge>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {item.customerName ?? "—"}
          {item.technicianName ? ` · ${item.technicianName}` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {item.total > 0 && (
          <div className="font-semibold tabular-nums text-sm text-gray-900">
            {fmt(item.total)}
          </div>
        )}
        <div className="text-xs text-gray-400 capitalize">
          {item.status.replace(/_/g, " ")}
        </div>
      </div>
    </button>
  );
}

function StageSection({
  stage,
  items,
  activeId,
  selected,
  onSelect,
  onToggle,
  expanded,
  onToggleExpanded,
  hidden,
}: {
  stage: Stage;
  items: ManagerQueueItem[];
  activeId: string | null;
  selected: Set<string>;
  onSelect: (item: ManagerQueueItem) => void;
  onToggle: (item: ManagerQueueItem) => void;
  expanded: boolean;
  onToggleExpanded: (stage: Stage) => void;
  hidden?: boolean;
}) {
  const meta = STAGE_META[stage];

  if (hidden) return null;

  return (
    <div
      className={`border-l-4 ${meta.borderClass} rounded-r-lg overflow-hidden`}
      data-testid={`stage-section-${stage}`}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
        onClick={() => onToggleExpanded(stage)}
        aria-expanded={expanded}
        data-testid={`stage-header-${stage}`}
      >
        <div className="flex items-center gap-2">
          <span className={`p-1 rounded ${meta.badgeClass}`}>{meta.icon}</span>
          <span className="text-sm font-semibold text-gray-700">{meta.label}</span>
          <Badge variant="outline" className="h-5 px-1.5 text-xs">
            {items.length}
          </Badge>
        </div>
        {!expanded
          ? <ChevronRight className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {expanded && items.length === 0 && (
        <div className="px-3 py-4 text-sm text-gray-400 italic text-center bg-white">
          All clear
        </div>
      )}
      {expanded && items.length > 0 && (
        <StageSectionRows
          items={items}
          activeId={activeId}
          selected={selected}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

const ROW_CAP = 10;

function StageSectionRows({
  items,
  activeId,
  selected,
  onSelect,
  onToggle,
}: {
  items: ManagerQueueItem[];
  activeId: string | null;
  selected: Set<string>;
  onSelect: (item: ManagerQueueItem) => void;
  onToggle: (item: ManagerQueueItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, ROW_CAP);
  const overflow = items.length - ROW_CAP;
  return (
    <div className="bg-white divide-y divide-gray-50">
      {visible.map((item) => (
        <QueueRow
          key={item.id}
          item={item}
          active={activeId === item.id}
          selected={selected.has(item.id)}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
      {!showAll && overflow > 0 && (
        <button
          type="button"
          className="w-full py-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition-colors"
          onClick={() => setShowAll(true)}
          data-testid="show-all-rows"
        >
          Show all {items.length} →
        </button>
      )}
      {showAll && items.length > ROW_CAP && (
        <button
          type="button"
          className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={() => setShowAll(false)}
          data-testid="show-less-rows"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function ShortcutsCheatSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="shortcuts-cheatsheet"
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
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
            ["K", "Previous row (or Kickback when drawer open)"],
            ["A", "Approve highlighted item"],
            ["Shift+A", "Bulk-approve all selected items"],
            ["B", "Open kickback + focus reason"],
            ["F / Enter", "Open detail pane"],
            ["/", "Focus search"],
            ["Ctrl+S", "Save edits (no approve)"],
            ["Esc", "Close drawer / deselect"],
            ["?", "Show this list"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <kbd className="px-2 py-0.5 bg-gray-100 rounded font-mono text-xs shrink-0">
                {k}
              </kbd>
              <span className="text-gray-700 text-right">{v}</span>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ManagerWorkspacePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const userRole = user?.role ?? "";
  const isBillingManager = userRole === "billing_manager";

  // ── Filter state ───────────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [tech, setTech] = useState("");
  const [age, setAge] = useState<"" | "<1" | "1-3" | "3-7" | "7+">(""); // "" = all
  const [sort, setSort] = useState<
    "age_desc" | "age_asc" | "total_desc" | "total_asc"
  >("age_desc");
  const [stageFilter, setStageFilter] = useState<Stage | "all">("all");

  // ── Selection / active state ───────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedItemsMap, setSelectedItemsMap] = useState<
    Map<string, ManagerQueueItem>
  >(new Map());

  // Which stages are expanded (lifted from StageSection so flatItems is aware)
  const [expandedStages, setExpandedStages] = useState<Record<Stage, boolean>>(
    () => ({
      needs_review: true,
      waiting_on_tech: true,
      findings_to_route: true,
      passed_to_billing: true,
      billed_7d: false, // collapsed by default
    }),
  );
  const toggleStageExpanded = useCallback((stage: Stage) => {
    setExpandedStages((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }, []);

  // ── Action / drawer state ──────────────────────────────────────────────────
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [kickingBack, setKickingBack] = useState(false);
  const [kickbackReason, setKickbackReason] = useState("");
  const [approving, setApproving] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedNote, setEditedNote] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  // detailOpen: tracks whether the inline detail pane is the focused action area
  const [detailFocused, setDetailFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ── Debounce search ────────────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => window.clearTimeout(id);
  }, [q]);

  // ── Queue URL ──────────────────────────────────────────────────────────────
  const queueUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (customer.trim()) params.set("customer", customer.trim());
    if (tech.trim()) params.set("tech", tech.trim());
    if (age) params.set("age", age);
    params.set("sort", sort);
    params.set("pageSize", String(PAGE_SIZE));
    return `/api/manager-workspace/queue?${params.toString()}`;
  }, [debouncedQ, customer, tech, age, sort]);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: queueData, isLoading: queueLoading } =
    useQuery<QueueResponse | null>({
      queryKey: [queueUrl],
      refetchInterval: adaptiveRefetchInterval(30_000),
    });

  const { data: strip } = useQuery<StatusStripResponse | null>({
    queryKey: ["/api/manager-workspace/status-strip"],
    refetchInterval: adaptiveRefetchInterval(30_000),
  });

  // ── Group items by stage ───────────────────────────────────────────────────
  const allItems = queueData?.items ?? [];

  const grouped = useMemo<Record<Stage, ManagerQueueItem[]>>(() => {
    const g: Record<Stage, ManagerQueueItem[]> = {
      needs_review: [],
      waiting_on_tech: [],
      findings_to_route: [],
      passed_to_billing: [],
      billed_7d: [],
    };
    for (const item of allItems) {
      g[item.stage]?.push(item);
    }
    return g;
  }, [allItems]);

  // Flat ordered list for keyboard navigation — only from expanded, visible stages
  const flatItems = useMemo<ManagerQueueItem[]>(() => {
    const stages =
      stageFilter === "all"
        ? STAGE_ORDER.filter(
            (s) => !(isBillingManager && s === "findings_to_route"),
          )
        : [stageFilter];
    return stages
      .filter((s) => expandedStages[s]) // only traverse expanded sections
      .flatMap((s) => grouped[s]);
  }, [grouped, stageFilter, isBillingManager, expandedStages]);

  // Auto-select first item when data loads or filter changes
  useEffect(() => {
    if (flatItems.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !flatItems.some((x) => x.id === activeId)) {
      setActiveId(flatItems[0].id);
    }
  }, [flatItems, activeId]);

  const activeIndex = activeId
    ? flatItems.findIndex((x) => x.id === activeId)
    : -1;
  const active = activeIndex >= 0 ? flatItems[activeIndex] : null;

  // Reset drawer-local state when active row changes
  useEffect(() => {
    setEditedNote("");
    setKickbackReason("");
    setIsDirty(false);
    setDetailFocused(false);
  }, [activeId]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const moveSelection = useCallback(
    (delta: number) => {
      if (flatItems.length === 0) return;
      const next = Math.max(
        0,
        Math.min(
          flatItems.length - 1,
          (activeIndex < 0 ? 0 : activeIndex) + delta,
        ),
      );
      setActiveId(flatItems[next].id);
    },
    [flatItems, activeIndex],
  );

  const toggleSelected = useCallback((item: ManagerQueueItem) => {
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

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({
      predicate: (qq) =>
        typeof qq.queryKey[0] === "string" &&
        (qq.queryKey[0] as string).startsWith("/api/manager-workspace/"),
    });
    // Also invalidate billing-workspace bulk-approve endpoint cache
    qc.invalidateQueries({
      predicate: (qq) =>
        typeof qq.queryKey[0] === "string" &&
        (qq.queryKey[0] as string).startsWith("/api/billing-workspace/"),
    });
  }, [qc]);

  const advanceToNext = useCallback(() => {
    // Post-approve: stay within needs_review only so the manager
    // doesn't accidentally jump into Waiting on tech or later stages.
    const nrItems = grouped.needs_review;
    const nrIdx = nrItems.findIndex((x) => x.id === activeId);
    if (nrIdx >= 0) {
      const nextIdx = Math.min(nrIdx + 1, nrItems.length - 1);
      setActiveId(nrItems[nextIdx]?.id ?? null);
    }
    // If the active item is outside needs_review, do nothing here; the
    // query invalidation will let the effect re-anchor focus naturally.
  }, [activeId, grouped.needs_review]);

  const approveActive = useCallback(async () => {
    if (!active || approving) return;
    // Types that have no inline approve step — surface a guiding toast
    if (active.type === "wet_check") {
      toast({
        title: "Open in Wet Check review",
        description: "Use 'A' on billing sheets or work orders. Wet checks must be reviewed in their detail screen.",
      });
      return;
    }
    if (active.type === "finding") {
      toast({
        title: "Open to route this finding",
        description: "Findings must be resolved from their linked wet check screen.",
      });
      return;
    }
    // Direct approve (BS / WO / WCB / part / manual_review)
    setApproving(true);
    try {
      let path: string | null = null;
      if (active.type === "billing_sheet")
        path = `/api/billing-sheets/${active.refId}/approve`;
      else if (active.type === "work_order")
        path = `/api/work-orders/${active.refId}/approve`;
      // wet_check_billing, part, manual_review: no dedicated approve endpoint yet —
      // fall through to the null guard below (silent no-op); DetailPaneInline handles them
      if (!path) return;
      await apiRequest(path, "POST", {});
      toast({
        title: "Approved",
        description: `${active.number ?? active.id} approved.`,
      });
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
        if (active.type === "billing_sheet")
          path = `/api/billing-sheets/${active.refId}/return-for-correction`;
        else if (active.type === "work_order")
          path = `/api/work-orders/${active.refId}/return-for-correction`;
        // wet_check_billing, part, manual_review: no return-for-correction endpoint —
        // fall through to null guard below (silent no-op)
        if (!path) return;
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
      if (active.type === "billing_sheet")
        path = `/api/billing-sheets/${active.refId}`;
      else if (active.type === "work_order")
        path = `/api/work-orders/${active.refId}`;
      else {
        toast({
          title: "Not editable here",
          description: "Open the dedicated screen.",
        });
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

  const bulkApprove = useCallback(async () => {
    if (bulkApproving) return;
    const targets = Array.from(selectedItemsMap.values());
    const eligible = targets.filter(
      (it) =>
        it.type === "billing_sheet" ||
        it.type === "work_order" ||
        it.type === "wet_check_billing",
    );
    if (eligible.length === 0) {
      toast({
        title: "Nothing to approve",
        description: "No eligible items selected.",
      });
      return;
    }
    setBulkApproving(true);
    try {
      const result = (await apiRequest(
        "/api/billing-workspace/bulk-approve",
        "POST",
        { items: eligible.map((it) => ({ type: it.type, id: it.refId })) },
      )) as {
        approved: number;
        skipped: { id: number; type: string; reason: string }[];
      };
      const n = result.approved;
      toast({
        title: `Approved ${n} item${n === 1 ? "" : "s"}`,
        description:
          result.skipped.length > 0
            ? `${result.skipped.length} item${result.skipped.length === 1 ? "" : "s"} skipped.`
            : undefined,
      });
      clearSelected();
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
  }, [bulkApproving, selectedItemsMap, toast, clearSelected, invalidateAll]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField =
        tag === "input" || tag === "textarea" || target?.isContentEditable;

      // Ctrl/Cmd+S — save edits without approving
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
        e.preventDefault();
        if (detailFocused && active) {
          if (kickbackReason.trim()) void kickbackActive(kickbackReason);
          else
            document
              .querySelector<HTMLTextAreaElement>('[data-testid="kickback-reason"]')
              ?.focus();
        } else {
          moveSelection(-1);
        }
      } else if (e.shiftKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        void bulkApprove();
      } else if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        void approveActive();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        if (
          active &&
          (active.type === "wet_check" ||
            active.type === "finding" ||
            active.type === "wet_check_billing" ||
            active.type === "part" ||
            active.type === "manual_review")
        ) {
          toast({
            title: "Cannot kick back from here",
            description: "Open the item directly to return it for correction.",
          });
        } else if (active) {
          setDetailFocused(true);
          setTimeout(
            () =>
              document
                .querySelector<HTMLTextAreaElement>('[data-testid="kickback-reason"]')
                ?.focus(),
            50,
          );
        }
      } else if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        e.preventDefault();
        if (active) setDetailFocused(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
      } else if (e.key === "Escape") {
        if (cheatsheetOpen) setCheatsheetOpen(false);
        else setDetailFocused(false);
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
    detailFocused,
    active,
    kickbackReason,
    kickbackActive,
  ]);

  // ── QB status for slim bar ─────────────────────────────────────────────────
  const qbState = strip?.quickbooks?.state ?? "unknown";
  const qbBorderClass =
    qbState === "ok"
      ? "border-l-green-500"
      : qbState === "degraded"
        ? "border-l-amber-400"
        : qbState === "down"
          ? "border-l-red-500"
          : "border-l-gray-300";

  const stageCounts = strip?.stageCounts;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="max-w-7xl mx-auto py-4 px-4 space-y-4"
      data-testid="manager-workspace"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
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
            <p
              className="text-sm mt-1"
              style={{ color: "hsl(var(--primary-light))" }}
            >
              Review, approve, and route your queue across all stages.
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
            {!isBillingManager && (
              <Link href="/billing/command-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/30 text-white bg-white/10 hover:bg-white/20 hover:text-white"
                >
                  Command Center
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Zone 0 — Financial Pulse billing header ─────────────────────── */}
      <FinancialPulseWidget variant="billing-header" />

      {/* ── Stage count tiles ───────────────────────────────────────────── */}
      <div
        className={`grid gap-3 ${
          isBillingManager
            ? "grid-cols-2 lg:grid-cols-4"
            : "grid-cols-2 lg:grid-cols-5"
        }`}
      >
        {STAGE_ORDER.filter(
          (s) => !(isBillingManager && s === "findings_to_route"),
        ).map((stage) => {
          const countKey: keyof StageCountsShape =
            stage === "needs_review"
              ? "needsReview"
              : stage === "waiting_on_tech"
                ? "waitingOnTech"
                : stage === "findings_to_route"
                  ? "findingsToRoute"
                  : stage === "passed_to_billing"
                    ? "passedToBilling"
                    : "billed7d";
          return (
            <StageTile
              key={stage}
              stage={stage}
              count={stageCounts?.[countKey]}
              active={stageFilter === stage}
              onClick={() =>
                setStageFilter((v) => (v === stage ? "all" : stage))
              }
            />
          );
        })}
      </div>

      {/* ── QuickBooks slim status bar ──────────────────────────────────── */}
      {strip?.quickbooks && (
        <div
          className={`rounded-lg border-l-4 ${qbBorderClass} bg-white shadow-sm px-4 py-2 flex items-center gap-3`}
          data-testid="qb-status-bar"
        >
          <DollarSign className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600">
            <span className="font-semibold capitalize">{qbState}</span>
            {strip.quickbooks.lastSyncAt && (
              <span className="text-gray-400">
                Synced{" "}
                {new Date(strip.quickbooks.lastSyncAt).toLocaleString()}
              </span>
            )}
            {strip.quickbooks.pendingSync > 0 && (
              <span className="text-amber-700">
                {strip.quickbooks.pendingSync} queued
              </span>
            )}
            {strip.quickbooks.recentErrorCount > 0 && (
              <span className="text-red-700">
                {strip.quickbooks.recentErrorCount} sync error
                {strip.quickbooks.recentErrorCount === 1 ? "" : "s"}
              </span>
            )}
            <Link href="/quickbooks">
              <span className="text-blue-600 hover:underline cursor-pointer">
                QuickBooks settings →
              </span>
            </Link>
          </div>
        </div>
      )}

      {/* ── Bulk approve bar ────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <BulkApproveBar
          selectedCount={selected.size}
          onClear={clearSelected}
          onApprove={bulkApprove}
          approving={bulkApproving}
        />
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap gap-2 items-center"
        data-testid="manager-filter-bar"
      >
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <Input
            ref={searchRef}
            placeholder="Search number, customer, tech…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8 h-8 text-sm w-60"
            data-testid="manager-search"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Customer ID filter */}
        <Input
          type="number"
          min={1}
          placeholder="Customer ID"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          className="h-8 text-xs w-28"
          data-testid="manager-customer-filter"
          aria-label="Filter by customer ID"
        />

        {/* Tech ID filter */}
        <Input
          type="number"
          min={1}
          placeholder="Tech ID"
          value={tech}
          onChange={(e) => setTech(e.target.value)}
          className="h-8 text-xs w-24"
          data-testid="manager-tech-filter"
          aria-label="Filter by technician ID"
        />

        {/* Age filter */}
        <select
          value={age}
          onChange={(e) =>
            setAge(e.target.value as typeof age)
          }
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by age"
          data-testid="manager-age-filter"
        >
          <option value="">All ages</option>
          <option value={"<1"}>{"< 1 day"}</option>
          <option value="1-3">1–3 days</option>
          <option value="3-7">3–7 days</option>
          <option value="7+">7+ days</option>
        </select>

        {/* Sort control */}
        <select
          value={sort}
          onChange={(e) =>
            setSort(e.target.value as typeof sort)
          }
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Sort order"
          data-testid="manager-sort"
        >
          <option value="age_desc">Oldest first</option>
          <option value="age_asc">Newest first</option>
          <option value="total_desc">Highest total</option>
          <option value="total_asc">Lowest total</option>
        </select>

        {stageFilter !== "all" && (
          <button
            type="button"
            onClick={() => setStageFilter("all")}
            data-testid="clear-stage-filter"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100"
          >
            {STAGE_META[stageFilter].label}
            <X className="w-3 h-3" />
          </button>
        )}

        <span className="text-xs text-gray-400 ml-auto">
          {queueLoading
            ? "Loading…"
            : `${allItems.length} item${allItems.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* ── Main: stage sections + inline detail pane ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Stage sections — left 3 cols */}
        <div className="lg:col-span-3 space-y-2">
          {queueLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            STAGE_ORDER.map((stage) => {
              const hidden =
                isBillingManager && stage === "findings_to_route";
              if (stageFilter !== "all" && stageFilter !== stage) return null;
              return (
                <StageSection
                  key={stage}
                  stage={stage}
                  items={grouped[stage]}
                  activeId={activeId}
                  selected={selected}
                  onSelect={(item) => {
                    setActiveId(item.id);
                    setDetailFocused(true);
                  }}
                  onToggle={toggleSelected}
                  expanded={expandedStages[stage]}
                  onToggleExpanded={toggleStageExpanded}
                  hidden={hidden}
                />
              );
            })
          )}
        </div>

        {/* Inline detail pane — right 2 cols */}
        <div className="lg:col-span-2">
          {active ? (
            <Card
              className="sticky top-4"
              data-testid="manager-detail-pane"
            >
              <CardContent className="pt-4 space-y-3">
                {/* Record header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {TYPE_ICON[active.type]}
                      <span className="font-semibold text-gray-900">
                        {active.number || `#${active.refId}`}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs capitalize"
                      >
                        {active.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {active.customerName && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {active.customerName}
                      </p>
                    )}
                    {active.technicianName && (
                      <p className="text-xs text-gray-400">
                        {active.technicianName}
                      </p>
                    )}
                  </div>
                  {active.total > 0 && (
                    <span className="font-bold tabular-nums text-gray-900 shrink-0">
                      {fmt(active.total)}
                    </span>
                  )}
                </div>

                {/* Kicked-back notice */}
                {active.returnedForCorrectionAt && (
                  <div className="text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded px-2.5 py-1.5">
                    Returned for correction{" "}
                    {new Date(
                      active.returnedForCorrectionAt,
                    ).toLocaleString()}
                  </div>
                )}

                {/* Open link */}
                <div>
                  <a
                    href={active.href}
                    className="text-sm text-blue-600 hover:underline"
                    data-testid="open-item-link"
                  >
                    Open full record →
                  </a>
                </div>

                {/* ── Waiting on tech — read-only summary, no actions ─────── */}
                {active.stage === "waiting_on_tech" ? (
                  <div
                    className="pt-2 border-t border-gray-100 space-y-2"
                    data-testid="waiting-on-tech-readonly"
                  >
                    <p className="text-xs text-gray-500">
                      This item has been returned to the technician for
                      correction. No manager action is available until they
                      resubmit.
                    </p>
                    <a
                      href={active.href}
                      className="block w-full text-center py-2 rounded-md bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
                      data-testid="view-record-button"
                    >
                      View record →
                    </a>
                  </div>
                ) : active.type === "billing_sheet" ||
                active.type === "work_order" ||
                active.type === "wet_check_billing" ||
                active.type === "part" ||
                active.type === "manual_review" ? (
                  <DetailPaneInline
                    item={{
                      id: active.id,
                      type: active.type as
                        | "billing_sheet"
                        | "work_order"
                        | "wet_check_billing"
                        | "part"
                        | "manual_review",
                      refId: active.refId,
                      status: active.status,
                      invoiceId: active.invoiceId ?? null,
                    }}
                    userRole={userRole}
                  >
                    {/* Actions injected as children */}
                    <div className="space-y-2" data-testid="detail-actions">
                      {/* Approve button — only for needs_review items */}
                      {active.stage === "needs_review" && (
                        <Button
                          className="w-full"
                          onClick={() => void approveActive()}
                          disabled={approving}
                          data-testid="approve-button"
                        >
                          {approving ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                          )}
                          Approve (A)
                        </Button>
                      )}

                      {/* Kickback (BS / WO only, not billed) */}
                      {(active.type === "billing_sheet" ||
                        active.type === "work_order") &&
                        active.stage !== "billed_7d" && (
                          <div className="space-y-1.5">
                            <Textarea
                              placeholder="Return for correction — describe what needs to change…"
                              value={kickbackReason}
                              onChange={(e) =>
                                setKickbackReason(e.target.value)
                              }
                              className="text-sm resize-none"
                              rows={2}
                              data-testid="kickback-reason"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full border-red-200 text-red-700 hover:bg-red-50"
                              onClick={() =>
                                void kickbackActive(kickbackReason)
                              }
                              disabled={
                                kickingBack || !kickbackReason.trim()
                              }
                              data-testid="kickback-button"
                            >
                              {kickingBack ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3 mr-1" />
                              )}
                              Return for correction (B+K)
                            </Button>
                          </div>
                        )}

                      {/* Note + save */}
                      {(active.type === "billing_sheet" ||
                        active.type === "work_order") && (
                        <div className="space-y-1.5 pt-1 border-t border-gray-100">
                          <Textarea
                            placeholder="Add a note (Ctrl+S to save without approving)…"
                            value={editedNote}
                            onChange={(e) => {
                              setEditedNote(e.target.value);
                              setIsDirty(true);
                            }}
                            className="text-sm resize-none"
                            rows={2}
                            data-testid="note-editor"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => void saveActiveEdits()}
                            disabled={saving || !isDirty}
                            data-testid="save-edits-button"
                          >
                            {saving ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3 mr-1" />
                            )}
                            Save edits (Ctrl+S)
                          </Button>
                        </div>
                      )}
                    </div>
                  </DetailPaneInline>
                ) : active.type === "wet_check" ? (
                  /* Wet check — read-only summary + Begin review CTA */
                  <div className="pt-2 border-t border-gray-100 space-y-2">
                    <p className="text-xs text-gray-500">
                      Review the technician's wet check findings and confirm
                      before passing to billing.
                    </p>
                    <a
                      href={`/wet-checks/${active.refId}`}
                      className="block w-full text-center py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                      data-testid="begin-review-button"
                    >
                      Begin review →
                    </a>
                  </div>
                ) : active.type === "finding" ? (
                  /* Finding — read-only summary + Open in wet check CTA */
                  <div className="pt-2 border-t border-gray-100 space-y-2">
                    <p className="text-xs text-gray-500">
                      Route this finding to a work order or estimate from the
                      wet check review screen.
                    </p>
                    <a
                      href={active.href}
                      className="block w-full text-center py-2 rounded-md bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors"
                      data-testid="open-wet-check-button"
                    >
                      Open in wet check →
                    </a>
                  </div>
                ) : (
                  /* Unreachable fallback — all other types have a branch above */
                  <div className="pt-2 border-t border-gray-100">
                    <a
                      href={active.href}
                      className="block w-full text-center py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                      data-testid="open-item-button"
                    >
                      Open to handle →
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            !queueLoading && (
              <div
                className="flex items-center justify-center h-40 text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-lg"
                data-testid="no-selection"
              >
                Select an item to see details
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Keyboard cheatsheet ─────────────────────────────────────────── */}
      <ShortcutsCheatSheet
        open={cheatsheetOpen}
        onClose={() => setCheatsheetOpen(false)}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, asArray, queryClient, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, Loader2, FileText, Wrench, FileCheck, CheckCircle2, ListChecks, X, Lightbulb,
  HelpCircle,
} from "lucide-react";
import { DismissibleHelp, isHelpDismissed, resetHelpDismissal } from "@/components/shared/dismissible-help";
import { safeGet } from "@/utils/safeStorage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  Customer, IssueTypeConfig, Part, WetCheckFindingWithReason, WetCheckPhoto,
  WetCheckWithDetails, WetCheckZoneRecord,
} from "@workspace/db/schema";
import { FindingCard, type FindingEdits } from "./finding-card";
import { DecisionCard } from "./decision-card";
import { AutoBilledBanner } from "./auto-billed-banner";
import { LoosePhotosSection, type LooseFindingOption } from "@/pages/wet-checks/LoosePhotosSection";

type Resolution =
  | "pending" | "repaired_in_field" | "sent_to_estimate" | "deferred_to_work_order" | "documented_only";

interface FindingItem { f: WetCheckFindingWithReason; zr: WetCheckZoneRecord; }

const TUTORIAL_STORAGE_PREFIX = "wet-check-wizard-tutorial-dismissed-v1";

function tutorialStorageKey(): string {
  if (typeof window === "undefined") return `${TUTORIAL_STORAGE_PREFIX}:anon`;
  try {
    const raw = window.localStorage.getItem("user");
    if (raw) {
      const u = JSON.parse(raw);
      if (u && (u.id != null || u.username)) {
        return `${TUTORIAL_STORAGE_PREFIX}:${u.id ?? u.username}`;
      }
    }
  } catch { /* fall through */ }
  return `${TUTORIAL_STORAGE_PREFIX}:anon`;
}

function lineTotal(edits: FindingEdits, laborRate: number): number {
  const partPrice = parseFloat(edits.partPrice ?? "0") || 0;
  const labor = parseFloat(edits.laborHours ?? "0") || 0;
  return partPrice * (edits.quantity ?? 0) + labor * laborRate;
}

function lineTotalFinding(f: WetCheckFindingWithReason, laborRate: number): number {
  const partPrice = parseFloat(String(f.partPrice ?? "0")) || 0;
  const labor = parseFloat(String(f.laborHours ?? "0")) || 0;
  return partPrice * Number(f.quantity ?? 0) + labor * laborRate;
}

function makeEdits(f: WetCheckFindingWithReason, configs: IssueTypeConfig[]): FindingEdits {
  const cfg = configs.find(c => c.issueType === f.issueType);
  const laborFromTech = parseFloat(String(f.laborHours ?? "0"));
  const fallback = cfg ? parseFloat(String(cfg.defaultLaborHours)) : 0;
  const labor = Number.isFinite(laborFromTech) && laborFromTech > 0 ? laborFromTech : (fallback || 0);
  return {
    partId: f.partId ?? null,
    partName: f.partName ?? null,
    partPrice: f.partPrice != null ? String(f.partPrice) : null,
    quantity: Math.max(1, Number(f.quantity ?? 1) || 1),
    laborHours: String(labor),
  };
}

// ─── Resolution badge ─────────────────────────────────────────────────────────
const RESOLUTION_BADGE: Record<string, { label: string; className: string }> = {
  pending:                { label: "Pending",     className: "bg-amber-50 text-amber-700 border-amber-200" },
  sent_to_estimate:       { label: "Estimate",    className: "bg-blue-50 text-blue-700 border-blue-200" },
  deferred_to_work_order: { label: "Work Order",  className: "bg-purple-50 text-purple-700 border-purple-200" },
  documented_only:        { label: "Documented",  className: "bg-gray-100 text-gray-700 border-gray-300" },
  repaired_in_field:      { label: "Auto-billed", className: "bg-green-50 text-green-700 border-green-200" },
};

// ─── Sidebar finding card ─────────────────────────────────────────────────────
function SidebarFindingCard({
  item,
  isActive,
  isAutoBilled,
  issueConfigs,
  onClick,
}: {
  item: FindingItem;
  isActive: boolean;
  isAutoBilled: boolean;
  issueConfigs: IssueTypeConfig[];
  onClick: () => void;
}) {
  const { f, zr } = item;
  const cfg = issueConfigs.find(c => c.issueType === f.issueType);
  const issueLabel = cfg?.displayLabel ?? f.issueType.replace(/_/g, " ");
  const zoneLabel = `${zr.controllerLetter ?? ""}${zr.zoneNumber ?? ""}`;
  const resolution = f.resolution ?? "pending";
  const badge = RESOLUTION_BADGE[isAutoBilled ? "repaired_in_field" : resolution] ?? RESOLUTION_BADGE.pending;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`sidebar-finding-${f.id}`}
      className={[
        "w-full text-left rounded-lg border px-3 py-2.5 transition-all",
        isActive
          ? "border-blue-400 bg-blue-50 ring-1 ring-blue-400"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="text-xs font-bold font-mono bg-gray-100 text-gray-700 rounded px-1 py-0.5 shrink-0"
              data-testid={`sidebar-finding-${f.id}-zone`}
            >
              {zoneLabel || "—"}
            </span>
            <span
              className="text-xs font-medium text-gray-900 truncate"
              data-testid={`sidebar-finding-${f.id}-issue`}
            >
              {issueLabel}
            </span>
          </div>
          {(f.partName || f.quantity) && (
            <div className="text-[11px] text-gray-500 mt-0.5 truncate">
              {[f.partName, f.quantity ? `×${f.quantity}` : null].filter(Boolean).join(" ")}
            </div>
          )}
          {f.techDisposition && (
            <span
              className={`inline-block mt-1 text-[10px] rounded-full px-1.5 py-0.5 font-medium border ${
                f.techDisposition === "completed_in_field"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {f.techDisposition === "completed_in_field" ? "Completed in field" : "Needs review"}
            </span>
          )}
          {f.pendingReason && (
            <div
              className="mt-1 text-[10px] text-gray-500 leading-snug truncate"
              data-testid={`sidebar-finding-${f.id}-reason`}
              title={f.pendingReason}
            >
              {f.pendingReason}
            </div>
          )}
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] shrink-0 ${badge.className}`}
          data-testid={`sidebar-finding-${f.id}-badge`}
        >
          {isAutoBilled ? "Auto-billed" : badge.label}
        </Badge>
      </div>
    </button>
  );
}

// ─── Read-only auto-billed panel ───────────────────────────────────────────────
function AutoBilledPanel({ item, customerLaborRate }: { item: FindingItem; customerLaborRate: number }) {
  const { f, zr } = item;
  const total = lineTotalFinding(f, customerLaborRate);
  const reason = f.pendingReason ?? "Auto-billed when tech submitted";
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center space-y-3 px-4">
      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-green-600" />
      </div>
      <div>
        <div className="font-semibold text-gray-900">Auto-billed in field</div>
        <div className="text-sm text-gray-500 mt-0.5">
          Controller {zr.controllerLetter} · Zone {zr.zoneNumber}
        </div>
        {total > 0 && (
          <div className="text-sm font-medium text-green-700 mt-1">${total.toFixed(2)}</div>
        )}
      </div>
      <div
        className="inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700"
        data-testid={`auto-billed-reason-${f.id}`}
      >
        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden />
        {reason}
      </div>
      <p className="text-xs text-gray-500 max-w-xs">
        The tech repaired this issue and billed it on-site. No manager decision is required.
      </p>
    </div>
  );
}

// ─── All-resolved right panel state ──────────────────────────────────────────
function AllResolvedPanel({ onConvert, id }: { onConvert: () => void; id: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 text-center space-y-4 px-4">
      <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
        <ListChecks className="w-7 h-7 text-green-600" />
      </div>
      <div>
        <div className="text-lg font-semibold text-gray-900">All findings triaged</div>
        <p className="text-sm text-gray-500 mt-1">
          Every finding has a resolution. Click "Approve & Convert" to finalize.
        </p>
      </div>
      <Button onClick={onConvert} data-testid="wizard-convert-now" className="min-w-[180px]">
        Approve &amp; Convert
      </Button>
    </div>
  );
}

// ─── 3-step workflow indicator ────────────────────────────────────────────────
function WorkflowStep({
  step,
  label,
  done,
  active,
}: {
  step: number;
  label: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-medium ${
        done ? "text-emerald-600" : active ? "text-blue-700" : "text-gray-400"
      }`}
      data-testid={`workflow-step-${step}`}
      aria-current={active ? "step" : undefined}
    >
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
          done
            ? "bg-emerald-100 text-emerald-700"
            : active
            ? "bg-blue-100 text-blue-700"
            : "bg-gray-100 text-gray-400"
        }`}
      >
        {done ? <CheckCircle2 className="w-3 h-3" /> : step}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

function WorkflowIndicator({
  allZonesReviewed,
  allFindingsResolved,
}: {
  allZonesReviewed: boolean;
  allFindingsResolved: boolean;
}) {
  const allGreen = allZonesReviewed && allFindingsResolved;
  return (
    <div
      className="flex items-center gap-3"
      data-testid="workflow-indicator"
      role="list"
      aria-label="Review workflow steps"
    >
      <WorkflowStep
        step={1}
        label="Review zones"
        done={allZonesReviewed}
        active={!allZonesReviewed}
      />
      <span className="text-gray-300 text-xs" aria-hidden="true">›</span>
      <WorkflowStep
        step={2}
        label="Resolve findings"
        done={allFindingsResolved}
        active={allZonesReviewed && !allFindingsResolved}
      />
      <span className="text-gray-300 text-xs" aria-hidden="true">›</span>
      <WorkflowStep
        step={3}
        label="Approve & route"
        done={false}
        active={allGreen}
      />
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────
export function WetCheckWizard({ id }: { id: number }) {
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  const isBillingManager = useMemo(() => {
    try {
      const raw = safeGet("user");
      if (!raw) return false;
      const u: unknown = JSON.parse(raw);
      if (u !== null && typeof u === "object" && "role" in u) {
        return (u as Record<string, unknown>).role === "billing_manager";
      }
    } catch { /* ignore */ }
    return false;
  }, []);

  const editFindingId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("edit");
    if (!raw) return null;
    const n = parseInt(raw);
    return Number.isFinite(n) ? n : null;
  }, [location]);
  const editMode = editFindingId != null;

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: ["/api/wet-checks", id],
    queryFn: () => apiRequest(`/api/wet-checks/${id}`),
  });
  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", wc?.customerId],
    queryFn: () => apiRequest(`/api/customers/${wc!.customerId}`),
    enabled: !!wc?.customerId,
  });
  const { data: parts = [] } = useArrayQuery<Part>({ queryKey: ["/api/parts"] });
  const { data: issueConfigs = [] } = useArrayQuery<IssueTypeConfig>({
    queryKey: ["/api/wet-checks/issue-types"],
  });

  const customerLaborRate = parseFloat(String(customer?.laborRate ?? "45")) || 45;

  const allFindings: FindingItem[] = useMemo(() => {
    if (!wc) return [];
    return asArray(wc.zoneRecords).flatMap(zr =>
      asArray(zr.findings).map(f => ({ f, zr })),
    );
  }, [wc]);

  const autoBilled = useMemo(
    () => allFindings.filter(({ f }) => f.resolution === "repaired_in_field" && f.billingSheetId != null),
    [allFindings],
  );

  // Findings that need (or needed) a manager decision — excludes auto-billed.
  const decisionFindings = useMemo(
    () => allFindings.filter(({ f }) => !(f.resolution === "repaired_in_field" && f.billingSheetId != null)),
    [allFindings],
  );

  const pendingFindings = useMemo(
    () => decisionFindings.filter(({ f }) => (f.resolution ?? "pending") === "pending" && f.convertedAt == null),
    [decisionFindings],
  );

  // Left-panel display order: pending first, then resolved/auto-billed.
  // Stable within each group (preserves relative API order).
  const sortedFindings = useMemo(() => {
    const pending = allFindings.filter(
      ({ f }) => (f.resolution ?? "pending") === "pending" && f.convertedAt == null,
    );
    const resolved = allFindings.filter(
      ({ f }) => !((f.resolution ?? "pending") === "pending" && f.convertedAt == null),
    );
    return [...pending, ...resolved];
  }, [allFindings]);

  const totalDecisions = decisionFindings.length;
  const completedDecisions = totalDecisions - pendingFindings.length;
  const progressPct = totalDecisions === 0 ? 100 : Math.round((completedDecisions / totalDecisions) * 100);

  const allZonesReviewed = useMemo(() => {
    const zones = asArray(wc?.zoneRecords);
    if (zones.length === 0) return allFindings.length === 0;
    return zones.every(zr => zr.status !== "not_checked");
  }, [wc, allFindings.length]);

  const allFindingsResolved = pendingFindings.length === 0;
  const allGreen = allZonesReviewed && allFindingsResolved;

  const [activeId, setActiveId] = useState<number | null>(null);
  const [edits, setEdits] = useState<FindingEdits | null>(null);

  const editTarget = useMemo(
    () => (editFindingId == null ? null : allFindings.find(p => p.f.id === editFindingId) ?? null),
    [editFindingId, allFindings],
  );

  // Determine active item: in edit mode, lock to the requested finding.
  // Otherwise, use the explicitly selected finding, falling back to the
  // first pending finding so the right panel always has something to show.
  const active: FindingItem | null = editMode
    ? editTarget
    : (activeId != null
        ? (allFindings.find(p => p.f.id === activeId) ?? pendingFindings[0] ?? null)
        : (pendingFindings[0] ?? null));

  const isActiveFindingAutoBilled = active
    ? autoBilled.some(({ f }) => f.id === active.f.id)
    : false;

  const photosByFinding = useMemo(() => {
    const m = new Map<number, WetCheckPhoto[]>();
    if (!wc) return m;
    for (const p of asArray(wc.photos)) {
      if (p.findingId == null) continue;
      const arr = m.get(p.findingId) ?? [];
      arr.push(p); m.set(p.findingId, arr);
    }
    return m;
  }, [wc]);

  const loosePhotos = useMemo(
    () => asArray(wc?.photos).filter(p => p.findingId == null),
    [wc],
  );

  const loosePhotoFindingOptions = useMemo<LooseFindingOption[]>(
    () =>
      allFindings.map(({ f, zr }) => {
        const cfg = issueConfigs.find(c => c.issueType === f.issueType);
        const label = `${cfg?.displayLabel ?? f.issueType} · Controller ${zr.controllerLetter} · Zone ${zr.zoneNumber}`;
        return { id: f.id, label };
      }),
    [allFindings, issueConfigs],
  );

  // Sync edit buffer when active finding changes.
  useEffect(() => {
    if (!active) {
      if (edits !== null) setEdits(null);
      return;
    }
    // Only re-derive edits when the finding changes, not on every render.
    setEdits(prev => {
      if (prev !== null && active.f.id === activeId) return prev;
      return makeEdits(active.f, issueConfigs);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.f.id, issueConfigs]);

  // Keep activeId in sync with the derived active finding.
  useEffect(() => {
    if (active && active.f.id !== activeId) {
      setActiveId(active.f.id);
    }
  }, [active, activeId]);

  // Bundle-building chip
  const [bundleIds, setBundleIds] = useState<Set<number>>(new Set());
  const [bundleTotal, setBundleTotal] = useState(0);

  const findingCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const node = findingCardRef.current;
    if (!node) return;
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (ae && node.contains(ae)) return;
    node.focus({ preventScroll: false });
  }, [active?.f.id]);

  // ── Route dialog (R shortcut) ──────────────────────────────────────
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);

  // ── "Show help" tick counter forces DismissibleHelp remount ──────────
  const [tick, setTick] = useState(0);
  const handleShowHelp = useCallback(() => {
    resetHelpDismissal("wc-review-keyboard-shortcuts");
    setTick(t => t + 1);
  }, []);

  const editMut = useMutation({
    mutationFn: (vars: { fid: number; patch: FindingEdits }) =>
      apiRequest(`/api/wet-checks/findings/${vars.fid}`, "PATCH", {
        partId: vars.patch.partId,
        partName: vars.patch.partName,
        partPrice: vars.patch.partPrice,
        quantity: vars.patch.quantity,
        laborHours: vars.patch.laborHours,
      }),
  });

  const routeMut = useMutation({
    mutationFn: (vars: { fid: number; resolution: Resolution }) =>
      apiRequest(`/api/wet-checks/findings/${vars.fid}/route`, "PATCH", { resolution: vars.resolution }),
  });

  const advancing = editMut.isPending || routeMut.isPending;

  const handleDecision = useCallback(async (resolution: Exclude<Resolution, "pending">) => {
    if (!active || !edits) return;
    try {
      await editMut.mutateAsync({ fid: active.f.id, patch: edits });
      await routeMut.mutateAsync({ fid: active.f.id, resolution });
      if (resolution === "sent_to_estimate") {
        const t = lineTotal(edits, customerLaborRate);
        setBundleIds(prev => {
          if (prev.has(active.f.id)) return prev;
          const next = new Set(prev); next.add(active.f.id); return next;
        });
        setBundleTotal(prev => prev + t);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      if (editMode) {
        navigate(`/manager/wet-checks/${id}/confirm`);
        return;
      }
      // Auto-advance to next pending finding (excluding the one just decided).
      const nextPending = pendingFindings.find(p => p.f.id !== active.f.id);
      if (nextPending) {
        setActiveId(nextPending.f.id);
        setEdits(makeEdits(nextPending.f, issueConfigs));
      } else {
        // All resolved — clear selection so the AllResolvedPanel shows.
        setActiveId(null);
        setEdits(null);
      }
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    }
  }, [active, edits, customerLaborRate, editMut, routeMut, pendingFindings, id, editMode, navigate, toast, issueConfigs]);

  const handleSkip = useCallback(() => {
    if (!active) return;
    const idx = pendingFindings.findIndex(p => p.f.id === active.f.id);
    const next = pendingFindings[idx + 1] ?? pendingFindings[0];
    if (next && next.f.id !== active.f.id) {
      setActiveId(next.f.id);
      setEdits(makeEdits(next.f, issueConfigs));
    } else {
      toast({ title: "No more pending findings", description: "This is the last one." });
    }
  }, [active, pendingFindings, issueConfigs, toast]);

  const handlePrev = useCallback(() => {
    if (!active) return;
    const idx = pendingFindings.findIndex(p => p.f.id === active.f.id);
    const prev = idx > 0 ? pendingFindings[idx - 1] : null;
    if (prev) {
      setActiveId(prev.f.id);
      setEdits(makeEdits(prev.f, issueConfigs));
    }
  }, [active, pendingFindings, issueConfigs]);

  const handleSaveNext = async () => {
    if (!active || !edits) return;
    try {
      await editMut.mutateAsync({ fid: active.f.id, patch: edits });
      await queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      const idx = pendingFindings.findIndex(p => p.f.id === active.f.id);
      const next = pendingFindings[idx + 1];
      if (next) {
        setActiveId(next.f.id);
        setEdits(makeEdits(next.f, issueConfigs));
      }
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const handleConvert = useCallback(() => {
    navigate(`/manager/wet-checks/${id}/confirm`);
  }, [id, navigate]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      if (typeof document !== "undefined" && document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (advancing) return;

      switch (e.key) {
        case "1":
          if (!active || isActiveFindingAutoBilled || isBillingManager) return;
          e.preventDefault();
          handleDecision("sent_to_estimate");
          break;
        case "2":
          if (!active || isActiveFindingAutoBilled || isBillingManager) return;
          e.preventDefault();
          handleDecision("deferred_to_work_order");
          break;
        case "3":
          if (!active || isActiveFindingAutoBilled || isBillingManager) return;
          e.preventDefault();
          handleDecision("documented_only");
          break;
        case "4":
          if (!active || isActiveFindingAutoBilled || isBillingManager) return;
          e.preventDefault();
          handleDecision("repaired_in_field");
          break;
        case "j":
        case "J":
          if (editMode || !active) return;
          e.preventDefault();
          handleSkip();
          break;
        case "k":
        case "K":
          if (editMode || !active) return;
          e.preventDefault();
          handlePrev();
          break;
        case "r":
        case "R": {
          if (editMode || !active || isActiveFindingAutoBilled || isBillingManager) return;
          e.preventDefault();
          setRouteDialogOpen(true);
          break;
        }
        case "ArrowRight":
          if (editMode || !active) return;
          e.preventDefault();
          handleSkip();
          break;
        case "ArrowLeft":
          if (editMode || !active) return;
          e.preventDefault();
          handlePrev();
          break;
        case "Escape":
          e.preventDefault();
          if (editMode) navigate(`/manager/wet-checks/${id}/confirm`);
          else navigate("/manager/wet-checks");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, advancing, editMode, isActiveFindingAutoBilled, handleDecision, handleSkip, handlePrev, navigate, id, allGreen, isBillingManager]);

  // ── Tutorial tip ──────────────────────────────────────────────────────
  const [showTutorial, setShowTutorial] = useState(false);
  useEffect(() => {
    if (editMode) return;
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(tutorialStorageKey()) === "1") return;
    } catch { return; }
    setShowTutorial(true);
  }, [editMode]);
  const dismissTutorial = useCallback(() => {
    setShowTutorial(false);
    try { window.localStorage.setItem(tutorialStorageKey(), "1"); } catch { /* ignore */ }
  }, []);

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  const autoBilledTotal = autoBilled.reduce((s, { f }) => s + lineTotalFinding(f, customerLaborRate), 0);
  const autoBilledSheetId = autoBilled[0]?.f.billingSheetId ?? null;

  if (editMode && !editTarget) {
    return (
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <div className="text-lg font-semibold">That finding can't be edited</div>
            <p className="text-sm text-gray-600">It may have been removed or already converted.</p>
            <Button
              onClick={() => navigate(`/manager/wet-checks/${id}/confirm`)}
              data-testid="wizard-edit-back-to-confirm"
            >
              Back to confirm
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allResolved = pendingFindings.length === 0;
  const showRightPanel = editMode || !allResolved || active != null;

  const issueConfig = active ? (issueConfigs.find(c => c.issueType === active.f.issueType) ?? null) : null;

  // ── Edit mode: single-column like before ──────────────────────────────
  if (editMode) {
    return (
      <div className="max-w-3xl mx-auto py-4 space-y-4 px-4 sm:px-0">
        <Link href={`/manager/wet-checks/${id}/confirm`}>
          <Button variant="ghost" data-testid="wizard-back-to-confirm">
            <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back to confirm
          </Button>
        </Link>
        <div className="space-y-1" data-testid="wizard-header">
          <div className="text-xs text-gray-700">
            {wc.customerName} · <span className="text-gray-500">WC-{wc.id}</span>
          </div>
          <h1 className="text-2xl font-bold">Edit decision</h1>
          {active && (
            <div className="text-xs text-gray-700" data-testid="wizard-edit-current">
              Current decision: <span className="font-medium">{active.f.resolution}</span>
            </div>
          )}
        </div>
        {active && edits && (
          <>
            <div
              ref={findingCardRef}
              tabIndex={-1}
              className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
            >
              <FindingCard
                finding={active.f}
                zone={active.zr}
                photos={photosByFinding.get(active.f.id) ?? []}
                parts={parts}
                issueConfig={issueConfig}
                customerLaborRate={customerLaborRate}
                edits={edits}
                onChange={setEdits}
              />
            </div>
            <div className="grid grid-cols-2 gap-3" data-testid="wizard-decision-row">
              <DecisionCard
                testId="wizard-decision-estimate"
                accent="blue"
                icon={FileText}
                title="Send to estimate"
                helper="Customer must approve"
                shortcutLabel="1"
                disabled={advancing}
                loading={advancing}
                onClick={() => handleDecision("sent_to_estimate")}
              />
              <DecisionCard
                testId="wizard-decision-work-order"
                accent="purple"
                icon={Wrench}
                title="Queue as work order"
                helper="Schedule any time"
                shortcutLabel="2"
                disabled={advancing}
                onClick={() => handleDecision("deferred_to_work_order")}
              />
              <DecisionCard
                testId="wizard-decision-document"
                accent="gray"
                icon={FileCheck}
                title="Document only"
                helper="No work scheduled"
                shortcutLabel="3"
                disabled={advancing}
                onClick={() => handleDecision("documented_only")}
              />
              <DecisionCard
                testId="wizard-decision-repaired"
                accent="green"
                icon={CheckCircle2}
                title="Already Repaired — Bill It"
                helper="Adds to billing sheet"
                shortcutLabel="4"
                disabled={advancing}
                onClick={() => handleDecision("repaired_in_field")}
              />
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                onClick={() => navigate(`/manager/wet-checks/${id}/confirm`)}
                disabled={advancing}
                data-testid="wizard-cancel-edit"
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Two-panel triage layout ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" data-testid="wizard-two-panel">
      {/* ── Billing manager read-only banner ─────────────────────────── */}
      {isBillingManager && (
        <div
          className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-2 text-sm text-blue-800"
          data-testid="wizard-billing-manager-banner"
          role="status"
        >
          <span className="font-medium">View only</span>
          <span className="text-blue-600">—</span>
          <span>Billing managers can review but cannot approve or route.</span>
        </div>
      )}

      {/* ── Top header ───────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 bg-white border-b px-4 py-3 space-y-2"
        data-testid="wizard-header"
      >
        <div className="flex items-center justify-between gap-2">
          <Link href="/manager/wet-checks">
            <Button variant="ghost" size="sm" data-testid="wizard-back-to-inbox" className="min-h-[36px] -ml-2">
              <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back to inbox
            </Button>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-xs text-gray-500">
              {wc.customerName} · <span className="font-mono">WC-{wc.id}</span>
            </div>
            {!editMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShowHelp}
                data-testid="wizard-show-help"
                className="text-gray-400 hover:text-gray-600 h-7 px-2"
                title="Show help"
              >
                <HelpCircle className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only">Show help</span>
              </Button>
            )}
          </div>
        </div>

        {/* 3-step workflow indicator */}
        {!editMode && (
          <WorkflowIndicator
            allZonesReviewed={allZonesReviewed}
            allFindingsResolved={allFindingsResolved}
          />
        )}

        {/* Progress bar */}
        {!editMode && (
          <div className="space-y-1" data-testid="wizard-progress-container">
            <div className="flex items-center justify-between text-xs text-gray-700">
              <span data-testid="wizard-progress-label">
                Findings triaged: {completedDecisions} of {totalDecisions || 1}
              </span>
              <span className="text-gray-500">{progressPct}%</span>
            </div>
            <div
              className="bg-gray-200 rounded-full overflow-hidden"
              style={{ height: 6 }}
              role="progressbar"
              aria-label="Wet check triage progress"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${completedDecisions} of ${totalDecisions || 1} findings triaged`}
            >
              <div
                className="bg-blue-600 transition-all"
                style={{ width: `${progressPct}%`, height: 6 }}
                data-testid="wizard-progress-bar"
              />
            </div>
          </div>
        )}
      </div>

      <AutoBilledBanner
        count={autoBilled.length}
        total={autoBilledTotal}
        technicianName={wc.technicianName}
        billingSheetId={autoBilledSheetId}
      />

      {bundleIds.size > 0 && (
        <div className="mx-4 mt-2">
          <Card className="border-blue-200 bg-blue-50/60" data-testid="wizard-bundle-chip">
            <CardContent className="py-2 flex items-center gap-2 text-sm text-blue-900">
              <FileText className="w-4 h-4 text-blue-700" aria-hidden="true" />
              <span>
                Building estimate: {bundleIds.size} finding{bundleIds.size === 1 ? "" : "s"} · ${bundleTotal.toFixed(2)}
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Two-panel body ───────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-0 lg:gap-4 px-4 py-3">

        {/* ── Left panel: findings list ─────────────────────────────── */}
        <div
          className="lg:w-72 xl:w-80 shrink-0 flex flex-col gap-1 lg:overflow-y-auto lg:h-[calc(100vh-10rem)]"
          data-testid="wizard-finding-list"
        >
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1 px-0.5">
            All findings ({allFindings.length})
          </div>
          {allFindings.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-6">No findings on this wet check.</div>
          )}
          {sortedFindings.map(item => {
            const isAutoBilled = autoBilled.some(({ f }) => f.id === item.f.id);
            return (
              <SidebarFindingCard
                key={item.f.id}
                item={item}
                isActive={active?.f.id === item.f.id}
                isAutoBilled={isAutoBilled}
                issueConfigs={issueConfigs}
                onClick={() => {
                  setActiveId(item.f.id);
                  setEdits(makeEdits(item.f, issueConfigs));
                }}
              />
            );
          })}
        </div>

        {/* ── Right panel: detail + decisions ──────────────────────── */}
        <div
          className="flex-1 min-w-0 flex flex-col mt-4 lg:mt-0 lg:overflow-y-auto lg:h-[calc(100vh-10rem)]"
          data-testid="wizard-detail-panel"
        >
          {!active && allResolved ? (
            <AllResolvedPanel onConvert={handleConvert} id={id} />
          ) : !active ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-500">
              Select a finding from the left panel to begin.
            </div>
          ) : isActiveFindingAutoBilled ? (
            <AutoBilledPanel item={active} customerLaborRate={customerLaborRate} />
          ) : (
            <div className="space-y-4">
              {edits && (
                <div
                  ref={findingCardRef}
                  tabIndex={-1}
                  aria-label={`Active finding: ${issueConfig?.displayLabel ?? active.f.issueType}`}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-lg"
                >
                  <FindingCard
                    finding={active.f}
                    zone={active.zr}
                    photos={photosByFinding.get(active.f.id) ?? []}
                    parts={parts}
                    issueConfig={issueConfig}
                    customerLaborRate={customerLaborRate}
                    edits={edits}
                    onChange={setEdits}
                  />
                </div>
              )}

              {loosePhotos.length > 0 && (
                <LoosePhotosSection
                  photos={loosePhotos}
                  findingOptions={loosePhotoFindingOptions}
                  wetCheckId={id}
                  readOnly={wc.status !== "submitted"}
                />
              )}

              {/* Decision buttons */}
              <div className="relative">
                {showTutorial && (
                  <div
                    role="dialog"
                    aria-label="Wizard tip"
                    className="absolute -top-2 left-0 right-0 -translate-y-full z-30"
                    data-testid="wizard-tutorial-tooltip"
                  >
                    <div className="mx-auto max-w-md bg-gray-900 text-white text-sm rounded-lg shadow-lg px-3 py-2 flex items-start gap-2">
                      <Lightbulb className="w-4 h-4 mt-0.5 text-yellow-300 shrink-0" aria-hidden="true" />
                      <div className="flex-1">
                        Tap a decision button to route this finding.
                        <div className="text-xs text-gray-300 mt-0.5 hidden sm:block">
                          Tip: press 1, 2, 3, or 4 on your keyboard.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={dismissTutorial}
                        aria-label="Dismiss tip"
                        className="text-gray-300 hover:text-white shrink-0 min-h-[44px] min-w-[44px] -mr-2 -my-2 flex items-center justify-center"
                        data-testid="wizard-tutorial-dismiss"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <span
                        aria-hidden="true"
                        className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-gray-900 rotate-45"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="wizard-decision-row">
                  <DecisionCard
                    testId="wizard-decision-estimate"
                    accent="blue"
                    icon={FileText}
                    title="Estimate"
                    helper="Customer must approve before work starts"
                    shortcutLabel="1"
                    disabled={advancing || isBillingManager}
                    loading={advancing}
                    onClick={() => !isBillingManager && handleDecision("sent_to_estimate")}
                  />
                  <DecisionCard
                    testId="wizard-decision-work-order"
                    accent="purple"
                    icon={Wrench}
                    title="Work Order"
                    helper="Adds to the work queue, schedule any time"
                    shortcutLabel="2"
                    disabled={advancing || isBillingManager}
                    onClick={() => !isBillingManager && handleDecision("deferred_to_work_order")}
                  />
                  <DecisionCard
                    testId="wizard-decision-document"
                    accent="gray"
                    icon={FileCheck}
                    title="Documented Only"
                    helper="Logged for the record, no work scheduled"
                    shortcutLabel="3"
                    disabled={advancing || isBillingManager}
                    onClick={() => !isBillingManager && handleDecision("documented_only")}
                  />
                  <DecisionCard
                    testId="wizard-decision-repaired"
                    accent="green"
                    icon={CheckCircle2}
                    title="Already Repaired — Bill It"
                    helper="Tech repaired on-site, add to billing"
                    shortcutLabel="4"
                    disabled={advancing || isBillingManager}
                    onClick={() => !isBillingManager && handleDecision("repaired_in_field")}
                  />
                </div>
              </div>

              <div className="hidden sm:block text-[11px] text-gray-500" data-testid="wizard-shortcut-hint">
                Shortcuts: <kbd className="px-1 border rounded">1</kbd>–<kbd className="px-1 border rounded">4</kbd> route ·
                {" "}<kbd className="px-1 border rounded">←</kbd>/<kbd className="px-1 border rounded">→</kbd> navigate ·
                {" "}<kbd className="px-1 border rounded">Esc</kbd> back to inbox
              </div>

              {!editMode && (
                <div className="flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    onClick={handleSkip}
                    disabled={advancing}
                    data-testid="wizard-skip"
                    className="min-h-[44px]"
                  >
                    Skip for now
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSaveNext}
                    disabled={advancing}
                    data-testid="wizard-save-next"
                    className="min-h-[44px]"
                  >
                    {advancing && <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />}
                    Save &amp; next
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── All-green DismissibleHelp guide ──────────────────────────── */}
      {!editMode && allGreen && !isBillingManager && (
        <div className="px-4 pt-3" data-testid="wizard-all-green-section">
          <DismissibleHelp
            key={tick}
            guideId="wc-review-ready-to-convert"
            variant="info"
          >
            All zones reviewed and all findings resolved — click{" "}
            <strong>Approve &amp; Convert</strong> below to finalize this wet check and create the billing row{" "}
            <span className="font-mono text-xs">WC-{new Date().getFullYear()}-{String(id).padStart(4, "0")}</span>.
          </DismissibleHelp>
        </div>
      )}

      {/* ── Bottom CTA bar ───────────────────────────────────────────── */}
      {!editMode && (
        <div
          className="sticky bottom-0 bg-white border-t px-4 py-3 flex items-center justify-between gap-3"
          data-testid="wizard-cta-bar"
        >
          <div className="text-sm text-gray-600">
            {pendingFindings.length > 0
              ? `${pendingFindings.length} finding${pendingFindings.length === 1 ? "" : "s"} remaining`
              : "All findings resolved"}
          </div>
          <Button
            onClick={handleConvert}
            disabled={!allResolved || isBillingManager}
            data-testid="wizard-approve-convert"
            className={`min-h-[44px] ${allGreen && !isBillingManager ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
          >
            Approve &amp; Convert
          </Button>
        </div>
      )}

      {/* ── Route dialog (R shortcut) ─────────────────────────────────── */}
      <Dialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen}>
        <DialogContent data-testid="wizard-route-dialog">
          <DialogHeader>
            <DialogTitle>Route this finding</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 pt-2">
            {[
              { label: "Estimate — customer approves first", value: "sent_to_estimate" as const, accent: "blue" },
              { label: "Work Order — schedule any time", value: "deferred_to_work_order" as const, accent: "purple" },
              { label: "Documented Only — log with no work", value: "documented_only" as const, accent: "gray" },
              { label: "Already Repaired — bill it", value: "repaired_in_field" as const, accent: "green" },
            ].map(({ label, value }) => (
              <Button
                key={value}
                variant="outline"
                className="justify-start min-h-[44px] text-left"
                data-testid={`route-dialog-option-${value}`}
                disabled={advancing}
                onClick={() => {
                  setRouteDialogOpen(false);
                  handleDecision(value);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

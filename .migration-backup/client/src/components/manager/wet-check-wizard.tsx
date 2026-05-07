import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Loader2, FileText, Wrench, FileCheck, ListChecks, X, Lightbulb } from "lucide-react";
import type {
  Customer, IssueTypeConfig, Part, WetCheckFinding, WetCheckPhoto,
  WetCheckWithDetails, WetCheckZoneRecord,
} from "@shared/schema";
import { FindingCard, type FindingEdits } from "./finding-card";
import { DecisionCard } from "./decision-card";
import { AutoBilledBanner } from "./auto-billed-banner";

type Resolution =
  | "pending" | "repaired_in_field" | "sent_to_estimate" | "deferred_to_work_order" | "documented_only";

interface FindingItem { f: WetCheckFinding; zr: WetCheckZoneRecord; }

const TUTORIAL_STORAGE_PREFIX = "wet-check-wizard-tutorial-dismissed-v1";

// Scope the tutorial dismissal per signed-in user so two managers sharing a
// device each see the tip on their own first open. Falls back to a shared
// "anon" key if no user is in localStorage yet (matches the auth pattern
// used elsewhere in the app — see client/src/pages/work-orders.tsx).
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

function lineTotalFinding(f: WetCheckFinding, laborRate: number): number {
  const partPrice = parseFloat(String(f.partPrice ?? "0")) || 0;
  const labor = parseFloat(String(f.laborHours ?? "0")) || 0;
  return partPrice * Number(f.quantity ?? 0) + labor * laborRate;
}

function makeEdits(f: WetCheckFinding, configs: IssueTypeConfig[]): FindingEdits {
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

export function WetCheckWizard({ id }: { id: number }) {
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  // Edit mode — opened from the confirm screen as
  // /manager/wet-checks/:id?edit=<findingId>. In this mode the wizard
  // surfaces a single, already-decided finding so the manager can change
  // their decision before they finalize the convert. After the new
  // decision is saved we navigate back to the confirm screen.
  // Re-derive on every location change so query-string updates without
  // a remount still pick up the new finding id.
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
  const { data: parts = [] } = useQuery<Part[]>({ queryKey: ["/api/parts"] });
  const { data: issueConfigs = [] } = useQuery<IssueTypeConfig[]>({
    queryKey: ["/api/wet-checks/issue-types"],
  });

  const customerLaborRate = parseFloat(String(customer?.laborRate ?? "45")) || 45;

  const allFindings: FindingItem[] = useMemo(() => {
    if (!wc) return [];
    return wc.zoneRecords.flatMap(zr => zr.findings.map(f => ({ f, zr })));
  }, [wc]);

  const pendingFindings = useMemo(
    () => allFindings.filter(({ f }) => (f.resolution ?? "pending") === "pending" && f.convertedAt == null),
    [allFindings],
  );

  const autoBilled = useMemo(
    () => allFindings.filter(({ f }) => f.resolution === "repaired_in_field" && f.billingSheetId != null),
    [allFindings],
  );

  // N = total findings that need (or needed) a manager decision.
  // Excludes the auto-billed-in-field rows.
  const totalDecisions = allFindings.filter(({ f }) =>
    !(f.resolution === "repaired_in_field" && f.billingSheetId != null),
  ).length;
  const completedDecisions = totalDecisions - pendingFindings.length;
  const progressPct = totalDecisions === 0 ? 100 : Math.round((completedDecisions / totalDecisions) * 100);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [edits, setEdits] = useState<FindingEdits | null>(null);

  // The active finding is whichever row matches our explicit pointer. In
  // edit mode we lock onto the requested finding regardless of resolution
  // so a manager can re-route an already-decided one. Otherwise we fall
  // back to the first pending finding so the wizard always has work to do.
  const editTarget = useMemo(
    () => (editFindingId == null ? null : allFindings.find(p => p.f.id === editFindingId) ?? null),
    [editFindingId, allFindings],
  );
  const activeIdx = activeId == null ? -1 : pendingFindings.findIndex(p => p.f.id === activeId);
  const active: FindingItem | null = editMode
    ? editTarget
    : (activeIdx >= 0 ? pendingFindings[activeIdx] : (pendingFindings[0] ?? null));
  const upNext = editMode ? [] : pendingFindings.filter(p => p.f.id !== active?.f.id);

  const photosByFinding = useMemo(() => {
    const m = new Map<number, WetCheckPhoto[]>();
    if (!wc) return m;
    for (const p of wc.photos) {
      if (p.findingId == null) continue;
      const arr = m.get(p.findingId) ?? [];
      arr.push(p); m.set(p.findingId, arr);
    }
    return m;
  }, [wc]);

  // Sync the explicit pointer + edit buffer with whichever finding is active.
  // Setting activeId from inside this effect (rather than deriving it) keeps
  // manual navigation (Skip / Save & next) authoritative — those handlers
  // bump activeId directly and the next render sees `active` follow.
  useEffect(() => {
    if (!active) {
      if (activeId !== null) setActiveId(null);
      if (edits !== null) setEdits(null);
      return;
    }
    if (active.f.id !== activeId) {
      setActiveId(active.f.id);
      setEdits(makeEdits(active.f, issueConfigs));
    }
  }, [active, activeId, edits, issueConfigs]);

  // Move keyboard focus to the active finding's card whenever it changes,
  // so screen-reader and keyboard users follow along as the wizard advances.
  const findingCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const node = findingCardRef.current;
    if (!node) return;
    // Don't yank focus away from a form input the manager is editing.
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (ae && node.contains(ae)) return;
    node.focus({ preventScroll: false });
  }, [active?.f.id]);

  // Bundle-building chip — track findings sent to estimate during this session.
  const [bundleIds, setBundleIds] = useState<Set<number>>(new Set());
  const [bundleTotal, setBundleTotal] = useState(0);

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
      const remaining = pendingFindings.length - 1;
      await queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
      if (editMode) {
        // The manager opened the wizard from the confirm screen to revise
        // a single decision. Send them straight back to confirm so they
        // can review the rest of the summary in context.
        navigate(`/manager/wet-checks/${id}/confirm`);
      } else if (remaining <= 0) {
        // Last pending finding handled — 5D hands off to the confirm screen
        // which owns the actual convert call and the post-success done view.
        navigate(`/manager/wet-checks/${id}/confirm`);
      }
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    }
  }, [active, edits, customerLaborRate, editMut, routeMut, pendingFindings.length, id, editMode, navigate, toast]);

  const handleSkip = useCallback(async () => {
    if (!active) return;
    // Resolution is already pending; just rotate to the next one locally.
    const idx = pendingFindings.findIndex(p => p.f.id === active.f.id);
    const next = pendingFindings[idx + 1];
    if (next) {
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  // 1/2/3 → decision actions, ←/→ → navigate findings, Esc → back to inbox.
  // Suppressed while a text input is focused or a dialog (e.g. parts picker)
  // is open so we never steal keystrokes from the manager's typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      // Don't fire while the parts picker (or any other) modal is open.
      if (typeof document !== "undefined" && document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (advancing) return;

      switch (e.key) {
        case "1":
          if (!active) return;
          e.preventDefault();
          handleDecision("sent_to_estimate");
          break;
        case "2":
          if (!active) return;
          e.preventDefault();
          handleDecision("deferred_to_work_order");
          break;
        case "3":
          if (!active) return;
          e.preventDefault();
          handleDecision("documented_only");
          break;
        case "ArrowRight":
          if (editMode || !active) return;
          // Spec: "→ advances to the next finding (after a decision)".
          // Decisions (1/2/3) auto-advance, so the typical "after a
          // decision" path is already covered. ArrowRight here is the
          // manual forward step through the pending queue — useful when
          // the manager wants to move on without committing yet, or to
          // step through after a decision finishes saving.
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
  }, [active, advancing, editMode, handleDecision, handleSkip, handlePrev, navigate, id]);

  // ── First-open onboarding tooltip ─────────────────────────────────────
  // Persisted in localStorage so the dismissal sticks per browser/user.
  // (A `tutorial_progress` JSON column is the preferred backing store but
  // isn't yet on the users table; localStorage is the documented fallback.)
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

  // Edit mode with a stale/invalid ?edit=<id>: bounce back to confirm
  // so the manager doesn't get stranded on a blank page.
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

  // Resume / empty state — no pending findings remain.
  if (!active) {
    return (
      <div className="max-w-3xl mx-auto py-4 space-y-4">
        <BackLink />
        <AutoBilledBanner
          count={autoBilled.length}
          total={autoBilledTotal}
          technicianName={wc.technicianName}
          billingSheetId={autoBilledSheetId}
        />
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <ListChecks className="w-10 h-10 mx-auto text-green-600" aria-hidden="true" />
            <div className="text-lg font-semibold">All findings have a decision</div>
            <p className="text-sm text-gray-600">Nothing left to triage on this wet check.</p>
            {wc.status !== "converted" && (
              <Button
                onClick={() => navigate(`/manager/wet-checks/${id}/confirm`)}
                data-testid="wizard-convert-now"
              >
                Review and confirm
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const decisionIndex = completedDecisions + 1;
  const issueConfig = issueConfigs.find(c => c.issueType === active.f.issueType) ?? null;

  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-4 sm:px-0">
      {editMode ? (
        <Link href={`/manager/wet-checks/${id}/confirm`}>
          <Button variant="ghost" data-testid="wizard-back-to-confirm">
            <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back to confirm
          </Button>
        </Link>
      ) : (
        <BackLink />
      )}

      {/* Sticky on mobile so the progress + heading stay in view as the
          manager scrolls a tall finding card. Inline on desktop. */}
      <div
        className="space-y-2 sticky top-0 z-20 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 -mx-4 px-4 py-2 sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent"
        data-testid="wizard-header"
      >
        <div className="text-xs text-gray-700">
          {wc.customerName} · <span className="text-gray-500">WC-{wc.id}</span>
        </div>
        <h1 className="text-2xl font-bold">
          {editMode ? "Edit decision" : `Decision ${decisionIndex} of ${totalDecisions || 1}`}
        </h1>
        {!editMode && (
          <>
            <div
              className="bg-gray-200 rounded-full overflow-hidden"
              style={{ height: 6, width: 90 }}
              role="progressbar"
              aria-label="Wet check decision progress"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${completedDecisions} of ${totalDecisions || 1} decisions complete`}
            >
              <div
                className="bg-blue-600 transition-all"
                style={{ width: `${progressPct}%`, height: 6 }}
                data-testid="wizard-progress-bar"
              />
            </div>
            <div className="text-xs text-gray-700" data-testid="wizard-progress-label">{progressPct}% complete</div>
          </>
        )}
        {editMode && (
          <div className="text-xs text-gray-700" data-testid="wizard-edit-current">
            Current decision: <span className="font-medium">{active.f.resolution}</span>
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
        <Card className="border-blue-200 bg-blue-50/60" data-testid="wizard-bundle-chip">
          <CardContent className="py-2 flex items-center gap-2 text-sm text-blue-900">
            <FileText className="w-4 h-4 text-blue-700" aria-hidden="true" />
            <span>
              Building estimate: {bundleIds.size} finding{bundleIds.size === 1 ? "" : "s"} · ${bundleTotal.toFixed(2)}
            </span>
          </CardContent>
        </Card>
      )}

      {edits && (
        <div
          ref={findingCardRef}
          tabIndex={-1}
          aria-label={`Active finding ${decisionIndex} of ${totalDecisions || 1}`}
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
                Tap a decision card to route this finding.
                <div className="text-xs text-gray-300 mt-0.5 hidden sm:block">
                  Tip: press 1, 2, or 3 on your keyboard.
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="wizard-decision-row">
          <DecisionCard
            testId="wizard-decision-estimate"
            accent="blue"
            icon={FileText}
            title="Send to estimate"
            helper="Customer must approve before work starts"
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
            helper="Adds to the work queue, schedule any time"
            shortcutLabel="2"
            disabled={advancing}
            onClick={() => handleDecision("deferred_to_work_order")}
          />
          <DecisionCard
            testId="wizard-decision-document"
            accent="gray"
            icon={FileCheck}
            title="Document only"
            helper="Logged for the record, no work scheduled"
            shortcutLabel="3"
            disabled={advancing}
            onClick={() => handleDecision("documented_only")}
          />
        </div>
      </div>

      {!editMode && (
        <div className="hidden sm:block text-[11px] text-gray-500" data-testid="wizard-shortcut-hint">
          Shortcuts: <kbd className="px-1 border rounded">1</kbd>/<kbd className="px-1 border rounded">2</kbd>/<kbd className="px-1 border rounded">3</kbd> route ·
          {" "}<kbd className="px-1 border rounded">←</kbd>/<kbd className="px-1 border rounded">→</kbd> navigate ·
          {" "}<kbd className="px-1 border rounded">Esc</kbd> back to inbox
        </div>
      )}

      {upNext.length > 0 && (
        <div className="space-y-2" data-testid="wizard-up-next">
          <div className="text-xs uppercase tracking-wide text-gray-600">Up next</div>
          {upNext.map(({ f, zr }) => {
            const cfg = issueConfigs.find(c => c.issueType === f.issueType) ?? null;
            return (
              <div
                key={f.id}
                className="rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-700 flex items-center justify-between"
                data-testid={`wizard-up-next-${f.id}`}
              >
                <span className="truncate">
                  {cfg?.displayLabel ?? f.partName ?? f.issueType} · Controller {zr.controllerLetter} · Zone {zr.zoneNumber}
                </span>
                <Badge variant="outline" className="text-[10px]">Pending</Badge>
              </div>
            );
          })}
        </div>
      )}

      <div className="sticky bottom-0 bg-white border-t py-3 flex items-center justify-between gap-3">
        {editMode ? (
          <Button
            variant="ghost"
            onClick={() => navigate(`/manager/wet-checks/${id}/confirm`)}
            disabled={advancing}
            data-testid="wizard-cancel-edit"
            className="min-h-[44px]"
          >
            Cancel
          </Button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/manager/wet-checks">
      <Button variant="ghost" data-testid="wizard-back-to-inbox" className="min-h-[44px]">
        <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back to inbox
      </Button>
    </Link>
  );
}

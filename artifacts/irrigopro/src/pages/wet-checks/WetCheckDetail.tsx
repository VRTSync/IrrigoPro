import { useEffect, useRef, useState } from "react";
import { ActivityTab } from "@/components/activity/ActivityTab";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, CheckCircle2, Wrench, AlertTriangle, Camera, Download } from "lucide-react";
import { countZonePhotos } from "@/lib/wet-check-photos";
import { apiRequest, asArray, queryClient, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { OfflineStrip, OfflineSyncUI } from "@/components/offline/sync-ui";
import {
  isProbablyOffline,
  submitWetCheck as offlineSubmitWetCheck,
  warmWetCheckMirror,
  readWetCheckFromMirror,
  readWetCheckByClientId,
  cachedApiRequest,
  hasPendingMutationsForWetCheck,
} from "@/lib/offline/api";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import type {
  WetCheckWithDetails,
  PropertyController,
} from "@workspace/db/schema";
import { buildWetCheckCsv, downloadCsv, wetCheckCsvFilename } from "@/lib/wet-check-csv";
import { PropertyContextHeader } from "./PropertyContextHeader";
import { PhotoCaptureButton } from "./PhotoCaptureButton";
import { PhotoThumb } from "./PhotoThumb";
import { ControllerHeader } from "./ControllerHeader";
import { ZoneScreen } from "./ZoneScreen";
import { FindingsByResolution } from "./FindingsByResolution";
import { LoosePhotosSection } from "./LoosePhotosSection";

// ─── Detail page ──────────────────────────────────────────────────────────────

export function WetCheckDetail({ id, clientId: routeClientId }: { id?: number; clientId?: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<number | null>(null);

  const { data: wc, isLoading } = useQuery<WetCheckWithDetails>({
    queryKey: id != null ? ["/api/wet-checks", id] : ["/api/wet-checks", "c", routeClientId],
    // Mirror-first when offline (or when only clientId is known, i.e. a
    // wet check that was created offline and has no server id yet) so a
    // tech who reloads the page mid-capture still sees their queued state.
    // Online path warms the mirror so the next offline reload has fresh data.
    queryFn: async () => {
      // Pure-offline (no server id yet) path: read from mirror by clientId.
      if (id == null && routeClientId) {
        const cached = await readWetCheckByClientId(routeClientId);
        if (!cached) throw new Error("Wet check not yet synced — open it from the list when you're back online.");
        return cached as WetCheckWithDetails;
      }
      // IDB-first: when the offline queue is enabled, return the mirror
      // immediately if we have one and refresh from the network in the
      // background. The background refresh re-warms the mirror and triggers
      // a query invalidation so the UI updates without blocking the tech.
      if (isOfflineQueueEnabled()) {
        const cached = await readWetCheckFromMirror(id!);
        if (cached) {
          if (!isProbablyOffline()) {
            // Task #512 — skip the background refresh while local edits
            // for this wet check are still queued. Otherwise a stale
            // server snapshot (e.g. zone still `checked_with_issues`)
            // can clobber an optimistic Needs Work → Ran OK flip the
            // tech just made, leaving the controller-grid tile red even
            // though the local mirror + queue already say `checked_ok`.
            void hasPendingMutationsForWetCheck(cached?.clientId ?? "")
              .then((pending) => {
                if (pending) return;
                return apiRequest(`/api/wet-checks/${id}`)
                  .then((fresh) => warmWetCheckMirror(null, id!, fresh).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", id] });
                  }));
              })
              .catch(() => { /* ignore — heartbeat will recover */ });
          }
          return cached as WetCheckWithDetails;
        }
        // No mirror row yet — fall through to a blocking fetch and warm.
        if (isProbablyOffline()) {
          throw new Error("Wet check not cached locally — reconnect to load it.");
        }
      }
      const fresh = await apiRequest(`/api/wet-checks/${id}`);
      if (isOfflineQueueEnabled()) {
        try { await warmWetCheckMirror(null, id!, fresh); } catch {}
      }
      return fresh;
    },
  });

  const { data: controllers = [] } = useArrayQuery<PropertyController>({
    queryKey: ["/api/properties", wc?.customerId, "controllers"],
    queryFn: () => cachedApiRequest(`/api/properties/${wc!.customerId}/controllers`),
    enabled: !!wc?.customerId,
  });

  // Submit-confirm modal pulls a server-computed preview of what will be
  // auto-billed vs. left for the manager queue, so the tech sees exact
  // dollars before committing. The same preview shape is returned by
  // /submit so the success toast can echo what actually happened.
  type SubmitPreview = {
    autoBillEnabled: boolean;
    autoBilledCount: number;
    autoBilledPartsTotal: string;
    autoBilledLaborTotal: string;
    autoBilledGrandTotal: string;
    pendingCount: number;
    pendingByGroup: { quick_fix: number; advanced: number; zone_issue: number };
  };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<SubmitPreview | null>(null);

  // Slice 3 — server-authoritative WET_CHECK_AUTO_BILL flag. When OFF,
  // the field UI must fall back to the Slice 2 plain-submit flow (no
  // preview modal, no chip rail, no auto-bill messaging).
  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  const previewMut = useMutation({
    mutationFn: (): Promise<SubmitPreview> =>
      apiRequest(`/api/wet-checks/${id}/submit-preview`, "POST", {}),
    onSuccess: (p) => {
      setPreview(p);
      setConfirmOpen(true);
    },
    onError: (e: any) =>
      toast({ title: "Could not preview submit", description: e?.message, variant: "destructive" }),
  });

  const submitMut = useMutation({
    mutationFn: async (): Promise<{ status?: string; billingSheetId?: number | null; autoBilledCount?: number; pendingCount?: number; queued?: boolean }> => {
      // Online path: hit the server directly so we get the auto-bill summary.
      // Offline path: queue the submit linked to this wet check by clientId
      // so the engine can dispatch it with the real id once create resolves.
      const serverId = wc?.id ?? id;
      // If we have no server id yet (e.g. opened by /c/:clientId before
      // the create has dispatched), the only safe path is to queue.
      const mustQueue = serverId == null;
      if ((mustQueue || (isOfflineQueueEnabled() && isProbablyOffline())) && wc?.clientId) {
        await offlineSubmitWetCheck(wc.clientId, serverId ?? undefined);
        return { queued: true };
      }
      return apiRequest(`/api/wet-checks/${serverId}/submit`, "POST", {});
    },
    onSuccess: (res) => {
      if (res.queued) {
        toast({
          title: "Queued offline",
          description: "Submit will run as soon as you're back online.",
        });
        setConfirmOpen(false);
        navigate("/wet-checks");
        return;
      }
      const parts: string[] = [];
      if ((res.autoBilledCount ?? 0) > 0) {
        parts.push(`${res.autoBilledCount} finding(s) auto-billed${res.billingSheetId ? ` (BS #${res.billingSheetId})` : ""}`);
      }
      if ((res.pendingCount ?? 0) > 0) parts.push(`${res.pendingCount} pending → manager`);
      if ((res.pendingCount ?? 0) === 0 && (res.autoBilledCount ?? 0) === 0) parts.push("No findings to bill");
      toast({ title: "Submitted", description: parts.join(" · ") });
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      setConfirmOpen(false);
      navigate("/wet-checks");
    },
    onError: (e: any) => {
      // Task #600 — `apiRequest` throws `Error("<status>: <body>")` where
      // body is the raw response text. For our 4xx JSON responses that's
      // `{"message":"…"}`, so unwrap it to the instructional message
      // (e.g. "Cannot auto-bill finding 24: marked complete but has no
      // part assigned…") instead of dumping the JSON in the toast.
      const raw = typeof e?.message === "string" ? e.message : "";
      const m = raw.match(/^\d{3}:\s*(.*)$/s);
      const tail = m ? m[1] : raw;
      let description = tail;
      try {
        const parsed = JSON.parse(tail);
        if (parsed && typeof parsed.message === "string") description = parsed.message;
      } catch { /* not JSON, use tail verbatim */ }
      toast({ title: "Failed to submit", description, variant: "destructive" });
    },
  });

  // Task #561 — Hoist the "jump to next needs-decision" hooks (Task
  // #517) above the loading guard. Otherwise WetCheckDetail trips
  // React error #310 ("Rendered more hooks than during the previous
  // render") when `wc` resolves on the second render — often
  // synchronously from the IDB mirror in `isOfflineQueueEnabled()`
  // mode — and React suddenly sees five extra hooks below the early
  // return that didn't run on the first render. Derive the inputs
  // from `wc?.zoneRecords` with `asArray` + optional chaining so
  // they collapse to an empty list while `wc` is still loading.
  const needsDecisionIds = asArray(wc?.zoneRecords)
    .flatMap(z => asArray(z.findings))
    .filter(
      f =>
        f.resolution === "repaired_in_field" &&
        f.partId == null &&
        !f.noPartNeeded,
    )
    .map(f => f.id);
  const needsDecisionKey = needsDecisionIds.join(",");
  const [jumpIndex, setJumpIndex] = useState(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTargetRef = useRef<HTMLElement | null>(null);
  // Reset cycle whenever the underlying list of offenders changes so a
  // fixed finding doesn't leave a stale pointer past the end. Also
  // clear any in-flight highlight + timer so a card that just left the
  // offender set isn't stuck wearing the amber ring.
  useEffect(() => {
    setJumpIndex(0);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    if (highlightTargetRef.current) {
      highlightTargetRef.current.classList.remove(
        "ring-2",
        "ring-amber-400",
        "ring-offset-2",
        "bg-amber-50",
        "transition",
      );
      highlightTargetRef.current = null;
    }
  }, [needsDecisionKey]);
  // Cancel any pending highlight cleanup on unmount, and clear the
  // class from any element it was applied to so we don't leave a
  // stuck ring on a card that's no longer in the offender list.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      if (highlightTargetRef.current) {
        highlightTargetRef.current.classList.remove(
          "ring-2",
          "ring-amber-400",
          "ring-offset-2",
          "bg-amber-50",
          "transition",
        );
        highlightTargetRef.current = null;
      }
    };
  }, []);

  if (isLoading || !wc) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>;
  }

  // Task #540 — `wc.zoneRecords` / `wc.photos` are typed as `T[]` but the
  // server can return `null` for nested array fields on freshly-created
  // records. Normalize at the top so every downstream `.map / .filter /
  // .flatMap / .length` is safe without sprinkling `?? []` everywhere.
  const wcZoneRecords = asArray(wc.zoneRecords);
  const wcPhotos = asArray(wc.photos);
  const zonesByLetter = (letter: string) =>
    wcZoneRecords.filter(z => z.controllerLetter === letter);

  const isReadOnly = wc.status !== "in_progress";

  // Drill-down: a specific zone
  if (activeLetter && activeZone) {
    const ctrl = controllers.find(c => c.controllerLetter === activeLetter);
    const zoneCount = ctrl?.zoneCount ?? 100;
    const records = zonesByLetter(activeLetter);
    const zoneRecord = records.find(z => z.zoneNumber === activeZone);
    return (
      // Task #511 — `key` forces a fresh mount whenever the tech advances
      // to a different zone. Without it, ZoneScreen (and the FindingSheet
      // it owns) is the same React instance across zones, so per-zone
      // local state — the Needs Work form (selected part, qty, labor
      // hours, notes, mark-complete toggle, no-part-needed toggle,
      // pending photos), the open finding sheet, the pending revert
      // dialog, and the inline Mark Zone Complete confirm — would leak
      // onto the next zone after `onAdvance()` flipped only the
      // `activeZone` prop. Remounting on `${letter}-${zone}` resets all
      // that state to defaults so each zone opens as a clean slate.
      <ZoneScreen
        key={`zone-${activeLetter}-${activeZone}`}
        wetCheckId={wc.id ?? id ?? 0}
        wetCheckClientId={wc.clientId ?? null}
        customerId={wc.customerId}
        customerName={wc.customerName}
        propertyAddress={wc.propertyAddress}
        letter={activeLetter}
        zoneNumber={activeZone}
        zoneCount={zoneCount}
        zoneRecord={zoneRecord}
        photos={wcPhotos.filter(p => p.zoneRecordId === zoneRecord?.id)}
        readOnly={isReadOnly}
        onBack={() => setActiveZone(null)}
        onAdvance={() => {
          if (activeZone < zoneCount) setActiveZone(activeZone + 1);
          else setActiveZone(null);
        }}
      />
    );
  }

  // Drill-down: a specific controller's zone grid
  if (activeLetter) {
    const ctrl = controllers.find(c => c.controllerLetter === activeLetter);
    const records = zonesByLetter(activeLetter);
    const recordsByZone = new Map(records.map(r => [r.zoneNumber, r]));
    return (
      <div className="max-w-3xl mx-auto py-4 space-y-3 px-3 sm:px-4 pb-safe">
        <PropertyContextHeader
          customerName={wc.customerName}
          propertyAddress={wc.propertyAddress}
          controllerLetter={activeLetter}
        />
        <Button variant="ghost" onClick={() => setActiveLetter(null)} data-testid="btn-back">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to Controllers
        </Button>
        <ControllerHeader controller={ctrl} customerId={wc.customerId} readOnly={isReadOnly} />
        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-1.5 sm:gap-1">
          {Array.from({ length: ctrl?.zoneCount ?? 100 }, (_, i) => i + 1).map(n => {
            const r = recordsByZone.get(n);
            const cls = r?.status === "checked_ok"
              ? "bg-green-500 text-white"
              : r?.status === "checked_with_issues"
              ? "bg-red-500 text-white"
              : r?.status === "not_applicable"
              ? "bg-gray-400 text-white"
              : "bg-white border border-gray-300";
            // Task #458 — overlay a check-mark on Needs Work tiles the tech
            // has explicitly marked complete, so the controller grid reads
            // as a true progress map (red = still mid-edit, red-with-check
            // = reviewed-and-confirmed).
            const isMarkedComplete =
              r?.status === "checked_with_issues" && r?.markedCompleteAt != null;
            const zonePhotoCount = countZonePhotos(wc, r);
            const aria = [
              isMarkedComplete ? `Zone ${n} — Needs Work, marked complete` : `Zone ${n}`,
              zonePhotoCount > 0
                ? `, ${zonePhotoCount} photo${zonePhotoCount === 1 ? "" : "s"}`
                : "",
            ].join("");
            return (
              <button
                key={n}
                onClick={() => setActiveZone(n)}
                className={`relative aspect-square min-h-[44px] text-sm sm:text-xs font-medium rounded active:scale-95 transition-transform ${cls}`}
                data-testid={`zone-${activeLetter}-${n}`}
                data-marked-complete={isMarkedComplete ? "true" : undefined}
                aria-label={aria}
              >
                {n}
                {isMarkedComplete && (
                  <span
                    className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-white text-green-600 shadow ring-1 ring-green-600"
                    data-testid={`zone-${activeLetter}-${n}-marked-complete`}
                  >
                    <CheckCircle2 className="w-3 h-3" strokeWidth={3} />
                  </span>
                )}
                {zonePhotoCount > 0 && (
                  <span
                    className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full bg-white text-[9px] font-bold text-gray-800 shadow ring-1 ring-gray-400"
                    data-testid={`zone-${activeLetter}-${n}-photo-count`}
                  >
                    <Camera className="w-2 h-2 mr-px" aria-hidden />
                    {zonePhotoCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Top-level: controllers grid + wet-check level photos
  const wetCheckLevelPhotos = wcPhotos.filter(p => !p.zoneRecordId && !p.findingId);
  // Status chip counts so the tech sees at-a-glance what they're about to
  // submit: how many findings are already complete (will auto-bill) vs.
  // still pending a manager decision, plus skipped zones.
  const allFindings = wcZoneRecords.flatMap(z => asArray(z.findings));
  const completeCount = allFindings.filter(f => f.resolution === "repaired_in_field").length;
  const pendingFindingCount = allFindings.filter(f => f.resolution === "pending").length;
  // Task #464 — Complete findings that have neither a part nor the
  // labor-only confirmation block submit. Surface them inline on the CTA
  // so the tech knows exactly what to fix before tapping Submit.
  const completeNeedingDecision = allFindings.filter(f =>
    f.resolution === "repaired_in_field" &&
    f.partId == null &&
    !f.noPartNeeded,
  );
  // Task #517 — Tap the amber banner to jump to the next finding that
  // still needs a part / labor-only decision. The cycle index, refs,
  // and effects are hoisted above the loading guard (see Task #561)
  // so the hook order stays stable across the wc undefined → defined
  // transition; only the click handler stays here.
  const jumpToNextNeedsDecision = () => {
    if (needsDecisionIds.length === 0) return;
    const idx = jumpIndex % needsDecisionIds.length;
    const targetId = needsDecisionIds[idx];
    // The offending findings are rendered above the banner inside the
    // FindingsByResolution "Complete" group as
    // `group-complete-row-${id}` rows. Those are the only per-finding
    // anchors present on the wet check submit screen.
    const el = document.querySelector<HTMLElement>(
      `[data-testid="group-complete-row-${targetId}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Clear any prior highlight first so a quick re-tap doesn't leave
      // a stuck ring on a previous, unrelated card.
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      if (highlightTargetRef.current && highlightTargetRef.current !== el) {
        highlightTargetRef.current.classList.remove(
          "ring-2",
          "ring-amber-400",
          "ring-offset-2",
          "bg-amber-50",
          "transition",
        );
      }
      el.classList.add(
        "ring-2",
        "ring-amber-400",
        "ring-offset-2",
        "bg-amber-50",
        "transition",
      );
      highlightTargetRef.current = el;
      highlightTimerRef.current = setTimeout(() => {
        el.classList.remove(
          "ring-2",
          "ring-amber-400",
          "ring-offset-2",
          "bg-amber-50",
          "transition",
        );
        if (highlightTargetRef.current === el) {
          highlightTargetRef.current = null;
        }
        highlightTimerRef.current = null;
      }, 1500);
    }
    setJumpIndex(idx + 1);
  };
  const naCount = wcZoneRecords.filter(z => z.status === "not_applicable").length;
  // Task #428 — submit CTA copy + intent counts. Disposition is the tech's
  // self-reported intent and is decoupled from `resolution` (which carries
  // billing/routing semantics).
  const dispositionCompleted = allFindings.filter(f => f.techDisposition === "completed_in_field").length;
  const dispositionNeedsReview = allFindings.filter(f => f.techDisposition !== "completed_in_field").length;
  const submitCtaLabel =
    allFindings.length === 0
      ? "Submit — no issues found"
      : dispositionNeedsReview === 0
        ? "Submit — all work completed"
        : "Submit for manager review";
  return (
    <div className="max-w-3xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">
      <PropertyContextHeader
        customerName={wc.customerName}
        propertyAddress={wc.propertyAddress}
      />
      <OfflineStrip />
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => navigate("/wet-checks")}>
          <ChevronLeft className="w-4 h-4 mr-1" /> All Wet Checks
        </Button>
        <div className="flex items-center gap-2">
          {typeof wc.id === "number" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(buildWetCheckCsv(wc), wetCheckCsvFilename(wc))}
            >
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          )}
          <OfflineSyncUI />
        </div>
      </div>
      {/* Sticky chip — keeps the complete / pending / skipped tally
          visible while the tech scrolls through controllers, so they
          always know what the submit-confirm modal will say. Tapping a
          chip scrolls to the matching findings group below the
          controllers grid. Hidden entirely when auto-billing is off so
          the Slice 2 submit experience is restored verbatim. */}
      {!isReadOnly && autoBillEnabled && (
        <div
          className="sticky top-2 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto scrollbar-hide bg-white/90 backdrop-blur border-y sm:border sm:rounded py-1.5"
          data-testid="status-chip-row"
        >
          <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={() => document.getElementById("findings-group-complete")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="min-h-[36px] inline-flex items-center"
              data-testid="chip-complete"
            >
              <Badge variant="default">✓ Complete · {completeCount}</Badge>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("findings-group-pending")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="min-h-[36px] inline-flex items-center"
              data-testid="chip-pending"
            >
              <Badge variant="secondary">Needs decision · {pendingFindingCount}</Badge>
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("findings-group-na")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="min-h-[36px] inline-flex items-center"
              data-testid="chip-na"
            >
              <Badge variant="outline">N/A · {naCount}</Badge>
            </button>
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>{wc.customerName}</CardTitle>
            {!isReadOnly && (
              <PhotoCaptureButton
                wetCheckId={wc.id ?? id ?? 0}
                wetCheckClientId={wc.clientId ?? null}
              />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>{wc.propertyAddress ?? "—"}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Status: <Badge>{wc.status}</Badge></span>
            <span
              className="inline-flex items-center gap-1 text-xs text-gray-700"
              data-testid="wc-photo-total"
              aria-label={`${wcPhotos.length} photo${wcPhotos.length === 1 ? "" : "s"} attached to this wet check`}
            >
              <Camera className="w-3.5 h-3.5" aria-hidden />
              {wcPhotos.length} photo{wcPhotos.length === 1 ? "" : "s"}
            </span>
          </div>
          {wetCheckLevelPhotos.length > 0 && (
            <div className="pt-2" data-testid="wc-photos">
              {(() => {
                // Task #246 / #597 — Wet-check-level photos with no zone or
                // finding link are surfaced as a single "loose" amber
                // banner regardless of whether findings exist yet. Without
                // findings the picker collapses to "Add a work item first"
                // (LoosePhotosSection handles that branch). With findings
                // the labels include the controller/zone so the picker is
                // unambiguous when multiple zones have findings of the
                // same issue type.
                const options = wcZoneRecords.flatMap(zr =>
                  asArray(zr.findings).map(f => ({
                    id: f.id,
                    label: `${zr.controllerLetter}${zr.zoneNumber} · ${f.issueType.replace(/_/g, " ")} · ${f.partName ?? "no part"}`,
                  })),
                );
                return (
                  <LoosePhotosSection
                    photos={wetCheckLevelPhotos}
                    findingOptions={options}
                    wetCheckId={wc.id ?? id ?? 0}
                    readOnly={isReadOnly}
                  />
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {(() => {
        // Task #612 facelift — summary header above the controllers grid
        // so techs can see the state of the whole wet check at a glance
        // instead of mentally summing tile colors. Counts mirror the
        // mobile ChipRow.
        let ok = 0, issues = 0, na = 0, notChecked = 0, markedComplete = 0;
        for (const zr of wcZoneRecords) {
          if (zr.status === "checked_ok") ok++;
          else if (zr.status === "checked_with_issues") {
            issues++;
            if (zr.markedCompleteAt) markedComplete++;
          } else if (zr.status === "not_applicable") na++;
          else notChecked++;
        }
        return (
          <div
            className="flex flex-wrap items-center gap-1.5 sm:gap-2"
            data-testid="wet-check-summary-counts"
            aria-label={`Wet check summary: ${ok} ran OK, ${issues} need work, ${na} N/A, ${notChecked} not checked`}
          >
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-600 text-white" data-testid="summary-ok">
              ✓ Ran OK · {ok}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-600 text-white" data-testid="summary-issues">
              ! Needs work · {issues}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-400 text-white" data-testid="summary-na">
              N/A · {na}
            </span>
            {notChecked > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300" data-testid="summary-not-checked">
                Not checked · {notChecked}
              </span>
            )}
            {markedComplete > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-900 border border-blue-300" data-testid="summary-marked-complete">
                ✓ Marked complete · {markedComplete}
              </span>
            )}
          </div>
        );
      })()}

      <h2 className="text-lg font-semibold">Controllers</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {controllers.map(c => {
          const recs = zonesByLetter(c.controllerLetter);
          const ok = recs.filter(r => r.status === "checked_ok").length;
          const issues = recs.filter(r => r.status === "checked_with_issues").length;
          const na = recs.filter(r => r.status === "not_applicable").length;
          const photoCount = recs.reduce(
            (n, r) => n + countZonePhotos(wc, r),
            0,
          );
          // Task #612 — surface the total work items on the controller
          // tile so a tech scanning the grid sees which controllers
          // have findings attached before drilling in.
          const findingCount = recs.reduce(
            (n, r) => n + asArray(r.findings).length,
            0,
          );
          return (
            <Card
              key={c.controllerLetter}
              className="cursor-pointer hover:bg-blue-50 active:bg-blue-100 transition-colors"
              onClick={() => setActiveLetter(c.controllerLetter)}
              data-testid={`controller-${c.controllerLetter}`}
            >
              <CardContent className="py-3 px-3 sm:py-4 sm:px-6">
                <div className="text-xl sm:text-2xl font-bold">
                  <span className="sm:hidden">Ctrl {c.controllerLetter}</span>
                  <span className="hidden sm:inline">Controller {c.controllerLetter}</span>
                </div>
                <div className="text-xs text-gray-600">{c.zoneCount} zones</div>
                <div className="mt-2 text-xs flex gap-2 sm:gap-3 flex-wrap items-center">
                  <span className="text-green-700">✓ {ok}</span>
                  <span className="text-red-700">! {issues}</span>
                  <span className="text-gray-500">N/A {na}</span>
                  {findingCount > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-red-700 font-medium"
                      data-testid={`controller-${c.controllerLetter}-finding-count`}
                      aria-label={`${findingCount} work item${findingCount === 1 ? "" : "s"} on this controller`}
                    >
                      <Wrench className="w-3 h-3" aria-hidden />
                      {findingCount}
                    </span>
                  )}
                  {photoCount > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-gray-700"
                      data-testid={`controller-${c.controllerLetter}-photo-count`}
                      aria-label={`${photoCount} photo${photoCount === 1 ? "" : "s"} on this controller`}
                    >
                      <Camera className="w-3 h-3" aria-hidden />
                      {photoCount}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!isReadOnly && autoBillEnabled && (
        <FindingsByResolution
          findings={allFindings}
          zoneRecords={wcZoneRecords}
        />
      )}

      {!isReadOnly && completeNeedingDecision.length > 0 && (
        <button
          type="button"
          onClick={jumpToNextNeedsDecision}
          aria-label={
            completeNeedingDecision.length === 1
              ? "Jump to the finding marked complete without a part"
              : `Jump to the next of ${completeNeedingDecision.length} findings marked complete without a part`
          }
          className="block w-full text-left text-sm rounded border border-amber-300 bg-amber-50 p-3 text-amber-900 cursor-pointer hover:bg-amber-100 active:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 transition-colors"
          data-testid="submit-needs-part-or-no-part-hint"
        >
          {completeNeedingDecision.length} finding{completeNeedingDecision.length === 1 ? " is" : "s are"} marked complete without a part.
          Open {completeNeedingDecision.length === 1 ? "it" : "them"} and either pick a part or tick
          {" "}<span className="font-medium">No part needed (labor only)</span> before submitting.
        </button>
      )}

      {!isReadOnly && (
        <Button
          className="w-full min-h-[48px]"
          size="lg"
          onClick={() => {
            // Flag-off → restore Slice 2 plain-submit (no preview, no
            // confirm modal). The server enforces the same gate, so
            // this is purely a UX fallback for the tech.
            if (!autoBillEnabled) {
              submitMut.mutate();
              return;
            }
            // Submit-preview is a server-only call. Skip it when offline,
            // when the offline queue flag is on without an in-band probe,
            // or when we don't yet have a server id (clientId-only route);
            // queue the submit directly so the tech can complete the
            // capture flow without connectivity.
            const noServerId = (wc?.id ?? id) == null;
            if (noServerId || isProbablyOffline()) {
              submitMut.mutate();
              return;
            }
            previewMut.mutate();
          }}
          disabled={previewMut.isPending || submitMut.isPending || completeNeedingDecision.length > 0}
          data-testid="btn-submit-wet-check"
        >
          {(previewMut.isPending || submitMut.isPending) ? <Loader2 className="animate-spin" /> : submitCtaLabel}
        </Button>
      )}

      {/* Task #641 — Activity feed */}
      <div className="border rounded" data-testid="wet-check-activity-section">
        <div className="px-3 py-2 bg-gray-50 text-sm font-semibold border-b">
          Activity
        </div>
        <ActivityTab resource="wet-checks" id={wc?.id ?? null} />
      </div>

      {/* Submit-confirm modal — surfaces the server's preview of what
          will be auto-billed and what will land in the manager queue
          before the tech commits. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o && !submitMut.isPending) setConfirmOpen(false); }}>
        <DialogContent data-testid="submit-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {allFindings.length === 0
                ? "Submit — no issues found?"
                : dispositionNeedsReview === 0
                  ? "Submit — all work completed?"
                  : "Submit for manager review?"}
            </DialogTitle>
            <DialogDescription data-testid="submit-confirm-intent">
              {allFindings.length === 0
                ? "No findings recorded — this wet check will be marked complete."
                : dispositionNeedsReview === 0
                  ? `${dispositionCompleted} finding(s) marked completed in field.`
                  : `${dispositionNeedsReview} finding(s) flagged for manager review${dispositionCompleted > 0 ? `, ${dispositionCompleted} completed in field` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              {preview.autoBillEnabled ? (
                <div className="border rounded p-3" data-testid="preview-auto-billed">
                  <div className="font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Auto-billed now
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {preview.autoBilledCount} finding(s) marked complete · Parts ${preview.autoBilledPartsTotal} · Labor ${preview.autoBilledLaborTotal}
                  </div>
                  <div className="font-semibold mt-1" data-testid="preview-grand-total">
                    Total: ${preview.autoBilledGrandTotal}
                  </div>
                </div>
              ) : (
                <div className="border rounded p-3 bg-amber-50 border-amber-200" data-testid="preview-auto-bill-disabled">
                  <div className="font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Auto-billing disabled
                  </div>
                  <div className="text-xs text-gray-700 mt-1">
                    All findings (including ones marked complete) will be sent to the manager queue for routing.
                  </div>
                </div>
              )}
              {preview.pendingCount > 0 && (
                <div className="border rounded p-3" data-testid="preview-pending">
                  <div className="font-medium flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-600" />
                    Pending — sent to manager
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {preview.pendingCount} finding(s) need a routing decision
                  </div>
                  <div className="text-xs text-gray-600 mt-1 flex gap-3">
                    <span>Quick fix · {preview.pendingByGroup.quick_fix}</span>
                    <span>Advanced · {preview.pendingByGroup.advanced}</span>
                    <span>Zone · {preview.pendingByGroup.zone_issue}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitMut.isPending}
              data-testid="btn-submit-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => submitMut.mutate()}
              disabled={submitMut.isPending}
              data-testid="btn-submit-confirm"
            >
              {submitMut.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {preview && preview.autoBillEnabled && preview.autoBilledCount > 0
                ? "Submit & Bill"
                : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

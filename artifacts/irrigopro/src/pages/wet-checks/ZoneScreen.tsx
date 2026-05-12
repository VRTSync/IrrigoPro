import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, CheckCircle2, Wrench, MinusCircle, Trash2, Pencil } from "lucide-react";
import { apiRequest, asArray, parseApiError, queryClient, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { tintForControllerLetter } from "@/lib/lifecycle";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import {
  upsertZoneRecord as offlineUpsertZoneRecord,
  updateFinding as offlineUpdateFinding,
  deleteFinding as offlineDeleteFinding,
  enqueueZoneRevertCascade as offlineEnqueueZoneRevertCascade,
  cachedApiRequest,
} from "@/lib/offline/api";
import type {
  WetCheckWithDetails,
  WetCheckZoneRecord,
  WetCheckFinding,
  WetCheckPhoto,
  IssueTypeConfig,
} from "@workspace/db/schema";
import { newClientId } from "./helpers";
import { PropertyContextHeader } from "./PropertyContextHeader";
import { PhotoCaptureButton } from "./PhotoCaptureButton";
import { PhotoThumb } from "./PhotoThumb";
import { FindingSheet, type FindingSheetState } from "./FindingSheet";

// ─── Zone screen (YES/NO/N-A + findings + photos) ────────────────────────────

// Exported for tests (Task #511 regression). Production callers use this
// via the parent's render branch in WetCheckDetail; the parent always
// keys it by `${activeLetter}-${activeZone}` so each zone gets a fresh
// mount.
export function ZoneScreen({
  wetCheckId,
  wetCheckClientId,
  customerId,
  customerName,
  propertyAddress,
  letter,
  zoneNumber,
  zoneCount,
  zoneRecord,
  photos,
  readOnly,
  onBack,
  onAdvance,
}: {
  wetCheckId: number;
  wetCheckClientId: string | null;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  letter: string;
  zoneNumber: number;
  zoneCount: number;
  zoneRecord: (WetCheckZoneRecord & { findings: WetCheckFinding[] }) | undefined;
  photos: WetCheckPhoto[];
  readOnly: boolean;
  onBack: () => void;
  onAdvance: () => void;
}) {
  const { toast } = useToast();
  const [findingSheet, setFindingSheet] = useState<FindingSheetState>({ open: false });
  // Task #455 — revert from "Needs Work" back to "Ran OK" / "Skip" requires
  // an explicit confirm + cascade of finding + finding-photo deletes when
  // the zone has work attached. Tracks the pending target status until the
  // tech confirms.
  const [pendingRevert, setPendingRevert] = useState<
    null | { targetStatus: "checked_ok" | "not_applicable" }
  >(null);
  const [reverting, setReverting] = useState(false);
  // Slice 3 — flag-gated copy. With auto-bill OFF, we drop the
  // "auto-bills on submit" badge so the field UX matches Slice 2.
  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  // Task #512 — every revert path (setStatus + performRevert cascade) has
  // to update the same query rows the controller grid subscribes to, so a
  // Needs Work → Ran OK flip flips the tile color immediately and isn't
  // overwritten by a stale background refetch. The detail query lives
  // under TWO possible keys depending on whether the page was opened by
  // server id or by client id (`/c/:clientId` route), so both must be
  // invalidated and patched.
  const detailQueryKeys: ReadonlyArray<readonly unknown[]> = [
    ...(wetCheckId ? [["/api/wet-checks", wetCheckId] as const] : []),
    ...(wetCheckClientId ? [["/api/wet-checks", "c", wetCheckClientId] as const] : []),
  ];
  function applyOptimisticZoneStatus(
    nextStatus: "checked_ok" | "checked_with_issues" | "not_applicable",
  ): Array<{ key: readonly unknown[]; previous: WetCheckWithDetails | undefined }> {
    const snapshots: Array<{ key: readonly unknown[]; previous: WetCheckWithDetails | undefined }> = [];
    for (const key of detailQueryKeys) {
      const previous = queryClient.getQueryData<WetCheckWithDetails>(key);
      snapshots.push({ key, previous });
      if (!previous) continue;
      const matches = (zr: WetCheckZoneRecord) =>
        zr.controllerLetter === letter && zr.zoneNumber === zoneNumber;
      queryClient.setQueryData<WetCheckWithDetails>(key, {
        ...previous,
        zoneRecords: asArray(previous.zoneRecords).map((zr) =>
          matches(zr)
            ? {
                ...zr,
                status: nextStatus,
                ranSuccessfully:
                  nextStatus === "checked_ok"
                    ? true
                    : nextStatus === "checked_with_issues"
                    ? false
                    : null,
                // Mirror the server's force-clear rule so a tile that was
                // both red AND green-checked (Needs Work + Mark Complete)
                // never carries the overlay over to a reverted Ran OK /
                // Skip tile.
                markedCompleteAt: nextStatus === "checked_with_issues" ? zr.markedCompleteAt : null,
              }
            : zr,
        ),
      });
    }
    return snapshots;
  }
  function rollbackOptimisticZoneStatus(
    snapshots: ReadonlyArray<{ key: readonly unknown[]; previous: WetCheckWithDetails | undefined }>,
  ) {
    for (const { key, previous } of snapshots) {
      if (previous) queryClient.setQueryData(key, previous);
    }
  }
  function invalidateDetailQueries() {
    for (const key of detailQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
  }

  const setStatus = useMutation({
    mutationFn: (status: "checked_ok" | "checked_with_issues" | "not_applicable") => {
      const clientId = zoneRecord?.clientId ?? newClientId();
      const checkedAt = new Date().toISOString();
      // Online: behaves identically to before. Offline: queues the write
      // through the offline engine and updates the IndexedDB mirror so the
      // page survives a refresh while the tech is still in airplane mode.
      if (isOfflineQueueEnabled() && wetCheckClientId) {
        return offlineUpsertZoneRecord({
          wetCheckClientId,
          wetCheckId,
          controllerLetter: letter,
          zoneNumber,
          status,
          ranSuccessfully: status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
          notes: null,
          checkedAt,
          clientId,
        });
      }
      return apiRequest(`/api/wet-checks/${wetCheckId}/zone-records`, "POST", {
        controllerLetter: letter,
        zoneNumber,
        status,
        ranSuccessfully: status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
        checkedAt,
        clientId,
      });
    },
    onMutate: async (status) => {
      // Task #512 — optimistically flip the zone in the cached detail
      // payload BEFORE any await. The controller-grid tile reads
      // `wc.zoneRecords[i].status` from this same query, so this makes
      // a Needs Work → Ran OK / Skip flip turn the tile green/gray
      // immediately and survive the offline mirror writeback.
      await Promise.all(
        detailQueryKeys.map((k) => queryClient.cancelQueries({ queryKey: k })),
      );
      const snapshots = applyOptimisticZoneStatus(status);
      return { snapshots };
    },
    onError: (e: any, _status, ctx) => {
      if (ctx?.snapshots) rollbackOptimisticZoneStatus(ctx.snapshots);
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    },
    onSuccess: (_data, status) => {
      // Auto-advance to the next zone unless the tech needs to add findings.
      if (status === "checked_ok" || status === "not_applicable") {
        setTimeout(() => onAdvance(), 250);
      }
    },
    onSettled: () => {
      invalidateDetailQueries();
    },
  });

  const { data: issueTypes = [] } = useArrayQuery<IssueTypeConfig>({
    queryKey: ["/api/wet-checks/issue-types"],
    queryFn: () => cachedApiRequest(`/api/wet-checks/issue-types`),
  });

  // Task #518 — optimistic remove + rollback toast. Previously the server
  // could respond 200 `{ ok: false }` when the finding was non-pending,
  // which apiRequest treats as success and the mutation silently
  // ignored — the trash icon appeared to do nothing. The server now
  // returns 4xx on refusal (404 / 409 with a reason); we surface the
  // failure to the tech and put the row back where it was.
  const deleteFindingQueryKey: readonly unknown[] = ["/api/wet-checks", wetCheckId];
  type DeleteFindingCtx = { previous: WetCheckWithDetails | undefined };
  // Type guard for the legacy `{ ok: false, message?: string }` response
  // shape — keeps us off `any` casts in the mutation body.
  function isLegacyOkFalse(v: unknown): v is { ok: false; message?: string } {
    return (
      typeof v === "object" &&
      v !== null &&
      "ok" in v &&
      (v as { ok: unknown }).ok === false
    );
  }
  const deleteFindingMut = useMutation<unknown, Error, { id: number; clientId: string | null }, DeleteFindingCtx>({
    mutationFn: async (f) => {
      if (isOfflineQueueEnabled() && f.clientId) {
        await offlineDeleteFinding(f.clientId, f.id);
        return { ok: true };
      }
      const res = await apiRequest(`/api/wet-checks/findings/${f.id}`, "DELETE");
      // Defensive: pre-Task-#518 servers (or a future regression) could
      // return HTTP 200 `{ ok: false }`. Treat that as a refusal so the
      // onError rollback runs and the tech sees a toast instead of a
      // ghost-deleted finding.
      if (isLegacyOkFalse(res)) {
        throw new Error(
          typeof res.message === "string" && res.message.length > 0
            ? res.message
            : "Couldn't delete finding — please retry",
        );
      }
      return res ?? { ok: true };
    },
    onMutate: async (vars) => {
      // Optimistic remove: drop the finding (and any photos linked to it)
      // from the cached wet check so the trash icon feels instant.
      await queryClient.cancelQueries({ queryKey: deleteFindingQueryKey });
      const previous = queryClient.getQueryData<WetCheckWithDetails>(deleteFindingQueryKey);
      if (previous) {
        queryClient.setQueryData<WetCheckWithDetails>(deleteFindingQueryKey, {
          ...previous,
          zoneRecords: asArray(previous.zoneRecords).map((zr) => ({
            ...zr,
            findings: asArray(zr.findings).filter((f) => f.id !== vars.id),
          })),
          photos: asArray(previous.photos).filter((p) => p.findingId !== vars.id),
        });
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      // Rollback first so the row reappears, then surface the reason.
      if (ctx?.previous) {
        queryClient.setQueryData(deleteFindingQueryKey, ctx.previous);
      }
      const fallback = e instanceof Error && e.message ? e.message : "Please try again.";
      toast({
        title: "Couldn't delete finding",
        description: parseApiError(e, fallback),
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });

  // Task #455 — counts of findings + finding-level photos used by both the
  // "is revert destructive?" gate on the status buttons and the body copy
  // of the confirmation dialog.
  const findings = asArray(zoneRecord?.findings);
  const findingIds = new Set(findings.map((f) => f.id));
  const findingPhotos = photos.filter(
    (p) => p.findingId != null && findingIds.has(p.findingId),
  );
  const hasAttachedWork = findings.length > 0 || findingPhotos.length > 0;

  // Cascade: delete each finding's photos, reset any non-pending findings
  // back to pending so the server's deleteWetCheckFinding allows the row
  // through, delete every finding, then flip the zone status. Order matters
  // — flipping status first would leave the zone briefly readable as
  // "Ran OK with findings" (the inconsistent state the spec calls out).
  //
  // Online path: sequential awaits enforce order naturally.
  // Offline path: a single `enqueueZoneRevertCascade` queues every step
  // with explicit `parentClientIds` chaining so the sync engine (which
  // dispatches up to 2 mutations concurrently) cannot reorder photo
  // deletes / finding patches / finding deletes / status flip during
  // replay.
  async function performRevert(target: "checked_ok" | "not_applicable") {
    setReverting(true);
    // Task #512 — flip the cached zone status before kicking off the
    // cascade so the controller grid re-renders the new color (green /
    // gray) immediately, even while the photo-delete / finding-delete /
    // status-flip mutations are still draining in the background. The
    // offline mirror is updated transitively by `enqueueZoneRevertCascade`
    // (the synchronous `putZoneRecordMirror` near the end of the cascade);
    // optimistic snapshots cover the online cascade path too.
    await Promise.all(
      detailQueryKeys.map((k) => queryClient.cancelQueries({ queryKey: k })),
    );
    const optimisticSnapshots = applyOptimisticZoneStatus(target);
    try {
      if (isOfflineQueueEnabled() && wetCheckClientId && zoneRecord?.clientId) {
        // Bucket photos by finding server id (works for both
        // clientId-having and legacy clientId-less findings).
        const photosByFindingId = new Map<number, number[]>();
        for (const p of findingPhotos) {
          if (!p.findingId) continue;
          const arr = photosByFindingId.get(p.findingId) ?? [];
          arr.push(p.id);
          photosByFindingId.set(p.findingId, arr);
        }
        await offlineEnqueueZoneRevertCascade({
          wetCheckClientId,
          wetCheckId,
          zoneRecordClientId: zoneRecord.clientId,
          zoneRecordId: zoneRecord.id,
          controllerLetter: letter,
          zoneNumber,
          targetStatus: target,
          findings: findings.map((f) => ({
            id: f.id,
            clientId: f.clientId ?? null,
            needsResetToPending: f.resolution !== "pending",
            photoIds: photosByFindingId.get(f.id) ?? [],
          })),
        });
      } else {
        // Online cascade — sequential awaits.
        for (const p of findingPhotos) {
          await apiRequest(`/api/wet-checks/photos/${p.id}`, "DELETE");
        }
        for (const f of findings) {
          if (f.resolution === "pending") continue;
          await apiRequest(`/api/wet-checks/findings/${f.id}`, "PATCH", { repairedInField: false });
        }
        for (const f of findings) {
          await apiRequest(`/api/wet-checks/findings/${f.id}`, "DELETE");
        }
        await new Promise<void>((resolve, reject) => {
          setStatus.mutate(target, {
            onSuccess: () => resolve(),
            onError: (e) => reject(e),
          });
        });
      }
      setPendingRevert(null);
    } catch (e: any) {
      // Roll back the optimistic green/gray flip so the tile returns to
      // its prior red state instead of misleading the tech that the
      // revert succeeded.
      rollbackOptimisticZoneStatus(optimisticSnapshots);
      toast({ title: "Couldn't reset zone", description: e?.message, variant: "destructive" });
    } finally {
      setReverting(false);
      // Invalidate the specific detail keys (server id + clientId) so the
      // grid re-reads the just-updated mirror / server snapshot. On
      // failure we still invalidate so any partially-applied state is
      // pulled fresh from the server.
      invalidateDetailQueries();
    }
  }

  // Decide whether to show the confirm dialog before flipping status.
  function handleStatusClick(next: "checked_ok" | "checked_with_issues" | "not_applicable") {
    const current = zoneRecord?.status;
    const isLeavingNeedsWork = current === "checked_with_issues" && next !== "checked_with_issues";
    if (isLeavingNeedsWork && hasAttachedWork) {
      setPendingRevert({ targetStatus: next as "checked_ok" | "not_applicable" });
      return;
    }
    setStatus.mutate(next);
  }

  // Task #428 — per-finding tech disposition (always visible regardless of
  // WET_CHECK_AUTO_BILL). Patches `techDisposition` on the finding so the
  // tech's intent survives manager rerouting downstream.
  // Task #454 — added optimistic update so the toggle visibly flips on tap
  // even before the PATCH (or queued mutation) finishes draining, plus a
  // proper revert + toast when the request fails so a silent failure
  // can no longer make the button look broken.
  const dispositionQueryKey: readonly unknown[] = ["/api/wet-checks", wetCheckId];
  const dispositionMut = useMutation({
    mutationFn: async (vars: {
      id: number;
      clientId: string | null;
      disposition: "completed_in_field" | "needs_review";
    }) => {
      const patch = { techDisposition: vars.disposition };
      if (isOfflineQueueEnabled() && vars.clientId) {
        await offlineUpdateFinding(vars.clientId, vars.id, patch);
        return;
      }
      await apiRequest(`/api/wet-checks/findings/${vars.id}`, "PATCH", patch);
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: dispositionQueryKey });
      const previous = queryClient.getQueryData<WetCheckWithDetails>(dispositionQueryKey);
      if (previous) {
        queryClient.setQueryData<WetCheckWithDetails>(dispositionQueryKey, {
          ...previous,
          zoneRecords: asArray(previous.zoneRecords).map((zr) => ({
            ...zr,
            findings: asArray(zr.findings).map((f) =>
              f.id === vars.id ? { ...f, techDisposition: vars.disposition } : f,
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(dispositionQueryKey, ctx.previous);
      }
      toast({
        title: "Couldn't update disposition",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });

  // Task #454 — Mark Zone Complete from the Needs Work flow. The zone has
  // already been moved to `checked_with_issues` by tapping Needs Work, so
  // this is purely a wizard-advance: it reuses the same `onAdvance()` path
  // as Ran OK / Skip without touching the zone status. If the tech hasn't
  // logged any findings yet, we surface a tiny inline confirm so a stray
  // tap doesn't lose context.
  // Task #458 — also persist a `markedCompleteAt` timestamp on the zone so
  // the controller grid can render a check-mark overlay on Needs Work tiles
  // the tech has already reviewed-and-confirmed (vs. ones still mid-edit).
  // The state survives refresh because it lives on the zone record row.
  const [confirmMarkComplete, setConfirmMarkComplete] = useState(false);
  const findingsCount = asArray(zoneRecord?.findings).length;
  const markCompleteMut = useMutation({
    mutationFn: async () => {
      const markedAt = new Date().toISOString();
      // Online + offline both share the upsert path, which dedupes by
      // (wetCheckId, controllerLetter, zoneNumber) so this re-stamps the
      // existing row without creating a duplicate.
      if (isOfflineQueueEnabled() && wetCheckClientId) {
        await offlineUpsertZoneRecord({
          wetCheckClientId,
          wetCheckId,
          controllerLetter: letter,
          zoneNumber,
          status: "checked_with_issues",
          ranSuccessfully: false,
          notes: zoneRecord?.notes ?? null,
          checkedAt: zoneRecord?.checkedAt
            ? new Date(zoneRecord.checkedAt).toISOString()
            : markedAt,
          markedCompleteAt: markedAt,
          clientId: zoneRecord?.clientId ?? undefined,
        });
        return;
      }
      if (zoneRecord?.id) {
        await apiRequest(`/api/wet-checks/zone-records/${zoneRecord.id}`, "PATCH", {
          markedCompleteAt: markedAt,
        });
      }
    },
    onMutate: async () => {
      // Optimistic flip so the badge appears immediately on advance.
      const key = ["/api/wet-checks", wetCheckId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WetCheckWithDetails>(key);
      const stamp = new Date();
      if (previous && zoneRecord) {
        // Match by server id when present, otherwise by clientId — avoids
        // false-positive flips on unsynced offline rows whose id is still
        // undefined.
        const matches = (zr: WetCheckZoneRecord) =>
          zoneRecord.id != null
            ? zr.id === zoneRecord.id
            : zr.clientId != null && zr.clientId === zoneRecord.clientId;
        queryClient.setQueryData<WetCheckWithDetails>(key, {
          ...previous,
          zoneRecords: asArray(previous.zoneRecords).map((zr) =>
            matches(zr) ? { ...zr, markedCompleteAt: stamp } : zr,
          ),
        });
      }
      return { previous };
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["/api/wet-checks", wetCheckId], ctx.previous);
      }
      toast({
        title: "Couldn't mark zone complete",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });
  const handleMarkZoneComplete = () => {
    if (findingsCount === 0 && !confirmMarkComplete) {
      setConfirmMarkComplete(true);
      return;
    }
    setConfirmMarkComplete(false);
    markCompleteMut.mutate();
    onAdvance();
  };
  // Reset the inline confirm when the tech navigates to a different zone
  // (ZoneScreen is reused across zone numbers, so local state otherwise
  // leaks between visits).
  useEffect(() => {
    setConfirmMarkComplete(false);
  }, [zoneRecord?.id, zoneNumber, letter]);

  return (
    <div className="max-w-2xl mx-auto py-4 space-y-4 px-3 sm:px-4 pb-safe">
      <PropertyContextHeader
        customerName={customerName}
        propertyAddress={propertyAddress}
        controllerLetter={letter}
        zoneNumber={zoneNumber}
      />
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Zone Grid
      </Button>
      <Card className="overflow-hidden">
        {(() => {
          const tint = tintForControllerLetter(letter);
          const statusLabel =
            zoneRecord?.status === "checked_ok" ? "Ran OK" :
            zoneRecord?.status === "checked_with_issues" ? "Needs Work" :
            zoneRecord?.status === "not_applicable" ? "Skipped" :
            "Not Checked";
          const statusPillCls =
            zoneRecord?.status === "checked_ok" ? "bg-green-100 text-green-900 border-green-300" :
            zoneRecord?.status === "checked_with_issues" ? "bg-red-100 text-red-900 border-red-300" :
            zoneRecord?.status === "not_applicable" ? "bg-gray-100 text-gray-800 border-gray-300" :
            "bg-white text-gray-700 border-gray-300";
          return (
            <div
              className={`${tint.band} border-b-4 ${tint.border} px-4 py-3 sm:py-4`}
              data-testid="zone-identity-band"
              data-controller-letter={letter}
              data-zone-number={zoneNumber}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`${tint.letterBg} ${tint.letterText} rounded-lg px-3 py-2 text-3xl sm:text-4xl font-extrabold leading-none shrink-0 shadow-sm`}
                    aria-label={`Controller ${letter}`}
                    data-testid="zone-identity-controller"
                  >
                    {letter}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[11px] uppercase tracking-wider font-semibold ${tint.label}`}>
                      Controller {letter} · Zone
                    </div>
                    <div
                      className={`${tint.zoneText} text-4xl sm:text-5xl font-black leading-none tabular-nums`}
                      data-testid="zone-identity-number"
                    >
                      {zoneNumber}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Badge
                    className={`${statusPillCls} text-xs font-semibold border`}
                    data-testid="zone-identity-status"
                  >
                    {statusLabel}
                  </Badge>
                  {!readOnly && zoneRecord && (
                    <PhotoCaptureButton
                      wetCheckId={wetCheckId}
                      wetCheckClientId={wetCheckClientId}
                      zoneRecordId={zoneRecord.id}
                      zoneRecordClientId={zoneRecord.clientId ?? null}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        <CardContent className="space-y-4 pt-4">
          {!readOnly && (
            <>
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <Button
                  variant={zoneRecord?.status === "checked_ok" ? "default" : "outline"}
                  className={`min-h-[48px] px-2 text-xs sm:text-sm ${zoneRecord?.status === "checked_ok" ? "bg-green-600" : ""}`}
                  onClick={() => handleStatusClick("checked_ok")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-yes"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1 shrink-0" />
                  <span className="sm:hidden">OK</span>
                  <span className="hidden sm:inline">Ran OK</span>
                </Button>
                <Button
                  variant={zoneRecord?.status === "checked_with_issues" ? "default" : "outline"}
                  className={`min-h-[48px] px-2 text-xs sm:text-sm ${zoneRecord?.status === "checked_with_issues" ? "bg-red-600" : ""}`}
                  onClick={() => handleStatusClick("checked_with_issues")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-no"
                >
                  <Wrench className="w-4 h-4 mr-1 shrink-0" />
                  <span className="sm:hidden">Issue</span>
                  <span className="hidden sm:inline">Needs Work</span>
                </Button>
                <Button
                  variant={zoneRecord?.status === "not_applicable" ? "default" : "outline"}
                  className={`min-h-[48px] px-2 text-xs sm:text-sm ${zoneRecord?.status === "not_applicable" ? "bg-gray-500" : ""}`}
                  onClick={() => handleStatusClick("not_applicable")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-na"
                >
                  <MinusCircle className="w-4 h-4 mr-1 shrink-0" />
                  <span className="sm:hidden">N/A</span>
                  <span className="hidden sm:inline">Skip / Not Applicable</span>
                </Button>
              </div>
              {(!zoneRecord || zoneRecord.status === "not_checked") && (
                <div className="text-xs text-gray-500" data-testid="needs-work-helper">
                  Tap <span className="font-semibold">Needs Work</span> to add parts, labor, and notes for this zone.
                </div>
              )}
              {zoneRecord?.status === "checked_with_issues" && (
                <div className="space-y-2" data-testid="mark-zone-complete-row">
                  {confirmMarkComplete && (
                    <div
                      className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2"
                      data-testid="mark-zone-complete-confirm"
                    >
                      No work added — mark this zone complete anyway? Tap again to confirm.
                    </div>
                  )}
                  <Button
                    type="button"
                    className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={handleMarkZoneComplete}
                    disabled={setStatus.isPending}
                    data-testid="btn-mark-zone-complete"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />
                    {confirmMarkComplete ? "Confirm — Mark Zone Complete" : "Mark Zone Complete"}
                  </Button>
                </div>
              )}
            </>
          )}
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1" data-testid="zone-photos">
              {photos.map(p => <PhotoThumb key={p.id} photo={p} canDelete={!readOnly} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issue presets — grouped by Quick Fixes / Advanced / Zone Issues */}
      {zoneRecord && !readOnly && zoneRecord.status === "checked_with_issues" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Add work for this zone</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(["quick_fix", "advanced", "zone_issue"] as const).map(group => {
              const groupItems = issueTypes.filter(i => i.issueGroup === group);
              if (groupItems.length === 0) return null;
              const heading =
                group === "quick_fix" ? "Quick Fixes" :
                group === "advanced" ? "Advanced" : "Zone Issues";
              return (
                <div key={group} data-testid={`preset-group-${group}`}>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{heading}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {groupItems.map(it => (
                      <Button
                        key={it.issueType}
                        variant="outline"
                        size="sm"
                        onClick={() => setFindingSheet({ open: true, mode: "create", issueType: it.issueType })}
                        data-testid={`preset-${it.issueType}`}
                      >
                        {it.displayLabel}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Existing findings */}
      {zoneRecord && asArray(zoneRecord.findings).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Work added to this zone</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {asArray(zoneRecord.findings).map(f => (
              <div key={f.id} className="border rounded p-2" data-testid={`finding-${f.id}`}>
                <div className="flex items-start justify-between">
                  <div className="text-sm">
                    <div className="font-medium">{f.issueType.replace(/_/g, " ")}</div>
                    <div className="text-xs text-gray-500">
                      {f.partName ?? "no part"} · qty {f.quantity} · {f.laborHours}h
                      {f.partPrice ? ` · $${f.partPrice}` : ""}
                    </div>
                    {f.notes && <div className="text-xs italic">{f.notes}</div>}
                    {f.resolution === "repaired_in_field" && (
                      <Badge variant="secondary" className="mt-1" data-testid={`finding-complete-badge-${f.id}`}>
                        {autoBillEnabled
                          ? "Wet check work completed in field · auto-bills on submit"
                          : "Wet check work completed in field"}
                      </Badge>
                    )}
                    {/* Task #428 — always-visible tech disposition. Decoupled
                        from WET_CHECK_AUTO_BILL and from `resolution`: this
                        captures intent only, with no billing side-effects.
                        Shown for every editable finding regardless of whether
                        Mark Complete (repaired_in_field) is on. */}
                    {!readOnly && (
                      <div
                        className="mt-2 inline-flex rounded-md border overflow-hidden"
                        role="group"
                        aria-label="Tech disposition"
                        data-testid={`finding-disposition-${f.id}`}
                      >
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs ${
                            f.techDisposition === "completed_in_field"
                              ? "bg-green-600 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                          onClick={() => dispositionMut.mutate({
                            id: f.id,
                            clientId: f.clientId ?? null,
                            disposition: "completed_in_field",
                          })}
                          disabled={dispositionMut.isPending}
                          data-testid={`finding-disposition-${f.id}-completed`}
                        >
                          Completed in field
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs border-l ${
                            f.techDisposition !== "completed_in_field"
                              ? "bg-amber-500 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                          onClick={() => dispositionMut.mutate({
                            id: f.id,
                            clientId: f.clientId ?? null,
                            disposition: "needs_review",
                          })}
                          disabled={dispositionMut.isPending}
                          data-testid={`finding-disposition-${f.id}-review`}
                        >
                          Needs manager review
                        </button>
                      </div>
                    )}
                    {readOnly && f.techDisposition && (
                      <Badge
                        variant="outline"
                        className={`mt-1 ${
                          f.techDisposition === "completed_in_field"
                            ? "border-green-300 text-green-700 bg-green-50"
                            : "border-amber-300 text-amber-700 bg-amber-50"
                        }`}
                        data-testid={`finding-disposition-badge-${f.id}`}
                      >
                        {f.techDisposition === "completed_in_field"
                          ? "Completed in field"
                          : "Needs manager review"}
                      </Badge>
                    )}
                  </div>
                  {!readOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        onClick={() => setFindingSheet({ open: true, mode: "edit", finding: f })}
                        data-testid={`edit-finding-${f.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <PhotoCaptureButton
                        wetCheckId={wetCheckId}
                        wetCheckClientId={wetCheckClientId}
                        zoneRecordId={zoneRecord.id}
                        zoneRecordClientId={zoneRecord.clientId ?? null}
                        findingId={f.id}
                        findingClientId={f.clientId ?? null}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        onClick={() => deleteFindingMut.mutate({ id: f.id, clientId: f.clientId ?? null })}
                        data-testid={`delete-finding-${f.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  )}
                </div>
                {(() => {
                  const fp = photos.filter(p => p.findingId === f.id);
                  if (fp.length === 0) return null;
                  return (
                    <div className="flex flex-wrap gap-2 pt-2" data-testid={`finding-photos-${f.id}`}>
                      {fp.map(p => <PhotoThumb key={p.id} photo={p} canDelete={!readOnly} />)}
                    </div>
                  );
                })()}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <FindingSheet
        state={findingSheet}
        onClose={() => setFindingSheet({ open: false })}
        zoneRecordId={zoneRecord?.id ?? null}
        zoneRecordClientId={zoneRecord?.clientId ?? null}
        wetCheckId={wetCheckId}
        wetCheckClientId={wetCheckClientId}
        customerId={customerId}
        photos={photos}
        readOnly={readOnly}
      />

      {/* Task #455 — confirm before reverting Needs Work → Ran OK / Skip
          when the zone has work attached. Cancel = no changes. */}
      <Dialog
        open={pendingRevert !== null}
        onOpenChange={(open) => { if (!open && !reverting) setPendingRevert(null); }}
      >
        <DialogContent data-testid="revert-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Clear work for this zone?</DialogTitle>
            <DialogDescription>
              Switching this zone to{" "}
              <span className="font-semibold">
                {pendingRevert?.targetStatus === "checked_ok" ? "Ran OK" : "Skip / Not Applicable"}
              </span>{" "}
              will remove {findings.length} work item{findings.length === 1 ? "" : "s"}
              {findingPhotos.length > 0
                ? ` and ${findingPhotos.length} photo${findingPhotos.length === 1 ? "" : "s"}`
                : ""}{" "}
              attached to this zone. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingRevert(null)}
              disabled={reverting}
              data-testid="revert-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => { if (pendingRevert) performRevert(pendingRevert.targetStatus); }}
              disabled={reverting}
              data-testid="revert-confirm"
            >
              {reverting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Remove work and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

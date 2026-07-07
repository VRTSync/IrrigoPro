import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Loader2, ChevronLeft, ChevronRight, CheckCircle2, Wrench, MinusCircle,
  Trash2, Pencil, Camera, ChevronDown, ChevronUp, LayoutGrid, Plus,
} from "lucide-react";
import { countFindingPhotos } from "@/lib/wet-check-photos";
import { apiRequest, asArray, parseApiError, queryClient, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { tintForControllerLetter } from "@workspace/shared";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import {
  upsertZoneRecord as offlineUpsertZoneRecord,
  updateFinding as offlineUpdateFinding,
  deleteFinding as offlineDeleteFinding,
  createFinding as offlineCreateFinding,
  enqueueZoneRevertCascade as offlineEnqueueZoneRevertCascade,
  patchZoneRecordRepairLabor as offlinePatchZoneRecordRepairLabor,
  patchZoneRecordReadings as offlinePatchZoneRecordReadings,
  linkPhotoToFinding as offlineLinkPhotoToFinding,
  cachedApiRequest,
} from "@/lib/offline/api";
import { LaborHoursStepper } from "@/components/ui/labor-hours-stepper";
import { buildFindingSavePayload, CUSTOM_REVIEW_ISSUE_TYPE } from "@/lib/finding-save-payload";
import { openOfflineDB, putFindingMirror } from "@/lib/offline/db";
import type {
  WetCheckWithDetails,
  WetCheckZoneRecord,
  WetCheckFinding,
  WetCheckPhoto,
  IssueTypeConfig,
  Part,
} from "@workspace/db/schema";
import { newClientId } from "./helpers";
import { PhotoCaptureButton } from "./PhotoCaptureButton";
import { PhotoThumb } from "./PhotoThumb";
import { LoosePhotosSection } from "./LoosePhotosSection";

// ─── Inline finding editor ────────────────────────────────────────────────────

function InlineFindingEditor({
  issueType,
  editing,
  zoneRecordId,
  zoneRecordClientId,
  wetCheckId,
  wetCheckClientId,
  customerId,
  photos,
  readOnly,
  wetCheckMode,
  onSaved,
  onCancel,
  onSwitchToCustom,
}: {
  issueType: string;
  editing: WetCheckFinding | null;
  zoneRecordId: number | null;
  zoneRecordClientId: string | null;
  wetCheckId: number;
  wetCheckClientId: string | null;
  customerId: number;
  photos: WetCheckPhoto[];
  readOnly: boolean;
  wetCheckMode?: "service" | "inspection";
  onSaved: () => void;
  onCancel: () => void;
  onSwitchToCustom?: (prefillNotes: string) => void;
}) {
  const { toast } = useToast();
  const mode = editing ? "edit" : "create";

  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partFromEdit, setPartFromEdit] = useState<{ id: number | null; name: string | null; price: string | null } | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [laborHours, setLaborHours] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [repairedInField, setRepairedInField] = useState<boolean>(false);
  const [noPartNeeded, setNoPartNeeded] = useState<boolean>(false);

  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  const { data: configs = [] } = useArrayQuery<IssueTypeConfig>({
    queryKey: ["/api/wet-checks/issue-types"],
    queryFn: () => cachedApiRequest("/api/wet-checks/issue-types"),
  });
  const cfg = configs.find((c) => c.issueType === issueType);

  useEffect(() => {
    if (editing) {
      setSelectedPart(null);
      setPartFromEdit({
        id: editing.partId ?? null,
        name: editing.partName ?? null,
        price: editing.partPrice ?? null,
      });
      setQuantity(String(editing.quantity ?? 1));
      setLaborHours(editing.laborHours ?? "0");
      setNotes(editing.notes ?? "");
      setRepairedInField(editing.resolution === "repaired_in_field");
      setNoPartNeeded(Boolean(editing.noPartNeeded));
    } else {
      setSelectedPart(null);
      setPartFromEdit(null);
      setQuantity("1");
      setLaborHours(cfg?.defaultLaborHours ?? "0");
      setNotes("");
      setRepairedInField(false);
      setNoPartNeeded(false);
    }
    setSearch("");
  }, [editing?.id, cfg?.defaultLaborHours]);

  const { data: partsResp } = useQuery<{ parts: Part[]; recentPartIds: number[] }>({
    queryKey: ["/api/wet-checks/parts/by-issue", issueType, customerId],
    queryFn: () =>
      cachedApiRequest(
        `/api/wet-checks/parts/by-issue?issueType=${encodeURIComponent(issueType)}&customerId=${customerId}`,
      ),
    enabled: !!issueType,
  });
  const partsList = partsResp?.parts ?? [];
  const recentSet = useMemo(() => new Set(partsResp?.recentPartIds ?? []), [partsResp?.recentPartIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partsList.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [partsList, search]);

  const recentParts = filtered.filter((p) => recentSet.has(p.id)).slice(0, 8);
  const otherParts = filtered.filter((p) => !recentSet.has(p.id)).slice(0, 40);

  const hasPartSelected = (selectedPart?.id ?? partFromEdit?.id ?? null) != null;
  useEffect(() => {
    if (hasPartSelected && noPartNeeded) setNoPartNeeded(false);
  }, [hasPartSelected, noPartNeeded]);

  // A finding is billable when a part is selected, "no part needed" is checked,
  // or the issue type is inherently labor-only.
  const canAutoBill = !!(cfg?.laborOnly || hasPartSelected || noPartNeeded);

  // For service-mode (non-inspection) findings, Save is blocked until the tech
  // marks the finding complete AND it is billable. Inspection-mode findings are
  // saved as assessments only — the billability gate does not apply there.
  const isSaveBlocked = wetCheckMode !== "inspection" && !(repairedInField && canAutoBill);

  const saveMut = useMutation<{ id: number; clientId: string }, Error, void>({
    mutationFn: async () => {
      const payload = buildFindingSavePayload({
        selectedPart,
        partFromEdit,
        quantity,
        laborHours,
        notes,
        repairedInField,
        noPartNeeded,
      });
      if (mode === "edit" && editing) {
        if (isOfflineQueueEnabled() && editing.clientId) {
          await offlineUpdateFinding(editing.clientId, editing.id, payload);
          return { id: editing.id, clientId: editing.clientId };
        }
        const updated = await apiRequest(`/api/wet-checks/findings/${editing.id}`, "PATCH", payload);
        return { id: updated.id ?? editing.id, clientId: updated.clientId ?? editing.clientId ?? "" };
      }
      // Create path
      const findingClientId = newClientId();
      let createdId: number | null = null;
      if (isOfflineQueueEnabled() && zoneRecordClientId) {
        const res = await offlineCreateFinding({
          zoneRecordClientId,
          zoneRecordId: zoneRecordId ?? undefined,
          wetCheckId,
          payload: { ...payload, issueType },
          clientId: findingClientId,
        });
        createdId = res.id ?? null;
      } else {
        const created = await apiRequest(
          `/api/wet-checks/zone-records/${zoneRecordId}/findings`,
          "POST",
          { ...payload, issueType, clientId: findingClientId },
        );
        createdId = created?.id ?? null;
        if (isOfflineQueueEnabled() && createdId != null) {
          const db = await openOfflineDB();
          await putFindingMirror(db, {
            clientId: findingClientId,
            id: createdId,
            zoneRecordClientId: zoneRecordClientId ?? `server-zr-${zoneRecordId}`,
            zoneRecordId: zoneRecordId ?? undefined,
            wetCheckId,
            data: { ...payload, id: createdId, clientId: findingClientId, issueType },
            updatedAt: Date.now(),
          });
        }
      }
      return { id: createdId ?? 0, clientId: findingClientId };
    },
    onSuccess: (data) => {
      // Immediate cache write so the finding appears without waiting for the
      // background refetch (same pattern as deleteFindingMut.onMutate).
      const payload = buildFindingSavePayload({
        selectedPart,
        partFromEdit,
        quantity,
        laborHours,
        notes,
        repairedInField,
        noPartNeeded,
      });
      // When the offline queue queues the write without a server round-trip,
      // the mutationFn returns id=0 (no confirmed id yet). Use a stable
      // negative integer derived from the clientId UUID so multiple queued
      // findings never share the same id in the cache. Real server ids are
      // always positive, so negatives will never collide.
      const stableId =
        data.id > 0
          ? data.id
          : -parseInt(data.clientId.replace(/-/g, "").slice(0, 8), 16);
      const optimisticFinding: WetCheckFinding = {
        id: stableId,
        clientId: data.clientId,
        zoneRecordId: zoneRecordId ?? 0,
        wetCheckId,
        issueType,
        issueGroup: cfg?.issueGroup ?? "",
        severity: null,
        partId: payload.partId,
        partName: payload.partName,
        partPrice: payload.partPrice,
        quantity: payload.quantity,
        laborHours: payload.laborHours,
        notes: payload.notes,
        resolution: repairedInField ? "repaired_in_field" : "pending",
        noPartNeeded: payload.noPartNeeded,
        techDisposition: payload.techDisposition,
        resolutionDecidedAt: null,
        resolutionDecidedBy: null,
        billingSheetId: null,
        estimateId: null,
        workOrderId: null,
        wetCheckBillingId: null,
        convertedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const cacheKeys: readonly unknown[][] = [
        ["/api/wet-checks", wetCheckId],
        ...(wetCheckClientId ? [["/api/wet-checks", "c", wetCheckClientId]] : []),
      ];
      for (const key of cacheKeys) {
        const current = queryClient.getQueryData<WetCheckWithDetails>(key);
        if (!current) continue;
        queryClient.setQueryData<WetCheckWithDetails>(key, {
          ...current,
          zoneRecords: asArray(current.zoneRecords).map((zr) => {
            const isTarget =
              zoneRecordId != null ? zr.id === zoneRecordId : zoneRecordClientId != null && zr.clientId === zoneRecordClientId;
            if (!isTarget) return zr;
            const prevFindings = asArray(zr.findings);
            return {
              ...zr,
              findings:
                mode === "edit" && editing
                  ? prevFindings.map((f) =>
                      (editing.clientId && f.clientId
                        ? f.clientId === editing.clientId
                        : f.id === editing.id)
                        ? { ...f, ...optimisticFinding }
                        : f,
                    )
                  : [...prevFindings, optimisticFinding],
            };
          }),
        });
      }

      toast({ title: mode === "edit" ? "Finding updated" : "Finding added" });
      onSaved();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const renderPartButton = (p: Part) => {
    const effId = selectedPart?.id ?? partFromEdit?.id ?? null;
    const isSel = effId === p.id;
    return (
      <button
        key={p.id}
        type="button"
        className={`w-full text-left p-2 rounded text-sm ${isSel ? "bg-blue-100 ring-1 ring-blue-400" : "hover:bg-gray-100"}`}
        onClick={() => setSelectedPart(p)}
        data-testid={`inline-part-${p.id}`}
      >
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-gray-500">{p.sku} · ${p.price}</div>
      </button>
    );
  };

  return (
    <div
      className="border border-gray-200 rounded-xl bg-gray-50 p-4 space-y-4"
      data-testid={`inline-finding-editor-${editing?.id ?? "new"}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-800">
          {mode === "edit" ? "Edit: " : "Add: "}
          {cfg?.displayLabel ?? issueType.replace(/_/g, " ")}
        </div>
        <button
          type="button"
          className="text-gray-400 hover:text-gray-700 text-lg leading-none p-1"
          onClick={onCancel}
          aria-label="Cancel"
        >
          ×
        </button>
      </div>

      {/* Part search */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
          Part {cfg?.partCategoryFilter ? `(${cfg.partCategoryFilter})` : ""}
        </div>
        <Input
          placeholder="Search parts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base"
          data-testid="inline-part-search"
        />
        <div className="max-h-40 overflow-y-auto mt-2 space-y-1 border rounded bg-white p-1">
          {filtered.length === 0 && (
            <div className="text-center text-xs text-gray-500 py-3">No parts found</div>
          )}
          {recentParts.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-1">
                Recent
              </div>
              {recentParts.map(renderPartButton)}
            </div>
          )}
          {otherParts.length > 0 && (
            <div>
              {recentParts.length > 0 && (
                <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-2 border-t mt-1">
                  All parts
                </div>
              )}
              {otherParts.map(renderPartButton)}
            </div>
          )}
        </div>
        {partFromEdit && !selectedPart && partFromEdit.id && (
          <div className="text-xs text-gray-500 mt-1">Currently: {partFromEdit.name}</div>
        )}
      </div>

      {/* Qty + Labor */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Qty</div>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="h-11 text-base"
            data-testid="inline-finding-qty"
          />
        </div>
        <div data-testid="inline-finding-labor">
          <LaborHoursStepper
            label={wetCheckMode === "inspection" ? "Est. labor hrs" : "Labor hrs"}
            value={laborHours}
            onChange={setLaborHours}
            min="0.25"
            disabled={readOnly}
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Notes</div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="text-base"
          placeholder="Optional notes..."
          data-testid="inline-finding-notes"
        />
      </div>

      {/* Mark complete — hidden in inspection mode (assessment-only) */}
      {wetCheckMode !== "inspection" && (
        <label className="flex items-start gap-2 text-sm" data-testid="inline-finding-repaired-toggle">
          <input
            type="checkbox"
            checked={repairedInField}
            onChange={(e) => setRepairedInField(e.target.checked)}
            className="h-4 w-4 mt-0.5"
          />
          <span>
            <span className="font-medium">Mark complete</span>
            <span className="block text-xs text-gray-500">
              {autoBillEnabled
                ? "Will auto-bill on submit."
                : "Completed in the field."}
            </span>
          </span>
        </label>
      )}

      {wetCheckMode !== "inspection" && repairedInField && !hasPartSelected && (
        <label
          className="flex items-start gap-2 text-sm rounded border border-amber-200 bg-amber-50 p-2"
          data-testid="inline-finding-no-part-toggle"
        >
          <input
            type="checkbox"
            checked={noPartNeeded}
            onChange={(e) => setNoPartNeeded(e.target.checked)}
            className="h-4 w-4 mt-0.5"
            data-testid="inline-finding-no-part-checkbox"
          />
          <span>
            <span className="font-medium">No part needed (labor only)</span>
            <span className="block text-xs text-gray-700">
              Confirm this is a labor-only fix.
            </span>
          </span>
        </label>
      )}

      {/* "Flag for Manager instead" — shown in service mode when the tech
          cannot complete the work in the field. Carries notes over to the
          Custom Finding form and closes this editor. */}
      {wetCheckMode !== "inspection" && !readOnly && onSwitchToCustom && (
        <button
          type="button"
          className="w-full text-left flex items-center gap-2 text-sm text-rose-700 border border-rose-200 rounded-lg px-3 py-2.5 hover:bg-rose-50 active:bg-rose-100 transition-colors"
          onClick={() => {
            const issueLabel = cfg?.displayLabel ?? issueType.replace(/_/g, " ");
            const partLabel = (selectedPart?.name ?? partFromEdit?.name) ?? null;
            const contextParts: string[] = [`Started as: ${issueLabel}${partLabel ? ` — ${partLabel}` : ""}`];
            const prefill = [notes.trim(), ...contextParts].filter(Boolean).join("\n\n");
            onSwitchToCustom(prefill);
          }}
          data-testid="inline-finding-flag-for-manager"
        >
          <span className="text-base" aria-hidden>🚩</span>
          <span>
            <span className="font-medium">Flag for Manager instead</span>
            <span className="block text-xs text-rose-600">Can't complete this? Flag it and your manager will decide what to do.</span>
          </span>
        </button>
      )}

      <div className="space-y-1">
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 min-h-[48px]"
            onClick={onCancel}
            disabled={saveMut.isPending}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 min-h-[48px]"
            disabled={
              saveMut.isPending ||
              isSaveBlocked ||
              (mode === "create" && !zoneRecordId && !(isOfflineQueueEnabled() && zoneRecordClientId))
            }
            onClick={() => saveMut.mutate()}
            data-testid="inline-finding-save"
          >
            {saveMut.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === "edit" ? (
              "Save changes"
            ) : (
              "Add finding"
            )}
          </Button>
        </div>
        {isSaveBlocked && (
          <p className="text-xs text-gray-500 text-center" data-testid="inline-finding-save-blocked-hint">
            Finished the work? Mark complete. Can't complete it? Flag it for your manager instead.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Photo–finding attachment helpers ────────────────────────────────────────

// Optimistic photos (captured before the finding has synced to the server)
// carry extra non-schema fields so we can match by client-id when there is
// no numeric finding id yet. These fields are set by PhotoCaptureButton and
// are intentionally absent from the DB schema type.
type PhotoClientLinked = WetCheckPhoto & {
  findingClientId?: string | null;
  zoneRecordClientId?: string | null;
};

// Returns true when `photo` belongs to `finding` by either the numeric id
// (synced photo / synced finding) or by the client-id pair (in-flight photo
// captured while the finding is still queued offline).
function isPhotoAttachedToFinding(
  photo: WetCheckPhoto,
  finding: Pick<WetCheckFinding, "id" | "clientId">,
): boolean {
  const p = photo as PhotoClientLinked;
  if (p.findingId != null && finding.id > 0 && p.findingId === finding.id) return true;
  if (
    p.findingClientId &&
    finding.clientId &&
    p.findingClientId === finding.clientId
  )
    return true;
  return false;
}

// ─── Custom finding editor ("Custom — Flag for Manager") ─────────────────────
// Single-form editor: description (required) + photo (required) must both be
// present before anything is written to the server.  The "Save Flag" button is
// disabled until both gates pass.  No part / qty / labor / Mark-Complete
// controls appear for this type.
//
// Create flow:
//   1. Tech fills description and taps the camera button (photo uploaded to
//      zone record linked by findingClientId only — no finding exists yet).
//   2. "Save Flag" becomes enabled once description.trim() && ≥1 photo.
//   3. Tap "Save Flag": create finding with the pre-generated clientId, then
//      the photo's findingClientId already matches → manager can see it.
//
// Edit flow: single form with editable description + additional photo capture.
function CustomFindingEditor({
  editing,
  zoneRecordId,
  zoneRecordClientId,
  wetCheckId,
  wetCheckClientId,
  photos,
  onSaved,
  onCancel,
  onOptimisticPhoto,
  initialDescription,
}: {
  editing: WetCheckFinding | null;
  zoneRecordId: number | null;
  zoneRecordClientId: string | null;
  wetCheckId: number;
  wetCheckClientId: string | null;
  photos: WetCheckPhoto[];
  onSaved: () => void;
  onCancel: () => void;
  onOptimisticPhoto: (p: WetCheckPhoto) => void;
  initialDescription?: string;
}) {
  const { toast } = useToast();
  const [description, setDescription] = useState(initialDescription ?? editing?.notes ?? "");

  // Pre-generate a stable clientId for the not-yet-created finding.
  // Photos uploaded before save use this as findingClientId for linking.
  const [pendingClientId] = useState(() => editing?.clientId ?? newClientId());
  const [savedId, setSavedId] = useState<number | null>(editing?.id ?? null);

  // Derive the "active" id pair: once saved, use the real id; until then use
  // the pre-generated clientId so photo linking works immediately.
  const activeFindingId     = savedId;
  const activeFindingClientId = pendingClientId;

  // Photos linked to this finding (by id once saved, or by clientId pre-save).
  const findingPhotos = useMemo(
    () => photos.filter(p => {
      const ph = p as { findingId?: number | null; findingClientId?: string | null };
      if (activeFindingId != null && ph.findingId === activeFindingId) return true;
      if (ph.findingClientId && ph.findingClientId === activeFindingClientId) return true;
      return false;
    }),
    [photos, activeFindingId, activeFindingClientId],
  );
  const hasPhoto = findingPhotos.length > 0;

  // ── Create mutation (runs on "Save Flag" for new findings) ─────────────────
  const saveMut = useMutation({
    mutationFn: async ({ desc }: { desc: string }) => {
      const payload = {
        issueType:       CUSTOM_REVIEW_ISSUE_TYPE,
        issueGroup:      "custom_review",
        notes:           desc,
        repairedInField: false,
        techDisposition: "needs_review",
        partId:          null,
        partName:        null,
        partPrice:       null,
        quantity:        1,
        laborHours:      "0.25",
        noPartNeeded:    false,
      };
      if (isOfflineQueueEnabled() && zoneRecordClientId) {
        const res = await offlineCreateFinding({
          zoneRecordClientId,
          zoneRecordId: zoneRecordId ?? undefined,
          wetCheckId,
          payload,
          clientId: pendingClientId,
        });
        return { id: res.id ?? null };
      }
      if (zoneRecordId != null) {
        const res = await apiRequest(
          `/api/wet-checks/zone-records/${zoneRecordId}/findings`,
          "POST",
          { ...payload, clientId: pendingClientId },
        ) as { id: number; clientId: string | null };
        return { id: res.id };
      }
      throw new Error("Zone not yet synced — please try again in a moment.");
    },
    onSuccess: (res) => {
      setSavedId(res.id ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Couldn't save flag", description: e?.message, variant: "destructive" });
    },
  });

  // ── Update mutation (edit mode) ────────────────────────────────────────────
  const updateMut = useMutation({
    mutationFn: async ({ desc }: { desc: string }) => {
      if (!editing) return;
      const patch = { notes: desc };
      if (isOfflineQueueEnabled() && editing.clientId) {
        await offlineUpdateFinding(editing.clientId, editing.id, patch);
        return;
      }
      await apiRequest(`/api/wet-checks/findings/${editing.id}`, "PATCH", patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Couldn't save flag", description: e?.message, variant: "destructive" });
    },
  });

  const header = (
    <div className="flex items-center gap-2">
      <span className="text-xl" aria-hidden="true">🚩</span>
      <div>
        <div className="font-semibold text-rose-900 text-sm">Custom — Flag for Manager</div>
        <div className="text-xs text-rose-600">
          {editing ? "Edit flag details" : "Description + at least one photo required"}
        </div>
      </div>
    </div>
  );

  // ── Edit mode ───────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="border-2 border-rose-300 rounded-xl p-4 space-y-3 bg-rose-50" data-testid="custom-finding-editor">
        {header}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-700" htmlFor="custom-finding-desc-edit">
            Description <span className="text-rose-600">*</span>
          </label>
          <Textarea
            id="custom-finding-desc-edit"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="min-h-[80px] resize-none"
            data-testid="custom-finding-description"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {findingPhotos.map(p => (
            <PhotoThumb key={p.id} photo={p} canDelete={true} />
          ))}
          <PhotoCaptureButton
            wetCheckId={wetCheckId}
            wetCheckClientId={wetCheckClientId}
            zoneRecordId={zoneRecordId}
            zoneRecordClientId={zoneRecordClientId}
            findingId={activeFindingId}
            findingClientId={activeFindingClientId}
            onUploaded={onOptimisticPhoto}
          />
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => updateMut.mutate({ desc: description })}
            disabled={!description.trim() || updateMut.isPending}
            data-testid="custom-finding-save"
          >
            {updateMut.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={updateMut.isPending}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── Create mode (single form — nothing saved until both gates pass) ─────────
  return (
    <div className="border-2 border-rose-300 rounded-xl p-4 space-y-3 bg-rose-50" data-testid="custom-finding-editor">
      {header}

      <div className="space-y-1">
        <label className="text-xs font-semibold text-gray-700" htmlFor="custom-finding-desc">
          Description <span className="text-rose-600">*</span>
        </label>
        <Textarea
          id="custom-finding-desc"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe what needs manager review…"
          className="min-h-[88px] resize-none"
          autoFocus
          data-testid="custom-finding-description"
        />
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-700 mb-1.5">
          Photo <span className="text-rose-600">*</span>
        </div>
        {!hasPhoto && (
          <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
            <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            At least one photo is required
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          {findingPhotos.map(p => (
            <PhotoThumb key={p.id} photo={p} canDelete={true} />
          ))}
          <PhotoCaptureButton
            wetCheckId={wetCheckId}
            wetCheckClientId={wetCheckClientId}
            zoneRecordId={zoneRecordId}
            zoneRecordClientId={zoneRecordClientId}
            findingId={null}
            findingClientId={activeFindingClientId}
            onUploaded={onOptimisticPhoto}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          className="flex-1 bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
          onClick={() => saveMut.mutate({ desc: description })}
          disabled={!description.trim() || !hasPhoto || saveMut.isPending}
          title={
            !description.trim() && !hasPhoto
              ? "Add a description and photo to save"
              : !description.trim()
                ? "Add a description to save"
                : !hasPhoto
                  ? "Add at least one photo to save"
                  : undefined
          }
          data-testid="custom-finding-save"
        >
          {saveMut.isPending ? "Saving…" : "Save Flag"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saveMut.isPending} data-testid="custom-finding-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

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
  wetCheckMode,
  onBack,
  onAdvance,
  currentZoneIndex,
  totalZones,
  onNavigatePrev,
  onNavigateNext,
  isLastZone,
  onOpenOverview,
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
  wetCheckMode?: "service" | "inspection";
  onBack: () => void;
  onAdvance: () => void;
  // Navigation props (optional — older callers like tests may not pass them)
  currentZoneIndex?: number;
  totalZones?: number;
  onNavigatePrev?: (() => void) | null;
  onNavigateNext?: () => void;
  isLastZone?: boolean;
  onOpenOverview?: () => void;
}) {
  const { toast } = useToast();

  // Inline finding state: which issue type is being added, or which finding is being edited
  const [inlineIssueType, setInlineIssueType] = useState<string | null>(null);
  const [inlineEditing, setInlineEditing] = useState<WetCheckFinding | null>(null);
  // When InlineFindingEditor's "Flag for Manager instead" is clicked, we store the
  // carried-over notes here so CustomFindingEditor can pre-populate its description.
  const [customPrefillDescription, setCustomPrefillDescription] = useState("");
  // Show chip selector when there are no findings yet; "Add another finding" sets it true.
  // Uses zoneRecord (prop) directly — avoids TDZ since `findings` is declared later.
  const [showChipSelector, setShowChipSelector] = useState(() => asArray(zoneRecord?.findings).length === 0);

  // PSI/flow collapsible — seeded from existing zone record values on mount
  const [readingsOpen, setReadingsOpen] = useState(false);
  const [psiReading, setPsiReading] = useState(zoneRecord?.observedPressure ?? "");
  const [flowReading, setFlowReading] = useState(zoneRecord?.observedFlow ?? "");

  // Task #755 — per-zone repair labor stepper.
  const [repairLaborHours, setRepairLaborHours] = useState<string>(
    zoneRecord?.repairLaborHours ?? "0.00",
  );
  useEffect(() => {
    setRepairLaborHours(zoneRecord?.repairLaborHours ?? "0.00");
  }, [zoneRecord?.repairLaborHours]);

  const repairLaborMut = useMutation({
    mutationFn: async (hours: string) => {
      if (!zoneRecord) {
        if (isOfflineQueueEnabled() && wetCheckClientId) {
          // Offline lazy-create: upsert a skeleton zone record then patch.
          const clientId = newClientId();
          await offlineUpsertZoneRecord({
            wetCheckClientId,
            wetCheckId,
            controllerLetter: letter,
            zoneNumber,
            status: "not_checked",
            clientId,
          });
          await offlinePatchZoneRecordRepairLabor(clientId, undefined, hours);
        } else if (wetCheckId) {
          // Online lazy-create: create the zone record, then patch repair-labor.
          const created = await apiRequest(`/api/wet-checks/${wetCheckId}/zone-records`, "POST", {
            controllerLetter: letter,
            zoneNumber,
            status: "not_checked",
            clientId: newClientId(),
          });
          if (created?.id) {
            await apiRequest(`/api/wet-checks/zone-records/${created.id}/repair-labor`, "PATCH", {
              repairLaborHours: hours,
            });
          }
        }
        return;
      }
      if (isOfflineQueueEnabled() && zoneRecord?.clientId) {
        await offlinePatchZoneRecordRepairLabor(
          zoneRecord.clientId,
          zoneRecord.id ?? undefined,
          hours,
        );
        return;
      }
      if (zoneRecord?.id) {
        await apiRequest(`/api/wet-checks/zone-records/${zoneRecord.id}/repair-labor`, "PATCH", {
          repairLaborHours: hours,
        });
      }
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save repair labor",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
    },
  });
  // Debounced save for PSI/flow readings. If no zone record exists yet,
  // lazily create one (status: not_checked) with the readings baked in.
  const readingsMut = useMutation({
    mutationFn: async ({ psi, flow }: { psi: string; flow: string }) => {
      if (!zoneRecord) {
        if (isOfflineQueueEnabled() && wetCheckClientId) {
          // Offline lazy-create: upsert a skeleton zone record then patch readings.
          const clientId = newClientId();
          await offlineUpsertZoneRecord({
            wetCheckClientId,
            wetCheckId,
            controllerLetter: letter,
            zoneNumber,
            status: "not_checked",
            clientId,
          });
          await offlinePatchZoneRecordReadings(clientId, undefined, psi, flow);
        } else if (wetCheckId) {
          // Online lazy-create: POST a not_checked record with readings baked in.
          await apiRequest(`/api/wet-checks/${wetCheckId}/zone-records`, "POST", {
            controllerLetter: letter,
            zoneNumber,
            status: "not_checked",
            observedPressure: psi.trim() || null,
            observedFlow: flow.trim() || null,
            clientId: newClientId(),
          });
        }
        return;
      }
      await offlinePatchZoneRecordReadings(
        zoneRecord.clientId ?? "",
        zoneRecord.id ?? undefined,
        psi,
        flow,
      );
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't save readings",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
    },
  });
  const readingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleReadingsChange = useCallback(
    (psi: string, flow: string) => {
      if (readingsDebounceRef.current) clearTimeout(readingsDebounceRef.current);
      readingsDebounceRef.current = setTimeout(() => {
        readingsMut.mutate({ psi, flow });
      }, 600);
    },
    [readingsMut],
  );

  const repairLaborDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRepairLaborChange = useCallback(
    (next: string) => {
      setRepairLaborHours(next);
      if (repairLaborDebounceRef.current) clearTimeout(repairLaborDebounceRef.current);
      repairLaborDebounceRef.current = setTimeout(() => {
        repairLaborMut.mutate(next);
      }, 600);
    },
    [repairLaborMut],
  );

  // Task #891 — reset repair labor to auto-computed default.
  const resetRepairLaborMut = useMutation({
    mutationFn: async () => {
      if (!zoneRecord?.id) return;
      return apiRequest(`/api/wet-checks/zone-records/${zoneRecord.id}/repair-labor/reset`, "POST", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't reset repair labor",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Task #597 — optimistic photos
  const [optimisticPhotos, setOptimisticPhotos] = useState<WetCheckPhoto[]>([]);
  useEffect(() => {
    if (optimisticPhotos.length === 0) return;
    const serverClientIds = new Set(
      asArray(photos)
        .map((p) => (p as { clientId?: string | null }).clientId ?? null)
        .filter((c): c is string => !!c),
    );
    const remaining = optimisticPhotos.filter(
      (o) => !serverClientIds.has((o as { clientId?: string | null }).clientId ?? ""),
    );
    if (remaining.length !== optimisticPhotos.length) {
      setOptimisticPhotos(remaining);
    }
  }, [photos, optimisticPhotos]);

  const mergedPhotos = useMemo(() => {
    if (optimisticPhotos.length === 0) return photos;
    const serverClientIds = new Set(
      asArray(photos)
        .map((p) => (p as { clientId?: string | null }).clientId ?? null)
        .filter((c): c is string => !!c),
    );
    const fresh = optimisticPhotos.filter(
      (o) => !serverClientIds.has((o as { clientId?: string | null }).clientId ?? ""),
    );
    return fresh.length === 0 ? photos : [...photos, ...fresh];
  }, [photos, optimisticPhotos]);

  const onOptimisticPhoto = useCallback((p: WetCheckPhoto) => {
    setOptimisticPhotos((prev) => {
      const cid = (p as { clientId?: string | null }).clientId ?? null;
      if (cid && prev.some((x) => (x as { clientId?: string | null }).clientId === cid)) {
        return prev;
      }
      return [...prev, p];
    });
  }, []);

  // Task #455 — revert confirm dialog
  const [pendingRevert, setPendingRevert] = useState<
    null | { targetStatus: "checked_ok" | "not_applicable" }
  >(null);
  const [reverting, setReverting] = useState(false);

  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  // Task #512 — optimistic zone status helpers
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
      if (isOfflineQueueEnabled() && wetCheckClientId) {
        return offlineUpsertZoneRecord({
          wetCheckClientId,
          wetCheckId,
          controllerLetter: letter,
          zoneNumber,
          status,
          ranSuccessfully:
            status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
          notes: null,
          checkedAt,
          clientId,
        });
      }
      return apiRequest(`/api/wet-checks/${wetCheckId}/zone-records`, "POST", {
        controllerLetter: letter,
        zoneNumber,
        status,
        ranSuccessfully:
          status === "checked_ok" ? true : status === "checked_with_issues" ? false : null,
        checkedAt,
        clientId,
      });
    },
    onMutate: async (status) => {
      await Promise.all(detailQueryKeys.map((k) => queryClient.cancelQueries({ queryKey: k })));
      const snapshots = applyOptimisticZoneStatus(status);
      return { snapshots };
    },
    onError: (e: any, _status, ctx) => {
      if (ctx?.snapshots) rollbackOptimisticZoneStatus(ctx.snapshots);
      toast({ title: "Failed", description: e?.message, variant: "destructive" });
    },
    onSuccess: (_data, status) => {
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
    queryFn: () => cachedApiRequest("/api/wet-checks/issue-types"),
  });

  // Delete finding mutation
  const deleteFindingQueryKey: readonly unknown[] = ["/api/wet-checks", wetCheckId];
  type DeleteFindingCtx = { previous: WetCheckWithDetails | undefined };
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
      if (ctx?.previous) queryClient.setQueryData(deleteFindingQueryKey, ctx.previous);
      const fallback = e instanceof Error && e.message ? e.message : "Please try again.";
      toast({
        title: "Couldn't delete finding",
        description: parseApiError(e, fallback),
        variant: "destructive",
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] }),
  });

  const findings = asArray(zoneRecord?.findings);
  const findingIds = new Set(findings.map((f) => f.id));
  const findingPhotos = photos.filter((p) => p.findingId != null && findingIds.has(p.findingId));
  const hasAttachedWork = findings.length > 0 || findingPhotos.length > 0;

  // Task #455 — revert cascade
  async function performRevert(target: "checked_ok" | "not_applicable") {
    setReverting(true);
    await Promise.all(detailQueryKeys.map((k) => queryClient.cancelQueries({ queryKey: k })));
    const optimisticSnapshots = applyOptimisticZoneStatus(target);
    try {
      if (isOfflineQueueEnabled() && wetCheckClientId && zoneRecord?.clientId) {
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
      rollbackOptimisticZoneStatus(optimisticSnapshots);
      toast({ title: "Couldn't reset zone", description: e?.message, variant: "destructive" });
    } finally {
      setReverting(false);
      invalidateDetailQueries();
    }
  }

  function handleStatusClick(next: "checked_ok" | "checked_with_issues" | "not_applicable") {
    const current = zoneRecord?.status;
    const isLeavingNeedsWork = current === "checked_with_issues" && next !== "checked_with_issues";
    if (isLeavingNeedsWork && hasAttachedWork) {
      setPendingRevert({ targetStatus: next as "checked_ok" | "not_applicable" });
      return;
    }
    setStatus.mutate(next);
  }

  // Task #454/458 — Mark Zone Complete
  const [confirmMarkComplete, setConfirmMarkComplete] = useState(false);
  const findingsCount = asArray(zoneRecord?.findings).length;
  const markCompleteMut = useMutation({
    mutationFn: async () => {
      const markedAt = new Date().toISOString();
      if (isOfflineQueueEnabled() && wetCheckClientId) {
        await offlineUpsertZoneRecord({
          wetCheckClientId,
          wetCheckId,
          controllerLetter: letter,
          zoneNumber,
          status: "checked_with_issues",
          ranSuccessfully: false,
          notes: zoneRecord?.notes ?? null,
          checkedAt: zoneRecord?.checkedAt ? new Date(zoneRecord.checkedAt).toISOString() : markedAt,
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
      const key = ["/api/wet-checks", wetCheckId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WetCheckWithDetails>(key);
      const stamp = new Date();
      if (previous && zoneRecord) {
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
      if (ctx?.previous) queryClient.setQueryData(["/api/wet-checks", wetCheckId], ctx.previous);
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

  useEffect(() => {
    setConfirmMarkComplete(false);
  }, [zoneRecord?.id, zoneNumber, letter]);

  const tint = tintForControllerLetter(letter);
  const statusLabel =
    zoneRecord?.status === "checked_ok"
      ? "Ran OK"
      : zoneRecord?.status === "checked_with_issues"
      ? "Needs Work"
      : zoneRecord?.status === "not_applicable"
      ? "Skipped"
      : "Not Checked";
  const statusPillCls =
    zoneRecord?.status === "checked_ok"
      ? "bg-green-100 text-green-900 border-green-300"
      : zoneRecord?.status === "checked_with_issues"
      ? "bg-amber-100 text-amber-900 border-amber-300"
      : zoneRecord?.status === "not_applicable"
      ? "bg-gray-100 text-gray-800 border-gray-300"
      : "bg-white text-gray-700 border-gray-300";

  const hasNavigation = typeof currentZoneIndex === "number" && typeof totalZones === "number";
  const displayIndex = (currentZoneIndex ?? 0) + 1;
  const displayTotal = totalZones ?? zoneCount;

  return (
    <div
      className="max-w-2xl mx-auto py-2 space-y-3 px-3 sm:px-4 pb-32"
      data-testid="zone-screen"
    >
      {/* ── Persistent top bar ─────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-white/95 backdrop-blur border-b shadow-sm"
        data-testid="zone-topbar"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 truncate" data-testid="zone-topbar-customer">
              {customerName}
            </div>
            <div className="text-xs text-gray-500 truncate" data-testid="zone-topbar-address">
              {propertyAddress ?? "—"}
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="font-medium text-gray-700">
                {hasNavigation
                  ? `Zone ${displayIndex} of ${displayTotal}`
                  : `Controller ${letter} · Zone ${zoneNumber}`}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenOverview && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={onOpenOverview}
                data-testid="btn-zone-overview"
              >
                <LayoutGrid className="w-3.5 h-3.5 mr-1" />
                View All
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs"
              onClick={onBack}
              data-testid="btn-zone-back"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Back
            </Button>
          </div>
        </div>
      </div>

      {/* ── Zone identity band ──────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div
          className={`${tint.band} border-b-4 ${tint.border} px-4 py-3 sm:py-4`}
          data-testid="zone-identity-band"
          data-controller-letter={letter}
          data-zone-number={zoneNumber}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`${tint.letterBg} ${tint.letterText} rounded-xl px-3 py-2 text-4xl sm:text-5xl font-extrabold leading-none shrink-0 shadow-sm`}
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
                  className={`${tint.zoneText} text-5xl sm:text-6xl font-black leading-none tabular-nums`}
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
              {mergedPhotos.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-800 bg-white/80 border border-gray-300 rounded-full px-2 py-0.5"
                  data-testid="zone-photo-total"
                >
                  <Camera className="w-3 h-3" aria-hidden />
                  {mergedPhotos.length}
                </span>
              )}
            </div>
          </div>
        </div>

        <CardContent className="pt-4 space-y-4">
          {/* ── Large status buttons ────────────────────────────────────── */}
          {!readOnly && (
            <>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <Button
                  variant={zoneRecord?.status === "checked_ok" ? "default" : "outline"}
                  className={`min-h-[72px] px-2 text-sm sm:text-base font-semibold flex-col gap-1.5 shadow-sm ${
                    zoneRecord?.status === "checked_ok"
                      ? "bg-green-600 hover:bg-green-700 text-white ring-2 ring-green-700 ring-offset-1"
                      : "hover:bg-green-50 active:bg-green-100 border-2"
                  }`}
                  onClick={() => handleStatusClick("checked_ok")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-yes"
                >
                  <CheckCircle2 className="w-7 h-7 shrink-0" />
                  <span>Ran OK</span>
                </Button>
                <Button
                  variant={zoneRecord?.status === "checked_with_issues" ? "default" : "outline"}
                  className={`min-h-[72px] px-2 text-sm sm:text-base font-semibold flex-col gap-1.5 shadow-sm ${
                    zoneRecord?.status === "checked_with_issues"
                      ? "bg-amber-500 hover:bg-amber-600 text-white ring-2 ring-amber-600 ring-offset-1"
                      : "hover:bg-amber-50 active:bg-amber-100 border-2"
                  }`}
                  onClick={() => handleStatusClick("checked_with_issues")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-no"
                >
                  <Wrench className="w-7 h-7 shrink-0" />
                  <span>Needs Work</span>
                </Button>
                <Button
                  variant={zoneRecord?.status === "not_applicable" ? "default" : "outline"}
                  className={`min-h-[72px] px-2 text-sm sm:text-base font-semibold flex-col gap-1.5 shadow-sm ${
                    zoneRecord?.status === "not_applicable"
                      ? "bg-gray-500 hover:bg-gray-600 text-white ring-2 ring-gray-600 ring-offset-1"
                      : "hover:bg-gray-50 active:bg-gray-100 border-2"
                  }`}
                  onClick={() => handleStatusClick("not_applicable")}
                  disabled={setStatus.isPending || reverting}
                  data-testid="btn-zone-na"
                >
                  <MinusCircle className="w-7 h-7 shrink-0" />
                  <span className="sm:hidden">N/A</span>
                  <span className="hidden sm:inline">Skip · N/A</span>
                </Button>
              </div>

              {/* ── Inline findings panel (Needs Work) ─────────────────── */}
              {zoneRecord?.status === "checked_with_issues" && (
                <div className="space-y-3 pt-1" data-testid="inline-findings-panel">
                  {/* Issue type chips — shown on first load (no findings) or after "Add another" */}
                  {showChipSelector && !inlineIssueType && !inlineEditing && (
                    <div>
                      <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
                        {findings.length > 0 ? "Add another finding" : "Add work for this zone"}
                      </div>
                      <div className="space-y-3">
                        {(
                          [
                            { key: "quick_fix", label: "Quick Fix" },
                            { key: "advanced", label: "Advanced" },
                            { key: "zone_issue", label: "Zone Issue" },
                          ] as const
                        ).map(({ key, label }) => {
                          const groupItems = issueTypes.filter((i) => i.issueGroup === key);
                          if (groupItems.length === 0) return null;
                          return (
                            <div key={key}>
                              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
                                {label}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {groupItems.map((it) => (
                                  <button
                                    key={it.issueType}
                                    type="button"
                                    className="px-3 py-2 rounded-full border-2 border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-amber-400 hover:bg-amber-50 active:bg-amber-100 transition-colors min-h-[44px]"
                                    onClick={() => setInlineIssueType(it.issueType)}
                                    data-testid={`chip-${it.issueType}`}
                                  >
                                    {it.displayLabel}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {/* Task #1535 — "Custom — Flag for Manager" chip */}
                        <div>
                          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1.5">
                            Flag for Review
                          </div>
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 rounded-xl border-2 border-rose-300 bg-rose-50 text-sm font-medium text-rose-700 hover:border-rose-500 hover:bg-rose-100 active:bg-rose-200 transition-colors min-h-[44px] flex items-start gap-2"
                              onClick={() => setInlineIssueType(CUSTOM_REVIEW_ISSUE_TYPE)}
                              data-testid="chip-custom_review"
                            >
                              <span className="text-base mt-0.5" aria-hidden>🚩</span>
                              <span>
                                <span className="block">Custom — Flag for Manager</span>
                                <span className="block text-xs font-normal text-rose-600">Use this when you can't complete the work in the field. Add a description and photo — your manager will decide what happens next.</span>
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inline editor: new finding */}
                  {inlineIssueType && !inlineEditing && (
                    inlineIssueType === CUSTOM_REVIEW_ISSUE_TYPE ? (
                      <CustomFindingEditor
                        editing={null}
                        zoneRecordId={zoneRecord?.id ?? null}
                        zoneRecordClientId={zoneRecord?.clientId ?? null}
                        wetCheckId={wetCheckId}
                        wetCheckClientId={wetCheckClientId}
                        photos={mergedPhotos}
                        initialDescription={customPrefillDescription}
                        onSaved={() => {
                          setInlineIssueType(null);
                          setShowChipSelector(false);
                          setCustomPrefillDescription("");
                        }}
                        onCancel={() => {
                          setInlineIssueType(null);
                          setCustomPrefillDescription("");
                        }}
                        onOptimisticPhoto={onOptimisticPhoto}
                      />
                    ) : (
                    <InlineFindingEditor
                      issueType={inlineIssueType}
                      editing={null}
                      zoneRecordId={zoneRecord?.id ?? null}
                      zoneRecordClientId={zoneRecord?.clientId ?? null}
                      wetCheckId={wetCheckId}
                      wetCheckClientId={wetCheckClientId}
                      customerId={customerId}
                      photos={photos}
                      readOnly={readOnly}
                      wetCheckMode={wetCheckMode}
                      onSaved={() => {
                        setInlineIssueType(null);
                        setShowChipSelector(false);
                      }}
                      onCancel={() => setInlineIssueType(null)}
                      onSwitchToCustom={(prefillNotes) => {
                        setCustomPrefillDescription(prefillNotes);
                        setInlineIssueType(CUSTOM_REVIEW_ISSUE_TYPE);
                      }}
                    />
                  ))}

                  {/* Inline editor: edit finding */}
                  {inlineEditing && (
                    inlineEditing.issueType === CUSTOM_REVIEW_ISSUE_TYPE ? (
                      <CustomFindingEditor
                        editing={inlineEditing}
                        zoneRecordId={zoneRecord?.id ?? null}
                        zoneRecordClientId={zoneRecord?.clientId ?? null}
                        wetCheckId={wetCheckId}
                        wetCheckClientId={wetCheckClientId}
                        photos={mergedPhotos}
                        onSaved={() => setInlineEditing(null)}
                        onCancel={() => setInlineEditing(null)}
                        onOptimisticPhoto={onOptimisticPhoto}
                      />
                    ) : (
                      <InlineFindingEditor
                        issueType={inlineEditing.issueType}
                        editing={inlineEditing}
                        zoneRecordId={zoneRecord?.id ?? null}
                        zoneRecordClientId={zoneRecord?.clientId ?? null}
                        wetCheckId={wetCheckId}
                        wetCheckClientId={wetCheckClientId}
                        customerId={customerId}
                        photos={photos}
                        readOnly={readOnly}
                        wetCheckMode={wetCheckMode}
                        onSaved={() => setInlineEditing(null)}
                        onCancel={() => setInlineEditing(null)}
                        onSwitchToCustom={(prefillNotes) => {
                          setCustomPrefillDescription(prefillNotes);
                          setInlineEditing(null);
                          setInlineIssueType(CUSTOM_REVIEW_ISSUE_TYPE);
                        }}
                      />
                    )
                  )}

                  {/* Existing findings */}
                  {findings.length > 0 && (
                    <div className="space-y-2 pt-1" data-testid="zone-findings-list">
                      <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                        Work added — {findings.length} item{findings.length !== 1 ? "s" : ""}
                      </div>
                      {findings.map((f) => {
                        // Prefer clientId for both key and edit-state matching so
                        // optimistic offline entries (which may have a temp negative id)
                        // are identified stably before the server confirms the real id.
                        const stableKey = f.clientId ?? String(f.id);
                        const isBeingEdited = inlineEditing
                          ? inlineEditing.clientId && f.clientId
                            ? inlineEditing.clientId === f.clientId
                            : inlineEditing.id === f.id
                          : false;
                        if (isBeingEdited) return null;
                        const fc = countFindingPhotos({ photos: mergedPhotos }, f);
                        return (
                          <div
                            key={stableKey}
                            className="border rounded-lg p-3 bg-white"
                            data-testid={`finding-${f.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm min-w-0">
                                <div className="font-medium flex items-center gap-2 flex-wrap">
                                  <span>
                                    {f.issueType === CUSTOM_REVIEW_ISSUE_TYPE
                                      ? "🚩 Custom — Flag for Manager"
                                      : f.issueType.replace(/_/g, " ")}
                                  </span>
                                  {fc > 0 && (
                                    <span
                                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-gray-700 bg-gray-100 border border-gray-300 rounded-full px-1.5 py-0.5"
                                      data-testid={`finding-photo-count-${f.id}`}
                                    >
                                      <Camera className="w-3 h-3" aria-hidden />
                                      {fc}
                                    </span>
                                  )}
                                </div>
                                {/* Task #1535 — custom_review shows description; others show part/qty/labor */}
                                {f.issueType === CUSTOM_REVIEW_ISSUE_TYPE ? (
                                  f.notes && (
                                    <div className="text-xs font-medium text-rose-700 mt-0.5">{f.notes}</div>
                                  )
                                ) : (
                                  <div className="text-xs text-gray-500">
                                    {f.partName ?? "no part"} · qty {f.quantity} · {f.laborHours}h
                                    {f.partPrice ? ` · $${f.partPrice}` : ""}
                                  </div>
                                )}
                                {f.notes && f.issueType !== CUSTOM_REVIEW_ISSUE_TYPE && (
                                  <div className="text-xs italic text-gray-600">{f.notes}</div>
                                )}
                                {f.resolution === "repaired_in_field" && (
                                  <Badge
                                    variant="secondary"
                                    className="mt-1"
                                    data-testid={`finding-complete-badge-${f.id}`}
                                  >
                                    {autoBillEnabled
                                      ? "Complete · auto-bills on submit"
                                      : "Completed in field"}
                                  </Badge>
                                )}
                                {/* Task #1535 — disposition is read-only; the toggle has been removed.
                                    custom_review always shows the flag badge.
                                    Other findings show their disposition (set via Mark Complete). */}
                                {f.issueType === CUSTOM_REVIEW_ISSUE_TYPE ? (
                                  <Badge
                                    variant="outline"
                                    className="mt-1 border-rose-300 text-rose-700 bg-rose-50"
                                    data-testid={`finding-disposition-badge-${f.id}`}
                                  >
                                    🚩 Flagged for manager review
                                  </Badge>
                                ) : f.techDisposition ? (
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
                                ) : null}
                              </div>
                              {!readOnly && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 w-9 p-0"
                                    onClick={() => {
                                      setInlineIssueType(null);
                                      setInlineEditing(f);
                                    }}
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
                                    onUploaded={onOptimisticPhoto}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 w-9 p-0"
                                    onClick={() =>
                                      deleteFindingMut.mutate({
                                        id: f.id,
                                        clientId: f.clientId ?? null,
                                      })
                                    }
                                    data-testid={`delete-finding-${f.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 text-red-600" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            {(() => {
                              const fp = mergedPhotos.filter((p) => isPhotoAttachedToFinding(p, f));
                              if (fp.length === 0) return null;
                              return (
                                <div
                                  className="flex flex-wrap gap-2 pt-2"
                                  data-testid={`finding-photos-${f.id}`}
                                >
                                  {fp.map((p) => (
                                    <PhotoThumb key={p.id} photo={p} canDelete={!readOnly} />
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* "Add another finding" — appears after at least one finding is saved */}
                  {findings.length > 0 && !inlineIssueType && !inlineEditing && !showChipSelector && !readOnly && (
                    <button
                      type="button"
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-amber-300 text-amber-700 text-sm font-semibold hover:bg-amber-50 active:bg-amber-100 transition-colors min-h-[44px]"
                      onClick={() => setShowChipSelector(true)}
                      data-testid="btn-add-another-finding"
                    >
                      <Plus className="w-4 h-4" aria-hidden />
                      Add another finding
                    </button>
                  )}

                  {/* Mark Zone Complete */}
                  {!inlineIssueType && !inlineEditing && (
                    <div className="space-y-2 pt-1" data-testid="mark-zone-complete-row">
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
                        className="w-full min-h-[52px] bg-blue-600 hover:bg-blue-700 text-white"
                        onClick={handleMarkZoneComplete}
                        disabled={setStatus.isPending}
                        data-testid="btn-mark-zone-complete"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />
                        {confirmMarkComplete
                          ? "Confirm — Mark Zone Complete"
                          : "Mark Zone Complete"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {(!zoneRecord || zoneRecord.status === "not_checked") && (
                <div className="text-xs text-gray-500 text-center py-1" data-testid="needs-work-helper">
                  Tap <span className="font-semibold">Needs Work</span> to log issues for this zone.
                </div>
              )}
            </>
          )}

          {/* Zone-level photos (when not in Needs Work mode or in readOnly) */}
          {(() => {
            // A photo is "zone-only / loose" only when it is not attached to
            // any finding by numeric id OR by client-id. This prevents the
            // false-alarm banner for photos captured on an unsynced finding
            // (findingId is null but findingClientId matches the finding).
            const zoneOnlyPhotos = mergedPhotos.filter(
              (p) => !findings.some((f) => isPhotoAttachedToFinding(p, f)),
            );
            if (zoneOnlyPhotos.length === 0) return null;
            if (findings.length > 0) {
              const options = findings
              .filter((f) => f.id > 0)
              .map((f) => ({
                id: f.id,
                label: [f.issueType.replace(/_/g, " "), f.partName ?? "no part"].join(" · "),
              }));
              return (
                <LoosePhotosSection
                  photos={zoneOnlyPhotos}
                  findingOptions={options}
                  wetCheckId={wetCheckId}
                  readOnly={readOnly}
                />
              );
            }
            return (
              <div className="flex flex-wrap gap-2 pt-1" data-testid="zone-photos">
                {zoneOnlyPhotos.map((p) => (
                  <PhotoThumb key={p.id} photo={p} canDelete={!readOnly} />
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── Record readings (collapsible) ──────────────────────────────── */}
      {!readOnly && (
        <div className="border rounded-xl overflow-hidden bg-white" data-testid="record-readings-section">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            onClick={() => setReadingsOpen((v) => !v)}
            data-testid="btn-toggle-readings"
            aria-expanded={readingsOpen}
          >
            <span>Record readings (optional)</span>
            {readingsOpen ? (
              <ChevronUp className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>
          {readingsOpen && (
            <div className="px-4 pb-4 pt-1 space-y-3 border-t">
              <div className="text-xs text-gray-500">
                Reference readings for this visit. Add values to zone notes to keep them on the record.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Pressure (PSI)
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="e.g. 45"
                    value={psiReading}
                    onChange={(e) => {
                      setPsiReading(e.target.value);
                      handleReadingsChange(e.target.value, flowReading);
                    }}
                    className="h-11 text-base"
                    data-testid="input-psi"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                    Flow (GPM)
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="e.g. 3.2"
                    value={flowReading}
                    onChange={(e) => {
                      setFlowReading(e.target.value);
                      handleReadingsChange(psiReading, e.target.value);
                    }}
                    className="h-11 text-base"
                    data-testid="input-flow"
                  />
                </div>
              </div>
              {(psiReading || flowReading) && (
                <div className="text-xs text-amber-600 italic">
                  Not saved — copy to zone notes to keep these values.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Per-zone repair labor (Needs Work only) ─────────────────────── */}
      {zoneRecord && !readOnly && zoneRecord.status === "checked_with_issues" && (
        <div className="border rounded-xl bg-white px-4 py-3" data-testid="repair-labor-card">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Repair labor for this zone
              </span>
              {(zoneRecord as any).repairLaborManuallySet ? (
                <span
                  className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300"
                  data-testid="repair-labor-badge-manual"
                >
                  manual
                </span>
              ) : (
                <span
                  className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200"
                  data-testid="repair-labor-badge-auto"
                >
                  auto
                </span>
              )}
            </div>
            {(zoneRecord as any).repairLaborManuallySet && zoneRecord.id && (
              <button
                type="button"
                className="text-[11px] text-blue-600 hover:underline disabled:opacity-50"
                onClick={() => resetRepairLaborMut.mutate()}
                disabled={resetRepairLaborMut.isPending}
                data-testid="btn-reset-repair-labor"
              >
                Reset to default
              </button>
            )}
          </div>
          <LaborHoursStepper
            value={repairLaborHours}
            onChange={handleRepairLaborChange}
            min="0.25"
            disabled={repairLaborMut.isPending || resetRepairLaborMut.isPending}
          />
        </div>
      )}

      {/* ── Revert confirm dialog ────────────────────────────────────────── */}
      <Dialog
        open={pendingRevert !== null}
        onOpenChange={(open) => {
          if (!open && !reverting) setPendingRevert(null);
        }}
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
              onClick={() => {
                if (pendingRevert) performRevert(pendingRevert.targetStatus);
              }}
              disabled={reverting}
              data-testid="revert-confirm"
            >
              {reverting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Remove work and switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fixed bottom navigation bar ─────────────────────────────────── */}
      {hasNavigation && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t shadow-lg pb-safe"
          data-testid="zone-bottom-nav"
        >
          <div className="max-w-2xl mx-auto flex items-center gap-2 px-3 py-3">
            <Button
              variant="outline"
              className="flex-1 min-h-[52px] text-base font-semibold"
              onClick={onNavigatePrev ?? undefined}
              disabled={onNavigatePrev == null}
              data-testid="btn-zone-prev"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Previous
            </Button>
            <Button
              className={`flex-1 min-h-[52px] text-base font-semibold ${
                isLastZone
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : ""
              }`}
              onClick={onNavigateNext}
              data-testid="btn-zone-next"
            >
              {isLastZone ? (
                <>Review &amp; Submit</>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-5 h-5 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

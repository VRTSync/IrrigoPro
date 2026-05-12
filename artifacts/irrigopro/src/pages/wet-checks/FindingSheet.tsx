import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiRequest, queryClient, useArrayQuery } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { buildFindingSavePayload } from "@/lib/finding-save-payload";
import {
  createFinding as offlineCreateFinding,
  updateFinding as offlineUpdateFinding,
  linkPhotoToFinding as offlineLinkPhotoToFinding,
  cachedApiRequest,
} from "@/lib/offline/api";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import { openOfflineDB, putFindingMirror } from "@/lib/offline/db";
import type {
  WetCheckPhoto,
  WetCheckFinding,
  IssueTypeConfig,
  Part,
} from "@workspace/db/schema";
import { newClientId } from "./helpers";
import { PhotoCaptureButton } from "./PhotoCaptureButton";
import { PhotoThumb } from "./PhotoThumb";
import { PendingPhotosGrid } from "./PendingPhotosGrid";

export type FindingSheetState =
  | { open: false }
  | { open: true; mode: "create"; issueType: string }
  | { open: true; mode: "edit"; finding: WetCheckFinding };

// ─── Finding sheet (create or edit; with part picker + qty + hours) ──────────

export function FindingSheet({
  state,
  onClose,
  zoneRecordId,
  zoneRecordClientId,
  wetCheckId,
  wetCheckClientId,
  customerId,
  photos,
  readOnly,
}: {
  state: FindingSheetState;
  onClose: () => void;
  zoneRecordId: number | null;
  zoneRecordClientId: string | null;
  wetCheckId: number;
  wetCheckClientId: string | null;
  customerId: number;
  photos: WetCheckPhoto[];
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const open = state.open;
  const mode = open ? state.mode : "create";
  const editing = open && state.mode === "edit" ? state.finding : null;
  const issueType = open
    ? (state.mode === "create" ? state.issueType : state.finding.issueType)
    : "";

  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partFromEdit, setPartFromEdit] = useState<{ id: number | null; name: string | null; price: string | null } | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [laborHours, setLaborHours] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [repairedInField, setRepairedInField] = useState<boolean>(false);
  // Task #464 — labor-only Mark Complete confirmation. Visible only while
  // Mark Complete is on AND no part is selected. Picking a part clears it.
  const [noPartNeeded, setNoPartNeeded] = useState<boolean>(false);
  // Photos picked while creating a finding (before save). Uploaded immediately
  // with findingId=null and linked to the new finding once saveMut succeeds.
  const [pendingPhotos, setPendingPhotos] = useState<WetCheckPhoto[]>([]);

  const { data: configs = [] } = useArrayQuery<IssueTypeConfig>({ queryKey: ["/api/wet-checks/issue-types"], queryFn: () => cachedApiRequest(`/api/wet-checks/issue-types`), enabled: open });
  const cfg = configs.find(c => c.issueType === issueType);
  // Slice 3 — flag-gated helper text on the Mark Complete toggle. With
  // auto-bill OFF, we restore the Slice 2 wording so the tech isn't
  // told an auto-bill will happen when none will.
  const { data: autoBillCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/config/wet-check-auto-bill"],
    staleTime: 5 * 60 * 1000,
  });
  const autoBillEnabled = autoBillCfg?.enabled ?? true;

  useEffect(() => {
    if (!open) return;
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
      setPendingPhotos([]);
    }
    setSearch("");
  }, [open, editing?.id, cfg?.defaultLaborHours]);

  const { data: partsResp } = useQuery<{ parts: Part[]; recentPartIds: number[] }>({
    queryKey: ["/api/wet-checks/parts/by-issue", issueType, customerId],
    queryFn: () => cachedApiRequest(`/api/wet-checks/parts/by-issue?issueType=${encodeURIComponent(issueType)}&customerId=${customerId}`),
    enabled: open && !!issueType,
  });
  const partsList = partsResp?.parts ?? [];
  const recentSet = useMemo(() => new Set(partsResp?.recentPartIds ?? []), [partsResp?.recentPartIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partsList.filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    );
  }, [partsList, search]);

  const recentParts = filtered.filter(p => recentSet.has(p.id)).slice(0, 12);
  const otherParts = filtered.filter(p => !recentSet.has(p.id)).slice(0, 60);

  // Task #464 — picking a part always wins over the labor-only flag, so
  // they can never both be true. Mirrors the server-side guard in
  // updateWetCheckFinding.
  const hasPartSelected = (selectedPart?.id ?? partFromEdit?.id ?? null) != null;
  useEffect(() => {
    if (hasPartSelected && noPartNeeded) setNoPartNeeded(false);
  }, [hasPartSelected, noPartNeeded]);

  type SaveResult = { id: number; clientId: string };
  const saveMut = useMutation<SaveResult, Error, void>({
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
        // Edit path goes through the offline wrapper so the patch is
        // queued + mirror-updated when the tech is offline.
        if (isOfflineQueueEnabled() && editing.clientId) {
          await offlineUpdateFinding(editing.clientId, editing.id, payload);
          return { id: editing.id, clientId: editing.clientId };
        }
        const updated = await apiRequest(`/api/wet-checks/findings/${editing.id}`, "PATCH", payload);
        return { id: updated.id ?? editing.id, clientId: updated.clientId ?? editing.clientId ?? "" };
      }
      const findingClientId = newClientId();
      let createdId: number | null = null;
      // When the offline flag is enabled, always route create through the
      // offline wrapper so dependency-order replay holds even on flaky
      // connections. Photo linking is queued through `photo.link` whose
      // `{{f}}` placeholder resolves once the create drains.
      if (isOfflineQueueEnabled() && zoneRecordClientId) {
        const res = await offlineCreateFinding({
          zoneRecordClientId,
          zoneRecordId: zoneRecordId ?? undefined,
          wetCheckId,
          payload: { ...payload, issueType },
          clientId: findingClientId,
        });
        createdId = res.id ?? null;
        if (pendingPhotos.length > 0) {
          // Task #510 — address each photo by its own clientId so the
          // queued PATCH carries the {{p}} placeholder, not the
          // optimistic negative numeric id. The engine waits for the
          // upload to complete and then dispatches against the real
          // server photo id.
          await Promise.all(
            pendingPhotos
              .filter((p) => p.clientId)
              .map((p) =>
                offlineLinkPhotoToFinding({
                  photoClientId: p.clientId!,
                  photoId: p.id > 0 ? p.id : undefined,
                  findingClientId,
                }),
              ),
          );
        }
      } else {
        const created = await apiRequest(
          `/api/wet-checks/zone-records/${zoneRecordId}/findings`,
          "POST",
          { ...payload, issueType, clientId: findingClientId },
        );
        createdId = created?.id ?? null;
        if (pendingPhotos.length > 0 && createdId != null) {
          if (isOfflineQueueEnabled()) {
            // Photos may have been captured via the offline-photos
            // pipeline (negative id, blob URL, queued upload). Route
            // the link through the engine so it waits for each upload
            // to complete before dispatching the PATCH against the
            // real server id. Seed the finding mirror with the id we
            // just got back so the {{f}} placeholder resolves
            // immediately for queued links.
            const db = await openOfflineDB();
            await putFindingMirror(db, {
              clientId: findingClientId,
              id: createdId,
              zoneRecordClientId:
                zoneRecordClientId ?? `server-zr-${zoneRecordId}`,
              zoneRecordId: zoneRecordId ?? undefined,
              wetCheckId,
              data: { ...payload, id: createdId, clientId: findingClientId, issueType },
              updatedAt: Date.now(),
            });
            await Promise.all(
              pendingPhotos
                .filter((p) => p.clientId)
                .map((p) =>
                  offlineLinkPhotoToFinding({
                    photoClientId: p.clientId!,
                    photoId: p.id > 0 ? p.id : undefined,
                    findingClientId,
                    findingId: createdId,
                  }),
                ),
            );
          } else {
            const results = await Promise.allSettled(
              pendingPhotos.map((p) =>
                apiRequest(`/api/wet-checks/photos/${p.id}`, "PATCH", { findingId: createdId }),
              ),
            );
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed > 0) {
              toast({
                title: "Some photos didn't attach",
                description: `${failed} photo(s) couldn't be linked to the finding. You can re-add them by editing it.`,
                variant: "destructive",
              });
            }
          }
        }
      }
      return { id: createdId ?? 0, clientId: findingClientId };
    },
    onSuccess: () => {
      toast({ title: mode === "edit" ? "Finding updated" : "Finding added" });
      // Invalidate the prefix so both id-keyed and clientId-keyed detail
      // queries (`["/api/wet-checks", id]` and `["/api/wet-checks", "c", clientId]`)
      // are refreshed. Important for offline-created wet checks that have no
      // server id yet.
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      setPendingPhotos([]);
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const removePendingPhoto = async (photoId: number) => {
    try {
      await apiRequest(`/api/wet-checks/photos/${photoId}`, "DELETE");
      setPendingPhotos(prev => prev.filter(p => p.id !== photoId));
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const renderPartButton = (p: Part) => {
    const effId = selectedPart?.id ?? partFromEdit?.id ?? null;
    const isSel = effId === p.id;
    return (
      <button
        key={p.id}
        type="button"
        className={`w-full text-left p-2 rounded text-sm ${isSel ? "bg-blue-100" : "hover:bg-gray-100"}`}
        onClick={() => setSelectedPart(p)}
        data-testid={`part-${p.id}`}
      >
        <div className="font-medium">{p.name}</div>
        <div className="text-xs text-gray-500">{p.sku} · ${p.price}</div>
      </button>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(b) => { if (!b) onClose(); }}>
      <SheetContent side="bottom" className="h-[90vh] sm:h-[85vh] overflow-y-auto pb-safe">
        <SheetHeader>
          <SheetTitle>
            {mode === "edit" ? "Edit finding · " : ""}
            {cfg?.displayLabel ?? issueType.replace(/_/g, " ")}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div>
            <div className="text-sm font-medium mb-1">Part {cfg?.partCategoryFilter ? `(${cfg.partCategoryFilter})` : ""}</div>
            <Input placeholder="Search parts..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 text-base" data-testid="finding-part-search" />
            <div className="max-h-48 sm:max-h-64 overflow-y-auto mt-2 space-y-2 border rounded p-1">
              {filtered.length === 0 && <div className="text-center text-xs text-gray-500 py-4">No parts</div>}
              {recentParts.length > 0 && (
                <div data-testid="parts-recent-section">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-1">Recent at this property</div>
                  {recentParts.map(renderPartButton)}
                </div>
              )}
              {otherParts.length > 0 && (
                <div>
                  {recentParts.length > 0 && (
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-2 border-t mt-1">All parts</div>
                  )}
                  {otherParts.map(renderPartButton)}
                </div>
              )}
            </div>
            {partFromEdit && !selectedPart && partFromEdit.id && (
              <div className="text-xs text-gray-500 mt-1">Currently: {partFromEdit.name}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm font-medium mb-1">Quantity</div>
              <Input type="number" inputMode="numeric" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-11 text-base" data-testid="finding-qty" />
            </div>
            <div>
              <div className="text-sm font-medium mb-1">Labor hours</div>
              <Input type="number" inputMode="decimal" step="0.05" min={0} value={laborHours} onChange={(e) => setLaborHours(e.target.value)} className="h-11 text-base" data-testid="finding-hours" />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Notes</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-base" data-testid="finding-notes" />
          </div>

          {editing ? (
            <div data-testid="finding-sheet-photos">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium">Photos</div>
                {!readOnly && (
                  <PhotoCaptureButton
                    wetCheckId={wetCheckId}
                    wetCheckClientId={wetCheckClientId}
                    zoneRecordId={zoneRecordId}
                    zoneRecordClientId={zoneRecordClientId}
                    findingId={editing.id}
                    findingClientId={editing.clientId ?? null}
                  />
                )}
              </div>
              {(() => {
                const fp = photos.filter(p => p.findingId === editing.id);
                if (fp.length === 0) {
                  return <div className="text-xs text-gray-500">No photos yet.</div>;
                }
                return (
                  <div className="flex flex-wrap gap-2">
                    {fp.map(p => (
                      <PhotoThumb
                        key={p.id}
                        photo={p}
                        canDelete={!readOnly}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : (
            !readOnly && (
              <div data-testid="finding-sheet-photos">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">Photos</div>
                  {(zoneRecordId || (isOfflineQueueEnabled() && zoneRecordClientId)) && (
                    <PhotoCaptureButton
                      wetCheckId={wetCheckId}
                      wetCheckClientId={wetCheckClientId}
                      zoneRecordId={zoneRecordId}
                      zoneRecordClientId={zoneRecordClientId}
                      findingId={null}
                      findingClientId={null}
                      skipInvalidate
                      testIdSuffix="pending"
                      onUploaded={(photo) => setPendingPhotos(prev => [...prev, photo])}
                    />
                  )}
                </div>
                {pendingPhotos.length === 0 ? (
                  <div className="text-xs text-gray-500">
                    {(zoneRecordId || (isOfflineQueueEnabled() && zoneRecordClientId))
                      ? "No photos yet. Photos picked here attach automatically when you save."
                      : "Pick a zone before adding photos."}
                  </div>
                ) : (
                  <PendingPhotosGrid
                    pendingPhotos={pendingPhotos}
                    onRemove={removePendingPhoto}
                  />
                )}
              </div>
            )
          )}

          <label className="flex items-start gap-2 text-sm" data-testid="finding-repaired-toggle">
            <input
              type="checkbox"
              checked={repairedInField}
              onChange={(e) => setRepairedInField(e.target.checked)}
              className="h-4 w-4 mt-0.5"
            />
            <span>
              <span className="font-medium">Mark complete — wet check work completed in field</span>
              <span className="block text-xs text-gray-500">
                {autoBillEnabled
                  ? "Will auto-bill on submit. Leave unchecked to send to the manager for routing."
                  : "Marks this finding as wet check work completed in the field. Leave unchecked to send to the manager for routing."}
              </span>
            </span>
          </label>

          {/* Task #464 — labor-only confirmation. Only meaningful while
              the finding is being marked complete with no part chosen
              (e.g. clearing a clogged nozzle, tightening a fitting).
              Picking a part automatically clears this. */}
          {repairedInField && !hasPartSelected && (
            <label
              className="flex items-start gap-2 text-sm rounded border border-amber-200 bg-amber-50 p-2"
              data-testid="finding-no-part-needed-toggle"
            >
              <input
                type="checkbox"
                checked={noPartNeeded}
                onChange={(e) => setNoPartNeeded(e.target.checked)}
                className="h-4 w-4 mt-0.5"
                data-testid="finding-no-part-needed-checkbox"
              />
              <span>
                <span className="font-medium">No part needed (labor only)</span>
                <span className="block text-xs text-gray-700">
                  Confirm this is a labor-only fix — the billing line will be labor only with no part charge.
                </span>
              </span>
            </label>
          )}

          <Button
            className="w-full min-h-[48px]"
            size="lg"
            disabled={saveMut.isPending || (mode === "create" && !zoneRecordId && !(isOfflineQueueEnabled() && zoneRecordClientId))}
            onClick={() => saveMut.mutate()}
            data-testid="finding-save"
          >
            {saveMut.isPending
              ? <Loader2 className="animate-spin" />
              : mode === "edit" ? "Save Changes" : "Save Finding"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Task #1437 — Inspection work-order tech zone checklist.
//
// Renders the approved work for an inspection-origin work order as a
// zone-grouped (Controller → Zone) check-off list. The tech taps each item to
// mark it done (optimistic toggle through
// PATCH /api/work-orders/:id/items/:itemId/complete) and attaches
// completed-work photos per zone (the structured work_order_zone_photos store,
// NOT the flat work_orders.photos array).
//
// Pure check-off: NO actuals / pricing / labor entry on the tech side. The
// "Complete work order" button is enabled only when every item is done and
// routes through the existing completion pipeline via the onComplete prop.

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileUpload, type UploadedFile } from "@/components/ui/file-upload";
import { PhotoImage } from "@/components/ui/photo-image";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle, Camera, MapPin, ClipboardCheck, Trash2, Loader2 } from "lucide-react";
import type { WorkOrder } from "@workspace/db/schema";

interface WorkOrderItemLike {
  id: number;
  partName?: string | null;
  description?: string | null;
  quantity?: number | null;
  controllerLetter?: string | null;
  zoneNumber?: number | null;
  issueType?: string | null;
  completedAt?: string | Date | null;
}

interface ZonePhoto {
  id: number;
  workOrderId: number;
  workOrderItemId: number | null;
  controllerLetter: string | null;
  zoneNumber: number | null;
  url: string;
  caption: string | null;
  takenAt: string | null;
}

interface InspectionZoneChecklistProps {
  workOrder: WorkOrder;
  readOnly?: boolean;
  onComplete?: () => void;
}

// An inspection-origin WO is one whose items carry controller/zone tags, or
// that links back to a source wet check.
export function isInspectionOriginWorkOrder(
  workOrder: WorkOrder,
  items: WorkOrderItemLike[] | undefined,
): boolean {
  if ((workOrder as any).originWetCheckId != null) return true;
  return Array.isArray(items)
    ? items.some((i) => i.controllerLetter != null || i.zoneNumber != null)
    : false;
}

interface ZoneGroup {
  key: string;
  controllerLetter: string | null;
  zoneNumber: number | null;
  label: string;
  items: WorkOrderItemLike[];
}

function groupItemsByZone(items: WorkOrderItemLike[]): ZoneGroup[] {
  const map = new Map<string, ZoneGroup>();
  for (const item of items) {
    const c = item.controllerLetter ?? null;
    const z = item.zoneNumber ?? null;
    const key = `${c ?? "—"}|${z ?? "—"}`;
    let group = map.get(key);
    if (!group) {
      const label =
        c == null && z == null
          ? "Unzoned"
          : `Controller ${c ?? "—"} · Zone ${z ?? "—"}`;
      group = { key, controllerLetter: c, zoneNumber: z, label, items: [] };
      map.set(key, group);
    }
    group.items.push(item);
  }
  // Sort: zoned groups first (by controller then zone), unzoned last.
  return Array.from(map.values()).sort((a, b) => {
    const aUn = a.controllerLetter == null && a.zoneNumber == null;
    const bUn = b.controllerLetter == null && b.zoneNumber == null;
    if (aUn !== bUn) return aUn ? 1 : -1;
    const ac = a.controllerLetter ?? "";
    const bc = b.controllerLetter ?? "";
    if (ac !== bc) return ac.localeCompare(bc);
    return (a.zoneNumber ?? 0) - (b.zoneNumber ?? 0);
  });
}

function itemLabel(item: WorkOrderItemLike): string {
  const base = item.description?.trim() || item.partName?.trim() || "Work item";
  const qty = item.quantity != null && item.quantity > 1 ? ` ×${item.quantity}` : "";
  return `${base}${qty}`;
}

export function InspectionZoneChecklist({
  workOrder,
  readOnly = false,
  onComplete,
}: InspectionZoneChecklistProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const itemsKey = ["/api/work-orders", workOrder.id, "items"];
  const photosKey = ["/api/work-orders", workOrder.id, "zone-photos"];

  const { data: items = [] } = useQuery<WorkOrderItemLike[]>({ queryKey: itemsKey });
  const { data: zonePhotos = [] } = useQuery<ZonePhoto[]>({ queryKey: photosKey });

  const groups = useMemo(() => groupItemsByZone(Array.isArray(items) ? items : []), [items]);
  const total = Array.isArray(items) ? items.length : 0;
  const doneCount = Array.isArray(items) ? items.filter((i) => i.completedAt != null).length : 0;
  const remaining = total - doneCount;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const photosByZone = useMemo(() => {
    const map = new Map<string, ZonePhoto[]>();
    for (const p of Array.isArray(zonePhotos) ? zonePhotos : []) {
      const key = `${p.controllerLetter ?? "—"}|${p.zoneNumber ?? "—"}`;
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return map;
  }, [zonePhotos]);

  // Optimistic per-item toggle.
  const toggleMutation = useMutation({
    mutationFn: async (vars: { itemId: number; completed: boolean }) => {
      return apiRequest(
        `/api/work-orders/${workOrder.id}/items/${vars.itemId}/complete`,
        "PATCH",
        { completed: vars.completed },
      );
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const previous = queryClient.getQueryData<WorkOrderItemLike[]>(itemsKey);
      queryClient.setQueryData<WorkOrderItemLike[]>(itemsKey, (old) =>
        Array.isArray(old)
          ? old.map((i) =>
              i.id === vars.itemId
                ? { ...i, completedAt: vars.completed ? new Date().toISOString() : null }
                : i,
            )
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(itemsKey, ctx.previous);
      toast({
        title: "Couldn't update item",
        description: "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey });
    },
  });

  const attachPhotoMutation = useMutation({
    mutationFn: async (vars: {
      url: string;
      controllerLetter: string | null;
      zoneNumber: number | null;
    }) => {
      return apiRequest(`/api/work-orders/${workOrder.id}/zone-photos`, "POST", {
        url: vars.url,
        controllerLetter: vars.controllerLetter,
        zoneNumber: vars.zoneNumber,
        takenAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: photosKey });
    },
    onError: () => {
      toast({
        title: "Couldn't save photo",
        description: "The upload finished but linking it to the zone failed. Please retry.",
        variant: "destructive",
      });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async (photoId: number) => {
      return apiRequest(`/api/work-orders/${workOrder.id}/zone-photos/${photoId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: photosKey });
    },
    onError: () => {
      toast({ title: "Couldn't remove photo", variant: "destructive" });
    },
  });

  const handleToggle = (item: WorkOrderItemLike) => {
    if (readOnly) return;
    toggleMutation.mutate({ itemId: item.id, completed: item.completedAt == null });
  };

  const handleMarkZoneDone = (group: ZoneGroup) => {
    if (readOnly) return;
    for (const item of group.items) {
      if (item.completedAt == null) {
        toggleMutation.mutate({ itemId: item.id, completed: true });
      }
    }
  };

  // FileUpload reports each finished upload via onFilesChange with the canonical
  // photoId in `url`. We diff against the last seen URL set per zone and POST
  // any new ones to the zone-photo store.
  const handleZoneFiles = (group: ZoneGroup, files: UploadedFile[]) => {
    const existing = new Set((photosByZone.get(group.key) ?? []).map((p) => p.url));
    for (const f of files) {
      if (!f.url || existing.has(f.url)) continue;
      existing.add(f.url);
      attachPhotoMutation.mutate({
        url: f.url,
        controllerLetter: group.controllerLetter,
        zoneNumber: group.zoneNumber,
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-emerald-500">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-emerald-600" />
              Zone Checklist
            </CardTitle>
            {(workOrder as any).originWetCheckId != null && (
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
                From inspection #{(workOrder as any).originWetCheckId}
              </Badge>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">
                {doneCount} of {total} done
              </span>
              <span className="font-medium text-emerald-700">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-5">
          {groups.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">No work items on this order.</p>
          )}
          {groups.map((group) => {
            const zoneDone = group.items.filter((i) => i.completedAt != null).length;
            const zonePhotosList = photosByZone.get(group.key) ?? [];
            return (
              <div key={group.key} className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between gap-2 bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-medium text-gray-800 truncate">{group.label}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {zoneDone}/{group.items.length}
                    </Badge>
                  </div>
                  {!readOnly && zoneDone < group.items.length && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 h-7"
                      onClick={() => handleMarkZoneDone(group)}
                      data-testid={`zone-mark-done-${group.key}`}
                    >
                      Mark zone done
                    </Button>
                  )}
                </div>

                <div className="divide-y divide-gray-100">
                  {group.items.map((item) => {
                    const done = item.completedAt != null;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={readOnly}
                        onClick={() => handleToggle(item)}
                        className={`w-full flex items-start gap-3 text-left px-3 py-3 min-h-[52px] transition-colors ${
                          readOnly ? "cursor-default" : "hover:bg-emerald-50/50 active:bg-emerald-50"
                        }`}
                        data-testid={`zone-item-${item.id}`}
                      >
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                            done
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "border-gray-300 bg-white"
                          }`}
                        >
                          {done && <CheckCircle className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm ${
                              done ? "line-through text-gray-400" : "text-gray-900"
                            }`}
                          >
                            {itemLabel(item)}
                          </span>
                          {item.issueType && (
                            <span className="mt-0.5 block text-xs text-gray-500">{item.issueType}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Per-zone completed-work photos */}
                <div className="border-t border-gray-200 bg-white px-3 py-3 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
                    <Camera className="w-3.5 h-3.5" />
                    Completed-work photos
                    {zonePhotosList.length > 0 && (
                      <span className="text-gray-400">({zonePhotosList.length})</span>
                    )}
                  </div>

                  {zonePhotosList.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {zonePhotosList.map((p) => (
                        <div key={p.id} className="relative group">
                          <PhotoImage
                            photoUrl={p.url}
                            alt={p.caption || "Completed work"}
                            className="w-full h-20 object-cover rounded border border-gray-200"
                            variant="thumb"
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => deletePhotoMutation.mutate(p.id)}
                              className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Remove photo"
                              data-testid={`zone-photo-delete-${p.id}`}
                            >
                              {deletePhotoMutation.isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!readOnly && (
                    <FileUpload
                      type="photo"
                      label="photo"
                      accept="image/*"
                      capture="environment"
                      multiple
                      files={[]}
                      onFilesChange={(files) => handleZoneFiles(group, files)}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {!readOnly && onComplete && (
            <div className="pt-1">
              <Button
                type="button"
                onClick={onComplete}
                disabled={remaining > 0 || total === 0}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white min-h-[44px]"
                data-testid="zone-checklist-complete"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {remaining > 0
                  ? `${remaining} item${remaining === 1 ? "" : "s"} left to check off`
                  : "Complete work order"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

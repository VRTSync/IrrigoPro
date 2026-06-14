import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { WetCheckPhoto } from "@workspace/db/schema";
import { PhotoThumb } from "./PhotoThumb";

export type LooseFindingOption = { id: number; label: string };

// Task #246 — Surfaces photos that were captured for a finding but failed
// to link (or were uploaded as zone-level evidence without ever being
// attached). Lets the tech delete them or attach them to an existing
// finding so nothing is silently lost on the wet check.
export function LoosePhotosSection({
  photos,
  findingOptions,
  wetCheckId,
  readOnly,
}: {
  photos: WetCheckPhoto[];
  findingOptions: LooseFindingOption[];
  wetCheckId: number;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const [busyPhotoId, setBusyPhotoId] = useState<number | null>(null);

  const attachMut = useMutation({
    mutationFn: async ({ photoId, findingId }: { photoId: number; findingId: number }) => {
      return apiRequest(`/api/wet-checks/photos/${photoId}`, "PATCH", { findingId });
    },
    onSuccess: () => {
      // Prefix-invalidate so both id-keyed (`["/api/wet-checks", id]`)
      // and clientId-keyed (`["/api/wet-checks", "c", clientId]`)
      // detail queries refresh — the latter matters for wet checks
      // opened via /c/:clientId before the create has dispatched.
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      toast({ title: "Photo attached" });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't attach photo",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      }),
    onSettled: () => setBusyPhotoId(null),
  });

  const deleteAllMut = useMutation({
    mutationFn: async () => {
      return apiRequest(`/api/wet-checks/${wetCheckId}/loose-photos`, "DELETE");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks"] });
      const n = data?.deleted ?? photos.length;
      toast({ title: `${n} loose photo${n === 1 ? "" : "s"} deleted` });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't delete loose photos",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      }),
  });

  if (photos.length === 0) return null;

  const uploadingCount = photos.filter((p) => p.id <= 0).length;
  const deletableCount = photos.length - uploadingCount;

  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 p-3 space-y-2"
      data-testid="loose-photos-section"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              {photos.length} loose photo{photos.length === 1 ? "" : "s"} — not attached to a work item
            </div>
            <div className="text-xs text-amber-800">
              {readOnly
                ? "These photos were captured but never linked to a specific finding."
                : "Attach each photo to the matching work item, or delete it if it isn't needed."}
            </div>
          </div>
        </div>
        {!readOnly && deletableCount > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                className="shrink-0"
                disabled={deleteAllMut.isPending}
                data-testid="delete-all-loose-photos"
              >
                {deleteAllMut.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                )}
                Delete all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all loose photos?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {deletableCount} loose photo{deletableCount === 1 ? "" : "s"} from this wet check. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteAllMut.mutate()}
                  data-testid="delete-all-loose-photos-confirm"
                >
                  Delete all {deletableCount} photo{deletableCount === 1 ? "" : "s"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      <div className="space-y-2">
        {photos.map((p) => {
          const isOptimistic = p.id <= 0;
          const busy = busyPhotoId === p.id && attachMut.isPending;
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 bg-white rounded border border-amber-200 p-2"
              data-testid={`loose-photo-${p.id}`}
            >
              <PhotoThumb photo={p} canDelete={!readOnly && !isOptimistic} />
              {isOptimistic ? (
                <div className="flex-1 flex items-center gap-1.5 text-xs text-amber-700" data-testid={`loose-photo-${p.id}-uploading`}>
                  <Upload className="w-3.5 h-3.5 animate-pulse shrink-0" />
                  Uploading…
                </div>
              ) : (
                <>
                  {!readOnly && findingOptions.length > 0 && (
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <Select
                        disabled={busy}
                        onValueChange={(value) => {
                          const findingId = parseInt(value, 10);
                          if (!Number.isFinite(findingId)) return;
                          setBusyPhotoId(p.id);
                          attachMut.mutate({ photoId: p.id, findingId });
                        }}
                      >
                        <SelectTrigger
                          className="h-9 text-xs"
                          data-testid={`loose-photo-${p.id}-attach-trigger`}
                        >
                          <SelectValue placeholder="Attach to finding…" />
                        </SelectTrigger>
                        <SelectContent>
                          {findingOptions.map((opt) => (
                            <SelectItem
                              key={opt.id}
                              value={String(opt.id)}
                              data-testid={`loose-photo-${p.id}-attach-option-${opt.id}`}
                            >
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {busy && <Loader2 className="w-4 h-4 animate-spin text-amber-700" />}
                    </div>
                  )}
                  {!readOnly && findingOptions.length === 0 && (
                    <div className="flex-1 text-xs text-amber-800">
                      Add a work item first, then re-open this section to attach the photo.
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

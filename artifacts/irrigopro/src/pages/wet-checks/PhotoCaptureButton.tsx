import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Camera, ImageIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  PHOTO_OFFLINE_MESSAGE,
  isProbablyOffline,
  isOfflinePhotosEnabled,
  ensurePersistentStorage,
  queuePhotoUpload,
} from "@/lib/offline/api";
import type { WetCheckPhoto } from "@workspace/db/schema";
import { getAuthHeaders, newClientId, uploadPhotoToStorage } from "./helpers";

// Compact photo capture button. Wraps a file input with camera capture and
// posts the resulting URL to /api/wet-checks/:id/photos with a client-side
// takenAt so true camera time survives offline-then-sync.
export function PhotoCaptureButton({
  wetCheckId,
  wetCheckClientId,
  zoneRecordId,
  zoneRecordClientId,
  findingId,
  findingClientId,
  onUploaded,
  skipInvalidate,
  testIdSuffix,
}: {
  wetCheckId: number;
  // 4C — when the OFFLINE_PHOTOS flag is on, the captured Blob is queued
  // through the offline engine using these clientIds as parents. The
  // wet-check clientId is required to take the offline path; without it
  // we fall back to the direct online sign→PUT→finalize flow.
  wetCheckClientId?: string | null;
  zoneRecordId?: number | null;
  zoneRecordClientId?: string | null;
  findingId?: number | null;
  findingClientId?: string | null;
  onUploaded?: (photo: WetCheckPhoto) => void;
  skipInvalidate?: boolean;
  testIdSuffix?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    // 4C path — offline-photos flag on AND we have a wet-check clientId
    // to anchor the queued mutation. Compresses + persists the Blob in
    // IndexedDB and enqueues the upload; engine drains it now (online)
    // or on reconnect (offline). Optimistic thumbnail comes from a
    // local object URL.
    if (isOfflinePhotosEnabled() && wetCheckClientId) {
      setBusy(true);
      try {
        // Best-effort persistent-storage request + tight-quota guard.
        // Fire-and-forget: never blocks capture.
        void ensurePersistentStorage().then((s) => {
          if (s.quotaTight) {
            toast({
              title: "Storage almost full",
              description: "Free up space on your device — queued photos may not save.",
              variant: "destructive",
            });
          }
        });
        const queued = await queuePhotoUpload({
          file,
          wetCheckClientId,
          wetCheckId,
          zoneRecordClientId: zoneRecordClientId ?? null,
          zoneRecordId: zoneRecordId ?? null,
          findingClientId: findingClientId ?? null,
          findingId: findingId ?? null,
        });
        // The compression spec says: silent fallback for ≤10MB originals,
        // toast only when the original was huge AND we couldn't compress.
        if (queued.usedFallback && queued.originalSize > 10 * 1024 * 1024) {
          toast({
            title: "Photo couldn't be compressed",
            description: "Uploading the original — this may be slow on weak signal.",
          });
        }
        if (!skipInvalidate) {
          queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
        }
        // Synthesize an optimistic photo for callers (FindingSheet
        // pre-save) that need a stable id to display the thumbnail.
        // The negative id is replaced by the real server id once the
        // metadata POST resolves and React Query refetches.
        const optimistic: WetCheckPhoto = {
          id: -Date.now(),
          wetCheckId,
          url: queued.localUrl || "",
          takenAt: new Date().toISOString(),
          zoneRecordId: zoneRecordId ?? null,
          findingId: findingId ?? null,
          clientId: queued.clientId,
        } as unknown as WetCheckPhoto;
        onUploaded?.(optimistic);
        toast({
          title: isProbablyOffline() ? "Photo queued offline" : "Photo attached",
          description: isProbablyOffline() ? "Will upload when you're back online." : undefined,
        });
      } catch (err: any) {
        toast({ title: "Photo capture failed", description: err?.message ?? "Try again", variant: "destructive" });
      } finally {
        setBusy(false);
      }
      return;
    }
    // Legacy direct-upload path. With the flag off, photos remain
    // online-only and we surface the Slice 4B message offline.
    if (isProbablyOffline()) {
      toast({ title: "Photo not captured", description: PHOTO_OFFLINE_MESSAGE, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
      const url = await uploadPhotoToStorage(file);
      const created: WetCheckPhoto = await apiRequest(`/api/wet-checks/${wetCheckId}/photos`, "POST", {
        url,
        takenAt,
        zoneRecordId: zoneRecordId ?? null,
        findingId: findingId ?? null,
        clientId: newClientId(),
      });
      if (!skipInvalidate) {
        queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", wetCheckId] });
      }
      onUploaded?.(created);
      toast({ title: "Photo attached" });
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const suffix = testIdSuffix ?? `${zoneRecordId ?? findingId ?? "wc"}`;
  return (
    <>
      {/* Camera input — `capture="environment"` opens the rear camera live.
          Library input omits `capture` so the OS shows the photo picker. Both
          paths share `onPick` so offline queueing, compression, EXIF
          handling, and thumbnails behave identically. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
        data-testid={`photo-input-${suffix}`}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
        data-testid={`photo-input-library-${suffix}`}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={busy}
            className="min-h-[44px]"
            data-testid={`btn-photo-${suffix}`}
          >
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Camera className="w-4 h-4 mr-1" />}
            Photo
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); cameraInputRef.current?.click(); }}
            data-testid={`btn-photo-${suffix}-camera`}
          >
            <Camera className="w-4 h-4 mr-2" />
            Take Photo
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => { e.preventDefault(); libraryInputRef.current?.click(); }}
            data-testid={`btn-photo-${suffix}-library`}
          >
            <ImageIcon className="w-4 h-4 mr-2" />
            Choose from Library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

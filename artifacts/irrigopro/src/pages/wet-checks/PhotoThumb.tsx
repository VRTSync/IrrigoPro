import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, authedPhotoSrc, queryClient } from "@/lib/queryClient";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import { useSyncEngineState } from "@/components/offline/sync-ui";
import type { WetCheckPhoto } from "@workspace/db/schema";

export function PhotoThumb({ photo, canDelete }: { photo: WetCheckPhoto; canDelete: boolean }) {
  const { toast } = useToast();
  const [imgError, setImgError] = useState(false);
  // Task #510 — split "bytes still uploading" from "no server row yet"
  // so the lightbox tap target is available the moment the upload
  // finalize POST returns, even if a follow-up `photo.link` PATCH is
  // still queued. We read the engine's view of the queue (the same
  // source the Sync queue UI uses) so we don't duplicate state.
  const photoClientId = (photo as { clientId?: string | null }).clientId ?? null;
  const snap = useSyncEngineState(isOfflineQueueEnabled());
  const uploadMut = photoClientId
    ? snap.mutations.find(
        (m) => m.kind === "photo.upload" && m.clientId === photoClientId,
      )
    : undefined;
  const uploading =
    !!uploadMut && (uploadMut.status === "pending" || uploadMut.status === "syncing");

  const isLocalUrl =
    typeof photo.url === "string" &&
    (photo.url.startsWith("blob:") || photo.url.startsWith("data:"));
  const hasServerUrl =
    !isLocalUrl && typeof photo.url === "string" && photo.url.length > 0;
  const hasServerId = photo.id > 0;

  const src = isLocalUrl ? photo.url : authedPhotoSrc(photo.url, "thumb");
  // Lightbox: tap a thumb to open the medium variant in a new tab. As
  // soon as the photo has a server URL and its upload mutation has
  // drained, we open it — the link PATCH being stuck no longer blocks
  // the tap target.
  const fullSrc =
    hasServerUrl && !uploading && !imgError ? authedPhotoSrc(photo.url, "medium") : null;

  function handleImgError() {
    // Only show the error placeholder for photos that have a real server id.
    // Optimistic/uploading photos may have a blob URL that resolves later.
    if (hasServerId && !uploading) {
      setImgError(true);
      toast({
        title: "Photo unavailable",
        description: "This photo could not be loaded and may need to be retaken.",
        variant: "destructive",
      });
    }
  }

  const delMut = useMutation({
    mutationFn: () => apiRequest(`/api/wet-checks/photos/${photo.id}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wet-checks", photo.wetCheckId] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  const imgElement = imgError ? null : (
    <img
      src={src}
      alt=""
      className="w-full h-full object-cover"
      loading="lazy"
      onError={handleImgError}
    />
  );

  return (
    <div className="relative inline-block w-20 h-20 rounded overflow-hidden border" data-testid={`photo-thumb-${photo.id}`}>
      {imgError ? (
        <div
          className="w-full h-full flex flex-col items-center justify-center bg-gray-100 text-gray-500 gap-1 p-1"
          data-testid={`photo-thumb-${photo.id}-error`}
        >
          <Camera className="w-6 h-6" />
          <span className="text-[9px] text-center leading-tight">Photo unavailable</span>
        </div>
      ) : fullSrc ? (
        <a href={fullSrc} target="_blank" rel="noreferrer" className="block w-full h-full">
          {imgElement}
        </a>
      ) : (
        imgElement
      )}
      {uploading && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30"
          data-testid={`photo-thumb-${photo.id}-uploading`}
        >
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        </div>
      )}
      {canDelete && hasServerId && (
        <button
          type="button"
          onClick={() => delMut.mutate()}
          className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
          aria-label="Delete photo"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

import { Loader2, Trash2 } from "lucide-react";
import { authedPhotoSrc } from "@/lib/queryClient";
import { isOfflineQueueEnabled } from "@/lib/offline/engine";
import { useSyncEngineState } from "@/components/offline/sync-ui";
import type { WetCheckPhoto } from "@workspace/db/schema";

// Pre-save pending photos grid for the FindingSheet. Mirrors PhotoThumb's
// Task #510 logic: open the lightbox as soon as the upload finalizes,
// keep the spinner overlay until then, and only allow remove once we
// have a real server id (or no offline-queue clientId at all).
export function PendingPhotosGrid({
  pendingPhotos,
  onRemove,
}: {
  pendingPhotos: WetCheckPhoto[];
  onRemove: (id: number) => void;
}) {
  const snap = useSyncEngineState(isOfflineQueueEnabled());
  return (
    <div className="flex flex-wrap gap-2" data-testid="pending-photos">
      {pendingPhotos.map((p) => {
        const photoClientId = (p as { clientId?: string | null }).clientId ?? null;
        const uploadMut = photoClientId
          ? snap.mutations.find(
              (m) => m.kind === "photo.upload" && m.clientId === photoClientId,
            )
          : undefined;
        const uploading =
          !!uploadMut &&
          (uploadMut.status === "pending" || uploadMut.status === "syncing");
        const isLocal =
          typeof p.url === "string" &&
          (p.url.startsWith("blob:") || p.url.startsWith("data:"));
        const hasServerUrl =
          !isLocal && typeof p.url === "string" && p.url.length > 0;
        const hasServerId = p.id > 0;
        const src = isLocal ? p.url : authedPhotoSrc(p.url, "thumb");
        const fullSrc =
          hasServerUrl && !uploading ? authedPhotoSrc(p.url, "medium") : null;
        return (
          <div
            key={p.id}
            className="relative inline-block w-20 h-20 rounded overflow-hidden border"
            data-testid={`pending-photo-${p.id}`}
          >
            {fullSrc ? (
              <a
                href={fullSrc}
                target="_blank"
                rel="noreferrer"
                className="block w-full h-full"
              >
                <img
                  src={src}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </a>
            ) : (
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            )}
            {uploading && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/30"
                data-testid={`pending-photo-${p.id}-uploading`}
              >
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            )}
            {hasServerId && (
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
                aria-label="Remove queued photo"
                data-testid={`remove-pending-photo-${p.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from "react";
import { getDocPhotoBlob } from "@/lib/offline/doc-photos";
import { getSyncEngine } from "@/lib/offline/engine";
import { docOwner } from "@/lib/offline/doc-store";
export function useResolvedDocPhoto(current: string | null, authoritative: string | null | undefined, replace: (value: string | null) => void) {
  useEffect(() => {
    if (!current?.startsWith("local:") || authoritative === undefined || authoritative?.startsWith("local:")) return;
    let cancelled = false;
    void getSyncEngine().listMutations().then(queue => {
      const m = queue.find(m => m.clientId === current.slice(6) && m.docOwner === docOwner());
      if (!cancelled && (!m || (m.status === "completed" && !m.docRefused))) replace(authoritative);
    });
    return () => { cancelled = true; };
  }, [current, authoritative]);
}

export function useDocPhotoSrc(photoId: string | null) {
  const [local, setLocal] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!photoId?.startsWith("local:")) return;
    let cancelled = false, url: string | null = null;
    void getDocPhotoBlob(photoId).then(blob => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setLocal({ id: photoId, url });
    }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [photoId]);
  return photoId?.startsWith("local:") ? local?.id === photoId ? local.url : undefined
    : photoId ? `/api/photos/${photoId}?variant=medium` : undefined;
}
export function DocPhotoPreview({ photoId, alt, className }: { photoId: string; alt: string; className?: string }) {
  const src = useDocPhotoSrc(photoId);
  return <div>
    {src && <img src={src} alt={alt} className={className} />}
    {photoId.startsWith("local:") && <p className="text-xs text-amber-800" data-testid="text-photo-pending">Waiting to upload</p>}
  </div>;
}

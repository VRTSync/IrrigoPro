import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { safeGet } from "@/utils/safeStorage";
import { ImageOff, Loader2 } from "lucide-react";

export type PhotoVariant = "thumb" | "medium" | "original";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const saved = safeGet("user");
    if (saved) {
      const user = JSON.parse(saved);
      if (user?.role) {
        headers["x-user-role"] = user.role;
        headers["x-user-id"] = user.id?.toString() || "";
        headers["x-user-name"] = user.name || "";
        headers["x-user-company-id"] = user.companyId?.toString() || "";
      }
    }
  } catch {
  }
  return headers;
}

function normalizePhotoId(photoUrl: string): string | null {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("blob:")) return null;
  if (photoUrl.startsWith("/uploads/")) {
    return photoUrl.replace(/^\/uploads\//, "uploads/");
  }
  if (photoUrl.startsWith("/api/")) {
    return photoUrl.replace(/^\/api\/photos\//, "");
  }
  if (photoUrl.startsWith("http")) return null;
  return photoUrl;
}

// Batch hook — resolve signed URLs for many photoIds in a single round-trip.
// Returns a map of photoId → url|null. Use in galleries to avoid N requests.
export function usePhotoSignedUrls(photoUrls: string[], variant: PhotoVariant = "medium") {
  const ids = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of photoUrls) {
      const id = normalizePhotoId(u);
      if (id && !seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  }, [photoUrls]);

  const query = useQuery<{ variant: PhotoVariant; results: Array<{ photoId: string; url: string | null }> }>({
    queryKey: ["/api/photos/signed-urls", variant, ids],
    queryFn: async () => {
      const res = await fetch("/api/photos/signed-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ photoIds: ids, variant }),
      });
      if (!res.ok) throw new Error("Failed to batch sign URLs");
      return res.json();
    },
    enabled: ids.length > 0,
    staleTime: 12 * 60 * 1000,
    retry: 1,
  });

  const map = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of query.data?.results || []) m.set(r.photoId, r.url);
    return m;
  }, [query.data]);

  // Lookup helper that takes an original photoUrl (same string passed to
  // <PhotoImage photoUrl={...}>) and returns its resolved signed URL, or
  // undefined when the batch query has not yet returned.
  const getUrl = (photoUrl: string): string | null | undefined => {
    if (photoUrl?.startsWith("blob:") || photoUrl?.startsWith("http")) return photoUrl;
    const id = normalizePhotoId(photoUrl);
    if (!id) return null;
    return map.has(id) ? map.get(id)! : undefined;
  };

  return { urls: map, getUrl, isLoading: query.isLoading, isError: query.isError, hasIds: ids.length > 0 };
}

interface PhotoImageProps {
  photoUrl: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
  // Display variant. Default: "medium". Use "thumb" for grid/card thumbnails
  // and "original" for explicit downloads.
  variant?: PhotoVariant;
  // If a parent has already batched the signed URL, pass it through to skip
  // the per-image network round-trip.
  signedUrlOverride?: string | null;
  // When true, this PhotoImage is part of a batched gallery: it will NEVER
  // issue its own /signed-url request. While `signedUrlOverride` is undefined
  // it shows a skeleton; null shows an error; a string renders the image.
  batchManaged?: boolean;
}

export function PhotoImage({
  photoUrl,
  alt = "Photo",
  className = "",
  onClick,
  variant = "medium",
  signedUrlOverride,
  batchManaged = false,
}: PhotoImageProps) {
  const photoId = normalizePhotoId(photoUrl);
  const isBlobOrDirect = photoUrl.startsWith("blob:") || photoUrl.startsWith("http");

  const { data, isLoading, isError } = useQuery<{ url: string }>({
    queryKey: ["/api/photos", photoId, variant, "signed-url"],
    queryFn: async () => {
      const res = await fetch(`/api/photos/${photoId}/signed-url?variant=${variant}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch signed URL");
      return res.json();
    },
    enabled: !!photoId && !isBlobOrDirect && !batchManaged && signedUrlOverride === undefined,
    staleTime: 12 * 60 * 1000,
    retry: 1,
  });

  const resolvedUrl = isBlobOrDirect
    ? photoUrl
    : signedUrlOverride !== undefined
      ? signedUrlOverride
      : (data?.url ?? null);

  const showLoading = !isBlobOrDirect && signedUrlOverride === undefined && (batchManaged || isLoading);
  const showError = !isBlobOrDirect && !showLoading && (
    signedUrlOverride === null || (signedUrlOverride === undefined && (isError || !resolvedUrl))
  );

  if (showLoading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`} onClick={onClick}>
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (showError || !resolvedUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`} onClick={onClick}>
        <ImageOff className="w-5 h-5 text-gray-400" />
      </div>
    );
  }

  return <img src={resolvedUrl} alt={alt} className={className} onClick={onClick} loading="lazy" />;
}

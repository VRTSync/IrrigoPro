import { useQuery } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";
import { ImageOff, Loader2 } from "lucide-react";

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

interface PhotoImageProps {
  photoUrl: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
}

export function PhotoImage({ photoUrl, alt = "Photo", className = "", onClick }: PhotoImageProps) {
  const photoId = normalizePhotoId(photoUrl);

  const isBlobOrDirect = photoUrl.startsWith("blob:") || photoUrl.startsWith("http");

  const { data, isLoading, isError } = useQuery<{ url: string }>({
    queryKey: ["/api/photos", photoId, "signed-url"],
    queryFn: async () => {
      const res = await fetch(`/api/photos/${photoId}/signed-url`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch signed URL");
      return res.json();
    },
    enabled: !!photoId && !isBlobOrDirect,
    staleTime: 12 * 60 * 1000,
    retry: 1,
  });

  const resolvedUrl = isBlobOrDirect ? photoUrl : (data?.url ?? null);

  if (!isBlobOrDirect && isLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className}`}
        onClick={onClick}
      >
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!isBlobOrDirect && (isError || !resolvedUrl)) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 ${className}`}
        onClick={onClick}
      >
        <ImageOff className="w-5 h-5 text-gray-400" />
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl!}
      alt={alt}
      className={className}
      onClick={onClick}
    />
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paperclip } from "lucide-react";
import { PhotoImage, usePhotoSignedUrls } from "@/components/ui/photo-image";

// Task #666 — shared "Photos & Attachments" block used by the estimate
// detail modal AND the pending-approval review page so managers see
// exactly what the customer will see on the approval link. Renders
// nothing when both arrays are empty. Photos use the batched
// signed-URL pattern so an N-photo estimate costs one round trip.
// Attachments are listed as filename labels with a clickable link
// when the URL is a parseable http(s) URL.

export function attachmentDisplayName(url: string): string {
  if (!url) return "attachment";
  try {
    const u = new URL(url, window.location.origin);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  const last = url.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : url;
}

function isLinkableUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export interface EstimateMediaBlockProps {
  photos: string[];
  attachments: string[];
  // Render as a bordered Card (default), or as a bare block for inline
  // use (e.g. pending-approval expansion row).
  variant?: "card" | "inline";
  // Identifier suffix for `data-testid` attributes so multiple
  // instances on one page remain addressable.
  testIdPrefix?: string;
}

export function EstimateMediaBlock({
  photos,
  attachments,
  variant = "card",
  testIdPrefix = "estimate",
}: EstimateMediaBlockProps) {
  const { getUrl, hasIds } = usePhotoSignedUrls(photos, "thumb");

  if (photos.length === 0 && attachments.length === 0) return null;

  const body = (
    <div className="space-y-5">
      {photos.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">
            Site Photos ({photos.length})
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {photos.map((photoUrl, i) => (
              <button
                key={`${photoUrl}-${i}`}
                type="button"
                onClick={() => {
                  const resolved = getUrl(photoUrl);
                  if (resolved) window.open(resolved, "_blank");
                }}
                className="aspect-square rounded-md border border-gray-200 bg-gray-50 overflow-hidden hover:ring-2 hover:ring-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
                data-testid={`${testIdPrefix}-photo-${i}`}
              >
                <PhotoImage
                  photoUrl={photoUrl}
                  variant="thumb"
                  batchManaged={hasIds}
                  signedUrlOverride={hasIds ? getUrl(photoUrl) : undefined}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
      {attachments.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">
            Attachments ({attachments.length})
          </div>
          <ul className="space-y-1">
            {attachments.map((url, i) => {
              const name = attachmentDisplayName(url);
              const linkable = isLinkableUrl(url);
              return (
                <li
                  key={`${url}-${i}`}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`${testIdPrefix}-attachment-${i}`}
                >
                  <Paperclip className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  {linkable ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {name}
                    </a>
                  ) : (
                    <span className="text-gray-700 break-all">{name}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  if (variant === "inline") return body;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Photos &amp; Attachments</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

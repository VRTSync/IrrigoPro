import { safeGet } from "@/utils/safeStorage";
import { preparePhotoForUpload } from "@/lib/photo-prep";

// UUIDv4 strict — server validators (z.string().uuid()) reject anything else,
// so the fallback path also emits a v4-shaped string when crypto.randomUUID
// is unavailable (older Safari, insecure contexts).
export const newClientId = (): string => {
  const cryptoObj: Crypto | undefined =
    typeof crypto !== "undefined" ? (crypto as Crypto) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// Retry a single async call up to `maxAttempts` times with exponential
// back-off. Returns the resolved value or throws the last error. Shared by
// the finding editors' post-save photo-link path so a single dropped packet
// or transient 5xx doesn't strand a photo as "loose" on the server.
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 400,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export function getCurrentUser(): { id: number; role: string; name?: string } | null {
  const raw = safeGet("user");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const u = getCurrentUser();
  if (u) {
    headers["x-user-role"] = u.role;
    headers["x-user-id"] = String(u.id);
    if (u.name) headers["x-user-name"] = u.name;
  }
  return headers;
}

// ─── Direct-to-storage photo upload (prep → sign → PUT → finalize) ───────────
// Mirrors the billing-sheet upload path: shared `preparePhotoForUpload`
// (HEIC→JPEG, ~1600px / ~0.35MB / q=0.80) + mandatory finalize so the
// server generates `thumb` / `medium` variants for galleries / lightbox.
export async function uploadPhotoToStorage(file: File): Promise<string> {
  const signRes = await fetch(`/api/upload/photo?originalName=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: getAuthHeaders(),
    credentials: "include",
  });
  if (!signRes.ok) throw new Error(`Failed to get upload URL (${signRes.status})`);
  const { signedUrl, url } = await signRes.json();

  const { displayFile } = await preparePhotoForUpload(file);

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    body: displayFile,
    headers: { "Content-Type": displayFile.type || "application/octet-stream" },
  });
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);

  const finalizeRes = await fetch("/api/upload/photo/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    credentials: "include",
    body: JSON.stringify({ photoId: url }),
  });
  if (!finalizeRes.ok) {
    let detail = `${finalizeRes.status}`;
    try { const body = await finalizeRes.json(); if (body?.message) detail = body.message; } catch {}
    throw new Error(`Photo finalize failed (${detail})`);
  }
  return url as string;
}

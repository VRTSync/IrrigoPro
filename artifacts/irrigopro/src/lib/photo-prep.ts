import imageCompression from "browser-image-compression";

// Result of preparing a photo for upload. Only a single, heavily-compressed
// display copy is produced — the server generates `thumb`/`medium` from this
// copy. We no longer ship a separate "preserved original" alongside it; that
// dual-upload roughly 10x'd the bytes a tech had to push from the field for
// no end-user benefit (PDFs and the in-app viewer both consume the medium
// variant).
export interface PreparedPhoto {
  displayFile: File;
  /** true when HEIC decode AND/OR display compression both threw and we're
   *  shipping the (post-HEIC if it succeeded) input bytes unchanged. */
  usedFallback: boolean;
}

// Best-effort client-side photo prep used by every upload entry point. Flow:
//   1. If the input is HEIC/HEIF, decode to JPEG once via heic2any.
//   2. Produce a tight display copy (~1600px / ~0.35MB / q=0.80).
// The compression pass falls back to the upstream bytes if it throws so an
// upload never gets stuck because of a prep failure.
export async function preparePhotoForUpload(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<PreparedPhoto> {
  let working: File = file;
  const lowerName = file.name.toLowerCase();
  const looksHeic = file.type === "image/heic" || file.type === "image/heif"
    || lowerName.endsWith(".heic") || lowerName.endsWith(".heif");

  if (looksHeic) {
    try {
      // heic2any is browser-only and has a heavy WASM payload — load it lazily.
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      working = new File(
        [blob],
        file.name.replace(/\.(heic|heif)$/i, ".jpg"),
        { type: "image/jpeg" },
      );
    } catch (err) {
      console.warn("[photo-prep] HEIC conversion failed, falling back to original bytes", err);
      // Fall through with the original file — the server will still handle HEIC.
    }
  }

  const reportDisplay = (pct: number) => {
    if (onProgress) onProgress(Math.max(0, Math.min(100, Math.round(pct))));
  };

  // Display copy — small enough to ship fast on weak LTE, sharp enough
  // to drive the 400px / 1200px server-generated variants.
  let displayFile: File;
  let usedFallback = false;
  try {
    displayFile = await imageCompression(working, {
      maxSizeMB: 0.35,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
      initialQuality: 0.80,
      fileType: working.type === "image/png" ? "image/jpeg" : undefined,
      onProgress: reportDisplay,
    });
  } catch (err) {
    console.warn("[photo-prep] display compression failed, uploading working bytes", err);
    displayFile = working;
    usedFallback = true;
    reportDisplay(100);
  }

  return { displayFile, usedFallback };
}

// 4C — offline-capture compressor. Targets the spec's ≤1MB / ≤1920px JPEG
// envelope so a queued photo is small enough to ship over weak LTE on
// reconnect, while still being sharp enough for the medium server variant.
// Always runs in a web worker so the main thread stays responsive while
// the tech keeps tapping zone buttons. Falls back to the original bytes
// on any failure (worker boot fail, decode error, OOM) so the upload is
// never blocked by prep — the spec's "compression fallback to original"
// rule. The caller decides whether to surface a toast based on the
// returned `originalSize` (≥10MB = warn; smaller = silent).
export interface CompressedPhoto {
  file: File;
  usedFallback: boolean;
  originalSize: number;
  compressedSize: number;
}
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const originalSize = file.size;
  let working: File = file;
  const lowerName = file.name.toLowerCase();
  const looksHeic = file.type === "image/heic" || file.type === "image/heif"
    || lowerName.endsWith(".heic") || lowerName.endsWith(".heif");
  if (looksHeic) {
    try {
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      working = new File(
        [blob],
        file.name.replace(/\.(heic|heif)$/i, ".jpg"),
        { type: "image/jpeg" },
      );
    } catch (err) {
      console.warn("[photo-prep] offline HEIC convert failed; queuing original bytes", err);
    }
  }
  try {
    const out = await imageCompression(working, {
      maxSizeMB: 1.0,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.85,
      fileType: working.type === "image/png" ? "image/jpeg" : undefined,
    });
    const outFile = out instanceof File
      ? out
      : new File([out], working.name, { type: (out as Blob).type || "image/jpeg" });
    return {
      file: outFile,
      usedFallback: false,
      originalSize,
      compressedSize: outFile.size,
    };
  } catch (err) {
    console.warn("[photo-prep] offline compression failed; queuing original bytes", err);
    return {
      file: working,
      usedFallback: true,
      originalSize,
      compressedSize: working.size,
    };
  }
}

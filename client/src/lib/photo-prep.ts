import imageCompression from "browser-image-compression";

// Result of preparing a photo for upload. The display file is heavily
// compressed for fast upload + variant generation; the original file is
// only lightly compressed so a near-pristine copy is preserved in the
// `originals/` bucket prefix without paying the full cost of a 5–15MB
// straight-from-camera JPEG/HEIC.
export interface PreparedPhoto {
  displayFile: File;
  originalFile: File;
}

// Best-effort client-side photo prep used by every upload entry point so
// both the display copy and the preserved original stay in sync. The flow:
//   1. If the input is HEIC/HEIF, decode to JPEG once via heic2any.
//   2. Produce a tight display copy (~1600px / ~0.35MB / q=0.80).
//   3. Produce a lightly-compressed "preserved original" (~3840px / q=0.90)
//      from the post-HEIC JPEG so HEIC isn't decoded twice.
// Each compression pass independently falls back to the upstream bytes if
// it throws so an upload never gets stuck because of a prep failure.
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

  // Split prep progress 0–50% display, 50–100% original so the bar keeps
  // moving across both passes.
  const reportDisplay = (pct: number) => {
    if (onProgress) onProgress(Math.max(0, Math.min(50, Math.round(pct / 2))));
  };
  const reportOriginal = (pct: number) => {
    if (onProgress) onProgress(Math.max(50, Math.min(100, 50 + Math.round(pct / 2))));
  };

  // 1. Display copy — small enough to ship fast on weak LTE, sharp enough
  // to drive the 400px / 1200px server-generated variants.
  let displayFile: File;
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
    reportDisplay(100);
  }

  // 2. Preserved original — lightly compressed (~10MP, ~90% quality) so the
  // stored copy is still good enough to print or zoom into but a fraction
  // of the size of a raw camera file. Reuses the post-HEIC JPEG as the
  // source so HEIC isn't decoded twice.
  let originalFile: File;
  try {
    originalFile = await imageCompression(working, {
      maxSizeMB: 4,
      maxWidthOrHeight: 3840,
      useWebWorker: true,
      initialQuality: 0.90,
      fileType: working.type === "image/png" ? "image/jpeg" : undefined,
      onProgress: reportOriginal,
    });
  } catch (err) {
    console.warn("[photo-prep] light original compression failed, uploading raw bytes", err);
    // Final safety net — the unmodified camera bytes still go up so the
    // preserved original is never lost just because compression broke.
    originalFile = file;
    reportOriginal(100);
  }

  return { displayFile, originalFile };
}

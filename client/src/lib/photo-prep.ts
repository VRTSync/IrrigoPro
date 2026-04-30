import imageCompression from "browser-image-compression";

// Result of preparing a photo for upload. Only a single, heavily-compressed
// display copy is produced — the server generates `thumb`/`medium` from this
// copy. We no longer ship a separate "preserved original" alongside it; that
// dual-upload roughly 10x'd the bytes a tech had to push from the field for
// no end-user benefit (PDFs and the in-app viewer both consume the medium
// variant).
export interface PreparedPhoto {
  displayFile: File;
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

  return { displayFile };
}

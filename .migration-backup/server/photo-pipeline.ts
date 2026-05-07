import sharp from "sharp";
import type { File } from "@google-cloud/storage";

// ── Variant scheme ────────────────────────────────────────────────────────
//
// Stored photoId in the database is the canonical "base ID" — typically
// `photos/<uuid>`. Variants are derived deterministically from this base:
//
//   thumb    : `${baseId}__thumb.jpg`     ~ 400 px JPEG q80, EXIF stripped
//   medium   : `${baseId}__medium.jpg`    ~1200 px JPEG q82, EXIF stripped
//   original : `originals/<uuid>`         untouched bytes, EXIF/GPS intact
//
// Originals are written to a separate `originals/` prefix so a bucket
// lifecycle rule can expire them after the configured retention window
// without touching display variants. Display variants live alongside the
// base path so legacy `<baseId>` files continue to serve as a fallback when
// a specific variant has not yet been generated (e.g. before backfill).

export const PHOTO_VARIANTS = ["thumb", "medium", "original"] as const;
export type PhotoVariant = typeof PHOTO_VARIANTS[number];

export const VARIANT_SPECS = {
  thumb: { maxDim: 400, quality: 80 },
  medium: { maxDim: 1200, quality: 82 },
} as const;

// Retention window (months) for preserved originals. Configure a matching
// lifecycle rule on the object-storage bucket against the `originals/`
// prefix to enforce automatic deletion.
export const ORIGINAL_RETENTION_MONTHS = 18;

// Long-cache TTL for display variants. Variant content is content-addressed
// (the base ID is an unguessable UUID) and immutable, so it is safe to
// cache aggressively at any intermediate proxy / browser.
export const VARIANT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

// HEIC-conversion cache companion path (jpeg). Used by the proxy's
// write-through cache so HEIC originals are converted only once.
export function heicCachePath(baseId: string): string {
  return `${baseId}__heic.jpg`;
}

export function thumbPath(baseId: string): string {
  return `${baseId}__thumb.jpg`;
}

export function mediumPath(baseId: string): string {
  return `${baseId}__medium.jpg`;
}

// Map base → original path. baseId is expected to look like `photos/<uuid>`
// or a legacy `uploads/<filename>`. We keep originals namespaced under
// `originals/` using the trailing path segment so retention rules apply
// only to the originals prefix.
export function originalPath(baseId: string): string {
  const id = baseId.replace(/^\/?(photos|uploads)\//, "").replace(/^\/+/, "");
  return `originals/${id}`;
}

export function variantPath(baseId: string, variant: PhotoVariant): string {
  switch (variant) {
    case "thumb":
      return thumbPath(baseId);
    case "medium":
      return mediumPath(baseId);
    case "original":
      return originalPath(baseId);
  }
}

// Generate display variant buffers from an input image buffer.
// EXIF (and other metadata) is stripped on display variants by default in sharp.
export async function generateDisplayVariants(input: Buffer): Promise<{ thumb: Buffer; medium: Buffer }> {
  const [thumb, medium] = await Promise.all([
    sharp(input, { failOn: "none" })
      .rotate() // honour EXIF orientation before stripping
      .resize({ width: VARIANT_SPECS.thumb.maxDim, height: VARIANT_SPECS.thumb.maxDim, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: VARIANT_SPECS.thumb.quality, mozjpeg: true })
      .toBuffer(),
    sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: VARIANT_SPECS.medium.maxDim, height: VARIANT_SPECS.medium.maxDim, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: VARIANT_SPECS.medium.quality, mozjpeg: true })
      .toBuffer(),
  ]);
  return { thumb, medium };
}

// Convert a HEIC/HEIF buffer to a JPEG buffer for the write-through cache.
export async function convertHeicToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

export async function readFileToBuffer(file: File): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = file.createReadStream();
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

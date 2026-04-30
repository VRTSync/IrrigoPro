import { Storage, File } from "@google-cloud/storage";
import { Response } from "express";
import { randomUUID } from "crypto";
import sharp from "sharp";
import {
  PHOTO_VARIANTS,
  type PhotoVariant,
  variantPath,
  thumbPath,
  mediumPath,
  originalPath,
  heicCachePath,
  generateDisplayVariants,
  convertHeicToJpeg,
  readFileToBuffer,
  VARIANT_CACHE_TTL_SECONDS,
} from "./photo-pipeline";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      console.warn("PUBLIC_OBJECT_SEARCH_PATHS not set, object storage features will be disabled");
      return [];
    }
    return paths;
  }

  // Strip the matching public search-path prefix from a resolved file's
  // bucket-relative `file.name` so we get back the canonical key (e.g.
  // `photos/<uuid>`). Required before deriving companion keys like the
  // HEIC cache, because `searchPublicObject`/`writeBufferToFirstSearchPath`
  // re-apply the search-path prefix themselves — passing in a name that
  // already includes it would double the prefix (e.g. `public/public/...`).
  canonicalKeyForFile(file: File): string {
    const fileName = file.name;
    const fileBucket = file.bucket?.name;
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      let bucketName: string;
      let objectPrefix: string;
      try {
        ({ bucketName, objectName: objectPrefix } = parseObjectPath(searchPath));
      } catch {
        continue;
      }
      if (fileBucket && fileBucket !== bucketName) continue;
      const prefix = objectPrefix.endsWith("/") ? objectPrefix : `${objectPrefix}/`;
      if (fileName.startsWith(prefix)) {
        return fileName.slice(prefix.length);
      }
    }
    return fileName;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      try {
        const { bucketName, objectName } = parseObjectPath(fullPath);
        const bucket = objectStorageClient.bucket(bucketName);
        const file = bucket.file(objectName);
        const [exists] = await file.exists();
        if (exists) return file;
      } catch (error) {
        console.error(`[OBJECT-STORAGE] Error checking path ${fullPath}:`, error);
      }
    }
    return null;
  }

  // Downloads an object to the response. Optionally streams as a long-cache
  // public-display variant when `displayVariant` is true.
  async downloadObject(
    file: File,
    res: Response,
    cacheTtlSec: number = 3600,
    options: { displayVariant?: boolean } = {}
  ) {
    try {
      const [metadata] = await file.getMetadata();
      const contentType = (metadata.contentType || "application/octet-stream").toLowerCase();

      // Convert HEIC/HEIF images to JPEG with a write-through cache so the
      // conversion only happens once. The first request converts and writes
      // the JPEG to a companion path; subsequent requests serve the cached
      // copy directly.
      const isHeic = contentType === "image/heic" || contentType === "image/heif";
      if (isHeic) {
        // HEIC bytes can be served as a public, long-cached display variant
        // (galleries) OR as a private, authenticated original — pick the
        // matching cache-control so we never leak originals through a CDN.
        const heicCacheControl = options.displayVariant
          ? `public, max-age=${VARIANT_CACHE_TTL_SECONDS}, immutable`
          : `private, max-age=${cacheTtlSec}`;
        const heicCacheKey = heicCachePath(this.canonicalKeyForFile(file));
        const cached = await this.searchPublicObject(heicCacheKey);
        if (cached) {
          const [cachedMeta] = await cached.getMetadata();
          res.set({
            "Content-Type": "image/jpeg",
            "Content-Length": cachedMeta.size,
            "Cache-Control": heicCacheControl,
          });
          cached.createReadStream().pipe(res);
          return;
        }

        // No cached jpeg yet — convert, cache, then serve.
        const buf = await readFileToBuffer(file);
        let jpeg: Buffer;
        try {
          jpeg = await convertHeicToJpeg(buf);
        } catch (err) {
          console.error("[OBJECT-STORAGE] HEIC conversion failed:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Error converting image" });
          }
          return;
        }

        // Best-effort cache write — failures must not block the response.
        this.writeBufferToFirstSearchPath(heicCacheKey, jpeg, "image/jpeg").catch((e) =>
          console.warn("[OBJECT-STORAGE] HEIC cache write failed:", e)
        );

        res.set({
          "Content-Type": "image/jpeg",
          "Content-Length": jpeg.length,
          "Cache-Control": heicCacheControl,
        });
        res.end(jpeg);
        return;
      }

      const cacheControl = options.displayVariant
        ? `public, max-age=${VARIANT_CACHE_TTL_SECONDS}, immutable`
        : `private, max-age=${cacheTtlSec}`;

      res.set({
        "Content-Type": contentType,
        "Content-Length": metadata.size,
        "Cache-Control": cacheControl,
      });

      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) res.status(500).json({ error: "Error streaming file" });
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) res.status(500).json({ error: "Error downloading file" });
    }
  }

  // Gets a signed upload URL for the display copy of a new photo under
  // `photos/<uuid>`. We no longer mint a parallel signed URL for an
  // `originals/<uuid>` PUT — new photos ship a single ~0.35MB display copy
  // and the server generates `thumb`/`medium` variants from it. Legacy
  // photos that already have a preserved original keep working: the
  // `?variant=original` read path continues to resolve them.
  async getPhotoUploadURL(): Promise<{
    signedUrl: string;
    photoId: string;
  }> {
    const publicSearchPaths = this.getPublicObjectSearchPaths();
    if (publicSearchPaths.length === 0) {
      throw new Error("No public search paths configured");
    }

    const photoId = `photos/${randomUUID()}`;
    const baseDir = publicSearchPaths[0];
    const displayParts = parseObjectPath(`${baseDir}/${photoId}`);

    const signedUrl = await signObjectURL({
      bucketName: displayParts.bucketName,
      objectName: displayParts.objectName,
      method: "PUT",
      ttlSec: 900,
    });

    return { signedUrl, photoId };
  }

  // Search for a photo (or one of its variants) in object storage.
  async searchPhotoObject(photoId: string): Promise<File | null> {
    return this.searchPublicObject(photoId);
  }

  // Resolve to a specific variant File. For display variants (thumb/medium)
  // we fall back to the base photoId so legacy photos still render before
  // backfill. For `original` we are STRICT: the caller asked for the
  // untouched preserved bytes — we must never return compressed display
  // bytes in their place. Returns null if the preserved original is missing.
  async findVariant(baseId: string, variant: PhotoVariant): Promise<File | null> {
    const target = variantPath(baseId, variant);
    const direct = await this.searchPublicObject(target);
    if (direct) return direct;
    if (variant === "original") return null;
    return this.searchPublicObject(baseId);
  }

  // Returns a short-lived signed GET URL for downloading a photo (or variant).
  // When `PHOTO_CDN_BASE_URL` is configured AND the requested variant is a
  // display variant (thumb/medium), returns an unsigned CDN URL instead so
  // the variant can be served from the edge cache. Originals are always
  // signed/private regardless.
  async getPhotoDownloadURL(photoId: string, ttlSec = 900, variant?: PhotoVariant): Promise<string | null> {
    const targetKey = variant ? variantPath(photoId, variant) : photoId;

    const cdnBase = (process.env.PHOTO_CDN_BASE_URL || "").replace(/\/+$/, "");
    if (cdnBase && (variant === "thumb" || variant === "medium")) {
      // CDN front: rely on the cache to back-fill from object storage. We
      // still verify the variant exists so we can fall back to the base path
      // for legacy photos that have not been backfilled yet.
      const exists = await this.searchPublicObject(targetKey);
      if (exists) return `${cdnBase}/${targetKey}`;
      const baseExists = await this.searchPublicObject(photoId);
      if (baseExists) return `${cdnBase}/${photoId}`;
      return null;
    }

    const publicSearchPaths = this.getPublicObjectSearchPaths();
    for (const basePath of publicSearchPaths) {
      const fullPath = `${basePath}/${targetKey}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      try {
        const bucket = objectStorageClient.bucket(bucketName);
        const [exists] = await bucket.file(objectName).exists();
        if (!exists) continue;
        return await signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
      } catch {
        // try next
      }
    }
    if (variant && variant !== "original") {
      // Variant not present — try base path so legacy photos still resolve.
      return this.getPhotoDownloadURL(photoId, ttlSec);
    }
    return null;
  }

  // Batch resolve signed download URLs for many photoIds in a single call.
  // Returns a map of photoId → url|null in the original order.
  async batchSignDownloadURLs(
    photoIds: string[],
    variant: PhotoVariant = "medium",
    ttlSec = 900,
  ): Promise<Array<{ photoId: string; url: string | null }>> {
    return Promise.all(
      photoIds.map(async (photoId) => {
        try {
          const url = await this.getPhotoDownloadURL(photoId, ttlSec, variant);
          return { photoId, url };
        } catch (err) {
          console.warn(`[OBJECT-STORAGE] batch sign failed for ${photoId}:`, err);
          return { photoId, url: null };
        }
      }),
    );
  }

  // Write a buffer to a specific object key under the first configured
  // search path. Used by HEIC cache + variant generation + backfill.
  // Defaults to long-cache public/immutable headers for display variants.
  // Pass `cacheControl: "private, no-store"` for originals to keep them
  // private and uncached at the edge.
  async writeBufferToFirstSearchPath(
    objectKey: string,
    buf: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void> {
    const publicSearchPaths = this.getPublicObjectSearchPaths();
    if (publicSearchPaths.length === 0) throw new Error("No public search paths configured");
    const fullPath = `${publicSearchPaths[0]}/${objectKey}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    await bucket.file(objectName).save(buf, {
      contentType,
      resumable: false,
      metadata: {
        cacheControl: cacheControl ?? `public, max-age=${VARIANT_CACHE_TTL_SECONDS}, immutable`,
      },
    });
  }

  // Generate the thumb + medium variants for a photo and preserve the
  // untouched bytes under the originals/ prefix. Idempotent: skips work
  // when targets already exist.
  async ensurePhotoVariants(
    baseId: string,
    opts: { allowOriginalBackfillFromBase?: boolean } = {},
  ): Promise<{
    thumb: boolean;
    medium: boolean;
    original: boolean;
    skipped?: boolean;
    error?: string;
  }> {
    const result = { thumb: false, medium: false, original: false } as {
      thumb: boolean; medium: boolean; original: boolean; skipped?: boolean; error?: string;
    };

    const sourceFile = await this.searchPublicObject(baseId);
    if (!sourceFile) {
      result.error = "source not found";
      return result;
    }

    const [thumbExists, mediumExists, originalExists] = await Promise.all([
      this.searchPublicObject(thumbPath(baseId)).then((f) => !!f),
      this.searchPublicObject(mediumPath(baseId)).then((f) => !!f),
      this.searchPublicObject(originalPath(baseId)).then((f) => !!f),
    ]);

    // Idempotency: once display variants exist, there's nothing to (re)do
    // for new uploads — they intentionally have no preserved original. For
    // legacy photos that DO have an original, we still report it. We
    // intentionally do NOT short-circuit when the caller asked for an
    // original backfill (allowOriginalBackfillFromBase) and the original
    // is missing — the legacy backfill script needs that path to repair
    // photos that have display variants but lost their preserved original.
    if (thumbExists && mediumExists && (originalExists || !opts.allowOriginalBackfillFromBase)) {
      result.skipped = true;
      result.thumb = result.medium = true;
      result.original = originalExists;
      return result;
    }

    const sourceBuf = await readFileToBuffer(sourceFile);
    const [meta] = await sourceFile.getMetadata();
    const sourceContentType = (meta.contentType || "image/jpeg").toLowerCase();

    // For HEIC/HEIF sources, decode to JPEG before resizing.
    let workingBuf = sourceBuf;
    if (sourceContentType === "image/heic" || sourceContentType === "image/heif") {
      try { workingBuf = await convertHeicToJpeg(sourceBuf); }
      catch (err) {
        result.error = `HEIC decode failed: ${(err as Error).message}`;
        return result;
      }
    }

    if (originalExists) {
      result.original = true;
    } else if (opts.allowOriginalBackfillFromBase) {
      // Legacy/backfill only: copy the base object into originals/. The
      // standard finalize flow for new uploads never asks for this — new
      // photos intentionally have no preserved original.
      try {
        await this.writeBufferToFirstSearchPath(
          originalPath(baseId),
          sourceBuf,
          sourceContentType,
          "private, max-age=0, no-cache",
        );
        result.original = true;
      } catch (err) {
        console.warn(`[OBJECT-STORAGE] failed to preserve original for ${baseId}:`, err);
      }
    }
    // else: a missing originals/<uuid> is the expected steady state for
    // new uploads — no warning. Display variants below still get generated
    // from the base (display) bytes.

    try {
      const { thumb, medium } = await generateDisplayVariants(workingBuf);
      const writes: Promise<void>[] = [];
      if (!thumbExists) writes.push(this.writeBufferToFirstSearchPath(thumbPath(baseId), thumb, "image/jpeg").then(() => { result.thumb = true; }));
      else result.thumb = true;
      if (!mediumExists) writes.push(this.writeBufferToFirstSearchPath(mediumPath(baseId), medium, "image/jpeg").then(() => { result.medium = true; }));
      else result.medium = true;
      await Promise.all(writes);
    } catch (err) {
      result.error = `variant generation failed: ${(err as Error).message}`;
    }

    return result;
  }

  // Gets the upload URL for a company logo.
  async getCompanyLogoUploadURL(): Promise<string> {
    const publicSearchPaths = this.getPublicObjectSearchPaths();
    if (publicSearchPaths.length === 0) {
      throw new Error("No public search paths configured");
    }

    const logoId = randomUUID();
    const fullPath = `${publicSearchPaths[0]}/company-logos/${logoId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  getCompanyLogoPublicURL(logoPath: string): string {
    if (logoPath.startsWith('http')) return logoPath;
    if (logoPath.startsWith('/api/')) return logoPath;
    return `/api/company-logo/${logoPath}`;
  }

  normalizeLogoPath(uploadUrl: string): string {
    if (!uploadUrl.startsWith("https://storage.googleapis.com/")) return uploadUrl;
    const url = new URL(uploadUrl);
    const pathParts = url.pathname.split('/');
    return pathParts[pathParts.length - 1];
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const pathParts = path.split("/");
  if (pathParts.length < 3) throw new Error("Invalid path: must contain at least a bucket name");
  return { bucketName: pathParts[1], objectName: pathParts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

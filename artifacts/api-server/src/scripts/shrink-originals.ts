// One-time backfill: re-compress every object under the `originals/` prefix
// down to the same target the new upload pipeline produces (~3840px max
// dimension, JPEG q=0.90). Photos uploaded before Task #186 are still
// sitting in the bucket at full 5–15MB camera resolution; this reclaims
// that storage without touching the thumb/medium display variants (which
// live alongside the base photo path, not under `originals/`).
//
// Resumable: a marker key in app_settings stores the set of canonical
// originals/ keys already processed, so re-runs after a crash skip them.
//
// Safety:
//   * Skips objects whose current size is already at/under the target —
//     re-encoding a small JPEG just bloats it again.
//   * Skips non-image content types and HEIC/HEIF (handled by the HEIC
//     cache pipeline, not by this shrink pass).
//   * Verifies the re-encoded buffer is materially smaller than the
//     source before overwriting; if Sharp produces a larger file (rare),
//     leaves the original untouched.
//   * Overwrites in place using `private, max-age=0, no-cache` — matches
//     what `ensurePhotoVariants` writes for preserved originals.
//
// Usage:
//   node --import tsx/esm server/scripts/shrink-originals.ts [--dry-run] [--batch=10]
//
// In dry-run mode the script reports per-object and total bytes that would
// be freed without touching the bucket or the marker key.

// Force blocking writes so progress lines hit disk even when stdout is
// redirected to a file and the script ends with process.exit().
try { (process.stdout as any)._handle?.setBlocking?.(true); } catch {}
try { (process.stderr as any)._handle?.setBlocking?.(true); } catch {}

import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { appSettings } from "@workspace/db";
import { objectStorageClient, ObjectStorageService } from "../objectStorage";

const MARKER_KEY = "originalsShrink.done";
const FAIL_KEY = "originalsShrink.failed";

// Mirror the new client-side upload settings (see client/src/lib/photo-prep.ts
// pre-shrink era + Task #189 spec) for preserved originals.
const TARGET_MAX_DIM = 3840;
const TARGET_QUALITY = 90;

// Re-encoding only pays off for objects materially larger than the target
// output. A modern phone JPEG already at <2MB is unlikely to shrink, and
// re-encoding it would reset the EXIF/orientation handling for no win.
const SHRINK_FLOOR_BYTES = 2 * 1024 * 1024; // 2 MB

// After encoding, only overwrite if we save at least this many bytes.
// Otherwise the work was wasted (and re-encoding mildly degrades quality).
const MIN_SAVED_BYTES = 256 * 1024; // 256 KB

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.split("=", 2)[1];
  return "true";
}

function parseSearchPath(searchPath: string): { bucketName: string; prefix: string } {
  const trimmed = searchPath.startsWith("/") ? searchPath.slice(1) : searchPath;
  const parts = trimmed.split("/").filter((p) => p.length > 0);
  const bucketName = parts.shift() || "";
  const rawPrefix = parts.join("/");
  // Important: do NOT force a trailing slash when there is no object
  // prefix, because GCS object names are not prefixed with `/`. A search
  // path of `/<bucket>` should yield prefix `""`, not `"/"`, otherwise
  // `bucket.getFiles({ prefix: "/originals/" })` returns nothing.
  const prefix = rawPrefix === "" ? "" : (rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`);
  return { bucketName, prefix };
}

async function getDoneSet(): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(sql`${appSettings.key} = ${MARKER_KEY}`);
  if (rows.length === 0) return new Set();
  try { return new Set(JSON.parse(rows[0].value)); } catch { return new Set(); }
}

async function saveDoneSet(set: Set<string>): Promise<void> {
  const value = JSON.stringify(Array.from(set));
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${MARKER_KEY}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

async function saveFailures(failures: Map<string, string>): Promise<void> {
  if (failures.size === 0) return;
  const value = JSON.stringify(Object.fromEntries(failures));
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${FAIL_KEY}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

function isShrinkableContentType(ct: string): boolean {
  const t = ct.toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return true;
  if (t === "image/png") return true;
  if (t === "image/webp") return true;
  // HEIC/HEIF is handled by the HEIC cache pipeline; re-encoding here
  // would silently change the source content type and break that cache.
  return false;
}

interface BucketOriginal {
  bucketName: string;
  objectName: string;
  canonicalKey: string; // bucket-relative key with the search-path prefix stripped
  size: number;
  contentType: string;
}

async function listOriginals(svc: ObjectStorageService): Promise<BucketOriginal[]> {
  const out: BucketOriginal[] = [];
  for (const searchPath of svc.getPublicObjectSearchPaths()) {
    const { bucketName, prefix } = parseSearchPath(searchPath);
    if (!bucketName) continue;
    const fullPrefix = prefix ? `${prefix}originals/` : `originals/`;
    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: fullPrefix });
    for (const file of files) {
      const meta = file.metadata || {};
      const size = Number(meta.size || 0);
      const ct = String(meta.contentType || "application/octet-stream");
      // Strip the search-path prefix so the marker key stays stable across
      // environments that may have different bucket names. When the search
      // path has no object prefix (`prefix === ""`) the canonical key is
      // just the object name as-is.
      const canonicalKey = prefix && file.name.startsWith(prefix)
        ? file.name.slice(prefix.length)
        : file.name;
      out.push({ bucketName, objectName: file.name, canonicalKey, size, contentType: ct });
    }
  }
  return out;
}

type ShrinkResult =
  | { kind: "ok"; saved: number; encoded: Buffer }
  | { kind: "skip"; reason: string }
  | { kind: "error"; message: string };

async function shrinkOne(entry: BucketOriginal): Promise<ShrinkResult> {
  if (!isShrinkableContentType(entry.contentType)) {
    return { kind: "skip", reason: `content-type ${entry.contentType}` };
  }
  if (entry.size < SHRINK_FLOOR_BYTES) {
    return { kind: "skip", reason: `already small (${entry.size} bytes)` };
  }

  const bucket = objectStorageClient.bucket(entry.bucketName);
  const file = bucket.file(entry.objectName);

  let sourceBuf: Buffer;
  try {
    const [buf] = await file.download();
    sourceBuf = buf;
  } catch (err) {
    return { kind: "error", message: `download failed: ${(err as Error).message}` };
  }

  let encoded: Buffer;
  try {
    encoded = await sharp(sourceBuf, { failOn: "none" })
      .rotate() // bake EXIF orientation into pixels before stripping metadata
      .resize({
        width: TARGET_MAX_DIM,
        height: TARGET_MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: TARGET_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    return { kind: "error", message: `re-encode failed: ${(err as Error).message}` };
  }

  const saved = sourceBuf.length - encoded.length;
  if (saved < MIN_SAVED_BYTES) {
    return { kind: "skip", reason: `re-encoded saved only ${saved} bytes` };
  }

  return { kind: "ok", saved, encoded };
}

async function overwriteWithEncoded(
  entry: BucketOriginal,
  encoded: Buffer,
): Promise<void> {
  const bucket = objectStorageClient.bucket(entry.bucketName);
  await bucket.file(entry.objectName).save(encoded, {
    contentType: "image/jpeg",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-cache",
    },
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  const dryRun = arg("dry-run") === "true";
  const batchSize = Number(arg("batch", "10"));
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    console.error(`[SHRINK-ORIG] invalid --batch=${arg("batch")}; must be a positive integer`);
    process.exit(2);
  }
  const svc = new ObjectStorageService();

  console.log(`[SHRINK-ORIG] start dryRun=${dryRun} batch=${batchSize} target=${TARGET_MAX_DIM}px q=${TARGET_QUALITY}`);

  const done = await getDoneSet();
  const all = await listOriginals(svc);
  console.log(`[SHRINK-ORIG] discovered ${all.length} originals, ${done.size} already processed`);

  const todo = all.filter((e) => !done.has(e.canonicalKey));
  console.log(`[SHRINK-ORIG] will inspect ${todo.length} originals`);

  const failures = new Map<string, string>();
  let processed = 0;
  let skipped = 0;
  let totalSaved = 0;
  let totalScanned = 0;

  for (let i = 0; i < todo.length; i += batchSize) {
    const slice = todo.slice(i, i + batchSize);
    await Promise.all(slice.map(async (entry) => {
      totalScanned++;
      try {
        const r = await shrinkOne(entry);
        if (r.kind === "error") {
          failures.set(entry.canonicalKey, r.message);
          return;
        }
        if (r.kind === "skip") {
          skipped++;
          // Record as done so we don't re-download it on the next run.
          done.add(entry.canonicalKey);
          return;
        }
        if (dryRun) {
          console.log(
            `[DRY] ${entry.canonicalKey}  ${fmtBytes(entry.size)} → ${fmtBytes(entry.size - r.saved)}  (saves ${fmtBytes(r.saved)})`,
          );
        } else {
          await overwriteWithEncoded(entry, r.encoded);
          done.add(entry.canonicalKey);
          console.log(
            `[SHRINK-ORIG] ${entry.canonicalKey}  ${fmtBytes(entry.size)} → ${fmtBytes(entry.size - r.saved)}  (saved ${fmtBytes(r.saved)})`,
          );
        }
        processed++;
        totalSaved += r.saved;
      } catch (err) {
        failures.set(entry.canonicalKey, (err as Error).message);
      }
    }));
    if (!dryRun) await saveDoneSet(done);
    console.log(
      `[SHRINK-ORIG] progress ${Math.min(i + batchSize, todo.length)}/${todo.length} processed=${processed} skipped=${skipped} failed=${failures.size} savedSoFar=${fmtBytes(totalSaved)}`,
    );
  }

  if (!dryRun) await saveFailures(failures);
  console.log(
    `[SHRINK-ORIG] complete. scanned=${totalScanned} ${dryRun ? "would re-encode" : "re-encoded"}=${processed} skipped=${skipped} failed=${failures.size} ${dryRun ? "wouldFree" : "freed"}=${fmtBytes(totalSaved)}`,
  );
  if (failures.size > 0) {
    console.log("[SHRINK-ORIG] failures (saved to app_settings:originalsShrink.failed):");
    for (const [id, err] of Array.from(failures)) console.log(`  ${id} → ${err}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[SHRINK-ORIG] fatal:", err);
  process.exit(1);
});

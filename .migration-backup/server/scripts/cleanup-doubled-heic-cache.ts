// One-time cleanup: prior to the canonical-key fix, the HEIC write-through
// cache wrote (and read) its companion JPEGs at a doubled-prefix path —
// e.g. `public/public/photos/<uuid>__heic.jpg` instead of the documented
// `public/photos/<uuid>__heic.jpg`. Reads and writes agreed on the doubled
// path so the cache "worked", but lifecycle rules, audits, and the variant
// backfill all key off the canonical `<baseId>__heic.jpg` scheme and miss
// these objects, so they pile up forever.
//
// This script lists the configured public search paths and deletes any
// `__heic.jpg` companions that live under a doubled-prefix path. The cache
// is best-effort and is regenerated on the next request, so a delete is
// safe and avoids a copy-then-delete dance.
//
// Usage:
//   node --import tsx/esm server/scripts/cleanup-doubled-heic-cache.ts [--dry-run]

import { objectStorageClient, ObjectStorageService } from "../objectStorage";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  if (hit.includes("=")) return hit.split("=", 2)[1];
  return "true";
}

function parseSearchPath(searchPath: string): { bucketName: string; prefix: string } {
  const trimmed = searchPath.startsWith("/") ? searchPath.slice(1) : searchPath;
  const parts = trimmed.split("/");
  const bucketName = parts.shift() || "";
  const prefix = parts.join("/");
  return { bucketName, prefix: prefix.endsWith("/") ? prefix : `${prefix}/` };
}

async function main() {
  const dryRun = arg("dry-run") === "true";
  const svc = new ObjectStorageService();
  const searchPaths = svc.getPublicObjectSearchPaths();
  if (searchPaths.length === 0) {
    console.log("[CLEANUP-HEIC] no public search paths configured, nothing to do");
    process.exit(0);
  }

  let deleted = 0;
  let scanned = 0;
  let failed = 0;

  for (const searchPath of searchPaths) {
    const { bucketName, prefix } = parseSearchPath(searchPath);
    if (!bucketName || !prefix) {
      console.warn(`[CLEANUP-HEIC] skipping unparseable search path: ${searchPath}`);
      continue;
    }
    // Doubled-prefix cache lives at `<prefix><prefix>...__heic.jpg` —
    // i.e. the prefix appears twice at the start of the object name.
    const doubledPrefix = `${prefix}${prefix}`;
    console.log(
      `[CLEANUP-HEIC] scanning bucket=${bucketName} for objects with prefix=${doubledPrefix}`,
    );

    const bucket = objectStorageClient.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: doubledPrefix });
    for (const file of files) {
      scanned++;
      if (!file.name.endsWith("__heic.jpg")) continue;
      if (dryRun) {
        console.log(`[DRY] would delete gs://${bucketName}/${file.name}`);
        deleted++;
        continue;
      }
      try {
        await file.delete();
        deleted++;
        console.log(`[CLEANUP-HEIC] deleted gs://${bucketName}/${file.name}`);
      } catch (err) {
        failed++;
        console.warn(
          `[CLEANUP-HEIC] failed to delete gs://${bucketName}/${file.name}: ${(err as Error).message}`,
        );
      }
    }
  }

  console.log(
    `[CLEANUP-HEIC] complete. scanned=${scanned} deleted=${deleted} failed=${failed} dryRun=${dryRun}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[CLEANUP-HEIC] fatal:", err);
  process.exit(1);
});

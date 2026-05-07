// One-time backfill: for every photo referenced by work_orders / billing_sheets
// / estimates, generate display variants (thumb + medium) and copy the
// untouched bytes into the originals/ prefix. Resumable via a marker key in
// app_settings so re-runs after a crash skip already-processed photos.
//
// Also migrates legacy on-disk photos under ./uploads/<filename> into object
// storage at uploads/<filename> so they can be variant-generated and served
// from the bucket alongside everything else.
//
// Usage:
//   node --import tsx/esm server/scripts/backfill-photo-variants.ts [--dry-run] [--batch=25]

import { db } from "../db";
import { workOrders, billingSheets, estimates, appSettings } from "@workspace/db";
import { ObjectStorageService } from "../objectStorage";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const MARKER_KEY = "photoBackfill.done";
const FAIL_KEY = "photoBackfill.failed";

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.split("=", 2)[1];
  return "true";
}

function normalizeId(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.startsWith("blob:") || s.startsWith("http")) return null;
  if (s.startsWith("/uploads/")) return `uploads/${s.slice("/uploads/".length)}`;
  if (s.startsWith("uploads/")) return s;
  if (s.startsWith("/api/photos/")) return s.replace("/api/photos/", "");
  if (s.startsWith("photos/")) return s;
  return s;
}

async function getDoneSet(): Promise<Set<string>> {
  const rows = await db.select().from(appSettings).where(sql`${appSettings.key} = ${MARKER_KEY}`);
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

async function collectPhotoIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const consume = (rows: Array<{ photos: string[] | null }>) => {
    for (const r of rows) {
      for (const p of r.photos || []) {
        const id = normalizeId(p);
        if (id) ids.add(id);
      }
    }
  };
  consume(await db.select({ photos: workOrders.photos }).from(workOrders));
  consume(await db.select({ photos: billingSheets.photos }).from(billingSheets));
  consume(await db.select({ photos: estimates.photos }).from(estimates));
  return ids;
}

async function migrateLegacyDiskPhoto(photoId: string, svc: ObjectStorageService): Promise<boolean> {
  if (!photoId.startsWith("uploads/")) return true;
  const existing = await svc.searchPhotoObject(photoId);
  if (existing) return true;
  const localPath = path.join("./uploads", path.basename(photoId));
  if (!fs.existsSync(localPath)) return false;
  const buf = await fs.promises.readFile(localPath);
  const ext = path.extname(localPath).toLowerCase().replace(".", "") || "bin";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", heic: "image/heic", heif: "image/heif", bmp: "image/bmp",
    tiff: "image/tiff", tif: "image/tiff", avif: "image/avif",
  };
  const ct = mimeMap[ext] || "application/octet-stream";
  await svc.writeBufferToFirstSearchPath(photoId, buf, ct);
  return true;
}

async function main() {
  const dryRun = arg("dry-run") === "true";
  const batchSize = Number(arg("batch", "25"));
  const svc = new ObjectStorageService();

  console.log(`[BACKFILL] start dryRun=${dryRun} batch=${batchSize}`);
  const done = await getDoneSet();
  const allIds = await collectPhotoIds();
  console.log(`[BACKFILL] discovered ${allIds.size} unique photos, ${done.size} already complete`);

  const todo = Array.from(allIds).filter((id) => !done.has(id));
  console.log(`[BACKFILL] will process ${todo.length} photos`);

  const failures = new Map<string, string>();
  let processed = 0;

  for (let i = 0; i < todo.length; i += batchSize) {
    const slice = todo.slice(i, i + batchSize);
    await Promise.all(slice.map(async (photoId) => {
      try {
        if (dryRun) { console.log(`[DRY] ${photoId}`); return; }
        const migrated = await migrateLegacyDiskPhoto(photoId, svc);
        if (!migrated) {
          failures.set(photoId, "legacy disk file missing");
          return;
        }
        const r = await svc.ensurePhotoVariants(photoId, { allowOriginalBackfillFromBase: true });
        if (r.error) failures.set(photoId, r.error);
        else { done.add(photoId); processed++; }
      } catch (err) {
        failures.set(photoId, (err as Error).message);
      }
    }));
    if (!dryRun) await saveDoneSet(done);
    console.log(`[BACKFILL] progress ${Math.min(i + batchSize, todo.length)}/${todo.length} processed=${processed} failed=${failures.size}`);
  }

  if (!dryRun) await saveFailures(failures);
  console.log(`[BACKFILL] complete. processed=${processed} failed=${failures.size}`);
  if (failures.size > 0) {
    console.log("[BACKFILL] failures (saved to app_settings:photoBackfill.failed):");
    for (const [id, err] of failures) console.log(`  ${id} → ${err}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[BACKFILL] fatal:", err);
  process.exit(1);
});

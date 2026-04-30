import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";

import {
  thumbPath,
  mediumPath,
  originalPath,
  heicCachePath,
  variantPath,
  generateDisplayVariants,
  VARIANT_CACHE_TTL_SECONDS,
} from "../server/photo-pipeline.ts";
import { ObjectStorageService } from "../server/objectStorage.ts";
import { db } from "../server/db.ts";
import { sql } from "drizzle-orm";

const BASE_URL = "http://localhost:5000";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

async function api(method, path, body, headers = ADMIN_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`script exited ${code}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

describe("photo-pipeline path derivation", () => {
  test("thumbPath / mediumPath / heicCachePath append the expected suffixes", () => {
    const baseId = "photos/abc-123";
    assert.equal(thumbPath(baseId), "photos/abc-123__thumb.jpg");
    assert.equal(mediumPath(baseId), "photos/abc-123__medium.jpg");
    assert.equal(heicCachePath(baseId), "photos/abc-123__heic.jpg");
  });

  test("originalPath strips photos/ and uploads/ prefixes (and a leading slash) under originals/", () => {
    assert.equal(originalPath("photos/abc-123"), "originals/abc-123");
    assert.equal(originalPath("uploads/file.jpg"), "originals/file.jpg");
    assert.equal(originalPath("/photos/abc-123"), "originals/abc-123");
    assert.equal(originalPath("/uploads/file.jpg"), "originals/file.jpg");
    assert.equal(originalPath("abc-123"), "originals/abc-123");
  });

  test("variantPath dispatches to the correct derived path per variant", () => {
    const baseId = "photos/xyz";
    assert.equal(variantPath(baseId, "thumb"), thumbPath(baseId));
    assert.equal(variantPath(baseId, "medium"), mediumPath(baseId));
    assert.equal(variantPath(baseId, "original"), originalPath(baseId));
  });
});

describe("generateDisplayVariants", () => {
  test("strips EXIF/GPS metadata from thumb + medium output buffers", async () => {
    const inputWithExif = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: "Photographer Name", Software: "TestSuite" },
        GPS: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" },
      })
      .toBuffer();

    const inMeta = await sharp(inputWithExif).metadata();
    assert.ok(inMeta.exif, "test pre-condition: input image must carry EXIF metadata");

    const { thumb, medium } = await generateDisplayVariants(inputWithExif);

    const thumbMeta = await sharp(thumb).metadata();
    const mediumMeta = await sharp(medium).metadata();

    assert.equal(thumbMeta.exif, undefined, "thumb output must contain no EXIF block");
    assert.equal(mediumMeta.exif, undefined, "medium output must contain no EXIF block");
    assert.equal(thumbMeta.format, "jpeg");
    assert.equal(mediumMeta.format, "jpeg");
    assert.ok(
      thumbMeta.width <= 400 && thumbMeta.height <= 400,
      `thumb (${thumbMeta.width}x${thumbMeta.height}) must fit within 400px`,
    );
    assert.ok(
      mediumMeta.width <= 1200 && mediumMeta.height <= 1200,
      `medium (${mediumMeta.width}x${mediumMeta.height}) must fit within 1200px`,
    );
  });
});

describe("POST /api/photos/signed-urls", () => {
  test("returns parallel array of {photoId, url} for a mix of legacy + new ids", async () => {
    const photoIds = [
      `photos/${randomUUID()}`,
      `photos/${randomUUID()}`,
      `uploads/legacy-${randomUUID()}.jpg`,
      `/uploads/legacy-${randomUUID()}.jpg`,
    ];

    const res = await api("POST", "/api/photos/signed-urls", { photoIds, variant: "thumb" });

    assert.equal(res.status, 200, `unexpected status ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.variant, "thumb");
    assert.ok(Array.isArray(res.body.results), "results must be an array");
    assert.equal(res.body.results.length, photoIds.length, "results length must match input length");

    res.body.results.forEach((r, i) => {
      assert.equal(r.photoId, photoIds[i], `result[${i}].photoId must echo the input id`);
      assert.equal(typeof r.url, "string", `result[${i}].url must be a string fallback when no object exists`);
      assert.match(r.url, /\?variant=thumb$/, "fallback url must encode the requested variant");
    });

    const legacyResult = res.body.results[3].url;
    assert.ok(
      !legacyResult.includes("//uploads/"),
      `legacy /uploads/ id must be normalized (got ${legacyResult})`,
    );
  });

  test("rejects non-array photoIds with 400", async () => {
    const res = await api("POST", "/api/photos/signed-urls", { photoIds: "not-an-array" });
    assert.equal(res.status, 400);
  });

  test("rejects oversize batches with 400", async () => {
    const photoIds = Array.from({ length: 201 }, () => `photos/${randomUUID()}`);
    const res = await api("POST", "/api/photos/signed-urls", { photoIds });
    assert.equal(res.status, 400);
  });

  test("defaults variant to medium when omitted or invalid", async () => {
    const photoIds = [`photos/${randomUUID()}`];
    const res = await api("POST", "/api/photos/signed-urls", { photoIds });
    assert.equal(res.status, 200);
    assert.equal(res.body.variant, "medium");

    const res2 = await api("POST", "/api/photos/signed-urls", { photoIds, variant: "bogus" });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.variant, "medium");
  });
});

describe("backfill-photo-variants resumability", () => {
  const MARKER_KEY = "photoBackfill.done";
  const ID_DONE = `photos/test-resume-${randomUUID()}-A`;
  const ID_TODO = `photos/test-resume-${randomUUID()}-B`;
  const BILLING_NUMBER = `RESUME-TEST-${randomUUID()}`;

  let savedSheetId;
  let savedMarker; // null = no row existed, otherwise the original JSON string

  before(async () => {
    // Snapshot existing marker so we can restore it after the test.
    const beforeRow = await db.execute(
      sql`SELECT value FROM app_settings WHERE key = ${MARKER_KEY}`,
    );
    savedMarker = beforeRow.rows?.[0]?.value ?? null;

    // Add ID_DONE to the marker — leave any existing entries untouched.
    let doneSet;
    try { doneSet = new Set(savedMarker ? JSON.parse(savedMarker) : []); }
    catch { doneSet = new Set(); }
    doneSet.add(ID_DONE);
    const newValue = JSON.stringify(Array.from(doneSet));
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${MARKER_KEY}, ${newValue}, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `);

    // Insert a billing sheet that references both synthetic photoIds so
    // collectPhotoIds() in the script discovers them.
    const ins = await db.execute(sql`
      INSERT INTO billing_sheets (
        billing_number, customer_name, property_address, work_date,
        technician_name, work_description, status,
        total_hours, labor_rate, labor_subtotal, parts_subtotal,
        markup_amount, tax_amount, total_amount, photos
      ) VALUES (
        ${BILLING_NUMBER}, 'resume-test', 'addr', now(),
        'tech', 'resume marker test', 'draft',
        '0', '0', '0', '0',
        '0', '0', '0', ARRAY[${ID_DONE}::text, ${ID_TODO}::text]
      ) RETURNING id
    `);
    savedSheetId = ins.rows?.[0]?.id;
    assert.ok(savedSheetId, "must have inserted a billing sheet for the resumability test");
  });

  after(async () => {
    if (savedSheetId) {
      await db.execute(sql`DELETE FROM billing_sheets WHERE id = ${savedSheetId}`);
    }
    if (savedMarker === null) {
      await db.execute(sql`DELETE FROM app_settings WHERE key = ${MARKER_KEY}`);
    } else {
      await db.execute(sql`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (${MARKER_KEY}, ${savedMarker}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `);
    }
  });

  test("--dry-run skips ids already recorded in the marker on a second run", async () => {
    const stdout = await runScript([
      "--import", "tsx/esm",
      "server/scripts/backfill-photo-variants.ts",
      "--dry-run",
      "--batch=200",
    ]);

    assert.ok(
      !stdout.includes(`[DRY] ${ID_DONE}`),
      `marker-completed id ${ID_DONE} must be skipped on rerun.\n--- script stdout ---\n${stdout}`,
    );
    assert.ok(
      stdout.includes(`[DRY] ${ID_TODO}`),
      `unprocessed id ${ID_TODO} must still be enumerated.\n--- script stdout ---\n${stdout}`,
    );
  });
});

// ── ensurePhotoVariants safety net ────────────────────────────────────────
//
// These tests use a stubbed storage layer (no live bucket required). They
// guard the two critical invariants of the variant pipeline:
//   1. Idempotency: a second run on a fully-processed photo short-circuits.
//   2. Original preservation: the dual-upload finalize path NEVER writes
//      compressed display bytes to the originals/ prefix. Backfill of an
//      original from base bytes is gated behind allowOriginalBackfillFromBase
//      and uses the source content-type with a no-cache header.

class FakeFile {
  constructor(name, buf, contentType) {
    this.name = name;
    this._buf = buf;
    this._contentType = contentType;
  }
  async getMetadata() {
    return [{ contentType: this._contentType, size: this._buf.length }];
  }
  createReadStream() {
    // readFileToBuffer concatenates 'data' chunks until 'end'.
    return Readable.from([this._buf]);
  }
}

class StubObjectStorageService extends ObjectStorageService {
  constructor() {
    super();
    this.files = new Map(); // key -> FakeFile
    this.writes = []; // [{ key, contentType, cacheControl, size }]
  }
  getPublicObjectSearchPaths() {
    return ["/test-bucket/public"];
  }
  async searchPublicObject(filePath) {
    return this.files.get(filePath) || null;
  }
  async writeBufferToFirstSearchPath(objectKey, buf, contentType, cacheControl) {
    const effectiveCacheControl =
      cacheControl ?? `public, max-age=${VARIANT_CACHE_TTL_SECONDS}, immutable`;
    this.writes.push({
      key: objectKey,
      contentType,
      cacheControl: effectiveCacheControl,
      size: buf.length,
    });
    this.files.set(objectKey, new FakeFile(objectKey, Buffer.from(buf), contentType));
  }
  seed(key, buf, contentType) {
    this.files.set(key, new FakeFile(key, Buffer.from(buf), contentType));
  }
}

async function makeJpegBytes() {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer();
}

async function makePngBytes() {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .png()
    .toBuffer();
}

describe("ObjectStorageService.ensurePhotoVariants — safety net", () => {
  test("second call on a fully-processed photo returns { skipped: true } and writes nothing", async () => {
    const baseId = `photos/${randomUUID()}`;
    const svc = new StubObjectStorageService();
    const baseBytes = await makeJpegBytes();
    // Seed the dual-upload state: base (display source) AND preserved
    // original both already exist in the bucket.
    svc.seed(baseId, baseBytes, "image/jpeg");
    svc.seed(originalPath(baseId), baseBytes, "image/jpeg");

    const first = await svc.ensurePhotoVariants(baseId);
    assert.equal(first.error, undefined, `first call must not error: ${first.error}`);
    assert.equal(first.thumb, true);
    assert.equal(first.medium, true);
    assert.equal(first.original, true);
    assert.notEqual(first.skipped, true, "first call must actually do work");

    // First call should have written exactly the two display variants.
    assert.deepEqual(
      svc.writes.map((w) => w.key).sort(),
      [thumbPath(baseId), mediumPath(baseId)].sort(),
      "first call must only write thumb + medium",
    );

    const writesBeforeSecond = svc.writes.length;

    const second = await svc.ensurePhotoVariants(baseId);
    assert.equal(second.skipped, true, "second call must short-circuit with skipped: true");
    assert.equal(second.thumb, true);
    assert.equal(second.medium, true);
    assert.equal(second.original, true);
    assert.equal(second.error, undefined);
    assert.equal(
      svc.writes.length,
      writesBeforeSecond,
      "second (skipped) call must not write anything",
    );
  });

  test("without allowOriginalBackfillFromBase, a missing original is NOT written from base bytes", async () => {
    const baseId = `photos/${randomUUID()}`;
    const svc = new StubObjectStorageService();
    const baseBytes = await makeJpegBytes();
    // Only the base (compressed display source) exists. No preserved
    // original was uploaded (simulating the dual-upload original PUT having
    // failed or not yet completed).
    svc.seed(baseId, baseBytes, "image/jpeg");

    const result = await svc.ensurePhotoVariants(baseId);

    assert.equal(result.error, undefined, `must not error: ${result.error}`);
    assert.equal(result.thumb, true, "thumb variant must be generated");
    assert.equal(result.medium, true, "medium variant must be generated");
    assert.equal(
      result.original,
      false,
      "original must NOT be marked written when backfill is disallowed",
    );

    const originalWrites = svc.writes.filter((w) => w.key.startsWith("originals/"));
    assert.equal(
      originalWrites.length,
      0,
      `must never write to originals/ without the backfill opt-in (got ${JSON.stringify(originalWrites)})`,
    );

    // Sanity: the originals/ prefix is empty in storage too.
    assert.equal(
      svc.files.has(originalPath(baseId)),
      false,
      "originals/ key must remain absent in storage",
    );
  });

  test("with allowOriginalBackfillFromBase: true, original is preserved using source content-type and private no-cache headers", async () => {
    const baseId = `photos/${randomUUID()}`;
    const svc = new StubObjectStorageService();
    // Use PNG bytes + image/png as the source so the preserved-original
    // write proves it propagated the source content-type verbatim — not the
    // image/jpeg default that ensurePhotoVariants falls back to when
    // metadata is missing, and not the image/jpeg used by display variants.
    const baseBytes = await makePngBytes();
    const sourceContentType = "image/png";
    svc.seed(baseId, baseBytes, sourceContentType);

    const result = await svc.ensurePhotoVariants(baseId, { allowOriginalBackfillFromBase: true });

    assert.equal(result.error, undefined, `must not error: ${result.error}`);
    assert.equal(result.original, true, "original must be backfilled when opt-in is set");
    assert.equal(result.thumb, true);
    assert.equal(result.medium, true);

    const originalWrites = svc.writes.filter((w) => w.key === originalPath(baseId));
    assert.equal(originalWrites.length, 1, "exactly one write to the originals/ key is expected");
    const w = originalWrites[0];
    assert.equal(
      w.contentType,
      sourceContentType,
      "preserved-original write must carry the source content-type",
    );
    assert.equal(
      w.cacheControl,
      "private, max-age=0, no-cache",
      "preserved-original write must use private/no-cache headers (never the public-immutable variant default)",
    );
    assert.equal(
      w.size,
      baseBytes.length,
      "preserved-original write must use the unmodified source bytes",
    );

    // Display variants must still be written under the base prefix, not
    // duplicated into originals/.
    const variantWrites = svc.writes.filter((w) => w.key.startsWith("originals/") === false);
    assert.deepEqual(
      variantWrites.map((w) => w.key).sort(),
      [thumbPath(baseId), mediumPath(baseId)].sort(),
      "thumb + medium must be the only non-originals writes",
    );
  });
});

describe("HEIC write-through cache via /api/photos/:photoId", () => {
  // The proxy converts HEIC bytes to JPEG on the first request and writes
  // the result to `<baseId>__heic.jpg`. Subsequent requests must serve the
  // cached jpeg directly — a regression here would silently re-encode every
  // HEIC request and slow the gallery to a crawl.
  const photoService = new ObjectStorageService();
  const baseId = `photos/heic-cache-test-${randomUUID()}`;

  // The HEIC branch in downloadObject computes the cache key from the
  // resolved file's bucket-relative name (which already includes the
  // configured public search-path prefix), not from the raw photoId. We
  // mirror that here so the assertion checks the EXACT key the proxy uses.
  let resolvedCacheKey;

  async function safeDelete(key) {
    try {
      const f = await photoService.searchPublicObject(key);
      if (f) await f.delete();
    } catch {
      /* best-effort cleanup */
    }
  }

  before(async () => {
    // Seed a HEIC-typed source object. We use a sharp-generated JPEG buffer
    // but mark contentType as image/heic so the proxy's HEIC branch fires.
    // sharp's `failOn:"none"` decoder happily round-trips JPEG bytes when
    // convertHeicToJpeg runs, which keeps this test self-contained without
    // requiring a libheif build or a fixture HEIC file in the repo.
    const sourceBuf = await sharp({
      create: { width: 240, height: 180, channels: 3, background: { r: 32, g: 64, b: 96 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    await photoService.writeBufferToFirstSearchPath(
      baseId,
      sourceBuf,
      "image/heic",
      "private, no-cache",
    );

    const sourceFile = await photoService.searchPublicObject(baseId);
    assert.ok(sourceFile, `failed to seed HEIC source object at ${baseId}`);
    resolvedCacheKey = heicCachePath(sourceFile.name);

    // Make sure no stale companion is hanging around from a previous run.
    await safeDelete(resolvedCacheKey);
  });

  after(async () => {
    await safeDelete(baseId);
    if (resolvedCacheKey) await safeDelete(resolvedCacheKey);
  });

  test("first request converts + caches; second is served from cache (no re-encode); cache-control matches each branch", async () => {
    // Pre-condition: cache must not exist before the first request fires.
    const preCache = await photoService.searchPublicObject(resolvedCacheKey);
    assert.equal(preCache, null, `cache must not pre-exist at ${resolvedCacheKey}`);

    // ── First request: authenticated-original branch (no ?variant) ──────
    const first = await fetch(`${BASE_URL}/api/photos/${baseId}`, { headers: ADMIN_HEADERS });
    assert.equal(first.status, 200, `first request status (${first.status}) must be 200`);
    assert.equal(
      first.headers.get("content-type"),
      "image/jpeg",
      "HEIC source must be transcoded and served as image/jpeg",
    );
    assert.equal(
      first.headers.get("cache-control"),
      "private, max-age=3600",
      "authenticated-original branch must use the private, short cache-control",
    );
    // Drain the response so the server can finalize the best-effort write.
    await first.arrayBuffer();

    // The cache write is best-effort and fire-and-forget; poll for it.
    let cacheFile = null;
    for (let i = 0; i < 50 && !cacheFile; i++) {
      cacheFile = await photoService.searchPublicObject(resolvedCacheKey);
      if (!cacheFile) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(
      cacheFile,
      `companion __heic.jpg cache object must exist at heicCachePath(file.name) = ${resolvedCacheKey} after the first request`,
    );

    // ── Replace the cache contents with a small SENTINEL JPEG. The route
    // serves the cached object verbatim; if the next request returns the
    // sentinel bytes, that proves the cached jpeg was streamed (not the
    // HEIC source re-encoded). ────────────────────────────────────────────
    const sentinel = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
    await photoService.writeBufferToFirstSearchPath(
      resolvedCacheKey,
      sentinel,
      "image/jpeg",
      "private, max-age=3600",
    );

    // ── Second request: same branch — must serve the SENTINEL from cache.
    const second = await fetch(`${BASE_URL}/api/photos/${baseId}`, { headers: ADMIN_HEADERS });
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("content-type"), "image/jpeg");
    assert.equal(
      second.headers.get("cache-control"),
      "private, max-age=3600",
      "authenticated-original branch must keep the private cache-control on cached hits",
    );
    const secondBody = Buffer.from(await second.arrayBuffer());
    assert.deepEqual(
      secondBody,
      sentinel,
      "second request must stream the cached jpeg verbatim — got bytes that don't match the sentinel, meaning the HEIC source was re-encoded",
    );

    // ── Display-variant branch: requesting ?variant=medium falls back to
    // the base file (no medium exists), enters the HEIC branch with
    // displayVariant=true, and must reuse the SAME cached jpeg with the
    // long-lived public/immutable cache-control. ──────────────────────────
    const display = await fetch(
      `${BASE_URL}/api/photos/${baseId}?variant=medium`,
      { headers: ADMIN_HEADERS },
    );
    assert.equal(display.status, 200);
    assert.equal(display.headers.get("content-type"), "image/jpeg");
    assert.equal(
      display.headers.get("cache-control"),
      `public, max-age=${VARIANT_CACHE_TTL_SECONDS}, immutable`,
      "display-variant branch must use the long-lived public/immutable cache-control",
    );
    const displayBody = Buffer.from(await display.arrayBuffer());
    assert.deepEqual(
      displayBody,
      sentinel,
      "display-variant request must reuse the same cached jpeg (proven by the sentinel match)",
    );
  });
});

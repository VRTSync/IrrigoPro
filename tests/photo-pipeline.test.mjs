import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

import {
  thumbPath,
  mediumPath,
  originalPath,
  heicCachePath,
  variantPath,
  generateDisplayVariants,
} from "../server/photo-pipeline.ts";
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

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { compressForPdf } from "../server/pdf-generator.ts";

describe("compressForPdf — PDF photo compression pipeline", () => {
  test("output is JPEG, fits within 300px, and is under 30 KB for a typical photo", async () => {
    const input = await sharp({
      create: {
        width: 1200,
        height: 900,
        channels: 3,
        background: { r: 80, g: 120, b: 160 },
      },
    })
      .jpeg({ quality: 82 })
      .toBuffer();

    const result = await compressForPdf(input);

    assert.ok(result.length < 30_000, `compressed buffer must be under 30 KB (got ${result.length} bytes)`);

    const meta = await sharp(result).metadata();
    assert.equal(meta.format, "jpeg", "output must be JPEG");
    assert.ok(
      meta.width <= 300 && meta.height <= 300,
      `output (${meta.width}x${meta.height}) must fit within 300px`,
    );
    assert.equal(meta.exif, undefined, "output must have no EXIF metadata");
  });

  test("does not enlarge images smaller than 300px", async () => {
    const input = await sharp({
      create: {
        width: 150,
        height: 100,
        channels: 3,
        background: { r: 200, g: 50, b: 50 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    const result = await compressForPdf(input);
    const meta = await sharp(result).metadata();

    assert.equal(meta.width, 150, "width must stay at 150 (no upscale)");
    assert.equal(meta.height, 100, "height must stay at 100 (no upscale)");
    assert.equal(meta.format, "jpeg");
  });

  test("strips EXIF and GPS metadata", async () => {
    const input = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: "Test Photographer", Software: "TestSuite" },
        GPS: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" },
      })
      .toBuffer();

    const inMeta = await sharp(input).metadata();
    assert.ok(inMeta.exif, "test pre-condition: input must carry EXIF");

    const result = await compressForPdf(input);
    const outMeta = await sharp(result).metadata();
    assert.equal(outMeta.exif, undefined, "output must contain no EXIF block");
  });

  test("compresses a large high-quality input significantly", async () => {
    const input = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const result = await compressForPdf(input);

    assert.ok(
      result.length < input.length * 0.5,
      `compressed output (${result.length}) must be significantly smaller than input (${input.length})`,
    );
    assert.ok(result.length < 30_000, `compressed buffer must be under 30 KB (got ${result.length} bytes)`);
  });

  test("data URI assembly: compressed buffer produces a valid data:image/jpeg;base64 URI", async () => {
    const input = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: { r: 60, g: 90, b: 130 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();

    const compressed = await compressForPdf(input);
    const dataUri = `data:image/jpeg;base64,${compressed.toString("base64")}`;

    assert.ok(dataUri.startsWith("data:image/jpeg;base64,"), "URI must have the correct prefix");

    const b64 = dataUri.split(",")[1];
    const decoded = Buffer.from(b64, "base64");
    const meta = await sharp(decoded).metadata();
    assert.equal(meta.format, "jpeg", "decoded buffer must be valid JPEG");
    assert.ok(
      meta.width <= 300 && meta.height <= 300,
      `decoded image (${meta.width}x${meta.height}) must fit within 300px`,
    );
  });
});

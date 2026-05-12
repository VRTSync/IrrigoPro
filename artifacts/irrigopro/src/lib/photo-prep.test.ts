import { describe, expect, test, vi, beforeEach } from "vitest";
import sharp from "sharp";

const compressionCalls: Array<{ inputSize: number; options: Record<string, unknown> }> = [];

vi.mock("browser-image-compression", () => {
  return {
    default: async (file: File, options: Record<string, unknown>) => {
      const inputBuf = Buffer.from(await file.arrayBuffer());
      compressionCalls.push({ inputSize: inputBuf.length, options });

      const maxSizeMB = (options.maxSizeMB as number) ?? 1;
      const maxWH = (options.maxWidthOrHeight as number) ?? 1920;
      const targetBytes = Math.floor(maxSizeMB * 1024 * 1024);
      const initialQuality = Math.round(((options.initialQuality as number) ?? 0.8) * 100);
      const requestedType = options.fileType as string | undefined;
      const outType = requestedType
        ?? (file.type === "image/png" ? "image/jpeg" : file.type || "image/jpeg");

      let pipeline = sharp(inputBuf).rotate().resize({
        width: maxWH,
        height: maxWH,
        fit: "inside",
        withoutEnlargement: true,
      });

      let outBuf: Buffer;
      let quality = initialQuality;
      // Match browser-image-compression's behaviour: iteratively reduce
      // quality until the output fits maxSizeMB, then bail out.
      while (true) {
        outBuf = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
        if (outBuf.length <= targetBytes || quality <= 30) break;
        quality -= 10;
      }

      const outName = file.name.replace(/\.(png|webp|heic|heif)$/i, ".jpg");
      return new File([outBuf], outName, { type: outType });
    },
  };
});

import { preparePhotoForUpload, compressPhoto } from "@/lib/photo-prep";

async function makeRealJpeg(targetBytes: number, name = "field-photo.jpg"): Promise<File> {
  // Render a high-entropy image so JPEG can't compress it down past targetBytes
  // — we need a representative ~6MB camera-style upload as input.
  const width = 4032;
  const height = 3024;
  const channels = 3 as const;
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) & 0xff;
  const buf = await sharp(raw, { raw: { width, height, channels } })
    .jpeg({ quality: 95, mozjpeg: false, chromaSubsampling: "4:4:4" })
    .toBuffer();
  // Pad with a tail of high-entropy bytes appended via re-encoding at higher
  // quality if we under-shot, so we hit at least the target.
  if (buf.length < targetBytes) {
    const padded = await sharp(raw, { raw: { width, height, channels } })
      .jpeg({ quality: 100, mozjpeg: false, chromaSubsampling: "4:4:4" })
      .toBuffer();
    return new File([padded], name, { type: "image/jpeg" });
  }
  return new File([buf], name, { type: "image/jpeg" });
}

beforeEach(() => {
  compressionCalls.length = 0;
});

describe("photo-prep size targets (Task #190 — locks in Task #186 ceilings)", () => {
  test("preparePhotoForUpload: display copy is ≤400KB, longest edge ≤1600px, JPEG", async () => {
    const input = await makeRealJpeg(6 * 1024 * 1024);
    expect(input.size).toBeGreaterThanOrEqual(4 * 1024 * 1024);

    const { displayFile, usedFallback } = await preparePhotoForUpload(input);

    expect(usedFallback).toBe(false);
    expect(compressionCalls).toHaveLength(1);
    // Lock in the configured ceilings — these are the contract.
    expect(compressionCalls[0].options.maxSizeMB).toBeLessThanOrEqual(0.4);
    expect(compressionCalls[0].options.maxWidthOrHeight).toBeLessThanOrEqual(1600);

    // Verify the produced artifact actually meets the ceilings (decoded).
    expect(displayFile.type).toBe("image/jpeg");
    expect(displayFile.size).toBeLessThanOrEqual(400 * 1024);
    expect(displayFile.size).toBeLessThan(input.size);

    const outBuf = Buffer.from(await displayFile.arrayBuffer());
    const meta = await sharp(outBuf).metadata();
    expect(meta.format).toBe("jpeg");
    const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    expect(longestEdge).toBeLessThanOrEqual(1600);
    expect(longestEdge).toBeGreaterThan(0);
  });

  test("preparePhotoForUpload: PNG inputs are coerced to JPEG output", async () => {
    const png = await sharp({
      create: { width: 1024, height: 768, channels: 3, background: { r: 200, g: 100, b: 50 } },
    }).png().toBuffer();
    const file = new File([png], "snap.png", { type: "image/png" });

    const { displayFile } = await preparePhotoForUpload(file);

    expect(compressionCalls).toHaveLength(1);
    expect(compressionCalls[0].options.fileType).toBe("image/jpeg");
    expect(displayFile.type).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await displayFile.arrayBuffer())).metadata();
    expect(meta.format).toBe("jpeg");
  });

  test("compressPhoto (preserved-original / offline-capture path): ≤4MB, longest edge ≤3840px, JPEG", async () => {
    // The "preserved original" copy from Task #186 lives in the offline-capture
    // path now (compressPhoto). The task's done-criteria envelope is the
    // upper bound (≤4MB / ≤3840px); the implementation is materially
    // tighter at ≤1MB / ≤1920px and we lock both in below.
    const input = await makeRealJpeg(8 * 1024 * 1024);
    expect(input.size).toBeGreaterThanOrEqual(4 * 1024 * 1024);

    const result = await compressPhoto(input);

    expect(result.usedFallback).toBe(false);
    expect(compressionCalls).toHaveLength(1);
    // Tight implementation ceiling.
    expect(compressionCalls[0].options.maxSizeMB).toBeLessThanOrEqual(1.0);
    expect(compressionCalls[0].options.maxWidthOrHeight).toBeLessThanOrEqual(1920);

    // Task-spec envelope (looser upper bound).
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.size).toBeLessThanOrEqual(4 * 1024 * 1024);
    // Tight implementation envelope.
    expect(result.file.size).toBeLessThanOrEqual(1.0 * 1024 * 1024);
    expect(result.compressedSize).toBe(result.file.size);
    expect(result.originalSize).toBe(input.size);
    expect(result.compressedSize).toBeLessThan(result.originalSize);

    const outBuf = Buffer.from(await result.file.arrayBuffer());
    const meta = await sharp(outBuf).metadata();
    expect(meta.format).toBe("jpeg");
    const longestEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    expect(longestEdge).toBeLessThanOrEqual(3840);
    expect(longestEdge).toBeLessThanOrEqual(1920);
    expect(longestEdge).toBeGreaterThan(0);
  });
});

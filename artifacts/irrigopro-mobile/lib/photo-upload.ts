// Mobile photo capture + upload pipeline (Task #491 / M6).
//
// Mirrors the web wet-check upload flow exactly so the server side stays
// identical:
//
//   1. POST /api/upload/photo           → returns { signedUrl, url }
//   2. PUT  signedUrl  (raw image bytes, application/jpeg)
//   3. POST /api/upload/photo/finalize  → server generates display variants
//   4. POST /api/wet-checks/:id/photos  → metadata row (json, includes
//      clientId for retry-dedupe). Done by callers via wetCheckMutate.
//
// Step 4 is intentionally JSON, not multipart — the existing wet-check
// photo endpoint takes JSON `{ url, ... }` after the signed-PUT upload,
// and the M6 task's "step 6" tells us to mirror the web pipeline exactly
// once we trace storage. See the commit message + replit.md for context.

import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Directory, File, Paths } from "expo-file-system";

import { API_BASE_URL, ApiError, apiRequest, getToken } from "./api";
import { generateClientId } from "./uuid";

// Match the web pipeline (~1600px max edge, q=0.80) so server-side
// `medium`/`thumb` variants stay in the same neighbourhood and slow LTE
// uploads stay reasonable (~0.3MB target).
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export type LocalPhoto = {
  clientId: string;
  localUri: string;
  takenAt: string;
  zoneRecordId: number | null;
  findingId: number | null;
};

export type CameraPermissionStatus =
  | "granted"
  | "denied"
  | "blocked"; // user denied + can't ask again

export async function ensureCameraPermission(): Promise<CameraPermissionStatus> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return "granted";
  if (!current.canAskAgain) return "blocked";
  const next = await ImagePicker.requestCameraPermissionsAsync();
  if (next.granted) return "granted";
  return next.canAskAgain ? "denied" : "blocked";
}

export async function ensureMediaLibraryPermission(): Promise<CameraPermissionStatus> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (current.granted) return "granted";
  if (!current.canAskAgain) return "blocked";
  const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (next.granted) return "granted";
  return next.canAskAgain ? "denied" : "blocked";
}

function wetCheckPhotoDirectory(wetCheckId: number): Directory {
  return new Directory(Paths.document, "wet-check", String(wetCheckId));
}

function billingSheetPhotoDirectory(scopeKey: string): Directory {
  return new Directory(Paths.document, "billing-sheet", scopeKey);
}

// Pick a photo from the device library for a wet-check zone or finding.
// Runs the identical resize/compress pipeline as captureZonePhoto so the
// server-side variants stay in the same neighbourhood. Returns the same
// LocalPhoto shape so callers are interchangeable with captureZonePhoto.
export async function pickZonePhotoFromLibrary(opts: {
  wetCheckId: number;
  zoneRecordId: number | null;
  findingId: number | null;
}): Promise<LocalPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    quality: 1,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const needsResize = w > MAX_EDGE || h > MAX_EDGE;
  const manipulated = await manipulateAsync(
    asset.uri,
    needsResize
      ? [{ resize: w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE } }]
      : [],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );
  const clientId = generateClientId();
  const dir = wetCheckPhotoDirectory(opts.wetCheckId);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  const dest = new File(dir, `${clientId}.jpg`);
  if (dest.exists) dest.delete();
  const src = new File(manipulated.uri);
  try {
    src.move(dest);
  } catch {
    src.copy(dest);
    try {
      src.delete();
    } catch {
      /* best-effort */
    }
  }
  return {
    clientId,
    localUri: dest.uri,
    takenAt: new Date().toISOString(),
    zoneRecordId: opts.zoneRecordId,
    findingId: opts.findingId,
  };
}

// Capture a photo for a billing sheet (Task #492 / M7). Same compress +
// resize as the wet-check pipeline so the server-side `medium`/`thumb`
// variants line up. `scopeKey` lets callers bucket photos for a not-
// yet-saved sheet under a stable id (e.g. the work order id) and an
// existing sheet under its numeric id, without pre-creating directories
// for both.
export async function captureBillingSheetPhoto(opts: {
  scopeKey: string;
}): Promise<{ clientId: string; localUri: string; takenAt: string } | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: "images",
    quality: 1,
    exif: false,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const needsResize = w > MAX_EDGE || h > MAX_EDGE;
  const manipulated = await manipulateAsync(
    asset.uri,
    needsResize
      ? [
          {
            resize: w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE },
          },
        ]
      : [],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );
  const clientId = generateClientId();
  const dir = billingSheetPhotoDirectory(opts.scopeKey);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${clientId}.jpg`);
  if (dest.exists) dest.delete();
  const src = new File(manipulated.uri);
  try {
    src.move(dest);
  } catch {
    src.copy(dest);
    try {
      src.delete();
    } catch {
      /* best-effort */
    }
  }
  return {
    clientId,
    localUri: dest.uri,
    takenAt: new Date().toISOString(),
  };
}

// Pick a photo from the device library for a billing sheet. Mirrors
// captureBillingSheetPhoto exactly (same resize/compress pipeline, same
// return shape) so callers are interchangeable.
export async function pickBillingSheetPhotoFromLibrary(opts: {
  scopeKey: string;
}): Promise<{ clientId: string; localUri: string; takenAt: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    quality: 1,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const needsResize = w > MAX_EDGE || h > MAX_EDGE;
  const manipulated = await manipulateAsync(
    asset.uri,
    needsResize
      ? [{ resize: w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE } }]
      : [],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );
  const clientId = generateClientId();
  const dir = billingSheetPhotoDirectory(opts.scopeKey);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${clientId}.jpg`);
  if (dest.exists) dest.delete();
  const src = new File(manipulated.uri);
  try {
    src.move(dest);
  } catch {
    src.copy(dest);
    try {
      src.delete();
    } catch {
      /* best-effort */
    }
  }
  return {
    clientId,
    localUri: dest.uri,
    takenAt: new Date().toISOString(),
  };
}

// Capture a photo via the native camera, compress + resize it, and copy
// the resulting JPEG into the per-wet-check folder under the app's
// documents directory. Returns null when the user cancels.
export async function captureZonePhoto(opts: {
  wetCheckId: number;
  zoneRecordId: number | null;
  findingId: number | null;
}): Promise<LocalPhoto | null> {
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: "images",
    quality: 1,
    exif: false,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];

  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const needsResize = w > MAX_EDGE || h > MAX_EDGE;
  const manipulated = await manipulateAsync(
    asset.uri,
    needsResize
      ? [
          {
            resize:
              w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE },
          },
        ]
      : [],
    { compress: JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  const clientId = generateClientId();
  const dir = wetCheckPhotoDirectory(opts.wetCheckId);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  const dest = new File(dir, `${clientId}.jpg`);
  if (dest.exists) dest.delete();
  // The manipulator writes into the cache; move it into the persistent
  // documents directory so it survives an OS cache eviction between
  // capture and successful upload.
  const src = new File(manipulated.uri);
  try {
    src.move(dest);
  } catch {
    // Fallback: copy then delete. `move` can fail across volumes on some
    // platforms; we never want a successful capture to be lost here.
    src.copy(dest);
    try {
      src.delete();
    } catch {
      /* best-effort */
    }
  }

  return {
    clientId,
    localUri: dest.uri,
    takenAt: new Date().toISOString(),
    zoneRecordId: opts.zoneRecordId,
    findingId: opts.findingId,
  };
}

export function deleteLocalPhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* best-effort */
  }
}

type UploadSignResponse = { signedUrl: string; url: string };

// Sign → PUT → finalize. Returns the canonical photoId (e.g.
// `photos/<uuid>`) that callers post to /api/wet-checks/:id/photos as
// the `url` field (the existing endpoint accepts the canonical key).
export async function uploadLocalPhotoToStorage(localUri: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const signRes = await fetch(
    `${API_BASE_URL}/api/upload/photo?originalName=photo.jpg`,
    { method: "POST", headers },
  );
  if (!signRes.ok) {
    throw new ApiError(
      signRes.status,
      `Failed to get upload URL (${signRes.status})`,
      null,
    );
  }
  const { signedUrl, url }: UploadSignResponse = await signRes.json();

  // React Native fetch supports posting a file URI as the body via Blob.
  const fileRes = await fetch(localUri);
  const blob = await fileRes.blob();
  const putRes = await fetch(signedUrl, {
    method: "PUT",
    body: blob,
    headers: { "Content-Type": "image/jpeg" },
  });
  if (!putRes.ok) {
    throw new ApiError(
      putRes.status,
      `Upload to storage failed (${putRes.status})`,
      null,
    );
  }

  await apiRequest("/api/upload/photo/finalize", {
    method: "POST",
    body: { photoId: url },
  });

  return url;
}

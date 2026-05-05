// Slice 4B — Field-tech API wrapper.
//
// Thin layer around the wet check API that the wet-checks screens call
// instead of `apiRequest` directly. When the OFFLINE_QUEUE flag is on,
// writes go through the mutation queue with optimistic mirror updates;
// when off, calls fall through to `apiRequest`.
//
// Photos are intentionally NOT wrapped here — the spec keeps photos
// online-only in 4B with a "try when you're back online" message.

import { apiRequest } from "@/lib/queryClient";
import {
  deleteFindingMirror,
  enqueueMutation,
  getApiCache,
  getWetCheckMirrorById,
  getWetCheckMirrorByClientId,
  listAllMutations,
  listFindingsForZoneRecord,
  listZoneRecordsForWetCheck,
  openOfflineDB,
  putApiCache,
  putFindingMirror,
  putWetCheckMirror,
  putZoneRecordMirror,
  type OfflineDB,
} from "./db";
import { getSyncEngine, isOfflineQueueEnabled } from "./engine";
import type { QueuedMutation, QueuedMutationKind } from "./types";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof (crypto as any).getRandomValues === "function") (crypto as any).getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function newMutation(partial: Omit<QueuedMutation, "id" | "attemptCount" | "lastAttemptAt" | "lastError" | "status" | "createdAt" | "resolvedId">): QueuedMutation {
  return {
    id: uuid(),
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: Date.now(),
    resolvedId: null,
    ...partial,
  };
}

// Photo-offline guard — exported so callers can show the spec's exact
// message when a tech tries to capture a photo with no network.
export const PHOTO_OFFLINE_MESSAGE =
  "Photos require connectivity — try when you're back online.";

// IDB-first read for GET endpoints used during the wet-check capture
// flow (controllers, issue-type configs, parts-by-issue). Returns the
// cached payload immediately when present and refreshes from the
// network in the background; on cold-start offline the call rejects
// only if there is no cache to fall back on.
export async function cachedApiRequest<T = any>(url: string): Promise<T> {
  if (!isOfflineQueueEnabled()) return await apiRequest(url);
  const db = await openOfflineDB();
  const cached = await getApiCache(db, url);
  if (cached) {
    if (!isProbablyOffline()) {
      void apiRequest(url)
        .then(async (fresh) => { await putApiCache(db, url, fresh); })
        .catch(() => { /* heartbeat will mark offline */ });
    }
    return cached.data as T;
  }
  if (isProbablyOffline()) {
    throw new Error("Not cached locally — reconnect to load.");
  }
  const fresh = await apiRequest(url);
  try { await putApiCache(db, url, fresh); } catch {}
  return fresh as T;
}

export function isProbablyOffline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine === false;
}

// --- Wet check create --------------------------------------------------

export interface CreateWetCheckInput {
  customerId: number;
  clientId?: string;
}

export async function createWetCheck(input: CreateWetCheckInput): Promise<{ id?: number; clientId: string; customerId: number; status: string }> {
  const clientId = input.clientId ?? uuid();
  if (!isOfflineQueueEnabled()) {
    return await apiRequest("/api/wet-checks", "POST", { customerId: input.customerId, clientId });
  }
  const db = await openOfflineDB();
  const optimistic = {
    clientId,
    id: undefined as number | undefined,
    customerId: input.customerId,
    status: "in_progress",
    zoneRecords: [],
    photos: [],
  };
  await putWetCheckMirror(db, {
    clientId,
    data: optimistic,
    status: "in_progress",
    updatedAt: Date.now(),
  });
  await getSyncEngine().enqueue(newMutation({
    kind: "wet_check.create",
    method: "POST",
    urlTemplate: "/api/wet-checks",
    body: { customerId: input.customerId, clientId },
    clientId,
    parentClientId: null,
    placeholders: {},
  }));
  return optimistic;
}

// --- Wet check submit --------------------------------------------------

// Find every queued mutation that belongs to a given wet check by walking
// the queue + mirrors. Used by submitWetCheck to enforce full topological
// dependency: submit must wait for the wet-check create AND every zone
// record / finding mutation for that wet check to complete first.
async function collectDescendantClientIds(db: OfflineDB, wetCheckClientId: string): Promise<string[]> {
  const all = await listAllMutations(db);
  const zoneRecords = await listZoneRecordsForWetCheck(db, wetCheckClientId);
  const zoneClientIds = new Set(zoneRecords.map((z) => z.clientId));
  // Also collect all findings whose zoneRecord belongs to this wet check.
  const findingClientIds = new Set<string>();
  for (const z of zoneRecords) {
    const fs = await listFindingsForZoneRecord(db, z.clientId);
    for (const f of fs) findingClientIds.add(f.clientId);
  }
  const deps = new Set<string>();
  // Always include the wet check create itself.
  deps.add(wetCheckClientId);
  for (const m of all) {
    if (m.status === "completed") continue;
    if (m.clientId === wetCheckClientId) { deps.add(m.clientId); continue; }
    if (zoneClientIds.has(m.clientId)) { deps.add(m.clientId); continue; }
    if (findingClientIds.has(m.clientId)) { deps.add(m.clientId); continue; }
    // finding.update / finding.delete carry parentClientId === finding clientId
    if (m.parentClientId && (zoneClientIds.has(m.parentClientId) || findingClientIds.has(m.parentClientId))) {
      deps.add(m.clientId);
    }
  }
  return Array.from(deps);
}

export async function submitWetCheck(wetCheckClientId: string, wetCheckId: number | undefined): Promise<{ queued: boolean }> {
  if (!isOfflineQueueEnabled() && wetCheckId != null) {
    await apiRequest(`/api/wet-checks/${wetCheckId}/submit`, "POST", {});
    return { queued: false };
  }
  const db = await openOfflineDB();
  const parentClientIds = await collectDescendantClientIds(db, wetCheckClientId);
  await getSyncEngine().enqueue(newMutation({
    kind: "wet_check.submit",
    method: "POST",
    urlTemplate: "/api/wet-checks/{{wc}}/submit",
    body: {},
    clientId: uuid(),
    parentClientId: wetCheckClientId,
    parentClientIds,
    placeholders: { wc: wetCheckClientId },
  }));
  return { queued: true };
}

// Compose the wet check + its zone records + findings from the per-entity
// mirror stores into a single WetCheckWithDetails-shaped view object. This
// is what the offline detail page should render so optimistic edits made
// against zoneRecords / findings (which live in their own stores) are
// visible immediately, not just the stale aggregate that was last warmed.
async function assembleFromMirror(db: OfflineDB, root: any, wetCheckClientId: string): Promise<any> {
  const zoneRows = await db.getAllFromIndex("wetCheckZoneRecords", "byWetCheckClientId", wetCheckClientId);
  const composedZones: any[] = [];
  for (const zr of zoneRows) {
    const findingRows = await db.getAllFromIndex("wetCheckFindings", "byZoneRecordClientId", zr.clientId);
    composedZones.push({
      ...(zr.data ?? {}),
      id: zr.id ?? zr.data?.id,
      clientId: zr.clientId,
      findings: findingRows.map((f) => ({
        ...(f.data ?? {}),
        id: f.id ?? f.data?.id,
        clientId: f.clientId,
      })),
    });
  }
  // Prefer per-entity rows when present; fall back to the root payload's
  // zoneRecords (e.g. when only the aggregate was warmed).
  const zoneRecords = composedZones.length > 0
    ? composedZones
    : (Array.isArray(root?.zoneRecords) ? root.zoneRecords : []);
  return {
    ...(root ?? {}),
    clientId: wetCheckClientId,
    zoneRecords,
    photos: Array.isArray(root?.photos) ? root.photos : [],
  };
}

// Re-export the helper so the wet checks page can read the offline mirror
// when navigating by clientId before the engine has a server id.
export async function readWetCheckByClientId(clientId: string) {
  const db = await openOfflineDB();
  const row = await getWetCheckMirrorByClientId(db, clientId);
  if (!row) return null;
  return await assembleFromMirror(db, row.data, clientId);
}

// Re-exported types so callers don't have to reach into ./types.
export type { QueuedMutationKind };

// --- Zone record upsert ------------------------------------------------

export interface UpsertZoneRecordInput {
  wetCheckClientId: string;
  wetCheckId?: number;
  controllerLetter: string;
  zoneNumber: number;
  status: "checked_ok" | "checked_with_issues" | "not_applicable";
  ranSuccessfully?: boolean | null;
  notes?: string | null;
  clientId?: string;
  // Capture-time timestamp set on the device. Preserved through queueing
  // so replay records the real field-time, not the replay-time clock.
  checkedAt?: string;
}

export async function upsertZoneRecord(input: UpsertZoneRecordInput): Promise<{ id?: number; clientId: string }> {
  const clientId = input.clientId ?? uuid();
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  if (!isOfflineQueueEnabled() && input.wetCheckId != null) {
    return await apiRequest(`/api/wet-checks/${input.wetCheckId}/zone-records`, "POST", {
      controllerLetter: input.controllerLetter,
      zoneNumber: input.zoneNumber,
      status: input.status,
      ranSuccessfully: input.ranSuccessfully ?? null,
      notes: input.notes ?? null,
      checkedAt,
      clientId,
    });
  }
  const db = await openOfflineDB();
  await putZoneRecordMirror(db, {
    clientId,
    wetCheckClientId: input.wetCheckClientId,
    wetCheckId: input.wetCheckId,
    data: {
      clientId,
      controllerLetter: input.controllerLetter,
      zoneNumber: input.zoneNumber,
      status: input.status,
      ranSuccessfully: input.ranSuccessfully ?? null,
      notes: input.notes ?? null,
      checkedAt,
    },
    updatedAt: Date.now(),
  });
  const body = {
    controllerLetter: input.controllerLetter,
    zoneNumber: input.zoneNumber,
    status: input.status,
    ranSuccessfully: input.ranSuccessfully ?? null,
    notes: input.notes ?? null,
    checkedAt,
    clientId,
  };
  await getSyncEngine().enqueue(newMutation({
    kind: "zone_record.upsert",
    method: "POST",
    urlTemplate: "/api/wet-checks/{{wc}}/zone-records",
    body,
    clientId,
    parentClientId: input.wetCheckClientId,
    placeholders: { wc: input.wetCheckClientId },
  }));
  return { clientId };
}

// --- Finding create / update / delete ---------------------------------

export interface CreateFindingInput {
  zoneRecordClientId: string;
  zoneRecordId?: number;
  wetCheckId?: number;
  payload: any; // server-shaped finding body (issueType, severity, partsUsed, etc.)
  clientId?: string;
}

export async function createFinding(input: CreateFindingInput): Promise<{ id?: number; clientId: string }> {
  const clientId = input.clientId ?? uuid();
  if (!isOfflineQueueEnabled() && input.zoneRecordId != null) {
    return await apiRequest(`/api/wet-checks/zone-records/${input.zoneRecordId}/findings`, "POST", {
      ...input.payload,
      clientId,
    });
  }
  const db = await openOfflineDB();
  await putFindingMirror(db, {
    clientId,
    zoneRecordClientId: input.zoneRecordClientId,
    zoneRecordId: input.zoneRecordId,
    wetCheckId: input.wetCheckId,
    data: { ...input.payload, clientId },
    updatedAt: Date.now(),
  });
  await getSyncEngine().enqueue(newMutation({
    kind: "finding.create",
    method: "POST",
    urlTemplate: "/api/wet-checks/zone-records/{{zr}}/findings",
    body: { ...input.payload, clientId },
    clientId,
    parentClientId: input.zoneRecordClientId,
    placeholders: { zr: input.zoneRecordClientId },
  }));
  return { clientId };
}

export async function updateFinding(findingClientId: string, findingId: number | undefined, patch: any): Promise<void> {
  if (!isOfflineQueueEnabled() && findingId != null) {
    await apiRequest(`/api/wet-checks/findings/${findingId}`, "PATCH", patch);
    return;
  }
  const db = await openOfflineDB();
  // Mirror update — preserve other fields.
  const existing = await db.get("wetCheckFindings", findingClientId);
  if (existing) {
    await putFindingMirror(db, {
      ...existing,
      data: { ...existing.data, ...patch },
      updatedAt: Date.now(),
    });
  }
  await getSyncEngine().enqueue(newMutation({
    kind: "finding.update",
    method: "PATCH",
    urlTemplate: "/api/wet-checks/findings/{{f}}",
    body: patch,
    clientId: uuid(),
    parentClientId: findingClientId,
    placeholders: { f: findingClientId },
  }));
}

// Queue a photo→finding link PATCH. The {{f}} placeholder resolves to the
// server id of the finding once its `finding.create` mutation completes,
// so this works whether the link is queued before or after the create
// drains.
export async function linkPhotoToFinding(
  photoId: number,
  findingClientId: string,
  findingId?: number,
): Promise<void> {
  if (!isOfflineQueueEnabled()) {
    if (findingId == null) {
      throw new Error("linkPhotoToFinding: findingId required when offline queue is disabled");
    }
    await apiRequest(`/api/wet-checks/photos/${photoId}`, "PATCH", { findingId });
    return;
  }
  await getSyncEngine().enqueue(newMutation({
    kind: "photo.link",
    method: "PATCH",
    urlTemplate: `/api/wet-checks/photos/${photoId}`,
    body: { findingId: "{{f}}" },
    clientId: uuid(),
    parentClientId: findingClientId,
    placeholders: { f: findingClientId },
  }));
}

export async function deleteFinding(findingClientId: string, findingId: number | undefined): Promise<void> {
  if (!isOfflineQueueEnabled() && findingId != null) {
    await apiRequest(`/api/wet-checks/findings/${findingId}`, "DELETE");
    return;
  }
  const db = await openOfflineDB();
  await deleteFindingMirror(db, findingClientId);
  await getSyncEngine().enqueue(newMutation({
    kind: "finding.delete",
    method: "DELETE",
    urlTemplate: "/api/wet-checks/findings/{{f}}",
    body: undefined,
    clientId: uuid(),
    parentClientId: findingClientId,
    placeholders: { f: findingClientId },
  }));
}

// --- Read helpers used to warm the mirror ------------------------------

export async function warmWetCheckMirror(db: OfflineDB | null, wetCheckId: number, data: any): Promise<void> {
  const ddb = db ?? (await openOfflineDB());
  const clientId: string = data?.clientId ?? `server-${wetCheckId}`;
  const now = Date.now();
  await putWetCheckMirror(ddb, {
    clientId,
    id: wetCheckId,
    data,
    status: data?.status ?? "in_progress",
    updatedAt: now,
  });
  // Also hydrate per-entity stores so finding.update / finding.delete and
  // zone_record.upsert mutations against pre-existing server entities can
  // resolve their {{f}} / {{zr}} placeholders via the mirror.
  const zoneRecords: any[] = Array.isArray(data?.zoneRecords) ? data.zoneRecords : [];
  for (const zr of zoneRecords) {
    if (!zr?.clientId) continue;
    await putZoneRecordMirror(ddb, {
      clientId: zr.clientId,
      id: typeof zr.id === "number" ? zr.id : undefined,
      wetCheckClientId: clientId,
      wetCheckId,
      data: zr,
      updatedAt: now,
    });
    const findings: any[] = Array.isArray(zr?.findings) ? zr.findings : [];
    for (const f of findings) {
      if (!f?.clientId) continue;
      await putFindingMirror(ddb, {
        clientId: f.clientId,
        id: typeof f.id === "number" ? f.id : undefined,
        zoneRecordClientId: zr.clientId,
        zoneRecordId: typeof zr.id === "number" ? zr.id : undefined,
        wetCheckId,
        data: f,
        updatedAt: now,
      });
    }
  }
}

export async function readWetCheckFromMirror(wetCheckId: number): Promise<any | null> {
  const db = await openOfflineDB();
  const row = await getWetCheckMirrorById(db, wetCheckId);
  if (!row) return null;
  return await assembleFromMirror(db, row.data, row.clientId);
}

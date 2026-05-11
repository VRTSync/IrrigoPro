// Slice 4B — Replay engine.
//
// Singleton that drains the mutationQueue against the network in
// dependency order, with per-mutation exponential backoff and a
// concurrency cap of 2. Online state is fed by navigator.onLine, the
// `online`/`offline` window events, a 30s `/api/health` heartbeat, and
// inferred state from real API responses.
//
// The engine is intentionally test-friendly: `fetchImpl`, `now`, and the
// timer functions are injectable so node:test + fake-indexeddb can drive
// it deterministically.

import {
  deleteMutation,
  deletePhotoBlob,
  enqueueMutation,
  getPhotoBlob,
  listAllMutations,
  openOfflineDB,
  pruneCompleted,
  putWetCheckMirror,
  resolveServerId,
  updateMutation,
  type OfflineDB,
} from "./db";
import { backoffMs, readySet, resolveBody, resolveTemplate } from "./sortQueue";
import type {
  EngineEvent,
  EngineListener,
  QueuedMutation,
} from "./types";

// Detect a 4xx response that almost certainly came from an upstream/edge
// layer (deployment proxy, stale PWA shell, blocked-host page, generic
// CDN/load-balancer error page) rather than from our Express API.
//
// Our API server only ever returns JSON 4xx, so anything else — HTML,
// `text/plain` "Forbidden", an empty body, or any other non-JSON
// content-type — should be treated as a transient network hiccup and
// retried. (Task #469.)
export function isLikelyEdgeError(contentType: string, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  // Anything our API would emit is application/json. If we see that, it's
  // a real validation/permission error — not transient.
  if (ct.includes("application/json")) return false;
  // Otherwise, we're confident this came from a layer above Express:
  //   - text/html → proxy login page, blocked-host page
  //   - text/plain → generic LB / CDN "Forbidden" / "Bad Gateway"
  //   - empty/missing content-type with empty body → preflight rejection
  //   - anything else non-JSON → still not us
  if (ct) return true;
  // No content-type at all: treat as edge if body is empty or HTML-ish.
  const head = (body ?? "").trimStart().slice(0, 64).toLowerCase();
  if (!head) return true;
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<")) return true;
  // Last resort: try to parse as JSON; if it doesn't parse, treat as edge.
  try { JSON.parse(body); return false; } catch { return true; }
}

export interface EngineOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  heartbeatIntervalMs?: number;
  maxConcurrent?: number;
  pruneOlderThanMs?: number;
  authHeaders?: () => Record<string, string>;
}

export class SyncEngine {
  private db: OfflineDB | null = null;
  private listeners = new Set<EngineListener>();
  private fetchImpl: typeof fetch;
  private now: () => number;
  private heartbeatIntervalMs: number;
  private maxConcurrent: number;
  private pruneOlderThanMs: number;
  private authHeaders: () => Record<string, string>;
  private inFlight = new Set<string>();
  private aborts = new Map<string, AbortController>();
  private online = true;
  private heartbeatTimer: any = null;
  private started = false;
  private tickScheduled = false;

  constructor(opts: EngineOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
    this.now = opts.now ?? (() => Date.now());
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs ?? 30_000;
    this.maxConcurrent = opts.maxConcurrent ?? 2;
    this.pruneOlderThanMs = opts.pruneOlderThanMs ?? 24 * 60 * 60 * 1000;
    this.authHeaders = opts.authHeaders ?? (() => ({}));
  }

  on(l: EngineListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(e: EngineEvent) {
    for (const l of Array.from(this.listeners)) {
      try { l(e); } catch (err) { console.warn("[offline-engine] listener error:", err); }
    }
  }

  private async ensureDB(): Promise<OfflineDB> {
    if (!this.db) this.db = await openOfflineDB();
    return this.db;
  }

  setOnline(next: boolean) {
    if (this.online === next) return;
    this.online = next;
    this.broadcastState().catch(() => {});
    if (next) this.scheduleTick();
  }

  isOnline(): boolean { return this.online; }

  private async broadcastState() {
    try {
      const db = await this.ensureDB();
      const all = await listAllMutations(db);
      let pending = 0, syncing = 0, failed = 0;
      for (const m of all) {
        if (m.status === "pending") pending++;
        else if (m.status === "syncing") syncing++;
        else if (m.status === "failed") failed++;
      }
      this.emit({ type: "state", online: this.online, pending, syncing, failed });
    } catch {
      // ignore
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (typeof window !== "undefined") {
      this.online = navigator.onLine;
      window.addEventListener("online", () => this.setOnline(true));
      window.addEventListener("offline", () => this.setOnline(false));
    }
    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => { this.heartbeat().catch(() => {}); }, this.heartbeatIntervalMs);
    }
    await this.ensureDB();
    this.scheduleTick();
  }

  stop(): void {
    this.started = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private async heartbeat(): Promise<void> {
    try {
      const res = await this.fetchImpl("/api/health", { method: "GET" });
      this.setOnline(res.ok);
    } catch {
      this.setOnline(false);
    }
  }

  // Append a new queued mutation. The engine triggers a tick immediately.
  async enqueue(m: QueuedMutation): Promise<void> {
    const db = await this.ensureDB();
    await enqueueMutation(db, m);
    await this.broadcastState();
    this.scheduleTick();
  }

  // Slice 4D — UI-driven actions on individual queue entries.
  //
  // Snapshot of every queue entry, used by the queue view. Re-fetched on
  // every engine state event by the consuming hook.
  async listMutations(): Promise<QueuedMutation[]> {
    const db = await this.ensureDB();
    return await listAllMutations(db);
  }

  // Reset a failed mutation back to pending so the next tick will pick it
  // up. Safe to call on any mutation; only failed entries are useful.
  async retryMutation(id: string): Promise<void> {
    const db = await this.ensureDB();
    await updateMutation(db, id, {
      status: "pending",
      attemptCount: 0,
      lastError: null,
      lastAttemptAt: null,
    });
    await this.broadcastState();
    this.scheduleTick();
  }

  // Remove a mutation from the queue. If it is currently in-flight, abort
  // the fetch first; the dispatcher's catch block will see the abort but
  // updateMutation against the deleted row is a no-op.
  async cancelMutation(id: string): Promise<void> {
    const db = await this.ensureDB();
    const ac = this.aborts.get(id);
    if (ac) {
      try { ac.abort(); } catch { /* ignore */ }
    }
    await deleteMutation(db, id);
    this.inFlight.delete(id);
    this.aborts.delete(id);
    await this.broadcastState();
  }

  private scheduleTick(): void {
    if (this.tickScheduled) return;
    this.tickScheduled = true;
    Promise.resolve().then(() => {
      this.tickScheduled = false;
      this.tick().catch((err) => console.warn("[offline-engine] tick error:", err));
    });
  }

  // Build a {clientId → server id} resolver for every clientId referenced
  // by parent gates or placeholders in the queue. Pre-resolving lets the
  // sync `readySet` honor parents/placeholders that point at entities that
  // already exist on the server (no queued create), so editing a
  // pre-existing wet check doesn't deadlock the queue.
  private async buildResolver(
    db: OfflineDB,
    queue: ReadonlyArray<QueuedMutation>,
  ): Promise<(clientId: string) => number | null> {
    const cidSet = new Set<string>();
    for (const m of queue) {
      if (m.parentClientId) cidSet.add(m.parentClientId);
      for (const c of m.parentClientIds ?? []) cidSet.add(c);
      for (const c of Object.values(m.placeholders ?? {})) cidSet.add(c);
    }
    const map = new Map<string, number | null>();
    for (const cid of Array.from(cidSet)) map.set(cid, await resolveServerId(db, cid));
    return (cid) => (map.has(cid) ? map.get(cid)! : null);
  }

  // Public so tests can drive it deterministically without timers.
  async tick(): Promise<void> {
    if (!this.online) return;
    const db = await this.ensureDB();
    const all = await listAllMutations(db);
    const resolver = await this.buildResolver(db, all);
    const candidates = readySet(all, this.now(), resolver).filter((m) => !this.inFlight.has(m.id));
    const slots = Math.max(0, this.maxConcurrent - this.inFlight.size);
    const next = candidates.slice(0, slots);
    await Promise.all(next.map((m) => this.dispatch(m)));
    // Prune old completed entries each cycle.
    try { await pruneCompleted(db, this.pruneOlderThanMs, this.now()); } catch {}
  }

  // Drain the queue until empty or all remaining mutations are blocked
  // by backoff/parents (test convenience).
  async drainAll(maxIterations = 100): Promise<void> {
    for (let i = 0; i < maxIterations; i++) {
      await this.tick();
      // Wait for all in-flight to settle.
      while (this.inFlight.size > 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
      const db = await this.ensureDB();
      const all = await listAllMutations(db);
      const resolver = await this.buildResolver(db, all);
      const remaining = readySet(all, this.now(), resolver);
      const stillPending = all.some((m) => m.status === "pending");
      if (!stillPending) return;
      if (remaining.length === 0) return; // blocked by backoff/parents
    }
  }

  private async dispatch(m: QueuedMutation): Promise<void> {
    this.inFlight.add(m.id);
    const db = await this.ensureDB();
    await updateMutation(db, m.id, { status: "syncing", lastAttemptAt: this.now() });

    let url: string;
    let body: unknown;
    try {
      const resolveCid = async (cid: string) => await resolveServerId(db, cid);
      // Pre-resolve all placeholder ids synchronously by gathering them first.
      const resolvedMap: Record<string, number | null> = {};
      for (const cid of Object.values(m.placeholders ?? {})) {
        resolvedMap[cid] = await resolveCid(cid);
      }
      const lookup = (cid: string) => resolvedMap[cid] ?? null;
      url = resolveTemplate(m.urlTemplate, m.placeholders, lookup);
      body = resolveBody(m.body, m.placeholders, lookup);
    } catch (err: any) {
      // Should not happen — readySet gated on resolved parents — but if
      // it does, leave as pending and back off.
      await updateMutation(db, m.id, {
        status: "pending",
        attemptCount: m.attemptCount + 1,
        lastError: err?.message ?? String(err),
      });
      this.inFlight.delete(m.id);
      return;
    }

    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (ac) this.aborts.set(m.id, ac);
    try {
      let res: Response;
      if (m.kind === "photo.upload") {
        // Specialized path: pull the captured Blob from IndexedDB and run
        // the existing sign → PUT → finalize → POST flow against the
        // injected fetchImpl. The Blob row is only deleted from IDB after
        // the metadata POST succeeds — the spec's storage-hygiene rule.
        res = await this.dispatchPhotoUpload(db, m, url, body);
      } else {
        const headers: Record<string, string> = {
          ...this.authHeaders(),
        };
        if (m.method !== "DELETE" && body !== undefined) {
          headers["Content-Type"] = "application/json";
        }
        res = await this.fetchImpl(url, {
          method: m.method,
          headers,
          body: m.method === "DELETE" || body === undefined ? undefined : JSON.stringify(body),
          credentials: "include",
          signal: ac?.signal,
          // Task #469 — defense-in-depth: bypass any browser / service
          // worker cache so a stale PWA shell can't return a generic
          // HTML 403/login page for an /api/* mutation.
          cache: "no-store",
        });
      }

      // Any successful response is a heartbeat: we know we're online.
      if (res.ok) {
        this.setOnline(true);
        let payload: any = null;
        try { payload = await res.json(); } catch { /* ignore */ }
        const resolvedId =
          payload && typeof payload === "object" && typeof payload.id === "number"
            ? payload.id
            : null;
        await updateMutation(db, m.id, {
          status: "completed",
          lastError: null,
          resolvedId,
          progress: m.kind === "photo.upload" ? 100 : m.progress,
        });
        // Mirror server-assigned id back into the matching mirror row so
        // future reads can find it by server id, not just clientId.
        await this.applyServerIdToMirror(db, m, resolvedId);
        // 4C — only NOW is the captured Blob safe to drop from IDB.
        if (m.kind === "photo.upload") {
          try { await deletePhotoBlob(db, m.clientId); } catch {}
        }
        await this.broadcastState();
      } else if (res.status === 409) {
        // Conflict — server wins.
        let message = "Conflict";
        try { message = (await res.text()) || message; } catch {}
        await updateMutation(db, m.id, {
          status: "completed",
          lastError: `409: ${message}`,
        });
        const wetCheckId = await this.findWetCheckIdForMutation(db, m);
        if (wetCheckId) {
          await this.refreshMirrorFromServer(db, wetCheckId);
        }
        this.emit({
          type: "conflict",
          mutationId: m.id,
          kind: m.kind,
          wetCheckId: wetCheckId ?? null,
          message,
        });
        await this.broadcastState();
      } else if (res.status >= 400 && res.status < 500) {
        // Other 4xx. Two flavors:
        //   • JSON 4xx from our API → real validation/permission error;
        //     mark failed and surface so the UI can show it.
        //   • HTML / non-JSON 4xx (typically a generic 401/403/blocked-host
        //     page injected by the Replit edge proxy or a stale PWA shell
        //     before the request reaches Express) → treat as a transient
        //     network hiccup, keep the mutation pending, flip offline so
        //     the heartbeat recovers us, and back off. (Task #469.)
        let body = "";
        try { body = await res.text(); } catch {}
        const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
        const looksLikeEdge = isLikelyEdgeError(ctype, body);
        const message = body || `${res.status}`;
        if (looksLikeEdge) {
          this.setOnline(false);
          await updateMutation(db, m.id, {
            status: "pending",
            attemptCount: m.attemptCount + 1,
            lastError: `edge_${res.status}`,
          });
          await this.broadcastState();
          const wait = backoffMs(m.attemptCount + 1);
          setTimeout(() => this.scheduleTick(), wait);
        } else {
          await updateMutation(db, m.id, {
            status: "failed",
            lastError: message,
            attemptCount: m.attemptCount + 1,
          });
          this.emit({
            type: "error",
            mutationId: m.id,
            kind: m.kind,
            status: res.status,
            message,
          });
          await this.broadcastState();
        }
      } else {
        // 5xx → retry with backoff.
        let message = `${res.status}`;
        try { message = (await res.text()) || message; } catch {}
        // 5xx might mean server-side outage — flip offline-ish to throttle
        // future tries. Heartbeat will recover us.
        if (res.status >= 500) this.setOnline(false);
        await updateMutation(db, m.id, {
          status: "pending",
          attemptCount: m.attemptCount + 1,
          lastError: message,
        });
        await this.broadcastState();
        const wait = backoffMs(m.attemptCount + 1);
        setTimeout(() => this.scheduleTick(), wait);
      }
    } catch (err: any) {
      // Network error — treat as offline + backoff.
      this.setOnline(false);
      await updateMutation(db, m.id, {
        status: "pending",
        attemptCount: m.attemptCount + 1,
        lastError: err?.message ?? String(err),
      });
      const wait = backoffMs(m.attemptCount + 1);
      setTimeout(() => this.scheduleTick(), wait);
    } finally {
      this.inFlight.delete(m.id);
      this.aborts.delete(m.id);
    }
    // Chain the next dispatch immediately if there's room.
    if (this.online && this.inFlight.size < this.maxConcurrent) {
      this.scheduleTick();
    }
  }

  // 4C — sign → PUT → finalize → POST. The Blob lives in IndexedDB; on
  // every retry we re-sign and re-PUT (signed URLs are short-lived).
  // Returns the final metadata-POST Response so the outer dispatch loop
  // can apply its standard ok/409/4xx/5xx classification.
  private async dispatchPhotoUpload(
    db: OfflineDB,
    m: QueuedMutation,
    metadataUrl: string,
    metadataBody: any,
  ): Promise<Response> {
    const blobRow = await getPhotoBlob(db, m.clientId);
    if (!blobRow) {
      // The Blob was lost (manual IDB clear, partial upgrade, etc).
      // Synthesize a permanent 4xx so the outer loop fails the mutation
      // instead of retrying it forever against missing bytes.
      return new Response(
        JSON.stringify({ message: "Photo bytes missing from local storage" }),
        { status: 410, headers: { "Content-Type": "application/json" } },
      );
    }
    const auth = this.authHeaders();
    // 1) Sign
    const signRes = await this.fetchImpl(
      `/api/upload/photo?originalName=${encodeURIComponent(blobRow.name)}`,
      { method: "POST", headers: auth, credentials: "include" },
    );
    if (!signRes.ok) return signRes;
    const signed = await signRes.json();
    await updateMutation(db, m.id, { progress: 25 });
    // 2) PUT bytes to signed URL.
    const putRes = await this.fetchImpl(signed.signedUrl, {
      method: "PUT",
      body: blobRow.blob,
      headers: { "Content-Type": blobRow.contentType },
    });
    if (!putRes.ok) {
      // Surface as a 5xx so the outer loop schedules a retry — signed
      // URLs commonly fail with transient 503s on weak LTE.
      return new Response("PUT failed", { status: 502 });
    }
    await updateMutation(db, m.id, { progress: 60 });
    // 3) Finalize
    const finRes = await this.fetchImpl("/api/upload/photo/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      credentials: "include",
      body: JSON.stringify({ photoId: signed.url }),
    });
    if (!finRes.ok) return finRes;
    await updateMutation(db, m.id, { progress: 80 });
    // 4) POST metadata to /api/wet-checks/:id/photos. The placeholder-
    // resolved body from the queue is merged with the dynamic url field.
    const finalBody = { ...(metadataBody as object | null ?? {}), url: signed.url };
    return await this.fetchImpl(metadataUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      credentials: "include",
      body: JSON.stringify(finalBody),
    });
  }

  private async applyServerIdToMirror(db: OfflineDB, m: QueuedMutation, id: number | null) {
    if (id == null) return;
    if (m.kind === "wet_check.create") {
      const tx = db.transaction("wetChecks", "readwrite");
      const cur = await tx.store.get(m.clientId);
      if (cur) await tx.store.put({ ...cur, id });
      await tx.done;
    } else if (m.kind === "zone_record.upsert") {
      const tx = db.transaction("wetCheckZoneRecords", "readwrite");
      const cur = await tx.store.get(m.clientId);
      if (cur) await tx.store.put({ ...cur, id });
      await tx.done;
    } else if (m.kind === "finding.create") {
      const tx = db.transaction("wetCheckFindings", "readwrite");
      const cur = await tx.store.get(m.clientId);
      if (cur) await tx.store.put({ ...cur, id });
      await tx.done;
    }
  }

  private async findWetCheckIdForMutation(db: OfflineDB, m: QueuedMutation): Promise<number | null> {
    // Walk parent chain to find the wet check id this mutation belongs to.
    let cursor: QueuedMutation | undefined | null = m;
    const all = await listAllMutations(db);
    const byClientId = new Map(all.map((x) => [x.clientId, x] as const));
    while (cursor) {
      if (cursor.kind.startsWith("wet_check.")) {
        if (cursor.resolvedId) return cursor.resolvedId;
        const mirror = await db.get("wetChecks", cursor.clientId);
        if (mirror?.id) return mirror.id;
      }
      // Many queued mutations target pre-existing server entities, so there
      // may be no queued ancestor that owns the wet check id. Fall back to
      // resolving via the per-entity mirrors / placeholders.
      const candidateWetCheckCids: string[] = [];
      if (cursor.kind === "finding.update" || cursor.kind === "finding.delete") {
        const fRow = await db.get("wetCheckFindings", cursor.clientId);
        if (fRow?.wetCheckId) return fRow.wetCheckId;
        const zrCid = fRow?.zoneRecordClientId ?? cursor.parentClientId;
        if (zrCid) {
          const zrRow = await db.get("wetCheckZoneRecords", zrCid);
          if (zrRow?.wetCheckId) return zrRow.wetCheckId;
          if (zrRow?.wetCheckClientId) candidateWetCheckCids.push(zrRow.wetCheckClientId);
        }
      }
      if (cursor.kind === "zone_record.upsert") {
        const zrRow = await db.get("wetCheckZoneRecords", cursor.clientId);
        if (zrRow?.wetCheckId) return zrRow.wetCheckId;
        if (zrRow?.wetCheckClientId) candidateWetCheckCids.push(zrRow.wetCheckClientId);
      }
      // Submit / setStatus carry the wet check clientId via parentClientId
      // or the {{wc}} placeholder; consult the mirror directly.
      const placeholderWcCid = cursor.placeholders?.wc;
      if (placeholderWcCid) candidateWetCheckCids.push(placeholderWcCid);
      if (cursor.parentClientId) candidateWetCheckCids.push(cursor.parentClientId);
      for (const wcCid of candidateWetCheckCids) {
        const wcMirror = await db.get("wetChecks", wcCid);
        if (wcMirror?.id) return wcMirror.id;
      }
      cursor = cursor.parentClientId ? byClientId.get(cursor.parentClientId) ?? null : null;
    }
    return null;
  }

  private async refreshMirrorFromServer(db: OfflineDB, wetCheckId: number): Promise<void> {
    try {
      const res = await this.fetchImpl(`/api/wet-checks/${wetCheckId}`, {
        method: "GET",
        headers: this.authHeaders(),
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const clientId: string = data?.clientId ?? `server-${wetCheckId}`;
      const updatedAt = this.now();
      // Server-wins: drop existing per-entity mirror rows for this wet
      // check so any local entities the server no longer has (e.g. a
      // finding that lost the conflict and was rejected, or one that has
      // been converted/deleted server-side) are removed instead of
      // continuing to render via assembleFromMirror.
      const existingZones = await db.getAllFromIndex("wetCheckZoneRecords", "byWetCheckClientId", clientId);
      for (const zr of existingZones) {
        const existingFindings = await db.getAllFromIndex("wetCheckFindings", "byZoneRecordClientId", zr.clientId);
        for (const f of existingFindings) await db.delete("wetCheckFindings", f.clientId);
        await db.delete("wetCheckZoneRecords", zr.clientId);
      }
      await putWetCheckMirror(db, {
        clientId,
        id: wetCheckId,
        data,
        status: data?.status ?? "in_progress",
        updatedAt,
      });
      // Insert the fresh server snapshot.
      const zoneRecords: any[] = Array.isArray(data?.zoneRecords) ? data.zoneRecords : [];
      for (const zr of zoneRecords) {
        if (!zr?.clientId) continue;
        await db.put("wetCheckZoneRecords", {
          clientId: zr.clientId,
          id: typeof zr.id === "number" ? zr.id : undefined,
          wetCheckClientId: clientId,
          wetCheckId,
          data: zr,
          updatedAt,
        });
        const findings: any[] = Array.isArray(zr?.findings) ? zr.findings : [];
        for (const f of findings) {
          if (!f?.clientId) continue;
          await db.put("wetCheckFindings", {
            clientId: f.clientId,
            id: typeof f.id === "number" ? f.id : undefined,
            zoneRecordClientId: zr.clientId,
            zoneRecordId: typeof zr.id === "number" ? zr.id : undefined,
            wetCheckId,
            data: f,
            updatedAt,
          });
        }
      }
    } catch {
      // ignore
    }
  }
}

// --- Singleton + flag glue ---------------------------------------------

const FLAG_ENABLED =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_OFFLINE_QUEUE !== "false");

export function isOfflineQueueEnabled(): boolean {
  return FLAG_ENABLED;
}

// Slice 4D — Independent feature flag for the sync UI surface (badge,
// queue view, offline strip, conflict toast). Defaults on. Flipping this
// off hides the UI but keeps the queue draining in the background.
const SYNC_UI_FLAG_ENABLED =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_OFFLINE_SYNC_UI !== "false");

export function isOfflineSyncUIEnabled(): boolean {
  return SYNC_UI_FLAG_ENABLED;
}

let singleton: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!singleton) {
    singleton = new SyncEngine({
      authHeaders: () => {
        if (typeof window === "undefined") return {};
        try {
          const raw = localStorage.getItem("user");
          if (!raw) return {};
          const u = JSON.parse(raw);
          const h: Record<string, string> = {};
          if (u?.role) h["x-user-role"] = u.role;
          if (u?.id != null) h["x-user-id"] = String(u.id);
          if (u?.name) h["x-user-name"] = u.name;
          if (u?.companyId != null) h["x-user-company-id"] = String(u.companyId);
          return h;
        } catch { return {}; }
      },
    });
  }
  return singleton;
}

// Test-only.
export function __resetEngineForTests() {
  singleton = null;
}

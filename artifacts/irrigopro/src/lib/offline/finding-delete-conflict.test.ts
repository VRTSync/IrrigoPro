// Task #518 — offline finding-delete 409 conflict path.
//
// When the server refuses a queued finding delete (e.g. the wet check
// has been submitted between when the tech queued the action and when
// the engine got online), it returns 409 instead of the legacy 200
// `{ ok: false }`. The engine's 409 handler must:
//
//   1. Mark the queued mutation completed (no infinite retry) with a
//      409-prefixed lastError so OfflineStrip can surface it.
//   2. Resolve the wet-check id via `placeholders.wc` (Task #518 stamps
//      this in `offlineDeleteFinding`) and call refreshMirrorFromServer
//      so the optimistically-deleted finding row is restored from the
//      server's view — no ghost-deleted row.
//   3. Emit a `conflict` event with the resolved wetCheckId so the
//      conflict-toast-bridge can tell the tech why the delete didn't
//      stick.

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { SyncEngine } from "./engine";
import {
  __resetOfflineDBForTests,
  openOfflineDB,
  putWetCheckMirror,
  putZoneRecordMirror,
  listAllMutations,
} from "./db";
import type { QueuedMutation } from "./types";

async function freshDb() {
  __resetOfflineDBForTests();
  const db = await openOfflineDB();
  await db.clear("mutationQueue");
  await db.clear("wetChecks");
  await db.clear("wetCheckZoneRecords");
  await db.clear("wetCheckFindings");
  return db;
}

function makeFindingDeleteMutation(
  wetCheckClientId: string,
  findingServerId: number,
): QueuedMutation {
  // Mirrors the shape that `offlineDeleteFinding` (api.ts) now produces
  // for a pre-existing online finding (Task #518):
  //   - Server id baked into urlTemplate (no `{{f}}` placeholder, since
  //     the finding mirror is removed optimistically before enqueue and
  //     the placeholder resolver could never resolve it).
  //   - parentClientId points at the WET CHECK clientId, which the
  //     readySet resolver can satisfy via the wet-check mirror.
  //   - placeholders.wc carries the wet-check clientId so
  //     findWetCheckIdForMutation can resolve and call
  //     refreshMirrorFromServer on a 409 refusal.
  return {
    id: "mut-fdel-1",
    kind: "finding.delete",
    method: "DELETE",
    urlTemplate: `/api/wet-checks/findings/${findingServerId}`,
    body: undefined,
    clientId: "fdel-1",
    parentClientId: wetCheckClientId,
    placeholders: { wc: wetCheckClientId },
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
    createdAt: 1_000,
    resolvedId: null,
  };
}

describe("Task #518 — finding.delete 409 conflict triggers mirror refresh", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("on 409 marks the mutation completed with a 409-prefixed lastError and emits a conflict event so the toast bridge can tell the tech the delete didn't stick", async () => {
    const db = await openOfflineDB();
    // Seed wet check + zone record. We deliberately do NOT seed the
    // finding mirror — the production deleteFinding() flow deletes it
    // optimistically before enqueue, which is the realistic state when
    // the engine processes the 409.
    await putWetCheckMirror(db, {
      clientId: "wc-cid-1",
      id: 42,
      data: { id: 42, status: "submitted", zoneRecords: [], photos: [] },
      status: "submitted",
      updatedAt: 1_000,
    });
    await putZoneRecordMirror(db, {
      clientId: "zr-cid-1",
      id: 1001,
      wetCheckClientId: "wc-cid-1",
      wetCheckId: 42,
      data: {},
      updatedAt: 1_000,
    });

    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      seen.push(`${method} ${url}`);
      if (method === "DELETE" && url.startsWith("/api/wet-checks/findings/")) {
        // Server now refuses with 409 (Task #518); previously this was
        // a silent 200 `{ ok: false }`.
        return new Response(
          JSON.stringify({
            message: "Wet check is no longer editable (status: submitted)",
            reason: "wet_check_not_editable",
            wetCheckStatus: "submitted",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      if (method === "GET" && url === "/api/wet-checks/42") {
        // Server-wins refresh: returns the wet check with the finding
        // still present so refreshMirrorFromServer can restore it.
        return new Response(
          JSON.stringify({
            id: 42,
            clientId: "wc-cid-1",
            status: "submitted",
            zoneRecords: [
              {
                id: 1001,
                clientId: "zr-cid-1",
                wetCheckId: 42,
                findings: [
                  { id: 501, clientId: "f-cid-1", zoneRecordId: 1001, wetCheckId: 42 },
                ],
              },
            ],
            photos: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 500 });
    };

    const conflicts: Array<{ wetCheckId: number | null; message: string; kind: string }> = [];
    const engine = new SyncEngine({
      fetchImpl,
      now: () => 2_000,
      heartbeatIntervalMs: 0,
      maxConcurrent: 1,
      maxAttempts: 3,
      maxRetryAgeMs: 60_000,
    });
    engine.on((e) => {
      if (e.type === "conflict") {
        conflicts.push({ wetCheckId: e.wetCheckId, message: e.message, kind: e.kind });
      }
    });
    engine.setOnline(true);

    await engine.enqueue(makeFindingDeleteMutation("wc-cid-1", 501));
    await engine.drainAll();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    // 1. The DELETE actually went out to the server (no client-side
    //    short-circuit on the legacy 200 `{ ok: false }` shape).
    expect(seen).toContain("DELETE /api/wet-checks/findings/501");

    // 2. Mutation is settled with the 409 stamped on lastError so
    //    OfflineStrip / SyncBadge can surface it (and we don't loop).
    const after = await listAllMutations(await openOfflineDB());
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("completed");
    expect(after[0].lastError ?? "").toMatch(/^409:/);
    expect(after[0].lastError ?? "").toMatch(/no longer editable|submitted/i);

    // 3. The engine resolved the wet-check id via placeholders.wc and
    //    refetched the wet check (server-wins).
    expect(seen).toContain("GET /api/wet-checks/42");

    // 4. The optimistically-deleted finding mirror is restored from
    //    the server's view — the row reappears for the tech.
    const restored = await (await openOfflineDB()).get("wetCheckFindings", "f-cid-1");
    expect(restored).toBeDefined();
    expect(restored?.id).toBe(501);

    // 5. A conflict event fires with the resolved wetCheckId so the
    //    toast bridge can tell the tech the delete didn't stick.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("finding.delete");
    expect(conflicts[0].wetCheckId).toBe(42);
    expect(conflicts[0].message).toMatch(/no longer editable|submitted/i);
  });
});

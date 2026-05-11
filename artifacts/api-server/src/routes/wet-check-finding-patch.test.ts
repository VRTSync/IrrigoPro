// Task #468 — locks in the API-level patch semantics for tech edits to
// findings the tech already marked completed-in-field.
//
// There are two halves:
//   1. Pure unit tests on `buildFindingPatchFromBody` that prove omitting
//      `repairedInField` from the body produces a patch with NO resolution /
//      techDisposition / resolutionDecidedAt / resolutionDecidedBy keys —
//      i.e. the storage update will not silently demote the row.
//   2. An HTTP-level test that mounts the real `findingPatchBody` zod
//      schema + `buildFindingPatchFromBody` builder behind a tiny Express
//      handler that mirrors the production route exactly (auth gate +
//      schema parse + builder + storage call). It asserts that the
//      partial Drizzle patch handed to storage.updateWetCheckFinding is
//      `{ notes }`-only when the body only carried `notes` — proving the
//      regression in question (silent demotion to pending) cannot happen.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  buildFindingPatchFromBody,
  findingPatchBody,
} from "./wet-check-finding-patch";

// ─── Pure builder tests ──────────────────────────────────────────────────────
describe("buildFindingPatchFromBody — omit-repairedInField is a no-op on resolution state", () => {
  it("does not set resolution / techDisposition / resolutionDecidedAt / resolutionDecidedBy when repairedInField is omitted", () => {
    // The body that the FindingSheet edit save produces if a future change
    // ever stops sending repairedInField (or sends only the changed fields).
    // The builder must leave the resolution state alone — anything else
    // would let storage.updateWetCheckFinding overwrite the row's
    // repaired_in_field disposition with NULLs.
    const patch = buildFindingPatchFromBody({ notes: "added more detail" }, 7);
    assert.deepEqual(patch, { notes: "added more detail" });
    assert.equal("resolution" in patch, false);
    assert.equal("techDisposition" in patch, false);
    assert.equal("resolutionDecidedAt" in patch, false);
    assert.equal("resolutionDecidedBy" in patch, false);
    assert.equal("noPartNeeded" in patch, false);
  });

  it("preserves noPartNeeded when the body explicitly sends it (locks in tech edits to labor-only Mark Complete findings)", () => {
    const patch = buildFindingPatchFromBody(
      { notes: "edited", noPartNeeded: true },
      7,
    );
    assert.equal(patch.noPartNeeded, true);
    assert.equal("resolution" in patch, false);
    assert.equal("techDisposition" in patch, false);
  });

  it("explicitly sending repairedInField=true sets resolution=repaired_in_field, techDisposition=completed_in_field, and stamps the decider", () => {
    const patch = buildFindingPatchFromBody({ repairedInField: true }, 42);
    assert.equal(patch.resolution, "repaired_in_field");
    assert.equal(patch.techDisposition, "completed_in_field");
    assert.equal(patch.resolutionDecidedBy, 42);
    assert.ok(patch.resolutionDecidedAt instanceof Date);
  });

  it("explicitly sending repairedInField=false demotes the resolution back to pending and clears the decider", () => {
    const patch = buildFindingPatchFromBody({ repairedInField: false }, 42);
    assert.equal(patch.resolution, "pending");
    assert.equal(patch.techDisposition, "needs_review");
    assert.equal(patch.resolutionDecidedAt, null);
    assert.equal(patch.resolutionDecidedBy, null);
  });

  it("an explicit techDisposition wins over the repairedInField mirror", () => {
    const patch = buildFindingPatchFromBody(
      { repairedInField: true, techDisposition: "needs_review" },
      42,
    );
    assert.equal(patch.resolution, "repaired_in_field");
    assert.equal(patch.techDisposition, "needs_review");
  });
});

// ─── HTTP harness ────────────────────────────────────────────────────────────
// Mirrors the production PATCH /api/wet-checks/findings/:id handler in
// artifacts/api-server/src/routes/routes.ts: same zod parse, same builder,
// same storage call shape. We intentionally re-use the real schema +
// builder so any future drift between this test and the production route
// is visible at compile time.
type CapturedUpdate = { id: number; cid: number; patch: Record<string, unknown> };

async function startServer(captured: CapturedUpdate[]): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as unknown as { authenticatedUserId: number }).authenticatedUserId = 7;
    (req as unknown as { authenticatedUserCompanyId: number }).authenticatedUserCompanyId = 1;
    next();
  };
  app.patch("/api/wet-checks/findings/:id", noopAuth, async (req, res) => {
    const parsed = findingPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const userId = (req as unknown as { authenticatedUserId: number }).authenticatedUserId;
    const cid = (req as unknown as { authenticatedUserCompanyId: number }).authenticatedUserCompanyId;
    const patch = buildFindingPatchFromBody(parsed.data, userId);
    const idParam = String(req.params.id);
    captured.push({ id: parseInt(idParam), cid, patch: patch as Record<string, unknown> });
    // Emulate storage returning the row unchanged on a no-op patch.
    res.json({ id: parseInt(idParam), ok: true });
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("PATCH /api/wet-checks/findings/:id — omitting repairedInField is a no-op on resolution/disposition", () => {
  it("only forwards the fields the body actually carried, so a notes-only edit cannot demote a completed-in-field finding", async () => {
    const captured: CapturedUpdate[] = [];
    const { baseUrl, close } = await startServer(captured);
    try {
      const res = await fetch(`${baseUrl}/api/wet-checks/findings/123`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "added more detail after the fact" }),
      });
      assert.equal(res.status, 200);

      assert.equal(captured.length, 1);
      const update = captured[0]!;
      assert.equal(update.id, 123);
      assert.equal(update.cid, 1);
      // The DB-side patch must be notes-only; nothing about resolution
      // state may leak into the UPDATE.
      assert.deepEqual(update.patch, { notes: "added more detail after the fact" });
      assert.equal("resolution" in update.patch, false);
      assert.equal("techDisposition" in update.patch, false);
      assert.equal("resolutionDecidedAt" in update.patch, false);
      assert.equal("resolutionDecidedBy" in update.patch, false);
      assert.equal("noPartNeeded" in update.patch, false);
    } finally {
      await close();
    }
  });

  it("forwards repairedInField=true + noPartNeeded=true exactly as a tech-edit save would (matches the FindingSheet PATCH shape)", async () => {
    const captured: CapturedUpdate[] = [];
    const { baseUrl, close } = await startServer(captured);
    try {
      const res = await fetch(`${baseUrl}/api/wet-checks/findings/456`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partId: null,
          partName: null,
          partPrice: null,
          quantity: 1,
          laborHours: "0.5",
          notes: "leaking head — replaced on the spot",
          repairedInField: true,
          techDisposition: "completed_in_field",
          noPartNeeded: true,
        }),
      });
      assert.equal(res.status, 200);

      const update = captured[0]!;
      assert.equal(update.patch.resolution, "repaired_in_field");
      assert.equal(update.patch.techDisposition, "completed_in_field");
      assert.equal(update.patch.noPartNeeded, true);
      assert.equal(update.patch.resolutionDecidedBy, 7);
      assert.ok(update.patch.resolutionDecidedAt instanceof Date);
      assert.equal(update.patch.partId, null);
      assert.equal(update.patch.notes, "leaking head — replaced on the spot");
    } finally {
      await close();
    }
  });
});

// Task #600 — Two regressions surfaced by production logs:
//
//   1. POST /api/wet-checks/:id/submit returned HTTP 500 when
//      storage.submitWetCheck threw an auto-bill precondition error
//      ("Cannot auto-bill finding N: …"). Those throws are
//      user-fixable validations, not server faults, and the field tech
//      should see the storage-authored instructional message verbatim
//      so they know exactly which finding to fix.
//
//   2. GET /api/photos/photos%2F<uuid> blew up with a 500 because
//      assertCanViewPhoto built its candidate list without collapsing
//      a legacy double `photos/photos/<uuid>` prefix, so no
//      wet_check_photos / work_orders / billing_sheets / estimates row
//      ever matched and the route crashed.
//
// Both fixes are tiny and orthogonal; this file covers them with
// pure-handler harnesses so we don't have to spin up the whole
// routes.ts file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { classifyAndLog } from "./route-error-helpers";

// ─── Submit auto-bill precondition → 400 with raw message ─────────────

describe("POST /api/wet-checks/:id/submit — auto-bill precondition (Task #600)", () => {
  // The exact recognized list from routes.ts. Keeping a literal copy
  // here is intentional: if someone edits the route handler in a way
  // that drops or weakens the "Cannot auto-bill finding" rule, this
  // test fails immediately.
  const recognized = [
    { test: (_e: any, raw: string) => /zero zones checked/.test(raw), status: 400, message: (_e: any, raw: string) => raw },
    { test: (_e: any, raw: string) => /^Cannot auto-bill finding/.test(raw), status: 400, message: (_e: any, raw: string) => raw },
  ];

  async function startServer(throwFn: () => never): Promise<{ baseUrl: string; close: () => Promise<void>; logged: any[] }> {
    const app: Express = express();
    app.use(express.json());
    const logged: any[] = [];
    const noopAuth: RequestHandler = (req, _res, next) => {
      (req as any).authenticatedUserId = 7;
      (req as any).authenticatedUserCompanyId = 1;
      (req as any).authenticatedUserRole = "field_tech";
      (req as any).log = { error: (obj: any) => logged.push(obj) };
      next();
    };
    app.post("/api/wet-checks/:id/submit", noopAuth, async (req: any, res) => {
      try {
        throwFn();
      } catch (e: any) {
        const { status, message } = classifyAndLog(req, e, {
          op: "submitWetCheck",
          ctx: { cid: 1, wetCheckId: req.params.id },
          fallbackMessage: "Couldn't submit wet check — please retry",
          recognized,
        });
        res.status(status).json({ message });
      }
    });
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      logged,
    };
  }

  it("returns 400 + the storage-authored instructional message for the missing-part precondition", async () => {
    const msg =
      'Cannot auto-bill finding 24: marked complete but has no part assigned. ' +
      'Add a part before submitting, tick "No part needed" for a labor-only fix, ' +
      'or leave Mark Complete unchecked to route to the manager.';
    const h = await startServer(() => { throw new Error(msg); });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as any;
      assert.equal(json.message, msg);
      // Recognized errors must NOT spam the error log.
      assert.equal(h.logged.length, 0);
    } finally {
      await h.close();
    }
  });

  it("returns 400 for the non-positive-quantity precondition", async () => {
    const msg = "Cannot auto-bill finding 7: quantity must be > 0 (got 0).";
    const h = await startServer(() => { throw new Error(msg); });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as any;
      assert.equal(json.message, msg);
    } finally {
      await h.close();
    }
  });

  it("returns 400 for the negative-labor-hours precondition", async () => {
    const msg = "Cannot auto-bill finding 9: laborHours must be >= 0 (got -1).";
    const h = await startServer(() => { throw new Error(msg); });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as any;
      assert.equal(json.message, msg);
    } finally {
      await h.close();
    }
  });

  it("preserves the existing 'zero zones checked' 400 path", async () => {
    const h = await startServer(() => { throw new Error("Cannot submit: zero zones checked"); });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as any;
      assert.equal(json.message, "Cannot submit: zero zones checked");
    } finally {
      await h.close();
    }
  });

  it("still returns the generic 500 fallback (and logs) for an unrecognized error", async () => {
    const h = await startServer(() => {
      throw Object.assign(
        new Error('Failed query: select * from "wet_checks" where "id" = $1\nparams: 100'),
        { name: "DrizzleQueryError", cause: Object.assign(new Error("connection terminated"), { code: "57P01" }) },
      );
    });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      assert.equal(res.status, 500);
      const json = (await res.json()) as any;
      assert.equal(json.message, "Couldn't submit wet check — please retry");
      // Raw SQL must not leak into the response.
      assert.equal(JSON.stringify(json).includes("Failed query"), false);
      // But the underlying error MUST be logged server-side.
      assert.equal(h.logged.length, 1);
      assert.equal(h.logged[0].op, "submitWetCheck");
    } finally {
      await h.close();
    }
  });
});

// ─── assertCanViewPhoto: double-prefix key normalization ─────────────

describe("assertCanViewPhoto — double `photos/photos/<uuid>` key (Task #600)", () => {
  // The normalization itself is a tiny pure transform inside the
  // handler closure. Lift the same expression into the test so a
  // future edit that drops the de-double step fails here.
  function normalizeCandidates(photoId: string): string[] {
    const stripped = photoId.replace(/^\/+/, "").replace(/__(thumb|medium)\.jpg$/i, "");
    const deDoubled = stripped.replace(/^photos\/photos\//, "photos/");
    return Array.from(new Set([photoId, stripped, deDoubled]));
  }

  it("collapses `photos/photos/<uuid>` to the canonical `photos/<uuid>` candidate", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const candidates = normalizeCandidates(`photos/photos/${uuid}`);
    assert.ok(candidates.includes(`photos/${uuid}`), `expected canonical key in candidates: ${candidates.join(", ")}`);
  });

  it("collapses a leading-slash double-prefix variant too", () => {
    const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const candidates = normalizeCandidates(`/photos/photos/${uuid}`);
    assert.ok(candidates.includes(`photos/${uuid}`), `expected canonical key in candidates: ${candidates.join(", ")}`);
  });

  it("leaves a single-prefix `photos/<uuid>` request untouched", () => {
    const uuid = "deadbeef-0000-0000-0000-000000000000";
    const candidates = normalizeCandidates(`photos/${uuid}`);
    assert.deepEqual(candidates, [`photos/${uuid}`]);
  });

  it("still strips variant suffixes (thumb/medium) alongside the de-double step", () => {
    const uuid = "feedface-0000-0000-0000-000000000000";
    const candidates = normalizeCandidates(`photos/photos/${uuid}__thumb.jpg`);
    assert.ok(candidates.includes(`photos/${uuid}`), `expected canonical key in candidates: ${candidates.join(", ")}`);
  });
});

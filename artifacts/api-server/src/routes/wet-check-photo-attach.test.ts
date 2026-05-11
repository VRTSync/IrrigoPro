// Task #495 — Wet check photo attach handler regression tests.
//
// Locks in two pieces of the fix:
//
//   1. The POST /api/wet-checks/:id/photos handler must NEVER echo a
//      Drizzle "Failed query: ..." string back to the field tech. When
//      storage throws an unrecognized error, the response message must
//      be a short user-safe sentence and the raw SQL must not appear
//      in the body at all.
//
//   2. Recognized expected errors (wet check no longer in_progress,
//      cross-record linkage mismatch, UUID-collision-across-wet-checks)
//      must surface their tech-friendly messages with the right status.
//
// We do NOT exercise the storage path against a real DB here — the
// logic under test is purely the handler's classify/sanitize step. A
// stub `storage` module with a swappable `attachWetCheckPhoto` lets us
// drive every error branch deterministically.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

// We import the REAL production classify + log helpers so this test
// drifts the moment routes.ts diverges. The handler shape itself
// mirrors POST /api/wet-checks/:id/photos in routes.ts (auth gate +
// schema parse + storage call + classifyWetCheckPhotoError +
// logPhotoErrorContext).
import {
  classifyWetCheckPhotoError,
  logPhotoErrorContext,
} from "./wet-check-photo-errors";

const photoBody = z.object({
  zoneRecordId: z.coerce.number().int().nullish(),
  findingId: z.coerce.number().int().nullish(),
  url: z.string().min(1),
  caption: z.string().nullish(),
  takenAt: z.union([z.string().datetime(), z.number(), z.date()]).nullish(),
  clientId: z.string().uuid().nullish(),
});

interface ServerHarness {
  baseUrl: string;
  close: () => Promise<void>;
  setAttach: (fn: (...args: any[]) => Promise<any>) => void;
  loggedErrors: any[];
}
async function startServer(): Promise<ServerHarness> {
  const app: Express = express();
  app.use(express.json());
  let attach: (...args: any[]) => Promise<any> = async () => ({ id: 1 });
  const loggedErrors: any[] = [];

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 7;
    (req as any).authenticatedUserCompanyId = 1;
    (req as any).authenticatedUserRole = "field_tech";
    (req as any).log = {
      error: (obj: any) => loggedErrors.push(obj),
    };
    next();
  };

  app.post("/api/wet-checks/:id/photos", noopAuth, async (req: any, res) => {
    const parsed = photoBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const wetCheckId = parseInt(req.params.id);
    if (!Number.isFinite(wetCheckId)) {
      res.status(400).json({ message: "Invalid wet check id" });
      return;
    }
    try {
      const created = await attach(wetCheckId, 1, {
        zoneRecordId: body.zoneRecordId ?? null,
        findingId: body.findingId ?? null,
        url: body.url,
        caption: body.caption ?? null,
        takenAt: new Date(),
        takenBy: 7,
        clientId: body.clientId ?? null,
      });
      res.status(201).json(created);
    } catch (e: any) {
      const { status, message } = classifyWetCheckPhotoError(e);
      logPhotoErrorContext(req, e, {
        op: "attachWetCheckPhoto",
        wetCheckId,
        photoClientId: body.clientId ?? null,
        zoneRecordId: body.zoneRecordId ?? null,
        findingId: body.findingId ?? null,
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
    setAttach: (fn) => { attach = fn; },
    loggedErrors,
  };
}

const validBody = () => ({
  url: "photos/abc123",
  clientId: "11111111-2222-3333-4444-555555555555",
  zoneRecordId: 42,
  findingId: 99,
});

describe("POST /api/wet-checks/:id/photos — error sanitization (Task #495)", () => {
  it("never leaks a Drizzle 'Failed query' SQL string to the client", async () => {
    const h = await startServer();
    try {
      const drizzleStyleError = Object.assign(
        new Error(
          'Failed query: select "id", "wet_check_id", "zone_record_id", "finding_id", "url", "caption", "taken_at", "taken_by", "client_id" from "wet_check_photos" where "wet_check_photos"."client_id" = $1\nparams: 11111111-2222-3333-4444-555555555555',
        ),
        { name: "DrizzleQueryError", cause: Object.assign(new Error("connection terminated"), { code: "57P01" }) },
      );
      h.setAttach(async () => { throw drizzleStyleError; });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(res.status, 500);
      const json = await res.json() as any;
      assert.equal(json.message, "Couldn't attach photo — please retry");
      // The raw SQL must NOT appear anywhere in the response body.
      const raw = JSON.stringify(json);
      assert.equal(raw.includes("Failed query"), false);
      assert.equal(raw.includes("select"), false);
      assert.equal(raw.includes("wet_check_photos"), false);
      // But the full underlying error MUST have been logged server-side
      // with enough context to debug.
      assert.equal(h.loggedErrors.length, 1);
      const logged = h.loggedErrors[0]!;
      assert.equal(logged.op, "attachWetCheckPhoto");
      assert.equal(logged.wetCheckId, 100);
      assert.equal(logged.photoClientId, "11111111-2222-3333-4444-555555555555");
      assert.equal(logged.zoneRecordId, 42);
      assert.equal(logged.findingId, 99);
      assert.equal(logged.userId, 7);
      assert.equal(logged.companyId, 1);
      assert.equal(logged.err.code, "57P01");
      assert.match(String(logged.err.message), /Failed query/);
    } finally {
      await h.close();
    }
  });

  it("returns 409 with a tech-friendly message when a UUID collision tags the photo to a different wet check", async () => {
    const h = await startServer();
    try {
      const collision = Object.assign(
        new Error("Photo client id already used on another wet check"),
        { code: "WET_CHECK_PHOTO_CLIENT_ID_COLLISION" },
      );
      h.setAttach(async () => { throw collision; });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(res.status, 409);
      const json = await res.json() as any;
      assert.equal(json.message, "Photo already attached to a different wet check");
    } finally {
      await h.close();
    }
  });

  it("returns 409 with a tech-friendly 'no longer editable' message when the wet check is already submitted", async () => {
    const h = await startServer();
    try {
      h.setAttach(async () => {
        throw new Error("Wet check 100 is submitted; only in-progress wet checks can be edited");
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(res.status, 409);
      const json = await res.json() as any;
      assert.equal(json.message, "This wet check is no longer editable");
    } finally {
      await h.close();
    }
  });

  it("returns 400 with a clear linkage message when the zone/finding belongs to a different wet check", async () => {
    const h = await startServer();
    try {
      h.setAttach(async () => {
        throw new Error("Zone record 42 does not belong to wet check 100");
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(res.status, 400);
      const json = await res.json() as any;
      assert.equal(json.message, "Photo target doesn't belong to this wet check");
    } finally {
      await h.close();
    }
  });

  it("idempotent attach: when storage returns the existing row (same clientId), the handler relays it as 201", async () => {
    const h = await startServer();
    try {
      const existing = { id: 999, wetCheckId: 100, clientId: "11111111-2222-3333-4444-555555555555", url: "photos/abc123" };
      h.setAttach(async () => existing);
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(res.status, 201);
      const json = await res.json() as any;
      assert.equal(json.id, 999);
      assert.equal(h.loggedErrors.length, 0);
    } finally {
      await h.close();
    }
  });
});

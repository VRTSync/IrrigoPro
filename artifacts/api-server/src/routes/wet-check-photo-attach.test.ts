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
// Task #1230 adds a second describe block that exercises the DELETE
// handler's manager escape hatch:
//   - Manager can delete a loose photo on a submitted wet check (200).
//   - Manager is blocked (409) from deleting an attached photo.
//   - Field tech is still blocked (409) from deleting on a submitted check.
//
// We do NOT exercise the storage path against a real DB here — the
// logic under test is purely the handler's classify/sanitize step. A
// stub `storage` module with a swappable handler lets us drive every
// error branch deterministically.

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

const MANAGER_ROLES = new Set(["irrigation_manager", "company_admin", "super_admin"]);
const FIELD_ROLES = new Set(["field_tech"]);

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

// ── DELETE harness ────────────────────────────────────────────────────────────
// Mirrors the production DELETE /api/wet-checks/photos/:id handler from
// wet-check-photo-attach-route.ts.  Two swappable stubs replace:
//   deleteWetCheckPhoto          — field-tech path
//   deleteLooseWetCheckPhotoAsManager — manager path

interface DeleteHarness {
  baseUrl: string;
  close: () => Promise<void>;
  setRole: (role: string) => void;
  setDeleteField: (fn: (id: number, cid: number) => Promise<boolean>) => void;
  setDeleteManager: (fn: (id: number, cid: number) => Promise<boolean>) => void;
  loggedErrors: any[];
}

async function startDeleteServer(): Promise<DeleteHarness> {
  const app: Express = express();
  app.use(express.json());

  let currentRole = "field_tech";
  let deleteField: (id: number, cid: number) => Promise<boolean> = async () => true;
  let deleteManager: (id: number, cid: number) => Promise<boolean> = async () => true;
  const loggedErrors: any[] = [];

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 7;
    (req as any).authenticatedUserCompanyId = 1;
    (req as any).authenticatedUserRole = currentRole;
    (req as any).log = { error: (obj: any) => loggedErrors.push(obj) };
    next();
  };

  app.delete("/api/wet-checks/photos/:id", noopAuth, async (req: any, res) => {
    const cid = 1;
    const role: string = req.authenticatedUserRole;
    const isManager = MANAGER_ROLES.has(role);
    const isField = FIELD_ROLES.has(role);
    if (!isField && !isManager) { res.status(403).json({ message: "Forbidden" }); return; }

    const photoId = parseInt(req.params.id);
    if (!Number.isFinite(photoId)) { res.status(400).json({ message: "Invalid photo id" }); return; }

    try {
      const ok = isManager
        ? await deleteManager(photoId, cid)
        : await deleteField(photoId, cid);
      res.json({ ok });
    } catch (e: any) {
      const cls = classifyWetCheckPhotoError(e);
      const message = cls.status === 500 ? "Couldn't remove photo — please retry" : cls.message;
      logPhotoErrorContext(req, e, {
        op: isManager ? "deleteLooseWetCheckPhotoAsManager" : "deleteWetCheckPhoto",
        photoId,
      });
      res.status(cls.status).json({ message });
    }
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setRole: (r) => { currentRole = r; },
    setDeleteField: (fn) => { deleteField = fn; },
    setDeleteManager: (fn) => { deleteManager = fn; },
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

describe("DELETE /api/wet-checks/photos/:id — manager loose-photo escape hatch (Task #1230)", () => {
  it("manager can delete a loose photo on a submitted wet check (200)", async () => {
    const h = await startDeleteServer();
    h.setRole("irrigation_manager");
    // deleteLooseWetCheckPhotoAsManager resolves true — photo existed and was deleted.
    h.setDeleteManager(async (_id, _cid) => true);
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/photos/42`, { method: "DELETE" });
      assert.equal(res.status, 200);
      const json = await res.json() as any;
      assert.equal(json.ok, true);
      assert.equal(h.loggedErrors.length, 0);
    } finally {
      await h.close();
    }
  });

  it("manager cannot delete an attached photo on a submitted wet check (409)", async () => {
    const h = await startDeleteServer();
    h.setRole("company_admin");
    // storage throws WET_CHECK_PHOTO_NOT_LOOSE when findingId / zoneRecordId is set.
    h.setDeleteManager(async () => {
      const err = Object.assign(
        new Error("Only unattached photos can be removed after a wet check is submitted"),
        { code: "WET_CHECK_PHOTO_NOT_LOOSE" },
      );
      throw err;
    });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/photos/99`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const json = await res.json() as any;
      assert.equal(json.message, "Only unattached photos can be removed after a wet check is submitted");
    } finally {
      await h.close();
    }
  });

  it("field tech is still blocked from deleting a photo on a submitted wet check (409)", async () => {
    const h = await startDeleteServer();
    h.setRole("field_tech");
    // deleteWetCheckPhoto throws the editability guard error for non-in-progress wet checks.
    h.setDeleteField(async () => {
      throw new Error("Wet check 55 is submitted; only in-progress wet checks can be edited");
    });
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/photos/55`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const json = await res.json() as any;
      assert.equal(json.message, "This wet check is no longer editable");
    } finally {
      await h.close();
    }
  });

  it("non-manager non-field roles are rejected with 403", async () => {
    const h = await startDeleteServer();
    h.setRole("billing_manager");
    try {
      const res = await fetch(`${h.baseUrl}/api/wet-checks/photos/10`, { method: "DELETE" });
      assert.equal(res.status, 403);
    } finally {
      await h.close();
    }
  });
});

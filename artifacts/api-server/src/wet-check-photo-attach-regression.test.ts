// Task #1011 — Regression guard: FK anchor fields (zoneRecordId / findingId)
// survive the full Zod-parse → handler → storage write path.
//
// This test exercises the REAL production code by importing
// registerWetCheckPhotoAttachRoutes from the extracted route module and
// monkey-patching the storage singleton (same pattern as budget-routes.test.ts
// and billing-sheet-tenant-guard.test.ts).  It does NOT re-implement the
// handler; any future change to the Zod schema, the ?? null guards, or the
// storage call shape is caught here automatically.
//
// Three cases for POST /api/wet-checks/:id/photos:
//   1. finding-anchored — body carries zoneRecordId + findingId; both
//      non-null values must reach storage.attachWetCheckPhoto.
//   2. zone-only        — body carries zoneRecordId, findingId absent;
//      storage sees zoneRecordId non-null, findingId null.
//   3. intentionally-loose — neither FK in body; storage sees both null.
//
// One case for PATCH /api/wet-checks/photos/:id:
//   4. photo link       — body carries findingId; storage.linkWetCheckPhotoToFinding
//      receives the correct photoId and findingId.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { registerWetCheckPhotoAttachRoutes, type RegisterWetCheckPhotoRouteDeps } from "./routes/wet-check-photo-attach-route";
import { storage } from "./storage";

// ── Storage spy ──────────────────────────────────────────────────────────────
// Capture the arguments passed to each storage method so the tests can assert
// the FK fields survive the full route pipeline.  We patch the singleton
// directly (same approach as budget-routes.test.ts) and restore after each
// test group.

type AttachArgs = Parameters<typeof storage.attachWetCheckPhoto>;
type LinkArgs   = Parameters<typeof storage.linkWetCheckPhotoToFinding>;

const attachCalls: AttachArgs[] = [];
const linkCalls: LinkArgs[] = [];

const origAttach = storage.attachWetCheckPhoto.bind(storage);
const origLink   = storage.linkWetCheckPhotoToFinding.bind(storage);

(storage as any).attachWetCheckPhoto = async (...args: AttachArgs) => {
  attachCalls.push(args);
  const [wetCheckId, , insert] = args;
  return {
    id: 999,
    wetCheckId,
    zoneRecordId: insert.zoneRecordId ?? null,
    findingId: insert.findingId ?? null,
    url: insert.url,
    caption: insert.caption ?? null,
    takenAt: insert.takenAt ?? new Date(),
    takenBy: insert.takenBy,
    clientId: insert.clientId ?? null,
    createdAt: new Date(),
  } as any;
};

(storage as any).linkWetCheckPhotoToFinding = async (...args: LinkArgs) => {
  linkCalls.push(args);
  const [photoId, findingId] = args;
  return { id: photoId, findingId, wetCheckId: 10, url: "photos/stub", zoneRecordId: null } as any;
};

// ── Stub helpers ─────────────────────────────────────────────────────────────
// Minimal stand-ins for the auth + company-id helpers.  They set the same
// fields on req that the real requireAuthentication middleware populates.

function makeDeps(role: string = "field_tech", companyId: number = 1): RegisterWetCheckPhotoRouteDeps {
  const requireAuthentication: express.RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserId = 7;
    req.authenticatedUserCompanyId = companyId;
    req.authenticatedUserRole = role;
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  };
  const requireCompanyId = (req: any, _res: any): number | null =>
    req.authenticatedUserCompanyId ?? null;
  const isFieldRole = (_role: string | undefined) => true;
  const isWetCheckManagerRole = (_role: string | undefined) => true;
  return { requireAuthentication, requireCompanyId, isFieldRole, isWetCheckManagerRole };
}

function makeApp(role?: string, companyId?: number): Express {
  const app = express();
  app.use(express.json());
  registerWetCheckPhotoAttachRoutes(app, makeDeps(role, companyId));
  return app;
}

async function startServer(app: Express): Promise<{ server: Server; base: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}` };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/wet-checks/:id/photos — FK anchor round-trip (Task #1011)", () => {
  let server: Server | undefined;
  let base = "";

  after(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    (storage as any).attachWetCheckPhoto = origAttach;
    (storage as any).linkWetCheckPhotoToFinding = origLink;
  });

  it("case 1 — finding-anchored: zoneRecordId + findingId both reach storage non-null", async () => {
    attachCalls.length = 0;
    const app = makeApp();
    ({ server, base } = await startServer(app));

    const res = await fetch(`${base}/api/wet-checks/10/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "photos/case1",
        clientId: "11111111-2222-3333-4444-555555555555",
        zoneRecordId: 42,
        findingId: 99,
        takenAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.text()}`);
    assert.equal(attachCalls.length, 1, "storage.attachWetCheckPhoto must be called exactly once");

    const [wetCheckId, companyId, insert] = attachCalls[0];
    assert.equal(wetCheckId, 10, "wetCheckId routed from URL param");
    assert.equal(companyId, 1,  "companyId from authenticated session");
    assert.equal(insert.zoneRecordId, 42, `zoneRecordId must be 42, got ${insert.zoneRecordId}`);
    assert.equal(insert.findingId,    99, `findingId must be 99, got ${insert.findingId}`);
    assert.equal(insert.url, "photos/case1");

    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("case 2 — zone-only: zoneRecordId non-null, findingId null", async () => {
    attachCalls.length = 0;
    const app = makeApp();
    ({ server, base } = await startServer(app));

    const res = await fetch(`${base}/api/wet-checks/10/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "photos/case2",
        clientId: "22222222-3333-4444-5555-666666666666",
        zoneRecordId: 42,
        takenAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.text()}`);
    assert.equal(attachCalls.length, 1);

    const [, , insert] = attachCalls[0];
    assert.equal(insert.zoneRecordId, 42,   `zoneRecordId must be 42, got ${insert.zoneRecordId}`);
    assert.equal(insert.findingId,    null,  `findingId must be null when absent, got ${insert.findingId}`);

    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("case 3 — intentionally loose: both FKs null when neither sent", async () => {
    attachCalls.length = 0;
    const app = makeApp();
    ({ server, base } = await startServer(app));

    const res = await fetch(`${base}/api/wet-checks/10/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "photos/case3",
        clientId: "33333333-4444-5555-6666-777777777777",
        takenAt: new Date().toISOString(),
      }),
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${await res.text()}`);
    assert.equal(attachCalls.length, 1);

    const [, , insert] = attachCalls[0];
    assert.equal(insert.zoneRecordId, null, `zoneRecordId should be null, got ${insert.zoneRecordId}`);
    assert.equal(insert.findingId,    null, `findingId should be null, got ${insert.findingId}`);

    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("case 4 — PATCH photo link: findingId reaches storage.linkWetCheckPhotoToFinding", async () => {
    linkCalls.length = 0;
    const app = makeApp();
    ({ server, base } = await startServer(app));

    const res = await fetch(`${base}/api/wet-checks/photos/55`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingId: 77 }),
    });

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${await res.text()}`);
    assert.equal(linkCalls.length, 1, "storage.linkWetCheckPhotoToFinding must be called exactly once");

    const [photoId, findingId, companyId] = linkCalls[0];
    assert.equal(photoId,    55, `photoId must be 55, got ${photoId}`);
    assert.equal(findingId,  77, `findingId must be 77, got ${findingId}`);
    assert.equal(companyId,  1,  `companyId must be 1, got ${companyId}`);

    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("role guard: non-field role receives 403", async () => {
    const deps: RegisterWetCheckPhotoRouteDeps = {
      requireAuthentication: ((req: any, _res, next) => {
        req.authenticatedUserId = 99;
        req.authenticatedUserCompanyId = 1;
        req.authenticatedUserRole = "billing_manager";
        req.log = { error: () => {} };
        next();
      }) as express.RequestHandler,
      requireCompanyId: (req: any) => req.authenticatedUserCompanyId,
      isFieldRole: () => false,
      isWetCheckManagerRole: () => false,
    };
    const app = express();
    app.use(express.json());
    registerWetCheckPhotoAttachRoutes(app, deps);
    ({ server, base } = await startServer(app));

    const res = await fetch(`${base}/api/wet-checks/10/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "photos/guard-test", takenAt: new Date().toISOString() }),
    });
    assert.equal(res.status, 403, `expected 403 for non-field role, got ${res.status}`);

    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it("schema validation: missing url yields 400", async () => {
    attachCalls.length = 0;
    const app = makeApp();
    ({ server, base } = await startServer(app));

    const res = await fetch(`${base}/api/wet-checks/10/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneRecordId: 1, findingId: 2 }),
    });
    assert.equal(res.status, 400, `expected 400 when url is missing, got ${res.status}`);
    assert.equal(attachCalls.length, 0, "storage must not be called on invalid body");

    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });
});

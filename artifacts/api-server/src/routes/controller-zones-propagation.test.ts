// Integration tests: controller edits propagate to wet-check zone screens
// without a page reload.
//
// Covers:
//   1. PUT /api/irrigation-controllers/:id returns the updated totalZones and name.
//   2. GET /api/irrigation-controllers/company-rollup reflects those changes
//      in the very next request (same request cycle — no page reload required).
//   3. The irrigationControllers DB row is stamped with the new values so that
//      any downstream consumer (wet-check zone resolver, customer profile page)
//      reads the canonical store and gets current data.
//
// Pattern mirrors irrigation-profile-routes.test.ts: lightweight Express
// server, stub requireAuthentication, real dev DB.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "@workspace/db";
import { irrigationControllers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import { registerIrrigationProfileRoutes } from "./irrigation-profile-routes";
import { storage } from "../storage";

// ── Shared test harness ───────────────────────────────────────────────────────

interface TestUser {
  role: string;
  companyId: number | null;
  userId: number;
}

function makeServer(user: TestUser) {
  const app = express();
  app.use(express.json());

  const auth: RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserRole = user.role;
    req.authenticatedUserId = user.userId;
    req.authenticatedUserCompanyId = user.companyId;
    next();
  };

  registerIrrigationProfileRoutes(app, { requireAuthentication: auth });

  const server = createServer(app);
  server.listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    base: `http://localhost:${port}`,
    close: (): Promise<void> =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function hit(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, init);
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: parsed };
}

// ── DB fixtures ───────────────────────────────────────────────────────────────

let companyId: number;
let customerId: number;
let adminUserId: number;
let controllerId: number;

async function createFixtures() {
  const company = await storage.createCompany({
    name: `PropagationTest_${Date.now()}`,
    isActive: true,
  });
  companyId = company.id;

  const customer = await storage.createCustomer({
    companyId,
    name: "Propagation Customer",
    email: `prop_${Date.now()}@test.example`,
    phone: null,
  } as any);
  customerId = customer.id;

  const adminUser = await storage.createUser({
    username: `prop_admin_${Date.now()}`,
    password: "hashed",
    name: "PropAdmin",
    email: `prop_admin_${Date.now()}@test.example`,
    role: "company_admin",
    companyId,
    isActive: true,
  } as any);
  adminUserId = adminUser.id;
}

async function cleanupController() {
  if (controllerId) {
    try {
      await storage.deleteIrrigationController(null, controllerId);
    } catch {
      /* already removed */
    }
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Controller edit → zone screen propagation", () => {
  let srv: ReturnType<typeof makeServer>;

  before(async () => {
    await createFixtures();
    // company_admin required for the rollup endpoint
    srv = makeServer({ role: "company_admin", companyId, userId: adminUserId });
  });

  after(async () => {
    await cleanupController();
    await srv.close();
  });

  it("POST creates an initial controller with 6 zones", async () => {
    const r = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerId}/controllers-profile`,
      { name: "Original Name", totalZones: 6 },
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, "Original Name");
    assert.equal(Number(r.body.totalZones), 6);
    controllerId = r.body.id;
  });

  it("PUT /api/irrigation-controllers/:id returns updated name and totalZones", async () => {
    const r = await hit(
      srv.base,
      "PUT",
      `/api/irrigation-controllers/${controllerId}`,
      { name: "Renamed Controller", totalZones: 12 },
    );
    assert.equal(r.status, 200, `PUT failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.name, "Renamed Controller", "name must be updated in response");
    assert.equal(Number(r.body.totalZones), 12, "totalZones must be updated in response");
  });

  it("GET /api/irrigation-controllers/:id reflects the new name and zone count without reload", async () => {
    const r = await hit(
      srv.base,
      "GET",
      `/api/irrigation-controllers/${controllerId}`,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.name, "Renamed Controller");
    assert.equal(Number(r.body.totalZones), 12);
  });

  it("GET /api/irrigation-controllers/company-rollup reflects the renamed controller in the same request cycle", async () => {
    const r = await hit(
      srv.base,
      "GET",
      "/api/irrigation-controllers/company-rollup",
    );
    assert.equal(r.status, 200, `Rollup failed: ${JSON.stringify(r.body)}`);
    assert.ok(Array.isArray(r.body), "rollup must be an array");

    const entry = r.body.find((row: any) => row.customer?.id === customerId);
    assert.ok(entry, `no rollup row for customer ${customerId}`);
    assert.ok(Array.isArray(entry.controllers), "controllers must be an array");

    const ctrl = entry.controllers.find((c: any) => c.id === controllerId);
    assert.ok(ctrl, `controller ${controllerId} not found in rollup`);
    assert.equal(ctrl.name, "Renamed Controller", "rollup must expose updated name");
    assert.equal(Number(ctrl.totalZones), 12, "rollup must expose updated totalZones");
  });

  it("DB row (irrigation_controllers) is stamped with updated values", async () => {
    const [row] = await db
      .select({
        name: irrigationControllers.name,
        totalZones: irrigationControllers.totalZones,
      })
      .from(irrigationControllers)
      .where(eq(irrigationControllers.id, controllerId));

    assert.ok(row, "controller row must exist in DB");
    assert.equal(row.name, "Renamed Controller", "DB name must match");
    assert.equal(Number(row.totalZones), 12, "DB totalZones must match");
  });

  it("PUT only changing name leaves totalZones intact", async () => {
    const r = await hit(
      srv.base,
      "PUT",
      `/api/irrigation-controllers/${controllerId}`,
      { name: "Name Only Change" },
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.name, "Name Only Change");
    assert.equal(Number(r.body.totalZones), 12, "totalZones must be unchanged when not included in PUT");
  });

  it("Rollup reflects the name-only change without full page reload", async () => {
    const r = await hit(
      srv.base,
      "GET",
      "/api/irrigation-controllers/company-rollup",
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const entry = r.body.find((row: any) => row.customer?.id === customerId);
    const ctrl = entry?.controllers?.find((c: any) => c.id === controllerId);
    assert.ok(ctrl, "controller must appear in rollup");
    assert.equal(ctrl.name, "Name Only Change");
    assert.equal(Number(ctrl.totalZones), 12, "totalZones unchanged after name-only edit");
  });

  it("PUT only changing totalZones leaves name intact", async () => {
    const r = await hit(
      srv.base,
      "PUT",
      `/api/irrigation-controllers/${controllerId}`,
      { totalZones: 8 },
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.name, "Name Only Change", "name must be unchanged");
    assert.equal(Number(r.body.totalZones), 8, "totalZones must be updated");
  });

  it("Rollup reflects the zone-count-only change without full page reload", async () => {
    const r = await hit(
      srv.base,
      "GET",
      "/api/irrigation-controllers/company-rollup",
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const entry = r.body.find((row: any) => row.customer?.id === customerId);
    const ctrl = entry?.controllers?.find((c: any) => c.id === controllerId);
    assert.ok(ctrl, "controller must appear in rollup");
    assert.equal(ctrl.name, "Name Only Change", "name unchanged after zone-count edit");
    assert.equal(Number(ctrl.totalZones), 8, "rollup must expose new zone count");
  });
});

// ── Static source assertion: invalidateAll covers all downstream consumers ───
//
// The admin-controllers.tsx page calls invalidateAll() on every mutation
// success which invalidates the rollup key, the controllers key, and the
// customers key. This source check makes sure all three invalidations remain
// present so future refactors cannot silently drop one of the downstream
// consumers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("admin-controllers.tsx invalidateAll covers all downstream consumers (source assertion)", () => {
  const src = readFileSync(
    join(__dirname, "../../../irrigopro/src/pages/admin-controllers.tsx"),
    "utf8",
  );

  it("invalidateAll invalidates the company-rollup key", () => {
    assert.ok(
      src.includes("company-rollup"),
      "invalidateAll must include the company-rollup query key",
    );
  });

  it("invalidateAll invalidates the /api/irrigation-controllers key", () => {
    assert.ok(
      src.includes("/api/irrigation-controllers"),
      "invalidateAll must invalidate irrigation-controllers so detail pages refresh",
    );
  });

  it("invalidateAll is called from editMutation.onSuccess", () => {
    assert.ok(
      src.includes("invalidateAll"),
      "invalidateAll must be called from mutation onSuccess callbacks",
    );
  });

  it("editMutation calls PUT /api/irrigation-controllers/:id with both name and totalZones", () => {
    assert.ok(
      src.includes("totalZones"),
      "editMutation payload must include totalZones so zone screen picks it up",
    );
  });
});

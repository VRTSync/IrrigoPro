// Integration tests for the Irrigation System Profile routes (Build 1).
//
// Tests are against the real dev DB (same approach as other DB-backed route
// tests in this directory). They cover:
//   - Happy path: create controller → add programs + zones → GET full graph →
//     PUT updates → history snapshot growth
//   - Photo attach: POST photo URL → GET returns settingsPhotoUrl
//   - Tenant isolation: company A manager cannot access company B data by any id
//   - Customer ownership guard: POST controller under wrong company's customer → 404
//   - super_admin cross-tenant access
//   - Name-uniqueness per tenant (two companies can each have "Controller A")
//
// Pattern mirrors admin-migrations-routes.test.ts: lightweight Express server,
// stub requireAuthentication, real storage.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "@workspace/db";
import { irrigationControllers } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";

import { registerIrrigationProfileRoutes } from "./irrigation-profile-routes";
import { storage } from "../storage";

// ── Test server factory ────────────────────────────────────────────────────────

interface TestUser {
  role: string;
  companyId: number | null;
  userId: number;
}

function makeTestServer(user: TestUser): { base: string; close: () => Promise<void> } {
  const app = express();
  app.use(express.json());

  const auth: RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserRole = user.role;
    req.authenticatedUserId = user.userId;
    req.authenticatedUserCompanyId = user.companyId;
    next();
  };

  // Minimal getUser stub so handlers that call storage.getUser(userId) work
  // during tests without a real user row. The irrigation routes only use
  // actor.name for stamps; a missing user just produces null stamps.

  registerIrrigationProfileRoutes(app, { requireAuthentication: auth });

  const server = createServer(app);
  server.listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    base: `http://localhost:${port}`,
    close: () =>
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
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed };
}

// ── DB setup helpers ───────────────────────────────────────────────────────────

let companyAId: number;
let companyBId: number;
let customerAId: number;
let customerBId: number;
let managerAUserId: number;
let managerBUserId: number;
// IDs of created controllers/programs/zones to clean up in afterEach.
const createdControllerIds: number[] = [];

async function setupCompanies() {
  const compA = await storage.createCompany({
    name: `IrrigTestCompA_${Date.now()}`,
    isActive: true,
  });
  companyAId = compA.id;

  const compB = await storage.createCompany({
    name: `IrrigTestCompB_${Date.now()}`,
    isActive: true,
  });
  companyBId = compB.id;

  const custA = await storage.createCustomer({
    companyId: companyAId,
    name: "Test Customer A",
    email: `custa_${Date.now()}@test.example`,
    phone: null,
  } as any);
  customerAId = custA.id;

  const custB = await storage.createCustomer({
    companyId: companyBId,
    name: "Test Customer B",
    email: `custb_${Date.now()}@test.example`,
    phone: null,
  } as any);
  customerBId = custB.id;

  const userA = await storage.createUser({
    username: `irrig_mgr_a_${Date.now()}`,
    password: "hashed",
    name: "Manager A",
    email: `mgr_a_${Date.now()}@test.example`,
    role: "irrigation_manager",
    companyId: companyAId,
    isActive: true,
  } as any);
  managerAUserId = userA.id;

  const userB = await storage.createUser({
    username: `irrig_mgr_b_${Date.now()}`,
    password: "hashed",
    name: "Manager B",
    email: `mgr_b_${Date.now()}@test.example`,
    role: "irrigation_manager",
    companyId: companyBId,
    isActive: true,
  } as any);
  managerBUserId = userB.id;
}

async function cleanupControllers() {
  for (const id of createdControllerIds) {
    try {
      await storage.deleteIrrigationController(null, id);
    } catch { /* already cleaned */ }
  }
  createdControllerIds.length = 0;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Irrigation Profile routes — Happy path", () => {
  let srv: ReturnType<typeof makeTestServer>;

  before(async () => {
    await setupCompanies();
    srv = makeTestServer({ role: "irrigation_manager", companyId: companyAId, userId: managerAUserId });
  });

  after(async () => {
    await cleanupControllers();
    await srv.close();
  });

  it("POST /api/customers/:id/controllers-profile creates a controller", async () => {
    const r = await hit(srv.base, "POST", `/api/customers/${customerAId}/controllers-profile`, {
      name: "Controller A",
      brand: "Hunter",
      model: "Pro-C",
      totalZones: 12,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, "Controller A");
    assert.equal(r.body.companyId, companyAId);
    createdControllerIds.push(r.body.id);
  });

  it("GET /api/customers/:id/controllers-profile lists the created controller", async () => {
    const r = await hit(srv.base, "GET", `/api/customers/${customerAId}/controllers-profile`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
    const ctrl = r.body.find((c: any) => c.name === "Controller A");
    assert.ok(ctrl, "Controller A should appear in list");
  });

  it("POST /api/irrigation-controllers/:id/programs creates a program", async () => {
    const ctrlId = createdControllerIds[0];
    const r = await hit(srv.base, "POST", `/api/irrigation-controllers/${ctrlId}/programs`, {
      name: "A",
      wateringDays: ["Mon", "Wed", "Fri"],
      startTimes: ["06:00"],
      seasonalAdjustPct: 100,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, "A");
    assert.equal(r.body.controllerId, ctrlId);
    assert.equal(r.body.companyId, companyAId);
  });

  it("POST /api/irrigation-controllers/:id/programs creates a second program", async () => {
    const ctrlId = createdControllerIds[0];
    const r = await hit(srv.base, "POST", `/api/irrigation-controllers/${ctrlId}/programs`, {
      name: "B",
      wateringDays: ["Tue", "Thu"],
      startTimes: ["07:00", "19:00"],
      seasonalAdjustPct: 75,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, "B");
  });

  it("POST /api/irrigation-controllers/:id/zones creates zones", async () => {
    const ctrlId = createdControllerIds[0];
    for (let i = 1; i <= 4; i++) {
      const r = await hit(srv.base, "POST", `/api/irrigation-controllers/${ctrlId}/zones`, {
        zoneNumber: i,
        name: `Zone ${i}`,
        zoneType: "rotor",
        runTimeMinutes: 10,
        zoneOrder: i,
      });
      assert.equal(r.status, 201, `Zone ${i} create: ${JSON.stringify(r.body)}`);
    }
  });

  it("GET /api/irrigation-controllers/:id returns full graph with programs and zones", async () => {
    const ctrlId = createdControllerIds[0];
    const r = await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.id, ctrlId);
    assert.ok(Array.isArray(r.body.programs), "programs should be array");
    assert.equal(r.body.programs.length, 2, "should have 2 programs");
    assert.ok(Array.isArray(r.body.zones), "zones should be array");
    assert.equal(r.body.zones.length, 4, "should have 4 zones");
  });

  it("PUT /api/irrigation-controllers/:id updates controller and stamps lastUpdatedBy*", async () => {
    const ctrlId = createdControllerIds[0];
    const r = await hit(srv.base, "PUT", `/api/irrigation-controllers/${ctrlId}`, {
      notes: "Updated notes",
      model: "Pro-HC",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.notes, "Updated notes");
    assert.equal(r.body.model, "Pro-HC");
    // lastUpdatedAt should be set (the manager userId may not map to a real user in tests)
    assert.ok(r.body.lastUpdatedAt !== null, "lastUpdatedAt should be stamped");
  });

  it("GET /api/irrigation-controllers/:id/history returns 2+ snapshot rows after 2 mutations", async () => {
    const ctrlId = createdControllerIds[0];
    const r = await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}/history`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body));
    // Each mutating op (create programs, zones, PUT) appends a snapshot.
    // We did 2 programs + 4 zones + 1 PUT = 7 mutations. At least 2 should exist.
    assert.ok(r.body.length >= 2, `Expected >= 2 history rows, got ${r.body.length}`);
    // Newest row is first (ordered desc).
    assert.ok(r.body[0].changedAt !== undefined, "changedAt should be present");
    assert.ok(r.body[0].snapshotJson !== undefined, "snapshotJson should be present");
  });

  it("POST /api/irrigation-controllers/:id/photo attaches settingsPhotoUrl", async () => {
    const ctrlId = createdControllerIds[0];
    const url = `photos/test-${Date.now()}.jpg`;
    const r = await hit(srv.base, "POST", `/api/irrigation-controllers/${ctrlId}/photo`, { url });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.settingsPhotoUrl, url);
  });

  it("GET controller returns settingsPhotoUrl after photo attach", async () => {
    const ctrlId = createdControllerIds[0];
    const r = await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.settingsPhotoUrl === "string" && r.body.settingsPhotoUrl.length > 0);
  });
});

describe("Irrigation Profile routes — Tenant isolation", () => {
  let srvA: ReturnType<typeof makeTestServer>;
  let srvB: ReturnType<typeof makeTestServer>;
  let srvSuperAdmin: ReturnType<typeof makeTestServer>;
  let ctrlAId: number;
  let ctrlBId: number;
  let progBId: number;
  let zoneBId: number;

  before(async () => {
    if (!companyAId) await setupCompanies();

    srvA = makeTestServer({ role: "irrigation_manager", companyId: companyAId, userId: managerAUserId });
    srvB = makeTestServer({ role: "irrigation_manager", companyId: companyBId, userId: managerBUserId });
    srvSuperAdmin = makeTestServer({ role: "super_admin", companyId: null, userId: managerAUserId });

    // Create controller A under company A.
    const rA = await hit(srvA.base, "POST", `/api/customers/${customerAId}/controllers-profile`, {
      name: "Controller A",
    });
    assert.equal(rA.status, 201, JSON.stringify(rA.body));
    ctrlAId = rA.body.id;
    createdControllerIds.push(ctrlAId);

    // Create controller B under company B.
    const rB = await hit(srvB.base, "POST", `/api/customers/${customerBId}/controllers-profile`, {
      name: "Controller A", // Same name — should not collide (different company).
    });
    assert.equal(rB.status, 201, JSON.stringify(rB.body));
    ctrlBId = rB.body.id;
    createdControllerIds.push(ctrlBId);

    // Create a program and zone under company B's controller.
    const rProg = await hit(srvB.base, "POST", `/api/irrigation-controllers/${ctrlBId}/programs`, {
      name: "A",
      wateringDays: ["Mon"],
      startTimes: ["06:00"],
      seasonalAdjustPct: 100,
    });
    assert.equal(rProg.status, 201, JSON.stringify(rProg.body));
    progBId = rProg.body.id;

    const rZone = await hit(srvB.base, "POST", `/api/irrigation-controllers/${ctrlBId}/zones`, {
      zoneNumber: 1,
      name: "Zone 1",
      runTimeMinutes: 10,
    });
    assert.equal(rZone.status, 201, JSON.stringify(rZone.body));
    zoneBId = rZone.body.id;
  });

  after(async () => {
    await cleanupControllers();
    await Promise.all([srvA.close(), srvB.close(), srvSuperAdmin.close()]);
  });

  it("GET controller B by id from company A returns 404", async () => {
    const r = await hit(srvA.base, "GET", `/api/irrigation-controllers/${ctrlBId}`);
    assert.equal(r.status, 404);
  });

  it("PUT controller B by id from company A returns 404", async () => {
    const r = await hit(srvA.base, "PUT", `/api/irrigation-controllers/${ctrlBId}`, { notes: "hacked" });
    assert.equal(r.status, 404);
  });

  it("DELETE controller B by id from company A returns 404", async () => {
    const r = await hit(srvA.base, "DELETE", `/api/irrigation-controllers/${ctrlBId}`);
    assert.equal(r.status, 404);
  });

  it("PUT program B by id from company A returns 404", async () => {
    const r = await hit(srvA.base, "PUT", `/api/irrigation-programs/${progBId}`, { name: "hacked" });
    assert.equal(r.status, 404);
  });

  it("DELETE program B by id from company A returns 404", async () => {
    // We don't want to actually delete it — PUT above confirmed it's gated.
    // Use a non-existent id that won't match company A anyway.
    const r = await hit(srvA.base, "DELETE", `/api/irrigation-programs/${progBId}`);
    assert.equal(r.status, 404);
  });

  it("PUT zone B by id from company A returns 404", async () => {
    const r = await hit(srvA.base, "PUT", `/api/irrigation-zones/${zoneBId}`, { name: "hacked" });
    assert.equal(r.status, 404);
  });

  it("DELETE zone B by id from company A returns 404", async () => {
    const r = await hit(srvA.base, "DELETE", `/api/irrigation-zones/${zoneBId}`);
    assert.equal(r.status, 404);
  });

  it("GET /api/customers/B/controllers-profile from company A returns 404", async () => {
    const r = await hit(srvA.base, "GET", `/api/customers/${customerBId}/controllers-profile`);
    assert.equal(r.status, 404);
  });

  it("GET controller B history from company A returns 404", async () => {
    const r = await hit(srvA.base, "GET", `/api/irrigation-controllers/${ctrlBId}/history`);
    assert.equal(r.status, 404);
  });

  it("super_admin GET controller B returns 200", async () => {
    const r = await hit(srvSuperAdmin.base, "GET", `/api/irrigation-controllers/${ctrlBId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("super_admin GET controller A returns 200", async () => {
    const r = await hit(srvSuperAdmin.base, "GET", `/api/irrigation-controllers/${ctrlAId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("Two companies can each have 'Controller A' / 'Zone 1' without collision", async () => {
    // Company A creates a differently-named controller (company A already has
    // "Controller A" from the before() hook; creating another would violate the
    // per-company+customer+branch uniqueness constraint). The point of this test
    // is that company B's "Controller A" and company A's controllers share no
    // uniqueness scope — they are invisible to each other.
    const rCtrlA = await hit(srvA.base, "POST", `/api/customers/${customerAId}/controllers-profile`, {
      name: "Controller X",
    });
    assert.equal(rCtrlA.status, 201, JSON.stringify(rCtrlA.body));
    const ctrlA2Id = rCtrlA.body.id;
    createdControllerIds.push(ctrlA2Id);

    const rZoneA = await hit(srvA.base, "POST", `/api/irrigation-controllers/${ctrlA2Id}/zones`, {
      zoneNumber: 1,
      name: "Zone 1",
      runTimeMinutes: 5,
    });
    assert.equal(rZoneA.status, 201, JSON.stringify(rZoneA.body));

    // Company B already has "Controller A" with "Zone 1" — should still exist.
    const rGetB = await hit(srvB.base, "GET", `/api/irrigation-controllers/${ctrlBId}`);
    assert.equal(rGetB.status, 200);
    assert.equal(rGetB.body.name, "Controller A");
  });
});

describe("Irrigation Profile routes — Customer ownership guard", () => {
  let srvA: ReturnType<typeof makeTestServer>;

  before(async () => {
    if (!companyAId) await setupCompanies();
    srvA = makeTestServer({ role: "irrigation_manager", companyId: companyAId, userId: managerAUserId });
  });

  after(async () => {
    await cleanupControllers();
    await srvA.close();
  });

  it("POST controller under company B's customer from company A returns 404", async () => {
    const r = await hit(srvA.base, "POST", `/api/customers/${customerBId}/controllers-profile`, {
      name: "Should Fail",
    });
    assert.equal(r.status, 404);
  });
});

// ── Photo authorization — assertCanViewPhoto irrigation branch ────────────────
//
// assertCanViewPhoto in routes.ts checks irrigation_controllers.settings_photo_url
// against the caller's companyId (branch 6). These tests replicate that SQL
// branch inline — the same pattern as photo-serve.test.ts "behavioral SQL
// integration" tests — to confirm cross-tenant isolation and super_admin bypass
// without spinning up the full registerRoutes server.
describe("assertCanViewPhoto — irrigation_controllers.settingsPhotoUrl", () => {
  // Photo URL stored on company A's controller.
  const PHOTO_A = `photos/irrig-auth-test-a-${Date.now()}.jpg`;
  // Photo URL stored on company B's controller.
  const PHOTO_B = `photos/irrig-auth-test-b-${Date.now()}.jpg`;

  let ctrlAId: number;
  let ctrlBId: number;

  // Replicate the assertCanViewPhoto irrigation branch SQL: returns true when
  // the photo URL belongs to a controller owned by `companyId`.
  async function canViewPhoto(companyId: number, photoUrl: string): Promise<boolean> {
    const stripped = photoUrl.replace(/^\/+/, "").replace(/__(thumb|medium)\.jpg$/i, "");
    const deDoubled = stripped.replace(/^photos\/photos\//, "photos/");
    const candidates = Array.from(new Set([photoUrl, stripped, deDoubled]));
    const rows = await db
      .select({ id: irrigationControllers.id })
      .from(irrigationControllers)
      .where(and(
        eq(irrigationControllers.companyId, companyId),
        sql`${irrigationControllers.settingsPhotoUrl} = ANY(${sql.param(candidates)}::text[])`,
      ))
      .limit(1);
    return rows.length > 0;
  }

  before(async () => {
    if (!companyAId) await setupCompanies();

    // Create controller A with photo URL.
    const ctrlA = await storage.createIrrigationController({
      companyId: companyAId,
      customerId: customerAId,
      branchName: "",
      name: `PhotoAuthCtrlA_${Date.now()}`,
      settingsPhotoUrl: PHOTO_A,
    } as any);
    ctrlAId = ctrlA.id;
    createdControllerIds.push(ctrlAId);

    // Create controller B with photo URL.
    const ctrlB = await storage.createIrrigationController({
      companyId: companyBId,
      customerId: customerBId,
      branchName: "",
      name: `PhotoAuthCtrlB_${Date.now()}`,
      settingsPhotoUrl: PHOTO_B,
    } as any);
    ctrlBId = ctrlB.id;
    createdControllerIds.push(ctrlBId);
  });

  after(async () => {
    await cleanupControllers();
  });

  it("company A can view their own controller photo", async () => {
    const allowed = await canViewPhoto(companyAId, PHOTO_A);
    assert.ok(allowed, "company A should be able to view their own controller photo");
  });

  it("company A cannot view company B's controller photo", async () => {
    const allowed = await canViewPhoto(companyAId, PHOTO_B);
    assert.ok(!allowed, "company A should NOT be able to view company B's photo");
  });

  it("company B can view their own controller photo", async () => {
    const allowed = await canViewPhoto(companyBId, PHOTO_B);
    assert.ok(allowed, "company B should be able to view their own controller photo");
  });

  it("company B cannot view company A's controller photo", async () => {
    const allowed = await canViewPhoto(companyBId, PHOTO_A);
    assert.ok(!allowed, "company B should NOT be able to view company A's photo");
  });

  it("variant-stripped URL matches same photo (thumb suffix normalization)", async () => {
    const thumbUrl = `${PHOTO_A}__thumb.jpg`;
    const allowed = await canViewPhoto(companyAId, thumbUrl);
    assert.ok(allowed, "thumb-suffix URL should normalize to the stored key and match");
  });

  it("SQL does not throw — no 500 error (sql.param + ::text[] cast)", async () => {
    // If the sql.param pattern is broken, the DB throws a type-inference error.
    // Reaching here without an exception proves the cast is correct.
    let threw = false;
    try {
      await canViewPhoto(companyAId, PHOTO_A);
    } catch {
      threw = true;
    }
    assert.ok(!threw, "canViewPhoto should not throw a DB error");
  });
});

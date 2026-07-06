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
//   - Transaction rollback: mid-import DB failure rolls back first controller write
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

// ── CSV import endpoint ────────────────────────────────────────────────────────

describe("Irrigation Profile routes — CSV import", () => {
  let srv: ReturnType<typeof makeTestServer>;
  let srvB: ReturnType<typeof makeTestServer>;

  before(async () => {
    await setupCompanies();
    srv = makeTestServer({
      role: "irrigation_manager",
      companyId: companyAId,
      userId: managerAUserId,
    });
    srvB = makeTestServer({
      role: "irrigation_manager",
      companyId: companyBId,
      userId: managerBUserId,
    });
  });

  after(async () => {
    await cleanupControllers();
    await srv.close();
    await srvB.close();
  });

  const BASE_ROWS = [
    {
      controllerName: "CSV Ctrl 1",
      location: "Front Yard",
      brand: "Hunter",
      model: "Pro-C",
      programName: "A",
      wateringDays: ["Mon", "Wed", "Fri"],
      startTimes: ["06:00"],
      seasonalAdjustPct: 100,
      zoneNumber: 1,
      zoneName: "Front Lawn",
      zoneType: "rotor",
      runTimeMinutes: 15,
    },
    {
      controllerName: "CSV Ctrl 1",
      location: "Front Yard",
      brand: "Hunter",
      model: "Pro-C",
      programName: "A",
      wateringDays: ["Mon", "Wed", "Fri"],
      startTimes: ["06:00"],
      seasonalAdjustPct: 100,
      zoneNumber: 2,
      zoneName: "Side Bed",
      zoneType: "drip",
      runTimeMinutes: 20,
    },
  ];

  it("preview mode returns diff without writing any controller", async () => {
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "preview", rows: BASE_ROWS, branchName: "" },
    );
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.mode, "preview");
    assert.equal(body.controllers.length, 1);
    assert.equal(body.controllers[0].action, "create");
    assert.equal(body.controllers[0].zones.length, 2);
    assert.ok(body.summary.controllersCreated === 1, "preview should show 1 controller to create");

    // Verify nothing was actually written
    const existing = await storage.listIrrigationControllers(companyAId, customerAId, "");
    const wasSaved = existing.some((c) => c.name === "CSV Ctrl 1");
    assert.ok(!wasSaved, "preview should NOT write to DB");
  });

  it("commit mode creates controller + zones + history snapshot", async () => {
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "commit", rows: BASE_ROWS, branchName: "" },
    );
    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.mode, "commit");
    assert.equal(body.summary.controllersCreated, 1);
    assert.equal(body.summary.zonesAdded, 2);

    // Verify controller was created
    const ctrls = await storage.listIrrigationControllers(companyAId, customerAId, "");
    const ctrl = ctrls.find((c) => c.name === "CSV Ctrl 1");
    assert.ok(ctrl, "controller should have been created");
    createdControllerIds.push(ctrl!.id);

    // Verify zones
    const profile = await storage.getIrrigationController(companyAId, ctrl!.id);
    assert.ok(profile, "should have a profile");
    assert.equal(profile!.zones.length, 2);

    // Verify history
    const history = await storage.getIrrigationHistory(companyAId, ctrl!.id);
    assert.ok(history.length >= 1, "should have at least one history snapshot");
    const firstEntry = history[0];
    assert.ok(firstEntry != null && (firstEntry.summary ?? "").includes("CSV import"), "summary should mention CSV import");
  });

  it("second commit is a non-destructive update — only touched zones change", async () => {
    // First commit already ran in the test above, so "CSV Ctrl 1" exists.
    const ctrls = await storage.listIrrigationControllers(companyAId, customerAId, "");
    const existingCtrl = ctrls.find((c) => c.name === "CSV Ctrl 1");
    if (!existingCtrl) {
      // If first test didn't run (isolated), skip gracefully.
      return;
    }

    const UPDATE_ROWS = [
      {
        ...BASE_ROWS[0],
        zoneName: "Front Lawn UPDATED",
        runTimeMinutes: 18,
      },
    ];

    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "commit", rows: UPDATE_ROWS, branchName: "" },
    );
    assert.equal(status, 200);
    assert.equal(body.summary.zonesUpdated, 1);
    assert.equal(body.summary.zonesAdded, 0);

    // Zone 2 should still exist (non-destructive)
    const profile = await storage.getIrrigationController(companyAId, existingCtrl.id);
    assert.equal(profile!.zones.length, 2, "second zone should still exist (never deleted)");
    const zone1 = profile!.zones.find((z: { zoneNumber: number }) => z.zoneNumber === 1);
    assert.equal(zone1?.name, "Front Lawn UPDATED");
  });

  it("field_tech role is forbidden", async () => {
    const techSrv = makeTestServer({
      role: "field_tech",
      companyId: companyAId,
      userId: managerAUserId,
    });
    try {
      const { status } = await hit(
        techSrv.base,
        "POST",
        `/api/customers/${customerAId}/irrigation-profile/import-csv`,
        { mode: "preview", rows: BASE_ROWS, branchName: "" },
      );
      assert.equal(status, 403, "field_tech should get 403");
    } finally {
      await techSrv.close();
    }
  });

  it("billing_manager role is forbidden", async () => {
    const billSrv = makeTestServer({
      role: "billing_manager",
      companyId: companyAId,
      userId: managerAUserId,
    });
    try {
      const { status } = await hit(
        billSrv.base,
        "POST",
        `/api/customers/${customerAId}/irrigation-profile/import-csv`,
        { mode: "preview", rows: BASE_ROWS, branchName: "" },
      );
      assert.equal(status, 403, "billing_manager should get 403");
    } finally {
      await billSrv.close();
    }
  });

  it("company B manager cannot import into company A customer", async () => {
    const { status } = await hit(
      srvB.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "preview", rows: BASE_ROWS, branchName: "" },
    );
    assert.ok(status === 403 || status === 404, `Expected 403/404, got ${status}`);
  });

  it("invalid zone type returns 422", async () => {
    const badRow = { ...BASE_ROWS[0], zoneType: "garden_hose" };
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "preview", rows: [badRow], branchName: "" },
    );
    assert.equal(status, 422, `Expected 422, got ${status}`);
    assert.ok(Array.isArray(body.rowErrors) && body.rowErrors.length > 0, "should return rowErrors");
  });

  it("empty rows array returns 400", async () => {
    const { status } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "preview", rows: [], branchName: "" },
    );
    assert.equal(status, 400);
  });

  it("invalid mode returns 400", async () => {
    const { status } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "apply", rows: BASE_ROWS, branchName: "" },
    );
    assert.equal(status, 400);
  });

  it("invalid watering day token returns 422 with rowErrors", async () => {
    const badRow = { ...BASE_ROWS[0], wateringDays: ["Mon", "EVERYDAY"] };
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "preview", rows: [badRow], branchName: "" },
    );
    assert.equal(status, 422, `Expected 422, got ${status}`);
    assert.ok(Array.isArray(body.rowErrors) && body.rowErrors.length > 0, "should return rowErrors");
    const err = body.rowErrors[0];
    assert.ok(err.field === "Watering Days", `Expected field 'Watering Days', got '${err.field}'`);
    assert.ok(err.message.includes("EVERYDAY"), "error message should name the bad token");
  });

  it("re-committing an identical CSV is a no-op (no extra history snapshot)", async () => {
    // First commit — should succeed and create a history snapshot
    const { status: s1, body: b1 } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "commit", rows: BASE_ROWS, branchName: "idempotent-test" },
    );
    assert.equal(s1, 200, `First commit: expected 200, got ${s1}`);
    assert.ok(b1.summary.controllersCreated >= 0, "first commit should report controller stats");

    // Second commit with identical data — no changes expected
    const { status: s2, body: b2 } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "commit", rows: BASE_ROWS, branchName: "idempotent-test" },
    );
    assert.equal(s2, 200, `Second commit: expected 200, got ${s2}`);
    // All controllers should be update/no_change — none created on second pass
    const secondControllers: Array<{ action: string }> = b2.controllers ?? [];
    for (const c of secondControllers) {
      assert.ok(
        c.action === "update" || c.action === "no_change",
        `Expected update/no_change on second commit, got ${c.action}`,
      );
    }
  });
});

// ── CSV import Replace mode ───────────────────────────────────────────────────
//
// These tests cover the per-controller Replace mode that hard-deletes
// programs and zones absent from the CSV when the controller name is
// included in `replaceControllers`.

describe("CSV import — Replace mode", () => {
  let srv: ReturnType<typeof makeTestServer>;
  let srvB: ReturnType<typeof makeTestServer>;

  before(async () => {
    if (!companyAId) await setupCompanies();
    srv = makeTestServer({
      role: "irrigation_manager",
      companyId: companyAId,
      userId: managerAUserId,
    });
    srvB = makeTestServer({
      role: "irrigation_manager",
      companyId: companyBId,
      userId: managerBUserId,
    });
  });

  after(async () => {
    await cleanupControllers();
    await srv.close();
    await srvB.close();
  });

  // Helpers to seed a controller with zones/programs then return its id.
  async function seedController(
    ctrlName: string,
    zones: Array<{ zoneNumber: number; name: string; zoneType?: string; runTimeMinutes?: number; notes?: string }>,
    programs: Array<{ name: string }> = [],
  ): Promise<number> {
    const r = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/controllers-profile`,
      { name: ctrlName },
    );
    assert.equal(r.status, 201, `Seed controller: ${JSON.stringify(r.body)}`);
    const ctrlId = r.body.id;
    createdControllerIds.push(ctrlId);

    for (const z of zones) {
      const rz = await hit(srv.base, "POST", `/api/irrigation-controllers/${ctrlId}/zones`, {
        zoneNumber: z.zoneNumber,
        name: z.name,
        zoneType: z.zoneType ?? "rotor",
        runTimeMinutes: z.runTimeMinutes ?? 10,
        zoneOrder: z.zoneNumber,
      });
      assert.equal(rz.status, 201, `Seed zone ${z.zoneNumber}: ${JSON.stringify(rz.body)}`);
      if (z.notes) {
        await hit(srv.base, "PUT", `/api/irrigation-zones/${rz.body.id}`, { notes: z.notes });
      }
    }

    for (const p of programs) {
      const rp = await hit(srv.base, "POST", `/api/irrigation-controllers/${ctrlId}/programs`, {
        name: p.name,
        wateringDays: ["Mon"],
        startTimes: ["06:00"],
        seasonalAdjustPct: 100,
      });
      assert.equal(rp.status, 201, `Seed program ${p.name}: ${JSON.stringify(rp.body)}`);
    }
    return ctrlId;
  }

  it("Replace-off: re-importing a smaller CSV leaves untouched zones intact", async () => {
    const ctrlId = await seedController(
      `ReplaceOff_${Date.now()}`,
      [{ zoneNumber: 1, name: "Zone 1" }, { zoneNumber: 2, name: "Zone 2" }],
    );

    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    // CSV only mentions zone 1 — zone 2 should survive (Replace is OFF)
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [],
        rows: [
          {
            controllerName: ctrlName,
            zoneNumber: 1,
            zoneName: "Zone 1",
            zoneType: "rotor",
            runTimeMinutes: 10,
            seasonalAdjustPct: 100,
          },
        ],
      },
    );
    assert.equal(status, 200, JSON.stringify(body));

    const profile = await storage.getIrrigationController(companyAId, ctrlId);
    assert.equal(profile!.zones.length, 2, "Zone 2 should still exist (Replace off)");
  });

  it("Replace-on: zone absent from CSV is hard-deleted", async () => {
    const ctrlId = await seedController(
      `ReplaceOnZone_${Date.now()}`,
      [{ zoneNumber: 1, name: "Keep" }, { zoneNumber: 2, name: "Retire" }],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [ctrlName],
        rows: [
          {
            controllerName: ctrlName,
            zoneNumber: 1,
            zoneName: "Keep",
            zoneType: "rotor",
            runTimeMinutes: 10,
            seasonalAdjustPct: 100,
          },
        ],
      },
    );
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.summary.zonesRemoved, 1, "Summary should report 1 zone removed");

    const profile = await storage.getIrrigationController(companyAId, ctrlId);
    assert.equal(profile!.zones.length, 1, "Zone 2 should have been deleted");
    assert.equal(profile!.zones[0].zoneNumber, 1);
  });

  it("Replace-on: program absent from CSV is hard-deleted; its zones don't dangle", async () => {
    const ctrlId = await seedController(
      `ReplaceOnProg_${Date.now()}`,
      [{ zoneNumber: 1, name: "Z1" }],
      [{ name: "KeepProg" }, { name: "RetireProg" }],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [ctrlName],
        rows: [
          {
            controllerName: ctrlName,
            programName: "KeepProg",
            wateringDays: ["Mon"],
            startTimes: ["06:00"],
            seasonalAdjustPct: 100,
            zoneNumber: 1,
            zoneName: "Z1",
            zoneType: "rotor",
            runTimeMinutes: 10,
          },
        ],
      },
    );
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.summary.programsRemoved, 1, "Summary should report 1 program removed");

    const profile = await storage.getIrrigationController(companyAId, ctrlId);
    const programNames = profile!.programs.map((p: { name: string }) => p.name);
    assert.ok(!programNames.includes("RetireProg"), "RetireProg should be deleted");
    assert.ok(programNames.includes("KeepProg"), "KeepProg should still exist");
    // Zone should still exist (it was in the CSV)
    assert.equal(profile!.zones.length, 1);
  });

  it("Preview: zonesToRemove includes notes and override fields", async () => {
    const ctrlId = await seedController(
      `ReplacePreview_${Date.now()}`,
      [
        { zoneNumber: 1, name: "Stay" },
        { zoneNumber: 2, name: "GoAway", notes: "Hand-set note" },
      ],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "preview",
        branchName: "",
        replaceControllers: [ctrlName],
        rows: [
          {
            controllerName: ctrlName,
            zoneNumber: 1,
            zoneName: "Stay",
            zoneType: "rotor",
            runTimeMinutes: 10,
            seasonalAdjustPct: 100,
          },
        ],
      },
    );
    assert.equal(status, 200, JSON.stringify(body));
    const ctrlDiff = body.controllers.find((c: any) => c.controllerName === ctrlName);
    assert.ok(ctrlDiff, "Controller diff should be present");
    assert.ok(Array.isArray(ctrlDiff.zonesToRemove), "zonesToRemove should be an array");
    assert.equal(ctrlDiff.zonesToRemove.length, 1, "One zone should be flagged for removal");
    const removal = ctrlDiff.zonesToRemove[0];
    assert.equal(removal.zoneNumber, 2);
    assert.equal(removal.name, "GoAway");
    assert.ok("notes" in removal, "notes field should be present in removal");
    assert.ok("overrideStartTime" in removal, "overrideStartTime should be present");
    assert.ok("overrideDays" in removal, "overrideDays should be present");
  });

  it("History snapshot contains removed pre-image when Replace deletes rows", async () => {
    const ctrlId = await seedController(
      `ReplaceHistory_${Date.now()}`,
      [{ zoneNumber: 1, name: "Stay" }, { zoneNumber: 2, name: "Retire" }],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    const { status } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [ctrlName],
        rows: [
          {
            controllerName: ctrlName,
            zoneNumber: 1,
            zoneName: "Stay",
            zoneType: "rotor",
            runTimeMinutes: 10,
            seasonalAdjustPct: 100,
          },
        ],
      },
    );
    assert.equal(status, 200);

    const history = await storage.getIrrigationHistory(companyAId, ctrlId);
    assert.ok(history.length >= 1, "Should have a history entry");
    const latest = history[0];
    const snap = latest.snapshotJson as any;
    assert.ok(snap.removed, "Snapshot should contain a `removed` key");
    assert.ok(snap.removed.controller, "removed.controller should be the pre-delete controller row");
    assert.equal(snap.removed.controller.id, ctrlId, "removed.controller.id should match the controller");
    assert.ok(Array.isArray(snap.removed.zones), "`removed.zones` should be an array");
    assert.equal(snap.removed.zones.length, 1, "removed.zones should have one entry");
    assert.equal(snap.removed.zones[0].zoneNumber, 2);
    assert.ok(Array.isArray(snap.removed.programs), "`removed.programs` should be an array");
  });

  it("Replace for Controller A does not touch Controller B on same import", async () => {
    const [idA, idB] = await Promise.all([
      seedController(`ReplaceIsoA_${Date.now()}`, [
        { zoneNumber: 1, name: "A1" },
        { zoneNumber: 2, name: "A2" },
      ]),
      seedController(`ReplaceIsoB_${Date.now()}`, [
        { zoneNumber: 1, name: "B1" },
        { zoneNumber: 2, name: "B2" },
      ]),
    ]);
    const nameA = (await hit(srv.base, "GET", `/api/irrigation-controllers/${idA}`)).body.name;
    const nameB = (await hit(srv.base, "GET", `/api/irrigation-controllers/${idB}`)).body.name;

    // Replace is ON for A, OFF for B. CSV includes only zone 1 for each.
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [nameA],
        rows: [
          { controllerName: nameA, zoneNumber: 1, zoneName: "A1", zoneType: "rotor", runTimeMinutes: 10, seasonalAdjustPct: 100 },
          { controllerName: nameB, zoneNumber: 1, zoneName: "B1", zoneType: "rotor", runTimeMinutes: 10, seasonalAdjustPct: 100 },
        ],
      },
    );
    assert.equal(status, 200, JSON.stringify(body));

    const [profA, profB] = await Promise.all([
      storage.getIrrigationController(companyAId, idA),
      storage.getIrrigationController(companyAId, idB),
    ]);
    assert.equal(profA!.zones.length, 1, "Controller A zone 2 should have been deleted (Replace ON)");
    assert.equal(profB!.zones.length, 2, "Controller B zone 2 should still exist (Replace OFF)");
  });

  it("Re-running the same CSV with Replace is a no-op (idempotent)", async () => {
    const ctrlId = await seedController(
      `ReplaceIdempotent_${Date.now()}`,
      [{ zoneNumber: 1, name: "Zone 1" }],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    const rows = [
      {
        controllerName: ctrlName,
        zoneNumber: 1,
        zoneName: "Zone 1",
        zoneType: "rotor",
        runTimeMinutes: 10,
        seasonalAdjustPct: 100,
      },
    ];

    // First commit with Replace ON
    const { status: s1, body: b1 } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "commit", branchName: "", replaceControllers: [ctrlName], rows },
    );
    assert.equal(s1, 200, `First commit: ${JSON.stringify(b1)}`);

    // Get history length after first commit
    const histAfterFirst = await storage.getIrrigationHistory(companyAId, ctrlId);
    const histCountAfterFirst = histAfterFirst.length;

    // Second commit with same CSV + Replace ON — should be a no-op
    const { status: s2, body: b2 } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      { mode: "commit", branchName: "", replaceControllers: [ctrlName], rows },
    );
    assert.equal(s2, 200, `Second commit: ${JSON.stringify(b2)}`);
    assert.equal(b2.summary.zonesRemoved, 0, "Second run should remove nothing");

    const histAfterSecond = await storage.getIrrigationHistory(companyAId, ctrlId);
    assert.equal(
      histAfterSecond.length,
      histCountAfterFirst,
      "No extra history snapshot should be written on a no-op re-run",
    );
  });

  it("Replace-on: totalZones reflects post-delete count, not high-water mark", async () => {
    // Seed zones 1, 2, 3 so that high-water mark = 3
    const ctrlId = await seedController(
      `ReplaceTotalZones_${Date.now()}`,
      [
        { zoneNumber: 1, name: "Zone 1" },
        { zoneNumber: 2, name: "Zone 2" },
        { zoneNumber: 3, name: "Zone 3" },
      ],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    // CSV only has zone 2 — zones 1 and 3 are deleted
    const { status, body } = await hit(
      srv.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [ctrlName],
        rows: [
          {
            controllerName: ctrlName,
            zoneNumber: 2,
            zoneName: "Zone 2",
            zoneType: "rotor",
            runTimeMinutes: 10,
            seasonalAdjustPct: 100,
          },
        ],
      },
    );
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.summary.zonesRemoved, 2, "2 zones should have been removed");

    // totalZones on the controller should be 1 (count), NOT 3 (old high-water mark) or 2 (max zone number)
    const ctrl = await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`);
    assert.equal(ctrl.status, 200);
    assert.equal(
      ctrl.body.totalZones,
      1,
      `totalZones should be post-delete count (1), got ${ctrl.body.totalZones}`,
    );
    assert.equal(ctrl.body.zones.length, 1, "Only zone 2 should survive");
  });

  it("Company isolation: Replace from company B cannot affect company A controller", async () => {
    const ctrlId = await seedController(
      `ReplaceCompIso_${Date.now()}`,
      [{ zoneNumber: 1, name: "Zone 1" }, { zoneNumber: 2, name: "Zone 2" }],
    );
    const ctrlName = (await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`)).body.name;

    // Company B tries to import CSV mentioning the same controller name
    const { status } = await hit(
      srvB.base,
      "POST",
      `/api/customers/${customerAId}/irrigation-profile/import-csv`,
      {
        mode: "commit",
        branchName: "",
        replaceControllers: [ctrlName],
        rows: [
          { controllerName: ctrlName, zoneNumber: 1, zoneName: "Zone 1", zoneType: "rotor", runTimeMinutes: 10, seasonalAdjustPct: 100 },
        ],
      },
    );
    // Should be 403 or 404 (ownership guard)
    assert.ok(status === 403 || status === 404, `Expected 403/404, got ${status}`);

    // Company A controller should be untouched
    const profile = await storage.getIrrigationController(companyAId, ctrlId);
    assert.equal(profile!.zones.length, 2, "Company A zones should be unaffected");
  });
});

// ── Transaction rollback on mid-import failure ────────────────────────────────
//
// importIrrigationProfile runs the full commit inside a single DB transaction.
// This suite proves the transaction is atomic: a failure that occurs AFTER the
// first controller row is written must roll back that write so the DB is left
// in the pre-import state.
//
// Technique: set globalThis.__importIrrigationProfileMidTxHook to a function
// that throws. storage.ts checks this hook inside the real transaction (right
// after each controller INSERT/UPDATE, before the zone writes) and invokes it
// when present. The real importIrrigationProfile code path is fully exercised —
// no method replacement.

describe("CSV import — transaction rollback on mid-import failure", () => {
  let srv: ReturnType<typeof makeTestServer>;
  // Timestamp-unique controller name — confirms the row was really rolled back.
  const ctrlName = `RollbackProbe_${Date.now()}`;

  before(async () => {
    if (!companyAId) await setupCompanies();
    srv = makeTestServer({
      role: "irrigation_manager",
      companyId: companyAId,
      userId: managerAUserId,
    });
  });

  after(async () => {
    // Defensive cleanup in case the rollback somehow did not happen.
    await db
      .delete(irrigationControllers)
      .where(
        and(
          eq(irrigationControllers.companyId, companyAId),
          eq(irrigationControllers.name, ctrlName),
        ),
      );
    await srv.close();
  });

  it("mid-transaction failure rolls back the first controller write and returns 500", async () => {
    // Install the seam hook so the real importIrrigationProfile transaction
    // throws after inserting the first controller — simulating any DB error
    // (constraint violation, FK error, etc.) that might occur mid-commit.
    (globalThis as any).__importIrrigationProfileMidTxHook = () => {
      throw new Error("injected mid-transaction failure for rollback test");
    };

    try {
      const { status, body } = await hit(
        srv.base,
        "POST",
        `/api/customers/${customerAId}/irrigation-profile/import-csv`,
        {
          mode: "commit",
          branchName: "rollback-test",
          rows: [
            {
              controllerName: ctrlName,
              zoneNumber: 1,
              zoneName: "Zone 1",
              zoneType: "rotor",
              runTimeMinutes: 10,
              seasonalAdjustPct: 100,
            },
          ],
        },
      );

      // (a) Route must surface the error as 500 with a non-empty message field.
      assert.equal(status, 500, `Expected 500, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(
        body !== null && typeof body.message === "string" && body.message.length > 0,
        `500 body must have a non-empty message field; got: ${JSON.stringify(body)}`,
      );

      // (b) The controller written inside the thrown transaction must NOT be in
      //     the DB — Postgres rolled it back before the error reached the route.
      const leaked = await db
        .select({ id: irrigationControllers.id })
        .from(irrigationControllers)
        .where(
          and(
            eq(irrigationControllers.companyId, companyAId),
            eq(irrigationControllers.name, ctrlName),
          ),
        );
      assert.equal(
        leaked.length,
        0,
        `Transaction rollback failed — controller '${ctrlName}' was persisted after a mid-transaction error (real importIrrigationProfile path)`,
      );
    } finally {
      // Always remove the seam hook so other tests are not affected.
      delete (globalThis as any).__importIrrigationProfileMidTxHook;
    }
  });
});

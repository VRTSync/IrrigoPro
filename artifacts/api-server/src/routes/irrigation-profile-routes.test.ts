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

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "@workspace/db";
import { irrigationControllers, irrigationProfileZones, irrigationProfileHistory } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";

import { registerIrrigationProfileRoutes } from "./irrigation-profile-routes";
import { storage } from "../storage";
import { makePropertyControllerPatch } from "./property-controller-patch";
import { CLEAR_ZONE_COUNT_MESSAGE } from "../lib/controller-zone-records";

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
  app.patch("/api/properties/:customerId/controllers", auth, makePropertyControllerPatch({
    requireCompanyId: (req, res) => {
      if (req.authenticatedUserCompanyId != null) return req.authenticatedUserCompanyId;
      res.status(400).json({ message: "Company required" }); return null;
    },
    isFieldRole: role => ["field_tech", "irrigation_manager", "company_admin", "super_admin", "billing_manager"].includes(role ?? ""),
    classifyAndLog: (_req, _error, opts) => ({ status: 500, message: opts.fallbackMessage }),
  }));

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
    assert.equal(ctrl.zones.length, 12);
    assert.equal(ctrl.retiredZoneCount, 0);
    assert.deepEqual(ctrl.zones.map((z: any) => z.zoneNumber), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(ctrl.zones.every((z: any) => z.setUp === false), "fresh reconciled rows are placeholders");
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

  it("PUT zones edits the reconciled positions", async () => {
    const ctrlId = createdControllerIds[0];
    const ctrl = await storage.getIrrigationController(companyAId, ctrlId);
    for (let i = 1; i <= 4; i++) {
      const r = await hit(srv.base, "PUT", `/api/irrigation-zones/${ctrl!.zones.find(z => z.zoneNumber === i)!.id}`, {
        name: `Zone ${i}`,
        zoneType: "rotor",
        runTimeMinutes: 10,
        zoneOrder: i,
      });
      assert.equal(r.status, 200, `Zone ${i} edit: ${JSON.stringify(r.body)}`);
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
    assert.equal(r.body.zones.length, 12, "count creates all 12 zones");
    assert.deepEqual(r.body.retiredZones, []);
  });

  it("list classification reflects edits; retirement detail is ordered and attributed; restoration preserves identity", async () => {
    const id = createdControllerIds[0];
    const before = (await hit(srv.base, "GET", `/api/irrigation-controllers/${id}`)).body;
    const zone12 = before.zones.find((z: any) => z.zoneNumber === 12);
    await hit(srv.base, "PUT", `/api/irrigation-zones/${zone12.id}`, { name: "Back slope drip" });
    const renamed = (await hit(srv.base, "GET", `/api/customers/${customerAId}/controllers-profile`)).body.find((c: any) => c.id === id);
    assert.equal(renamed.zones.find((z: any) => z.id === zone12.id).setUp, true);
    assert.equal(renamed.zones.find((z: any) => z.zoneNumber === 11).setUp, false);
    assert.equal(renamed.zones.find((z: any) => z.zoneNumber === 1).setUp, true, "type/runtime classify independently of name");
    assert.equal((await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 10 })).status, 200);
    const retired = (await hit(srv.base, "GET", `/api/irrigation-controllers/${id}`)).body;
    assert.deepEqual(retired.retiredZones.map((z: any) => z.zoneNumber), [11, 12]);
    assert.equal(retired.retiredZones[1].id, zone12.id);
    assert.ok(retired.retiredZones.every((z: any) => z.retiredAt && z.retiredByName === "Manager A"));
    const listed = (await hit(srv.base, "GET", `/api/customers/${customerAId}/controllers-profile`)).body.find((c: any) => c.id === id);
    assert.equal(listed.zones.length, 10);
    assert.equal(listed.retiredZoneCount, 2);
    assert.equal(listed.zones.some((z: any) => z.id === zone12.id), false);
    await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 12 });
    const restored = (await hit(srv.base, "GET", `/api/irrigation-controllers/${id}`)).body;
    assert.equal(restored.zones.find((z: any) => z.zoneNumber === 12).id, zone12.id);
    assert.deepEqual(restored.retiredZones, []);
  });

  it("list batches current summaries and retired counts rather than querying each controller", async () => {
    const added = await hit(srv.base, "POST", `/api/customers/${customerAId}/controllers-profile`, { name: "Controller B", totalZones: 2 });
    assert.equal(added.status, 201);
    createdControllerIds.push(added.body.id);
    const original = db.select.bind(db);
    let zoneReads = 0;
    const spy = mock.method(db, "select", (...args: any[]) => {
      const builder = original(...args as Parameters<typeof db.select>);
      const from = builder.from.bind(builder);
      builder.from = ((table: any) => {
        if (table === irrigationProfileZones) zoneReads++;
        return from(table);
      }) as typeof builder.from;
      return builder;
    });
    try {
      const list = await hit(srv.base, "GET", `/api/customers/${customerAId}/controllers-profile`);
      assert.equal(list.status, 200);
      assert.equal(list.body.length, 2);
      assert.equal(zoneReads, 2, "one current-zone query and one retired-count query for the whole list");
      assert.equal(list.body.find((c: any) => c.id === added.body.id).zones.length, 2);
    } finally {
      spy.mock.restore();
    }
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

    const rZone = await hit(srvB.base, "PUT", `/api/irrigation-controllers/${ctrlBId}/zone-count`, { totalZones: 1 });
    assert.equal(rZone.status, 200, JSON.stringify(rZone.body));
    zoneBId = (await storage.getIrrigationController(companyBId, ctrlBId))!.zones[0].id;
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
    assert.equal(r.body.zones[0].companyId, companyBId);
    const list = await hit(srvSuperAdmin.base, "GET", `/api/customers/${customerBId}/controllers-profile`);
    assert.equal(list.status, 200);
    assert.equal(list.body.find((c: any) => c.id === ctrlBId).zones[0].id, zoneBId);
  });

  it("super_admin GET controller A returns 200", async () => {
    const r = await hit(srvSuperAdmin.base, "GET", `/api/irrigation-controllers/${ctrlAId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it("list and detail exclude mismatched-company zones even for super_admin", async () => {
    const [alien] = await db.insert(irrigationProfileZones).values({
      companyId: companyAId, controllerId: ctrlBId, zoneNumber: 99, name: "Foreign zone", zoneType: "rotor",
    }).returning();
    try {
      for (const base of [srvB.base, srvSuperAdmin.base]) {
        const detail = await hit(base, "GET", `/api/irrigation-controllers/${ctrlBId}`);
        assert.equal(detail.body.zones.some((z: any) => z.id === alien.id), false);
        const list = await hit(base, "GET", `/api/customers/${customerBId}/controllers-profile`);
        assert.equal(list.body.find((c: any) => c.id === ctrlBId).zones.some((z: any) => z.id === alien.id), false);
        await db.update(irrigationProfileZones).set({ retiredAt: new Date(), retiredByName: "Foreign actor" }).where(eq(irrigationProfileZones.id, alien.id));
        const retired = await hit(base, "GET", `/api/irrigation-controllers/${ctrlBId}`);
        assert.equal(retired.body.retiredZones.some((z: any) => z.id === alien.id), false);
        const retiredList = await hit(base, "GET", `/api/customers/${customerBId}/controllers-profile`);
        assert.equal(retiredList.body.find((c: any) => c.id === ctrlBId).retiredZoneCount, 0);
        await db.update(irrigationProfileZones).set({ retiredAt: null }).where(eq(irrigationProfileZones.id, alien.id));
      }
    } finally {
      await db.delete(irrigationProfileZones).where(eq(irrigationProfileZones.id, alien.id));
    }
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

    const rZoneA = await hit(srvA.base, "PUT", `/api/irrigation-controllers/${ctrlA2Id}/zone-count`, { totalZones: 1 });
    assert.equal(rZoneA.status, 200, JSON.stringify(rZoneA.body));

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

describe("Slice 1 — zone record foundation", () => {
  let srv: ReturnType<typeof makeTestServer>, foreign: ReturnType<typeof makeTestServer>,
    superAdmin: ReturnType<typeof makeTestServer>, tech: ReturnType<typeof makeTestServer>;
  let id: number;
  const allZones = (controllerId: number) => db.select().from(irrigationProfileZones)
    .where(eq(irrigationProfileZones.controllerId, controllerId)).orderBy(irrigationProfileZones.zoneNumber);
  const create = async (name: string, totalZones: number | null) => {
    const result = await hit(srv.base, "POST", `/api/customers/${customerAId}/controllers-profile`, { name, totalZones });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    createdControllerIds.push(result.body.id);
    return result.body.id as number;
  };
  before(async () => {
    await setupCompanies();
    srv = makeTestServer({ role: "irrigation_manager", companyId: companyAId, userId: managerAUserId });
    foreign = makeTestServer({ role: "irrigation_manager", companyId: companyBId, userId: managerBUserId });
    superAdmin = makeTestServer({ role: "super_admin", companyId: null, userId: managerAUserId });
    tech = makeTestServer({ role: "field_tech", companyId: companyAId, userId: managerAUserId });
  });
  after(async () => {
    await cleanupControllers();
    await Promise.all([srv.close(), foreign.close(), superAdmin.close(), tech.close()]);
  });
  it("1. create count 38 makes exactly 1–38 placeholders and a transactional snapshot", async () => {
    id = await create("Foundation", 38);
    const zones = await allZones(id);
    assert.equal(zones.length, 38);
    for (let n = 1; n <= 38; n++) {
      const z = zones[n - 1];
      assert.equal(z.zoneNumber, n); assert.equal(z.name, `Zone ${n}`);
      assert.equal(z.zoneType, "other"); assert.equal(z.runTimeMinutes, 0);
      assert.equal(z.zoneOrder, n); assert.equal(z.isActive, true); assert.equal(z.retiredAt, null);
    }
    assert.equal((await storage.getIrrigationHistory(companyAId, id)).length, 1);
  });
  it("2. null → 38 through the controller PUT fills all positions", async () => {
    const unknown = await create("Unknown count", null);
    assert.equal((await allZones(unknown)).length, 0);
    const result = await hit(srv.base, "PUT", `/api/irrigation-controllers/${unknown}`, { totalZones: 38 });
    assert.equal(result.status, 200);
    assert.equal((await allZones(unknown)).length, 38);
  });
  it("3. 38 → 30 retires 31–38 with attribution, data intact, current detail/snapshot only", async () => {
    const zone = (await allZones(id))[33];
    await storage.updateIrrigationZone(companyAId, zone.id, { notes: "Keep this", isActive: false, overrideStartTime: "06:00", overrideDays: ["Mon"] });
    const result = await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 30 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(Object.keys(result.body).sort(), ["controller", "created", "restored", "retired"]);
    assert.deepEqual(result.body.retired, [31, 32, 33, 34, 35, 36, 37, 38]);
    const retired = (await allZones(id))[33];
    assert.equal(retired.id, zone.id); assert.ok(retired.retiredAt);
    assert.equal(retired.notes, "Keep this"); assert.equal(retired.isActive, false);
    assert.equal(retired.retiredByUserId, managerAUserId); assert.equal(retired.retiredByName, "Manager A");
    const detail = await hit(srv.base, "GET", `/api/irrigation-controllers/${id}`);
    assert.equal(detail.body.zones.length, 30);
    const latest = (await storage.getIrrigationHistory(companyAId, id))[0];
    assert.equal((latest.snapshotJson as any).zones.length, 30);
    assert.match(latest.summary!, /retired zones 31-38 \(history kept\)/);
  });
  it("4. 30 → 36 restores old identities and fields without inserts", async () => {
    const before = await allZones(id);
    const result = await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 36 });
    assert.deepEqual(result.body.created, []);
    assert.deepEqual(result.body.restored, [31, 32, 33, 34, 35, 36]);
    const after = await allZones(id);
    assert.deepEqual(after.map(z => z.id), before.map(z => z.id));
    assert.equal(after[33].notes, "Keep this"); assert.equal(after[33].isActive, false);
    assert.equal(after[33].overrideStartTime, "06:00"); assert.deepEqual(after[33].overrideDays, ["Mon"]);
    assert.equal(after[33].retiredAt, null); assert.equal(after[33].retiredByUserId, null);
    assert.ok(after[36].retiredAt); assert.ok(after[37].retiredAt);
  });
  it("5. counted controllers cannot clear the count; exact 400 message", async () => {
    const result = await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}`, { totalZones: null });
    assert.equal(result.status, 400); assert.equal(result.body.message, CLEAR_ZONE_COUNT_MESSAGE);
    assert.equal((await storage.getIrrigationController(companyAId, id))!.totalZones, 36);
  });
  it("6. field-tech wet-check PATCH seeds null counts in both modes and writes one history entry", async () => {
    for (const mode of ["service", "inspection"]) {
      const controllerId = await create(`Wet ${mode}`, null);
      const ctrl = (await storage.getIrrigationController(companyAId, controllerId))!;
      const result = await hit(tech.base, "PATCH", `/api/properties/${customerAId}/controllers?mode=${mode}`, { controllerLetter: ctrl.letter, zoneCount: 12 });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.zoneCount, 12);
      assert.equal((await allZones(controllerId)).length, 12);
      const history = await storage.getIrrigationHistory(companyAId, controllerId);
      assert.equal(history.length, 1); assert.equal(history[0].changedByUserId, managerAUserId);
      const notes = await hit(tech.base, "PATCH", `/api/properties/${customerAId}/controllers`, { controllerLetter: ctrl.letter, notes: "Field notes" });
      assert.equal(notes.body.notes, "Field notes");
    }
  });
  it("7. zone numbers cannot be edited; retired edits return 404", async () => {
    const zones = await allZones(id);
    const result = await hit(srv.base, "PUT", `/api/irrigation-zones/${zones[0].id}`, { zoneNumber: 99 });
    assert.equal(result.status, 200); assert.equal(result.body.zoneNumber, 1);
    assert.equal((await hit(srv.base, "PUT", `/api/irrigation-zones/${zones[37].id}`, { notes: "No" })).status, 404);
  });
  it("8. removed creation/deletion routes return 404", async () => {
    assert.equal((await hit(srv.base, "POST", `/api/irrigation-controllers/${id}/zones`, { zoneNumber: 99, name: "No" })).status, 404);
    assert.equal((await hit(srv.base, "DELETE", `/api/irrigation-zones/${(await allZones(id))[0].id}`)).status, 404);
  });
  it("9. CSV Replace retires above max; sparse add fills gaps; sparse Replace resets omissions", async () => {
    const replaceId = await create("CSV foundation", 12);
    const before = await allZones(replaceId);
    await storage.updateIrrigationZone(companyAId, before[2].id, { notes: "Reset me", overrideDays: ["Tue"], isActive: false, runTimeMinutes: 17 });
    const row = (name: string, n: number) => ({ controllerName: name, zoneNumber: n, zoneName: `Imported ${n}`, zoneType: "rotor", runTimeMinutes: 9, seasonalAdjustPct: 100 });
    const endpoint = `/api/customers/${customerAId}/irrigation-profile/import-csv`;
    const result = await hit(srv.base, "POST", endpoint, { mode: "commit", rows: Array.from({ length: 10 }, (_, i) => row("CSV foundation", i + 1)), replaceControllers: ["CSV foundation"] });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const after = await allZones(replaceId);
    assert.equal(after.length, 12); assert.ok(after[10].retiredAt); assert.ok(after[11].retiredAt);
    assert.deepEqual(after.map(z => z.id), before.map(z => z.id));
    const sparse = await hit(srv.base, "POST", endpoint, { mode: "commit", rows: [1, 2, 5].map(n => row("Sparse foundation", n)) });
    assert.equal(sparse.status, 200, JSON.stringify(sparse.body));
    const sparseCtrl = (await storage.listIrrigationControllers(companyAId, customerAId)).find(c => c.name === "Sparse foundation")!;
    createdControllerIds.push(sparseCtrl.id);
    const sparseZones = await allZones(sparseCtrl.id);
    assert.equal(sparseCtrl.totalZones, 5); assert.equal(sparseZones.length, 5);
    assert.equal(sparseZones[2].name, "Zone 3"); assert.equal(sparseZones[3].runTimeMinutes, 0);
    const reset = await hit(srv.base, "POST", endpoint, { mode: "commit", rows: [1, 2, 10].map(n => row("CSV foundation", n)), replaceControllers: ["CSV foundation"] });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const resetZone = (await allZones(replaceId))[2];
    assert.equal(resetZone.id, before[2].id); assert.equal(resetZone.name, "Zone 3");
    assert.equal(resetZone.notes, null); assert.equal(resetZone.overrideDays, null);
    assert.equal(resetZone.isActive, true); assert.equal(resetZone.runTimeMinutes, 0);
    const nonshrink = await hit(srv.base, "POST", endpoint, { mode: "commit", rows: [row("CSV foundation", 1)] });
    assert.equal(nonshrink.status, 200); assert.equal((await storage.getIrrigationController(companyAId, replaceId))!.totalZones, 10);
  });
  it("10. foreign tenant is 404; super admin and current field-tech count access succeed", async () => {
    assert.equal((await hit(foreign.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 38 })).status, 404);
    assert.equal((await hit(superAdmin.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 38 })).status, 200);
    assert.equal((await hit(tech.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 37 })).status, 200);
    assert.equal((await hit(tech.base, "PUT", `/api/irrigation-controllers/${id}`, { totalZones: 36 })).status, 403);
  });
  it("bounds are integers 1–100 across create, update, and count routes", async () => {
    for (const bad of [0, -1, 101, 1.5, null, ""]) {
      assert.equal((await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: bad })).status, 400);
    }
    for (const bad of [0, 101, 1.5]) {
      assert.equal((await hit(srv.base, "POST", `/api/customers/${customerAId}/controllers-profile`, { name: "Invalid", totalZones: bad })).status, 400);
      assert.equal((await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}`, { totalZones: bad })).status, 400);
    }
    assert.equal((await hit(srv.base, "PUT", `/api/irrigation-controllers/${id}/zone-count`, { totalZones: 100 })).status, 200);
    assert.equal((await storage.getIrrigationController(companyAId, id))!.zones.length, 100);
  });
  it("concurrent count writes serialize, keep unique identity and coherent snapshot mirrors", async () => {
    const results = await Promise.all([30, 38, 36].map(target => storage.setControllerZoneCount(companyAId, id, target, { id: managerAUserId, name: "Manager A" })));
    assert.ok(results.every(Boolean));
    const detail = (await storage.getIrrigationController(companyAId, id))!;
    assert.deepEqual(detail.zones.map(z => z.zoneNumber), Array.from({ length: detail.totalZones! }, (_, i) => i + 1));
    for (const history of (await storage.getIrrigationHistory(companyAId, id)).slice(0, 3)) {
      const snapshot = history.snapshotJson as any;
      assert.equal(snapshot.zones.length, snapshot.controller.totalZones);
    }
    assert.equal(new Set((await allZones(id)).map(z => z.zoneNumber)).size, 100);
  });
  it("invalid user FK rolls back reconciliation rows, mirror, and history", async () => {
    const before = await allZones(id);
    const ctrlBefore = await storage.getIrrigationController(companyAId, id);
    const history = await storage.getIrrigationHistory(companyAId, id);
    await assert.rejects(storage.setControllerZoneCount(companyAId, id, 1, { id: -2147483648, name: "Invalid FK" }));
    assert.deepEqual(await allZones(id), before);
    assert.equal((await storage.getIrrigationController(companyAId, id))!.totalZones, ctrlBefore!.totalZones);
    assert.equal((await storage.getIrrigationHistory(companyAId, id)).length, history.length);
  });
  it("ensure seed uses reconciliation and rejects invalid targets atomically", async () => {
    const seeded = await storage.ensureIrrigationControllers(companyAId, customerAId, [{ name: "Seeded", zoneCount: 38 }], "seed-test");
    createdControllerIds.push(...seeded.map(c => c.id));
    assert.equal((await allZones(seeded[0].id)).length, 38);
    assert.equal((await storage.getIrrigationHistory(companyAId, seeded[0].id)).length, 1);
    await assert.rejects(storage.ensureIrrigationControllers(companyAId, customerAId, [{ name: "Invalid seed", zoneCount: 101 }], "invalid-seed"));
    assert.equal((await storage.listIrrigationControllers(companyAId, customerAId, "invalid-seed")).length, 0);
  });
  it("creation letter collisions retry the whole transaction without leaking zones or history", async () => {
    const ctrls = await Promise.all(["Retry A", "Retry B"].map(name => storage.createIrrigationController({
      companyId: companyAId, customerId: customerAId, branchName: "retry", name, letter: "A", totalZones: 38,
    })));
    createdControllerIds.push(...ctrls.map(ctrl => ctrl.id));
    assert.equal(new Set(ctrls.map(ctrl => ctrl.letter)).size, 2);
    for (const ctrl of ctrls) {
      assert.equal((await allZones(ctrl.id)).length, 38);
      assert.equal((await storage.getIrrigationHistory(companyAId, ctrl.id)).length, 1);
    }
  });
  it("history failure after rows and mirror change rolls back the whole count transaction", async () => {
    const before = await allZones(id);
    const ctrl = (await storage.getIrrigationController(companyAId, id))!;
    const history = await storage.getIrrigationHistory(companyAId, id);
    const original = (storage as any)._appendIrrigationSnapshot;
    (storage as any)._appendIrrigationSnapshot = async () => { throw new Error("Snapshot failure"); };
    try {
      await assert.rejects(storage.setControllerZoneCount(companyAId, id, 1), /Snapshot failure/);
    } finally { (storage as any)._appendIrrigationSnapshot = original; }
    assert.deepEqual(await allZones(id), before);
    assert.equal((await storage.getIrrigationController(companyAId, id))!.totalZones, ctrl.totalZones);
    assert.equal((await storage.getIrrigationHistory(companyAId, id)).length, history.length);
  });
});

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
      { name: ctrlName, totalZones: Math.max(...zones.map(z => z.zoneNumber)) },
    );
    assert.equal(r.status, 201, `Seed controller: ${JSON.stringify(r.body)}`);
    const ctrlId = r.body.id;
    createdControllerIds.push(ctrlId);

    for (const z of zones) {
      const profile = await storage.getIrrigationController(companyAId, ctrlId);
      const rz = await hit(srv.base, "PUT", `/api/irrigation-zones/${profile!.zones.find(row => row.zoneNumber === z.zoneNumber)!.id}`, {
        name: z.name,
        zoneType: z.zoneType ?? "rotor",
        runTimeMinutes: z.runTimeMinutes ?? 10,
        zoneOrder: z.zoneNumber,
      });
      assert.equal(rz.status, 200, `Seed zone ${z.zoneNumber}: ${JSON.stringify(rz.body)}`);
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

  it("Replace-on: zone above the highest CSV position is retired, not deleted", async () => {
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
    assert.equal(profile!.zones.length, 1, "Zone 2 should be absent from current detail");
    assert.equal(profile!.zones[0].zoneNumber, 1);
    const allRows = await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.controllerId, ctrlId));
    assert.equal(allRows.length, 2);
    assert.ok(allRows.find(z => z.zoneNumber === 2)!.retiredAt);
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
    const [controllerAfterFirst] = await db.select().from(irrigationControllers).where(eq(irrigationControllers.id, ctrlId));

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
    // A different actor must not silently take attribution for identical data.
    for (const replace of [true, false]) {
      await storage.importIrrigationProfile(companyAId, customerAId, "", rows.map(row => ({
        ...row, zoneType: "rotor" as const, location: null, brand: null, model: null,
        programName: null, wateringDays: null, startTimes: null,
      })), "commit",
        { id: managerAUserId, name: "Identical reimport actor" }, replace ? [ctrlName] : []);
      const [after] = await db.select().from(irrigationControllers).where(eq(irrigationControllers.id, ctrlId));
      assert.deepEqual(after, controllerAfterFirst, "Identical CSV keeps timestamps and attribution unchanged");
      assert.equal((await storage.getIrrigationHistory(companyAId, ctrlId)).length, histCountAfterFirst);
    }
  });

  it("Sparse Replace expansion resets omitted retired rows without changing their IDs", async () => {
    const ctrlId = await seedController(`ReplaceRetired_${Date.now()}`,
      Array.from({ length: 12 }, (_, i) => ({ zoneNumber: i + 1, name: `Custom ${i + 1}` })));
    const original = await storage.getIrrigationController(companyAId, ctrlId);
    const zone5 = original!.zones.find(zone => zone.zoneNumber === 5)!;
    const program = await storage.createIrrigationProgram(companyAId, ctrlId, { name: "Old program" });
    await db.update(irrigationProfileZones).set({
      notes: "Old notes", runTimeMinutes: 27, zoneOrder: 77, isActive: false,
      programId: program!.id, overrideStartTime: "08:30", overrideDays: ["Mon"],
    }).where(eq(irrigationProfileZones.id, zone5.id));
    await storage.setControllerZoneCount(companyAId, ctrlId, 2);
    const rows = [1, 10].map(zoneNumber => ({
      controllerName: original!.name, zoneNumber, zoneName: `Input ${zoneNumber}`,
      zoneType: "rotor" as const, runTimeMinutes: 10, seasonalAdjustPct: 100,
      location: null, brand: null, model: null, programName: null, wateringDays: null, startTimes: null,
    }));
    await storage.importIrrigationProfile(companyAId, customerAId, "", rows, "commit", undefined, [original!.name]);
    const profile = await storage.getIrrigationController(companyAId, ctrlId);
    assert.equal(profile!.totalZones, 10);
    assert.equal(profile!.zones.length, 10);
    const restored = profile!.zones.find(zone => zone.zoneNumber === 5)!;
    assert.equal(restored.id, zone5.id);
    assert.equal(restored.name, "Zone 5");
    assert.equal(restored.zoneType, "other");
    assert.equal(restored.runTimeMinutes, 0);
    assert.equal(restored.zoneOrder, 5);
    assert.equal(restored.isActive, true);
    for (const key of ["notes", "programId", "overrideStartTime", "overrideDays", "retiredAt", "retiredByUserId", "retiredByName"] as const) {
      assert.equal(restored[key], null, key);
    }
    const [beforeRepeat] = await db.select().from(irrigationControllers).where(eq(irrigationControllers.id, ctrlId));
    const historyBefore = await storage.getIrrigationHistory(companyAId, ctrlId);
    await storage.importIrrigationProfile(companyAId, customerAId, "", rows, "commit", undefined, [original!.name]);
    const [afterRepeat] = await db.select().from(irrigationControllers).where(eq(irrigationControllers.id, ctrlId));
    assert.deepEqual(afterRepeat, beforeRepeat, "Sparse replacement repeat is also a true no-op");
    assert.equal((await storage.getIrrigationHistory(companyAId, ctrlId)).length, historyBefore.length);
  });

  it("Replace-on: totalZones is highest input position; omitted lower positions reset", async () => {
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

    // CSV only has zone 2 — zone 1 resets, zone 3 retires.
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

    // Positions are 1..highest input number, never the input row count.
    const ctrl = await hit(srv.base, "GET", `/api/irrigation-controllers/${ctrlId}`);
    assert.equal(ctrl.status, 200);
    assert.equal(
      ctrl.body.totalZones,
      2,
      `totalZones should be highest input position (2), got ${ctrl.body.totalZones}`,
    );
    assert.equal(ctrl.body.zones.length, 2);
    assert.equal(ctrl.body.zones[0].name, "Zone 1");
    assert.equal(ctrl.body.zones[0].runTimeMinutes, 0);
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

// ── Permission-matrix tests ────────────────────────────────────────────────────
//
// Verifies that each role receives exactly the HTTP status the permission matrix
// specifies for the three guard-sensitive endpoints touched by Task #1778:
//
//   PUT  /api/irrigation-zones/:id            → canEditZones (all non-billing roles)
//   POST /api/backflows/:id/log-test          → canWrite (admin + manager + tech)
//   POST /api/customers/:id/controllers-profile → canManageControllers (admin + manager only)
//
// Tests use isolated in-memory controller + zone so they don't depend on
// earlier suites' created IDs.

describe("Irrigation Profile routes — permission matrix", () => {
  let zoneId: number;
  // The backflow log-test route guard fires before any DB lookup, so we can
  // use a sentinel ID. Permitted roles get 404 (entity not found), blocked
  // roles get 403. Both outcomes are correct for the matrix assertion.
  const BACKFLOW_SENTINEL_ID = 999_999_999;

  before(async () => {
    await setupCompanies();

    // Create one controller + zone via the admin-role test server so the PUT
    // zone tests have a real row to target. The backflow/log-test guard fires
    // before any DB lookup so no real backflow row is needed.
    const adminSrv = makeTestServer({ role: "company_admin", companyId: companyAId, userId: managerAUserId });
    try {
      const ctrlR = await hit(
        adminSrv.base,
        "POST",
        `/api/customers/${customerAId}/controllers-profile`,
        { name: `PermMatrix_${Date.now()}`, brand: "Hunter", model: "Pro-C", totalZones: 4 },
      );
      createdControllerIds.push(ctrlR.body.id);

      assert.equal(ctrlR.status, 201, JSON.stringify(ctrlR.body));
      zoneId = (await storage.getIrrigationController(companyAId, ctrlR.body.id))!.zones[0].id;
    } finally {
      await adminSrv.close();
    }
  });

  after(async () => {
    await cleanupControllers();
  });

  // Helper: attempt a PUT to an irrigation zone and return the status code.
  async function putZone(role: string, companyId: number | null) {
    const s = makeTestServer({ role, companyId, userId: managerAUserId });
    try {
      const r = await hit(s.base, "PUT", `/api/irrigation-zones/${zoneId}`, { name: "Updated" });
      return r.status;
    } finally {
      await s.close();
    }
  }

  // Helper: attempt POST /api/backflows/:id/log-test and return the status code.
  // Uses a sentinel ID — the auth guard fires before any DB lookup so permitted
  // roles get 404 (non-entity) and blocked roles get 403.
  async function logBackflowTest(role: string, companyId: number | null) {
    const s = makeTestServer({ role, companyId, userId: managerAUserId });
    try {
      const r = await hit(s.base, "POST", `/api/backflows/${BACKFLOW_SENTINEL_ID}/log-test`, {
        testDate: new Date().toISOString().slice(0, 10),
        result: "pass",
        testedBy: "Tester",
      });
      return r.status;
    } finally {
      await s.close();
    }
  }

  // Helper: attempt POST /api/customers/:id/controllers-profile and return the status code.
  async function postController(role: string, companyId: number | null) {
    const s = makeTestServer({ role, companyId, userId: managerAUserId });
    try {
      const r = await hit(
        s.base,
        "POST",
        `/api/customers/${customerAId}/controllers-profile`,
        { name: `PermTest_${Date.now()}`, brand: "Rain Bird", model: "ESP", totalZones: 2 },
      );
      if (r.body?.id) createdControllerIds.push(r.body.id);
      return r.status;
    } finally {
      await s.close();
    }
  }

  // ── PUT /api/irrigation-zones/:id ─────────────────────────────────────────
  // Allowed: super_admin, company_admin, irrigation_manager, field_tech → 200
  // Denied:  billing_manager → 403

  it("PUT irrigation-zones — super_admin is allowed (200)", async () => {
    const status = await putZone("super_admin", null);
    assert.equal(status, 200, `Expected 200 for super_admin, got ${status}`);
  });

  it("PUT irrigation-zones — company_admin is allowed (200)", async () => {
    const status = await putZone("company_admin", companyAId);
    assert.equal(status, 200, `Expected 200 for company_admin, got ${status}`);
  });

  it("PUT irrigation-zones — irrigation_manager is allowed (200)", async () => {
    const status = await putZone("irrigation_manager", companyAId);
    assert.equal(status, 200, `Expected 200 for irrigation_manager, got ${status}`);
  });

  it("PUT irrigation-zones — field_tech is allowed (200; Slice 1 fix)", async () => {
    const status = await putZone("field_tech", companyAId);
    assert.equal(status, 200, `Expected 200 for field_tech, got ${status}`);
  });

  it("PUT irrigation-zones — billing_manager is denied (403)", async () => {
    const status = await putZone("billing_manager", companyAId);
    assert.equal(status, 403, `Expected 403 for billing_manager, got ${status}`);
  });

  // ── POST /api/backflows/:id/log-test ──────────────────────────────────────
  // Allowed: super_admin, company_admin, irrigation_manager, field_tech
  // Denied:  billing_manager

  it("POST backflows/log-test — super_admin is allowed", async () => {
    const status = await logBackflowTest("super_admin", null);
    assert.ok(status !== 403, `Expected non-403 for super_admin, got ${status}`);
  });

  it("POST backflows/log-test — company_admin is allowed", async () => {
    const status = await logBackflowTest("company_admin", companyAId);
    assert.ok(status !== 403, `Expected non-403 for company_admin, got ${status}`);
  });

  it("POST backflows/log-test — irrigation_manager is allowed", async () => {
    const status = await logBackflowTest("irrigation_manager", companyAId);
    assert.ok(status !== 403, `Expected non-403 for irrigation_manager, got ${status}`);
  });

  it("POST backflows/log-test — field_tech is allowed (Slice 1 fix)", async () => {
    const status = await logBackflowTest("field_tech", companyAId);
    assert.ok(status !== 403, `Expected non-403 for field_tech, got ${status}`);
  });

  it("POST backflows/log-test — billing_manager is denied", async () => {
    const status = await logBackflowTest("billing_manager", companyAId);
    assert.equal(status, 403, `Expected 403 for billing_manager, got ${status}`);
  });

  // ── POST /api/customers/:id/controllers-profile ───────────────────────────
  // Allowed: super_admin, company_admin, irrigation_manager
  // Denied:  field_tech, billing_manager

  it("POST controllers-profile — super_admin is allowed", async () => {
    const status = await postController("super_admin", null);
    assert.ok(status !== 403, `Expected non-403 for super_admin, got ${status}`);
  });

  it("POST controllers-profile — company_admin is allowed", async () => {
    const status = await postController("company_admin", companyAId);
    assert.ok(status !== 403, `Expected non-403 for company_admin, got ${status}`);
  });

  it("POST controllers-profile — irrigation_manager is allowed", async () => {
    const status = await postController("irrigation_manager", companyAId);
    assert.ok(status !== 403, `Expected non-403 for irrigation_manager, got ${status}`);
  });

  it("POST controllers-profile — field_tech is denied", async () => {
    const status = await postController("field_tech", companyAId);
    assert.equal(status, 403, `Expected 403 for field_tech, got ${status}`);
  });

  it("POST controllers-profile — billing_manager is denied", async () => {
    const status = await postController("billing_manager", companyAId);
    assert.equal(status, 403, `Expected 403 for billing_manager, got ${status}`);
  });
});

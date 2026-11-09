import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, companies, customers, users, irrigationControllers, irrigationBackflows,
  irrigationPrograms, irrigationProfileZones, irrigationProfileHistory, irrigationSiteDocumentation,
} from "@workspace/db";
import { controllerDocumentationGaps, backflowDocumentationGaps } from "@workspace/shared";
import { registerSystemDocumentationRoutes } from "./system-documentation-routes";
import { registerIrrigationProfileRoutes } from "./irrigation-profile-routes";
import { enforceRoleApiAllowlist } from "./role-guards";
import { storage } from "../storage";

const prefix = `doc_api_${Date.now()}_${Math.random().toString(36).slice(2)}`;
let a: number, b: number, actorId: number;
let emptyId: number, branchId: number, hiddenId: number, foreignId: number;
let base: string;
const app = express();
app.use(express.json());
const loggedErrors: unknown[] = [];
// Seeded session identities, not production header authentication. Each request
// still traverses the real documenter allowlist before reaching a real route.
const auth: RequestHandler = (req, res, next) => {
  const role = req.headers["x-test-role"];
  if (!role) { res.status(401).json({ message: "Authentication required" }); return; }
  req.authenticatedUserRole = String(role);
  req.authenticatedUserCompanyId = req.headers["x-test-company"] === "none" ? undefined
    : Number(req.headers["x-test-company"] ?? a);
  req.authenticatedUserId = actorId;
  (req as any).log = { error: (error: unknown) => loggedErrors.push(error), warn: () => {} };
  if (enforceRoleApiAllowlist(req, res)) next();
};
registerIrrigationProfileRoutes(app, { requireAuthentication: auth });
registerSystemDocumentationRoutes(app, { requireAuthentication: auth });
app.get("/api/customers", auth, (_req, res) => { res.json({ privateFixture: true }); });
app.get("/api/users", auth, (_req, res) => { res.json({ privateFixture: true }); });
const server = createServer(app);

async function hit(method: string, path: string, body?: unknown, role = "system_documenter", company: number | "none" = a) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "x-test-role": role, "x-test-company": String(company) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.ok(response.headers.get("content-type")?.includes("application/json"), `${method} ${path} as ${role}: ${response.status} ${text.slice(0, 200)}`);
  return { status: response.status, body: JSON.parse(text) as any };
}
const site = (id: number, branch?: string) => `/api/system-documentation/customers/${id}/site${branch === undefined ? "" : `?branchName=${encodeURIComponent(branch)}`}`;
const finish = (id: number) => `/api/system-documentation/customers/${id}/site/verify`;
const confirm = (id: number) => `/api/system-documentation/customers/${id}/site/no-backflow`;
const verifyCtrl = (id: number) => `/api/irrigation-controllers/${id}/field-verify`;
const verifyBf = (id: number) => `/api/backflows/${id}/field-verify`;
async function customer(name: string, extra = {}) {
  const [c] = await db.insert(customers).values({ companyId: a, name, email: `${prefix}@test.example`, ...extra }).returning();
  return c;
}
async function controller(customerId: number, complete = true, extra = {}) {
  const c = await storage.createIrrigationController({
    companyId: a, customerId, name: `${prefix} clock ${Math.random()}`,
    ...(complete ? { location: "Garage", brand: "Hunter", model: "Pro-C", settingsPhotoUrl: "/api/photos/clock.jpg", totalZones: 2 } : {}),
    ...extra,
  });
  if (complete) {
    const p = await storage.createIrrigationProgram(c.companyId, c.id, { name: "Morning", wateringDays: ["Mon"], startTimes: ["06:00"] });
    const graph = (await storage.getIrrigationController(c.companyId, c.id))!;
    for (const z of graph.zones) await storage.updateIrrigationZone(c.companyId, z.id, { zoneType: "rotor", programId: p!.id, runTimeMinutes: 12 });
  }
  return (await storage.getIrrigationController(c.companyId, c.id))!;
}
async function backflow(customerId: number, complete = true, extra = {}) {
  return storage.createBackflow({
    companyId: a, customerId, name: `${prefix} backflow ${Math.random()}`,
    ...(complete ? { deviceType: "rpz", photoUrl: "/api/photos/device.jpg", size: "1", brand: "Watts",
      serialNumber: `${prefix}-${Math.random()}`, location: "Front", testUnknownReason: "never_tested" } : {}),
    ...extra,
  });
}
async function record(customerId: number, branchName = "") {
  return (await db.select().from(irrigationSiteDocumentation).where(and(
    eq(irrigationSiteDocumentation.customerId, customerId), eq(irrigationSiteDocumentation.branchName, branchName),
  )))[0];
}

describe("Document System reads and atomic verification (real DB/routes)", { concurrency: false }, () => {
  before(async () => {
    const [ca] = await db.insert(companies).values({ name: `${prefix} A` }).returning();
    const [cb] = await db.insert(companies).values({ name: `${prefix} B` }).returning();
    a = ca.id; b = cb.id;
    const [actor] = await db.insert(users).values({
      companyId: a, name: "Documenter Fixture", username: prefix, password: "not-a-login-password", role: "system_documenter",
    }).returning();
    actorId = actor.id;
    emptyId = (await customer("zulu", {
      irrigoName: "  Alpha Site  ", address: "fallback", serviceStreet: " 10  Main ", serviceCity: "City", serviceState: "CO", serviceZip: "80000",
      billingNotes: "PRIVATE FINANCE", budgetMode: "annual", totalControllers: 4,
    })).id;
    branchId = (await customer("beta", { branches: ["South", "North"] })).id;
    hiddenId = (await customer("hidden", { hiddenFromBilling: true })).id;
    foreignId = (await customer("foreign", { companyId: b })).id;
    await new Promise<void>(resolve => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    // Only fixtures owned by these isolated tenants are removed.
    const scope = inArray(irrigationControllers.companyId, [a, b]);
    await db.delete(irrigationSiteDocumentation).where(inArray(irrigationSiteDocumentation.companyId, [a, b]));
    await db.delete(irrigationProfileHistory).where(inArray(irrigationProfileHistory.companyId, [a, b]));
    await db.delete(irrigationProfileZones).where(inArray(irrigationProfileZones.companyId, [a, b]));
    await db.delete(irrigationPrograms).where(inArray(irrigationPrograms.companyId, [a, b]));
    await db.delete(irrigationControllers).where(scope);
    await db.delete(irrigationBackflows).where(inArray(irrigationBackflows.companyId, [a, b]));
    await db.delete(customers).where(inArray(customers.companyId, [a, b]));
    await db.delete(users).where(inArray(users.companyId, [a, b]));
    await db.delete(companies).where(inArray(companies.id, [a, b]));
    await pool.end();
  });

  it("picker uses four bulk queries, exact customer projection, display sort/address, and branch order", async () => {
    const spy = mock.method(db, "select");
    let response;
    try { response = await hit("GET", "/api/system-documentation/sites"); assert.equal(spy.mock.callCount(), 4); }
    finally { spy.mock.restore(); }
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.customers.map((c: any) => c.customerId), [emptyId, branchId]);
    const [first, branched] = response.body.customers;
    assert.deepEqual(Object.keys(first).sort(), ["customerId", "name", "address", "branches", "sites"].sort());
    assert.equal(first.name, "Alpha Site"); assert.equal(first.address, "10 Main, City CO 80000");
    assert.deepEqual(first.sites, [{ branchName: "", status: "nothing_on_file", verifiedAt: null, controllerCount: 0, backflowCount: 0 }]);
    assert.deepEqual(branched.sites.map((s: any) => s.branchName), ["South", "North"]);
    assert.ok(!JSON.stringify(response.body).match(/billing|budget|PRIVATE FINANCE/i));
    assert.ok(!response.body.customers.some((c: any) => c.customerId === hiddenId));
  });

  it("empty site reads never seed or create documentation", async () => {
    const seed = mock.method(storage, "ensureIrrigationControllers", async () => { throw new Error("No seeding"); });
    try {
      const r = await hit("GET", site(emptyId));
      assert.equal(r.status, 200); assert.deepEqual(r.body.controllers, []); assert.deepEqual(r.body.backflows, []);
      assert.deepEqual(r.body.site, { status: "nothing_on_file", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: false });
      assert.equal(seed.mock.callCount(), 0);
      const [count] = await db.select({ count: sql<number>`count(*)::int` }).from(irrigationControllers).where(eq(irrigationControllers.customerId, emptyId));
      assert.equal(count.count, 0); assert.equal(await record(emptyId), undefined);
    } finally { seed.mock.restore(); }
  });

  it("uses one exact branch rule on all three customer-scoped endpoints, after ownership", async () => {
    for (const [raw, message] of [[undefined, "Pick a location"], ["", "Pick a location"], ["Nope", "Unknown location"], [" South ", "Unknown location"]] as const) {
      assert.deepEqual(await hit("GET", site(branchId, raw)), { status: 400, body: { message } });
      for (const path of [confirm(branchId), finish(branchId)]) {
        assert.deepEqual(await hit("POST", path, { branchName: raw, ...(path.endsWith("no-backflow") ? { confirmed: false } : {}) }), { status: 400, body: { message } });
      }
    }
    for (const id of [emptyId, branchId]) {
      assert.equal((await hit("GET", site(id, id === emptyId ? "" : "North"))).status, 200);
    }
    assert.deepEqual(await hit("GET", site(emptyId, "X")), { status: 400, body: { message: "Unknown location" } });
    for (const path of [confirm(emptyId), finish(emptyId)]) {
      assert.equal((await hit("POST", path, { branchName: "X", ...(path.endsWith("no-backflow") ? { confirmed: false } : {}) })).body.message, "Unknown location");
    }
    const c = await controller(branchId, false, { branchName: "Former branch" });
    const bf = await backflow(branchId, false, { branchName: "Former branch" });
    const r = await hit("GET", "/api/system-documentation/sites");
    const branches = r.body.customers.find((c: any) => c.customerId === branchId).sites;
    assert.deepEqual(branches.map((s: any) => s.controllerCount + s.backflowCount), [0, 0]);
    assert.ok(!JSON.stringify(r.body).includes("Former branch"));
    assert.ok(c.id && bf.id);
  });

  it("filters inactive equipment; projects the controller graph/current ordered zones and backflows", async () => {
    const c = await customer("Graph fixture");
    const active = await controller(c.id, true, { totalZones: 3 });
    await storage.createIrrigationProgram(a, active.id, { name: "Inactive program", isActive: false });
    await storage.setControllerZoneCount(a, active.id, 2);
    await storage.updateIrrigationZone(a, active.zones[0].id, { zoneOrder: 9 });
    const bf = await backflow(c.id, true, { vrtSyncId: "private-sync" });
    await controller(c.id, false, { isActive: false });
    const inactiveBf = await backflow(c.id, false, { isActive: false });
    const r = await hit("GET", site(c.id));
    assert.equal(r.status, 200); assert.equal(r.body.controllers.length, 1); assert.equal(r.body.backflows.length, 1);
    const ctrl = r.body.controllers[0], device = r.body.backflows[0];
    assert.deepEqual(Object.keys(ctrl).sort(), ["id", "letter", "name", "location", "brand", "model", "totalZones", "settingsPhotoUrl",
      "notes", "lastUpdatedAt", "fieldVerifiedAt", "fieldVerifiedByName", "programs", "zones", "gaps", "verified"].sort());
    assert.equal(ctrl.programs.length, 2); assert.equal(ctrl.programs[1].isActive, false);
    assert.deepEqual(ctrl.zones.map((z: any) => z.zoneNumber), [1, 2]);
    assert.deepEqual(Object.keys(ctrl.zones[0]).sort(), ["id", "zoneNumber", "name", "zoneType", "zoneTypeConfirmed", "programId", "runTimeMinutes"].sort());
    assert.deepEqual(Object.keys(device).sort(), [...Object.keys(bf).filter(k => !["companyId", "customerId", "vrtSyncId"].includes(k)), "gaps", "verified"].sort());
    assert.deepEqual(ctrl.gaps, controllerDocumentationGaps((await storage.getIrrigationController(a, active.id))!));
    assert.deepEqual(device.gaps, backflowDocumentationGaps(bf));
    const picker = (await hit("GET", "/api/system-documentation/sites")).body.customers.find((x: any) => x.customerId === c.id);
    assert.equal(picker.sites[0].controllerCount, 1); assert.equal(picker.sites[0].backflowCount, 1);
    for (const path of [verifyBf(inactiveBf.id)]) assert.deepEqual(await hit("POST", path), { status: 400, body: { message: "This item is marked not at this location" } });
    await db.update(irrigationControllers).set({ isActive: false }).where(eq(irrigationControllers.id, active.id));
    assert.deepEqual(await hit("POST", verifyCtrl(active.id)), { status: 400, body: { message: "This item is marked not at this location" } });
  });

  it("controller completeness uses shared gaps; atomic stamps/history and existing zone edits invalidate verification", async () => {
    const c = await customer("Controller verification");
    const incomplete = await controller(c.id, false);
    const gaps = controllerDocumentationGaps(incomplete);
    const rejected = await hit("POST", verifyCtrl(incomplete.id));
    assert.deepEqual(rejected, { status: 400, body: { message: "Still needed: " + gaps.map(g => g.label).join(", "), gaps } });
    assert.ok(rejected.body.gaps.some((g: any) => g.code === "photo"));
    assert.equal((await storage.getIrrigationController(a, incomplete.id))!.fieldVerifiedAt, null);
    const full = await controller(c.id);
    const before = await storage.getIrrigationHistory(a, full.id);
    const verified = await hit("POST", verifyCtrl(full.id));
    assert.equal(verified.status, 200); assert.equal(verified.body.verified, true); assert.deepEqual(verified.body.gaps, []);
    for (const field of ["lastUpdatedAt", "updatedAt"]) assert.equal(verified.body[field], verified.body.fieldVerifiedAt);
    assert.equal(verified.body.fieldVerifiedByUserId, actorId); assert.equal(verified.body.lastUpdatedByUserId, actorId);
    assert.equal(verified.body.fieldVerifiedByName, "Documenter Fixture"); assert.equal(verified.body.lastUpdatedByName, "Documenter Fixture");
    const history = await storage.getIrrigationHistory(a, full.id);
    assert.equal(history.length, before.length + 1); assert.equal(history[0].summary, "Verified in field by Documenter Fixture");
    assert.equal((history[0].snapshotJson as any).controller.fieldVerifiedAt, verified.body.fieldVerifiedAt);
    assert.equal((await hit("GET", site(c.id))).body.controllers.find((x: any) => x.id === full.id).verified, true);
    await new Promise(r => setTimeout(r, 5));
    // Documenter cannot call zone PUT (by design); manager's real existing edit path can.
    assert.equal((await hit("PUT", `/api/irrigation-zones/${full.zones[0].id}`, { name: "Office rename" }, "irrigation_manager")).status, 200);
    assert.equal((await hit("GET", site(c.id))).body.controllers.find((x: any) => x.id === full.id).verified, false);
  });

  it("verifies an eight-zone controller after the bulk save persists Program A Zone 8 at zero minutes", async () => {
    const c = await customer("Eight-zone zero-runtime fixture");
    const full = await controller(c.id, true, { totalZones: 8 });
    const p = full.programs[0];
    await storage.updateIrrigationProgram(a, p.id, { name: "A" });
    const eighth = full.zones.find(z => z.zoneNumber === 8)!;
    const saved = await hit("PUT", `/api/irrigation-controllers/${full.id}/zones/bulk`, {
      zoneIds: [eighth.id], patch: { programId: p.id, runTimeMinutes: 0 },
    }, "irrigation_manager");
    assert.equal(saved.status, 200);
    const graph = (await hit("GET", site(c.id))).body.controllers[0];
    assert.equal(graph.zones.length, 8);
    assert.equal(graph.zones.find((z: any) => z.zoneNumber === 8).runTimeMinutes, 0);
    assert.deepEqual(graph.gaps, []);
    const verified = await hit("POST", verifyCtrl(full.id));
    assert.equal(verified.status, 200);
    assert.equal(verified.body.verified, true);
    assert.deepEqual(verified.body.gaps, []);
    const stored = (await storage.getIrrigationController(a, full.id))!;
    assert.ok(stored.fieldVerifiedAt);
    assert.equal(stored.zones.find(z => z.id === eighth.id)!.runTimeMinutes, 0);
  });

  it("backflow completeness/stamps use shared rules and existing edits/log-test invalidate without history", async () => {
    const c = await customer("Backflow verification");
    const incomplete = await backflow(c.id, false);
    const gaps = backflowDocumentationGaps(incomplete);
    assert.deepEqual(await hit("POST", verifyBf(incomplete.id)), { status: 400, body: { message: "Still needed: " + gaps.map(g => g.label).join(", "), gaps } });
    const full = await backflow(c.id);
    const historyBefore = await db.select({ id: irrigationProfileHistory.id }).from(irrigationProfileHistory).where(eq(irrigationProfileHistory.companyId, a));
    const verified = await hit("POST", verifyBf(full.id));
    assert.equal(verified.status, 200); assert.equal(verified.body.verified, true);
    for (const field of ["lastUpdatedAt", "updatedAt"]) assert.equal(verified.body[field], verified.body.fieldVerifiedAt);
    assert.equal(verified.body.fieldVerifiedByUserId, actorId); assert.equal(verified.body.lastUpdatedByUserId, actorId);
    assert.equal(verified.body.fieldVerifiedByName, "Documenter Fixture"); assert.equal(verified.body.lastUpdatedByName, "Documenter Fixture");
    assert.deepEqual(await db.select({ id: irrigationProfileHistory.id }).from(irrigationProfileHistory).where(eq(irrigationProfileHistory.companyId, a)), historyBefore);
    assert.equal((await hit("GET", site(c.id))).body.backflows.find((x: any) => x.id === full.id).verified, true);
    await new Promise(r => setTimeout(r, 5));
    assert.equal((await hit("PUT", `/api/backflows/${full.id}`, { location: "Changed" })).status, 200);
    assert.equal((await hit("GET", site(c.id))).body.backflows.find((x: any) => x.id === full.id).verified, false);
    await hit("POST", verifyBf(full.id));
    assert.equal((await hit("POST", `/api/backflows/${full.id}/log-test`, { lastTestedDate: "2026-11-01", lastTestResult: "pass", lastTestedBy: "Tester" })).status, 200);
    assert.equal((await hit("GET", site(c.id))).body.backflows.find((x: any) => x.id === full.id).verified, false);
  });

  it("Finish collects exact ordered refusal reasons; success and subsequent item re-verification require Finish again", async () => {
    const c = await customer("Finish lifecycle");
    assert.deepEqual(await hit("POST", finish(c.id), {}), { status: 400, body: { message: "Add at least one controller", reasons: ["Add at least one controller", "Add a backflow or confirm there isn't one"] } });
    const ctrl = await controller(c.id), bf = await backflow(c.id);
    assert.deepEqual((await hit("POST", finish(c.id), {})).body, {
      message: `Controller ${ctrl.letter} is not verified`,
      reasons: [`Controller ${ctrl.letter} is not verified`, `${bf.name} is not verified`],
    });
    await hit("POST", verifyCtrl(ctrl.id));
    assert.deepEqual((await hit("POST", finish(c.id), {})).body.reasons, [`${bf.name} is not verified`]);
    await hit("POST", verifyBf(bf.id));
    const done = await hit("POST", finish(c.id), {});
    assert.equal(done.status, 200); assert.equal(done.body.status, "verified"); assert.equal(done.body.verifiedByName, "Documenter Fixture");
    const stored = (await record(c.id))!;
    assert.equal(stored.companyId, a); assert.equal(stored.verifiedByUserId, actorId); assert.ok(stored.verifiedAt);
    assert.deepEqual((await hit("GET", site(c.id))).body.site, done.body);
    const picker = (await hit("GET", "/api/system-documentation/sites")).body.customers.find((x: any) => x.customerId === c.id).sites[0];
    assert.equal(picker.status, "verified"); assert.equal(picker.verifiedAt, done.body.verifiedAt);
    await new Promise(r => setTimeout(r, 5));
    await hit("POST", verifyCtrl(ctrl.id));
    let stale = (await hit("GET", site(c.id))).body.site;
    assert.equal(stale.status, "not_verified"); assert.equal(stale.verifiedAt, null); assert.equal(stale.verifiedByName, null);
    assert.equal((await hit("POST", finish(c.id), {})).body.status, "verified");
    await new Promise(r => setTimeout(r, 5));
    await hit("POST", verifyBf(bf.id));
    stale = (await hit("GET", site(c.id))).body.site;
    assert.equal(stale.status, "not_verified");
  });

  it("no-backflow is strict, refuses active equipment, clears every Finish stamp on changes, and is idempotent", async () => {
    const c = await customer("No backflow lifecycle"), ctrl = await controller(c.id);
    for (const body of [{}, { confirmed: "true" }, { confirmed: true, extra: 1 }, { confirmed: null }]) {
      assert.equal((await hit("POST", confirm(c.id), body)).status, 400);
    }
    assert.equal((await hit("POST", finish(c.id), { extra: true })).status, 400);
    await hit("POST", verifyCtrl(ctrl.id));
    assert.deepEqual((await hit("POST", finish(c.id), {})).body.reasons, ["Add a backflow or confirm there isn't one"]);
    assert.equal((await hit("POST", confirm(c.id), { confirmed: true })).body.noBackflowConfirmed, true);
    const confirmed = (await record(c.id))!;
    assert.ok(confirmed.noBackflowConfirmedAt); assert.equal(confirmed.noBackflowConfirmedByUserId, actorId);
    assert.equal(confirmed.noBackflowConfirmedByName, "Documenter Fixture");
    assert.equal((await hit("POST", finish(c.id), {})).body.status, "verified");
    const before = (await record(c.id))!;
    await hit("POST", confirm(c.id), { confirmed: true });
    assert.deepEqual((await record(c.id))!.verifiedAt, before.verifiedAt);
    assert.deepEqual((await record(c.id))!.noBackflowConfirmedAt, before.noBackflowConfirmedAt);
    const cleared = await hit("POST", confirm(c.id), { confirmed: false });
    assert.equal(cleared.body.status, "not_verified"); assert.equal(cleared.body.verifiedAt, null);
    const after = (await record(c.id))!;
    for (const key of ["verifiedAt", "verifiedByName", "verifiedByUserId", "noBackflowConfirmedAt", "noBackflowConfirmedByUserId", "noBackflowConfirmedByName"] as const) assert.equal(after[key], null);
    await hit("POST", confirm(c.id), { confirmed: true });
    assert.equal((await record(c.id))!.verifiedAt, null);
    const bf = await backflow(c.id);
    assert.deepEqual(await hit("POST", confirm(c.id), { confirmed: true }), { status: 400, body: { message: "This location has a backflow on file" } });
    await storage.updateBackflow(a, bf.id, { isActive: false });
    assert.equal((await hit("POST", confirm(c.id), { confirmed: true })).status, 200);
  });

  it("all six endpoints enforce role matrix, authentication, tenant ownership before body/gaps, and super-admin ownership", async () => {
    const c = await customer("Role fixture"), ctrl = await controller(c.id), bf = await backflow(c.id);
    const requests: [string, string, unknown?][] = [
      ["GET", "/api/system-documentation/sites"], ["GET", site(c.id)],
      ["POST", verifyCtrl(ctrl.id)], ["POST", verifyBf(bf.id)],
      ["POST", confirm(c.id), { confirmed: false }], ["POST", finish(c.id), {}],
    ];
    await hit("POST", verifyCtrl(ctrl.id)); await hit("POST", verifyBf(bf.id));
    for (const role of ["field_tech", "billing_manager", "bookkeeper", "unknown_role"]) {
      for (const [method, path, body] of requests) assert.equal((await hit(method, path, body, role)).status, 403, `${role}: ${path}`);
    }
    for (const role of ["system_documenter", "irrigation_manager", "company_admin", "super_admin"]) {
      for (const [method, path, body] of requests) assert.equal((await hit(method, path, body, role, role === "super_admin" ? "none" : a)).status, 200, `${role}: ${path}`);
    }
    for (const [method, path, body] of requests) {
      assert.deepEqual(await hit(method, path, body, "irrigation_manager", "none"), { status: 401, body: { message: "Authentication required" } });
      const unauth = await fetch(base + path, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      assert.equal(unauth.status, 401);
    }
    const incomplete = await controller(c.id, false), incompleteBf = await backflow(c.id, false);
    const foreignRequests: [string, string, unknown?][] = [
      ["GET", site(c.id, "Unknown")], ["POST", confirm(c.id), { confirmed: "bad", extra: 1 }],
      ["POST", finish(c.id), { branchName: "Unknown", extra: 1 }],
      ["POST", verifyCtrl(incomplete.id)], ["POST", verifyBf(incompleteBf.id)],
    ];
    for (const [method, path, body] of foreignRequests) {
      const result = await hit(method, path, body, "system_documenter", b);
      assert.equal(result.status, 404, path); assert.deepEqual(Object.keys(result.body), ["message"]);
    }
    const foreignPicker = await hit("GET", "/api/system-documentation/sites", undefined, "system_documenter", b);
    assert.deepEqual(foreignPicker.body.customers.map((c: any) => c.customerId), [foreignId]);
    // An actual B-owned site verifies cross-tenant without a null/wrong company.
    const foreignCtrl = await controller(foreignId, true, { companyId: b });
    assert.equal((await hit("POST", verifyCtrl(foreignCtrl.id), undefined, "super_admin", "none")).status, 200);
    await hit("POST", confirm(foreignId), { confirmed: true }, "super_admin", "none");
    assert.equal((await hit("POST", finish(foreignId), {}, "super_admin", "none")).body.status, "verified");
    assert.equal((await record(foreignId))!.companyId, b);
    assert.equal((await hit("GET", "/api/customers", undefined)).status, 403, "real allowlist blocks unrelated API");
  });

  it("rolls back verification and audit stamps if the controller history write fails; unexpected errors are logged", async () => {
    const c = await customer("Rollback fixture"), ctrl = await controller(c.id);
    const before = await storage.getIrrigationController(a, ctrl.id);
    const historyBefore = await storage.getIrrigationHistory(a, ctrl.id);
    const spy = mock.method(storage as any, "_appendIrrigationSnapshot", async () => { throw new Error("Injected history failure"); });
    try {
      const r = await hit("POST", verifyCtrl(ctrl.id));
      assert.deepEqual(r, { status: 500, body: { message: "Could not save — please retry" } });
    } finally { spy.mock.restore(); }
    assert.deepEqual(await storage.getIrrigationController(a, ctrl.id), before);
    assert.deepEqual(await storage.getIrrigationHistory(a, ctrl.id), historyBefore);
    assert.ok(loggedErrors.length > 0);
  });

  it("saves wizard-only order across reads without touching equipment, history, profile ordering or Finish", async () => {
    const c = await customer("Controller order preservation");
    const one = await controller(c.id), two = await controller(c.id);
    await hit("POST", verifyCtrl(one.id)); await hit("POST", verifyCtrl(two.id));
    await hit("POST", confirm(c.id), { confirmed: true }); await hit("POST", finish(c.id), {});
    const before = (await hit("GET", site(c.id))).body;
    const graphs = await Promise.all([one, two].map(x => storage.getIrrigationController(a, x.id)));
    const histories = await Promise.all([one, two].map(x => storage.getIrrigationHistory(a, x.id)));
    const profile = await storage.listIrrigationControllers(a, c.id, "");
    const docBefore = await record(c.id);
    const previousControllerIds = before.controllers.map((x: any) => x.id);
    const controllerIds = [...previousControllerIds].reverse();
    const body = { branchName: "", controllerIds, previousControllerIds };
    const url = `${site(c.id)}/controller-order`;
    assert.deepEqual(await hit("PUT", url, body), { status: 200, body: { controllerIds } });
    assert.deepEqual(await hit("PUT", url, body), { status: 200, body: { controllerIds } }, "lost response retry");
    for (let i = 0; i < 2; i++) {
      const afterRead = (await hit("GET", site(c.id))).body;
      assert.deepEqual(afterRead.controllers, [...before.controllers].reverse());
      assert.deepEqual(afterRead.site, before.site);
      assert.deepEqual(afterRead.backflows, before.backflows);
    }
    assert.deepEqual(await Promise.all([one, two].map(x => storage.getIrrigationController(a, x.id))), graphs);
    assert.deepEqual(await Promise.all([one, two].map(x => storage.getIrrigationHistory(a, x.id))), histories);
    assert.deepEqual(await storage.listIrrigationControllers(a, c.id, ""), profile);
    assert.deepEqual(await record(c.id), { ...docBefore, controllerOrder: controllerIds });
    const added = await controller(c.id, false);
    assert.deepEqual((await hit("GET", site(c.id))).body.controllers.map((x: any) => x.id), [...controllerIds, added.id]);
    await storage.updateIrrigationController(a, two.id, { isActive: false });
    assert.deepEqual((await hit("GET", site(c.id))).body.controllers.map((x: any) => x.id), [one.id, added.id]);
    assert.equal((await hit("PUT", url, body)).status, 409, "stale membership cannot overwrite");
  });

  it("controller order validates bodies, ownership, active membership, branches and existing role boundaries", async () => {
    const c = await customer("Ordering boundaries", { branches: ["North", "South"] });
    const north = await controller(c.id, false, { branchName: "North" });
    const other = await controller(c.id, false, { branchName: "South" });
    const inactive = await controller(c.id, false, { branchName: "North", isActive: false });
    const url = `${site(c.id)}/controller-order`;
    const body = { branchName: "North", controllerIds: [north.id], previousControllerIds: [north.id] };
    for (const patch of [
      { controllerIds: [north.id, north.id] }, { previousControllerIds: [north.id, north.id] },
      { controllerIds: [-1] }, { controllerIds: ["1"] }, { controllerIds: null }, { companyId: b },
    ]) assert.equal((await hit("PUT", url, { ...body, ...patch })).status, 400);
    for (const ids of [[other.id], [inactive.id], [], [north.id, other.id], [999999999]]) {
      assert.equal((await hit("PUT", url, { ...body, controllerIds: ids })).status, 409);
    }
    for (const branchName of ["", "Unknown"]) assert.equal((await hit("PUT", url, { ...body, branchName })).status, 400);
    assert.equal((await hit("PUT", url, {}, "system_documenter", b)).status, 404, "ownership before body validation");
    assert.equal((await hit("PUT", url, { ...body, controllerIds: [other.id] }, "system_documenter", b)).status, 404);
    for (const role of ["field_tech", "billing_manager", "bookkeeper", "unknown_role"]) {
      assert.equal((await hit("PUT", url, body, role)).status, 403);
    }
    for (const role of ["system_documenter", "irrigation_manager", "company_admin", "super_admin"]) {
      assert.equal((await hit("PUT", url, body, role, role === "super_admin" ? "none" : a)).status, 200);
    }
    assert.equal((await fetch(base + url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await hit("PUT", url, body, "system_documenter", "none")).status, 401);
    assert.equal((await hit("GET", "/api/users")).status, 403);
    assert.equal((await hit("DELETE", `/api/irrigation-controllers/${north.id}`)).status, 403);
    assert.deepEqual((await hit("GET", site(c.id, "South"))).body.controllers.map((x: any) => x.id), [other.id]);
  });

  it("serializes conflicting reorders, rejects stale previous order, and rolls back failed writes", async () => {
    const c = await customer("Concurrent order");
    const rows = await Promise.all([0, 1, 2].map(() => controller(c.id, false)));
    const previousControllerIds = (await hit("GET", site(c.id))).body.controllers.map((x: any) => x.id) as number[];
    const url = `${site(c.id)}/controller-order`;
    const orders = [[previousControllerIds[1], previousControllerIds[0], previousControllerIds[2]], [...previousControllerIds].reverse()];
    const results = await Promise.all(orders.map(controllerIds => hit("PUT", url, { branchName: "", previousControllerIds, controllerIds })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const saved = results.find(r => r.status === 200)!.body.controllerIds;
    assert.deepEqual((await hit("GET", site(c.id))).body.controllers.map((x: any) => x.id), saved);
    const before = await record(c.id);
    // Failure at the actual write boundary must not leak a partial order.
    const transaction = db.transaction.bind(db);
    const write = mock.method(db, "transaction", (async (fn: any) => transaction(async tx => {
      await fn(tx);
      throw new Error("Injected failure after order write, before commit");
    })) as typeof db.transaction);
    try {
      assert.equal((await hit("PUT", url, { branchName: "", previousControllerIds: saved, controllerIds: previousControllerIds })).status, 500);
    } finally { write.mock.restore(); }
    assert.deepEqual(await record(c.id), before);
    assert.equal(rows.length, 3);
    const empty = await customer("No controllers to sort");
    assert.deepEqual(await hit("PUT", `${site(empty.id)}/controller-order`, { branchName: "", previousControllerIds: [], controllerIds: [] }), { status: 200, body: { controllerIds: [] } });
  });
});

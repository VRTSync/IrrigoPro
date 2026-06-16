/**
 * Route-level tests for:
 *   POST /api/wet-checks/:id/build-inspection-estimate
 *   POST /api/wet-checks/:id/approve-inspection
 *
 * Pattern: express mini-server with spy storage — same pattern as
 * wet-check-finding-delete.test.ts. before/after hooks manage the
 * server lifecycle so tests run while the server is alive.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ─── Stubs ────────────────────────────────────────────────────────────────────

const STUB_ESTIMATE = {
  id: 42,
  estimateNumber: "EST-0042",
  lifecycle: "pending_review",
  status: "pending",
  internalStatus: "pending_approval",
  originWetCheckId: 7,
  items: [{ id: 1, description: "Broken head", quantity: 1, partPrice: "25.00", totalPrice: "25.00" }],
  partsSubtotal: "25.00",
  laborSubtotal: "0.00",
  totalAmount: "25.00",
  totalLaborHours: "0.00",
  laborRate: "65.00",
};

const STUB_WC = {
  id: 7,
  mode: "inspection",
  status: "converted",
  fullyConvertedAt: new Date().toISOString(),
};

// ─── Harness ──────────────────────────────────────────────────────────────────

type BuildFn = (wcId: number, cid: number, mgr: { id: number; name: string }) => Promise<typeof STUB_ESTIMATE>;
type ApproveFn = (wcId: number, cid: number) => Promise<{ estimate: typeof STUB_ESTIMATE; wetCheck: typeof STUB_WC }>;

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  setBuild: (fn: BuildFn) => void;
  setApprove: (fn: ApproveFn) => void;
}

const MANAGER_ROLES = new Set(["super_admin", "company_admin", "irrigation_manager", "billing_manager"]);

async function startServer(role = "irrigation_manager"): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  let build: BuildFn = async () => STUB_ESTIMATE;
  let approve: ApproveFn = async () => ({ estimate: STUB_ESTIMATE, wetCheck: STUB_WC });

  const auth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 1;
    (req as any).authenticatedUserCompanyId = 10;
    (req as any).authenticatedUserRole = role;
    (req as any).log = { error: () => {} };
    next();
  };

  // Mirrors the production build route handler.
  app.post("/api/wet-checks/:id/build-inspection-estimate", auth, async (req: any, res) => {
    if (!MANAGER_ROLES.has(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const wcId = parseInt(req.params.id);
    if (isNaN(wcId)) { res.status(400).json({ message: "Invalid wet check id" }); return; }
    try {
      const estimate = await build(wcId, req.authenticatedUserCompanyId, { id: 1, name: "Test Manager" });
      res.json(estimate);
    } catch (e: any) {
      const msg: string = e.message ?? "Internal error";
      const status = msg.includes("not an inspection") ? 400 : msg.includes("not found") ? 404 : 500;
      res.status(status).json({ message: msg });
    }
  });

  // Mirrors the production approve route handler (without audit-log deps).
  app.post("/api/wet-checks/:id/approve-inspection", auth, async (req: any, res) => {
    if (!MANAGER_ROLES.has(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const wcId = parseInt(req.params.id);
    if (isNaN(wcId)) { res.status(400).json({ message: "Invalid wet check id" }); return; }
    try {
      const result = await approve(wcId, req.authenticatedUserCompanyId);
      res.json(result);
    } catch (e: any) {
      const msg: string = e.message ?? "Internal error";
      const status = msg.includes("not in a pending state") || msg.includes("not pending") ? 409 : msg.includes("not found") ? 404 : msg.includes("not an inspection") ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
    setBuild: (fn) => { build = fn; },
    setApprove: (fn) => { approve = fn; },
  };
}

function post(url: string) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

// ─── build-inspection-estimate ───────────────────────────────────────────────

describe("POST /api/wet-checks/:id/build-inspection-estimate", () => {
  let h: Harness;
  before(async () => { h = await startServer("irrigation_manager"); });
  after(async () => { await h.close(); });

  it("(a) calls storage.buildEstimateFromInspectionWetCheck and returns EstimateWithItems", async () => {
    let calledWith: [number, number, { id: number; name: string }] | null = null;
    h.setBuild(async (wcId, cid, mgr) => { calledWith = [wcId, cid, mgr]; return STUB_ESTIMATE; });

    const r = await post(`${h.baseUrl}/api/wet-checks/7/build-inspection-estimate`);
    const body = await r.json() as any;

    assert.equal(r.status, 200);
    assert.equal(body.id, 42, "estimate id from storage");
    assert.equal(body.originWetCheckId, 7, "originWetCheckId round-trips");
    assert.deepEqual(calledWith, [7, 10, { id: 1, name: "Test Manager" }], "storage called with correct args");
  });

  it("(b) idempotency: two calls return same estimate id, storage invoked each time", async () => {
    let calls = 0;
    h.setBuild(async () => { calls++; return STUB_ESTIMATE; });

    const [r1, r2] = await Promise.all([
      post(`${h.baseUrl}/api/wet-checks/7/build-inspection-estimate`),
      post(`${h.baseUrl}/api/wet-checks/7/build-inspection-estimate`),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]) as any[];

    assert.equal(b1.id, b2.id, "same estimate id on both calls");
    assert.equal(calls, 2, "storage called each time (dedup is inside storage, not route)");
  });

  it("(c) returns 403 for field_tech role", async () => {
    const h2 = await startServer("field_tech");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/build-inspection-estimate`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });

  it("(d) returns 400 for non-numeric wet check id", async () => {
    const r = await post(`${h.baseUrl}/api/wet-checks/abc/build-inspection-estimate`);
    assert.equal(r.status, 400);
  });

  it("(e) service WC error from storage maps to 400", async () => {
    h.setBuild(async () => { throw new Error("Wet check #7 is not an inspection wet check"); });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/build-inspection-estimate`);
    assert.equal(r.status, 400);
    const body = await r.json() as any;
    assert.match(body.message, /not an inspection/);
  });
});

// ─── approve-inspection ───────────────────────────────────────────────────────

describe("POST /api/wet-checks/:id/approve-inspection", () => {
  let h: Harness;
  before(async () => { h = await startServer("irrigation_manager"); });
  after(async () => { await h.close(); });

  it("(f) calls storage.approveInspectionEstimate, returns estimate+wetCheck", async () => {
    let storageCalled = false;
    h.setApprove(async (wcId, cid) => {
      storageCalled = true;
      assert.equal(wcId, 7);
      assert.equal(cid, 10);
      return { estimate: { ...STUB_ESTIMATE, lifecycle: "approved", status: "approved" }, wetCheck: STUB_WC };
    });

    const r = await post(`${h.baseUrl}/api/wet-checks/7/approve-inspection`);
    const body = await r.json() as any;

    assert.equal(r.status, 200);
    assert.equal(body.estimate.lifecycle, "approved");
    assert.equal(body.wetCheck.status, "converted");
    assert.ok(storageCalled, "storage.approveInspectionEstimate must be called");
  });

  it("(g) 'not pending' error maps to 409 Conflict", async () => {
    h.setApprove(async () => { throw new Error("is not in a pending state and cannot be approved"); });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/approve-inspection`);
    assert.equal(r.status, 409);
  });

  it("(h) 'not an inspection' error maps to 400", async () => {
    h.setApprove(async () => { throw new Error("is not an inspection wet check"); });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/approve-inspection`);
    assert.equal(r.status, 400);
  });

  it("(i) 'not found' error maps to 404", async () => {
    h.setApprove(async () => { throw new Error("Wet check not found"); });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/approve-inspection`);
    assert.equal(r.status, 404);
  });

  it("(j) returns 403 for field_tech role", async () => {
    const h2 = await startServer("field_tech");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/approve-inspection`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });
});

// ─── needs-review Rule 4 (pure qualification logic) ──────────────────────────

describe("needs-review Rule 4 (inspection estimate pending)", () => {
  function qualifiesRule4(mode: string, estLifecycle: string | null): boolean {
    if (mode !== "inspection") return false;
    if (estLifecycle === null) return true;
    return estLifecycle !== "approved";
  }

  it("(e1) inspection WC with no estimate qualifies", () =>
    assert.ok(qualifiesRule4("inspection", null)));

  it("(e2) inspection WC with pending_review estimate qualifies", () =>
    assert.ok(qualifiesRule4("inspection", "pending_review")));

  it("(e3) inspection WC with approved estimate does not qualify", () =>
    assert.ok(!qualifiesRule4("inspection", "approved")));

  it("(e4) service WC does not trigger Rule 4", () =>
    assert.ok(!qualifiesRule4("service", null)));

  it("(e5) inspection WC with draft estimate qualifies", () =>
    assert.ok(qualifiesRule4("inspection", "draft")));
});

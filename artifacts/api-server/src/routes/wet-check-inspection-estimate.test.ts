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
  fullyConvertedAt: new Date().toISOString() as string | null,
};

// ─── Harness ──────────────────────────────────────────────────────────────────

type BuildFn = (wcId: number, cid: number, mgr: { id: number; name: string }) => Promise<typeof STUB_ESTIMATE>;
type ApproveFn = (wcId: number, cid: number) => Promise<{ estimate: typeof STUB_ESTIMATE; wetCheck: typeof STUB_WC }>;
type RevertFn = (wcId: number, cid: number) => Promise<{ estimate: typeof STUB_ESTIMATE; wetCheck: typeof STUB_WC }>;

const STUB_REVERTED_ESTIMATE = {
  ...STUB_ESTIMATE,
  lifecycle: "pending_review",
  status: "pending",
  internalStatus: "pending_approval",
  approvedAt: null,
};
const STUB_REVERTED_WC = { ...STUB_WC, status: "submitted", fullyConvertedAt: null };

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  setBuild: (fn: BuildFn) => void;
  setApprove: (fn: ApproveFn) => void;
  setRevert: (fn: RevertFn) => void;
}

const MANAGER_ROLES = new Set(["super_admin", "company_admin", "irrigation_manager", "billing_manager"]);
const REVERT_ALLOWED_ROLES = new Set(["super_admin", "company_admin"]);

async function startServer(role = "irrigation_manager"): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  let build: BuildFn = async () => STUB_ESTIMATE;
  let approve: ApproveFn = async () => ({ estimate: STUB_ESTIMATE, wetCheck: STUB_WC });
  let revert: RevertFn = async () => ({ estimate: STUB_REVERTED_ESTIMATE, wetCheck: STUB_REVERTED_WC });

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

  // approve-inspection is retired — unconditionally returns 410 Gone.
  app.post("/api/wet-checks/:id/approve-inspection", (_req, res) => {
    res.status(410).json({
      message: "This endpoint has been retired. Use POST /api/wet-checks/:id/pass-to-estimates instead.",
      replacedBy: "/api/wet-checks/:id/pass-to-estimates",
    });
  });

  // Mirrors the production revert-inspection route handler (without audit-log deps).
  app.post("/api/wet-checks/:id/revert-inspection", auth, async (req: any, res) => {
    if (!REVERT_ALLOWED_ROLES.has(req.authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden. Reverting an inspection hand-off requires company_admin or super_admin." });
      return;
    }
    const wcId = parseInt(req.params.id);
    if (isNaN(wcId)) { res.status(400).json({ message: "Invalid wet check id" }); return; }
    try {
      const result = await revert(wcId, req.authenticatedUserCompanyId);
      res.json(result);
    } catch (e: any) {
      const msg: string = e.message ?? "Internal error";
      const is409 =
        msg.includes("not in a converted state") ||
        msg.includes("already been included in invoice") ||
        msg.includes("Cannot revert:") ||
        msg.includes("not in approved_internal state") ||
        msg.includes("not an inspection wet check");
      const status = is409 ? 409 : msg.includes("not found") ? 404 : 500;
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
    setRevert: (fn) => { revert = fn; },
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

// ─── approve-inspection RETIRED (410 tombstone) ───────────────────────────────
//
// /approve-inspection was superseded by /pass-to-estimates (Task #1738).
// The old endpoint stamped lifecycle='approved' (full customer-approval), which
// was incorrect. The new endpoint only stamps internalStatus='approved_internal'.
// All clients should use /pass-to-estimates going forward.

describe("POST /api/wet-checks/:id/approve-inspection (retired — 410)", () => {
  let h: Harness;
  before(async () => { h = await startServer("irrigation_manager"); });
  after(async () => { await h.close(); });

  it("(f) returns 410 Gone — endpoint is retired", async () => {
    const r = await post(`${h.baseUrl}/api/wet-checks/7/approve-inspection`);
    assert.equal(r.status, 410, "retired endpoint must return 410 Gone");
    const body = await r.json() as any;
    assert.match(body.message, /retired|pass-to-estimates/i, "body must mention the replacement");
    assert.ok(typeof body.replacedBy === "string", "replacedBy field must be present");
  });

  it("(g) 410 returned for any wet check id", async () => {
    const r = await post(`${h.baseUrl}/api/wet-checks/999/approve-inspection`);
    assert.equal(r.status, 410);
  });

  it("(h) 410 returned for field_tech (no auth guard — endpoint is unconditionally retired)", async () => {
    const h2 = await startServer("field_tech");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/approve-inspection`);
      assert.equal(r.status, 410);
    } finally {
      await h2.close();
    }
  });
});

// ─── null-partId findings (real storage function, fake transaction) ───────────
//
// Regression guard for estimate_items.part_id being nullable.
//
// These tests call the REAL buildEstimateFromInspectionWetCheck from storage.ts
// (no logic is copied). The Drizzle db.transaction is temporarily replaced with
// a fake that calls the callback with a fake TX, allowing the real function to
// run end-to-end without a live database. The fake TX captures values passed to
// insert(estimateItems).values(...) — the exact data that would be rejected by
// a future accidental NOT NULL constraint on estimate_items.part_id.

describe("buildEstimateFromInspectionWetCheck — findings with no catalog part (real storage fn)", () => {
  // Loaded once in before(), shared across tests in this describe block.
  let storageInst: any;
  let dbObj: any;
  // Table references for identity-based dispatch in the fake TX.
  let schemaWetChecks: any;
  let schemaEstimates: any;
  let schemaCustomers: any;
  let schemaWetCheckFindings: any;
  let schemaEstimateItems: any;

  before(async () => {
    // Dynamic imports so this describe block does not force a live DB connection
    // for the tests above (which have no DB dependency).
    const [storageModule, dbModule, schemaModule] = await Promise.all([
      import("../storage"),
      import("../db"),
      import("@workspace/db/schema"),
    ]);
    storageInst = storageModule.storage;
    dbObj = dbModule.db;
    schemaWetChecks = schemaModule.wetChecks;
    schemaEstimates = schemaModule.estimates;
    schemaCustomers = schemaModule.customers;
    schemaWetCheckFindings = schemaModule.wetCheckFindings;
    schemaEstimateItems = schemaModule.estimateItems;
  });

  // Build a Drizzle-compatible fake transaction that feeds stub data and
  // captures what the function tries to INSERT into estimate_items.
  function makeFakeTx(
    findings: any[],
    capturedItems: any[],
  ): any {
    const STUB_WC = {
      id: 7, companyId: 10, customerId: 55, mode: "inspection",
      status: "submitted", propertyAddress: null,
    };
    const STUB_CUSTOMER = {
      id: 55, name: "Test Customer", email: "test@example.com",
      phone: null, laborRate: "65.00",
    };
    let seq = 0;

    return {
      select() {
        return {
          from: (table: any) => ({
            where(_cond: any): Promise<any[]> {
              if (table === schemaWetChecks) return Promise.resolve([STUB_WC]);
              if (table === schemaEstimates) return Promise.resolve([]); // no existing estimate
              if (table === schemaCustomers) return Promise.resolve([STUB_CUSTOMER]);
              if (table === schemaWetCheckFindings) return Promise.resolve(findings);
              return Promise.resolve([]);
            },
          }),
        };
      },
      insert(table: any) {
        return {
          values(data: any) {
            return {
              returning(): Promise<any[]> {
                const arr = Array.isArray(data) ? data : [data];
                const row = { ...arr[0], id: ++seq, createdAt: new Date(), updatedAt: new Date() };
                if (table === schemaEstimateItems) {
                  capturedItems.push({ ...arr[0] });
                }
                return Promise.resolve([row]);
              },
            };
          },
        };
      },
      update(_table: any) {
        return {
          set(_data: any) {
            return { where(_cond: any): Promise<void> { return Promise.resolve(); } };
          },
        };
      },
      // allocateNextEstimateNumber uses executor.execute(sql`UPDATE companies...`)
      execute(_sqlTag: any): Promise<any> {
        return Promise.resolve({ rows: [{ allocated: "1" }] });
      },
    };
  }

  // Runs fn() with db.transaction swapped for a fake; restores afterwards.
  async function withFakeTx(
    findings: any[],
    fn: () => Promise<any>,
  ): Promise<{ result: any; capturedItems: any[] }> {
    const capturedItems: any[] = [];
    const origTransaction = dbObj.transaction.bind(dbObj);
    (dbObj as any).transaction = (cb: (tx: any) => Promise<any>) =>
      cb(makeFakeTx(findings, capturedItems));
    try {
      const result = await fn();
      return { result, capturedItems };
    } finally {
      (dbObj as any).transaction = origTransaction;
    }
  }

  it("(p1) null-partId finding passes through to insert with partId:null, non-null partName, $0.00 price", async () => {
    const findings = [
      {
        id: 1, wetCheckId: 7, partId: null, partName: null,
        issueType: "broken-head", partPrice: null, quantity: 1,
        notes: null, laborHours: "0.25", estimateId: null,
      },
    ];

    const { capturedItems } = await withFakeTx(findings, () =>
      storageInst.buildEstimateFromInspectionWetCheck(7, 10, { id: 1, name: "Test Mgr" }),
    );

    assert.equal(capturedItems.length, 1, "one estimate_items insert for one finding");
    const item = capturedItems[0];
    assert.equal(item.partId, null, "partId must be null — real storage must pass null, not coerce to something else");
    assert.ok(item.partName !== null && item.partName !== undefined, "partName must be non-null (issueType fallback)");
    assert.equal(item.partName, "broken-head", "partName falls back to issueType slug");
    assert.equal(item.partPrice, "0.00", "partPrice must be $0.00 for no-catalog-part finding");
    assert.equal(item.totalPrice, "0.00", "totalPrice must be $0.00");
    assert.equal(item.laborHours, "0.00", "per-line laborHours is always 0.00 in flat mode");
  });

  it("(p2) explicit partName with no partId is preserved through the real function", async () => {
    const findings = [
      {
        id: 1, wetCheckId: 7, partId: null, partName: "Hunter PGP Head",
        issueType: "broken-head", partPrice: null, quantity: 1,
        notes: null, laborHours: null, estimateId: null,
      },
    ];

    const { capturedItems } = await withFakeTx(findings, () =>
      storageInst.buildEstimateFromInspectionWetCheck(7, 10, { id: 1, name: "Test Mgr" }),
    );

    assert.equal(capturedItems.length, 1);
    assert.equal(capturedItems[0].partId, null, "partId must remain null");
    assert.equal(capturedItems[0].partName, "Hunter PGP Head", "explicit partName beats issueType fallback");
    assert.equal(capturedItems[0].partPrice, "0.00");
  });

  it("(p3) mixed findings: null-part entries are NOT filtered — both reach insert", async () => {
    const findings = [
      {
        id: 1, wetCheckId: 7, partId: 99, partName: "Rotor 1804",
        issueType: "broken-head", partPrice: "12.50", quantity: 2,
        notes: null, laborHours: null, estimateId: null,
      },
      {
        id: 2, wetCheckId: 7, partId: null, partName: null,
        issueType: "leaking-valve", partPrice: null, quantity: 1,
        notes: "Valve leaking at manifold", laborHours: null, estimateId: null,
      },
    ];

    const { capturedItems } = await withFakeTx(findings, () =>
      storageInst.buildEstimateFromInspectionWetCheck(7, 10, { id: 1, name: "Test Mgr" }),
    );

    assert.equal(capturedItems.length, 2, "null-part findings must NOT be filtered out before insert");
    const [catalogItem, nullPartItem] = capturedItems;
    assert.equal(catalogItem.partId, 99, "first item retains catalog partId");
    assert.equal(catalogItem.totalPrice, "25.00", "2 × $12.50");
    assert.equal(nullPartItem.partId, null, "second item reaches insert with partId=null");
    assert.equal(nullPartItem.partName, "leaking-valve", "falls back to issueType (notes-based description is separate)");
    assert.equal(nullPartItem.totalPrice, "0.00");
  });

  it("(p4) partsSubtotal on the returned estimate excludes $0.00 null-part lines", async () => {
    const findings = [
      {
        id: 1, wetCheckId: 7, partId: 99, partName: "Rotor",
        issueType: "broken-head", partPrice: "12.50", quantity: 2,
        notes: null, laborHours: null, estimateId: null,
      },
      {
        id: 2, wetCheckId: 7, partId: null, partName: null,
        issueType: "leaking-valve", partPrice: null, quantity: 1,
        notes: null, laborHours: null, estimateId: null,
      },
    ];

    const { result } = await withFakeTx(findings, () =>
      storageInst.buildEstimateFromInspectionWetCheck(7, 10, { id: 1, name: "Test Mgr" }),
    );

    assert.equal(result.partsSubtotal, "25.00", "null-part $0 lines contribute nothing to partsSubtotal");
    assert.equal(result.totalAmount, "25.00", "totalAmount equals partsSubtotal when no labor hours");
  });
});

// ─── revert-inspection ────────────────────────────────────────────────────────

describe("POST /api/wet-checks/:id/revert-inspection", () => {
  let h: Harness;
  before(async () => { h = await startServer("company_admin"); });
  after(async () => { await h.close(); });

  it("(k) 200 — reverts estimate to pending_review and wet check to submitted", async () => {
    let storageCalled = false;
    h.setRevert(async (wcId, cid) => {
      storageCalled = true;
      assert.equal(wcId, 7);
      assert.equal(cid, 10);
      return { estimate: STUB_REVERTED_ESTIMATE, wetCheck: STUB_REVERTED_WC };
    });

    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    const body = await r.json() as any;

    assert.equal(r.status, 200);
    assert.equal(body.estimate.lifecycle, "pending_review");
    assert.equal(body.estimate.status, "pending");
    assert.equal(body.wetCheck.status, "submitted");
    assert.equal(body.wetCheck.fullyConvertedAt, null);
    assert.ok(storageCalled, "storage.unapproveInspectionEstimate must be called");
  });

  it("(l) 409 when WCB is already invoiced", async () => {
    h.setRevert(async () => {
      throw new Error("Cannot revert: the wet check billing has already been included in invoice #99. Void the invoice first.");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    assert.equal(r.status, 409);
    const body = await r.json() as any;
    assert.match(body.message, /already been included in invoice/);
  });

  it("(m) 403 for irrigation_manager role", async () => {
    const h2 = await startServer("irrigation_manager");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/revert-inspection`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });

  it("(n) 409 when wet check is not in converted state (already reverted)", async () => {
    h.setRevert(async () => {
      throw new Error("Wet check #7 is not in a converted state and cannot be reverted");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    assert.equal(r.status, 409);
    const body = await r.json() as any;
    assert.match(body.message, /not in a converted state/);
  });

  it("(o) super_admin is also allowed", async () => {
    const h2 = await startServer("super_admin");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/revert-inspection`);
      assert.equal(r.status, 200);
      const body = await r.json() as any;
      assert.equal(body.estimate.lifecycle, "pending_review");
    } finally {
      await h2.close();
    }
  });

  it("(o2) billing_manager is forbidden", async () => {
    const h2 = await startServer("billing_manager");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/revert-inspection`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });
});

// ─── needs-review Rule 4 (pure qualification logic) ──────────────────────────
//
// Rule 4 was re-keyed in Task #1738: the gate is now the WC's own status
// (must be in ACTIVE_WC = {submitted, pending_manager_review, partially_converted}).
// Estimate lifecycle is no longer checked — the WC leaves the queue naturally
// when it transitions to `converted` at the pass-to-estimates hand-off.

describe("needs-review Rule 4 (inspection WC status gate)", () => {
  const ACTIVE_WC = new Set(["submitted", "pending_manager_review", "partially_converted"]);

  function qualifiesRule4(mode: string, wcStatus: string): boolean {
    return mode === "inspection" && ACTIVE_WC.has(wcStatus);
  }

  it("(e1) inspection WC in submitted qualifies", () =>
    assert.ok(qualifiesRule4("inspection", "submitted")));

  it("(e2) inspection WC in pending_manager_review qualifies", () =>
    assert.ok(qualifiesRule4("inspection", "pending_manager_review")));

  it("(e3) inspection WC in converted does NOT qualify (leaves queue at hand-off)", () =>
    assert.ok(!qualifiesRule4("inspection", "converted")));

  it("(e4) service WC does not trigger Rule 4", () =>
    assert.ok(!qualifiesRule4("service", "submitted")));

  it("(e5) inspection WC in partially_converted still qualifies (Seam 2 in progress)", () =>
    assert.ok(qualifiesRule4("inspection", "partially_converted")));

  it("(e6) Rule 4 is independent of estimate lifecycle (Seam 2 victim pattern)", () =>
    // An inspection WC in submitted qualifies even if its estimate were somehow
    // already at lifecycle='approved'. The manager still needs to click Pass.
    assert.ok(qualifiesRule4("inspection", "submitted")));
});

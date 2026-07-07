/**
 * Route-level tests for Task #1738 — Inspection Flow: Pass to Estimates
 *
 * Covers:
 *   POST /api/wet-checks/:id/pass-to-estimates        (new endpoint)
 *   POST /api/wet-checks/:id/approve-inspection       (410 tombstone)
 *   POST /api/wet-checks/:id/revert-inspection        (updated semantics)
 *   Needs Review Rule 4 re-key (WC status, not estimate lifecycle)
 *
 * Pattern: express mini-server with spy storage, same pattern as the
 * existing wet-check-inspection-estimate.test.ts.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ─── Stubs ────────────────────────────────────────────────────────────────────

const STUB_ESTIMATE_PENDING = {
  id: 42,
  estimateNumber: "EST-0042",
  lifecycle: "pending_review",
  status: "pending",
  internalStatus: "pending_approval",
  approvedAt: null as string | null,
  originWetCheckId: 7,
  items: [{ id: 1, description: "Broken head", quantity: 1, partPrice: "25.00", totalPrice: "25.00" }],
  partsSubtotal: "25.00",
  laborSubtotal: "0.00",
  totalAmount: "25.00",
  totalLaborHours: "0.00",
  laborRate: "65.00",
};

// Post-pass state: internalStatus='approved_internal', status/lifecycle/approvedAt UNCHANGED.
const STUB_ESTIMATE_PASSED = {
  ...STUB_ESTIMATE_PENDING,
  internalStatus: "approved_internal",
};

const STUB_WC_CONVERTED = {
  id: 7,
  mode: "inspection",
  status: "converted",
  companyId: 10,
  fullyConvertedAt: new Date().toISOString(),
};

const STUB_WC_SUBMITTED = {
  id: 7,
  mode: "inspection",
  status: "submitted",
  companyId: 10,
  fullyConvertedAt: null as string | null,
};

const STUB_REVERTED_ESTIMATE = {
  ...STUB_ESTIMATE_PENDING,
  internalStatus: "pending_approval",
};

const STUB_REVERTED_WC = { ...STUB_WC_SUBMITTED, status: "submitted", fullyConvertedAt: null };

// ─── Harness ──────────────────────────────────────────────────────────────────

type PassFn = (wcId: number, cid: number) => Promise<{ estimate: typeof STUB_ESTIMATE_PASSED; wetCheck: typeof STUB_WC_CONVERTED }>;
type RevertFn = (wcId: number, cid: number) => Promise<{ estimate: typeof STUB_REVERTED_ESTIMATE; wetCheck: typeof STUB_REVERTED_WC }>;

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  setPass: (fn: PassFn) => void;
  setRevert: (fn: RevertFn) => void;
}

const MANAGER_ROLES = new Set(["super_admin", "company_admin", "irrigation_manager", "billing_manager"]);
const REVERT_ALLOWED_ROLES = new Set(["super_admin", "company_admin"]);
const COMPANY_ID = 10;

async function startServer(role = "irrigation_manager", companyId = COMPANY_ID): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  let passFn: PassFn = async () => ({ estimate: STUB_ESTIMATE_PASSED, wetCheck: STUB_WC_CONVERTED });
  let revertFn: RevertFn = async () => ({ estimate: STUB_REVERTED_ESTIMATE, wetCheck: STUB_REVERTED_WC });

  const auth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 1;
    (req as any).authenticatedUserCompanyId = companyId;
    (req as any).authenticatedUserRole = role;
    (req as any).log = { error: () => {} };
    next();
  };

  // POST /api/wet-checks/:id/pass-to-estimates
  app.post("/api/wet-checks/:id/pass-to-estimates", auth, async (req: any, res) => {
    if (!MANAGER_ROLES.has(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const wcId = parseInt(req.params.id);
    if (isNaN(wcId)) { res.status(400).json({ message: "Invalid wet check id" }); return; }
    if (req.authenticatedUserCompanyId !== COMPANY_ID) { res.status(404).json({ message: "Wet check not found" }); return; }
    try {
      const result = await passFn(wcId, req.authenticatedUserCompanyId);
      res.json(result);
    } catch (e: any) {
      const msg: string = e.message ?? "Internal error";
      const status =
        msg.includes("not in pending_approval state") || msg.includes("not in a pending state") ? 409 :
        msg.includes("not found") ? 404 :
        msg.includes("not an inspection") ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });

  // POST /api/wet-checks/:id/approve-inspection — 410 tombstone
  app.post("/api/wet-checks/:id/approve-inspection", (_req, res) => {
    res.status(410).json({
      message: "This endpoint has been retired. Use POST /api/wet-checks/:id/pass-to-estimates instead.",
      replacedBy: "/api/wet-checks/:id/pass-to-estimates",
    });
  });

  // POST /api/wet-checks/:id/revert-inspection
  app.post("/api/wet-checks/:id/revert-inspection", auth, async (req: any, res) => {
    if (!REVERT_ALLOWED_ROLES.has(req.authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden. Reverting an inspection hand-off requires company_admin or super_admin." });
      return;
    }
    const wcId = parseInt(req.params.id);
    if (isNaN(wcId)) { res.status(400).json({ message: "Invalid wet check id" }); return; }
    try {
      const result = await revertFn(wcId, req.authenticatedUserCompanyId);
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
    setPass: (fn) => { passFn = fn; },
    setRevert: (fn) => { revertFn = fn; },
  };
}

function post(url: string) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

// ─── pass-to-estimates route ──────────────────────────────────────────────────

describe("POST /api/wet-checks/:id/pass-to-estimates", () => {
  let h: Harness;
  before(async () => { h = await startServer("irrigation_manager"); });
  after(async () => { await h.close(); });

  it("(a) calls storage.passInspectionToEstimates and returns estimate+wetCheck", async () => {
    let storageCalled = false;
    h.setPass(async (wcId, cid) => {
      storageCalled = true;
      assert.equal(wcId, 7);
      assert.equal(cid, 10);
      return { estimate: STUB_ESTIMATE_PASSED, wetCheck: STUB_WC_CONVERTED };
    });

    const r = await post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`);
    const body = await r.json() as any;

    assert.equal(r.status, 200, "expected 200");
    assert.ok(storageCalled, "storage must be called");
    assert.equal(body.estimate.internalStatus, "approved_internal", "estimate at approved_internal");
    assert.equal(body.estimate.lifecycle, "pending_review", "lifecycle untouched (not 'approved')");
    assert.equal(body.estimate.approvedAt, null, "approvedAt must be null — not customer-approved");
    assert.equal(body.wetCheck.status, "converted", "WC status = converted");
  });

  it("(b) not-in-pending-approval maps to 409", async () => {
    h.setPass(async () => {
      throw new Error("Estimate for wet check #7 is not in pending_approval state and cannot be passed to estimates");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`);
    assert.equal(r.status, 409, "expected 409 for state conflict");
  });

  it("(c) not-an-inspection error maps to 400", async () => {
    h.setPass(async () => { throw new Error("Wet check #7 is not an inspection wet check"); });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`);
    assert.equal(r.status, 400);
  });

  it("(d) not-found error maps to 404", async () => {
    h.setPass(async () => { throw new Error("Wet check #7 not found"); });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`);
    assert.equal(r.status, 404);
  });

  it("(e) field_tech is forbidden (403)", async () => {
    const h2 = await startServer("field_tech");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/pass-to-estimates`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });

  it("(f) billing_manager is allowed (manager-tier role)", async () => {
    const h2 = await startServer("billing_manager");
    try {
      let called = false;
      h2.setPass(async () => { called = true; return { estimate: STUB_ESTIMATE_PASSED, wetCheck: STUB_WC_CONVERTED }; });
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/pass-to-estimates`);
      assert.equal(r.status, 200);
      assert.ok(called);
    } finally {
      await h2.close();
    }
  });

  it("(g) idempotency: already-converted WC returns current state (200, not 409)", async () => {
    h.setPass(async () => {
      // Storage returns stable state — WC already converted, estimate already approved_internal.
      return { estimate: STUB_ESTIMATE_PASSED, wetCheck: STUB_WC_CONVERTED };
    });

    const [r1, r2] = await Promise.all([
      post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`),
      post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]) as any[];

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(b1.estimate.id, b2.estimate.id, "same estimate returned on both calls");
  });

  it("(h) Seam 2 self-heal: customer-approved estimate still converts WC — WC returns converted", async () => {
    h.setPass(async () => {
      // Seam 2 path: estimate is lifecycle='approved' but WC was stranded as submitted.
      // Storage self-heals and converts the WC; estimate is returned as-is (approved).
      const seam2Estimate = {
        ...STUB_ESTIMATE_PENDING,
        internalStatus: "approved_internal",
        lifecycle: "approved",
        status: "approved",
      };
      return { estimate: seam2Estimate, wetCheck: STUB_WC_CONVERTED };
    });

    const r = await post(`${h.baseUrl}/api/wet-checks/7/pass-to-estimates`);
    const body = await r.json() as any;

    assert.equal(r.status, 200, "self-heal must succeed (200, not 409)");
    assert.equal(body.wetCheck.status, "converted", "WC must be converted after self-heal");
  });
});

// ─── approve-inspection 410 tombstone ────────────────────────────────────────

describe("POST /api/wet-checks/:id/approve-inspection (retired)", () => {
  let h: Harness;
  before(async () => { h = await startServer("irrigation_manager"); });
  after(async () => { await h.close(); });

  it("(i) returns 410 Gone regardless of role", async () => {
    const r = await post(`${h.baseUrl}/api/wet-checks/7/approve-inspection`);
    assert.equal(r.status, 410, "retired endpoint must return 410");
    const body = await r.json() as any;
    assert.match(body.message, /retired|pass-to-estimates/i, "410 body must mention replacement");
    assert.ok(typeof body.replacedBy === "string", "replacedBy field must be present");
  });

  it("(j) 410 returned for field_tech too (no auth check needed — endpoint is unconditionally retired)", async () => {
    const h2 = await startServer("field_tech");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/approve-inspection`);
      assert.equal(r.status, 410);
    } finally {
      await h2.close();
    }
  });
});

// ─── revert-inspection updated semantics ─────────────────────────────────────

describe("POST /api/wet-checks/:id/revert-inspection (updated)", () => {
  let h: Harness;
  before(async () => { h = await startServer("company_admin"); });
  after(async () => { await h.close(); });

  it("(k) 200 — reverts hand-off: estimate at pending_approval, WC at submitted", async () => {
    let called = false;
    h.setRevert(async (wcId, cid) => {
      called = true;
      assert.equal(wcId, 7);
      assert.equal(cid, COMPANY_ID);
      return { estimate: STUB_REVERTED_ESTIMATE, wetCheck: STUB_REVERTED_WC };
    });

    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    const body = await r.json() as any;

    assert.equal(r.status, 200);
    assert.ok(called);
    assert.equal(body.estimate.internalStatus, "pending_approval", "estimate back to pending_approval");
    assert.equal(body.estimate.lifecycle, "pending_review", "lifecycle untouched (still pending_review)");
    assert.equal(body.estimate.approvedAt, null, "approvedAt still null — was never set");
    assert.equal(body.wetCheck.status, "submitted", "WC back to submitted");
    assert.equal(body.wetCheck.fullyConvertedAt, null, "fullyConvertedAt cleared");
  });

  it("(l) 409 when estimate has been sent to customer", async () => {
    h.setRevert(async () => {
      throw new Error("Cannot revert: estimate for wet check #7 has already been sent to the customer or acted upon. The hand-off cannot be undone at this stage.");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    assert.equal(r.status, 409);
    const body = await r.json() as any;
    assert.match(body.message, /Cannot revert:/);
  });

  it("(m) 409 when WCB is already invoiced", async () => {
    h.setRevert(async () => {
      throw new Error("Cannot revert: the wet check billing has already been included in invoice #99. Void the invoice first.");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    assert.equal(r.status, 409);
    const body = await r.json() as any;
    assert.match(body.message, /already been included in invoice/);
  });

  it("(n) 409 when WC is not in converted state", async () => {
    h.setRevert(async () => {
      throw new Error("Wet check #7 is not in a converted state and cannot be reverted");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    assert.equal(r.status, 409);
  });

  it("(o) 409 when estimate is not in approved_internal state", async () => {
    h.setRevert(async () => {
      throw new Error("Estimate for wet check #7 is not in approved_internal state and cannot be reverted");
    });
    const r = await post(`${h.baseUrl}/api/wet-checks/7/revert-inspection`);
    assert.equal(r.status, 409);
  });

  it("(p) 403 for irrigation_manager", async () => {
    const h2 = await startServer("irrigation_manager");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/revert-inspection`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });

  it("(q) 403 for billing_manager", async () => {
    const h2 = await startServer("billing_manager");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/revert-inspection`);
      assert.equal(r.status, 403);
    } finally {
      await h2.close();
    }
  });

  it("(r) super_admin is allowed", async () => {
    const h2 = await startServer("super_admin");
    try {
      const r = await post(`${h2.baseUrl}/api/wet-checks/7/revert-inspection`);
      assert.equal(r.status, 200);
    } finally {
      await h2.close();
    }
  });
});

// ─── Needs Review Rule 4 re-key ───────────────────────────────────────────────
//
// The rule now keys on WC status in ACTIVE_WC (not estimate lifecycle).
// `converted` is in APPROVED_WC but not ACTIVE_WC, so the WC leaves the queue
// at hand-off rather than waiting for lifecycle='approved'.

describe("needs-review Rule 4 re-key (WC status, not estimate lifecycle)", () => {
  const ACTIVE_WC = new Set(["submitted", "pending_manager_review", "partially_converted"]);

  function qualifiesRule4(mode: string, wcStatus: string): boolean {
    return mode === "inspection" && ACTIVE_WC.has(wcStatus);
  }

  it("(s1) inspection WC in submitted qualifies", () =>
    assert.ok(qualifiesRule4("inspection", "submitted")));

  it("(s2) inspection WC in pending_manager_review qualifies", () =>
    assert.ok(qualifiesRule4("inspection", "pending_manager_review")));

  it("(s3) inspection WC in converted does NOT qualify (leaves queue at hand-off)", () =>
    assert.ok(!qualifiesRule4("inspection", "converted")));

  it("(s4) inspection WC in approved does NOT qualify", () =>
    assert.ok(!qualifiesRule4("inspection", "approved")));

  it("(s5) service-mode WC never triggers Rule 4", () =>
    assert.ok(!qualifiesRule4("service", "submitted")));

  it("(s6) Rule 4 is independent of estimate lifecycle — an inspection WC in submitted qualifies regardless", () =>
    // Even if estimate.lifecycle were 'approved' (Seam 2 victim), Rule 4 fires
    // because WC status is still submitted. This is the correct queue behaviour:
    // the manager still needs to click Pass to Estimates to convert the WC.
    assert.ok(qualifiesRule4("inspection", "submitted")));
});

// ─── Cross-company isolation ──────────────────────────────────────────────────

describe("pass-to-estimates cross-company isolation", () => {
  it("(t1) company B cannot pass/revert company A wet check (404)", async () => {
    // Server for company 99 (wrong company).
    const hWrongCompany = await startServer("irrigation_manager", 99);
    try {
      hWrongCompany.setPass(async () => {
        throw new Error("Wet check #7 not found");
      });

      const r = await post(`${hWrongCompany.baseUrl}/api/wet-checks/7/pass-to-estimates`);
      assert.equal(r.status, 404, "cross-company access must return 404 (same as not found)");
    } finally {
      await hWrongCompany.close();
    }
  });
});

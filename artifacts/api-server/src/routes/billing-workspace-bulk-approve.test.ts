// Task #1083 — Unit tests for the bulk-approve endpoint.
//
// Mounts the POST /api/billing-workspace/bulk-approve handler against
// in-memory storage stubs and exercises:
//   (a) Role guard — 403 for field_tech; 200 for billing_manager,
//       company_admin, super_admin, irrigation_manager.
//   (b) Empty / missing items body → 400.
//   (c) Happy-path billing_sheet, work_order, wet_check_billing.
//   (d) Skip reasons: not_found, status_not_active, already_invoiced.
//   (e) transition_failed — storage throws.
//   (f) Mixed batch returns correct approved/skipped counts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { registerBillingWorkspaceBulkApproveRoutes } from "./billing-workspace-bulk-approve";
import { storage } from "../storage";

const ORIG: Record<string, any> = {};
function patch(name: string, impl: any) {
  ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restoreAll() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
  for (const k of Object.keys(ORIG)) delete ORIG[k];
}

function makeAuth(role: string, companyId: number | null = 1): RequestHandler {
  return (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserId = 1;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
}

function buildApp(role: string, companyId: number | null = 1): Express {
  const app = express();
  app.use(express.json());
  const auth = makeAuth(role, companyId);
  registerBillingWorkspaceBulkApproveRoutes(app, { requireAuthentication: auth });
  return app;
}

const BS = {
  id: 1,
  status: "submitted",
  invoiceId: null,
  totalAmount: "500.00",
  partsSubtotal: "100.00",
  laborSubtotal: "400.00",
  totalHours: "4.00",
  laborRate: "100.00",
};
const WO = {
  id: 2,
  status: "work_completed",
  invoiceId: null,
  totalAmount: "300.00",
  partsSubtotal: "50.00",
  laborSubtotal: "250.00",
  totalHours: "2.5",
  laborRate: "100.00",
};
const WCB = {
  id: 3,
  status: "submitted",
  invoiceId: null,
  totalAmount: "200.00",
  partsSubtotal: "0.00",
  laborSubtotal: "200.00",
  totalHours: "2.00",
  laborRate: "100.00",
};

async function post(app: Express, body: unknown) {
  const server = createServer(app);
  await new Promise<void>((res) => server.listen(0, res));
  const { port } = server.address() as AddressInfo;
  try {
    const r = await fetch(`http://localhost:${port}/api/billing-workspace/bulk-approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() as Record<string, any> };
  } finally {
    server.close();
  }
}

describe("POST /api/billing-workspace/bulk-approve", () => {
  it("returns 403 for field_tech", async () => {
    const app = buildApp("field_tech");
    const { status } = await post(app, { items: [] });
    assert.equal(status, 403);
  });

  it("returns 400 for missing items", async () => {
    const app = buildApp("billing_manager");
    const { status } = await post(app, {});
    assert.equal(status, 400);
  });

  it("returns 400 for empty items array", async () => {
    const app = buildApp("billing_manager");
    const { status } = await post(app, { items: [] });
    assert.equal(status, 400);
  });

  it("approves a billing_sheet — happy path", async () => {
    patch("getBillingSheetById", async () => ({ ...BS }));
    patch("updateBillingSheet", async () => undefined);
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, {
        items: [{ type: "billing_sheet", id: 1 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 1);
      assert.deepEqual(body.skipped, []);
    } finally {
      restoreAll();
    }
  });

  it("approves a work_order — happy path", async () => {
    patch("getWorkOrder", async () => ({ ...WO }));
    patch("updateWorkOrder", async () => undefined);
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("company_admin");
      const { status, body } = await post(app, {
        items: [{ type: "work_order", id: 2 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 1);
      assert.deepEqual(body.skipped, []);
    } finally {
      restoreAll();
    }
  });

  it("approves a wet_check_billing — happy path", async () => {
    patch("getWetCheckBillingById", async () => ({ ...WCB }));
    patch("updateWetCheckBilling", async () => undefined);
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("irrigation_manager");
      const { status, body } = await post(app, {
        items: [{ type: "wet_check_billing", id: 3 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 1);
      assert.deepEqual(body.skipped, []);
    } finally {
      restoreAll();
    }
  });

  it("skips not_found items", async () => {
    patch("getBillingSheetById", async () => null);
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, {
        items: [{ type: "billing_sheet", id: 99 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 0);
      assert.equal(body.skipped.length, 1);
      assert.equal(body.skipped[0].reason, "not_found");
    } finally {
      restoreAll();
    }
  });

  it("skips already_invoiced items", async () => {
    patch("getBillingSheetById", async () => ({ ...BS, invoiceId: 42 }));
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, {
        items: [{ type: "billing_sheet", id: 1 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 0);
      assert.equal(body.skipped[0].reason, "already_invoiced");
    } finally {
      restoreAll();
    }
  });

  it("skips status_not_active items", async () => {
    patch("getWorkOrder", async () => ({ ...WO, status: "draft" }));
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("company_admin");
      const { status, body } = await post(app, {
        items: [{ type: "work_order", id: 2 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 0);
      assert.equal(body.skipped[0].reason, "status_not_active");
    } finally {
      restoreAll();
    }
  });

  it("handles transition_failed — storage throws", async () => {
    patch("getBillingSheetById", async () => ({ ...BS }));
    patch("updateBillingSheet", async () => { throw new Error("db error"); });
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, {
        items: [{ type: "billing_sheet", id: 1 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 0);
      assert.ok(body.skipped[0].reason.startsWith("transition_failed"));
    } finally {
      restoreAll();
    }
  });

  it("mixed batch — some approved, some skipped", async () => {
    patch("getBillingSheetById", async (id: number) =>
      id === 1 ? { ...BS } : null
    );
    patch("getWorkOrder", async () => ({ ...WO, status: "draft" }));
    patch("updateBillingSheet", async () => undefined);
    patch("getUser", async () => ({ name: "Manager" }));
    try {
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, {
        items: [
          { type: "billing_sheet", id: 1 },  // should approve
          { type: "billing_sheet", id: 99 }, // not_found
          { type: "work_order", id: 2 },     // status_not_active (draft)
        ],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 1);
      assert.equal(body.skipped.length, 2);
    } finally {
      restoreAll();
    }
  });

  it("super_admin (companyId=null) is allowed", async () => {
    patch("getBillingSheetById", async () => ({ ...BS }));
    patch("updateBillingSheet", async () => undefined);
    patch("getUser", async () => ({ name: "SA" }));
    try {
      const app = buildApp("super_admin", null);
      const { status, body } = await post(app, {
        items: [{ type: "billing_sheet", id: 1 }],
      });
      assert.equal(status, 200);
      assert.equal(body.approved, 1);
    } finally {
      restoreAll();
    }
  });
});

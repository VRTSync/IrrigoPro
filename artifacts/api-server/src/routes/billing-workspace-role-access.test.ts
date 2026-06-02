// Task #1083 — Billing Workspace role-access regression tests.
//
// Covers:
//   (a) BW_ROLES includes irrigation_manager — the queue endpoint returns 200
//       (not 403) for that role.
//   (b) field_tech still gets 403 from the queue endpoint.
//   (c) ACTIVE_BS, ACTIVE_WO, ACTIVE_WCB are exported (parity guard).
//   (d) registerBillingWorkspaceRoutes and
//       registerBillingWorkspaceBulkApproveRoutes are both called from routes.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerBillingWorkspaceRoutes,
  ACTIVE_BS,
  ACTIVE_WO,
  ACTIVE_WCB,
} from "./billing-workspace-routes";
import { registerBillingWorkspaceBulkApproveRoutes } from "./billing-workspace-bulk-approve";
import { storage } from "../storage";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAuth(role: string, companyId: number | null = 1): RequestHandler {
  return (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserId = 1;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
}

function buildApp(role: string) {
  const app = express();
  app.use(express.json());
  const auth = makeAuth(role);
  registerBillingWorkspaceRoutes(app, { requireAuthentication: auth });
  registerBillingWorkspaceBulkApproveRoutes(app, { requireAuthentication: auth });
  return app;
}

// Minimal storage stubs so the queue handler can complete without a real DB.
const ORIG: Record<string, any> = {};
function patch(name: string, impl: any) {
  ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restoreAll() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
  for (const k of Object.keys(ORIG)) delete ORIG[k];
}

async function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

// ── (a) irrigation_manager gets 200 from the queue endpoint ──────────────────

describe("billing-workspace-routes — irrigation_manager access", () => {
  it("GET /api/billing-workspace/queue returns 200 for irrigation_manager", async () => {
    patch("getBillingSheets", async () => []);
    patch("getWetCheckBillings", async () => []);
    patch("getWorkOrders", async () => []);
    patch("getCustomers", async () => []);
    patch("getUsers", async () => []);

    const { url, server } = await listen(buildApp("irrigation_manager"));
    try {
      const res = await fetch(
        `${url}/api/billing-workspace/queue?pageSize=1`,
      );
      assert.equal(res.status, 200, "irrigation_manager should get 200 from the queue");
    } finally {
      await close(server);
      restoreAll();
    }
  });

  it("GET /api/billing-workspace/queue returns 403 for field_tech", async () => {
    const { url, server } = await listen(buildApp("field_tech"));
    try {
      const res = await fetch(`${url}/api/billing-workspace/queue?pageSize=1`);
      assert.equal(res.status, 403, "field_tech should get 403");
    } finally {
      await close(server);
    }
  });
});

// ── approved drill-down: ?status=approved_passed_to_billing returns items ─────

describe("billing-workspace-routes — approved drill-down data visibility", () => {
  it("GET /api/billing-workspace/queue?status=approved_passed_to_billing returns approved WCB rows", async () => {
    const approvedWcb = {
      id: 99,
      status: "approved_passed_to_billing",
      customerId: 1,
      customerName: "Acme",
      technicianId: 1,
      technicianName: "Tech One",
      totalAmount: "250.00",
      billingNumber: "WCB-099",
      createdAt: new Date().toISOString(),
      wetCheckId: null,
    };
    // Only the approved WCB row; no ACTIVE rows.
    // scopedWetCheckBillings uses storage.getCustomer (singular) for company scope.
    patch("getAllWetCheckBillingsWithCounts", async () => [approvedWcb]);
    patch("getAllBillingSheets", async () => []);
    patch("getWorkOrders", async () => []);
    patch("getCustomer", async (id: number) => id === 1 ? { id: 1, companyId: 1 } : null);
    patch("getUsers", async () => []);

    const { url, server } = await listen(buildApp("billing_manager", 1));
    try {
      const res = await fetch(
        `${url}/api/billing-workspace/queue?status=approved_passed_to_billing&pageSize=50`,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: any[]; total: number };
      assert.ok(
        body.items.some(
          (it: any) => it.type === "wet_check_billing" && it.status === "approved_passed_to_billing",
        ),
        "Expected at least one approved_passed_to_billing WCB item in the queue response",
      );
    } finally {
      await close(server);
      restoreAll();
    }
  });

  it("GET /api/billing-workspace/queue without status filter excludes approved items", async () => {
    const approvedWcb = {
      id: 99,
      status: "approved_passed_to_billing",
      customerId: 1,
      customerName: "Acme",
      technicianId: 1,
      technicianName: "Tech One",
      totalAmount: "250.00",
      billingNumber: "WCB-099",
      createdAt: new Date().toISOString(),
      wetCheckId: null,
    };
    patch("getAllWetCheckBillingsWithCounts", async () => [approvedWcb]);
    patch("getAllBillingSheets", async () => []);
    patch("getWorkOrders", async () => []);
    patch("getCustomer", async (id: number) => id === 1 ? { id: 1, companyId: 1 } : null);
    patch("getUsers", async () => []);

    const { url, server } = await listen(buildApp("billing_manager", 1));
    try {
      const res = await fetch(`${url}/api/billing-workspace/queue?pageSize=50`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { items: any[]; total: number };
      assert.ok(
        !body.items.some((it: any) => it.status === "approved_passed_to_billing"),
        "Default queue must not include approved items",
      );
    } finally {
      await close(server);
      restoreAll();
    }
  });
});

// ── (b) ACTIVE_BS / ACTIVE_WO / ACTIVE_WCB exports exist and are non-empty ──

describe("billing-workspace-routes — ACTIVE_* status set exports", () => {
  it("ACTIVE_BS is a non-empty Set", () => {
    assert.ok(ACTIVE_BS instanceof Set, "ACTIVE_BS should be a Set");
    assert.ok(ACTIVE_BS.size > 0, "ACTIVE_BS should have at least one entry");
  });

  it("ACTIVE_WO is a non-empty Set", () => {
    assert.ok(ACTIVE_WO instanceof Set);
    assert.ok(ACTIVE_WO.size > 0);
  });

  it("ACTIVE_WCB is a non-empty Set", () => {
    assert.ok(ACTIVE_WCB instanceof Set);
    assert.ok(ACTIVE_WCB.size > 0);
  });
});

// ── (c) routes.ts registers both billing-workspace route modules ──────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(import.meta.dirname, "./routes.ts"), "utf8");

describe("routes.ts — billing-workspace route registrations", () => {
  it("registerBillingWorkspaceRoutes is imported and called in routes.ts", () => {
    assert.ok(
      routesSrc.includes("registerBillingWorkspaceRoutes(app"),
      "routes.ts must call registerBillingWorkspaceRoutes(app, ...)",
    );
  });

  it("registerBillingWorkspaceBulkApproveRoutes is imported and called in routes.ts", () => {
    assert.ok(
      routesSrc.includes("registerBillingWorkspaceBulkApproveRoutes(app"),
      "routes.ts must call registerBillingWorkspaceBulkApproveRoutes(app, ...)",
    );
  });
});

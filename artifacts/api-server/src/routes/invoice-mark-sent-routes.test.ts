// Task #1438 — HTTP tests for POST /api/invoices/:id/mark-sent and
// POST /api/invoices/:id/mark-unsent.
//
// Mounts the routes against in-memory storage stubs and exercises the role
// guard, company scoping, the status preconditions (only generated → sent,
// only sent → generated), and the happy paths (status + sentAt are written
// through storage.updateInvoice).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { registerInvoiceMarkSentRoutes } from "./invoice-mark-sent-routes";
import { storage } from "../storage";

const ORIG: Record<string, any> = {};
function patch(name: string, impl: any) {
  if (!(name in ORIG)) ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restoreAll() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
  for (const k of Object.keys(ORIG)) delete ORIG[k];
}

function makeAuth(role: string, companyId: number | null = 1): RequestHandler {
  return (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserId = 7;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
}

// Mirror of routes.ts requireBillingAccess.
const requireBillingAccess: RequestHandler = (req: any, res, next) => {
  const role = req.authenticatedUserRole;
  if (role !== "company_admin" && role !== "billing_manager") {
    res.status(403).json({ message: "Access denied." });
    return;
  }
  next();
};

function buildApp(role: string, companyId: number | null = 1): Express {
  const app = express();
  app.use(express.json());
  registerInvoiceMarkSentRoutes(app, {
    requireAuthentication: makeAuth(role, companyId),
    requireBillingAccess,
  });
  return app;
}

async function post(app: Express, path: string) {
  const server = createServer(app);
  await new Promise<void>((res) => server.listen(0, res));
  const { port } = server.address() as AddressInfo;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    let body: Record<string, any> = {};
    try {
      body = (await r.json()) as Record<string, any>;
    } catch {
      body = {};
    }
    return { status: r.status, body };
  } finally {
    server.close();
  }
}

function invoice(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    invoiceNumber: "INV-1",
    customerId: 100,
    companyId: 1,
    invoiceMonth: 6,
    invoiceYear: 2026,
    status: "generated",
    sentAt: null,
    partsSubtotal: "100.00",
    laborSubtotal: "200.00",
    totalAmount: "300.00",
    items: [],
    ...overrides,
  };
}

// getInvoiceById stub honoring company scope; updateInvoice stub records the
// last patch and returns the merged row.
function stubStorage(rows: Record<number, any>) {
  const calls: { id: number; patch: any }[] = [];
  patch("getInvoiceById", async (id: number, companyId: number | null) => {
    const row = rows[id];
    if (!row) return undefined;
    if (companyId !== null && row.companyId !== companyId) return undefined;
    return row;
  });
  patch("updateInvoice", async (id: number, p: any) => {
    calls.push({ id, patch: p });
    rows[id] = { ...rows[id], ...p };
    return rows[id];
  });
  return calls;
}

describe("POST /api/invoices/:id/mark-sent", () => {
  it("returns 403 for field_tech (and never touches storage)", async () => {
    try {
      const calls = stubStorage({ 1: invoice() });
      const app = buildApp("field_tech");
      const { status } = await post(app, "/api/invoices/1/mark-sent");
      assert.equal(status, 403);
      assert.equal(calls.length, 0);
    } finally {
      restoreAll();
    }
  });

  it("returns 403 for irrigation_manager", async () => {
    try {
      stubStorage({ 1: invoice() });
      const app = buildApp("irrigation_manager");
      const { status } = await post(app, "/api/invoices/1/mark-sent");
      assert.equal(status, 403);
    } finally {
      restoreAll();
    }
  });

  it("flips a generated invoice to sent and stamps sentAt", async () => {
    try {
      const calls = stubStorage({ 1: invoice({ status: "generated" }) });
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, "/api/invoices/1/mark-sent");
      assert.equal(status, 200);
      assert.equal(body.status, "sent");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].patch.status, "sent");
      assert.ok(calls[0].patch.sentAt instanceof Date);
    } finally {
      restoreAll();
    }
  });

  it("rejects a non-generated invoice with 400 (no write)", async () => {
    for (const st of ["draft", "sent", "paid", "cancelled"]) {
      try {
        const calls = stubStorage({ 1: invoice({ status: st }) });
        const app = buildApp("company_admin");
        const { status } = await post(app, "/api/invoices/1/mark-sent");
        assert.equal(status, 400, `expected 400 for status=${st}`);
        assert.equal(calls.length, 0);
      } finally {
        restoreAll();
      }
    }
  });

  it("returns 404 for a cross-tenant invoice", async () => {
    try {
      stubStorage({ 1: invoice({ companyId: 999 }) });
      const app = buildApp("billing_manager", 1);
      const { status } = await post(app, "/api/invoices/1/mark-sent");
      assert.equal(status, 404);
    } finally {
      restoreAll();
    }
  });

  it("returns 400 for an invalid id", async () => {
    try {
      stubStorage({});
      const app = buildApp("billing_manager");
      const { status } = await post(app, "/api/invoices/0/mark-sent");
      assert.equal(status, 400);
    } finally {
      restoreAll();
    }
  });
});

describe("POST /api/invoices/:id/mark-unsent", () => {
  it("returns 403 for field_tech", async () => {
    try {
      stubStorage({ 1: invoice({ status: "sent" }) });
      const app = buildApp("field_tech");
      const { status } = await post(app, "/api/invoices/1/mark-unsent");
      assert.equal(status, 403);
    } finally {
      restoreAll();
    }
  });

  it("reverts a sent invoice to generated and clears sentAt", async () => {
    try {
      const calls = stubStorage({
        1: invoice({ status: "sent", sentAt: new Date() }),
      });
      const app = buildApp("billing_manager");
      const { status, body } = await post(app, "/api/invoices/1/mark-unsent");
      assert.equal(status, 200);
      assert.equal(body.status, "generated");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].patch.status, "generated");
      assert.equal(calls[0].patch.sentAt, null);
    } finally {
      restoreAll();
    }
  });

  it("rejects a non-sent invoice with 400 (no write)", async () => {
    for (const st of ["draft", "generated", "paid", "cancelled"]) {
      try {
        const calls = stubStorage({ 1: invoice({ status: st }) });
        const app = buildApp("company_admin");
        const { status } = await post(app, "/api/invoices/1/mark-unsent");
        assert.equal(status, 400, `expected 400 for status=${st}`);
        assert.equal(calls.length, 0);
      } finally {
        restoreAll();
      }
    }
  });
});

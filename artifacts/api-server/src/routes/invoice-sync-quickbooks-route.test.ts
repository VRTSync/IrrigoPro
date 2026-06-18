// Task #1443 — HTTP tests for POST /api/invoices/:id/sync-quickbooks.
//
// Mounts the route against in-memory storage stubs + a stubbed
// createQuickBooksInvoice dependency (so no QuickBooks calls happen) and
// exercises: the role guard, body validation, the 404, the force-gating
// (null id creates without force; existing id requires force, else 409), and
// the InvoiceSyncError → httpStatus mapping.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerInvoiceSyncQuickbooksRoutes,
  InvoiceSyncError,
} from "./invoice-sync-quickbooks-route";
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

const requireBillingAccess: RequestHandler = (req: any, res, next) => {
  const role = req.authenticatedUserRole;
  if (role !== "company_admin" && role !== "billing_manager") {
    res.status(403).json({ message: "Access denied." });
    return;
  }
  next();
};

function buildApp(
  role: string,
  createQuickBooksInvoice: any,
  companyId: number | null = 1,
): Express {
  const app = express();
  app.use(express.json());
  registerInvoiceSyncQuickbooksRoutes(app, {
    requireAuthentication: makeAuth(role, companyId),
    requireBillingAccess,
    createQuickBooksInvoice,
  });
  return app;
}

async function post(app: Express, id: number, body: unknown) {
  const server = createServer(app);
  await new Promise<void>((res) => server.listen(0, res));
  const { port } = server.address() as AddressInfo;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/invoices/${id}/sync-quickbooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  } finally {
    server.close();
  }
}

function stubGetInvoiceById(rows: Record<number, any>) {
  patch("getInvoiceById", async (id: number, companyId: number | null) => {
    const row = rows[id];
    if (!row) return undefined;
    if (companyId !== null && row.companyId !== companyId) return undefined;
    return row;
  });
}

describe("POST /api/invoices/:id/sync-quickbooks", () => {
  it("returns 403 for field_tech", async () => {
    try {
      const app = buildApp("field_tech", async () => ({ quickbooksId: "X" }));
      const { status } = await post(app, 1, {});
      assert.equal(status, 403);
    } finally {
      restoreAll();
    }
  });

  it("returns 403 for irrigation_manager", async () => {
    try {
      const app = buildApp("irrigation_manager", async () => ({ quickbooksId: "X" }));
      const { status } = await post(app, 1, {});
      assert.equal(status, 403);
    } finally {
      restoreAll();
    }
  });

  it("returns 400 for a malformed body", async () => {
    try {
      const app = buildApp("billing_manager", async () => ({ quickbooksId: "X" }));
      const { status } = await post(app, 1, { force: "yes" });
      assert.equal(status, 400);
    } finally {
      restoreAll();
    }
  });

  it("returns 404 when the invoice does not exist", async () => {
    let created = false;
    try {
      stubGetInvoiceById({});
      const app = buildApp("billing_manager", async () => {
        created = true;
        return { quickbooksId: "X" };
      });
      const { status } = await post(app, 99, {});
      assert.equal(status, 404);
      assert.equal(created, false);
    } finally {
      restoreAll();
    }
  });

  it("creates without force when quickbooksInvoiceId is null", async () => {
    let createArgs: any = null;
    try {
      stubGetInvoiceById({ 1: { id: 1, companyId: 1, quickbooksInvoiceId: null } });
      const app = buildApp("billing_manager", async (id: number, opts: any) => {
        createArgs = { id, opts };
        return { quickbooksId: "QB-NEW-1" };
      });
      const { status, body } = await post(app, 1, {});
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.quickbooksId, "QB-NEW-1");
      assert.equal(createArgs.id, 1);
      assert.equal(createArgs.opts.callerCompanyId, 1);
    } finally {
      restoreAll();
    }
  });

  it("rejects a non-forced re-sync of an already-synced invoice (409)", async () => {
    let created = false;
    try {
      stubGetInvoiceById({ 1: { id: 1, companyId: 1, quickbooksInvoiceId: "QB-OLD" } });
      const app = buildApp("billing_manager", async () => {
        created = true;
        return { quickbooksId: "QB-NEW" };
      });
      const { status, body } = await post(app, 1, {});
      assert.equal(status, 409);
      assert.equal(body.code, "already_synced");
      assert.equal(created, false);
    } finally {
      restoreAll();
    }
  });

  it("re-syncs an already-synced invoice with force:true", async () => {
    try {
      stubGetInvoiceById({ 1: { id: 1, companyId: 1, quickbooksInvoiceId: "QB-OLD" } });
      const app = buildApp("billing_manager", async () => ({ quickbooksId: "QB-NEW-2" }));
      const { status, body } = await post(app, 1, { force: true });
      assert.equal(status, 200);
      assert.equal(body.quickbooksId, "QB-NEW-2");
    } finally {
      restoreAll();
    }
  });

  it("maps InvoiceSyncError to its httpStatus", async () => {
    try {
      stubGetInvoiceById({ 1: { id: 1, companyId: 1, quickbooksInvoiceId: null } });
      const app = buildApp("billing_manager", async () => {
        throw new InvoiceSyncError("Customer not synced.", 400);
      });
      const { status, body } = await post(app, 1, {});
      assert.equal(status, 400);
      assert.equal(body.message, "Customer not synced.");
    } finally {
      restoreAll();
    }
  });

  it("maps an unexpected error to 500", async () => {
    try {
      stubGetInvoiceById({ 1: { id: 1, companyId: 1, quickbooksInvoiceId: null } });
      const app = buildApp("billing_manager", async () => {
        throw new Error("boom");
      });
      const { status } = await post(app, 1, {});
      assert.equal(status, 500);
    } finally {
      restoreAll();
    }
  });
});

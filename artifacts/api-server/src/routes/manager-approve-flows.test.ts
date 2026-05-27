// Task #768 — regression guard: managers can approve submitted billing sheets
// and work_completed work orders; billing_manager callers are rejected.
//
// Mounts the REAL registerApproveRoutes() handlers (extracted from routes.ts)
// with an in-memory storage stub and a stub auth middleware so tests do not
// require a live Postgres connection. Because the real handler logic from
// approve-routes.ts is imported and exercised, any future change to the role
// guard, status check, or response shape in production WILL break these tests.
//
// Covers:
//   POST /api/billing-sheets/:id/approve        (submitted → approved_passed_to_billing)
//   POST /api/billing-sheets/:id/return-for-correction  (submitted → draft)
//   POST /api/work-orders/:id/approve           (work_completed → approved_passed_to_billing)
//   POST /api/work-orders/:id/return-for-correction     (work_completed → in_progress)
//   403 guard — billing_manager is rejected by all four endpoints

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerApproveRoutes,
  type ApproveRoutesStorage,
} from "./approve-routes";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role =
  | "irrigation_manager"
  | "company_admin"
  | "super_admin"
  | "billing_manager"
  | "field_tech";

interface StoredBillingSheet {
  id: number;
  status: string;
  partsSubtotal: string;
  totalHours: string;
  laborRate: string;
  laborSubtotal: string;
  totalAmount: string;
  notes: string | null;
  [key: string]: unknown;
}

interface StoredWorkOrder {
  id: number;
  workOrderNumber: string;
  status: string;
  partsSubtotal: string;
  totalHours: string;
  laborRate: string;
  appliedLaborRate?: string;
  laborSubtotal: string;
  totalAmount: string;
  notes: string | null;
  [key: string]: unknown;
}

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  billingSheets: Map<number, StoredBillingSheet>;
  workOrders: Map<number, StoredWorkOrder>;
  auditCalls: Array<{ action: string; before: unknown; after: unknown }>;
  setRole: (role: Role) => void;
}

async function startHarness(initialRole: Role = "irrigation_manager"): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  let currentRole: Role = initialRole;

  // ── Seed data ───────────────────────────────────────────────────────────────
  const billingSheets = new Map<number, StoredBillingSheet>([
    [1, { id: 1, status: "submitted",              partsSubtotal: "100.00", totalHours: "2.00", laborRate: "75.00", laborSubtotal: "150.00", totalAmount: "250.00", notes: null }],
    [2, { id: 2, status: "pending_manager_review", partsSubtotal: "50.00",  totalHours: "1.00", laborRate: "75.00", laborSubtotal: "75.00",  totalAmount: "125.00", notes: null }],
    [3, { id: 3, status: "draft",                  partsSubtotal: "0.00",   totalHours: "0.00", laborRate: "75.00", laborSubtotal: "0.00",   totalAmount: "0.00",   notes: null }],
  ]);

  const workOrders = new Map<number, StoredWorkOrder>([
    [10, { id: 10, workOrderNumber: "WO-0010", status: "work_completed",       partsSubtotal: "200.00", totalHours: "3.00", laborRate: "80.00", laborSubtotal: "240.00", totalAmount: "440.00", notes: null }],
    [11, { id: 11, workOrderNumber: "WO-0011", status: "pending_manager_review", partsSubtotal: "60.00", totalHours: "1.50", laborRate: "80.00", laborSubtotal: "120.00", totalAmount: "180.00", notes: null }],
    [12, { id: 12, workOrderNumber: "WO-0012", status: "in_progress",           partsSubtotal: "0.00",  totalHours: "0.00", laborRate: "80.00", laborSubtotal: "0.00",   totalAmount: "0.00",   notes: null }],
  ]);

  // ── Storage stub ─────────────────────────────────────────────────────────────
  // Satisfies ApproveRoutesStorage so the REAL handler logic runs against it.
  const storage: ApproveRoutesStorage = {
    async getBillingSheetById(id, _companyId) {
      return billingSheets.get(id);
    },
    async updateBillingSheet(id, data) {
      const existing = billingSheets.get(id);
      if (!existing) throw new Error(`billing sheet ${id} not found`);
      const updated = { ...existing, ...data } as StoredBillingSheet;
      billingSheets.set(id, updated);
      return updated;
    },
    async getWorkOrder(id, _companyId) {
      return workOrders.get(id);
    },
    async updateWorkOrder(id, data) {
      const existing = workOrders.get(id);
      if (!existing) throw new Error(`work order ${id} not found`);
      const updated = { ...existing, ...data } as StoredWorkOrder;
      workOrders.set(id, updated);
      return updated;
    },
    async getUser(_id) {
      return { name: "Alice Manager" };
    },
  };

  // ── Stub auth middleware ─────────────────────────────────────────────────────
  const stubAuth: RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserId = 7;
    req.authenticatedUserRole = currentRole;
    req.authenticatedUserCompanyId = 1;
    next();
  };

  // ── Audit spy ────────────────────────────────────────────────────────────────
  const auditCalls: Array<{ action: string; before: unknown; after: unknown }> = [];

  // ── Mount REAL handlers ───────────────────────────────────────────────────────
  registerApproveRoutes(app, storage, stubAuth, {
    recordLifecycleAudit: async (_req, opts) => {
      auditCalls.push({
        action: opts.action,
        before: opts.before,
        after: opts.after,
      });
    },
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    billingSheets,
    workOrders,
    auditCalls,
    setRole: (role) => { currentRole = role; },
  };
}

// ─── Billing sheet: approve ───────────────────────────────────────────────────

describe("POST /api/billing-sheets/:id/approve — Task #768 (real handler)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness("irrigation_manager"); });
  afterEach(async () => { await h.close(); });

  it("irrigation_manager approving a submitted sheet → 200 + approved_passed_to_billing", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.billingSheet.status, "approved_passed_to_billing");
    assert.ok(body.billingSheet.approvedAt, "approvedAt must be set");
    assert.equal(body.billingSheet.approvedTotal, "250.00");
    assert.equal(body.billingSheet.approvedBy, "Alice Manager");
  });

  it("in-memory store is updated — re-reading the sheet reflects the new status", async () => {
    await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    const sheet = h.billingSheets.get(1);
    assert.equal(sheet?.status, "approved_passed_to_billing");
  });

  it("irrigation_manager approving a pending_manager_review sheet → 200 + approved_passed_to_billing", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/2/approve`, { method: "POST" });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.billingSheet.status, "approved_passed_to_billing");
  });

  it("company_admin can approve a submitted sheet → 200", async () => {
    h.setRole("company_admin");
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.billingSheet.status, "approved_passed_to_billing");
  });

  it("super_admin can approve a submitted sheet → 200", async () => {
    h.setRole("super_admin");
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    assert.equal(res.status, 200);
  });

  it("billing_manager is rejected with 403", async () => {
    h.setRole("billing_manager");
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json() as any;
    assert.match(String(body.message), /irrigation manager/i);
  });

  it("field_tech is rejected with 403", async () => {
    h.setRole("field_tech");
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    assert.equal(res.status, 403);
  });

  it("billing_manager rejection leaves the sheet status unchanged", async () => {
    h.setRole("billing_manager");
    await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    assert.equal(h.billingSheets.get(1)?.status, "submitted", "sheet must not be mutated on 403");
  });

  it("draft sheet cannot be approved — returns 400 with informative message", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/3/approve`, { method: "POST" });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.match(String(body.message), /submitted/i);
  });

  it("unknown billing sheet id → 404", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/9999/approve`, { method: "POST" });
    assert.equal(res.status, 404);
  });

  it("approvedPartsSnapshot and approvedLaborSnapshot are written and correctly shaped", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/approve`, { method: "POST" });
    const body = await res.json() as any;
    const parts = JSON.parse(body.billingSheet.approvedPartsSnapshot);
    const labor = JSON.parse(body.billingSheet.approvedLaborSnapshot);
    assert.equal(parts.partsSubtotal, "100.00");
    assert.equal(labor.totalHours, "2.00");
    assert.equal(labor.laborRate, "75.00");
    assert.equal(labor.laborSubtotal, "150.00");
  });
});

// ─── Billing sheet: return-for-correction ────────────────────────────────────

describe("POST /api/billing-sheets/:id/return-for-correction — Task #768 (real handler)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness("irrigation_manager"); });
  afterEach(async () => { await h.close(); });

  it("irrigation_manager returning a submitted sheet → 200 + draft, notes appended", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/return-for-correction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Missing zone 4 readings" }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.billingSheet.status, "draft");
    assert.match(String(body.billingSheet.notes), /Missing zone 4 readings/);
    assert.match(String(body.billingSheet.notes), /Returned for correction/);
  });

  it("in-memory store is updated to draft after return-for-correction", async () => {
    await fetch(`${h.baseUrl}/api/billing-sheets/1/return-for-correction`, { method: "POST" });
    assert.equal(h.billingSheets.get(1)?.status, "draft");
  });

  it("irrigation_manager returning a pending_manager_review sheet → 200 + draft", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/2/return-for-correction`, {
      method: "POST",
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.billingSheet.status, "draft");
  });

  it("no notes body → status still flips to draft, notes field stays null", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.billingSheet.status, "draft");
    assert.equal(body.billingSheet.notes, null);
  });

  it("billing_manager is rejected with 403", async () => {
    h.setRole("billing_manager");
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 403);
  });

  it("wrong starting status (draft) → 400 with informative message", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/3/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.match(String(body.message), /submitted/i);
  });

  it("unknown billing sheet id → 404", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/9999/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 404);
  });
});

// ─── Work order: approve ──────────────────────────────────────────────────────

describe("POST /api/work-orders/:id/approve — Task #768 (real handler)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness("irrigation_manager"); });
  afterEach(async () => { await h.close(); });

  it("irrigation_manager approving a work_completed order → 200 + approved_passed_to_billing", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.workOrder.status, "approved_passed_to_billing");
    assert.ok(body.workOrder.approvedAt, "approvedAt must be set");
    assert.equal(body.workOrder.approvedTotal, "440.00");
    assert.equal(body.workOrder.approvedBy, "Alice Manager");
  });

  it("in-memory store is updated — status flips to approved_passed_to_billing", async () => {
    await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(h.workOrders.get(10)?.status, "approved_passed_to_billing");
  });

  it("work_order.approved lifecycle audit row is emitted", async () => {
    await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(h.auditCalls.length, 1, "expected exactly one audit call");
    const call = h.auditCalls[0]!;
    assert.equal(call.action, "work_order.approved");
    assert.deepEqual(call.before, { status: "work_completed" });
    assert.deepEqual(call.after, { status: "approved_passed_to_billing" });
  });

  it("irrigation_manager approving a pending_manager_review order → 200", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/11/approve`, { method: "POST" });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.workOrder.status, "approved_passed_to_billing");
  });

  it("company_admin can approve a work_completed order → 200", async () => {
    h.setRole("company_admin");
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.workOrder.status, "approved_passed_to_billing");
  });

  it("super_admin can approve a work_completed order → 200", async () => {
    h.setRole("super_admin");
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(res.status, 200);
  });

  it("billing_manager is rejected with 403", async () => {
    h.setRole("billing_manager");
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(res.status, 403, `expected 403, got ${res.status}`);
    const body = await res.json() as any;
    assert.match(String(body.message), /irrigation manager/i);
  });

  it("field_tech is rejected with 403", async () => {
    h.setRole("field_tech");
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(res.status, 403);
  });

  it("billing_manager rejection leaves the work order status unchanged", async () => {
    h.setRole("billing_manager");
    await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    assert.equal(h.workOrders.get(10)?.status, "work_completed", "order must not be mutated on 403");
  });

  it("in_progress order cannot be approved — returns 400 with informative message", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/12/approve`, { method: "POST" });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.match(String(body.message), /work completed/i);
  });

  it("unknown work order id → 404", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/9999/approve`, { method: "POST" });
    assert.equal(res.status, 404);
  });

  it("approvedPartsSnapshot and approvedLaborSnapshot are written and correctly shaped", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/approve`, { method: "POST" });
    const body = await res.json() as any;
    const parts = JSON.parse(body.workOrder.approvedPartsSnapshot);
    const labor = JSON.parse(body.workOrder.approvedLaborSnapshot);
    assert.equal(parts.partsSubtotal, "200.00");
    assert.equal(labor.totalHours, "3.00");
    assert.equal(labor.laborRate, "80.00");
    assert.equal(labor.laborSubtotal, "240.00");
  });
});

// ─── Work order: return-for-correction ────────────────────────────────────────

describe("POST /api/work-orders/:id/return-for-correction — Task #768 (real handler)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness("irrigation_manager"); });
  afterEach(async () => { await h.close(); });

  it("irrigation_manager returning a work_completed order → 200 + in_progress, notes appended", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/return-for-correction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Head 3 reading missing" }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.workOrder.status, "in_progress");
    assert.match(String(body.workOrder.notes), /Head 3 reading missing/);
    assert.match(String(body.workOrder.notes), /Returned for correction/);
  });

  it("in-memory store is updated to in_progress after return-for-correction", async () => {
    await fetch(`${h.baseUrl}/api/work-orders/10/return-for-correction`, { method: "POST" });
    assert.equal(h.workOrders.get(10)?.status, "in_progress");
  });

  it("work_order.returned_for_correction lifecycle audit row is emitted with note", async () => {
    await fetch(`${h.baseUrl}/api/work-orders/10/return-for-correction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "Fix zone 2" }),
    });
    assert.equal(h.auditCalls.length, 1, "expected exactly one audit call");
    const call = h.auditCalls[0]!;
    assert.equal(call.action, "work_order.returned_for_correction");
    assert.deepEqual(call.before, { status: "work_completed" });
    assert.deepEqual(call.after, { status: "in_progress" });
  });

  it("irrigation_manager returning a pending_manager_review order → 200 + in_progress", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/11/return-for-correction`, {
      method: "POST",
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(body.workOrder.status, "in_progress");
  });

  it("no notes body → status still flips to in_progress, notes stays null", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.workOrder.status, "in_progress");
    assert.equal(body.workOrder.notes, null);
  });

  it("billing_manager is rejected with 403", async () => {
    h.setRole("billing_manager");
    const res = await fetch(`${h.baseUrl}/api/work-orders/10/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 403);
  });

  it("wrong starting status (in_progress) → 400 with informative message", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/12/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 400);
    const body = await res.json() as any;
    assert.match(String(body.message), /work completed/i);
  });

  it("unknown work order id → 404", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/9999/return-for-correction`, {
      method: "POST",
    });
    assert.equal(res.status, 404);
  });
});

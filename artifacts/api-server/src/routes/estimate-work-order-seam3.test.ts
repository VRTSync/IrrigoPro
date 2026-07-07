// Seam 3 — One Work Order Per Estimate
//
// Tests covering all four slices:
//   Slice 1 — schema unique partial index (static source assertion)
//   Slice 2 — createWorkOrderFromEstimate transaction + FOR UPDATE (static source assertion)
//   Slice 3 — CAS token approve/reject (static source assertion + route behavioral)
//   Slice 4 — tenancy + role guard on convert route (route behavioral)
//
// Static-source tests parse storage.ts and estimate-routes.ts to assert the
// structural invariants without needing a live DB. Route behavioral tests
// mount a real Express app with a storage stub and exercise HTTP behavior.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";

import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./estimate-routes";
import type {
  Customer,
  Estimate,
  EstimateWithItems,
  InsertEstimate,
  InsertEstimateItem,
  WorkOrder,
} from "@workspace/db";
import { db } from "../db";
import { estimates, workOrders } from "@workspace/db/schema";

// ─── Source paths ─────────────────────────────────────────────────────────────
const STORAGE_PATH = path.resolve(import.meta.dirname, "../storage.ts");
const ROUTES_PATH = path.resolve(import.meta.dirname, "./estimate-routes.ts");
const SCHEMA_PATH = path.resolve(import.meta.dirname, "../../../../lib/db/src/schema/schema.ts");

const storageSrc = fs.readFileSync(STORAGE_PATH, "utf8");
const routesSrc = fs.readFileSync(ROUTES_PATH, "utf8");
const schemaSrc = fs.readFileSync(SCHEMA_PATH, "utf8");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractMethod(source: string, methodName: string): string {
  const startRe = new RegExp(`async ${methodName}\\s*\\(`);
  const startMatch = startRe.exec(source);
  assert.ok(startMatch, `Method '${methodName}' not found`);

  let i = startMatch.index + startMatch[0].length - 1;
  let parenDepth = 0;
  while (i < source.length) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") { parenDepth--; if (parenDepth === 0) { i++; break; } }
    i++;
  }
  let angleDepth = 0;
  while (i < source.length) {
    if (source[i] === "<") angleDepth++;
    else if (source[i] === ">") { angleDepth--; }
    else if (source[i] === "{" && angleDepth === 0) break;
    i++;
  }
  let braceDepth = 0;
  const start = i;
  while (i < source.length) {
    if (source[i] === "{") braceDepth++;
    else if (source[i] === "}") { braceDepth--; if (braceDepth === 0) { i++; break; } }
    i++;
  }
  return source.slice(start, i);
}

// Extract the source text starting from the first occurrence of `anchor`
// and running to the closing `}` of the outermost `app.post(...)` call
// that contains it. Uses `app.post(` as the outer brace boundary so each
// route's block is cleanly isolated.
function extractRouteBlock(source: string, routePath: string): string {
  // Find the `app.post(` that contains this exact path string.
  // Use lastIndexOf so that if the path appears in multiple routes (e.g. a
  // redirect stub followed by the real handler), we always land on the LAST
  // occurrence, which is the full handler we want to inspect.
  const pathLiteral = JSON.stringify(routePath); // e.g. '"/api/estimates/approve-via-token/:token"'
  const pathIdx = source.lastIndexOf(pathLiteral);
  assert.ok(pathIdx !== -1, `Route path ${routePath} not found in source`);

  // Walk backwards to the `app.post(` before the path literal.
  const appPostIdx = source.lastIndexOf("app.post(", pathIdx);
  assert.ok(appPostIdx !== -1, `app.post( not found before ${routePath}`);

  // Now count parens to find the closing `)` of the `app.post(...)` call.
  let i = appPostIdx + "app.post(".length - 1; // position of opening `(`
  let parenDepth = 0;
  while (i < source.length) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) { i++; break; }
    }
    i++;
  }
  return source.slice(appPostIdx, i);
}

// ─── Slice 1: Schema unique partial index ─────────────────────────────────────

describe("Slice 1 — schema: partial unique index on work_orders(estimate_id)", () => {
  it("uses uniqueIndex (not plain index) for estimateUniqueIdx", () => {
    assert.ok(
      schemaSrc.includes("estimateUniqueIdx"),
      "schema.ts should define estimateUniqueIdx",
    );
    assert.ok(
      !schemaSrc.includes('"work_orders_estimate_idx"'),
      "old non-unique estimateIdx should be removed from schema.ts",
    );
    assert.ok(
      schemaSrc.includes("uniqueIndex"),
      "schema.ts should use uniqueIndex for work_orders estimate constraint",
    );
  });

  it("partial index uses .where() with estimate_id IS NOT NULL", () => {
    const idxBlock = schemaSrc.slice(
      schemaSrc.indexOf("estimateUniqueIdx"),
      schemaSrc.indexOf("estimateUniqueIdx") + 300,
    );
    assert.ok(
      idxBlock.includes("estimate_id IS NOT NULL"),
      "partial index WHERE clause must exclude NULL estimate_id rows",
    );
  });

  it("multiple NULL-estimateId rows are allowed (index is partial)", () => {
    const idxBlock = schemaSrc.slice(
      schemaSrc.indexOf("estimateUniqueIdx"),
      schemaSrc.indexOf("estimateUniqueIdx") + 300,
    );
    assert.ok(
      idxBlock.includes(".where("),
      "partial unique index must use .where() so NULLs are excluded",
    );
  });
});

// ─── Slice 2: createWorkOrderFromEstimate transaction + lock ──────────────────

describe("Slice 2 — createWorkOrderFromEstimate: transaction + FOR UPDATE + 23505", () => {
  let body: string;
  beforeEach(() => {
    body = extractMethod(storageSrc, "createWorkOrderFromEstimate");
  });

  it("wraps all writes in db.transaction", () => {
    assert.ok(
      body.includes("db.transaction"),
      "createWorkOrderFromEstimate must use db.transaction",
    );
  });

  it("acquires SELECT...FOR UPDATE on the estimate row inside the transaction", () => {
    assert.ok(
      body.includes('.for("update")'),
      'createWorkOrderFromEstimate must use .for("update") to lock the estimate row',
    );
  });

  it("re-checks for existing work order inside the transaction (idempotency)", () => {
    assert.ok(
      body.includes("workOrders.estimateId"),
      "createWorkOrderFromEstimate must re-check for an existing WO inside the transaction",
    );
    const priorWoIdx = body.indexOf("priorWo");
    assert.ok(priorWoIdx !== -1, "must have idempotency re-check variable (priorWo)");
    const transactionIdx = body.indexOf("db.transaction");
    assert.ok(
      priorWoIdx > transactionIdx,
      "idempotency re-check must be inside the transaction block",
    );
  });

  it("catches 23505 unique-constraint violations and emits audit event", () => {
    assert.ok(
      body.includes("'23505'"),
      "must catch pgCode === '23505' for unique-index collision",
    );
    assert.ok(
      body.includes("work_order.duplicate_create_blocked"),
      "must emit work_order.duplicate_create_blocked audit event on 23505",
    );
  });

  it("reads back the winner's WO on 23505 and returns it idempotently", () => {
    const catchIdx = body.indexOf("'23505'");
    const afterCatch = body.slice(catchIdx);
    assert.ok(
      afterCatch.includes("workOrders.estimateId"),
      "23505 handler must read back the existing WO and return it",
    );
  });

  it("stamps converted_to_work_order status on the estimate inside the transaction", () => {
    assert.ok(
      body.includes("converted_to_work_order"),
      "must stamp status=converted_to_work_order on the estimate",
    );
  });

  it("priorWo lock re-check path also emits work_order.duplicate_create_blocked audit event", () => {
    // Both idempotency paths (lock re-check + 23505 catch) must be auditable.
    // Find the priorWo branch and confirm recordAuditEvent is called before
    // the return, so ops can observe either path in the audit log.
    const priorWoIdx = body.indexOf("priorWo");
    assert.ok(priorWoIdx !== -1, "priorWo re-check variable must exist");
    // The recordAuditEvent call must appear between the start of the priorWo
    // block and the end of the createWorkOrderFromEstimate body.
    const priorWoToEnd = body.slice(priorWoIdx);
    assert.ok(
      priorWoToEnd.includes("recordAuditEvent") &&
        priorWoToEnd.slice(0, priorWoToEnd.indexOf("recordAuditEvent")).includes("priorWo"),
      "priorWo re-check path must call recordAuditEvent before returning",
    );
    assert.ok(
      priorWoToEnd.includes("work_order.duplicate_create_blocked"),
      "priorWo re-check must emit 'work_order.duplicate_create_blocked'",
    );
  });
});

// ─── Slice 3: CAS token approve ───────────────────────────────────────────────

describe("Slice 3 — approve-via-token: CAS write", () => {
  let approveBlock: string;
  beforeEach(() => {
    approveBlock = extractRouteBlock(routesSrc, "/api/estimates/approve-via-token/:token");
  });

  it("uses db.update(estimates) with WHERE status=pending for atomic approval", () => {
    assert.ok(
      approveBlock.includes("db.update(estimates)"),
      "approve-via-token must use direct db.update(estimates) for CAS write",
    );
    assert.ok(
      approveBlock.includes('eq(estimates.status, "pending")'),
      "approve-via-token CAS must include WHERE status=pending",
    );
    assert.ok(
      approveBlock.includes(".returning()"),
      "approve-via-token CAS must use .returning() to detect zero-row update",
    );
  });

  it("includes all twelve legal-signature fields in the CAS set()", () => {
    const requiredFields = [
      "status:",
      "lifecycle:",
      "approvalSource:",
      "approvalRespondedAt:",
      "approvedAt:",
      "approvalSignatureType:",
      "approvalSignatureData:",
      "approvalSignerName:",
      "approvalSignedAt:",
      "approvalSignerIp:",
      "approvalConsentText:",
      "approvalConsentAcceptedAt:",
    ];
    for (const field of requiredFields) {
      assert.ok(
        approveBlock.includes(field),
        `approve-via-token CAS set() must include ${field}`,
      );
    }
  });

  it("responds 409 already_responded when CAS returns zero rows", () => {
    assert.ok(
      approveBlock.includes("already_responded"),
      "approve-via-token must respond 409 already_responded on CAS miss",
    );
    const casIdx = approveBlock.indexOf("db.update(estimates)");
    const alreadyRespondedIdx = approveBlock.indexOf("already_responded", casIdx);
    assert.ok(
      alreadyRespondedIdx > casIdx,
      "already_responded 409 must come AFTER the CAS db.update block",
    );
  });

  it("does NOT use storage.updateEstimate to set status=approved (the CAS path)", () => {
    // The handler still calls storage.updateEstimate! for the expired-token
    // path (status: "expired"). What must NOT be present is the old approval
    // write pattern — storage.updateEstimate! immediately followed by
    // status: "approved" inside the same call. After the CAS migration that
    // write is handled by db.update(estimates).set({status:"approved",...}).
    const oldApprovalPattern1 = 'storage.updateEstimate!(estimate.id, {\n        status: "approved"';
    const oldApprovalPattern2 = 'storage.updateEstimate!(estimate.id, { status: "approved"';
    assert.ok(
      !approveBlock.includes(oldApprovalPattern1) && !approveBlock.includes(oldApprovalPattern2),
      "approve-via-token must NOT use storage.updateEstimate! for the approval CAS write",
    );
  });

  it("re-reads the current estimate row on CAS miss so 409 body is not stale", () => {
    // When the CAS returns zero rows the 409 body must reflect the winner's
    // state. The handler does this with a db.select() re-read after the
    // !updatedEstimate check so the caller sees the actual current status,
    // not the pre-CAS snapshot that still shows "pending".
    const casIdx = approveBlock.indexOf("db.update(estimates)");
    const afterCas = approveBlock.slice(casIdx);
    const missIdx = afterCas.indexOf("already_responded");
    const casMissRegion = afterCas.slice(0, missIdx + 200);
    assert.ok(
      casMissRegion.includes("db.select()") || casMissRegion.includes("db.select().from(estimates)"),
      "approve-via-token CAS miss must re-read the estimate row before returning 409",
    );
  });
});

// ─── Slice 3: CAS token reject ────────────────────────────────────────────────

describe("Slice 3 — reject-via-token: CAS write", () => {
  let rejectBlock: string;
  beforeEach(() => {
    rejectBlock = extractRouteBlock(routesSrc, "/api/estimates/reject-via-token/:token");
  });

  it("uses db.update(estimates) with WHERE status=pending for atomic rejection", () => {
    assert.ok(
      rejectBlock.includes("db.update(estimates)"),
      "reject-via-token must use direct db.update(estimates) for CAS write",
    );
    assert.ok(
      rejectBlock.includes('eq(estimates.status, "pending")'),
      "reject-via-token CAS must include WHERE status=pending",
    );
    assert.ok(
      rejectBlock.includes(".returning()"),
      "reject-via-token CAS must use .returning() to detect zero-row update",
    );
  });

  it("responds 409 already_responded when CAS returns zero rows", () => {
    const casIdx = rejectBlock.indexOf("db.update(estimates)");
    const alreadyRespondedAfterCas = rejectBlock.slice(casIdx).includes("already_responded");
    assert.ok(
      alreadyRespondedAfterCas,
      "reject-via-token must respond 409 already_responded on CAS miss (after the CAS write)",
    );
  });

  it("does NOT use storage.updateEstimate for the rejection write", () => {
    const updateEstimateForReject =
      rejectBlock.indexOf('storage.updateEstimate!(estimate.id, {') !== -1 &&
      rejectBlock.indexOf("status: \"rejected\"") >
        rejectBlock.indexOf('storage.updateEstimate!(estimate.id, {');
    assert.ok(
      !updateEstimateForReject,
      "reject-via-token must NOT use storage.updateEstimate! for the rejection CAS write",
    );
  });

  it("re-reads the current estimate row on CAS miss so 409 body is not stale", () => {
    // Same requirement as approve: when zero rows come back the handler must
    // re-read the DB row before building the 409 body so the status field
    // reflects the winner's write, not the pre-CAS "pending" snapshot.
    const casIdx = rejectBlock.indexOf("db.update(estimates)");
    const afterCas = rejectBlock.slice(casIdx);
    const missIdx = afterCas.indexOf("already_responded");
    const casMissRegion = afterCas.slice(0, missIdx + 200);
    assert.ok(
      casMissRegion.includes("db.select()") || casMissRegion.includes("db.select().from(estimates)"),
      "reject-via-token CAS miss must re-read the estimate row before returning 409",
    );
  });
});

// ─── Slice 4: Route behavioral tests ─────────────────────────────────────────

const stubAuth: RequestHandler = (req: any, _res, next) => {
  const role = req.headers["x-user-role"] as string | undefined;
  const companyId = parseInt(String(req.headers["x-user-company-id"] ?? "1"), 10);
  if (!role) { _res.status(401).json({ message: "Authentication required" }); return; }
  req.authenticatedUserId = 1;
  req.authenticatedUserRole = role;
  req.authenticatedUserCompanyId = companyId;
  next();
};

const APPROVED_ESTIMATE: EstimateWithItems = {
  id: 42,
  companyId: 1,
  customerId: 10,
  estimateNumber: "EST-00042",
  status: "approved",
  internalStatus: "sent_to_customer",
  lifecycle: "approved",
  estimateDate: new Date(),
  items: [],
  customerName: "Sprinkler Co",
  customerEmail: "test@example.com",
  customerPhone: null,
  projectName: "Backyard",
  projectAddress: null,
  laborRate: "85",
  partsSubtotal: "150.00",
  laborSubtotal: "85.00",
  totalAmount: "235.00",
} as unknown as EstimateWithItems;

const STUB_WORK_ORDER: WorkOrder = {
  id: 99,
  workOrderNumber: "WO-99",
  estimateId: 42,
  companyId: 1,
  customerId: 10,
  status: "pending",
} as unknown as WorkOrder;

function makeMinimalStorage(overrides: Partial<EstimateRoutesStorage> = {}): EstimateRoutesStorage {
  return {
    async getCustomer(_id) { return undefined; },
    async getEstimate(_id) { return undefined; },
    async createEstimateFromPayload(_p) { throw new Error("not implemented"); },
    async updateEstimateWithItems(_id, _e, _i) { throw new Error("not implemented"); },
    ...overrides,
  };
}

function makeApp(storage: EstimateRoutesStorage): { server: Server; baseUrl: () => string } {
  const app = express();
  app.use(express.json());
  registerEstimateRoutes(app, storage, stubAuth, { recordLifecycleAudit: async () => {} });
  const server = createServer(app);
  return {
    server,
    baseUrl: () => {
      const addr = server.address() as AddressInfo;
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

async function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function post(url: string, role: string, companyId = 1): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-role": role,
      "x-user-company-id": String(companyId),
    },
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

// ── Rule 1: cross-company convert → 404 ───────────────────────────────────────

describe("Slice 4 — convert-to-work-order: cross-company returns 404", () => {
  let server: Server;
  let baseUrl: () => string;

  beforeEach(async () => {
    const storage = makeMinimalStorage({
      async getEstimate(id) {
        if (id === 42) return APPROVED_ESTIMATE;
        return undefined;
      },
      async createWorkOrderFromEstimate() {
        throw new Error("should not be called for cross-company request");
      },
    });
    ({ server, baseUrl } = makeApp(storage));
    await listen(server);
  });

  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("returns 404 when caller's companyId does not match estimate's companyId", async () => {
    const { status, body } = await post(`${baseUrl()}/api/estimates/42/convert-to-work-order`, "company_admin", 999);
    assert.equal(status, 404, "cross-company request must return 404");
    assert.ok(
      String(body.message ?? "").toLowerCase().includes("not found"),
      "response body must say 'not found'",
    );
  });

  it("returns 404 when the estimate does not exist", async () => {
    const { status, body } = await post(`${baseUrl()}/api/estimates/9999/convert-to-work-order`, "company_admin", 1);
    assert.equal(status, 404);
    assert.ok(String(body.message ?? "").toLowerCase().includes("not found"));
  });

  it("allows same-company convert (200)", async () => {
    const storage = makeMinimalStorage({
      async getEstimate(id) {
        if (id === 42) return APPROVED_ESTIMATE;
        return undefined;
      },
      async createWorkOrderFromEstimate() {
        return STUB_WORK_ORDER;
      },
    });
    const { server: s2, baseUrl: b2 } = makeApp(storage);
    await listen(s2);
    try {
      const { status } = await post(`${b2()}/api/estimates/42/convert-to-work-order`, "company_admin", 1);
      assert.equal(status, 200, "same-company convert must return 200");
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });

  it("super_admin bypasses company-ownership check (200)", async () => {
    const storage = makeMinimalStorage({
      async getEstimate(id) {
        if (id === 42) return APPROVED_ESTIMATE;
        return undefined;
      },
      async createWorkOrderFromEstimate() {
        return STUB_WORK_ORDER;
      },
    });
    const { server: s3, baseUrl: b3 } = makeApp(storage);
    await listen(s3);
    try {
      const { status } = await post(`${b3()}/api/estimates/42/convert-to-work-order`, "super_admin", 999);
      assert.equal(status, 200, "super_admin must bypass company check");
    } finally {
      await new Promise<void>((r) => s3.close(() => r()));
    }
  });
});

// ── Role guard: field_tech cannot convert ─────────────────────────────────────

describe("Slice 4 — convert-to-work-order: role guard", () => {
  let server: Server;
  let baseUrl: () => string;

  beforeEach(async () => {
    const storage = makeMinimalStorage({
      async getEstimate(id) {
        if (id === 42) return APPROVED_ESTIMATE;
        return undefined;
      },
      async createWorkOrderFromEstimate() {
        return STUB_WORK_ORDER;
      },
    });
    ({ server, baseUrl } = makeApp(storage));
    await listen(server);
  });

  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("returns 403 for field_tech", async () => {
    const { status } = await post(`${baseUrl()}/api/estimates/42/convert-to-work-order`, "field_tech", 1);
    assert.equal(status, 403, "field_tech must be rejected with 403");
  });

  it("returns 403 for billing_manager is allowed (billing_manager is in requireEstimateApprovalAccess)", async () => {
    const { status } = await post(`${baseUrl()}/api/estimates/42/convert-to-work-order`, "billing_manager", 1);
    assert.equal(status, 200, "billing_manager must be allowed through");
  });

  it("returns 200 for irrigation_manager", async () => {
    const { status } = await post(`${baseUrl()}/api/estimates/42/convert-to-work-order`, "irrigation_manager", 1);
    assert.equal(status, 200);
  });
});

// ── Idempotent convert: second call returns same WO ───────────────────────────

describe("Slice 2 + 4 — idempotent convert: second call returns existing WO", () => {
  let server: Server;
  let baseUrl: () => string;
  let convertCallCount: number;

  beforeEach(async () => {
    convertCallCount = 0;
    const storage = makeMinimalStorage({
      async getEstimate(id) {
        if (id === 42) return APPROVED_ESTIMATE;
        return undefined;
      },
      async createWorkOrderFromEstimate() {
        convertCallCount++;
        return STUB_WORK_ORDER;
      },
    });
    ({ server, baseUrl } = makeApp(storage));
    await listen(server);
  });

  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("returns 200 on both calls with the same WO", async () => {
    const r1 = await post(`${baseUrl()}/api/estimates/42/convert-to-work-order`, "company_admin", 1);
    const r2 = await post(`${baseUrl()}/api/estimates/42/convert-to-work-order`, "company_admin", 1);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal((r1.body.workOrder as any).id, (r2.body.workOrder as any).id, "both responses must return the same WO id");
  });
});

// ── Slice 4: companyId is passed to createWorkOrderFromEstimate ───────────────

describe("Slice 4 — companyId forwarded to createWorkOrderFromEstimate", () => {
  it("route source passes estBefore.companyId to createWorkOrderFromEstimate", () => {
    const convertBlock = extractRouteBlock(routesSrc, "/api/estimates/:id/convert-to-work-order");
    assert.ok(
      convertBlock.includes("estBefore.companyId"),
      "convert route must pass estBefore.companyId to createWorkOrderFromEstimate",
    );
    assert.ok(
      convertBlock.includes("estimateOwnershipMatches"),
      "convert route must call estimateOwnershipMatches for tenancy check",
    );
    assert.ok(
      convertBlock.includes("requireEstimateApprovalAccess"),
      "convert route must include requireEstimateApprovalAccess middleware",
    );
  });
});

// ─── Slice 1 (behavioral) — partial unique index: live DB enforcement ─────────
//
// These tests interact with the dev database directly to verify what static
// source analysis cannot: that the index actually fires, that NULL rows are
// allowed, and that the 23505 code is the one produced by the DB engine.
//
// They use companyId=99 (seeded company) and customerId=98 (seeded customer)
// which are present in the standard dev DB. A minimal estimate row is
// inserted and removed as part of the test to anchor the work-order FK.

describe("Slice 1 (behavioral) — partial unique index: DB-level constraint", () => {
  it("rejects a second insert with the same non-null estimateId (23505)", async () => {
    // Seed a minimal estimate so the work-order estimateId FK is satisfiable.
    const tag = `SEAM3-${Date.now()}`;
    let estId: number | null = null;
    const cleanupWoIds: number[] = [];
    try {
      const [est] = await db
        .insert(estimates)
        .values({
          estimateNumber: tag,
          companyId: 99,
          customerName: "Seam3 Constraint Test",
          customerEmail: "seam3@test.invalid",
          projectName: "Seam3 Test",
          // NOT NULL numeric columns — Drizzle schema lists defaults but the
          // actual DB columns may not have DEFAULT values applied, so we must
          // supply them explicitly.
          partsSubtotal: "0.00",
          laborSubtotal: "0.00",
          totalAmount: "0.00",
          laborRate: "45.00",
          appliedLaborRate: "45.00",
          totalLaborHours: "0.00",
        })
        .returning({ id: estimates.id });
      estId = est.id;

      // First insert — must succeed.
      const [wo1] = await db
        .insert(workOrders)
        .values({
          workOrderNumber: `${tag}-WO1`,
          companyId: 99,
          customerId: 98,
          customerName: "Seam3 Test",
          customerEmail: "seam3@test.invalid",
          projectName: "Seam3 Test",
          estimateId: estId,
        })
        .returning({ id: workOrders.id });
      cleanupWoIds.push(wo1.id);

      // Second insert with same estimateId — must fire 23505.
      await assert.rejects(
        () =>
          db
            .insert(workOrders)
            .values({
              workOrderNumber: `${tag}-WO2`,
              companyId: 99,
              customerId: 98,
              customerName: "Seam3 Test",
              customerEmail: "seam3@test.invalid",
              projectName: "Seam3 Test",
              estimateId: estId!,
            }),
        (err: unknown) => {
          // Drizzle wraps the PG error — the 23505 code lives on .cause.
          const pgCode =
            (err as { code?: string }).code ??
            (err as { cause?: { code?: string } }).cause?.code;
          assert.equal(pgCode, "23505", "expected PostgreSQL unique-violation code");
          return true;
        },
        "duplicate estimateId insert must be rejected with a 23505 unique-constraint violation",
      );
    } finally {
      if (cleanupWoIds.length > 0) {
        await db.delete(workOrders).where(inArray(workOrders.id, cleanupWoIds));
      }
      if (estId !== null) {
        await db.delete(estimates).where(eq(estimates.id, estId));
      }
    }
  });

  it("allows multiple rows with NULL estimateId (partial index excludes NULLs)", async () => {
    const tag = `SEAM3-NULL-${Date.now()}`;
    const cleanupIds: number[] = [];
    try {
      const [wo1] = await db
        .insert(workOrders)
        .values({
          workOrderNumber: `${tag}-A`,
          companyId: 99,
          customerId: 98,
          customerName: "Seam3 Null Test",
          customerEmail: "seam3-null@test.invalid",
          projectName: "Seam3 Null Test",
          estimateId: null,
        })
        .returning({ id: workOrders.id });
      cleanupIds.push(wo1.id);

      const [wo2] = await db
        .insert(workOrders)
        .values({
          workOrderNumber: `${tag}-B`,
          companyId: 99,
          customerId: 98,
          customerName: "Seam3 Null Test",
          customerEmail: "seam3-null@test.invalid",
          projectName: "Seam3 Null Test",
          estimateId: null,
        })
        .returning({ id: workOrders.id });
      cleanupIds.push(wo2.id);

      assert.notEqual(wo1.id, wo2.id, "both NULL-estimateId rows must be accepted");
    } finally {
      if (cleanupIds.length > 0) {
        await db.delete(workOrders).where(inArray(workOrders.id, cleanupIds));
      }
    }
  });
});

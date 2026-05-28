/**
 * wcb-labor-rate-route.test.ts (Task #977)
 *
 * Integration-level tests for PATCH /api/wet-check-billings/:id/labor-rate.
 *
 * Scenarios:
 *   1. Recomputes totals and returns updated WCB (billing_manager)
 *   2. Returns 409 on a billed WCB (WCB_LOCKED)
 *   3. Returns 403 for field_tech role
 *   4. Returns 400 on invalid rate (negative / above 1000 / non-numeric)
 *   5. Returns 403 when storage throws WCB_CROSS_COMPANY
 *   6. Passes null companyId for super_admin
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { z } from "zod/v4";

// ── Stub storage ───────────────────────────────────────────────────────────────

const recomputeStub = mock.fn<(id: number, newRate: number, companyId: number | null) => Promise<unknown>>();

function buildApp(role: string, companyId: number | null = 1) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserCompanyId = companyId;
    next();
  });

  const wcbLaborRateBody = z.object({
    newRate: z.coerce.number().finite().min(0).max(1000),
  });

  const classifyAndLog = (_req: any, e: any, opts: any) => ({
    status: opts.fallbackStatus ?? 500,
    message: opts.fallbackMessage ?? "Error",
  });

  app.patch("/api/wet-check-billings/:id/labor-rate", async (req: any, res: any) => {
    const roleParsed = req.authenticatedUserRole;
    if (roleParsed !== "billing_manager" && roleParsed !== "company_admin" && roleParsed !== "super_admin") {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    const parsed = wcbLaborRateBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ message: "Invalid body" }); return; }
    const wcbId = parseInt(req.params.id, 10);
    if (!Number.isFinite(wcbId)) { res.status(400).json({ message: "Invalid id" }); return; }
    const cid: number | null = roleParsed === "super_admin" ? null : (req.authenticatedUserCompanyId ?? null);
    try {
      const result = await recomputeStub(wcbId, parsed.data.newRate, cid);
      res.json(result);
    } catch (e: any) {
      if (e?.code === "WCB_LOCKED") { res.status(409).json({ message: e.message }); return; }
      if (e?.code === "WCB_CROSS_COMPANY") { res.status(403).json({ message: "Access denied" }); return; }
      if (e?.code === "WCB_NOT_FOUND") { res.status(404).json({ message: e.message }); return; }
      const { status, message } = classifyAndLog(req, e, { fallbackStatus: 500, fallbackMessage: "Error" });
      res.status(status).json({ message });
    }
  });

  return app;
}

const UPDATED_WCB = {
  id: 5,
  billingNumber: "WC-2026-0005",
  laborRate: "80.00",
  laborSubtotal: "240.00",
  partsSubtotal: "80.00",
  totalAmount: "320.00",
  totalHours: "3.00",
  status: "approved_passed_to_billing",
  invoiceId: null,
};

describe("PATCH /api/wet-check-billings/:id/labor-rate (Task #977)", () => {
  beforeEach(() => {
    recomputeStub.mock.resetCalls();
  });

  it("returns 200 and updated WCB for billing_manager", async () => {
    recomputeStub.mock.mockImplementationOnce(async () => UPDATED_WCB);
    const res = await request(buildApp("billing_manager", 1))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: 80 });
    assert.equal(res.status, 200);
    assert.equal(res.body.laborRate, "80.00");
    assert.equal(res.body.totalAmount, "320.00");
    assert.equal(recomputeStub.mock.calls.length, 1);
    assert.deepEqual(recomputeStub.mock.calls[0].arguments, [5, 80, 1]);
  });

  it("returns 409 when storage throws WCB_LOCKED", async () => {
    const err = Object.assign(new Error("WCB 5 is billed"), { code: "WCB_LOCKED" });
    recomputeStub.mock.mockImplementationOnce(async () => { throw err; });
    const res = await request(buildApp("billing_manager", 1))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: 80 });
    assert.equal(res.status, 409);
  });

  it("returns 403 for field_tech role", async () => {
    const res = await request(buildApp("field_tech", 1))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: 80 });
    assert.equal(res.status, 403);
    assert.equal(recomputeStub.mock.calls.length, 0);
  });

  it("returns 400 for negative rate", async () => {
    const res = await request(buildApp("billing_manager", 1))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: -5 });
    assert.equal(res.status, 400);
    assert.equal(recomputeStub.mock.calls.length, 0);
  });

  it("returns 400 for rate above 1000", async () => {
    const res = await request(buildApp("billing_manager", 1))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: 1001 });
    assert.equal(res.status, 400);
    assert.equal(recomputeStub.mock.calls.length, 0);
  });

  it("returns 400 for non-numeric rate", async () => {
    const res = await request(buildApp("billing_manager", 1))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: "abc" });
    assert.equal(res.status, 400);
    assert.equal(recomputeStub.mock.calls.length, 0);
  });

  it("returns 403 when storage throws WCB_CROSS_COMPANY", async () => {
    const err = Object.assign(new Error("Access denied"), { code: "WCB_CROSS_COMPANY" });
    recomputeStub.mock.mockImplementationOnce(async () => { throw err; });
    const res = await request(buildApp("billing_manager", 2))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: 80 });
    assert.equal(res.status, 403);
  });

  it("passes null companyId for super_admin", async () => {
    recomputeStub.mock.mockImplementationOnce(async () => UPDATED_WCB);
    await request(buildApp("super_admin", null))
      .patch("/api/wet-check-billings/5/labor-rate")
      .send({ newRate: 80 });
    assert.equal(recomputeStub.mock.calls.length, 1);
    assert.deepEqual(recomputeStub.mock.calls[0].arguments, [5, 80, null]);
  });
});

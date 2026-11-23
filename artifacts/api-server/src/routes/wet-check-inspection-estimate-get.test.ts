import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import express, { type RequestHandler } from "express";
import request from "supertest";

const estimate = {
  id: 42,
  companyId: 10,
  estimateNumber: "EST-0042",
  originWetCheckId: 8,
  lifecycleStatus: "pending_review",
  items: [{ id: 1, estimateId: 42, partName: "Broken head" }],
};

const wetChecks = new Map([
  [7, { companyId: 10, mode: "inspection", estimate: null }],
  [8, { companyId: 10, mode: "inspection", estimate }],
  [9, { companyId: 20, mode: "inspection", estimate: null }],
  [10, { companyId: 10, mode: "service", estimate: null }],
]);

const getInspectionEstimateForWetCheck = mock.fn(async (id: number, companyId: number) => {
  const wetCheck = wetChecks.get(id);
  if (!wetCheck || wetCheck.companyId !== companyId) return { status: "not_found" };
  if (wetCheck.mode !== "inspection") return { status: "not_inspection" };
  return { status: "ok", estimate: wetCheck.estimate };
});
const buildEstimateFromInspectionWetCheck = mock.fn(async () => {
  assert.fail("GET must not build an estimate");
});
mock.module("../storage", {
  namedExports: { storage: { getInspectionEstimateForWetCheck, buildEstimateFromInspectionWetCheck } },
});
const { registerWetCheckInspectionEstimateGetRoute } = await import("./wet-check-inspection-estimate-get");

function createApp(role = "irrigation_manager") {
  const app = express();
  const requireAuthentication: RequestHandler = (req, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserCompanyId = 10;
    next();
  };
  registerWetCheckInspectionEstimateGetRoute(app, {
    requireAuthentication,
    requireCompanyId: (req) => req.authenticatedUserCompanyId ?? null,
  });
  return app;
}

describe("GET /api/wet-checks/:id/inspection-estimate", () => {
  afterEach(() => {
    assert.equal(buildEstimateFromInspectionWetCheck.mock.callCount(), 0);
    getInspectionEstimateForWetCheck.mock.resetCalls();
  });

  it("returns null for an inspection with no estimate", async () => {
    await request(createApp()).get("/api/wet-checks/7/inspection-estimate")
      .expect(200, { estimate: null });
    assert.deepEqual(getInspectionEstimateForWetCheck.mock.calls.map((call) => call.arguments), [[7, 10]]);
  });

  it("returns the existing estimate with its items", async () => {
    await request(createApp()).get("/api/wet-checks/8/inspection-estimate")
      .expect(200, { estimate });
  });

  it("returns 404 for another company's inspection, ignoring client company scope", async () => {
    await request(createApp()).get("/api/wet-checks/9/inspection-estimate?companyId=20")
      .expect(404, { message: "Wet check not found" });
    assert.deepEqual(getInspectionEstimateForWetCheck.mock.calls.map((call) => call.arguments), [[9, 10]]);
  });

  it("returns 400 for service-mode wet checks", async () => {
    await request(createApp()).get("/api/wet-checks/10/inspection-estimate")
      .expect(400, { message: "Not an inspection wet check" });
  });

  for (const role of ["field_tech", "bookkeeper"]) {
    it(`returns 403 for ${role} without querying storage`, async () => {
      await request(createApp(role)).get("/api/wet-checks/8/inspection-estimate")
        .expect(403, { message: "Forbidden" });
      assert.equal(getInspectionEstimateForWetCheck.mock.callCount(), 0);
    });
  }
});

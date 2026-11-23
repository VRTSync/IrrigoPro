import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PRICING_FIELDS_TO_STRIP, type EstimateWithItems } from "@workspace/db";
import { transformSync } from "esbuild";
import express, { type RequestHandler } from "express";
import { registerEstimateRoutes, type EstimateRouteDeps, type EstimateRoutesStorage } from "./estimate-routes";

// Load the production pricing helper without starting the monolithic
// registerRoutes() or duplicating the sanitizer in this test.
function loadPricingVisibility(): NonNullable<EstimateRouteDeps["applyPricingVisibility"]> {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const start = source.indexOf("function sanitizePricingFieldsInPlace(");
  const helper = source.indexOf("function applyPricingVisibility(", start);
  const end = source.indexOf("\n}", helper);
  assert.ok(start >= 0 && helper > start && end > helper);
  const { code } = transformSync(source.slice(start, end + 2), { loader: "ts" });
  return new Function("PRICING_FIELDS_TO_STRIP", "headerUserRole", `${code}\nreturn applyPricingVisibility;`)(
    PRICING_FIELDS_TO_STRIP,
    () => { throw new Error("Authenticated estimate routes must not need legacy role headers"); },
  );
}

const authenticate: RequestHandler = (req, res, next) => {
  const role = req.get("x-test-role");
  if (!role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserRole = role;
  req.authenticatedUserCompanyId = role === "super_admin" ? null : 11;
  req.authenticatedUserId = 1;
  next();
};

const own = {
  id: 1,
  companyId: 11,
  totalAmount: "125.00",
  laborRate: "75.00",
  laborSubtotal: "75.00",
  partsSubtotal: "50.00",
  items: [],
} as unknown as EstimateWithItems;
const foreign: EstimateWithItems = {
  ...own,
  id: 2,
  companyId: 22,
  approvalToken: "fixture-token",
  estimateNumber: "00002",
  status: "pending",
};
const deleted: EstimateWithItems = { ...foreign, id: 3, deletedAt: new Date("2026-01-01") };
const signature = {
  signatureType: "typed",
  signatureData: "Test Customer",
  signerName: "Test Customer",
  consentAccepted: true,
  consentText: "I approve this estimate.",
};
type ListOptions = Parameters<NonNullable<EstimateRoutesStorage["getEstimates"]>>[0];

describe("Estimate read access", () => {
  let server: Server;
  let base: string;
  let listCalls: ListOptions[];
  let tokenCalls: string[];

  beforeEach(async () => {
    listCalls = [];
    tokenCalls = [];
    const app = express();
    app.use(express.json());
    registerEstimateRoutes(app, {
      async getCustomer() { return undefined; },
      async getEstimate(id) { return [own, foreign].find((row) => row.id === id); },
      async getEstimates(opts) {
        listCalls.push(opts);
        const { companyId, includeDeleted } = opts;
        return [own, foreign, deleted].filter((row) =>
          (companyId === null || row.companyId === companyId) && (includeDeleted || !row.deletedAt));
      },
      async getEstimateByApprovalToken(token) {
        tokenCalls.push(token);
        return [own, foreign, deleted].find((row) => row.approvalToken === token && !row.deletedAt);
      },
      async getCompanyProfile() { return undefined; },
      async createEstimateFromPayload() { throw new Error("Unexpected estimate write"); },
      async updateEstimateWithItems() { throw new Error("Unexpected estimate write"); },
    }, authenticate, { applyPricingVisibility: loadPricingVisibility() });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/estimates`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function get(path: string, role: string) {
    return fetch(`${base}${path}`, { headers: { "x-test-role": role } });
  }

  it("returns the same 404 for a foreign estimate and a missing estimate", async () => {
    const foreignRes = await get("/2", "company_admin");
    const missingRes = await get("/999", "company_admin");
    assert.equal(foreignRes.status, 404);
    assert.equal(missingRes.status, 404);
    assert.deepEqual(await foreignRes.json(), await missingRes.json());
  });

  it("allows a super admin to open an estimate from another company", async () => {
    const res = await get("/2", "super_admin");
    assert.equal(res.status, 200);
    const body = await res.json() as { id: number };
    assert.equal(body.id, foreign.id);
  });

  it("passes the session company to the list and keeps deleted rows super-admin only", async () => {
    const tenantRes = await get("?includeDeleted=1", "company_admin");
    assert.equal(tenantRes.status, 200);
    const tenantRows = await tenantRes.json() as Array<{ id: number }>;
    assert.deepEqual(tenantRows.map((row) => row.id), [1]);
    const adminRes = await get("?includeDeleted=1", "super_admin");
    assert.equal(adminRes.status, 200);
    const adminRows = await adminRes.json() as Array<{ id: number }>;
    assert.deepEqual(adminRows.map((row) => row.id), [1, 2, 3]);
    assert.deepEqual(listCalls, [
      { companyId: 11, includeDeleted: false },
      { companyId: null, includeDeleted: true },
    ]);
  });

  it("strips all four estimate pricing fields from field-tech detail", async () => {
    const res = await get("/1", "field_tech");
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.id, own.id);
    for (const field of ["totalAmount", "laborRate", "laborSubtotal", "partsSubtotal"]) {
      assert.equal(Object.hasOwn(body, field), false, field);
    }
  });

  it("lets customers view an estimate and open the reject confirmation without signing in", async () => {
    const view = await fetch(`${base}/view-by-token/fixture-token`);
    assert.equal(view.status, 200);
    const viewBody = await view.json() as { estimate: { id: number } };
    assert.equal(viewBody.estimate.id, foreign.id);

    const reject = await fetch(`${base}/reject-via-token/fixture-token`);
    assert.equal(reject.status, 200);
    const rejectBody = await reject.json() as { intent: string };
    assert.equal(rejectBody.intent, "confirm_reject");
    assert.deepEqual(tokenCalls, ["fixture-token", "fixture-token"]);
    assert.deepEqual(listCalls, []);
  });

  const tokenRoutes = [
    { method: "GET", path: "view-by-token" },
    { method: "POST", path: "approve-via-token", body: signature },
    { method: "GET", path: "reject-via-token" },
    { method: "POST", path: "reject-via-token" },
    { method: "POST", path: "request-new-link" },
  ];
  for (const { method, path, body } of tokenRoutes) {
    it(`${method} ${path} uses a direct token lookup and preserves not-found`, async () => {
      const res = await fetch(`${base}/${path}/missing-token`, {
        method,
        ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      assert.equal(res.status, 404);
      const errorBody = await res.json() as { error: string };
      assert.equal(errorBody.error, "not_found");
      assert.deepEqual(tokenCalls, ["missing-token"]);
      assert.deepEqual(listCalls, []);
    });
  }
});

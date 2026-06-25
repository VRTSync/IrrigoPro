// Behavior tests for POST /api/estimates/:id/unreject.
//
// Exercises the route handler with a stubbed storage so the full
// 200/409/403/404/401 surfaces are covered without a live database.
// The storage stub's `unrejectedEstimate` method returns controlled
// outcomes, letting us test both success paths and the 409 variant
// (lifecycle mismatch — caught pre-storage).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./estimate-routes";
import type { Customer, EstimateWithItems } from "@workspace/db";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stubAuth: RequestHandler = (req: any, res, next) => {
  const role = req.headers["x-user-role"];
  if (typeof role !== "string" || role === "") {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserId = 1;
  req.authenticatedUserRole = role;
  req.authenticatedUserCompanyId = 1;
  next();
};

const stubCustomer: Customer = {
  id: 1,
  companyId: 1,
  name: "Acme Corp",
} as Customer;

const rejectedEstimate = {
  id: 1,
  companyId: 1,
  customerId: 1,
  estimateNumber: "EST-00001",
  status: "rejected",
  internalStatus: "sent_to_customer",
  lifecycle: "rejected",
  estimateDate: new Date(),
  items: [],
} as unknown as EstimateWithItems;

const sentEstimate = {
  ...rejectedEstimate,
  status: "pending",
  internalStatus: "sent_to_customer",
  lifecycle: "sent",
} as unknown as EstimateWithItems;

function makeApp(storage: EstimateRoutesStorage): { server: Server; url: () => string } {
  const app = express();
  app.use(express.json());
  registerEstimateRoutes(app, storage, stubAuth);
  const server = createServer(app);
  return {
    server,
    url: () => {
      const addr = server.address() as AddressInfo;
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

async function post(
  url: string,
  role: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (role) headers["x-user-role"] = role;
  const res = await fetch(`${url}/api/estimates/1/unreject`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/estimates/:id/unreject — behavior", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it("200: company_admin — flips rejected estimate to sent", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
      unrejectedEstimate: async () =>
        sentEstimate as unknown as import("@workspace/db").Estimate,
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status, body } = await post(url(), "company_admin");
    assert.equal(status, 200, `body: ${JSON.stringify(body)}`);
    assert.equal(
      (body.estimate as Record<string, unknown>)?.lifecycle,
      "sent",
      "returned estimate lifecycle should be 'sent'",
    );
  });

  it("200: super_admin — flips rejected estimate to sent", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
      unrejectedEstimate: async () =>
        sentEstimate as unknown as import("@workspace/db").Estimate,
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status, body } = await post(url(), "super_admin");
    assert.equal(status, 200, `body: ${JSON.stringify(body)}`);
    assert.equal(
      (body.estimate as Record<string, unknown>)?.lifecycle,
      "sent",
    );
  });

  it("409: estimate lifecycle is not rejected (pre-storage check)", async () => {
    const notRejected = {
      ...rejectedEstimate,
      lifecycle: "sent",
      status: "pending",
    } as unknown as EstimateWithItems;
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => notRejected,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status, body } = await post(url(), "company_admin");
    assert.equal(status, 409, `body: ${JSON.stringify(body)}`);
    assert.equal(body.lifecycle, "sent", "should echo current lifecycle");
  });

  it("409: storage returns undefined (race condition — estimate no longer rejected)", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
      unrejectedEstimate: async () => undefined,
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status } = await post(url(), "company_admin");
    assert.equal(status, 409);
  });

  it("404: estimate does not exist", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => undefined,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status } = await post(url(), "company_admin");
    assert.equal(status, 404);
  });

  it("403: billing_manager is not authorized to unreject", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status } = await post(url(), "billing_manager");
    assert.equal(status, 403);
  });

  it("403: irrigation_manager is not authorized to unreject", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status } = await post(url(), "irrigation_manager");
    assert.equal(status, 403);
  });

  it("403: field_tech is not authorized to unreject", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status } = await post(url(), "field_tech");
    assert.equal(status, 403);
  });

  it("401: unauthenticated request is rejected", async () => {
    const { server: s, url } = makeApp({
      getCustomer: async () => stubCustomer,
      getEstimate: async () => rejectedEstimate,
      createEstimateFromPayload: async () => { throw new Error("not used"); },
      updateEstimateWithItems: async () => { throw new Error("not used"); },
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, r));
    const { status } = await post(url(), null);
    assert.equal(status, 401);
  });
});

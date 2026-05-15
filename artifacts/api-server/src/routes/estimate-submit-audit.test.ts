// Task #641 — Audit emission for lifecycle transitions.
//
// The atomic submit-for-review endpoint must:
//   1. Invoke the audit callback exactly once on a successful flip,
//      with the before/after snapshot the activity feed needs.
//   2. NOT invoke the audit callback when the transition is rolled
//      back (409 because the row isn't a draft).
//
// This test mounts registerEstimateRoutes() with an in-memory storage
// stub and a spy audit callback, then exercises both paths.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./estimate-routes";
import { processEstimatePayload } from "../estimate-payload";
import type {
  Customer,
  EstimateWithItems,
  InsertEstimate,
} from "@workspace/db";

type StorageStub = EstimateRoutesStorage & {
  customers: Map<number, Customer>;
  estimates: Map<number, EstimateWithItems>;
  nextId: number;
};

function makeStorageStub(): StorageStub {
  const stub: StorageStub = {
    customers: new Map(),
    estimates: new Map(),
    nextId: 1,
    async getCustomer(id) {
      return stub.customers.get(id);
    },
    async getEstimate(id) {
      return stub.estimates.get(id);
    },
    async createEstimateFromPayload(payload) {
      const { estimate, items } = processEstimatePayload(payload);
      const id = stub.nextId++;
      const stored: EstimateWithItems = {
        ...(estimate as InsertEstimate),
        id,
        estimateNumber: `EST-${id}`,
        items: items.map((it, i) => ({ ...it, id: i + 1, estimateId: id })),
      } as unknown as EstimateWithItems;
      stub.estimates.set(id, stored);
      return stored;
    },
    async updateEstimateWithItems(id, estimate, items) {
      const existing = stub.estimates.get(id);
      const merged: EstimateWithItems = {
        ...(existing as object),
        ...(estimate as InsertEstimate),
        id,
        estimateNumber: existing?.estimateNumber ?? `EST-${id}`,
        items: items.map((it, i) => ({ ...it, id: i + 1, estimateId: id })),
      } as unknown as EstimateWithItems;
      stub.estimates.set(id, merged);
      return merged;
    },
  };
  return stub;
}

function makeCustomer(id: number): Customer {
  return {
    id,
    companyId: 1,
    name: `Customer ${id}`,
    laborRate: "75.00",
    isActive: true,
    createdAt: new Date(),
  } as unknown as Customer;
}

function payloadFor(customerId: number) {
  return {
    estimate: {
      customerId,
      customerName: "Customer 1",
      customerEmail: "x@example.com",
      projectName: "Test",
      laborRate: 75,
      laborMode: "flat",
      totalLaborHours: 2,
    },
    items: [{ partId: 1, partName: "Part A", partPrice: 50, quantity: 1 }],
  };
}

type AuditCall = {
  estimateId: number;
  before: { status?: string | null; internalStatus?: string | null } | null;
  after: EstimateWithItems;
};

async function startServer(
  stub: EstimateRoutesStorage,
  auditCalls: AuditCall[],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app: Express = express();
  app.use(express.json());
  const noopAuth: RequestHandler = (_req, _res, next) => next();
  registerEstimateRoutes(app, stub, noopAuth, {
    recordLifecycleAudit: async (_req, evt) => {
      auditCalls.push({
        estimateId: Number(evt.targetId),
        before: (evt.before ?? null) as AuditCall["before"],
        after: (evt.after ?? null) as unknown as EstimateWithItems,
      });
    },
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Task #641 — submit-for-review audit emission", () => {
  let stub: StorageStub;
  let auditCalls: AuditCall[];
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    stub = makeStorageStub();
    stub.customers.set(1, makeCustomer(1));
    auditCalls = [];
    ({ baseUrl, close } = await startServer(stub, auditCalls));
  });
  afterEach(async () => {
    await close();
  });

  it("invokes the audit callback exactly once on a successful submit", async () => {
    const create = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payloadFor(1),
        estimate: { ...payloadFor(1).estimate, internalStatus: "draft" },
      }),
    });
    assert.equal(create.status, 201);
    const draft = (await create.json()) as { id: number };

    const submit = await fetch(
      `${baseUrl}/api/estimates/${draft.id}/submit-for-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor(1)),
      },
    );
    assert.equal(submit.status, 200);

    assert.equal(auditCalls.length, 1, "audit callback fires exactly once");
    const call = auditCalls[0];
    assert.equal(call.estimateId, draft.id);
    assert.equal(call.before?.internalStatus, "draft", "before snapshot captured");
    assert.equal(
      (call.after as { internalStatus?: string }).internalStatus,
      "pending_approval",
      "after snapshot reflects the new state",
    );
  });

  it("does NOT invoke the audit callback when the transition rolls back (409)", async () => {
    // Seed a draft and submit it once so the row is now in
    // pending_approval. A second submit-for-review must 409 — and
    // crucially, must NOT emit a second audit row.
    const create = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payloadFor(1),
        estimate: { ...payloadFor(1).estimate, internalStatus: "draft" },
      }),
    });
    const draft = (await create.json()) as { id: number };
    await fetch(`${baseUrl}/api/estimates/${draft.id}/submit-for-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadFor(1)),
    });
    assert.equal(auditCalls.length, 1, "first submit emits one row");

    const second = await fetch(
      `${baseUrl}/api/estimates/${draft.id}/submit-for-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor(1)),
      },
    );
    assert.equal(second.status, 409);
    assert.equal(
      auditCalls.length,
      1,
      "rolled-back transition must NOT emit an audit row",
    );
  });

  it("does NOT invoke the audit callback when the row doesn't exist (404)", async () => {
    const res = await fetch(
      `${baseUrl}/api/estimates/9999/submit-for-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor(1)),
      },
    );
    assert.equal(res.status, 404);
    assert.equal(auditCalls.length, 0);
  });
});

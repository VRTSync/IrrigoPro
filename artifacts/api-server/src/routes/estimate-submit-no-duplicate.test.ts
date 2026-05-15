// Task #630 — Regression test for bug #4.
//
// Submitting an existing draft for review used to leave the original
// draft behind and create a second row in pending_approval. The
// atomic POST /api/estimates/:id/submit-for-review endpoint (added
// by Task #606) is the only sanctioned path: it must transition the
// draft in place — same id — and reject any attempt to re-submit
// a row that is not a draft so the wizard can't double-create.
//
// This test mounts the real registerEstimateRoutes() against an
// in-memory storage stub and rehearses the full draft → submit
// round trip, asserting at every step that the row count is
// exactly 1 and the id is unchanged.

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
  InsertEstimateItem,
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
    items: [
      { partId: 1, partName: "Part A", partPrice: 50, quantity: 1 },
    ],
  };
}

async function startServer(stub: EstimateRoutesStorage): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  const noopAuth: RequestHandler = (_req, _res, next) => next();
  registerEstimateRoutes(app, stub, noopAuth);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Submit-for-review never duplicates the draft row (Task #630, bug #4)", () => {
  let stub: StorageStub;
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    stub = makeStorageStub();
    stub.customers.set(1, makeCustomer(1));
    ({ baseUrl, close } = await startServer(stub));
  });
  afterEach(async () => {
    await close();
  });

  it("transitions the existing draft in place — one row, same id, no duplicate", async () => {
    // 1) Create the initial draft via POST /api/estimates with
    //    internalStatus: "draft" (this is the wizard's "Save as draft").
    const createRes = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payloadFor(1),
        estimate: { ...payloadFor(1).estimate, internalStatus: "draft" },
      }),
    });
    assert.equal(createRes.status, 201);
    const draft = (await createRes.json()) as { id: number; internalStatus: string };
    assert.equal(draft.internalStatus, "draft");
    assert.equal(stub.estimates.size, 1);
    const draftId = draft.id;

    // 2) Submit-for-review via the atomic endpoint — must flip in
    //    place, same id, count still 1.
    const submitRes = await fetch(
      `${baseUrl}/api/estimates/${draftId}/submit-for-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor(1)),
      },
    );
    assert.equal(submitRes.status, 200);
    const submitted = (await submitRes.json()) as {
      id: number;
      internalStatus: string;
    };
    assert.equal(submitted.id, draftId, "submit must NOT create a new row");
    assert.equal(submitted.internalStatus, "pending_approval");
    assert.equal(stub.estimates.size, 1, "exactly one row exists after submit");

    // 3) The Drafts list (anything with internalStatus === 'draft')
    //    no longer contains this estimate.
    const drafts = [...stub.estimates.values()].filter(
      (e) => (e as { internalStatus?: string }).internalStatus === "draft",
    );
    assert.equal(drafts.length, 0);

    // 4) The Pending Approval list contains exactly one row — the
    //    same id we started with.
    const pending = [...stub.estimates.values()].filter(
      (e) =>
        (e as { internalStatus?: string }).internalStatus === "pending_approval",
    );
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, draftId);
  });

  it("re-submitting a non-draft row returns 409 (server guard against accidental double-submit)", async () => {
    // Seed a draft + flip it to pending_approval via the atomic
    // endpoint. A second submit-for-review attempt against the same
    // id must NOT silently land — otherwise a stale wizard or a
    // double-click could write twice.
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

    const second = await fetch(
      `${baseUrl}/api/estimates/${draft.id}/submit-for-review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor(1)),
      },
    );
    assert.equal(second.status, 409);
    assert.equal(stub.estimates.size, 1, "no duplicate created on conflict");
  });

  it("POST /api/estimates with internalStatus !== 'draft' is coerced to pending_approval and stays one row (no orphan draft)", async () => {
    // Defence-in-depth: a fresh estimate created with submit-for-
    // review semantics (skipping the draft step) must produce exactly
    // one row in pending_approval, not a draft + a pending pair.
    const res = await fetch(`${baseUrl}/api/estimates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payloadFor(1),
        estimate: {
          ...payloadFor(1).estimate,
          internalStatus: "pending_approval",
        },
      }),
    });
    assert.equal(res.status, 201);
    const created = (await res.json()) as { internalStatus: string };
    assert.equal(created.internalStatus, "pending_approval");
    assert.equal(stub.estimates.size, 1);
    const drafts = [...stub.estimates.values()].filter(
      (e) => (e as { internalStatus?: string }).internalStatus === "draft",
    );
    assert.equal(drafts.length, 0, "no orphan draft alongside the pending row");
  });
});

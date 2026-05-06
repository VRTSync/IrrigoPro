/**
 * Tests for Task #374 — Slice 10c "Save as draft" + dual-CTA submit.
 *
 * 1. Wizard "Save as draft" path: POST /api/estimates with
 *    `internalStatus: 'draft'` lands the row in the draft bucket
 *    (lifecycleStatus = 'draft').
 * 2. Dual-CTA edit-on-draft happy path: drafts can be moved to
 *    pending_approval via POST /api/estimates/:id/transition with
 *    `action: 'submit_for_review'`.
 * 3. Partial-failure: the wizard's submit helper does PUT then
 *    transition. If the transition call throws (e.g. the estimate is no
 *    longer a draft so the server returns 400), the helper resolves with
 *    `{ transitionFailed: true }` so the page can show the recoverable
 *    "saved as draft, but couldn't submit for review" toast.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import { submitEstimate } from "../client/src/components/estimates/estimate-wizard-submit.ts";

const BASE_URL = "http://localhost:5000";
const COMPANY_ID = 99;

function headers(role, userId = "2") {
  return {
    "Content-Type": "application/json",
    "x-user-id": String(userId),
    "x-user-role": role,
    "x-user-company-id": String(COMPANY_ID),
  };
}

const ADMIN = headers("company_admin");
const MANAGER = headers("irrigation_manager", "5");

async function api(method, path, body, hdrs = ADMIN) {
  const opts = { method, headers: { ...hdrs } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let customerId;
let partId;

async function makeCustomer() {
  const r = await api("POST", "/api/customers", {
    companyId: COMPANY_ID,
    name: `S10c-Draft Customer ${Date.now()}`,
    email: `s10c-draft-${Date.now()}@example.test`,
    laborRate: "75.00",
  });
  assert.equal(r.status, 201, `customer create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function makePart() {
  const r = await api("POST", "/api/parts", {
    name: `S10c-Draft Part ${Date.now()}`,
    description: "",
    price: "12.00",
    sku: `S10C-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
    category: "general",
    companyId: COMPANY_ID,
  });
  assert.ok(r.status === 200 || r.status === 201, `part create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

function buildEstimatePayload({ internalStatus } = {}) {
  return {
    estimate: {
      companyId: COMPANY_ID,
      customerId,
      customerName: "S10c-Draft Customer",
      customerEmail: `s10c-draft-${Date.now()}-${Math.floor(Math.random() * 99999)}@example.test`,
      projectName: "Slice10c Draft Project",
      estimateNumber: `EST-S10C-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
      estimateDate: new Date().toISOString(),
      status: "pending",
      laborRate: "75.00",
      createdBy: "Slice10c Test",
      ...(internalStatus ? { internalStatus } : {}),
    },
    items: [
      {
        description: "Single line",
        partId,
        partName: "S10c-Draft Part",
        partPrice: "12.00",
        quantity: 1,
        laborHours: "0.0",
        sortOrder: 0,
      },
    ],
  };
}

describe("Slice 10c — wizard Save-as-draft creates internalStatus='draft'", () => {
  before(async () => {
    customerId = await makeCustomer();
    partId = await makePart();
  });

  test("POST /api/estimates with internalStatus='draft' lands as draft", async () => {
    const r = await api("POST", "/api/estimates", buildEstimatePayload({ internalStatus: "draft" }));
    assert.equal(r.status, 201, `create draft: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.internalStatus, "draft");
    const get = await api("GET", `/api/estimates/${r.body.id}`);
    assert.equal(get.status, 200);
    assert.equal(get.body.internalStatus, "draft");
    assert.equal(get.body.lifecycleStatus, "draft");
  });

  test("POST /api/estimates without internalStatus lands as pending_approval", async () => {
    const r = await api("POST", "/api/estimates", buildEstimatePayload());
    assert.equal(r.status, 201, `create default: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.internalStatus, "pending_approval");
    const get = await api("GET", `/api/estimates/${r.body.id}`);
    assert.equal(get.body.lifecycleStatus, "pending_review");
  });

  test("draft → submit_for_review transitions to pending_approval", async () => {
    const created = await api("POST", "/api/estimates", buildEstimatePayload({ internalStatus: "draft" }));
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal(created.body.internalStatus, "draft");

    const r = await api(
      "POST",
      `/api/estimates/${id}/transition`,
      { action: "submit_for_review" },
      MANAGER,
    );
    assert.equal(r.status, 200, `transition: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.estimate.internalStatus, "pending_approval");
    assert.equal(r.body.estimate.lifecycleStatus, "pending_review");
  });

  test("submit_for_review on a non-draft estimate → 400 (drives partial-failure toast)", async () => {
    const created = await api("POST", "/api/estimates", buildEstimatePayload());
    const id = created.body.id;
    assert.equal(created.body.internalStatus, "pending_approval");
    const r = await api(
      "POST",
      `/api/estimates/${id}/transition`,
      { action: "submit_for_review" },
      MANAGER,
    );
    assert.equal(r.status, 400);
  });
});

describe("Slice 10c — submitEstimate helper (dual-CTA + partial failure)", () => {
  test("New estimate save: POSTs once, no transition call", async () => {
    const calls = [];
    const apiStub = async (url, method) => {
      calls.push({ url, method });
      if (method === "POST") return { id: 42 };
      return {};
    };
    const result = await submitEstimate(
      { dummy: true },
      "submit",
      { isEdit: false, isDraftEdit: false, estimateId: null },
      apiStub,
    );
    assert.deepEqual(result, { mode: "submit", id: 42 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { url: "/api/estimates", method: "POST" });
  });

  test("Draft save (new): POST only, no transition", async () => {
    const calls = [];
    const apiStub = async (url, method) => {
      calls.push({ url, method });
      return { id: 7 };
    };
    const result = await submitEstimate(
      {},
      "draft",
      { isEdit: false, isDraftEdit: false, estimateId: null },
      apiStub,
    );
    assert.deepEqual(result, { mode: "draft", id: 7 });
    assert.equal(calls.length, 1);
  });

  test("Edit draft + submit: PUT followed by transition POST (happy path)", async () => {
    const calls = [];
    const apiStub = async (url, method, body) => {
      calls.push({ url, method, body });
      return {};
    };
    const result = await submitEstimate(
      {},
      "submit",
      { isEdit: true, isDraftEdit: true, estimateId: 99 },
      apiStub,
    );
    assert.deepEqual(result, { mode: "submit", id: 99 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "/api/estimates/99");
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[1].url, "/api/estimates/99/transition");
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(calls[1].body, { action: "submit_for_review" });
  });

  test("Edit draft + save-as-draft: PUT only, no transition call", async () => {
    const calls = [];
    const apiStub = async (url, method) => {
      calls.push({ url, method });
      return {};
    };
    const result = await submitEstimate(
      {},
      "draft",
      { isEdit: true, isDraftEdit: true, estimateId: 11 },
      apiStub,
    );
    assert.deepEqual(result, { mode: "draft", id: 11 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "PUT");
  });

  test("PARTIAL FAILURE: PUT succeeds, transition throws → transitionFailed=true", async () => {
    const calls = [];
    const apiStub = async (url, method) => {
      calls.push({ url, method });
      if (url.endsWith("/transition")) {
        throw new Error("400: Only draft estimates can be submitted for review");
      }
      return {};
    };
    const result = await submitEstimate(
      {},
      "submit",
      { isEdit: true, isDraftEdit: true, estimateId: 55 },
      apiStub,
    );
    assert.deepEqual(result, { mode: "submit", id: 55, transitionFailed: true });
    assert.equal(calls.length, 2, "PUT must run before transition is attempted");
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[1].url, "/api/estimates/55/transition");
  });

  test("PUT failure propagates as a thrown error (no partial-failure swallowing)", async () => {
    const apiStub = async (_url, method) => {
      if (method === "PUT") throw new Error("500: boom");
      return {};
    };
    await assert.rejects(
      submitEstimate(
        {},
        "submit",
        { isEdit: true, isDraftEdit: true, estimateId: 1 },
        apiStub,
      ),
      /boom/,
    );
  });
});

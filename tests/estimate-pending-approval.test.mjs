import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

function headers(role, companyId, userId = "2") {
  return {
    "Content-Type": "application/json",
    "x-user-id": String(userId),
    "x-user-role": role,
    "x-user-company-id": String(companyId),
  };
}

async function api(method, path, body, hdrs) {
  const opts = { method, headers: { ...hdrs } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const COMPANY_A = 99;
const COMPANY_B = 100;
const ADMIN_A = headers("company_admin", COMPANY_A);
const ADMIN_B = headers("company_admin", COMPANY_B, "10");
const BILLING_A = headers("billing_manager", COMPANY_A, "3");
const BILLING_B = headers("billing_manager", COMPANY_B, "4");
const MANAGER_A = headers("irrigation_manager", COMPANY_A, "5");
const FIELD_TECH_A = headers("field_tech", COMPANY_A, "6");
const SUPER_ADMIN = headers("super_admin", COMPANY_A, "1");

async function makeCustomer(companyId, hdrs) {
  const r = await api(
    "POST",
    "/api/customers",
    {
      companyId,
      name: `Slice7 Customer ${companyId} ${Date.now()}`,
      email: `slice7-c${companyId}-${Date.now()}@example.com`,
      laborRate: "75.00",
    },
    hdrs,
  );
  assert.equal(r.status, 201, `customer create failed: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function makePart(hdrs) {
  const r = await api(
    "POST",
    "/api/parts",
    {
      name: `Slice7 Part ${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      description: "",
      price: "10.00",
      sku: `SLICE7-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
      category: "general",
      companyId: COMPANY_A,
    },
    hdrs,
  );
  assert.ok(r.status === 200 || r.status === 201, `part create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function makeEstimate(opts) {
  const { hdrs, companyId, customerId, partId, statusOverride, internalStatusOverride } = opts;
  const payload = {
    estimate: {
      companyId,
      customerId,
      customerName: "Slice7 Customer",
      customerEmail: "slice7@example.com",
      projectName: "Slice7 Project",
      estimateNumber: `EST-S7-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
      estimateDate: new Date().toISOString(),
      status: "pending",
      laborRate: "75.00",
      createdBy: "Slice7 Test",
    },
    items: [
      {
        description: "x",
        partId,
        partName: "Slice7 Part",
        partPrice: "10.00",
        quantity: 1,
        laborHours: "0.0",
        sortOrder: 0,
      },
    ],
  };
  if (statusOverride) payload.estimate.status = statusOverride;
  if (internalStatusOverride) payload.estimate.internalStatus = internalStatusOverride;
  const r = await api("POST", "/api/estimates", payload, hdrs);
  assert.equal(r.status, 201, `create estimate: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

describe("Slice 7 — estimate pending-approval queue & role gates", () => {
  let customerA;
  let customerB;
  let partId;

  before(async () => {
    customerA = await makeCustomer(COMPANY_A, ADMIN_A);
    customerB = await makeCustomer(COMPANY_B, ADMIN_B);
    partId = await makePart(ADMIN_A);
  });

  test("New estimates default to internalStatus=pending_approval, even if client tries to bypass", async () => {
    const id = await makeEstimate({
      hdrs: ADMIN_A,
      companyId: COMPANY_A,
      customerId: customerA,
      partId,
      internalStatusOverride: "sent_to_customer", // attempt to skip the queue
    });
    const get = await api("GET", `/api/estimates/${id}`, undefined, ADMIN_A);
    assert.equal(get.status, 200);
    assert.equal(
      get.body.internalStatus,
      "pending_approval",
      "POST /api/estimates must always force internalStatus=pending_approval",
    );
  });

  test("Internal-approve & queue endpoints reject irrigation_manager and field_tech with 403", async () => {
    const id = await makeEstimate({
      hdrs: ADMIN_A,
      companyId: COMPANY_A,
      customerId: customerA,
      partId,
    });
    for (const hdrs of [MANAGER_A, FIELD_TECH_A]) {
      const r1 = await api("PATCH", `/api/estimates/${id}/internal-approve`, {}, hdrs);
      assert.equal(r1.status, 403, `internal-approve must be 403 for ${hdrs["x-user-role"]}: ${JSON.stringify(r1.body)}`);
      const r2 = await api("GET", "/api/estimates/pending-approval", undefined, hdrs);
      assert.equal(r2.status, 403, `queue must be 403 for ${hdrs["x-user-role"]}: ${JSON.stringify(r2.body)}`);
      const r3 = await api("POST", `/api/estimates/${id}/send-approval-email`, {}, hdrs);
      assert.equal(r3.status, 403, `send-approval-email must be 403 for ${hdrs["x-user-role"]}`);
    }
  });

  test("Pending-approval queue is scoped to the caller's company", async () => {
    const idA = await makeEstimate({
      hdrs: ADMIN_A,
      companyId: COMPANY_A,
      customerId: customerA,
      partId,
    });
    const idB = await makeEstimate({
      hdrs: ADMIN_B,
      companyId: COMPANY_B,
      customerId: customerB,
      partId,
    });
    const queueA = await api("GET", "/api/estimates/pending-approval", undefined, BILLING_A);
    assert.equal(queueA.status, 200);
    assert.ok(Array.isArray(queueA.body));
    const idsA = queueA.body.map((e) => e.id);
    assert.ok(idsA.includes(idA), "company A queue must include its own pending estimate");
    assert.ok(!idsA.includes(idB), "company A queue must NOT include company B estimate");
    assert.ok(
      queueA.body.every((e) => e.internalStatus === "pending_approval"),
      "queue must only contain pending_approval estimates",
    );
  });

  test("Cross-company internal-approve from billing_manager B returns 404; super_admin succeeds", async () => {
    const idA = await makeEstimate({
      hdrs: ADMIN_A,
      companyId: COMPANY_A,
      customerId: customerA,
      partId,
    });
    const cross = await api("PATCH", `/api/estimates/${idA}/internal-approve`, {}, BILLING_B);
    assert.equal(
      cross.status,
      404,
      `cross-company internal-approve must 404 (not 403/200): ${JSON.stringify(cross.body)}`,
    );
    const verify = await api("GET", `/api/estimates/${idA}`, undefined, ADMIN_A);
    assert.equal(verify.body.internalStatus, "pending_approval", "estimate must NOT have been mutated by cross-company caller");

    const su = await api("PATCH", `/api/estimates/${idA}/internal-approve`, {}, SUPER_ADMIN);
    assert.equal(su.status, 200, `super_admin must bypass company scoping: ${JSON.stringify(su.body)}`);
    assert.equal(su.body.estimate?.internalStatus, "approved_internal");
  });
});

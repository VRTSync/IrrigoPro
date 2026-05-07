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
const ADMIN_A = headers("company_admin", COMPANY_A);
const BILLING_A = headers("billing_manager", COMPANY_A, "3");
const MANAGER_A = headers("irrigation_manager", COMPANY_A, "5");
const FIELD_TECH_A = headers("field_tech", COMPANY_A, "6");

let customerId;
let partId;

async function makeCustomer() {
  const r = await api("POST", "/api/customers", {
    companyId: COMPANY_A,
    name: `Slice10a Customer ${Date.now()}`,
    email: `slice10a-${Date.now()}@example.com`,
    laborRate: "75.00",
  }, ADMIN_A);
  assert.equal(r.status, 201, `customer create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function makePart() {
  const r = await api("POST", "/api/parts", {
    name: `Slice10a Part ${Date.now()}`,
    description: "",
    price: "10.00",
    sku: `S10A-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
    category: "general",
    companyId: COMPANY_A,
  }, ADMIN_A);
  assert.ok(r.status === 200 || r.status === 201, `part create: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function makeEstimate({ hdrs = ADMIN_A, internalStatus, status, estimateDate } = {}) {
  const r = await api("POST", "/api/estimates", {
    estimate: {
      companyId: COMPANY_A,
      customerId,
      customerName: "Slice10a Customer",
      customerEmail: `slice10a-${Date.now()}-${Math.floor(Math.random() * 99999)}@example.test`,
      projectName: "Slice10a Project",
      estimateNumber: `EST-S10A-${Date.now()}-${Math.floor(Math.random() * 99999)}`,
      estimateDate: (estimateDate ?? new Date()).toISOString(),
      status: status ?? "pending",
      laborRate: "75.00",
      createdBy: "Slice10a Test",
    },
    items: [
      { description: "x", partId, partName: "Slice10a Part",
        partPrice: "10.00", quantity: 1, laborHours: "0.0", sortOrder: 0 },
    ],
  }, hdrs);
  assert.equal(r.status, 201, `create estimate: ${JSON.stringify(r.body)}`);
  const id = r.body.id;
  // POST /api/estimates always forces internalStatus=pending_approval; if
  // the test wants a different starting state, push it directly via the
  // existing internal-approve route (or set it via the back door used by
  // Slice 7 tests would only get pending_approval). We need draft and
  // expired; both require manual SQL-equivalent moves via subsequent
  // transitions or PUT. Instead, set via the dedicated test-only path:
  // a PATCH to /api/estimates/:id won't accept internalStatus for normal
  // routes, but PUT /api/estimates/:id replaces the row entirely.
  if (internalStatus && internalStatus !== "pending_approval") {
    const cur = await api("GET", `/api/estimates/${id}`, undefined, ADMIN_A);
    const items = cur.body.items.map((it) => ({
      description: it.description, partId: it.partId, partName: it.partName,
      partPrice: it.partPrice, quantity: it.quantity, laborHours: it.laborHours,
      sortOrder: it.sortOrder,
    }));
    const upd = await api("PUT", `/api/estimates/${id}`, {
      estimate: {
        ...cur.body, internalStatus,
        items: undefined, lifecycleStatus: undefined,
      },
      items,
    }, ADMIN_A);
    assert.equal(upd.status, 200, `seed internalStatus: ${JSON.stringify(upd.body)}`);
  }
  return id;
}

describe("Slice 10a — POST /api/estimates/:id/transition", () => {
  before(async () => {
    customerId = await makeCustomer();
    partId = await makePart();
  });

  test("Every estimate read carries lifecycleStatus", async () => {
    const id = await makeEstimate();
    const get = await api("GET", `/api/estimates/${id}`, undefined, ADMIN_A);
    assert.equal(get.status, 200);
    assert.equal(get.body.lifecycleStatus, "pending_review");
    const list = await api("GET", "/api/estimates", undefined, ADMIN_A);
    assert.ok(Array.isArray(list.body));
    const row = list.body.find((e) => e.id === id);
    assert.ok(row, "estimate must appear in list");
    assert.equal(row.lifecycleStatus, "pending_review");
  });

  test("submit_for_review: draft → pending_approval (irrigation_manager)", async () => {
    const id = await makeEstimate({ internalStatus: "draft" });
    const pre = await api("GET", `/api/estimates/${id}`, undefined, ADMIN_A);
    assert.equal(pre.body.lifecycleStatus, "draft");

    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "submit_for_review" }, MANAGER_A);
    assert.equal(r.status, 200, `submit_for_review: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.estimate.internalStatus, "pending_approval");
    assert.equal(r.body.estimate.lifecycleStatus, "pending_review");
  });

  test("send_to_customer: pending_approval → sent (billing_manager)", async () => {
    const id = await makeEstimate();
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "send_to_customer" }, BILLING_A);
    assert.equal(r.status, 200, `send_to_customer: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.estimate.internalStatus, "sent_to_customer");
    assert.equal(r.body.estimate.lifecycleStatus, "sent");
    assert.ok(r.body.estimate.approvalToken, "should have approval token");
    assert.ok(r.body.estimate.approvalSentAt, "should have approvalSentAt");
  });

  test("resend: expired → sent, resets estimateDate (irrigation_manager)", async () => {
    const id = await makeEstimate({ internalStatus: "sent_to_customer", estimateDate: new Date(Date.now() - 45 * 86400_000) });
    const pre = await api("GET", `/api/estimates/${id}`, undefined, ADMIN_A);
    assert.equal(pre.body.lifecycleStatus, "expired", `expected expired, got ${pre.body.lifecycleStatus}`);
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "resend" }, MANAGER_A);
    assert.equal(r.status, 200, `resend: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.estimate.lifecycleStatus, "sent");
    assert.equal(r.body.estimate.internalStatus, "sent_to_customer");
    assert.equal(r.body.estimate.status, "pending");
  });

  test("INVALID: submit_for_review on a pending_approval estimate → 400", async () => {
    const id = await makeEstimate();
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "submit_for_review" }, MANAGER_A);
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test("INVALID: send_to_customer on a draft → 400", async () => {
    const id = await makeEstimate({ internalStatus: "draft" });
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "send_to_customer" }, BILLING_A);
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test("INVALID: resend on a fresh sent estimate (not expired) → 400", async () => {
    const id = await makeEstimate({ internalStatus: "sent_to_customer", estimateDate: new Date() });
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "resend" }, MANAGER_A);
    assert.equal(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test("ROLE GATE: field_tech cannot send_to_customer → 403", async () => {
    const id = await makeEstimate();
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "send_to_customer" }, FIELD_TECH_A);
    assert.equal(r.status, 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test("ROLE GATE: field_tech cannot submit_for_review → 403", async () => {
    const id = await makeEstimate({ internalStatus: "draft" });
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "submit_for_review" }, FIELD_TECH_A);
    assert.equal(r.status, 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  test("Unknown action → 400", async () => {
    const id = await makeEstimate();
    const r = await api("POST", `/api/estimates/${id}/transition`, { action: "delete_universe" }, ADMIN_A);
    assert.equal(r.status, 400);
  });
});

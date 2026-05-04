import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

let FIELD_TECH_USER_ID;

async function api(method, path, body, headers = ADMIN_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Test Customer BillingNum",
    email: `billingnum_${Date.now()}@example.com`,
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

function sheetPayload(customerId) {
  return {
    customerId,
    customerName: "Test Customer BillingNum",
    propertyAddress: "789 Number Way",
    workDate: new Date().toISOString().slice(0, 10),
    technicianName: "Num Tech",
    technicianId: FIELD_TECH_USER_ID,
    workDescription: "Billing number resilience test",
    status: "draft",
    totalHours: "1",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0",
    totalAmount: "50.00",
    photos: [],
  };
}

function parseBillingSeq(billingNumber) {
  const parts = billingNumber.split("-");
  return parseInt(parts[parts.length - 1], 10);
}

describe("Billing number resilience", () => {
  let customerId;

  before(async () => {
    customerId = await ensureCustomer();

    const uniqueSuffix = Date.now();
    const userRes = await api("POST", "/api/users", {
      username: `numtech_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Num Tech",
      email: `numtech_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(userRes.status, 201, `Field tech creation failed: ${JSON.stringify(userRes.body)}`);
    FIELD_TECH_USER_ID = userRes.body.id;
  });

  test("new billing number is strictly greater after a deletion", async () => {
    const createRes1 = await api("POST", "/api/billing-sheets", sheetPayload(customerId));
    assert.equal(createRes1.status, 200, `First create failed: ${JSON.stringify(createRes1.body)}`);
    const id1 = createRes1.body.id;
    const num1 = createRes1.body.billingNumber;

    const delRes = await api("DELETE", `/api/billing-sheets/${id1}`);
    assert.equal(delRes.status, 200, `Delete failed: ${JSON.stringify(delRes.body)}`);

    const createRes2 = await api("POST", "/api/billing-sheets", sheetPayload(customerId));
    assert.equal(createRes2.status, 200, `Second create failed: ${JSON.stringify(createRes2.body)}`);
    const num2 = createRes2.body.billingNumber;

    const seq1 = parseBillingSeq(num1);
    const seq2 = parseBillingSeq(num2);
    assert.ok(
      seq2 > seq1,
      `Expected second billing number sequence (${seq2} from ${num2}) to be strictly greater than the first (${seq1} from ${num1})`,
    );
  });

  test("two concurrent creates produce distinct billing numbers", async () => {
    const [resA, resB] = await Promise.all([
      api("POST", "/api/billing-sheets", sheetPayload(customerId)),
      api("POST", "/api/billing-sheets", sheetPayload(customerId)),
    ]);

    assert.equal(resA.status, 200, `Concurrent create A failed: ${JSON.stringify(resA.body)}`);
    assert.equal(resB.status, 200, `Concurrent create B failed: ${JSON.stringify(resB.body)}`);

    const numA = resA.body.billingNumber;
    const numB = resB.body.billingNumber;

    assert.notEqual(
      numA,
      numB,
      `Both concurrent creates received the same billing number: ${numA}`,
    );

    const seqA = parseBillingSeq(numA);
    const seqB = parseBillingSeq(numB);
    assert.ok(!isNaN(seqA), `Could not parse sequence from ${numA}`);
    assert.ok(!isNaN(seqB), `Could not parse sequence from ${numB}`);
  });
});

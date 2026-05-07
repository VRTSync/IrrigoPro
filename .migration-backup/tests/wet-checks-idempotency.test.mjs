import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE_URL = "http://localhost:5000";
const HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

async function api(method, path, body) {
  const opts = { method, headers: { ...HEADERS } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let customerId;
let wetCheckId;
let zoneRecordId;

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `Wet Check Idempotency Customer ${Date.now()}`,
    email: `wcidem-${Date.now()}@example.com`,
    address: "100 Idempotent Ln",
    laborRate: "50.00",
    totalControllers: 2,
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Wet check capture: clientId idempotency", () => {
  before(async () => {
    customerId = await ensureCustomer();
  });

  test("POST /api/wet-checks twice with same clientId returns the same row", async () => {
    const clientId = randomUUID();

    const first = await api("POST", "/api/wet-checks", { customerId, clientId });
    assert.ok(first.status === 200 || first.status === 201,
      `First create failed: ${first.status} ${JSON.stringify(first.body)}`);
    assert.ok(first.body?.id, "First create missing id");
    wetCheckId = first.body.id;

    const second = await api("POST", "/api/wet-checks", { customerId, clientId });
    assert.ok(second.status === 200 || second.status === 201,
      `Second create failed: ${second.status} ${JSON.stringify(second.body)}`);
    assert.equal(second.body.id, first.body.id,
      "Re-posting with the same clientId must return the same wet check id");

    // Verify only ONE wet check row exists for this customer (no hidden duplicates).
    const list = await api("GET", `/api/wet-checks`);
    assert.equal(list.status, 200);
    const matching = (list.body ?? []).filter((wc) => wc.customerId === customerId);
    assert.equal(matching.length, 1,
      `Expected exactly one wet check row for customer ${customerId}, got ${matching.length}: ${JSON.stringify(matching.map((m) => m.id))}`);
  });

  test("POST zone-records twice with same clientId returns the same row", async () => {
    assert.ok(wetCheckId, "Need a wet check from previous test");
    const clientId = randomUUID();

    const first = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
      controllerLetter: "A",
      zoneNumber: 1,
      status: "checked_with_issues",
      ranSuccessfully: true,
      clientId,
    });
    assert.equal(first.status, 201, `First zone upsert failed: ${JSON.stringify(first.body)}`);
    assert.ok(first.body?.id, "First zone record missing id");
    zoneRecordId = first.body.id;

    const second = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
      controllerLetter: "A",
      zoneNumber: 1,
      status: "checked_with_issues",
      ranSuccessfully: true,
      clientId,
    });
    assert.equal(second.status, 201, `Second zone upsert failed: ${JSON.stringify(second.body)}`);
    assert.equal(second.body.id, first.body.id,
      "Re-posting a zone record with the same clientId must not create a duplicate");

    // Verify exactly one zone record exists for (wetCheck, A, 1) — no hidden duplicates.
    const detail = await api("GET", `/api/wet-checks/${wetCheckId}`);
    assert.equal(detail.status, 200);
    const a1Records = (detail.body.zoneRecords ?? [])
      .filter((zr) => zr.controllerLetter === "A" && zr.zoneNumber === 1);
    assert.equal(a1Records.length, 1,
      `Expected exactly one (A,1) zone record, got ${a1Records.length}: ${JSON.stringify(a1Records.map((r) => r.id))}`);
  });

  test("POST findings twice with same clientId returns the same row", async () => {
    assert.ok(zoneRecordId, "Need a zone record from previous test");
    const clientId = randomUUID();

    const first = await api("POST", `/api/wet-checks/zone-records/${zoneRecordId}/findings`, {
      issueType: "head_replacement",
      quantity: 1,
      laborHours: "0.25",
      clientId,
    });
    assert.equal(first.status, 201, `First finding create failed: ${JSON.stringify(first.body)}`);
    assert.ok(first.body?.id, "First finding missing id");

    const second = await api("POST", `/api/wet-checks/zone-records/${zoneRecordId}/findings`, {
      issueType: "head_replacement",
      quantity: 1,
      laborHours: "0.25",
      clientId,
    });
    assert.equal(second.status, 201, `Second finding create failed: ${JSON.stringify(second.body)}`);
    assert.equal(second.body.id, first.body.id,
      "Re-posting a finding with the same clientId must not create a duplicate");

    // Verify no duplicate rows leaked into the wet check.
    const detail = await api("GET", `/api/wet-checks/${wetCheckId}`);
    assert.equal(detail.status, 200);
    const findingsForZone = (detail.body.zoneRecords ?? [])
      .find(zr => zr.id === zoneRecordId)?.findings ?? [];
    const matching = findingsForZone.filter(f => f.id === first.body.id);
    assert.equal(matching.length, 1,
      `Expected exactly one finding row, got ${matching.length}: ${JSON.stringify(findingsForZone)}`);
  });
});

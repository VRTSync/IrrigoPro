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
let pendingFindingId;
let resolvedFindingId;

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `Wet Check Immutability Customer ${Date.now()}`,
    email: `wcimmut-${Date.now()}@example.com`,
    address: "200 Snapshot Way",
    laborRate: "50.00",
    totalControllers: 1,
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Wet check capture: finding pricing immutability after resolution", () => {
  before(async () => {
    customerId = await ensureCustomer();

    const wc = await api("POST", "/api/wet-checks", { customerId, clientId: randomUUID() });
    assert.ok(wc.status === 200 || wc.status === 201, `Wet check create failed: ${JSON.stringify(wc.body)}`);
    wetCheckId = wc.body.id;

    const zr = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
      controllerLetter: "A",
      zoneNumber: 1,
      status: "checked_with_issues",
      ranSuccessfully: true,
      clientId: randomUUID(),
    });
    assert.equal(zr.status, 201, `Zone record create failed: ${JSON.stringify(zr.body)}`);
    zoneRecordId = zr.body.id;
  });

  test("Pending finding allows pricing-field edits", async () => {
    const created = await api("POST", `/api/wet-checks/zone-records/${zoneRecordId}/findings`, {
      issueType: "head_replacement",
      quantity: 1,
      laborHours: "0.25",
      clientId: randomUUID(),
    });
    assert.equal(created.status, 201, `Finding create failed: ${JSON.stringify(created.body)}`);
    pendingFindingId = created.body.id;
    assert.equal(created.body.resolution, "pending");

    const patch = await api("PATCH", `/api/wet-checks/findings/${pendingFindingId}`, {
      quantity: 3,
      laborHours: "0.50",
    });
    assert.equal(patch.status, 200, `Pending PATCH must succeed: ${JSON.stringify(patch.body)}`);
    assert.equal(patch.body.quantity, 3);
    assert.equal(String(patch.body.laborHours), "0.50");
  });

  test("Once resolution != pending, pricing fields are immutable", async () => {
    const created = await api("POST", `/api/wet-checks/zone-records/${zoneRecordId}/findings`, {
      issueType: "head_replacement",
      quantity: 2,
      laborHours: "0.25",
      clientId: randomUUID(),
    });
    assert.equal(created.status, 201, `Finding create failed: ${JSON.stringify(created.body)}`);
    resolvedFindingId = created.body.id;

    // Mark as repaired in field — flips resolution off "pending".
    const resolve = await api("PATCH", `/api/wet-checks/findings/${resolvedFindingId}`, {
      repairedInField: true,
    });
    assert.equal(resolve.status, 200, `Resolve PATCH failed: ${JSON.stringify(resolve.body)}`);
    assert.equal(resolve.body.resolution, "repaired_in_field",
      `Expected resolution=repaired_in_field, got ${resolve.body.resolution}`);

    // Snapshot the immutable fields BEFORE attempting mutation.
    const before = await api("GET", `/api/wet-checks/${wetCheckId}`);
    const beforeFinding = before.body.zoneRecords
      .find(zr => zr.id === zoneRecordId).findings
      .find(f => f.id === resolvedFindingId);
    assert.ok(beforeFinding, "Resolved finding must exist before mutation attempt");

    // Each pricing-field PATCH must be rejected.
    for (const patch of [{ quantity: 99 }, { laborHours: "9.99" }, { partId: 1 }]) {
      const res = await api("PATCH", `/api/wet-checks/findings/${resolvedFindingId}`, patch);
      assert.equal(res.status, 400,
        `PATCH ${JSON.stringify(patch)} on resolved finding must be rejected, got ${res.status} ${JSON.stringify(res.body)}`);
      assert.match(String(res.body?.message ?? ""), /immutable|already routed/i,
        `Rejection message should mention immutability, got: ${JSON.stringify(res.body)}`);
    }

    // Verify nothing changed server-side.
    const after = await api("GET", `/api/wet-checks/${wetCheckId}`);
    const afterFinding = after.body.zoneRecords
      .find(zr => zr.id === zoneRecordId).findings
      .find(f => f.id === resolvedFindingId);
    assert.equal(afterFinding.quantity, beforeFinding.quantity,
      "quantity must not change after rejected PATCH");
    assert.equal(String(afterFinding.laborHours), String(beforeFinding.laborHours),
      "laborHours must not change after rejected PATCH");
    assert.equal(afterFinding.partId, beforeFinding.partId,
      "partId must not change after rejected PATCH");
    assert.equal(String(afterFinding.partPrice ?? ""), String(beforeFinding.partPrice ?? ""),
      "partPrice snapshot must not change after rejected PATCH");
  });

  test("Non-pricing fields (notes, severity) are still editable on resolved findings", async () => {
    assert.ok(resolvedFindingId, "Need resolved finding from previous test");
    const res = await api("PATCH", `/api/wet-checks/findings/${resolvedFindingId}`, {
      notes: "Field tech noted: replaced head body.",
      severity: "low",
    });
    assert.equal(res.status, 200,
      `Notes/severity PATCH must succeed on resolved finding: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.notes, "Field tech noted: replaced head body.");
    assert.equal(res.body.severity, "low");
  });
});

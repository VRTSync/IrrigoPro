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

async function ensureCustomer(label, totalControllers = 1) {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `Wet Check ${label} Customer ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email: `wc-${label.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    address: "300 Submit St",
    laborRate: "50.00",
    totalControllers,
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Wet check capture: submit guard + N/A backfill", () => {
  let customerId;
  let wetCheckId;

  before(async () => {
    customerId = await ensureCustomer("Submit");
    const wc = await api("POST", "/api/wet-checks", { customerId, clientId: randomUUID() });
    assert.ok(wc.status === 200 || wc.status === 201,
      `Wet check create failed: ${JSON.stringify(wc.body)}`);
    wetCheckId = wc.body.id;

    // Shrink controller A to 3 zones so the implicit-N/A backfill is small
    // and easy to assert against.
    const shrink = await api("PATCH", `/api/properties/${customerId}/controllers`, {
      controllerLetter: "A",
      zoneCount: 3,
    });
    assert.equal(shrink.status, 200, `Shrink controller failed: ${JSON.stringify(shrink.body)}`);
  });

  test("POST /api/wet-checks/:id/submit rejects when zero zones are actively checked", async () => {
    const res = await api("POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(res.status, 400,
      `Expected 400 on zero-checked submit, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message ?? ""), /zero zones checked/i,
      `Rejection message should mention 'zero zones checked', got: ${JSON.stringify(res.body)}`);

    // Sanity: even a not_applicable-only zone record must NOT count as
    // actively checked. Submit must still be rejected.
    const naOnly = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
      controllerLetter: "A",
      zoneNumber: 2,
      status: "not_applicable",
      clientId: randomUUID(),
    });
    assert.equal(naOnly.status, 201, `N/A zone create failed: ${JSON.stringify(naOnly.body)}`);

    const stillRejected = await api("POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(stillRejected.status, 400,
      `Expected 400 when only N/A zone records exist, got ${stillRejected.status}: ${JSON.stringify(stillRejected.body)}`);
  });

  test("POST /api/wet-checks/:id/submit accepts after one zone is checked, and GET shows N/A backfill", async () => {
    const zr = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
      controllerLetter: "A",
      zoneNumber: 1,
      status: "checked_ok",
      ranSuccessfully: true,
      clientId: randomUUID(),
    });
    assert.equal(zr.status, 201, `Active zone create failed: ${JSON.stringify(zr.body)}`);

    const submit = await api("POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(submit.status, 200, `Submit failed: ${JSON.stringify(submit.body)}`);
    assert.equal(submit.body.status, "submitted",
      `Wet check should be submitted, got ${submit.body.status}`);

    const detail = await api("GET", `/api/wet-checks/${wetCheckId}`);
    assert.equal(detail.status, 200);
    const aRecords = (detail.body.zoneRecords ?? [])
      .filter((zr) => zr.controllerLetter === "A");
    // Controller A has 3 zones: zone 1 checked_ok, zone 2 was created
    // explicitly as not_applicable, zone 3 must be implicitly backfilled
    // as N/A by submit.
    const byZone = new Map(aRecords.map(r => [r.zoneNumber, r]));
    assert.ok(byZone.get(1), "Zone 1 record must exist");
    assert.equal(byZone.get(1).status, "checked_ok",
      `Zone 1 should remain checked_ok, got ${byZone.get(1).status}`);
    assert.ok(byZone.get(2), "Zone 2 record must exist");
    assert.equal(byZone.get(2).status, "not_applicable",
      `Zone 2 should remain not_applicable, got ${byZone.get(2).status}`);
    assert.ok(byZone.get(3),
      `Zone 3 must be backfilled by submit, got A records: ${JSON.stringify(aRecords.map(r => ({ z: r.zoneNumber, s: r.status })))}`);
    assert.equal(byZone.get(3).status, "not_applicable",
      `Backfilled zone 3 should be not_applicable, got ${byZone.get(3).status}`);
  });
});

describe("Wet check capture: photo cross-record linkage validation", () => {
  let customerA;
  let customerB;
  let wetCheckA;
  let wetCheckB;
  let zoneRecordA;
  let zoneRecordB;
  let findingA;
  let findingB;

  before(async () => {
    customerA = await ensureCustomer("PhotoA");
    customerB = await ensureCustomer("PhotoB");

    const wcA = await api("POST", "/api/wet-checks", { customerId: customerA, clientId: randomUUID() });
    assert.ok(wcA.status === 200 || wcA.status === 201, `WC A create failed: ${JSON.stringify(wcA.body)}`);
    wetCheckA = wcA.body.id;

    const wcB = await api("POST", "/api/wet-checks", { customerId: customerB, clientId: randomUUID() });
    assert.ok(wcB.status === 200 || wcB.status === 201, `WC B create failed: ${JSON.stringify(wcB.body)}`);
    wetCheckB = wcB.body.id;

    const zrA = await api("POST", `/api/wet-checks/${wetCheckA}/zone-records`, {
      controllerLetter: "A", zoneNumber: 1, status: "checked_with_issues",
      ranSuccessfully: true, clientId: randomUUID(),
    });
    assert.equal(zrA.status, 201, `ZR A create failed: ${JSON.stringify(zrA.body)}`);
    zoneRecordA = zrA.body.id;

    const zrB = await api("POST", `/api/wet-checks/${wetCheckB}/zone-records`, {
      controllerLetter: "A", zoneNumber: 1, status: "checked_with_issues",
      ranSuccessfully: true, clientId: randomUUID(),
    });
    assert.equal(zrB.status, 201, `ZR B create failed: ${JSON.stringify(zrB.body)}`);
    zoneRecordB = zrB.body.id;

    const fA = await api("POST", `/api/wet-checks/zone-records/${zoneRecordA}/findings`, {
      issueType: "head_replacement", quantity: 1, laborHours: "0.25", clientId: randomUUID(),
    });
    assert.equal(fA.status, 201, `Finding A create failed: ${JSON.stringify(fA.body)}`);
    findingA = fA.body.id;

    const fB = await api("POST", `/api/wet-checks/zone-records/${zoneRecordB}/findings`, {
      issueType: "head_replacement", quantity: 1, laborHours: "0.25", clientId: randomUUID(),
    });
    assert.equal(fB.status, 201, `Finding B create failed: ${JSON.stringify(fB.body)}`);
    findingB = fB.body.id;
  });

  test("POST /api/wet-checks/:id/photos rejects a foreign zoneRecordId", async () => {
    const res = await api("POST", `/api/wet-checks/${wetCheckA}/photos`, {
      zoneRecordId: zoneRecordB,
      url: `photos/${randomUUID()}`,
      clientId: randomUUID(),
    });
    assert.equal(res.status, 400,
      `Foreign zoneRecordId must be rejected, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message ?? ""), /does not belong/i,
      `Rejection should explain cross-record mismatch, got: ${JSON.stringify(res.body)}`);
  });

  test("POST /api/wet-checks/:id/photos rejects a foreign findingId", async () => {
    const res = await api("POST", `/api/wet-checks/${wetCheckA}/photos`, {
      findingId: findingB,
      url: `photos/${randomUUID()}`,
      clientId: randomUUID(),
    });
    assert.equal(res.status, 400,
      `Foreign findingId must be rejected, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message ?? ""), /does not belong/i,
      `Rejection should explain cross-record mismatch, got: ${JSON.stringify(res.body)}`);
  });

  test("POST /api/wet-checks/:id/photos accepts matching zoneRecordId + findingId, and dedupes by clientId", async () => {
    const clientId = randomUUID();
    const url = `photos/${randomUUID()}`;
    const first = await api("POST", `/api/wet-checks/${wetCheckA}/photos`, {
      zoneRecordId: zoneRecordA,
      findingId: findingA,
      url,
      clientId,
    });
    assert.equal(first.status, 201, `Matching photo create failed: ${JSON.stringify(first.body)}`);
    assert.ok(first.body?.id, "Created photo missing id");
    assert.equal(first.body.zoneRecordId, zoneRecordA);
    assert.equal(first.body.findingId, findingA);

    // Re-posting the same clientId must return the existing row (no
    // duplicate insert), even with a different url payload.
    const second = await api("POST", `/api/wet-checks/${wetCheckA}/photos`, {
      zoneRecordId: zoneRecordA,
      findingId: findingA,
      url: `photos/${randomUUID()}`,
      clientId,
    });
    assert.equal(second.status, 201, `Dedupe re-post failed: ${JSON.stringify(second.body)}`);
    assert.equal(second.body.id, first.body.id,
      "Re-posting a photo with the same clientId must return the same row id");

    // Verify exactly one matching photo exists in the wet check detail.
    const detail = await api("GET", `/api/wet-checks/${wetCheckA}`);
    assert.equal(detail.status, 200);
    const matching = (detail.body.photos ?? []).filter(p => p.id === first.body.id);
    assert.equal(matching.length, 1,
      `Expected exactly one photo row for clientId, got ${matching.length}: ${JSON.stringify(detail.body.photos)}`);
  });
});

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

const { db } = await import("../server/db.ts");
const { billingSheets, estimates, workOrders, wetCheckFindings } =
  await import("../shared/schema.ts");
const { eq } = await import("drizzle-orm");

async function api(method, path, body) {
  const opts = { method, headers: { ...HEADERS } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const LABOR_RATE = 50; // $/hour
const PART_PRICE = 20; // $/each
const QTY = 2;
const HOURS = 0.5;
const EXPECTED_LINE_TOTAL = PART_PRICE * QTY + HOURS * LABOR_RATE; // 40 + 25 = 65

async function createCustomer(label) {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `WC Convert ${label} ${Date.now()}`,
    email: `wcconv-${label}-${Date.now()}@example.com`,
    address: "1 Convert Ln",
    laborRate: LABOR_RATE.toFixed(2),
    totalControllers: 2,
  });
  assert.equal(res.status, 201, `customer create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createPart() {
  const sku = `WC-CONVERT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const res = await api("POST", "/api/parts", {
    companyId: 99,
    name: "WC Convert Test Head",
    sku,
    price: PART_PRICE.toFixed(2),
    cost: "5.00",
    category: "Head",
  });
  assert.ok(res.status === 200 || res.status === 201, `part create: ${res.status}`);
  return res.body.id;
}

async function createWetCheck(customerId) {
  const res = await api("POST", "/api/wet-checks", { customerId, clientId: randomUUID() });
  assert.ok(res.status === 200 || res.status === 201, `wc create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function addZone(wetCheckId, zoneNumber) {
  const res = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
    controllerLetter: "A",
    zoneNumber,
    status: "checked_with_issues",
    ranSuccessfully: true,
    clientId: randomUUID(),
  });
  assert.equal(res.status, 201, `zone create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function addFinding(zoneRecordId, partId) {
  const body = {
    issueType: "head_replacement",
    quantity: QTY,
    laborHours: HOURS.toFixed(2),
    clientId: randomUUID(),
  };
  if (partId != null) body.partId = partId;
  const res = await api("POST", `/api/wet-checks/zone-records/${zoneRecordId}/findings`, body);
  assert.equal(res.status, 201, `finding create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function getWetCheck(wetCheckId) {
  const res = await api("GET", `/api/wet-checks/${wetCheckId}`);
  assert.equal(res.status, 200);
  return res.body;
}

function findingFromTree(wc, findingId) {
  for (const zr of wc.zoneRecords ?? []) {
    const f = (zr.findings ?? []).find(x => x.id === findingId);
    if (f) return f;
  }
  return null;
}

describe("Wet check approve / route / convert", () => {
  let customerId;
  let partId;
  let wetCheckId;
  let f1, f2, f3, f4, f5; // repaired, sent_to_estimate, deferred, documented_only, pending
  let convertResult;

  before(async () => {
    customerId = await createCustomer("primary");
    partId = await createPart();
    wetCheckId = await createWetCheck(customerId);
    const z1 = await addZone(wetCheckId, 1);
    const z2 = await addZone(wetCheckId, 2);
    const z3 = await addZone(wetCheckId, 3);
    const z4 = await addZone(wetCheckId, 4);
    const z5 = await addZone(wetCheckId, 5);
    f1 = await addFinding(z1, partId);
    f2 = await addFinding(z2, partId);
    f3 = await addFinding(z3, partId);
    f4 = await addFinding(z4, null); // documented_only — no part required
    f5 = await addFinding(z5, partId);
  });

  test("Submit + approve transitions wet check status", async () => {
    const submit = await api("POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(submit.status, 200, `submit: ${JSON.stringify(submit.body)}`);
    assert.equal(submit.body.status, "submitted");

    const approve = await api("POST", `/api/wet-checks/${wetCheckId}/approve`, {});
    assert.equal(approve.status, 200, `approve: ${JSON.stringify(approve.body)}`);
    assert.equal(approve.body.status, "approved");
    assert.ok(approve.body.approvedAt, "approvedAt must be stamped");
    assert.equal(approve.body.approvedBy, 53);
  });

  test("Route findings to each terminal resolution", async () => {
    const routings = [
      [f1, "repaired_in_field"],
      [f2, "sent_to_estimate"],
      [f3, "deferred_to_work_order"],
      [f4, "documented_only"],
    ];
    for (const [fid, resolution] of routings) {
      const res = await api("PATCH", `/api/wet-checks/findings/${fid}/route`, { resolution });
      assert.equal(res.status, 200, `route ${fid}→${resolution}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.resolution, resolution);
      assert.ok(res.body.resolutionDecidedAt, "resolutionDecidedAt must be stamped");
    }
    // f5 stays pending so wet check ends in partially_converted.
  });

  test("Convert produces at most one billing sheet, one estimate, one WO", async () => {
    const res = await api("POST", `/api/wet-checks/${wetCheckId}/convert`, {});
    assert.equal(res.status, 200, `convert: ${JSON.stringify(res.body)}`);
    convertResult = res.body;
    assert.ok(convertResult.billingSheetId, "expected billingSheetId");
    assert.ok(convertResult.estimateId, "expected estimateId");
    assert.ok(convertResult.workOrderId, "expected workOrderId");

    // Status: partially_converted because f5 is still pending.
    assert.equal(convertResult.wetCheck.status, "partially_converted");
    assert.equal(convertResult.wetCheck.fullyConvertedAt, null,
      "fullyConvertedAt must be null while pending findings remain");

    // DB-level uniqueness: exactly one BS / Est / WO carry the wet check FK.
    const bsRows = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    const bsIds = new Set(bsRows.map(r => r.billingSheetId).filter(Boolean));
    const estIds = new Set(bsRows.map(r => r.estimateId).filter(Boolean));
    const woIds = new Set(bsRows.map(r => r.workOrderId).filter(Boolean));
    assert.equal(bsIds.size, 1, `expected one billing sheet, got ${[...bsIds]}`);
    assert.equal(estIds.size, 1, `expected one estimate, got ${[...estIds]}`);
    assert.equal(woIds.size, 1, `expected one work order, got ${[...woIds]}`);
  });

  test("Snapshot totals match partPrice*qty + laborHours*customerLaborRate", async () => {
    // Billing sheet (repaired)
    const bs = await api("GET", `/api/billing-sheets/${convertResult.billingSheetId}`);
    assert.equal(bs.status, 200);
    assert.ok(Math.abs(parseFloat(bs.body.partsSubtotal) - PART_PRICE * QTY) < 0.01,
      `bs partsSubtotal ${bs.body.partsSubtotal} != ${PART_PRICE * QTY}`);
    assert.ok(Math.abs(parseFloat(bs.body.laborSubtotal) - HOURS * LABOR_RATE) < 0.01,
      `bs laborSubtotal ${bs.body.laborSubtotal} != ${HOURS * LABOR_RATE}`);
    assert.ok(Math.abs(parseFloat(bs.body.totalAmount) - EXPECTED_LINE_TOTAL) < 0.01,
      `bs totalAmount ${bs.body.totalAmount} != ${EXPECTED_LINE_TOTAL}`);
    // Locked snapshot rate
    assert.ok(Math.abs(parseFloat(bs.body.appliedLaborRate) - LABOR_RATE) < 0.01,
      `bs appliedLaborRate ${bs.body.appliedLaborRate} != ${LABOR_RATE}`);

    // Estimate (sent_to_estimate)
    const est = await api("GET", `/api/estimates/${convertResult.estimateId}`);
    assert.equal(est.status, 200);
    assert.ok(Math.abs(parseFloat(est.body.partsSubtotal) - PART_PRICE * QTY) < 0.01,
      `est partsSubtotal ${est.body.partsSubtotal} != ${PART_PRICE * QTY}`);
    assert.ok(Math.abs(parseFloat(est.body.laborSubtotal) - HOURS * LABOR_RATE) < 0.01,
      `est laborSubtotal ${est.body.laborSubtotal} != ${HOURS * LABOR_RATE}`);
    assert.ok(Math.abs(parseFloat(est.body.totalAmount) - EXPECTED_LINE_TOTAL) < 0.01,
      `est totalAmount ${est.body.totalAmount} != ${EXPECTED_LINE_TOTAL}`);
    assert.ok(Math.abs(parseFloat(est.body.appliedLaborRate) - LABOR_RATE) < 0.01,
      `est appliedLaborRate ${est.body.appliedLaborRate} != ${LABOR_RATE}`);

    // Work order (deferred)
    const wo = await api("GET", `/api/work-orders/${convertResult.workOrderId}`);
    assert.equal(wo.status, 200);
    assert.ok(Math.abs(parseFloat(wo.body.partsSubtotal) - PART_PRICE * QTY) < 0.01,
      `wo partsSubtotal ${wo.body.partsSubtotal} != ${PART_PRICE * QTY}`);
    assert.ok(Math.abs(parseFloat(wo.body.laborSubtotal) - HOURS * LABOR_RATE) < 0.01,
      `wo laborSubtotal ${wo.body.laborSubtotal} != ${HOURS * LABOR_RATE}`);
    assert.ok(Math.abs(parseFloat(wo.body.totalAmount) - EXPECTED_LINE_TOTAL) < 0.01,
      `wo totalAmount ${wo.body.totalAmount} != ${EXPECTED_LINE_TOTAL}`);
    assert.ok(Math.abs(parseFloat(wo.body.appliedLaborRate) - LABOR_RATE) < 0.01,
      `wo appliedLaborRate ${wo.body.appliedLaborRate} != ${LABOR_RATE}`);
  });

  test("documented_only finding stamps convertedAt but no FK", async () => {
    const wc = await getWetCheck(wetCheckId);
    const f = findingFromTree(wc, f4);
    assert.ok(f, "documented finding must still be present");
    assert.ok(f.convertedAt, "documented_only finding must have convertedAt");
    assert.equal(f.billingSheetId, null);
    assert.equal(f.estimateId, null);
    assert.equal(f.workOrderId, null);
  });

  test("Already-converted findings cannot be re-routed", async () => {
    const res = await api("PATCH", `/api/wet-checks/findings/${f1}/route`,
      { resolution: "deferred_to_work_order" });
    assert.equal(res.status, 400,
      `re-route should fail, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message ?? ""), /already converted|immutable/i);

    // Verify nothing changed.
    const wc = await getWetCheck(wetCheckId);
    const f = findingFromTree(wc, f1);
    assert.equal(f.resolution, "repaired_in_field");
    assert.equal(f.billingSheetId, convertResult.billingSheetId);
  });

  test("Already-converted findings cannot be re-priced", async () => {
    const res = await api("PATCH", `/api/wet-checks/findings/${f1}`, { quantity: 99 });
    assert.equal(res.status, 400,
      `re-price should fail, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message ?? ""), /already converted|immutable/i);

    const wc = await getWetCheck(wetCheckId);
    const f = findingFromTree(wc, f1);
    assert.equal(f.quantity, QTY, "quantity must not change");
  });

  test("Re-converting after the last finding is routed flips to converted (fullyConvertedAt set)", async () => {
    // Route the still-pending f5 → repaired (will append to the existing BS).
    const route = await api("PATCH", `/api/wet-checks/findings/${f5}/route`,
      { resolution: "repaired_in_field" });
    assert.equal(route.status, 200, `route f5: ${JSON.stringify(route.body)}`);

    const res = await api("POST", `/api/wet-checks/${wetCheckId}/convert`, {});
    assert.equal(res.status, 200, `second convert: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.wetCheck.status, "converted");
    assert.ok(res.body.wetCheck.fullyConvertedAt, "fullyConvertedAt must be set when no pending remain");

    // Same destinations are reused — no new BS/Est/WO are created.
    assert.equal(res.body.billingSheetId, convertResult.billingSheetId);
    assert.equal(res.body.estimateId, convertResult.estimateId);
    assert.equal(res.body.workOrderId, convertResult.workOrderId);

    // Existing BS now has 2 repaired lines; total should double.
    const bs = await api("GET", `/api/billing-sheets/${convertResult.billingSheetId}`);
    assert.equal(bs.status, 200);
    assert.ok(Math.abs(parseFloat(bs.body.totalAmount) - 2 * EXPECTED_LINE_TOTAL) < 0.01,
      `appended bs totalAmount ${bs.body.totalAmount} != ${2 * EXPECTED_LINE_TOTAL}`);
  });
});

describe("Wet check convert: sent_to_estimate without partId rolls back the whole conversion", () => {
  let customerId;
  let partId;
  let wetCheckId;
  let goodFinding;
  let badFinding;

  before(async () => {
    customerId = await createCustomer("rollback");
    partId = await createPart();
    wetCheckId = await createWetCheck(customerId);
    const z1 = await addZone(wetCheckId, 1);
    const z2 = await addZone(wetCheckId, 2);
    goodFinding = await addFinding(z1, partId);   // would create a BS
    badFinding = await addFinding(z2, null);      // sent_to_estimate without part → must throw

    const submit = await api("POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(submit.status, 200, `submit: ${JSON.stringify(submit.body)}`);
    const approve = await api("POST", `/api/wet-checks/${wetCheckId}/approve`, {});
    assert.equal(approve.status, 200, `approve: ${JSON.stringify(approve.body)}`);

    const r1 = await api("PATCH", `/api/wet-checks/findings/${goodFinding}/route`,
      { resolution: "repaired_in_field" });
    assert.equal(r1.status, 200, `route good: ${JSON.stringify(r1.body)}`);
    const r2 = await api("PATCH", `/api/wet-checks/findings/${badFinding}/route`,
      { resolution: "sent_to_estimate" });
    assert.equal(r2.status, 200, `route bad: ${JSON.stringify(r2.body)}`);
  });

  test("Convert fails atomically — no BS, no estimate, no WO survive", async () => {
    const res = await api("POST", `/api/wet-checks/${wetCheckId}/convert`, {});
    assert.equal(res.status, 400,
      `convert should fail, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message ?? ""), /without a part|cannot be sent to estimate/i);

    // Nothing was persisted: every finding's FK should still be null and
    // convertedAt unset, and no BS/Est/WO row should reference the wet check.
    const findings = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    for (const f of findings) {
      assert.equal(f.billingSheetId, null, `finding ${f.id} BS FK leaked`);
      assert.equal(f.estimateId, null, `finding ${f.id} estimate FK leaked`);
      assert.equal(f.workOrderId, null, `finding ${f.id} WO FK leaked`);
      assert.equal(f.convertedAt, null, `finding ${f.id} convertedAt leaked`);
    }

    // Wet check status is unchanged (still approved), fullyConvertedAt null.
    const wc = await getWetCheck(wetCheckId);
    assert.equal(wc.status, "approved", `wet check status changed to ${wc.status}`);
    assert.equal(wc.fullyConvertedAt, null);

    // No billing sheet / estimate / work order for this customer carries the
    // wet-check naming pattern (BS-WC-<id>-, EST-WC-<id>-, WO-WC-<id>-).
    const bsForCust = await db.select().from(billingSheets)
      .where(eq(billingSheets.customerId, customerId));
    assert.equal(bsForCust.length, 0, `BS leak: ${JSON.stringify(bsForCust.map(b => b.billingNumber))}`);
    const estForCust = await db.select().from(estimates)
      .where(eq(estimates.customerId, customerId));
    assert.equal(estForCust.length, 0, `Estimate leak: ${JSON.stringify(estForCust.map(e => e.estimateNumber))}`);
    const woForCust = await db.select().from(workOrders)
      .where(eq(workOrders.customerId, customerId));
    assert.equal(woForCust.length, 0, `WO leak: ${JSON.stringify(woForCust.map(w => w.workOrderNumber))}`);
  });
});

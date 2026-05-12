// Slice 2B — manager triage of submitted wet checks: queue (pending-review),
// approve (status flips but stays in the queue), routing each finding to one
// of the four terminal resolutions, /convert producing a billing sheet +
// estimate + work order with back-links, "partially_converted" guarantee
// while a finding remains pending, and idempotency of a second /convert call
// (existing destinations are reused — no duplicates).
//
// Pattern reference: .migration-backup/tests/wet-checks-idempotency.test.mjs
// (HTTP-level test against the running API server). The current test runner
// only picks up *.test.ts under each artifact, so this file is run manually
// via `node --test tests/wet-checks-manager-review.test.mjs` against a live
// API server (see the separate "Run the wet check tests automatically with
// the rest of the test suite" task for wiring it into CI).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.WET_CHECK_TEST_BASE_URL ?? "http://localhost:8080";
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

const LABOR_RATE = 50;
const PART_PRICE = 20;
const QTY = 2;
const HOURS = 0.5;
const EXPECTED_LINE_TOTAL = PART_PRICE * QTY + HOURS * LABOR_RATE; // 65

async function createCustomer(label) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `WC Mgr Review ${label} ${tag}`,
    email: `wcmgr-${label}-${tag}@example.com`,
    address: "10 Manager Review Ln",
    laborRate: LABOR_RATE.toFixed(2),
    totalControllers: 2,
  });
  assert.equal(res.status, 201, `customer create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createPart() {
  const sku = `WC-MGR-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const res = await api("POST", "/api/parts", {
    companyId: 99,
    name: "WC Mgr Test Head",
    sku,
    price: PART_PRICE.toFixed(2),
    cost: "5.00",
    category: "Head",
  });
  assert.ok(res.status === 200 || res.status === 201,
    `part create: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createWetCheck(customerId) {
  const res = await api("POST", "/api/wet-checks", {
    customerId,
    clientId: randomUUID(),
  });
  assert.ok(res.status === 200 || res.status === 201,
    `wet check create: ${JSON.stringify(res.body)}`);
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

async function addFinding(zoneRecordId, issueType, partId) {
  const body = {
    issueType,
    quantity: QTY,
    laborHours: HOURS.toFixed(2),
    clientId: randomUUID(),
  };
  if (partId != null) body.partId = partId;
  const res = await api("POST",
    `/api/wet-checks/zone-records/${zoneRecordId}/findings`, body);
  assert.equal(res.status, 201,
    `finding create (${issueType}): ${JSON.stringify(res.body)}`);
  return res.body;
}

async function getWetCheck(wetCheckId) {
  const res = await api("GET", `/api/wet-checks/${wetCheckId}`);
  assert.equal(res.status, 200, `get wc: ${JSON.stringify(res.body)}`);
  return res.body;
}

function findingFromTree(wc, findingId) {
  for (const zr of wc.zoneRecords ?? []) {
    const f = (zr.findings ?? []).find(x => x.id === findingId);
    if (f) return f;
  }
  return null;
}

async function pendingReviewRows() {
  const res = await api("GET", "/api/wet-checks/pending-review");
  assert.equal(res.status, 200, `pending-review: ${JSON.stringify(res.body)}`);
  return res.body ?? [];
}

async function pendingReviewIds() {
  const rows = await pendingReviewRows();
  return new Set(rows.map((r) => r.id));
}

describe("Wet check manager review queue → approve → route → convert", () => {
  let customerId;
  let partId;
  let wetCheckId;
  // f1=quick_fix → repaired_in_field, f2=advanced → sent_to_estimate,
  // f3=zone_issue → deferred_to_work_order, f4=quick_fix → documented_only,
  // f5=advanced → kept pending so the wet check ends as partially_converted.
  let f1, f2, f3, f4, f5;
  let firstConvert;

  before(async () => {
    customerId = await createCustomer("queue");
    partId = await createPart();
    wetCheckId = await createWetCheck(customerId);
    const z1 = await addZone(wetCheckId, 1);
    const z2 = await addZone(wetCheckId, 2);
    const z3 = await addZone(wetCheckId, 3);
    const z4 = await addZone(wetCheckId, 4);
    const z5 = await addZone(wetCheckId, 5);
    // Three different issue groups so the queue counts cover all buckets.
    f1 = (await addFinding(z1, "head_replacement", partId)).id;  // quick_fix
    f2 = (await addFinding(z2, "leak_repair",      partId)).id;  // advanced
    f3 = (await addFinding(z3, "valve_issue",      partId)).id;  // zone_issue
    f4 = (await addFinding(z4, "head_adjustment",  null)).id;    // quick_fix, documented_only
    f5 = (await addFinding(z5, "pressure_issue",   partId)).id;  // advanced
  });

  test("Submitted wet check appears in /api/wet-checks/pending-review with per-group counts", async () => {
    const submit = await api("POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(submit.status, 200, `submit: ${JSON.stringify(submit.body)}`);
    assert.equal(submit.body.status, "submitted");

    const queue = await api("GET", "/api/wet-checks/pending-review");
    assert.equal(queue.status, 200);
    const row = (queue.body ?? []).find((r) => r.id === wetCheckId);
    assert.ok(row, `wet check ${wetCheckId} should be in pending-review`);
    assert.equal(row.status, "submitted");
    // Three different issue groups represented in our 5 findings:
    //   quick_fix: head_replacement + head_adjustment = 2
    //   advanced:  leak_repair + pressure_issue       = 2
    //   zone_issue: valve_issue                       = 1
    assert.equal(row.findingCounts.quick_fix, 2,
      `quick_fix count: ${JSON.stringify(row.findingCounts)}`);
    assert.equal(row.findingCounts.advanced, 2,
      `advanced count: ${JSON.stringify(row.findingCounts)}`);
    assert.equal(row.findingCounts.zone_issue, 1,
      `zone_issue count: ${JSON.stringify(row.findingCounts)}`);
    assert.equal(row.findingCounts.total, 5);
  });

  test("Approve flips status to approved but the wet check stays in the queue", async () => {
    const approve = await api("POST", `/api/wet-checks/${wetCheckId}/approve`, {});
    assert.equal(approve.status, 200, `approve: ${JSON.stringify(approve.body)}`);
    assert.equal(approve.body.status, "approved");
    assert.ok(approve.body.approvedAt, "approvedAt must be stamped");
    assert.equal(approve.body.approvedBy, 53);

    const rows = await pendingReviewRows();
    const row = rows.find((r) => r.id === wetCheckId);
    assert.ok(row,
      `approved wet check ${wetCheckId} must remain in pending-review (got ${rows.map(r => r.id)})`);
    assert.equal(row.status, "approved",
      `pending-review row must reflect the approved status, got ${row.status}`);
  });

  test("Route four findings to each terminal resolution; leave one pending", async () => {
    const routings = [
      [f1, "repaired_in_field"],
      [f2, "sent_to_estimate"],
      [f3, "deferred_to_work_order"],
      [f4, "documented_only"],
    ];
    for (const [fid, resolution] of routings) {
      const res = await api("PATCH",
        `/api/wet-checks/findings/${fid}/route`, { resolution });
      assert.equal(res.status, 200,
        `route ${fid}→${resolution}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.resolution, resolution);
      assert.ok(res.body.resolutionDecidedAt,
        "resolutionDecidedAt must be stamped on a non-pending routing");
      assert.equal(res.body.resolutionDecidedBy, 53);
    }

    // f5 deliberately untouched — remains "pending".
    const wc = await getWetCheck(wetCheckId);
    const stillPending = findingFromTree(wc, f5);
    assert.ok(stillPending, "f5 must still exist in the tree");
    assert.equal(stillPending.resolution, "pending",
      `f5 should still be pending, got ${stillPending.resolution}`);
  });

  test("First /convert creates BS + estimate + WO and stamps back-links + convertedAt", async () => {
    const res = await api("POST", `/api/wet-checks/${wetCheckId}/convert`, {});
    assert.equal(res.status, 200, `convert: ${JSON.stringify(res.body)}`);
    firstConvert = res.body;
    assert.ok(firstConvert.billingSheetId, "expected billingSheetId");
    assert.ok(firstConvert.estimateId,     "expected estimateId");
    assert.ok(firstConvert.workOrderId,    "expected workOrderId");

    // Wet check is partially_converted because f5 is still pending.
    assert.equal(firstConvert.wetCheck.status, "partially_converted",
      `expected partially_converted, got ${firstConvert.wetCheck.status}`);
    assert.equal(firstConvert.wetCheck.fullyConvertedAt, null,
      "fullyConvertedAt must be null while pending findings remain");

    // Each routed finding got the correct back-link + convertedAt stamp.
    const wc = await getWetCheck(wetCheckId);
    const ff1 = findingFromTree(wc, f1);
    const ff2 = findingFromTree(wc, f2);
    const ff3 = findingFromTree(wc, f3);
    const ff4 = findingFromTree(wc, f4);
    const ff5 = findingFromTree(wc, f5);

    assert.ok(ff1?.convertedAt, "f1 convertedAt must be stamped");
    assert.equal(ff1.billingSheetId, firstConvert.billingSheetId,
      "f1 (repaired_in_field) must back-link the billing sheet");
    assert.equal(ff1.estimateId, null);
    assert.equal(ff1.workOrderId, null);

    assert.ok(ff2?.convertedAt, "f2 convertedAt must be stamped");
    assert.equal(ff2.estimateId, firstConvert.estimateId,
      "f2 (sent_to_estimate) must back-link the estimate");
    assert.equal(ff2.billingSheetId, null);
    assert.equal(ff2.workOrderId, null);

    assert.ok(ff3?.convertedAt, "f3 convertedAt must be stamped");
    assert.equal(ff3.workOrderId, firstConvert.workOrderId,
      "f3 (deferred_to_work_order) must back-link the work order");
    assert.equal(ff3.billingSheetId, null);
    assert.equal(ff3.estimateId, null);

    // documented_only carries convertedAt but no FK.
    assert.ok(ff4?.convertedAt, "f4 convertedAt must be stamped");
    assert.equal(ff4.billingSheetId, null);
    assert.equal(ff4.estimateId, null);
    assert.equal(ff4.workOrderId, null);

    // Pending finding untouched.
    assert.equal(ff5.convertedAt, null);
    assert.equal(ff5.billingSheetId, null);
    assert.equal(ff5.estimateId, null);
    assert.equal(ff5.workOrderId, null);

    // Sanity-check that all three destination rows actually exist and were
    // scoped to this customer. We deliberately do NOT pin total amounts
    // here — those are covered by the legacy convert test (and the
    // first-time estimate-create path computes labor differently from the
    // append path, which is out of scope for this regression).
    const bs = await api("GET", `/api/billing-sheets/${firstConvert.billingSheetId}`);
    assert.equal(bs.status, 200, `bs fetch: ${JSON.stringify(bs.body)}`);
    assert.equal(bs.body.customerId, customerId);
    assert.ok(Math.abs(parseFloat(bs.body.totalAmount) - EXPECTED_LINE_TOTAL) < 0.01,
      `bs totalAmount ${bs.body.totalAmount} != ${EXPECTED_LINE_TOTAL}`);
    const est = await api("GET", `/api/estimates/${firstConvert.estimateId}`);
    assert.equal(est.status, 200, `est fetch: ${JSON.stringify(est.body)}`);
    assert.equal(est.body.customerId, customerId);
    const wo = await api("GET", `/api/work-orders/${firstConvert.workOrderId}`);
    assert.equal(wo.status, 200, `wo fetch: ${JSON.stringify(wo.body)}`);
    assert.equal(wo.body.customerId, customerId);
  });

  test("partially_converted wet check still appears in the manager queue", async () => {
    const ids = await pendingReviewIds();
    assert.ok(ids.has(wetCheckId),
      `partially_converted wet check ${wetCheckId} must still appear in pending-review (got ${[...ids]})`);
  });

  test("Second /convert reuses existing BS / estimate / WO — no duplicates", async () => {
    // Route the still-pending f5 → repaired_in_field so the second convert
    // has something to do (and would otherwise be tempted to create a new BS).
    const route = await api("PATCH",
      `/api/wet-checks/findings/${f5}/route`, { resolution: "repaired_in_field" });
    assert.equal(route.status, 200, `route f5: ${JSON.stringify(route.body)}`);

    const second = await api("POST", `/api/wet-checks/${wetCheckId}/convert`, {});
    assert.equal(second.status, 200, `second convert: ${JSON.stringify(second.body)}`);

    // Same destinations as the first convert — no new BS/Est/WO created.
    assert.equal(second.body.billingSheetId, firstConvert.billingSheetId,
      "billing sheet id must be reused on second convert");
    assert.equal(second.body.estimateId, firstConvert.estimateId,
      "estimate id must be reused on second convert");
    assert.equal(second.body.workOrderId, firstConvert.workOrderId,
      "work order id must be reused on second convert");

    // No more pending findings → wet check flips to converted.
    assert.equal(second.body.wetCheck.status, "converted",
      `expected converted, got ${second.body.wetCheck.status}`);
    assert.ok(second.body.wetCheck.fullyConvertedAt,
      "fullyConvertedAt must be set when no pending findings remain");

    // The appended billing sheet now has both repaired lines (total ×2).
    const bs = await api("GET", `/api/billing-sheets/${firstConvert.billingSheetId}`);
    assert.equal(bs.status, 200);
    assert.ok(Math.abs(parseFloat(bs.body.totalAmount) - 2 * EXPECTED_LINE_TOTAL) < 0.01,
      `appended bs totalAmount ${bs.body.totalAmount} != ${2 * EXPECTED_LINE_TOTAL}`);

    // f5 is now back-linked to the existing billing sheet.
    const wc = await getWetCheck(wetCheckId);
    const ff5 = findingFromTree(wc, f5);
    assert.ok(ff5?.convertedAt, "f5 convertedAt must be stamped after second convert");
    assert.equal(ff5.billingSheetId, firstConvert.billingSheetId,
      "f5 must back-link the same (existing) billing sheet");
  });

  test("Fully-converted wet check drops out of the manager queue", async () => {
    const ids = await pendingReviewIds();
    assert.ok(!ids.has(wetCheckId),
      `converted wet check ${wetCheckId} must drop out of pending-review (got ${[...ids]})`);
  });
});

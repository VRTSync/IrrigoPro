/**
 * Tests for Task #195 — Track who added photos after billing.
 *
 * Verifies that:
 *   1. A photos-only PATCH on a `billed` work order writes a
 *      photo_late_additions audit row with the prior + new arrays and the
 *      acting user/role/timestamp captured.
 *   2. A photos-only PATCH on an `approved_passed_to_billing` billing sheet
 *      writes an audit row.
 *   3. A photos-only PATCH on a still-editable (non-billed, non-approved,
 *      no invoice) ticket does NOT write an audit row — the audit is only
 *      for late additions, not normal photo edits.
 *   4. The admin GET endpoints return the recorded rows for managers and
 *      reject field techs with 403.
 */

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
let FIELD_TECH_HEADERS;

async function api(method, path, body, headers = ADMIN_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed };
}

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Photo Audit Test Customer",
    email: "photo-audit@example.com",
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createAssignedWorkOrder(customerId) {
  const res = await api("POST", "/api/work-orders", {
    customerId,
    customerName: "Photo Audit Test Customer",
    customerEmail: "photo-audit@example.com",
    projectName: "Photo Audit Test",
    projectAddress: "123 Test St",
    workType: "direct_billing",
    priority: "medium",
    photos: ["https://example.com/orig-1.jpg"],
    assignedTechnicianId: FIELD_TECH_USER_ID,
    assignedTechnicianName: "Photo Audit Tech",
  });
  assert.ok(res.status === 200 || res.status === 201, `WO create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createBillingSheet(customerId) {
  const res = await api("POST", "/api/billing-sheets", {
    customerId,
    customerName: "Photo Audit Test Customer",
    propertyAddress: "456 Audit Way",
    workDate: new Date().toISOString().slice(0, 10),
    technicianName: "Photo Audit Tech",
    technicianId: FIELD_TECH_USER_ID,
    workDescription: "Audit test",
    status: "draft",
    totalHours: "1",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0",
    totalAmount: "50.00",
    photos: ["https://example.com/orig-bs.jpg"],
  });
  assert.equal(res.status, 200, `Sheet create failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function forceWorkOrderStatus(workOrderId, status) {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`UPDATE work_orders SET status = $1 WHERE id = $2`, [status, workOrderId]);
  await pool.end();
}

async function forceBillingSheetStatus(billingSheetId, status) {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`UPDATE billing_sheets SET status = $1 WHERE id = $2`, [status, billingSheetId]);
  await pool.end();
}

describe("Photo late-addition audit (Task #195)", () => {
  let customerId;

  before(async () => {
    const uniqueSuffix = Date.now();
    customerId = await ensureCustomer();
    const techRes = await api("POST", "/api/users", {
      username: `photoaudit_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Photo Audit Tech",
      email: `photoaudit_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(techRes.status, 201, `Tech create failed: ${JSON.stringify(techRes.body)}`);
    FIELD_TECH_USER_ID = techRes.body.id;
    FIELD_TECH_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(FIELD_TECH_USER_ID),
      "x-user-role": "field_tech",
      "x-user-company-id": "99",
    };
  });

  test("Photos-only PATCH on a billed work order writes an audit row", async () => {
    const woId = await createAssignedWorkOrder(customerId);
    await forceWorkOrderStatus(woId, "billed");

    const newPhotos = ["https://example.com/orig-1.jpg", "https://example.com/late-1.jpg"];
    const patchRes = await api("PATCH", `/api/work-orders/${woId}`, { photos: newPhotos }, FIELD_TECH_HEADERS);
    assert.equal(patchRes.status, 200, `PATCH failed: ${JSON.stringify(patchRes.body)}`);

    const trailRes = await api("GET", `/api/work-orders/${woId}/photo-late-additions`);
    assert.equal(trailRes.status, 200, `Trail fetch failed: ${JSON.stringify(trailRes.body)}`);
    assert.equal(trailRes.body.count, 1, `Expected 1 audit row, got ${trailRes.body.count}`);
    const row = trailRes.body.events[0];
    assert.equal(row.ticketType, "work_order");
    assert.equal(row.ticketId, woId);
    assert.equal(row.ticketStatusAtAddition, "billed");
    assert.equal(row.actorUserId, FIELD_TECH_USER_ID);
    assert.equal(row.actorRole, "field_tech");
    assert.deepEqual(row.priorPhotos, ["https://example.com/orig-1.jpg"]);
    assert.deepEqual(row.newPhotos, newPhotos);
    assert.deepEqual(row.addedPhotos, ["https://example.com/late-1.jpg"]);
    assert.deepEqual(row.removedPhotos, []);
    assert.ok(row.createdAt, "createdAt should be set");
  });

  test("Photos-only PATCH on an approved billing sheet writes an audit row", async () => {
    const sheetId = await createBillingSheet(customerId);
    await forceBillingSheetStatus(sheetId, "approved_passed_to_billing");

    const newPhotos = ["https://example.com/orig-bs.jpg", "https://example.com/late-bs.jpg"];
    const patchRes = await api("PATCH", `/api/billing-sheets/${sheetId}`, { photos: newPhotos }, FIELD_TECH_HEADERS);
    assert.equal(patchRes.status, 200, `PATCH failed: ${JSON.stringify(patchRes.body)}`);

    const trailRes = await api("GET", `/api/billing-sheets/${sheetId}/photo-late-additions`);
    assert.equal(trailRes.status, 200, `Trail fetch failed: ${JSON.stringify(trailRes.body)}`);
    assert.equal(trailRes.body.count, 1, `Expected 1 audit row, got ${trailRes.body.count}`);
    const row = trailRes.body.events[0];
    assert.equal(row.ticketType, "billing_sheet");
    assert.equal(row.ticketStatusAtAddition, "approved_passed_to_billing");
    assert.deepEqual(row.addedPhotos, ["https://example.com/late-bs.jpg"]);
  });

  test("Photos-only PATCH on a non-billed sheet does NOT write an audit row", async () => {
    const sheetId = await createBillingSheet(customerId);
    // POST /api/billing-sheets with manager auth auto-promotes status to
    // 'approved_passed_to_billing'. Force it back to 'draft' so we can
    // verify pre-billing photo edits are NOT audited as late additions.
    await forceBillingSheetStatus(sheetId, "draft");
    const newPhotos = ["https://example.com/orig-bs.jpg", "https://example.com/normal-edit.jpg"];
    const patchRes = await api("PATCH", `/api/billing-sheets/${sheetId}`, { photos: newPhotos }, FIELD_TECH_HEADERS);
    assert.equal(patchRes.status, 200, `PATCH failed: ${JSON.stringify(patchRes.body)}`);

    const trailRes = await api("GET", `/api/billing-sheets/${sheetId}/photo-late-additions`);
    assert.equal(trailRes.status, 200);
    assert.equal(trailRes.body.count, 0, `Pre-billing edits must not be audited, got ${trailRes.body.count}`);
  });

  test("Field tech is forbidden from reading the audit trail", async () => {
    const woId = await createAssignedWorkOrder(customerId);
    const r = await api("GET", `/api/work-orders/${woId}/photo-late-additions`, undefined, FIELD_TECH_HEADERS);
    assert.equal(r.status, 403, `Expected 403 for field tech, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
});

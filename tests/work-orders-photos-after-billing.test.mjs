/**
 * Tests for Task #191 — Allow photo backfill on tickets that have already
 * been moved to billing.
 *
 * Verifies that:
 *   1. A field tech CAN PATCH photos on a `billed` work order assigned to them.
 *   2. A field tech CAN PATCH photos on an `approved_passed_to_billing`
 *      work order assigned to them.
 *   3. A field tech still CANNOT PATCH non-photo fields on an approved/billed
 *      work order (regression guard — only the photos field is exempt).
 *   4. The same allow/deny behavior holds on the billing-sheet PATCH route
 *      for the approved_passed_to_billing branch.
 *   5. A field tech still CANNOT PATCH photos on a `cancelled` work order.
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
  return { status: res.status, body: parsed, text };
}

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "WO Photo Backfill Test Customer",
    email: "wo-photo-backfill@example.com",
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createAssignedWorkOrder(customerId) {
  const createRes = await api("POST", "/api/work-orders", {
    customerId,
    customerName: "WO Photo Backfill Test Customer",
    customerEmail: "wo-photo-backfill@example.com",
    projectName: "Photo Backfill Test",
    projectAddress: "123 Test St",
    workType: "direct_billing",
    priority: "medium",
    photos: [],
    assignedTechnicianId: FIELD_TECH_USER_ID,
    assignedTechnicianName: "Photo Backfill Tech",
  });
  assert.ok(createRes.status === 200 || createRes.status === 201, `Work order creation failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  return createRes.body.id;
}

// Forces a work order into a target status by writing the row directly,
// bypassing the lifecycle guard. This is the simplest way to land a work
// order in `approved_passed_to_billing`, `billed`, or `cancelled` for the
// purpose of testing the photos-only exception.
async function forceWorkOrderStatus(workOrderId, status, opts = {}) {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (opts.invoiceId !== undefined) {
    await pool.query(
      `UPDATE work_orders SET status = $1, invoice_id = $2 WHERE id = $3`,
      [status, opts.invoiceId, workOrderId],
    );
  } else {
    await pool.query(
      `UPDATE work_orders SET status = $1 WHERE id = $2`,
      [status, workOrderId],
    );
  }
  await pool.end();
}

async function forceBillingSheetStatus(billingSheetId, status) {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `UPDATE billing_sheets SET status = $1 WHERE id = $2`,
    [status, billingSheetId],
  );
  await pool.end();
}

async function createBillingSheet(customerId) {
  const res = await api("POST", "/api/billing-sheets", {
    customerId,
    customerName: "WO Photo Backfill Test Customer",
    propertyAddress: "456 Backfill Way",
    workDate: new Date().toISOString().slice(0, 10),
    technicianName: "Photo Backfill Tech",
    technicianId: FIELD_TECH_USER_ID,
    workDescription: "Photo backfill test",
    status: "draft",
    totalHours: "1",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0",
    totalAmount: "50.00",
    photos: [],
  });
  assert.equal(res.status, 200, `Create billing sheet failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Photo backfill on billed/approved tickets (Task #191)", () => {
  let customerId;

  before(async () => {
    const uniqueSuffix = Date.now();

    customerId = await ensureCustomer();

    const techRes = await api("POST", "/api/users", {
      username: `photoback_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Photo Backfill Tech",
      email: `photoback_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(techRes.status, 201, `Field tech user creation failed: ${JSON.stringify(techRes.body)}`);
    FIELD_TECH_USER_ID = techRes.body.id;
    FIELD_TECH_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(FIELD_TECH_USER_ID),
      "x-user-role": "field_tech",
      "x-user-company-id": "99",
    };
  });

  test("Field tech CAN PATCH photos on a billed work order", async () => {
    const woId = await createAssignedWorkOrder(customerId);
    await forceWorkOrderStatus(woId, "billed");

    const newPhotos = ["https://example.com/billed-late-1.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/work-orders/${woId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Expected 200 on photos-only PATCH for billed work order, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos, `Photos should persist on billed work order: ${JSON.stringify(getRes.body.photos)}`);
  });

  test("Field tech CAN PATCH photos on an approved_passed_to_billing work order", async () => {
    const woId = await createAssignedWorkOrder(customerId);
    await forceWorkOrderStatus(woId, "approved_passed_to_billing");

    const newPhotos = ["https://example.com/approved-late-1.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/work-orders/${woId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Expected 200 on photos-only PATCH for approved work order, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos);
  });

  test("Field tech CAN PATCH photos on a work order that already has an invoiceId (parity with billing sheets)", async () => {
    const woId = await createAssignedWorkOrder(customerId);

    // Create a real invoice and attach it to the work order so the
    // `invoiceId`-set branch in requireWorkOrderUpdateAccess is exercised.
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const invoiceNumber = `INV-WO-PHOTO-${Date.now()}`;
    const now = new Date().toISOString();
    const inserted = await pool.query(
      `INSERT INTO invoices (
        invoice_number, customer_id, customer_name, customer_email,
        invoice_month, invoice_year, period_start, period_end,
        status, parts_subtotal, labor_subtotal, total_amount
      ) VALUES ($1, $2, 'WO Photo Backfill Test Customer', 'wo-photo-backfill@example.com',
        1, 2026, $3, $3, 'draft', '0', '50.00', '50.00') RETURNING id`,
      [invoiceNumber, customerId, now],
    );
    await pool.end();
    const invoiceId = inserted.rows[0].id;

    // Mark work order as billed and link to invoice in one shot.
    await forceWorkOrderStatus(woId, "billed", { invoiceId });

    const newPhotos = ["https://example.com/wo-invoiced-late.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/work-orders/${woId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Expected 200 on photos-only PATCH for invoiced work order, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos);
  });

  test("Field tech CANNOT PATCH non-photo fields on a billed work order", async () => {
    const woId = await createAssignedWorkOrder(customerId);
    await forceWorkOrderStatus(woId, "billed");

    // Mixing photos with another field is NOT a photos-only PATCH. The
    // middleware should reject it because field techs cannot edit anything
    // other than photos via the catch-all path, and the route handler's
    // billed lock should still fire for non-photos-only patches.
    const patchRes = await api(
      "PATCH",
      `/api/work-orders/${woId}`,
      {
        photos: ["https://example.com/should-not-save.jpg"],
        notes: "Tech tries to change notes too",
      },
      FIELD_TECH_HEADERS,
    );
    assert.ok(patchRes.status === 403 || patchRes.status === 409, `Expected 403/409 for non-photo PATCH on billed WO, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  });

  test("Field tech CANNOT PATCH photos on a cancelled work order", async () => {
    const woId = await createAssignedWorkOrder(customerId);
    await forceWorkOrderStatus(woId, "cancelled");

    const patchRes = await api(
      "PATCH",
      `/api/work-orders/${woId}`,
      { photos: ["https://example.com/cancelled.jpg"] },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 403, `Expected 403 on cancelled WO photo PATCH, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  });

  test("Field tech CAN PATCH photos on an approved_passed_to_billing billing sheet", async () => {
    const sheetId = await createBillingSheet(customerId);
    await forceBillingSheetStatus(sheetId, "approved_passed_to_billing");

    const newPhotos = ["https://example.com/bs-approved-late.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Expected 200 on photos-only PATCH for approved billing sheet, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos);
  });

  test("Field tech CANNOT PATCH non-photo fields on an approved billing sheet", async () => {
    const sheetId = await createBillingSheet(customerId);
    await forceBillingSheetStatus(sheetId, "approved_passed_to_billing");

    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      {
        photos: ["https://example.com/bs-not-saved.jpg"],
        workDescription: "Tech tries to change description",
      },
      FIELD_TECH_HEADERS,
    );
    assert.ok(patchRes.status === 403 || patchRes.status === 409, `Expected 403/409 for non-photo PATCH on approved billing sheet, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  });
});

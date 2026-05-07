/**
 * Tests for Task #193 — locks in the Task #192 backend filter that hides any
 * work order or billing sheet that has been billed (status `billed`, or has
 * `invoiceId`/`billedAt` set) from the missing-photos reports.
 *
 * For each endpoint we seed four rows that would otherwise qualify
 * (created before the cutoff, no photos, not flagged `noPhotosNeeded`):
 *   - one with `status: 'billed'`
 *   - one with a non-null `invoiceId`
 *   - one with a non-null `billedAt`
 *   - one plain unbilled row (control)
 * Only the control row should appear in the response, and the `count` field
 * must match the returned list length.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

let ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};
const BOOTSTRAP_ADMIN_HEADERS = { ...ADMIN_HEADERS };

let TECH_USER_ID;
let CUSTOMER_ID;
let INVOICE_ID;

async function api(method, path, body, headers = ADMIN_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed, text };
}

async function withPool(fn) {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { return await fn(pool); } finally { await pool.end(); }
}

async function createWorkOrder() {
  const res = await api("POST", "/api/work-orders", {
    customerId: CUSTOMER_ID,
    customerName: "Missing-Photos Billed Filter Customer",
    customerEmail: "mp-billed@example.com",
    projectName: "Billed Filter WO",
    projectAddress: "1 Test Way",
    workType: "direct_billing",
    priority: "medium",
    photos: [],
  });
  assert.ok(
    res.status === 200 || res.status === 201,
    `Work order creation failed: ${res.status} ${JSON.stringify(res.body)}`,
  );
  return res.body.id;
}

async function createBillingSheet() {
  const res = await api("POST", "/api/billing-sheets", {
    customerId: CUSTOMER_ID,
    customerName: "Missing-Photos Billed Filter Customer",
    propertyAddress: "1 Test Way",
    workDate: new Date("2026-04-01T12:00:00Z").toISOString(),
    technicianName: "Missing-Photos Billed Tech",
    technicianId: TECH_USER_ID,
    workDescription: "Billed filter test sheet",
    totalHours: "1.00",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0.00",
    totalAmount: "50.00",
    photos: [],
  });
  assert.ok(
    res.status === 200 || res.status === 201,
    `Billing sheet creation failed: ${res.status} ${JSON.stringify(res.body)}`,
  );
  return res.body.id;
}

describe("Missing-photos reports exclude billed tickets (Task #193)", () => {
  before(async () => {
    const suffix = Date.now();

    // Real admin user so any audit FKs would resolve and the requester id is valid.
    const adminRes = await api(
      "POST",
      "/api/users",
      {
        username: `mpbilled_admin_${suffix}`,
        password: "test-password-123",
        name: "Missing-Photos Billed Admin",
        email: `mpbilled_admin_${suffix}@example.com`,
        role: "company_admin",
        companyId: 99,
      },
      BOOTSTRAP_ADMIN_HEADERS,
    );
    assert.equal(adminRes.status, 201, `Admin user creation failed: ${JSON.stringify(adminRes.body)}`);
    ADMIN_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(adminRes.body.id),
      "x-user-role": "company_admin",
      "x-user-company-id": "99",
    };

    // Tech in same company so billing-sheet rows are tenant-visible to the admin.
    const techRes = await api("POST", "/api/users", {
      username: `mpbilled_tech_${suffix}`,
      password: "test-password-123",
      name: "Missing-Photos Billed Tech",
      email: `mpbilled_tech_${suffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(techRes.status, 201, `Tech user creation failed: ${JSON.stringify(techRes.body)}`);
    TECH_USER_ID = techRes.body.id;

    const custRes = await api("POST", "/api/customers", {
      companyId: 99,
      name: "Missing-Photos Billed Filter Customer",
      email: `mp-billed_${suffix}@example.com`,
      laborRate: "50.00",
    });
    assert.equal(custRes.status, 201, `Customer creation failed: ${JSON.stringify(custRes.body)}`);
    CUSTOMER_ID = custRes.body.id;

    // Real invoice row to satisfy the FK on work_orders.invoice_id /
    // billing_sheets.invoice_id for the "invoiceId-set" seeded rows.
    INVOICE_ID = await withPool(async (pool) => {
      const r = await pool.query(
        `INSERT INTO invoices (
            invoice_number, customer_id, customer_name, customer_email,
            invoice_month, invoice_year, period_start, period_end,
            parts_subtotal, labor_subtotal, total_amount
         )
         VALUES ($1,$2,$3,$4,4,2026,'2026-04-01','2026-04-30','0.00','50.00','50.00')
         RETURNING id`,
        [
          `MPBILLED-INV-${suffix}`,
          CUSTOMER_ID,
          "Missing-Photos Billed Filter Customer",
          `mp-billed_${suffix}@example.com`,
        ],
      );
      return r.rows[0].id;
    });
  });

  test("GET /api/work-orders/missing-photos excludes billed work orders", async () => {
    const billedStatusId = await createWorkOrder();
    const invoiceLinkedId = await createWorkOrder();
    const billedAtId = await createWorkOrder();
    const controlId = await createWorkOrder();

    // Back-date all four (so they fall before PHOTO_FIX_CUTOFF), and apply
    // each "billed" condition to the first three. The control row keeps its
    // default status / null invoice_id / null billed_at.
    await withPool(async (pool) => {
      const past = "2026-04-01T12:00:00Z";
      await pool.query(
        `UPDATE work_orders SET created_at = $1, status = 'billed' WHERE id = $2`,
        [past, billedStatusId],
      );
      await pool.query(
        `UPDATE work_orders SET created_at = $1, invoice_id = $2 WHERE id = $3`,
        [past, INVOICE_ID, invoiceLinkedId],
      );
      await pool.query(
        `UPDATE work_orders SET created_at = $1, billed_at = $1 WHERE id = $2`,
        [past, billedAtId],
      );
      await pool.query(
        `UPDATE work_orders SET created_at = $1 WHERE id = $2`,
        [past, controlId],
      );
    });

    const res = await api("GET", "/api/work-orders/missing-photos");
    assert.equal(res.status, 200, `Report fetch failed: ${JSON.stringify(res.body)}`);

    const ids = (res.body.workOrders || []).map((w) => w.id);
    const seeded = [billedStatusId, invoiceLinkedId, billedAtId, controlId];
    const seededInResponse = seeded.filter((id) => ids.includes(id));

    assert.deepEqual(
      seededInResponse,
      [controlId],
      `Only the control work order should appear. Expected [${controlId}], got [${seededInResponse.join(",")}]`,
    );
    assert.ok(!ids.includes(billedStatusId), "WO with status='billed' must be excluded");
    assert.ok(!ids.includes(invoiceLinkedId), "WO with invoiceId set must be excluded");
    assert.ok(!ids.includes(billedAtId), "WO with billedAt set must be excluded");
    assert.ok(ids.includes(controlId), "Control unbilled WO must still appear");
    assert.equal(res.body.count, ids.length, "count must equal the returned list length");
  });

  test("GET /api/billing-sheets/missing-photos excludes billed sheets", async () => {
    const billedStatusId = await createBillingSheet();
    const invoiceLinkedId = await createBillingSheet();
    const billedAtId = await createBillingSheet();
    const controlId = await createBillingSheet();

    await withPool(async (pool) => {
      const past = "2026-04-01T12:00:00Z";
      await pool.query(
        `UPDATE billing_sheets SET created_at = $1, status = 'billed' WHERE id = $2`,
        [past, billedStatusId],
      );
      await pool.query(
        `UPDATE billing_sheets SET created_at = $1, invoice_id = $2 WHERE id = $3`,
        [past, INVOICE_ID, invoiceLinkedId],
      );
      await pool.query(
        `UPDATE billing_sheets SET created_at = $1, billed_at = $1 WHERE id = $2`,
        [past, billedAtId],
      );
      await pool.query(
        `UPDATE billing_sheets SET created_at = $1 WHERE id = $2`,
        [past, controlId],
      );
    });

    const res = await api("GET", "/api/billing-sheets/missing-photos");
    assert.equal(res.status, 200, `Report fetch failed: ${JSON.stringify(res.body)}`);

    const ids = (res.body.sheets || []).map((s) => s.id);
    const seeded = [billedStatusId, invoiceLinkedId, billedAtId, controlId];
    const seededInResponse = seeded.filter((id) => ids.includes(id));

    assert.deepEqual(
      seededInResponse,
      [controlId],
      `Only the control billing sheet should appear. Expected [${controlId}], got [${seededInResponse.join(",")}]`,
    );
    assert.ok(!ids.includes(billedStatusId), "Sheet with status='billed' must be excluded");
    assert.ok(!ids.includes(invoiceLinkedId), "Sheet with invoiceId set must be excluded");
    assert.ok(!ids.includes(billedAtId), "Sheet with billedAt set must be excluded");
    assert.ok(ids.includes(controlId), "Control unbilled sheet must still appear");
    assert.equal(res.body.count, ids.length, "count must equal the returned list length");
  });
});

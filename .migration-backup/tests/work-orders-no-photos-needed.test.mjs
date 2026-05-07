/**
 * Tests for Task #185 — "No Photos Needed" flag on the work-orders
 * missing-photos report.
 *
 * Verifies that:
 *   1. POST /api/work-orders/:id/no-photos-needed stamps the audit fields
 *      (noPhotosNeeded=true, noPhotosNeededBy, noPhotosNeededAt).
 *   2. Once flagged, the work order is excluded from both the JSON and CSV
 *      branches of GET /api/work-orders/missing-photos.
 *   3. Roles outside the four allowed (company_admin, super_admin,
 *      irrigation_manager, billing_manager) get a 403.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

// Admin user id is created in `before()` so the audit FK
// (work_orders.no_photos_needed_by → users.id) resolves cleanly.
let ADMIN_USER_ID;
let ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};
const BOOTSTRAP_ADMIN_HEADERS = { ...ADMIN_HEADERS };

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
    name: "WO No-Photos-Needed Test Customer",
    email: "wo-no-photos-needed@example.com",
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

// Create a work order, then back-date it so it falls before the
// PHOTO_FIX_CUTOFF (2026-04-22) and shows up on the report.
async function createPastWorkOrder(customerId, extra = {}) {
  const createRes = await api("POST", "/api/work-orders", {
    customerId,
    customerName: "WO No-Photos-Needed Test Customer",
    customerEmail: "wo-no-photos-needed@example.com",
    projectName: "No Photos Needed Test",
    projectAddress: "123 Test St",
    workType: "direct_billing",
    priority: "medium",
    photos: [],
    ...extra,
  });
  assert.ok(createRes.status === 200 || createRes.status === 201, `Work order creation failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  const woId = createRes.body.id;

  // Back-date the work order via direct DB write so it lands before the cutoff.
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Pick a date well before the PHOTO_FIX_CUTOFF (2026-04-22)
  await pool.query(
    `UPDATE work_orders SET created_at = '2026-04-01T12:00:00Z' WHERE id = $1`,
    [woId],
  );
  await pool.end();

  return woId;
}

describe("Work orders 'no photos needed' (Task #185)", () => {
  let customerId;

  before(async () => {
    const uniqueSuffix = Date.now();

    // Create a real admin user so the audit FK
    // (work_orders.no_photos_needed_by → users.id) can resolve.
    const adminUserRes = await api(
      "POST",
      "/api/users",
      {
        username: `nopnadmin_${uniqueSuffix}`,
        password: "test-password-123",
        name: "No Photos Admin",
        email: `nopnadmin_${uniqueSuffix}@example.com`,
        role: "company_admin",
        companyId: 99,
      },
      BOOTSTRAP_ADMIN_HEADERS,
    );
    assert.equal(adminUserRes.status, 201, `Admin user creation failed: ${JSON.stringify(adminUserRes.body)}`);
    ADMIN_USER_ID = adminUserRes.body.id;
    ADMIN_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(ADMIN_USER_ID),
      "x-user-role": "company_admin",
      "x-user-company-id": "99",
    };

    customerId = await ensureCustomer();

    const techRes = await api("POST", "/api/users", {
      username: `nopntech_${uniqueSuffix}`,
      password: "test-password-123",
      name: "No Photos Tech",
      email: `nopntech_${uniqueSuffix}@example.com`,
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

  test("Marked work order is excluded from JSON missing-photos report", async () => {
    const woId = await createPastWorkOrder(customerId);

    const beforeRes = await api("GET", "/api/work-orders/missing-photos");
    assert.equal(beforeRes.status, 200);
    const beforeIds = (beforeRes.body.workOrders || []).map((w) => w.id);
    assert.ok(beforeIds.includes(woId), `Expected work order ${woId} to appear before marking. Got ids: ${beforeIds.join(",")}`);

    const markRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed`);
    assert.equal(markRes.status, 200, `Mark request failed: ${JSON.stringify(markRes.body)}`);

    // Audit fields stamped correctly
    assert.equal(markRes.body.noPhotosNeeded, true, "noPhotosNeeded should be true");
    assert.equal(markRes.body.noPhotosNeededBy, ADMIN_USER_ID, "noPhotosNeededBy should reflect the acting admin user id");
    assert.ok(markRes.body.noPhotosNeededAt, "noPhotosNeededAt should be stamped");
    const stampedAt = new Date(markRes.body.noPhotosNeededAt);
    assert.ok(!isNaN(stampedAt.getTime()), "noPhotosNeededAt should be a valid date");

    const afterRes = await api("GET", "/api/work-orders/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.workOrders || []).map((w) => w.id);
    assert.ok(!afterIds.includes(woId), `Marked work order ${woId} should be excluded but was returned. Got ids: ${afterIds.join(",")}`);
    // Count should reflect the exclusion
    assert.equal(afterRes.body.count, afterIds.length, "count must equal the returned list length");
  });

  test("Marked work order is excluded from CSV missing-photos download", async () => {
    const woId = await createPastWorkOrder(customerId);

    // Confirm appears in CSV first
    const beforeCsvRes = await fetch(`${BASE_URL}/api/work-orders/missing-photos?format=csv`, {
      headers: { ...ADMIN_HEADERS },
    });
    const beforeCsv = await beforeCsvRes.text();
    assert.equal(beforeCsvRes.status, 200);
    // Look for unique identifying string. workOrderNumber is unique per row.
    const beforeIncluded = beforeCsv.includes(`,${woId},`) || beforeCsv.includes("No Photos Needed Test");
    assert.ok(beforeIncluded || beforeCsv.includes("No Photos Needed Test"), "CSV should include the work order before marking");

    const markRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed`);
    assert.equal(markRes.status, 200);

    const afterCsvRes = await fetch(`${BASE_URL}/api/work-orders/missing-photos?format=csv`, {
      headers: { ...ADMIN_HEADERS },
    });
    const afterCsv = await afterCsvRes.text();
    assert.equal(afterCsvRes.status, 200);

    // The work order's number from the JSON response gives us a precise needle
    const woRes = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(woRes.status, 200);
    const woNumber = woRes.body.workOrderNumber;
    assert.ok(woNumber, "Need a work order number to look for in CSV");
    assert.ok(!afterCsv.includes(woNumber), `Marked work order ${woNumber} must not appear in CSV after marking`);
  });

  test("Field tech (unauthorized role) gets 403 when marking", async () => {
    const woId = await createPastWorkOrder(customerId);

    const markRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed`, undefined, FIELD_TECH_HEADERS);
    assert.equal(markRes.status, 403, `Expected 403 for field_tech, got ${markRes.status}: ${JSON.stringify(markRes.body)}`);

    // And it must still appear on the report
    const afterRes = await api("GET", "/api/work-orders/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.workOrders || []).map((w) => w.id);
    assert.ok(afterIds.includes(woId), "Work order should still appear after a denied mark attempt");
  });

  // Task #187 — undo / clear endpoint
  test("Admin can clear the 'No Photos Needed' flag and the WO reappears on the report", async () => {
    const woId = await createPastWorkOrder(customerId);

    // Mark first
    const markRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed`);
    assert.equal(markRes.status, 200);
    assert.equal(markRes.body.noPhotosNeeded, true);

    // Confirm it's gone from the report
    const hiddenRes = await api("GET", "/api/work-orders/missing-photos");
    assert.equal(hiddenRes.status, 200);
    const hiddenIds = (hiddenRes.body.workOrders || []).map((w) => w.id);
    assert.ok(!hiddenIds.includes(woId), "Marked work order should be hidden before clearing");

    // Clear the flag
    const clearRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed/clear`);
    assert.equal(clearRes.status, 200, `Clear request failed: ${JSON.stringify(clearRes.body)}`);
    assert.equal(clearRes.body.noPhotosNeeded, false, "noPhotosNeeded should be false after clear");
    assert.equal(clearRes.body.noPhotosNeededBy, null, "noPhotosNeededBy should be null after clear");
    assert.equal(clearRes.body.noPhotosNeededAt, null, "noPhotosNeededAt should be null after clear");

    // It should reappear on the report
    const afterRes = await api("GET", "/api/work-orders/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.workOrders || []).map((w) => w.id);
    assert.ok(afterIds.includes(woId), `Cleared work order ${woId} should reappear on the report. Got ids: ${afterIds.join(",")}`);
  });

  test("Field tech (unauthorized role) gets 403 when clearing", async () => {
    const woId = await createPastWorkOrder(customerId);

    // Mark with admin first
    const markRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed`);
    assert.equal(markRes.status, 200);

    // Field tech tries to clear
    const clearRes = await api("POST", `/api/work-orders/${woId}/no-photos-needed/clear`, undefined, FIELD_TECH_HEADERS);
    assert.equal(clearRes.status, 403, `Expected 403 for field_tech, got ${clearRes.status}: ${JSON.stringify(clearRes.body)}`);

    // Flag must remain set
    const woRes = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(woRes.status, 200);
    assert.equal(woRes.body.noPhotosNeeded, true, "Flag should still be set after a denied clear attempt");
  });

  test("Clearing a non-existent work order returns 404", async () => {
    const clearRes = await api("POST", `/api/work-orders/99999999/no-photos-needed/clear`);
    assert.equal(clearRes.status, 404, `Expected 404 for missing WO, got ${clearRes.status}`);
  });
});

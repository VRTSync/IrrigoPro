/**
 * Tests for Task #197 — "No Photos Needed" flag on the billing-sheets
 * missing-photos report.
 *
 * Verifies that:
 *   1. POST /api/billing-sheets/:id/no-photos-needed stamps the audit fields
 *      (noPhotosNeeded=true, noPhotosNeededBy, noPhotosNeededAt).
 *   2. Once flagged, the sheet is excluded from both the JSON and CSV
 *      branches of GET /api/billing-sheets/missing-photos.
 *   3. Once flagged, the sheet is excluded from the notify candidate list.
 *   4. Roles outside the four allowed (company_admin, super_admin,
 *      irrigation_manager, billing_manager) get a 403.
 *   5. Non-super-admin users cannot mark a sheet whose technician belongs
 *      to a different company (tenant scoping).
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

let ADMIN_USER_ID;
let ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};
const BOOTSTRAP_ADMIN_HEADERS = { ...ADMIN_HEADERS };

let TECH_USER_ID;
let TECH_HEADERS;

let OTHER_COMPANY_ADMIN_ID;
let OTHER_COMPANY_ADMIN_HEADERS;
let OTHER_COMPANY_TECH_ID;

const OUR_COMPANY_ID = 99;
const OTHER_COMPANY_ID = 99197; // Distinct, unlikely to collide with seed data

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
    companyId: OUR_COMPANY_ID,
    name: "BS No-Photos-Needed Test Customer",
    email: "bs-no-photos-needed@example.com",
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function ensureCompany(companyId, name) {
  // Make sure a companies row exists for the given id so the user FK to
  // companies.id is satisfied. This endpoint is forgiving on duplicates.
  const res = await fetch(`${BASE_URL}/api/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-role": "super_admin", "x-user-id": "1" },
    body: JSON.stringify({ id: companyId, name }),
  });
  // Either created or already existed — both are fine.
  return res.status === 201 || res.status === 200 || res.status === 409;
}

// Create a billing sheet, then back-date it via direct DB write so it falls
// before PHOTO_FIX_CUTOFF (2026-04-22) and shows up on the report.
async function createPastBillingSheet(customerId, technicianName, technicianId) {
  const createRes = await api("POST", "/api/billing-sheets", {
    customerId,
    customerName: "BS No-Photos-Needed Test Customer",
    propertyAddress: "123 Test St",
    workDate: new Date("2026-04-01T12:00:00Z").toISOString(),
    technicianName,
    technicianId,
    workDescription: "No photos needed test sheet",
    totalHours: "1.00",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0.00",
    totalAmount: "50.00",
    photos: [],
  });
  assert.ok(createRes.status === 200 || createRes.status === 201, `Billing sheet creation failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  const sheetId = createRes.body.id;

  // Back-date via direct DB write so it lands before the PHOTO_FIX_CUTOFF.
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const ws = (await import("ws")).default;
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `UPDATE billing_sheets SET created_at = '2026-04-01T12:00:00Z' WHERE id = $1`,
    [sheetId],
  );
  await pool.end();

  return { sheetId, billingNumber: createRes.body.billingNumber };
}

describe("Billing sheets 'no photos needed' (Task #197)", () => {
  let customerId;

  before(async () => {
    const uniqueSuffix = Date.now();

    // Create real admin user so the audit FK resolves.
    const adminUserRes = await api(
      "POST",
      "/api/users",
      {
        username: `bsnopnadmin_${uniqueSuffix}`,
        password: "test-password-123",
        name: "BS No Photos Admin",
        email: `bsnopnadmin_${uniqueSuffix}@example.com`,
        role: "company_admin",
        companyId: OUR_COMPANY_ID,
      },
      BOOTSTRAP_ADMIN_HEADERS,
    );
    assert.equal(adminUserRes.status, 201, `Admin user creation failed: ${JSON.stringify(adminUserRes.body)}`);
    ADMIN_USER_ID = adminUserRes.body.id;
    ADMIN_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(ADMIN_USER_ID),
      "x-user-role": "company_admin",
      "x-user-company-id": String(OUR_COMPANY_ID),
    };

    customerId = await ensureCustomer();

    const techRes = await api("POST", "/api/users", {
      username: `bsnopntech_${uniqueSuffix}`,
      password: "test-password-123",
      name: "BS No Photos Tech",
      email: `bsnopntech_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: OUR_COMPANY_ID,
    });
    assert.equal(techRes.status, 201, `Field tech user creation failed: ${JSON.stringify(techRes.body)}`);
    TECH_USER_ID = techRes.body.id;
    TECH_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(TECH_USER_ID),
      "x-user-role": "field_tech",
      "x-user-company-id": String(OUR_COMPANY_ID),
    };

    // Setup a separate company + admin + tech for tenant scoping checks.
    await ensureCompany(OTHER_COMPANY_ID, `Other Co ${uniqueSuffix}`);
    const otherAdminRes = await api("POST", "/api/users", {
      username: `bsnopnotheradm_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Other Co Admin",
      email: `bsnopnotheradm_${uniqueSuffix}@example.com`,
      role: "company_admin",
      companyId: OTHER_COMPANY_ID,
    });
    assert.equal(otherAdminRes.status, 201, `Other-company admin creation failed: ${JSON.stringify(otherAdminRes.body)}`);
    OTHER_COMPANY_ADMIN_ID = otherAdminRes.body.id;
    OTHER_COMPANY_ADMIN_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(OTHER_COMPANY_ADMIN_ID),
      "x-user-role": "company_admin",
      "x-user-company-id": String(OTHER_COMPANY_ID),
    };

    const otherTechRes = await api("POST", "/api/users", {
      username: `bsnopnothertech_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Other Co Tech",
      email: `bsnopnothertech_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: OTHER_COMPANY_ID,
    });
    assert.equal(otherTechRes.status, 201, `Other-company tech creation failed: ${JSON.stringify(otherTechRes.body)}`);
    OTHER_COMPANY_TECH_ID = otherTechRes.body.id;
  });

  test("Marked billing sheet is excluded from JSON missing-photos report and audit fields are stamped", async () => {
    const { sheetId } = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);

    const beforeRes = await api("GET", "/api/billing-sheets/missing-photos");
    assert.equal(beforeRes.status, 200);
    const beforeIds = (beforeRes.body.sheets || []).map((s) => s.id);
    assert.ok(beforeIds.includes(sheetId), `Expected sheet ${sheetId} to appear before marking. Got ids: ${beforeIds.join(",")}`);
    const beforeCount = beforeRes.body.count;

    const markRes = await api("POST", `/api/billing-sheets/${sheetId}/no-photos-needed`);
    assert.equal(markRes.status, 200, `Mark request failed: ${JSON.stringify(markRes.body)}`);

    // Audit fields stamped correctly
    assert.equal(markRes.body.noPhotosNeeded, true, "noPhotosNeeded should be true");
    assert.equal(markRes.body.noPhotosNeededBy, ADMIN_USER_ID, "noPhotosNeededBy should reflect the acting admin user id");
    assert.ok(markRes.body.noPhotosNeededAt, "noPhotosNeededAt should be stamped");
    const stampedAt = new Date(markRes.body.noPhotosNeededAt);
    assert.ok(!isNaN(stampedAt.getTime()), "noPhotosNeededAt should be a valid date");

    const afterRes = await api("GET", "/api/billing-sheets/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.sheets || []).map((s) => s.id);
    assert.ok(!afterIds.includes(sheetId), `Marked sheet ${sheetId} should be excluded but was returned. Got ids: ${afterIds.join(",")}`);
    assert.equal(afterRes.body.count, afterIds.length, "count must equal the returned list length");
    assert.equal(afterRes.body.count, beforeCount - 1, "count must decrement by exactly one");
  });

  test("Marked billing sheet is excluded from CSV missing-photos download", async () => {
    const { sheetId, billingNumber } = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);

    const beforeCsvRes = await fetch(`${BASE_URL}/api/billing-sheets/missing-photos?format=csv`, {
      headers: { ...ADMIN_HEADERS },
    });
    const beforeCsv = await beforeCsvRes.text();
    assert.equal(beforeCsvRes.status, 200);
    assert.ok(beforeCsv.includes(billingNumber), "CSV should include the billing sheet before marking");

    const markRes = await api("POST", `/api/billing-sheets/${sheetId}/no-photos-needed`);
    assert.equal(markRes.status, 200);

    const afterCsvRes = await fetch(`${BASE_URL}/api/billing-sheets/missing-photos?format=csv`, {
      headers: { ...ADMIN_HEADERS },
    });
    const afterCsv = await afterCsvRes.text();
    assert.equal(afterCsvRes.status, 200);
    assert.ok(!afterCsv.includes(billingNumber), `Marked sheet ${billingNumber} must not appear in CSV after marking`);
  });

  test("Marked billing sheet is excluded from notify candidates (sheetCount drops by 1)", async () => {
    // Create TWO past sheets for the same tech so we can deterministically
    // observe the count drop by exactly one after marking the first.
    const a = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);
    const b = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);

    // Snapshot the candidate count for this tech BEFORE marking.
    const beforeRes = await api("POST", "/api/billing-sheets/missing-photos/notify", {
      force: true,
      channel: "email",
    });
    assert.equal(beforeRes.status, 200, `Notify (before) failed: ${JSON.stringify(beforeRes.body)}`);
    const beforeRow = (beforeRes.body.results || []).find((r) => r.technicianId === TECH_USER_ID);
    assert.ok(beforeRow, "Technician should appear in notify results before marking");
    const beforeCount = beforeRow.sheetCount;
    assert.ok(beforeCount >= 2, `Expected at least 2 sheets queued for tech, got ${beforeCount}`);

    // Mark the first sheet
    const markRes = await api("POST", `/api/billing-sheets/${a.sheetId}/no-photos-needed`);
    assert.equal(markRes.status, 200);

    // Snapshot the candidate count AFTER marking.
    const afterRes = await api("POST", "/api/billing-sheets/missing-photos/notify", {
      force: true,
      channel: "email",
    });
    assert.equal(afterRes.status, 200, `Notify (after) failed: ${JSON.stringify(afterRes.body)}`);
    const afterRow = (afterRes.body.results || []).find((r) => r.technicianId === TECH_USER_ID);
    assert.ok(afterRow, "Technician should still appear (still has the second un-marked sheet)");
    assert.equal(
      afterRow.sheetCount,
      beforeCount - 1,
      `Notify candidate count for tech should drop by exactly 1 after marking. Got ${afterRow.sheetCount}, expected ${beforeCount - 1}`,
    );

    // Cleanup: also mark the second so it doesn't bleed into other tests
    await api("POST", `/api/billing-sheets/${b.sheetId}/no-photos-needed`);
  });

  test("Re-marking an already-flagged sheet is idempotent", async () => {
    const { sheetId } = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);

    const first = await api("POST", `/api/billing-sheets/${sheetId}/no-photos-needed`);
    assert.equal(first.status, 200);
    assert.equal(first.body.noPhotosNeeded, true);
    const firstStampedAt = first.body.noPhotosNeededAt;

    const second = await api("POST", `/api/billing-sheets/${sheetId}/no-photos-needed`);
    assert.equal(second.status, 200, "Re-marking should still succeed (200)");
    assert.equal(second.body.noPhotosNeeded, true);
    assert.equal(second.body.noPhotosNeededBy, ADMIN_USER_ID);
    assert.ok(second.body.noPhotosNeededAt, "Re-mark should still stamp a timestamp");
    // Timestamp should be refreshed on re-mark (same audit semantics as work-orders)
    assert.ok(
      new Date(second.body.noPhotosNeededAt).getTime() >= new Date(firstStampedAt).getTime(),
      "Re-mark timestamp should be at-or-after the first stamp",
    );

    // Sheet must still be excluded from the report
    const afterRes = await api("GET", "/api/billing-sheets/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.sheets || []).map((s) => s.id);
    assert.ok(!afterIds.includes(sheetId), "Re-marked sheet should remain excluded");
  });

  test("Field tech (unauthorized role) gets 403 when marking", async () => {
    const { sheetId } = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);

    const markRes = await api("POST", `/api/billing-sheets/${sheetId}/no-photos-needed`, undefined, TECH_HEADERS);
    assert.equal(markRes.status, 403, `Expected 403 for field_tech, got ${markRes.status}: ${JSON.stringify(markRes.body)}`);

    // Sheet must still appear on the report
    const afterRes = await api("GET", "/api/billing-sheets/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.sheets || []).map((s) => s.id);
    assert.ok(afterIds.includes(sheetId), "Sheet should still appear after a denied mark attempt");
  });

  test("Tenant scoping: another company's admin cannot mark our sheet", async () => {
    const { sheetId } = await createPastBillingSheet(customerId, "BS No Photos Tech", TECH_USER_ID);

    const markRes = await api(
      "POST",
      `/api/billing-sheets/${sheetId}/no-photos-needed`,
      undefined,
      OTHER_COMPANY_ADMIN_HEADERS,
    );
    assert.equal(markRes.status, 403, `Expected 403 for other-company admin, got ${markRes.status}: ${JSON.stringify(markRes.body)}`);

    // Sheet must still appear on our report
    const afterRes = await api("GET", "/api/billing-sheets/missing-photos");
    assert.equal(afterRes.status, 200);
    const afterIds = (afterRes.body.sheets || []).map((s) => s.id);
    assert.ok(afterIds.includes(sheetId), "Sheet should still appear after a tenant-scoped denial");
  });
});

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
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Test Customer Photos",
    email: "testphotos@example.com",
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createSheet(customerId, photos, extra = {}) {
  const res = await api("POST", "/api/billing-sheets", {
    customerId,
    customerName: "Test Customer Photos",
    propertyAddress: "456 Photo Way",
    workDate: new Date().toISOString().slice(0, 10),
    technicianName: "Photo Tech",
    technicianId: FIELD_TECH_USER_ID,
    workDescription: "Photo persistence test",
    status: "draft",
    totalHours: "1",
    laborRate: "50.00",
    laborSubtotal: "50.00",
    partsSubtotal: "0",
    totalAmount: "50.00",
    photos,
    ...extra,
  });
  assert.equal(res.status, 200, `Create billing sheet failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Billing sheet photo persistence", () => {
  let customerId;

  before(async () => {
    customerId = await ensureCustomer();

    const uniqueSuffix = Date.now();
    const userRes = await api("POST", "/api/users", {
      username: `phototech_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Photo Tech",
      email: `phototech_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(userRes.status, 201, `Field tech user creation failed: ${JSON.stringify(userRes.body)}`);
    FIELD_TECH_USER_ID = userRes.body.id;
    FIELD_TECH_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(FIELD_TECH_USER_ID),
      "x-user-role": "field_tech",
      "x-user-company-id": "99",
    };
  });

  test("POST /api/billing-sheets persists photos array", async () => {
    const photos = ["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"];
    const sheetId = await createSheet(customerId, photos);

    const getRes = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, photos, `Photos not persisted on create: ${JSON.stringify(getRes.body.photos)}`);
  });

  test("Manager PATCH replaces photos array", async () => {
    const initialPhotos = ["https://example.com/initial-1.jpg"];
    const sheetId = await createSheet(customerId, initialPhotos);

    const updated = [
      "https://example.com/updated-1.jpg",
      "https://example.com/updated-2.jpg",
      "https://example.com/updated-3.jpg",
    ];
    const patchRes = await api("PATCH", `/api/billing-sheets/${sheetId}`, { photos: updated });
    assert.equal(patchRes.status, 200, `Manager PATCH failed: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, updated, `Photos not updated by manager: ${JSON.stringify(getRes.body.photos)}`);
  });

  test("Field tech PATCH with photos-only is allowed", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    const newPhotos = ["https://example.com/tech-1.jpg", "https://example.com/tech-2.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Field tech photos-only PATCH failed: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos, `Field tech photos not persisted: ${JSON.stringify(getRes.body.photos)}`);
  });

  test("Field tech PATCH with anything beyond photos returns 403", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      {
        photos: ["https://example.com/new.jpg"],
        workDescription: "Tech is trying to change description",
      },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 403, `Expected 403, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  });

  test("Field tech PATCH photos on a billed sheet succeeds (Task #191)", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    // Manager marks the sheet as billed
    const billRes = await api("PATCH", `/api/billing-sheets/${sheetId}`, { status: "billed" });
    assert.equal(billRes.status, 200, `Marking sheet as billed failed: ${JSON.stringify(billRes.body)}`);

    // Task #191: photos-only PATCH should now be allowed on billed sheets
    // so techs can backfill missing photos after the fact.
    const newPhotos = ["https://example.com/late.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Expected 200 on photos-only PATCH for billed sheet, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos, `Photos should persist on billed sheet: ${JSON.stringify(getRes.body.photos)}`);
  });

  test("Field tech PATCH non-photo fields on a billed sheet still returns 403", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    const billRes = await api("PATCH", `/api/billing-sheets/${sheetId}`, { status: "billed" });
    assert.equal(billRes.status, 200, `Marking sheet as billed failed: ${JSON.stringify(billRes.body)}`);

    // Mixing photos with another field is NOT a photos-only PATCH and must
    // still be rejected by the middleware (field techs cannot edit anything
    // other than photos on someone else's sheet).
    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      {
        photos: ["https://example.com/late.jpg"],
        workDescription: "Tech is trying to change description",
      },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 403, `Expected 403 for non-photo PATCH on billed sheet, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
  });

  test("Field tech B cannot PATCH (photos-only) Tech A's billing sheet", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    const uniqueSuffix = Date.now();
    const userRes = await api("POST", "/api/users", {
      username: `phototechB_photos_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Photo Tech B Photos",
      email: `phototechB_photos_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(userRes.status, 201, `Tech B user creation failed: ${JSON.stringify(userRes.body)}`);
    const TECH_B_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(userRes.body.id),
      "x-user-role": "field_tech",
      "x-user-company-id": "99",
    };

    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: ["https://example.com/techB-stole.jpg"] },
      TECH_B_HEADERS,
    );
    assert.equal(patchRes.status, 403, `Expected 403, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
    assert.match(
      patchRes.body.message || "",
      /Field technicians can only act on their own billing sheets/i,
      `Unexpected access-denied message: ${JSON.stringify(patchRes.body)}`,
    );
  });

  test("Field tech B cannot PATCH (status submit) Tech A's billing sheet", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    const uniqueSuffix = Date.now();
    const userRes = await api("POST", "/api/users", {
      username: `phototechB_submit_${uniqueSuffix}`,
      password: "test-password-123",
      name: "Photo Tech B Submit",
      email: `phototechB_submit_${uniqueSuffix}@example.com`,
      role: "field_tech",
      companyId: 99,
    });
    assert.equal(userRes.status, 201, `Tech B user creation failed: ${JSON.stringify(userRes.body)}`);
    const TECH_B_HEADERS = {
      "Content-Type": "application/json",
      "x-user-id": String(userRes.body.id),
      "x-user-role": "field_tech",
      "x-user-company-id": "99",
    };

    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { status: "submitted" },
      TECH_B_HEADERS,
    );
    assert.equal(patchRes.status, 403, `Expected 403, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
    assert.match(
      patchRes.body.message || "",
      /Field technicians can only act on their own billing sheets/i,
      `Unexpected access-denied message: ${JSON.stringify(patchRes.body)}`,
    );
  });

  test("Field tech PATCH photos on an invoiced sheet succeeds (Task #191)", async () => {
    const sheetId = await createSheet(customerId, ["https://example.com/orig.jpg"]);

    // Create a real invoice row directly via the DB so we can attach it via FK,
    // then PATCH the billing sheet's invoiceId. Task #191 relaxes the
    // billed/invoiced photo lock so the tech can backfill photos here.
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const invoiceNumber = `INV-TEST-${Date.now()}`;
    const now = new Date().toISOString();
    const inserted = await pool.query(
      `INSERT INTO invoices (
        invoice_number, customer_id, customer_name, customer_email,
        invoice_month, invoice_year, period_start, period_end,
        status, parts_subtotal, labor_subtotal, total_amount
      ) VALUES ($1, $2, 'Test Customer Photos', 'testphotos@example.com', 1, 2026, $3, $3,
        'draft', '0', '50.00', '50.00') RETURNING id`,
      [invoiceNumber, customerId, now],
    );
    await pool.end();
    const invoiceId = inserted.rows[0].id;

    const attachRes = await api("PATCH", `/api/billing-sheets/${sheetId}`, { invoiceId });
    assert.equal(attachRes.status, 200, `Attaching invoiceId failed: ${JSON.stringify(attachRes.body)}`);

    const newPhotos = ["https://example.com/late.jpg"];
    const patchRes = await api(
      "PATCH",
      `/api/billing-sheets/${sheetId}`,
      { photos: newPhotos },
      FIELD_TECH_HEADERS,
    );
    assert.equal(patchRes.status, 200, `Expected 200 on photos-only PATCH for invoiced sheet, got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);

    const getRes = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.photos, newPhotos, `Photos should persist on invoiced sheet: ${JSON.stringify(getRes.body.photos)}`);
  });
});

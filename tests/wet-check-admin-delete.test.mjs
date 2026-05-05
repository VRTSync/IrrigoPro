import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE_URL = "http://localhost:5000";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

const FIELD_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "field_tech",
  "x-user-company-id": "99",
};

const BILLING_MGR_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "billing_manager",
  "x-user-company-id": "99",
};

const OTHER_COMPANY_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "company_admin",
  "x-user-company-id": "987654",
};

const { db } = await import("../server/db.ts");
const {
  wetChecks,
  wetCheckZoneRecords,
  wetCheckFindings,
  wetCheckPhotos,
} = await import("../shared/schema.ts");
const { eq } = await import("drizzle-orm");

async function api(headers, method, path, body) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function createCustomer(label) {
  const res = await api(ADMIN_HEADERS, "POST", "/api/customers", {
    companyId: 99,
    name: `WC Admin Delete ${label} ${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    email: `wcadmindel-${label}-${Date.now()}@example.com`,
    address: "1 Delete Way",
    laborRate: "50.00",
    totalControllers: 1,
  });
  assert.equal(res.status, 201, `customer create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createPart() {
  const sku = `WC-ADMIN-DEL-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const res = await api(ADMIN_HEADERS, "POST", "/api/parts", {
    companyId: 99,
    name: "WC Admin Delete Test Head",
    sku,
    price: "20.00",
    cost: "5.00",
    category: "Head",
  });
  assert.ok(res.status === 200 || res.status === 201, `part create: ${res.status}`);
  return res.body.id;
}

async function createWetCheck(customerId) {
  const res = await api(ADMIN_HEADERS, "POST", "/api/wet-checks", {
    customerId,
    clientId: randomUUID(),
  });
  assert.ok(res.status === 200 || res.status === 201,
    `wet check create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function addZone(wetCheckId, zoneNumber) {
  const res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
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
    quantity: 2,
    laborHours: "0.50",
    clientId: randomUUID(),
  };
  if (partId != null) body.partId = partId;
  const res = await api(ADMIN_HEADERS, "POST",
    `/api/wet-checks/zone-records/${zoneRecordId}/findings`, body);
  assert.equal(res.status, 201, `finding create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function addPhoto(wetCheckId) {
  const res = await api(ADMIN_HEADERS, "POST",
    `/api/wet-checks/${wetCheckId}/photos`, {
      url: `https://example.com/wc-photo-${randomUUID()}.jpg`,
      caption: "test",
      clientId: randomUUID(),
    });
  assert.equal(res.status, 201, `photo create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function buildSimpleWetCheck(label) {
  const customerId = await createCustomer(label);
  const wetCheckId = await createWetCheck(customerId);
  const z = await addZone(wetCheckId, 1);
  const findingId = await addFinding(z, null);
  const photoId = await addPhoto(wetCheckId);
  return { customerId, wetCheckId, zoneRecordId: z, findingId, photoId };
}

describe("DELETE /api/wet-checks/:id — admin guards and cascade", () => {
  test("403 when caller is not company_admin (field_tech)", async () => {
    const { wetCheckId } = await buildSimpleWetCheck("field-403");

    const res = await api(FIELD_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(res.status, 403,
      `field_tech delete must be 403, got ${res.status} ${JSON.stringify(res.body)}`);

    // Wet check must still exist server-side.
    const stillThere = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(stillThere.length, 1, "wet check must NOT be deleted by a non-admin");
  });

  test("403 when caller is billing_manager (admin-only endpoint)", async () => {
    const { wetCheckId } = await buildSimpleWetCheck("billing-403");

    const res = await api(BILLING_MGR_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(res.status, 403,
      `billing_manager delete must be 403, got ${res.status} ${JSON.stringify(res.body)}`);

    const stillThere = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(stillThere.length, 1, "wet check must NOT be deleted by billing_manager");
  });

  test("404 when wet check belongs to a different company", async () => {
    const { wetCheckId } = await buildSimpleWetCheck("xcompany-404");

    const res = await api(OTHER_COMPANY_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(res.status, 404,
      `cross-company delete must be 404, got ${res.status} ${JSON.stringify(res.body)}`);

    // Wet check must still exist.
    const stillThere = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(stillThere.length, 1, "wet check must NOT be deleted across company scope");
  });

  test("404 when wet check id does not exist at all", async () => {
    const res = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/2147483600`);
    assert.equal(res.status, 404,
      `unknown id delete must be 404, got ${res.status} ${JSON.stringify(res.body)}`);
  });

  test("409 with routedFindingIds when a finding has been routed downstream", async () => {
    // Build a wet check whose findings will be converted into a billing
    // sheet (repaired_in_field). Once converted, deleting the wet check
    // must be refused so we don't orphan the billing sheet's source.
    const customerId = await createCustomer("routed-409");
    const partId = await createPart();
    const wetCheckId = await createWetCheck(customerId);
    const z = await addZone(wetCheckId, 1);
    const routedFindingId = await addFinding(z, partId);

    let res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/submit`, {});
    assert.equal(res.status, 200, `submit: ${JSON.stringify(res.body)}`);
    res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/approve`, {});
    assert.equal(res.status, 200, `approve: ${JSON.stringify(res.body)}`);
    res = await api(ADMIN_HEADERS, "PATCH",
      `/api/wet-checks/findings/${routedFindingId}/route`,
      { resolution: "repaired_in_field" });
    assert.equal(res.status, 200, `route: ${JSON.stringify(res.body)}`);
    res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/convert`, {});
    assert.equal(res.status, 200, `convert: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.billingSheetId, "expected a billing sheet from conversion");

    // Sanity check: finding now has a billing sheet FK.
    const [routedRow] = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, routedFindingId));
    assert.ok(routedRow.billingSheetId, "finding must carry billingSheetId after convert");

    const del = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 409,
      `routed delete must be 409, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.ok(Array.isArray(del.body.routedFindingIds),
      `409 body must include routedFindingIds[], got ${JSON.stringify(del.body)}`);
    assert.ok(del.body.routedFindingIds.includes(routedFindingId),
      `routedFindingIds must include the converted finding ${routedFindingId}, got ${JSON.stringify(del.body.routedFindingIds)}`);

    // Nothing must have been removed.
    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 1, "wet check must still exist after a 409 refusal");
    const findingRows = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    assert.ok(findingRows.length > 0, "findings must still exist after a 409 refusal");
  });

  test("Happy path: company_admin delete cascades zones, findings, photos, and the wet check itself", async () => {
    const { wetCheckId, zoneRecordId, findingId, photoId } =
      await buildSimpleWetCheck("happy-path");

    // Pre-flight: every child row exists.
    const beforeWc = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    const beforeZ = await db.select().from(wetCheckZoneRecords)
      .where(eq(wetCheckZoneRecords.wetCheckId, wetCheckId));
    const beforeF = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    const beforeP = await db.select().from(wetCheckPhotos)
      .where(eq(wetCheckPhotos.wetCheckId, wetCheckId));
    assert.equal(beforeWc.length, 1, "wet check must exist before delete");
    assert.equal(beforeZ.length, 1, "zone record must exist before delete");
    assert.equal(beforeF.length, 1, "finding must exist before delete");
    assert.equal(beforeP.length, 1, "photo must exist before delete");

    const res = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(res.status, 200,
      `happy-path delete must be 200, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true, `body must be { ok: true }, got ${JSON.stringify(res.body)}`);

    // All four tables should be empty for this wet check.
    const afterWc = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    const afterZ = await db.select().from(wetCheckZoneRecords)
      .where(eq(wetCheckZoneRecords.wetCheckId, wetCheckId));
    const afterF = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    const afterP = await db.select().from(wetCheckPhotos)
      .where(eq(wetCheckPhotos.wetCheckId, wetCheckId));
    assert.equal(afterWc.length, 0, "wet check row must be gone");
    assert.equal(afterZ.length, 0, "zone records must be gone");
    assert.equal(afterF.length, 0, "findings must be gone");
    assert.equal(afterP.length, 0, "photos must be gone");

    // Specific child IDs must also be gone (id-level check, not just FK-level).
    const zr = await db.select().from(wetCheckZoneRecords)
      .where(eq(wetCheckZoneRecords.id, zoneRecordId));
    const fr = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    const pr = await db.select().from(wetCheckPhotos)
      .where(eq(wetCheckPhotos.id, photoId));
    assert.equal(zr.length, 0, "zone record id must be gone");
    assert.equal(fr.length, 0, "finding id must be gone");
    assert.equal(pr.length, 0, "photo id must be gone");

    // Idempotency: a follow-up delete is a 404, not a 500.
    const followup = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(followup.status, 404,
      `repeat delete must be 404, got ${followup.status} ${JSON.stringify(followup.body)}`);
  });

  test("Admin list endpoint is also gated to company_admin only", async () => {
    const res = await api(FIELD_HEADERS, "GET", "/api/wet-checks/admin");
    assert.equal(res.status, 403,
      `field_tech admin list must be 403, got ${res.status} ${JSON.stringify(res.body)}`);

    const ok = await api(ADMIN_HEADERS, "GET", "/api/wet-checks/admin");
    assert.equal(ok.status, 200, `company_admin admin list must be 200, got ${ok.status}`);
    assert.ok(Array.isArray(ok.body), "admin list must be an array");
  });
});

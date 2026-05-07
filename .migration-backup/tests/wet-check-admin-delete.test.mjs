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

const IRRIGATION_MGR_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "irrigation_manager",
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
  billingSheets,
  billingSheetItems,
  estimates,
  estimateItems,
  workOrders,
  workOrderItems,
  invoices,
  invoiceItems,
} = await import("../shared/schema.ts");
const { eq, sql } = await import("drizzle-orm");
const { storage } = await import("../server/storage.ts");

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

// Build a wet check, route a finding (default `repaired_in_field` → billing
// sheet), and convert. Returns the resulting downstream ids alongside the
// wet check scaffolding so callers can plant invoices etc.
//
// `resolution` selects which downstream record gets produced:
//   - "repaired_in_field"     → billing sheet
//   - "sent_to_estimate"      → estimate
//   - "deferred_to_work_order" → work order
async function buildRoutedWetCheck(label, resolution = "repaired_in_field") {
  const customerId = await createCustomer(label);
  const partId = await createPart();
  const wetCheckId = await createWetCheck(customerId);
  const zoneRecordId = await addZone(wetCheckId, 1);
  const findingId = await addFinding(zoneRecordId, partId);

  let res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/submit`, {});
  assert.equal(res.status, 200, `submit: ${JSON.stringify(res.body)}`);
  res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/approve`, {});
  assert.equal(res.status, 200, `approve: ${JSON.stringify(res.body)}`);
  res = await api(ADMIN_HEADERS, "PATCH",
    `/api/wet-checks/findings/${findingId}/route`,
    { resolution });
  assert.equal(res.status, 200, `route: ${JSON.stringify(res.body)}`);
  res = await api(ADMIN_HEADERS, "POST", `/api/wet-checks/${wetCheckId}/convert`, {});
  assert.equal(res.status, 200, `convert: ${JSON.stringify(res.body)}`);

  return {
    customerId,
    wetCheckId,
    zoneRecordId,
    findingId,
    billingSheetId: res.body.billingSheetId ?? null,
    estimateId: res.body.estimateId ?? null,
    workOrderId: res.body.workOrderId ?? null,
  };
}

// Plant an invoice + invoice_item linking the given work order to a real
// invoice row. Mirrors the post-billing FK shape (work_orders.invoiceId
// + invoice_items.workOrderId) used by the production invoice generator.
async function attachWorkOrderToInvoice(customerId, workOrderId, label) {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const periodStart = new Date();
  const periodEnd = new Date();
  const invoice = await storage.createInvoice({
    invoiceNumber: `INV-WC-WO-${label}-${tag}`,
    customerId,
    customerName: `Wet Check WO Invoice ${label}`,
    customerEmail: `wc-wo-inv-${label}-${tag}@example.com`,
    customerPhone: null,
    invoiceMonth: periodStart.getMonth() + 1,
    invoiceYear: periodStart.getFullYear(),
    periodStart,
    periodEnd,
    laborSubtotal: "50.00",
    partsSubtotal: "0.00",
    totalAmount: "50.00",
    status: "generated",
  });
  await storage.createInvoiceItem({
    invoiceId: invoice.id,
    sourceType: "work_order",
    sourceId: workOrderId,
    workOrderId,
    description: `WC WO delete-block coverage ${label}`,
    workDate: periodStart,
    laborHours: "1",
    laborRate: "50.00",
    laborTotal: "50.00",
    quantity: "1",
    unitPrice: "50.00",
    totalPrice: "50.00",
  });
  await db.update(workOrders)
    .set({ status: "billed", invoiceId: invoice.id })
    .where(eq(workOrders.id, workOrderId));
  return invoice.id;
}

// Plant an invoice + invoice_item linking the given billing sheet to a real
// invoice row, mirroring the post-invoicing state in production. Done via
// storage so we don't depend on a live QuickBooks integration in tests.
async function attachBillingSheetToInvoice(customerId, billingSheetId, label) {
  const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const periodStart = new Date();
  const periodEnd = new Date();
  const invoice = await storage.createInvoice({
    invoiceNumber: `INV-WC-${label}-${tag}`,
    customerId,
    customerName: `Wet Check Invoice ${label}`,
    customerEmail: `wc-inv-${label}-${tag}@example.com`,
    customerPhone: null,
    invoiceMonth: periodStart.getMonth() + 1,
    invoiceYear: periodStart.getFullYear(),
    periodStart,
    periodEnd,
    laborSubtotal: "50.00",
    partsSubtotal: "0.00",
    totalAmount: "50.00",
    status: "generated",
  });
  await storage.createInvoiceItem({
    invoiceId: invoice.id,
    sourceType: "billing_sheet",
    sourceId: billingSheetId,
    billingSheetId,
    description: `WC delete-block coverage ${label}`,
    workDate: periodStart,
    laborHours: "1",
    laborRate: "50.00",
    laborTotal: "50.00",
    quantity: "1",
    unitPrice: "50.00",
    totalPrice: "50.00",
  });
  // Mirror the post-billing FK + status flip the invoice generator does.
  await db.update(billingSheets)
    .set({ status: "billed", invoiceId: invoice.id })
    .where(eq(billingSheets.id, billingSheetId));
  return invoice.id;
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

  test("Cascade: routed-but-not-invoiced wet check is deleted along with its downstream billing sheet", async () => {
    // Routed downstream record exists but has NOT been invoiced. Per Task #284
    // this must succeed and cascade-delete the billing sheet (and its items)
    // along with the wet check. Previously this returned 409.
    const {
      wetCheckId,
      findingId,
      billingSheetId,
    } = await buildRoutedWetCheck("cascade-not-invoiced");

    // Pre-flight: billing sheet exists, finding carries the FK.
    const [routedRow] = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.equal(routedRow.billingSheetId, billingSheetId,
      "finding must carry billingSheetId after convert");
    const beforeBs = await db.select().from(billingSheets)
      .where(eq(billingSheets.id, billingSheetId));
    assert.equal(beforeBs.length, 1, "billing sheet must exist before delete");
    const beforeBsItems = await db.select().from(billingSheetItems)
      .where(eq(billingSheetItems.billingSheetId, billingSheetId));

    const del = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 200,
      `routed-but-not-invoiced delete must succeed, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.equal(del.body.ok, true);

    // Wet check, findings, and the downstream billing sheet must all be gone.
    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 0, "wet check row must be gone");
    const fRows = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    assert.equal(fRows.length, 0, "findings must be cascade-deleted");
    const bsRows = await db.select().from(billingSheets)
      .where(eq(billingSheets.id, billingSheetId));
    assert.equal(bsRows.length, 0, "downstream billing sheet must be cascade-deleted");
    if (beforeBsItems.length > 0) {
      const bsiRows = await db.select().from(billingSheetItems)
        .where(eq(billingSheetItems.billingSheetId, billingSheetId));
      assert.equal(bsiRows.length, 0, "billing sheet items must be cascade-deleted");
    }
  });

  test("409 with structured blockers when a downstream billing sheet is on an invoice", async () => {
    const {
      customerId,
      wetCheckId,
      findingId,
      billingSheetId,
    } = await buildRoutedWetCheck("invoice-block-409");

    const invoiceId = await attachBillingSheetToInvoice(
      customerId, billingSheetId, "single",
    );

    const del = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 409,
      `invoiced delete must be 409, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.equal(typeof del.body.message, "string",
      `409 body must include a message, got ${JSON.stringify(del.body)}`);
    assert.ok(Array.isArray(del.body.blockers),
      `409 body must include blockers[], got ${JSON.stringify(del.body)}`);
    assert.ok(del.body.blockers.length >= 1, "must report at least one blocker");
    const bsBlocker = del.body.blockers.find(
      (b) => b.kind === "billing_sheet" && b.id === billingSheetId,
    );
    assert.ok(bsBlocker,
      `blockers must include the invoiced billing sheet, got ${JSON.stringify(del.body.blockers)}`);
    assert.equal(bsBlocker.invoiceId, invoiceId,
      `blocker must reference invoice ${invoiceId}, got ${JSON.stringify(bsBlocker)}`);

    // Nothing must have been removed.
    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 1, "wet check must still exist after a 409 refusal");
    const findingRows = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.equal(findingRows.length, 1, "finding must still exist after a 409 refusal");
    const bsRows = await db.select().from(billingSheets)
      .where(eq(billingSheets.id, billingSheetId));
    assert.equal(bsRows.length, 1, "billing sheet must still exist after a 409 refusal");
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

  test("Admin list endpoint is open to company_admin and irrigation_manager, but not other roles", async () => {
    const res = await api(FIELD_HEADERS, "GET", "/api/wet-checks/admin");
    assert.equal(res.status, 403,
      `field_tech admin list must be 403, got ${res.status} ${JSON.stringify(res.body)}`);

    const billingRes = await api(BILLING_MGR_HEADERS, "GET", "/api/wet-checks/admin");
    assert.equal(billingRes.status, 403,
      `billing_manager admin list must be 403, got ${billingRes.status} ${JSON.stringify(billingRes.body)}`);

    const ok = await api(ADMIN_HEADERS, "GET", "/api/wet-checks/admin");
    assert.equal(ok.status, 200, `company_admin admin list must be 200, got ${ok.status}`);
    assert.ok(Array.isArray(ok.body), "admin list must be an array");

    const irrOk = await api(IRRIGATION_MGR_HEADERS, "GET", "/api/wet-checks/admin");
    assert.equal(irrOk.status, 200,
      `irrigation_manager admin list must be 200, got ${irrOk.status} ${JSON.stringify(irrOk.body)}`);
    assert.ok(Array.isArray(irrOk.body), "irrigation_manager admin list must be an array");
  });

  test("irrigation_manager: single delete succeeds and cascades", async () => {
    const { wetCheckId, zoneRecordId, findingId, photoId } =
      await buildSimpleWetCheck("irr-happy");

    const res = await api(IRRIGATION_MGR_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(res.status, 200,
      `irrigation_manager delete must be 200, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);

    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    const zr = await db.select().from(wetCheckZoneRecords)
      .where(eq(wetCheckZoneRecords.id, zoneRecordId));
    const fr = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    const pr = await db.select().from(wetCheckPhotos)
      .where(eq(wetCheckPhotos.id, photoId));
    assert.equal(wcRows.length, 0, "wet check row must be gone");
    assert.equal(zr.length, 0, "zone record id must be gone");
    assert.equal(fr.length, 0, "finding id must be gone");
    assert.equal(pr.length, 0, "photo id must be gone");
  });

  test("irrigation_manager: single delete returns 409 when downstream record is on an invoice", async () => {
    const { customerId, wetCheckId, billingSheetId } =
      await buildRoutedWetCheck("irr-invoice-409");
    const invoiceId = await attachBillingSheetToInvoice(
      customerId, billingSheetId, "irr-single",
    );

    const del = await api(IRRIGATION_MGR_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 409,
      `irrigation_manager invoiced delete must be 409, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.ok(Array.isArray(del.body.blockers),
      `409 body must include blockers[], got ${JSON.stringify(del.body)}`);
    const bsBlocker = del.body.blockers.find(
      (b) => b.kind === "billing_sheet" && b.id === billingSheetId,
    );
    assert.ok(bsBlocker,
      `blockers must include the invoiced billing sheet, got ${JSON.stringify(del.body.blockers)}`);
    assert.equal(bsBlocker.invoiceId, invoiceId);

    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 1, "wet check must still exist after a 409 refusal");
  });

  test("irrigation_manager: bulk delete succeeds and reports per-id outcomes (deleted + blocked)", async () => {
    // Build a deletable wet check (no downstream invoice).
    const { wetCheckId: deletableId } = await buildSimpleWetCheck("irr-bulk-ok");

    // Build a routed + invoiced wet check (will be blocked).
    const {
      customerId: blockedCustomerId,
      wetCheckId: blockedWcId,
      billingSheetId: blockedBsId,
    } = await buildRoutedWetCheck("irr-bulk-blocked");
    await attachBillingSheetToInvoice(blockedCustomerId, blockedBsId, "irr-bulk");

    const bulk = await api(IRRIGATION_MGR_HEADERS, "DELETE", "/api/wet-checks/bulk-delete", {
      ids: [deletableId, blockedWcId],
    });
    assert.equal(bulk.status, 200,
      `irrigation_manager bulk delete must be 200, got ${bulk.status} ${JSON.stringify(bulk.body)}`);
    assert.equal(bulk.body.summary.deleted, 1, `summary.deleted: ${JSON.stringify(bulk.body)}`);
    assert.equal(bulk.body.summary.blocked, 1, `summary.blocked: ${JSON.stringify(bulk.body)}`);

    const byId = new Map(bulk.body.results.map((o) => [o.id, o]));
    assert.equal(byId.get(deletableId).status, "deleted");
    assert.equal(byId.get(blockedWcId).status, "blocked");
    assert.ok(Array.isArray(byId.get(blockedWcId).blockers),
      `blocked outcome must include blockers[], got ${JSON.stringify(byId.get(blockedWcId))}`);
    assert.ok(
      byId.get(blockedWcId).blockers.some(
        (b) => b.kind === "billing_sheet" && b.id === blockedBsId,
      ),
      `blockers must reference the invoiced billing sheet ${blockedBsId}`,
    );

    // Deletable one is gone, blocked one stays.
    const goneWc = await db.select().from(wetChecks).where(eq(wetChecks.id, deletableId));
    const stayWc = await db.select().from(wetChecks).where(eq(wetChecks.id, blockedWcId));
    assert.equal(goneWc.length, 0, "deletable wet check must be removed");
    assert.equal(stayWc.length, 1, "invoiced wet check must still exist");
  });

  test("irrigation_manager: bulk delete cascades downstream when nothing is invoiced", async () => {
    // Routed but NOT invoiced — bulk delete should succeed and cascade-delete
    // the downstream billing sheet alongside the wet check.
    const { wetCheckId, billingSheetId } =
      await buildRoutedWetCheck("irr-bulk-cascade");

    const bulk = await api(IRRIGATION_MGR_HEADERS, "DELETE", "/api/wet-checks/bulk-delete", {
      ids: [wetCheckId],
    });
    assert.equal(bulk.status, 200, `bulk: ${JSON.stringify(bulk.body)}`);
    assert.equal(bulk.body.summary.deleted, 1,
      `routed-but-not-invoiced bulk delete must succeed: ${JSON.stringify(bulk.body)}`);
    assert.equal(bulk.body.summary.blocked, 0);

    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 0, "wet check must be deleted");
    const bsRows = await db.select().from(billingSheets)
      .where(eq(billingSheets.id, billingSheetId));
    assert.equal(bsRows.length, 0, "downstream billing sheet must be cascade-deleted");
  });

  test("Cascade: routed-to-estimate wet check deletes the estimate + items along with the wet check", async () => {
    // The convert→estimate API path is currently failing on a pre-existing
    // schema drift issue (see tests/estimate-create.test.mjs failures), so
    // we plant the estimate + estimate-item + finding.estimateId FK directly
    // via Drizzle to test the cascade-delete contract on its own merits.
    const customerId = await createCustomer("cascade-est");
    const partId = await createPart();
    const wetCheckId = await createWetCheck(customerId);
    const zoneRecordId = await addZone(wetCheckId, 1);
    const findingId = await addFinding(zoneRecordId, partId);

    const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const [estimate] = await db.insert(estimates).values({
      estimateNumber: `EST-WC-CASCADE-${tag}`,
      companyId: 99,
      customerId,
      customerName: "WC Cascade Estimate Customer",
      customerEmail: `wc-cascade-est-${tag}@example.com`,
      projectName: "WC Cascade Estimate Project",
      partsSubtotal: "20.00",
      laborSubtotal: "25.00",
      totalAmount: "45.00",
      laborRate: "50.00",
    }).returning();
    // NOTE: schema declares estimate_items.description NOT NULL DEFAULT ''
    // but the live DB is drifted (column missing — see the same failure in
    // tests/estimate-create.test.mjs). Use raw SQL targeting only the
    // columns that actually exist in the deployed schema.
    await db.execute(sql`
      INSERT INTO estimate_items
        (estimate_id, part_id, part_name, part_price, quantity, labor_hours, total_price)
      VALUES
        (${estimate.id}, ${partId}, 'WC Cascade Part', '20.00', 1, '0.50', '20.00')
    `);
    await db.update(wetCheckFindings)
      .set({ estimateId: estimate.id, resolution: "sent_to_estimate" })
      .where(eq(wetCheckFindings.id, findingId));

    // Pre-flight: estimate exists, finding carries the FK, items exist.
    const beforeEst = await db.select().from(estimates)
      .where(eq(estimates.id, estimate.id));
    assert.equal(beforeEst.length, 1, "estimate must exist before delete");
    const beforeEstItems = await db.execute(sql`
      SELECT id FROM estimate_items WHERE estimate_id = ${estimate.id}
    `);
    assert.equal(beforeEstItems.rows.length, 1, "estimate item must exist before delete");
    const [routedRow] = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.equal(routedRow.estimateId, estimate.id, "finding must carry estimateId");

    const del = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 200,
      `routed-to-estimate delete must succeed, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.equal(del.body.ok, true);

    // Wet check, findings, estimate, and estimate items must all be gone.
    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 0, "wet check row must be gone");
    const fRows = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wetCheckId));
    assert.equal(fRows.length, 0, "findings must be cascade-deleted");
    const estRows = await db.select().from(estimates)
      .where(eq(estimates.id, estimate.id));
    assert.equal(estRows.length, 0, "downstream estimate must be cascade-deleted");
    const eiRows = await db.execute(sql`
      SELECT id FROM estimate_items WHERE estimate_id = ${estimate.id}
    `);
    assert.equal(eiRows.rows.length, 0, "estimate items must be cascade-deleted");
  });

  test("Cascade: routed-to-work-order wet check deletes the WO + items along with the wet check", async () => {
    const { wetCheckId, findingId, workOrderId } =
      await buildRoutedWetCheck("cascade-wo", "deferred_to_work_order");
    assert.ok(workOrderId, "expected a work order from deferred_to_work_order conversion");

    const beforeWo = await db.select().from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    assert.equal(beforeWo.length, 1, "work order must exist before delete");
    const beforeWoItems = await db.select().from(workOrderItems)
      .where(eq(workOrderItems.workOrderId, workOrderId));
    assert.ok(beforeWoItems.length >= 1, "work order items must exist before delete");
    const [routedRow] = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.equal(routedRow.workOrderId, workOrderId, "finding must carry workOrderId after convert");

    const del = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 200,
      `routed-to-WO delete must succeed, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.equal(del.body.ok, true);

    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 0, "wet check row must be gone");
    const woRows = await db.select().from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    assert.equal(woRows.length, 0, "downstream work order must be cascade-deleted");
    const woItemRows = await db.select().from(workOrderItems)
      .where(eq(workOrderItems.workOrderId, workOrderId));
    assert.equal(woItemRows.length, 0, "work order items must be cascade-deleted");
  });

  test("409 with structured blockers when a downstream work order is on an invoice", async () => {
    const { customerId, wetCheckId, findingId, workOrderId } =
      await buildRoutedWetCheck("invoice-block-wo-409", "deferred_to_work_order");
    assert.ok(workOrderId, "expected a work order");
    const invoiceId = await attachWorkOrderToInvoice(customerId, workOrderId, "wo-single");

    const del = await api(ADMIN_HEADERS, "DELETE", `/api/wet-checks/${wetCheckId}`);
    assert.equal(del.status, 409,
      `invoiced-WO delete must be 409, got ${del.status} ${JSON.stringify(del.body)}`);
    assert.ok(Array.isArray(del.body.blockers), "blockers[] required");
    const woBlocker = del.body.blockers.find(
      (b) => b.kind === "work_order" && b.id === workOrderId,
    );
    assert.ok(woBlocker,
      `blockers must include the invoiced work order, got ${JSON.stringify(del.body.blockers)}`);
    assert.equal(woBlocker.invoiceId, invoiceId);

    // Schema reality check (Task #284 storage comment): no estimate-kind
    // blocker should ever appear because there's no direct estimate→invoice
    // FK in the schema; estimate invoicing only happens via the work order
    // it was converted into, which is already covered by the WO blocker.
    const estimateBlocker = del.body.blockers.find((b) => b.kind === "estimate");
    assert.equal(estimateBlocker, undefined,
      `no kind: "estimate" blocker should be emitted, got ${JSON.stringify(del.body.blockers)}`);

    // Nothing must have been removed.
    const wcRows = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(wcRows.length, 1, "wet check must still exist after a 409 refusal");
    const woRows = await db.select().from(workOrders)
      .where(eq(workOrders.id, workOrderId));
    assert.equal(woRows.length, 1, "work order must still exist after a 409 refusal");
    const findingRows = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.equal(findingRows.length, 1, "finding must still exist after a 409 refusal");
  });

  test("irrigation_manager: bulk delete is still scoped by company (no cross-company deletes)", async () => {
    const { wetCheckId } = await buildSimpleWetCheck("irr-bulk-xcompany");

    const res = await api(
      { ...IRRIGATION_MGR_HEADERS, "x-user-company-id": "987654" },
      "DELETE",
      "/api/wet-checks/bulk-delete",
      { ids: [wetCheckId] },
    );
    assert.equal(res.status, 200, `bulk: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.summary.deleted, 0, "must not delete across company");
    assert.equal(res.body.summary.notFound, 1, "must report not_found across company");

    const stillThere = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(stillThere.length, 1, "wet check must NOT be deleted across company scope");
  });

  test("field_tech and billing_manager still get 403 on bulk delete", async () => {
    const { wetCheckId } = await buildSimpleWetCheck("bulk-403");

    const ft = await api(FIELD_HEADERS, "DELETE", "/api/wet-checks/bulk-delete", {
      ids: [wetCheckId],
    });
    assert.equal(ft.status, 403,
      `field_tech bulk delete must be 403, got ${ft.status} ${JSON.stringify(ft.body)}`);

    const bm = await api(BILLING_MGR_HEADERS, "DELETE", "/api/wet-checks/bulk-delete", {
      ids: [wetCheckId],
    });
    assert.equal(bm.status, 403,
      `billing_manager bulk delete must be 403, got ${bm.status} ${JSON.stringify(bm.body)}`);

    const stillThere = await db.select().from(wetChecks).where(eq(wetChecks.id, wetCheckId));
    assert.equal(stillThere.length, 1, "wet check must NOT be deleted by non-admin roles");
  });
});

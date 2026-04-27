import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

async function api(method, path, body, headers = ADMIN_HEADERS) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let CUSTOMER_ID;
let CATALOG_PART_ID;
const CATALOG_PART_PRICE = 27.5;

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Authoritative Pricing Customer",
    email: `auth_pricing_${Date.now()}@example.com`,
    laborRate: "60.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function ensureCatalogPart() {
  const sku = `AUTH-PRICE-${Date.now()}`;
  const res = await api("POST", "/api/parts", {
    companyId: 99,
    name: "Auth Pricing Test Part",
    sku,
    description: "Used by billing-pricing-authoritative.test.mjs",
    price: CATALOG_PART_PRICE.toFixed(2),
    cost: "10.00",
    category: "Test",
  });
  assert.ok(
    res.status === 201 || res.status === 200,
    `Part creation failed: ${res.status} ${JSON.stringify(res.body)}`,
  );
  return res.body.id;
}

async function createSheetWithItems(items, extra = {}) {
  const partsSubtotal = items.reduce(
    (s, i) => s + Number(i.quantity || 0) * Number(i.unitPrice || 0),
    0,
  );
  return api("POST", "/api/billing-sheets", {
    customerId: CUSTOMER_ID,
    customerName: "Authoritative Pricing Customer",
    propertyAddress: "1 Pricing Way",
    workDate: new Date().toISOString().slice(0, 10),
    technicianName: "Auth Tech",
    technicianId: null,
    workDescription: "Authoritative pricing run",
    status: "draft",
    totalHours: "1",
    laborRate: "60.00",
    laborSubtotal: "60.00",
    partsSubtotal: partsSubtotal.toFixed(2),
    markupAmount: "0",
    taxAmount: "0",
    totalAmount: (60 + partsSubtotal).toFixed(2),
    items,
    ...extra,
  });
}

describe("Authoritative pricing for billing sheets and work orders", () => {
  before(async () => {
    CUSTOMER_ID = await ensureCustomer();
    CATALOG_PART_ID = await ensureCatalogPart();
  });

  test("POST /api/billing-sheets overwrites a $0 client unit price for a catalog part", async () => {
    const create = await createSheetWithItems([
      {
        partId: CATALOG_PART_ID,
        partName: "Auth Pricing Test Part",
        partDescription: "",
        quantity: 3,
        unitPrice: 0, // intentionally wrong — client tried to bill $0
        laborHours: 0,
        notes: "",
      },
    ]);
    assert.equal(create.status, 200, `Create failed: ${JSON.stringify(create.body)}`);
    const sheetId = create.body.id;

    const get = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(get.status, 200);
    const items = get.body.items ?? [];
    assert.equal(items.length, 1, "Expected one billing-sheet item");
    const stored = parseFloat(items[0].unitPrice);
    assert.ok(
      Math.abs(stored - CATALOG_PART_PRICE) < 0.01,
      `Expected unitPrice ~$${CATALOG_PART_PRICE}, got $${stored}`,
    );
    const total = parseFloat(items[0].totalPrice);
    assert.ok(
      Math.abs(total - 3 * CATALOG_PART_PRICE) < 0.01,
      `Expected totalPrice ~$${(3 * CATALOG_PART_PRICE).toFixed(2)}, got $${total}`,
    );
  });

  test("POST /api/billing-sheets rejects an unknown partId with 4xx", async () => {
    const create = await createSheetWithItems([
      {
        partId: 999999999,
        partName: "Imaginary Part",
        quantity: 1,
        unitPrice: 0,
        laborHours: 0,
      },
    ]);
    assert.ok(
      create.status >= 400 && create.status < 500,
      `Expected 4xx for unknown partId, got ${create.status}: ${JSON.stringify(create.body)}`,
    );
  });

  test("Manual line item (no partId) at $0 is accepted as-is", async () => {
    const create = await createSheetWithItems([
      {
        // no partId — this is the manual / catalog-pending flow
        partName: "Custom one-off thing",
        partDescription: "no catalog row yet",
        quantity: 1,
        unitPrice: 0,
        laborHours: 0,
        notes: "Pending catalog approval",
      },
    ]);
    assert.equal(create.status, 200, `Manual $0 line should be allowed: ${JSON.stringify(create.body)}`);
    const get = await api("GET", `/api/billing-sheets/${create.body.id}`);
    const items = get.body.items ?? [];
    assert.equal(items.length, 1);
    assert.equal(parseFloat(items[0].unitPrice), 0, "Manual line $0 should be preserved");
  });

  test("POST /api/work-orders overwrites a $0 client unit price for a catalog part", async () => {
    const create = await api("POST", "/api/work-orders", {
      customerId: CUSTOMER_ID,
      customerName: "Authoritative Pricing Customer",
      customerEmail: "auth_pricing_wo@example.com",
      projectName: "Auth Pricing WO Project",
      projectAddress: "1 Pricing Way",
      workOrderNumber: `WO-AUTH-${Date.now()}`,
      workType: "direct_billing",
      priority: "medium",
      status: "pending",
      description: "Authoritative pricing WO test",
      totalHours: "0",
      items: [
        {
          partId: CATALOG_PART_ID,
          partName: "Auth Pricing Test Part",
          quantity: 2,
          unitPrice: 0, // intentionally wrong
          laborHours: 0,
          notes: "",
        },
      ],
    });
    assert.equal(create.status, 201, `WO create failed: ${JSON.stringify(create.body)}`);
    const woId = create.body.id;

    const items = await api("GET", `/api/work-orders/${woId}/items`);
    assert.equal(items.status, 200);
    assert.equal(items.body.length, 1, "Expected one work-order item");
    const stored = parseFloat(items.body[0].partPrice);
    assert.ok(
      Math.abs(stored - CATALOG_PART_PRICE) < 0.01,
      `Expected partPrice ~$${CATALOG_PART_PRICE}, got $${stored}`,
    );
    const total = parseFloat(items.body[0].totalPrice);
    assert.ok(
      Math.abs(total - 2 * CATALOG_PART_PRICE) < 0.01,
      `Expected totalPrice ~$${(2 * CATALOG_PART_PRICE).toFixed(2)}, got $${total}`,
    );
  });

  test("POST /api/work-orders rejects an unknown partId WITHOUT creating an orphan WO", async () => {
    const before = await api("GET", "/api/work-orders");
    const beforeIds = new Set((before.body ?? []).map((w) => w.id));

    const create = await api("POST", "/api/work-orders", {
      customerId: CUSTOMER_ID,
      customerName: "Authoritative Pricing Customer",
      customerEmail: "auth_pricing_wo_bad@example.com",
      projectName: "Auth Pricing WO Bad Project",
      projectAddress: "1 Pricing Way",
      workOrderNumber: `WO-AUTH-BAD-${Date.now()}`,
      workType: "direct_billing",
      priority: "medium",
      status: "pending",
      description: "Authoritative pricing WO bad-part test",
      totalHours: "0",
      items: [
        {
          partId: 999999999,
          partName: "Imaginary Part",
          quantity: 1,
          unitPrice: 0,
          laborHours: 0,
        },
      ],
    });
    assert.ok(
      create.status >= 400 && create.status < 500,
      `Expected 4xx for unknown partId, got ${create.status}: ${JSON.stringify(create.body)}`,
    );

    // Confirm no new work order was persisted (atomic rejection).
    const after = await api("GET", "/api/work-orders");
    const afterIds = (after.body ?? []).map((w) => w.id);
    const newIds = afterIds.filter((id) => !beforeIds.has(id));
    assert.equal(newIds.length, 0, `Bad-partId POST should not persist a WO; new ids: ${JSON.stringify(newIds)}`);
  });

  test("Audit endpoint dry-run vs. apply re-prices an existing zero-price catalog row", async () => {
    // Plant a bad row by using an existing valid sheet and PATCHing in the bad row
    // via the storage layer is overkill — instead, simulate by creating a sheet
    // where the catalog price is temporarily $0, then bumping the catalog price.
    const tempSku = `AUDIT-TARGET-${Date.now()}`;
    const partRes = await api("POST", "/api/parts", {
      companyId: 99,
      name: "Audit Target Part",
      sku: tempSku,
      price: "0.00",
      cost: "0.00",
      category: "Test",
    });
    assert.ok(partRes.status === 201 || partRes.status === 200, `temp part create: ${partRes.status}`);
    const targetPartId = partRes.body.id;

    const create = await createSheetWithItems([
      {
        partId: targetPartId,
        partName: "Audit Target Part",
        quantity: 4,
        unitPrice: 0,
        laborHours: 0,
      },
    ]);
    assert.equal(create.status, 200, `Bad sheet create: ${JSON.stringify(create.body)}`);
    const sheetId = create.body.id;

    // Now raise the catalog price so the audit picks the row up.
    const newPrice = 12.0;
    const patchPart = await api("PATCH", `/api/parts/${targetPartId}`, {
      price: newPrice.toFixed(2),
    });
    assert.ok(
      patchPart.status >= 200 && patchPart.status < 300,
      `Part price update failed: ${patchPart.status} ${JSON.stringify(patchPart.body)}`,
    );

    // The audit should now list our row.
    const audit = await api("GET", "/api/admin/billing-sheets/zero-price-audit");
    assert.equal(audit.status, 200, `Audit list failed: ${JSON.stringify(audit.body)}`);
    const ourRow = (audit.body.rows ?? []).find(
      (r) => r.source === "billing_sheet" && r.parentId === sheetId,
    );
    assert.ok(ourRow, "Expected audit to surface our zero-price row");
    assert.equal(parseInt(ourRow.partId), targetPartId);
    assert.ok(Math.abs(parseFloat(ourRow.catalogUnitPrice) - newPrice) < 0.01);

    // Dry-run repair: nothing should actually change.
    const dry = await api("POST", "/api/admin/billing-sheets/zero-price-audit/repair", {
      selection: [{ source: "billing_sheet", itemId: ourRow.itemId }],
      dryRun: true,
    });
    assert.equal(dry.status, 200, `Dry-run failed: ${JSON.stringify(dry.body)}`);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.parentCount, 1);
    assert.equal(dry.body.itemCount, 1);

    const stillBad = await api("GET", `/api/billing-sheets/${sheetId}`);
    const stillBadItem = (stillBad.body.items ?? []).find((i) => parseInt(i.partId) === targetPartId);
    assert.ok(stillBadItem, "row should still be present after dry-run");
    assert.equal(parseFloat(stillBadItem.unitPrice), 0, "dry-run must not mutate stored unitPrice");

    // Apply the repair.
    const apply = await api("POST", "/api/admin/billing-sheets/zero-price-audit/repair", {
      selection: [{ source: "billing_sheet", itemId: ourRow.itemId }],
      dryRun: false,
    });
    assert.equal(apply.status, 200, `Apply failed: ${JSON.stringify(apply.body)}`);
    assert.equal(apply.body.dryRun, false);
    assert.equal(apply.body.parentCount, 1);
    assert.equal(apply.body.itemCount, 1);

    const fixed = await api("GET", `/api/billing-sheets/${sheetId}`);
    const fixedItem = (fixed.body.items ?? []).find((i) => parseInt(i.partId) === targetPartId);
    assert.ok(fixedItem, "row should still be present after apply");
    assert.ok(
      Math.abs(parseFloat(fixedItem.unitPrice) - newPrice) < 0.01,
      `Expected unitPrice ${newPrice}, got ${fixedItem.unitPrice}`,
    );
    assert.ok(
      Math.abs(parseFloat(fixedItem.totalPrice) - 4 * newPrice) < 0.01,
      `Expected totalPrice ${(4 * newPrice).toFixed(2)}, got ${fixedItem.totalPrice}`,
    );
  });
});

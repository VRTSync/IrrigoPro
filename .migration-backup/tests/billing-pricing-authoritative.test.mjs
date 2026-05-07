import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

// Direct storage / db import — used by the Task #161 invoice test below to
// plant a "bad" invoice line item that bypasses the live createInvoiceItem
// safeguard (the safeguard is the very thing we want the audit to catch when
// data was written before the safeguard existed).
const { storage } = await import("../server/storage.ts");
const { db } = await import("../server/db.ts");
const { invoices, invoiceItems, billingSheets, billingSheetItems } = await import("../shared/schema.ts");

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

  // ─── Task #161: invoice line items ────────────────────────────────────────
  test("Audit endpoint surfaces an invoice line item with a stale $0 catalog price and repairs it", async () => {
    // 1. Create a catalog part starting at $0 so we can plant a $0 invoice row.
    const tempSku = `INV-AUDIT-${Date.now()}`;
    const partRes = await api("POST", "/api/parts", {
      companyId: 99,
      name: "Invoice Audit Target Part",
      sku: tempSku,
      price: "0.00",
      cost: "0.00",
      category: "Test",
    });
    assert.ok(
      partRes.status === 201 || partRes.status === 200,
      `temp part create: ${partRes.status}`,
    );
    const targetPartId = partRes.body.id;

    // 2. Plant a bad invoice + invoice_item directly via db. We bypass
    //    storage.createInvoiceItem on purpose — the safeguard would
    //    rewrite the price and there'd be nothing for the audit to find.
    const invoiceNumber = `INV-AUDIT-${Date.now()}`;
    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
    const QTY = 5;
    const oldPartsSubtotal = 0;
    const oldLaborSubtotal = 100;
    const oldTotalAmount = oldPartsSubtotal + oldLaborSubtotal;
    const [planted] = await db.insert(invoices).values({
      invoiceNumber,
      customerId: CUSTOMER_ID,
      customerName: "Authoritative Pricing Customer",
      customerEmail: "auth_pricing_inv_audit@example.com",
      invoiceMonth: periodStart.getMonth() + 1,
      invoiceYear: periodStart.getFullYear(),
      periodStart,
      periodEnd,
      partsSubtotal: oldPartsSubtotal.toFixed(2),
      laborSubtotal: oldLaborSubtotal.toFixed(2),
      totalAmount: oldTotalAmount.toFixed(2),
    }).returning();
    const invoiceId = planted.id;

    const [plantedItem] = await db.insert(invoiceItems).values({
      invoiceId,
      sourceType: "billing_sheet",
      sourceId: 0,
      workDate: periodStart,
      description: "Planted bad invoice line for Task #161 audit test",
      partId: targetPartId,
      partName: "Invoice Audit Target Part",
      quantity: QTY.toString(),
      unitPrice: "0.00",
      totalPrice: "0.00",
      laborHours: "0",
      laborRate: "0",
      laborTotal: "0",
    }).returning();
    const invoiceItemId = plantedItem.id;

    // 3. Now raise the catalog price so the audit can detect drift.
    const newPrice = 8.5;
    const patchPart = await api("PATCH", `/api/parts/${targetPartId}`, {
      price: newPrice.toFixed(2),
    });
    assert.ok(
      patchPart.status >= 200 && patchPart.status < 300,
      `Part price update failed: ${patchPart.status} ${JSON.stringify(patchPart.body)}`,
    );

    // 4. The audit should now list our row under source 'invoice'.
    const audit = await api("GET", "/api/admin/billing-sheets/zero-price-audit");
    assert.equal(audit.status, 200, `Audit list failed: ${JSON.stringify(audit.body)}`);
    const ourRow = (audit.body.rows ?? []).find(
      (r) => r.source === "invoice" && r.itemId === invoiceItemId,
    );
    assert.ok(ourRow, "Expected audit to surface our zero-price invoice row");
    assert.equal(parseInt(ourRow.partId), targetPartId);
    assert.equal(parseInt(ourRow.parentId), invoiceId);
    assert.equal(ourRow.parentNumber, invoiceNumber);
    assert.ok(
      Math.abs(parseFloat(ourRow.catalogUnitPrice) - newPrice) < 0.01,
      `audit catalog price ${ourRow.catalogUnitPrice} != ${newPrice}`,
    );
    const expectedDelta = QTY * newPrice;
    assert.ok(
      Math.abs(parseFloat(ourRow.difference) - expectedDelta) < 0.01,
      `audit delta ${ourRow.difference} != ${expectedDelta}`,
    );

    // 5. Dry-run repair: nothing should actually change.
    const dry = await api("POST", "/api/admin/billing-sheets/zero-price-audit/repair", {
      selection: [{ source: "invoice", itemId: invoiceItemId }],
      dryRun: true,
    });
    assert.equal(dry.status, 200, `Dry-run failed: ${JSON.stringify(dry.body)}`);
    assert.equal(dry.body.dryRun, true);
    assert.equal(dry.body.parentCount, 1);
    assert.equal(dry.body.itemCount, 1);
    const dryParent = dry.body.parents[0];
    assert.equal(dryParent.source, "invoice");
    assert.equal(dryParent.parentNumber, invoiceNumber);

    const stillBad = await storage.getInvoiceById(invoiceId);
    const stillBadItem = stillBad.items.find((i) => i.id === invoiceItemId);
    assert.ok(stillBadItem, "row should still be present after dry-run");
    assert.equal(parseFloat(stillBadItem.unitPrice), 0, "dry-run must not mutate stored unitPrice");
    assert.equal(parseFloat(stillBad.totalAmount), oldTotalAmount, "dry-run must not mutate invoice total");

    // 6. Apply the repair.
    const apply = await api("POST", "/api/admin/billing-sheets/zero-price-audit/repair", {
      selection: [{ source: "invoice", itemId: invoiceItemId }],
      dryRun: false,
    });
    assert.equal(apply.status, 200, `Apply failed: ${JSON.stringify(apply.body)}`);
    assert.equal(apply.body.dryRun, false);
    assert.equal(apply.body.parentCount, 1);
    assert.equal(apply.body.itemCount, 1);

    const fixed = await storage.getInvoiceById(invoiceId);
    const fixedItem = fixed.items.find((i) => i.id === invoiceItemId);
    assert.ok(fixedItem, "row should still be present after apply");
    assert.ok(
      Math.abs(parseFloat(fixedItem.unitPrice) - newPrice) < 0.01,
      `Expected unitPrice ${newPrice}, got ${fixedItem.unitPrice}`,
    );
    assert.ok(
      Math.abs(parseFloat(fixedItem.totalPrice) - QTY * newPrice) < 0.01,
      `Expected totalPrice ${(QTY * newPrice).toFixed(2)}, got ${fixedItem.totalPrice}`,
    );
    assert.ok(
      Math.abs(parseFloat(fixed.partsSubtotal) - (oldPartsSubtotal + expectedDelta)) < 0.01,
      `Expected partsSubtotal ${(oldPartsSubtotal + expectedDelta).toFixed(2)}, got ${fixed.partsSubtotal}`,
    );
    assert.ok(
      Math.abs(parseFloat(fixed.totalAmount) - (oldTotalAmount + expectedDelta)) < 0.01,
      `Expected totalAmount ${(oldTotalAmount + expectedDelta).toFixed(2)}, got ${fixed.totalAmount}`,
    );
  });

  test("storage.createInvoiceItem overrides client-supplied $0 unit price for a catalog part", async () => {
    // Plant minimal invoice via db (no items); use storage.createInvoiceItem
    // for the line item so the safeguard runs.
    const invoiceNumber = `INV-SAFEGUARD-${Date.now()}`;
    const now = new Date();
    const [inv] = await db.insert(invoices).values({
      invoiceNumber,
      customerId: CUSTOMER_ID,
      customerName: "Authoritative Pricing Customer",
      customerEmail: "auth_pricing_inv_safeguard@example.com",
      invoiceMonth: now.getMonth() + 1,
      invoiceYear: now.getFullYear(),
      periodStart: now,
      periodEnd: now,
      partsSubtotal: "0.00",
      laborSubtotal: "0.00",
      totalAmount: "0.00",
    }).returning();

    const created = await storage.createInvoiceItem({
      invoiceId: inv.id,
      sourceType: "billing_sheet",
      sourceId: 0,
      workDate: now,
      description: "Safeguard test",
      partId: CATALOG_PART_ID,
      partName: "Auth Pricing Test Part",
      quantity: "2",
      unitPrice: "0.00", // client tries to bill $0
      totalPrice: "0.00",
      laborHours: "0",
      laborRate: "0",
      laborTotal: "0",
    });
    assert.ok(
      Math.abs(parseFloat(created.unitPrice) - CATALOG_PART_PRICE) < 0.01,
      `Expected unitPrice ~$${CATALOG_PART_PRICE}, got $${created.unitPrice}`,
    );
    assert.ok(
      Math.abs(parseFloat(created.totalPrice) - 2 * CATALOG_PART_PRICE) < 0.01,
      `Expected totalPrice ~$${(2 * CATALOG_PART_PRICE).toFixed(2)}, got $${created.totalPrice}`,
    );

    // Unknown partId should throw, NOT silently insert a row.
    await assert.rejects(
      () => storage.createInvoiceItem({
        invoiceId: inv.id,
        sourceType: "billing_sheet",
        sourceId: 0,
        workDate: now,
        description: "Safeguard reject test",
        partId: 999999999,
        partName: "Imaginary Part",
        quantity: "1",
        unitPrice: "0.00",
        totalPrice: "0.00",
        laborHours: "0",
        laborRate: "0",
        laborTotal: "0",
      }),
      /Catalog part with ID 999999999/,
      "Expected createInvoiceItem to reject unknown partId",
    );
  });

  // End-to-end: simulate the full historical scenario the task spec calls out
  // — an invoice generated from a billing sheet that contains a $0 catalog
  // row (legacy data planted directly to bypass the route safeguard). The
  // invoice generation safeguard should rewrite the price to the catalog
  // value when the invoice is created.
  test("Invoice created from a billing sheet with a previously $0 catalog row uses the catalog price", async () => {
    // 1. A catalog part priced at $7.25 today.
    const tempSku = `INV-FROM-SHEET-${Date.now()}`;
    const partRes = await api("POST", "/api/parts", {
      companyId: 99,
      name: "Invoice-From-Sheet Test Part",
      sku: tempSku,
      price: "7.25",
      cost: "1.00",
      category: "Test",
    });
    assert.ok(partRes.status === 201 || partRes.status === 200);
    const partId = partRes.body.id;
    const QTY = 6;

    // 2. Plant a billing sheet + sheet item directly via db with unitPrice=0
    //    for that catalog part. This simulates legacy data written before
    //    Task #160's safeguard existed.
    const billingNumber = `BS-LEGACY-${Date.now()}`;
    // Use a distinct future month so createMonthlyInvoice's "existing invoice"
    // short-circuit (keyed on customer + month + year) does not return a
    // previously-created invoice from earlier tests in this file.
    const workDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const [legacySheet] = await db.insert(billingSheets).values({
      billingNumber,
      customerId: CUSTOMER_ID,
      customerName: "Authoritative Pricing Customer",
      propertyAddress: "1 Pricing Way",
      workDate,
      technicianName: "Legacy Tech",
      workDescription: "Legacy sheet planted for invoice-from-sheet test",
      status: "approved_passed_to_billing",
      totalHours: "0.00",
      laborRate: "60.00",
      laborSubtotal: "0.00",
      partsSubtotal: "0.00", // historical bug: subtotal $0 even though row exists
      totalAmount: "0.00",
    }).returning();
    await db.insert(billingSheetItems).values({
      billingSheetId: legacySheet.id,
      partId,
      partName: "Invoice-From-Sheet Test Part",
      quantity: QTY.toString(),
      unitPrice: "0.00",
      totalPrice: "0.00",
      laborHours: "0",
    });

    // 3. Build the invoice from this sheet via the storage entry point.
    //    createMonthlyInvoice routes per-part inserts through createInvoiceItem,
    //    so the safeguard should rewrite the $0 row to the catalog price.
    const month = workDate.getMonth() + 1;
    const year = workDate.getFullYear();
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0);
    const invoice = await storage.createMonthlyInvoice(
      CUSTOMER_ID,
      { workOrders: [], billingSheets: [legacySheet] },
      month, year, periodStart, periodEnd,
    );
    assert.ok(invoice, "Invoice should be created");

    // 4. The invoice line item must hold the catalog price, NOT the $0 from the sheet.
    const invoiceWithItems = await storage.getInvoiceById(invoice.id);
    const ourItem = invoiceWithItems.items.find((i) => i.partId === partId);
    assert.ok(ourItem, "Expected the invoice to contain a line item for our catalog part");
    assert.ok(
      Math.abs(parseFloat(ourItem.unitPrice) - 7.25) < 0.01,
      `Expected unitPrice 7.25, got ${ourItem.unitPrice}`,
    );
    assert.ok(
      Math.abs(parseFloat(ourItem.totalPrice) - QTY * 7.25) < 0.01,
      `Expected totalPrice ${(QTY * 7.25).toFixed(2)}, got ${ourItem.totalPrice}`,
    );
  });

  // Task #206 — Manager-created billing sheets must immediately appear in the
  // customer's Ready-to-Invoice (unbilledBillingSheets) list. Before the fix
  // they landed at status='approved' with no transition forward, so the unbilled
  // filter (which only accepted 'approved_passed_to_billing') hid them forever.
  test("Manager-created billing sheet immediately appears in unbilledBillingSheets", async () => {
    const billingManagerHeaders = {
      "Content-Type": "application/json",
      "x-user-id": "2",
      "x-user-role": "billing_manager",
      "x-user-company-id": "99",
    };

    // Create a billing sheet as a billing_manager via the real route.
    const create = await api(
      "POST",
      "/api/billing-sheets",
      {
        customerId: CUSTOMER_ID,
        customerName: "Authoritative Pricing Customer",
        propertyAddress: "1 Pricing Way",
        workDate: new Date().toISOString().slice(0, 10),
        technicianName: "Manager Tech",
        technicianId: null,
        workDescription: "Task #206 regression — manager self-create",
        status: "draft", // server should overwrite this based on creator role
        totalHours: "1",
        laborRate: "60.00",
        laborSubtotal: "60.00",
        partsSubtotal: "0.00",
        totalAmount: "60.00",
        items: [],
      },
      billingManagerHeaders,
    );
    assert.equal(create.status, 200, `Manager BS create failed: ${JSON.stringify(create.body)}`);
    const sheetId = create.body.id;

    // Server should have routed the sheet directly to approved_passed_to_billing
    // (NOT the dead-end legacy 'approved'), with the approval audit fields stamped.
    const fetched = await api("GET", `/api/billing-sheets/${sheetId}`);
    assert.equal(fetched.status, 200);
    assert.equal(
      fetched.body.status,
      "approved_passed_to_billing",
      `Manager-created sheet should land at 'approved_passed_to_billing', got '${fetched.body.status}'`,
    );
    assert.ok(fetched.body.approvedAt, "approvedAt should be stamped on manager self-approval");
    assert.ok(fetched.body.approvedBy, "approvedBy should be stamped on manager self-approval");

    // The customer billing endpoint must surface this sheet in unbilledBillingSheets.
    const billing = await api("GET", `/api/customers/${CUSTOMER_ID}/billing`);
    assert.equal(billing.status, 200);
    const unbilled = (billing.body.unbilledBillingSheets ?? []).find((bs) => bs.id === sheetId);
    assert.ok(
      unbilled,
      `Manager-created billing sheet ${sheetId} must appear in unbilledBillingSheets so it can be selected for the monthly invoice`,
    );
  });

  // Task #207 — the legacy 'approved' billing-sheet status is gone from the
  // schema. POST /api/billing-sheets must NEVER produce a row whose status
  // is the legacy 'approved': manager-class roles get their status
  // overridden to 'approved_passed_to_billing' regardless of the payload,
  // and the fallback branch runs the payload through z.enum so unknown
  // values collapse to 'draft'. (The previous Task #206 safety-net test,
  // which planted an 'approved' row directly via the DB and asserted it
  // appeared in Ready to Bill, was removed because the safety net no
  // longer exists.)
  test("POST /api/billing-sheets never persists legacy status='approved'", async () => {
    const res = await api("POST", "/api/billing-sheets", {
      customerId: CUSTOMER_ID,
      customerName: "Authoritative Pricing Customer",
      propertyAddress: "1 Pricing Way",
      workDate: new Date().toISOString(),
      technicianName: "Legacy Tech",
      workDescription: "Task #207 — legacy status should be normalized away",
      status: "approved",
      totalHours: "1.00",
      laborRate: "60.00",
      laborSubtotal: "60.00",
      partsSubtotal: "0.00",
      totalAmount: "60.00",
    });
    assert.equal(res.status, 200, `Unexpected status ${res.status}: ${JSON.stringify(res.body)}`);
    assert.notEqual(
      res.body.status,
      "approved",
      `Server must normalize legacy 'approved' away; got status='${res.body.status}'`,
    );
    // Re-read from the API to confirm the persisted row is not 'approved' either.
    const fetched = await api("GET", `/api/billing-sheets/${res.body.id}`);
    assert.equal(fetched.status, 200);
    assert.notEqual(
      fetched.body.status,
      "approved",
      `Persisted billing sheet must not be at legacy status='approved'`,
    );

    // PATCH must also reject the legacy value: the DB column is plain text
    // with no check constraint, so the API is the authoritative guard.
    const patchRes = await api("PATCH", `/api/billing-sheets/${res.body.id}`, {
      status: "approved",
    });
    assert.ok(
      patchRes.status >= 400 && patchRes.status < 500,
      `Expected 4xx for PATCH status='approved', got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`,
    );
    const fetchedAfterPatch = await api("GET", `/api/billing-sheets/${res.body.id}`);
    assert.equal(fetchedAfterPatch.status, 200);
    assert.notEqual(
      fetchedAfterPatch.body.status,
      "approved",
      `PATCH must not have been able to write legacy status='approved'`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task #209: billing-preview aggregation invariants
//
// Locks in two guarantees that the orange "Total / Approved / Unapproved" box
// (and the Billing Dashboard tiles) depend on:
//   1. Every per-customer money field returned is a finite Number, never NaN.
//   2. combinedTotal is computed independently of the two subtotals, but must
//      always equal approvedTotal + unapprovedTotal (within rounding).
//      This is the regression sentinel for the original Task #209 bug
//      ("Total < Approved + Unapproved").
//   3. totalUnbilled (no date filter) >= the date-windowed combinedTotal,
//      and currentMonthUnbilled is also finite.
// ─────────────────────────────────────────────────────────────────────────────
describe("billing-preview aggregation invariants (Task #209)", () => {
  const TOL = 0.005;

  test("every customer's money fields are finite and combinedTotal === approved + unapproved", async () => {
    const res = await api(
      "GET",
      "/api/customers/billing-preview?dateFilter=all",
    );
    assert.equal(
      res.status,
      200,
      `billing-preview must return 200, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const previews = Array.isArray(res.body) ? res.body : [];
    assert.ok(
      previews.length > 0,
      "billing-preview should return at least one customer (test seeds one)",
    );

    const moneyFields = [
      "approvedTotal",
      "unapprovedTotal",
      "combinedTotal",
      "totalUnbilled",
      "currentMonthUnbilled",
    ];

    for (const p of previews) {
      for (const f of moneyFields) {
        const n = Number(p[f]);
        assert.ok(
          Number.isFinite(n),
          `customer ${p.id} field "${f}" must be a finite number, got ${JSON.stringify(p[f])}`,
        );
      }

      const approved = Number(p.approvedTotal) || 0;
      const unapproved = Number(p.unapprovedTotal) || 0;
      const combined = Number(p.combinedTotal) || 0;
      assert.ok(
        Math.abs(combined - (approved + unapproved)) <= TOL,
        `customer ${p.id}: combinedTotal (${combined}) must equal ` +
          `approvedTotal + unapprovedTotal (${approved} + ${unapproved} = ${approved + unapproved})`,
      );

      const totalUnbilled = Number(p.totalUnbilled) || 0;
      assert.ok(
        totalUnbilled + TOL >= combined,
        `customer ${p.id}: totalUnbilled (${totalUnbilled}, no date filter) ` +
          `must be >= combinedTotal (${combined}) for dateFilter=all`,
      );
    }
  });

  test("dateFilter=all: totalUnbilled equals combinedTotal for every customer", async () => {
    const res = await api(
      "GET",
      "/api/customers/billing-preview?dateFilter=all",
    );
    assert.equal(res.status, 200);
    for (const p of (res.body ?? [])) {
      const combined = Number(p.combinedTotal) || 0;
      const totalUnbilled = Number(p.totalUnbilled) || 0;
      assert.ok(
        Math.abs(totalUnbilled - combined) <= TOL,
        `customer ${p.id}: with dateFilter=all, totalUnbilled (${totalUnbilled}) ` +
          `must equal combinedTotal (${combined})`,
      );
    }
  });
});

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

const HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "2",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

async function api(method, path, body) {
  const opts = {
    method,
    headers: { ...HEADERS },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─── helpers ────────────────────────────────────────────────────────────────

let createdCustomerId;
let createdBillingSheetId;
let createdWorkOrderId;

async function ensureCustomer() {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Test Customer Parts",
    email: "testparts@example.com",
    laborRate: "50.00",
  });
  assert.equal(res.status, 201, `Customer creation failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

// ─── Test 1: Create billing sheet with 3 parts → assert 3 rows in billing_sheet_items ───

describe("Billing sheet parts lifecycle", () => {
  before(async () => {
    createdCustomerId = await ensureCustomer();
  });

  test("Create billing sheet with 3 parts → 3 items in DB", async () => {
    const items = [
      { partName: "Hunter PGP Head", partDescription: "", quantity: 2, unitPrice: 12.50, laborHours: 0.5, notes: "" },
      { partName: "Rainbird Valve", partDescription: "", quantity: 1, unitPrice: 45.00, laborHours: 1.0, notes: "" },
      { partName: "PVC 1in x 10ft", partDescription: "", quantity: 5, unitPrice: 8.00, laborHours: 0.25, notes: "" },
    ];

    const partsSubtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    const res = await api("POST", "/api/billing-sheets", {
      customerId: createdCustomerId,
      customerName: "Test Customer Parts",
      propertyAddress: "123 Test Lane",
      workDate: new Date().toISOString().slice(0, 10),
      technicianName: "Test Tech",
      technicianId: null,
      workDescription: "Test irrigation repair",
      status: "draft",
      totalHours: "2",
      laborRate: "50.00",
      laborSubtotal: "100.00",
      partsSubtotal: partsSubtotal.toFixed(2),
      markupAmount: "0",
      taxAmount: "0",
      totalAmount: (100 + partsSubtotal).toFixed(2),
      items,
    });

    assert.equal(res.status, 200, `Create billing sheet failed: ${JSON.stringify(res.body)}`);
    createdBillingSheetId = res.body.id;

    // Fetch the billing sheet and check items
    const getRes = await api("GET", `/api/billing-sheets/${createdBillingSheetId}`);
    assert.equal(getRes.status, 200, `Get billing sheet failed: ${JSON.stringify(getRes.body)}`);
    assert.equal(getRes.body.items?.length, 3, `Expected 3 items, got ${getRes.body.items?.length}: ${JSON.stringify(getRes.body.items)}`);
  });

  test("Draft billing sheet → submit → parts still present", async () => {
    assert.ok(createdBillingSheetId, "Need a billing sheet from previous test");

    // Submit the billing sheet
    const patchRes = await api("PATCH", `/api/billing-sheets/${createdBillingSheetId}`, {
      status: "submitted",
    });
    assert.equal(patchRes.status, 200, `Submit billing sheet failed: ${JSON.stringify(patchRes.body)}`);

    // Verify parts are still present after submit
    const getRes = await api("GET", `/api/billing-sheets/${createdBillingSheetId}`);
    assert.equal(getRes.status, 200);
    assert.ok(getRes.body.items?.length >= 3, `Expected at least 3 items after submit, got ${getRes.body.items?.length}`);
  });

  test("Manager edits submitted billing sheet → no existing parts dropped", async () => {
    assert.ok(createdBillingSheetId, "Need a billing sheet from previous test");

    // Manager patches with the same 3 items (simulating an edit)
    const items = [
      { partName: "Hunter PGP Head", partDescription: "", quantity: 2, unitPrice: 12.50, laborHours: 0.5, notes: "" },
      { partName: "Rainbird Valve", partDescription: "", quantity: 1, unitPrice: 45.00, laborHours: 1.0, notes: "" },
      { partName: "PVC 1in x 10ft", partDescription: "", quantity: 5, unitPrice: 8.00, laborHours: 0.25, notes: "" },
    ];
    const partsSubtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    const patchRes = await api("PATCH", `/api/billing-sheets/${createdBillingSheetId}`, {
      workDescription: "Updated description",
      partsSubtotal: partsSubtotal.toFixed(2),
      items,
    });
    assert.equal(patchRes.status, 200, `Edit billing sheet failed: ${JSON.stringify(patchRes.body)}`);

    // Verify all 3 items are still present
    const getRes = await api("GET", `/api/billing-sheets/${createdBillingSheetId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.items?.length, 3, `Expected 3 items after manager edit, got ${getRes.body.items?.length}`);
  });

  test("Submission guard: partsSubtotal > 0 but no items → 400", async () => {
    // Create a fresh billing sheet with partsSubtotal > 0 but NO items
    const createRes = await api("POST", "/api/billing-sheets", {
      customerId: createdCustomerId,
      customerName: "Test Customer Parts",
      propertyAddress: "123 Test Lane",
      workDate: new Date().toISOString().slice(0, 10),
      technicianName: "Test Tech",
      technicianId: null,
      workDescription: "Guard test",
      status: "draft",
      totalHours: "1",
      laborRate: "50.00",
      laborSubtotal: "50.00",
      partsSubtotal: "99.99",
      markupAmount: "0",
      taxAmount: "0",
      totalAmount: "149.99",
    });
    assert.equal(createRes.status, 200, `Guard test create failed: ${JSON.stringify(createRes.body)}`);
    const guardSheetId = createRes.body.id;

    // Attempt to submit with partsSubtotal > 0 and no items on record
    // The billing sheet was created with no items in DB, but partsSubtotal > 0
    const submitRes = await api("PATCH", `/api/billing-sheets/${guardSheetId}`, {
      status: "submitted",
      partsSubtotal: "99.99",
    });
    assert.equal(submitRes.status, 400, `Expected 400 guard rejection, got ${submitRes.status}: ${JSON.stringify(submitRes.body)}`);
    assert.ok(submitRes.body.message?.includes("Parts were recorded but no line items were saved"), `Unexpected error message: ${submitRes.body.message}`);
  });
});

// ─── Test 2: Work order with parts → convert to billing sheet → all parts in billing_sheet_items ───

describe("Work order to billing sheet conversion", () => {
  before(async () => {
    if (!createdCustomerId) {
      createdCustomerId = await ensureCustomer();
    }
  });

  test("Create work order with parts → convert to billing sheet → parts present", async () => {
    // Create a work order
    const woRes = await api("POST", "/api/work-orders", {
      customerId: createdCustomerId,
      customerName: "Test Customer Parts",
      customerEmail: "testparts@example.com",
      projectName: "Parts Conversion Test",
      projectAddress: "123 Test Lane",
      workType: "direct_billing",
      status: "work_completed",
      priority: "medium",
      totalHours: "3",
      totalPartsCost: "112.50",
      partsSubtotal: "112.50",
      laborSubtotal: "150.00",
      totalAmount: "262.50",
    });
    assert.equal(woRes.status, 201, `Work order creation failed: ${JSON.stringify(woRes.body)}`);
    const workOrderId = woRes.body.id;

    // Add parts items to the work order
    const patchRes = await api("PATCH", `/api/work-orders/${workOrderId}`, {
      items: [
        { partName: "Hunter Head", quantity: 3, unitPrice: 12.50, laborHours: 0.5 },
        { partName: "Valve Body", quantity: 2, unitPrice: 30.00, laborHours: 1.0 },
        { partName: "Pipe 1in", quantity: 4, unitPrice: 5.00, laborHours: 0.25 },
      ],
    });
    assert.equal(patchRes.status, 200, `Work order PATCH failed: ${JSON.stringify(patchRes.body)}`);

    // Verify items were saved
    const itemsRes = await api("GET", `/api/work-orders/${workOrderId}/items`);
    assert.equal(itemsRes.status, 200);
    assert.equal(itemsRes.body.length, 3, `Expected 3 WO items, got ${itemsRes.body.length}`);

    // Convert work order to billing sheet
    const convertRes = await api("POST", `/api/work-orders/${workOrderId}/billing-sheet`, {
      techName: "Test Tech",
      workPerformed: "Irrigation repair with parts",
      totalPartsCost: "112.50",
      laborRate: "50.00",
    });
    assert.equal(convertRes.status, 200, `Conversion failed: ${JSON.stringify(convertRes.body)}`);

    // The work order items should still exist on the work order after conversion
    const verifyItemsRes = await api("GET", `/api/work-orders/${workOrderId}/items`);
    assert.equal(verifyItemsRes.status, 200);
    assert.equal(verifyItemsRes.body.length, 3, `Expected 3 WO items after conversion, got ${verifyItemsRes.body.length}`);
  });
});

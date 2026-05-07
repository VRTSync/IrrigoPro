import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// Task #396 — Labor mode end-to-end test for WORK ORDER /complete.
// Verifies the server is authoritative for per_part labor: it
// recomputes Σ(item.laborHours × item.quantity) from the work order's
// persisted line items and ignores any client-supplied totalHours
// when laborMode === 'per_part'.

const BASE_URL = "http://localhost:5000";
const HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

async function api(method, path, body) {
  const opts = { method, headers: { ...HEADERS } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let customerId;
let partId;

describe("Work-order /complete labor mode", () => {
  before(async () => {
    const c = await api("POST", "/api/customers", {
      companyId: 99,
      name: "WO LM Customer",
      email: `wo-lm-${Date.now()}@example.com`,
      laborRate: "100.00",
    });
    assert.equal(c.status, 201, `customer: ${JSON.stringify(c.body)}`);
    customerId = c.body.id;

    const p = await api("POST", "/api/parts", {
      name: `WOLM Part ${Date.now()}`,
      description: "",
      price: "25.00",
      sku: `WOLM-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      category: "general",
      companyId: 99,
    });
    assert.ok(p.status === 200 || p.status === 201, `part: ${JSON.stringify(p.body)}`);
    partId = p.body.id;
  });

  test("per_part WO complete uses Σ(laborHours×qty) from persisted items, ignoring client totalHours", async () => {
    // Create a per-part work order with persisted line items carrying
    // labor hours. The wizard normally wires this from an estimate.
    const woCreate = await api("POST", "/api/work-orders", {
      companyId: 99,
      customerId,
      customerName: "WO LM Customer",
      customerEmail: "wo-lm@example.com",
      projectName: "Per-part WO complete test",
      description: "labor mode complete authority",
      projectAddress: "123 Test",
      priority: "normal",
      status: "in_progress",
      laborMode: "per_part",
      laborRate: "100.00",
      items: [
        {
          partId,
          partName: "WOLM Part",
          partPrice: "25.00",
          quantity: 4,
          laborHours: "0.5", // 4 * 0.5 = 2
          totalPrice: "100.00",
        },
        {
          partId,
          partName: "WOLM Part",
          partPrice: "25.00",
          quantity: 2,
          laborHours: "1.0", // 2 * 1.0 = 2
          totalPrice: "50.00",
        },
      ],
    });
    assert.ok(
      woCreate.status === 200 || woCreate.status === 201,
      `wo create: ${JSON.stringify(woCreate.body)}`,
    );
    const woId = woCreate.body.id;

    const itemsRes = await api("GET", `/api/work-orders/${woId}/items`);
    assert.equal(itemsRes.status, 200);
    const persistedItems = itemsRes.body;
    const expectedHours = persistedItems.reduce(
      (s, it) =>
        s + (parseFloat(String(it.laborHours ?? "0")) || 0) *
          (parseFloat(String(it.quantity ?? "0")) || 0),
      0,
    );

    // Complete the WO with a totalHours that should be IGNORED in per_part
    // mode (client tries to send 999; server must recompute from items).
    const complete = await api("POST", "/api/work-orders/complete", {
      workOrderId: woId,
      workSummary: "Completed in per-part mode",
      customerNotes: "ok",
      completedAt: new Date().toISOString(),
      laborMode: "per_part",
      totalHours: 999,
      usedParts: [],
      photos: [],
      totalPartsCost: "150.00",
    });
    assert.equal(complete.status, 200, `complete: ${JSON.stringify(complete.body)}`);

    const get = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(get.status, 200);
    const wo = get.body;
    assert.equal(wo.laborMode, "per_part");
    assert.equal(
      parseFloat(wo.totalHours),
      expectedHours,
      `per_part totalHours must equal Σ(laborHours×qty)=${expectedHours}, got ${wo.totalHours}`,
    );
    // labor = expected * 100, parts = 150
    assert.equal(parseFloat(wo.laborSubtotal), expectedHours * 100);
    assert.equal(parseFloat(wo.partsSubtotal), 150);
    assert.equal(parseFloat(wo.totalAmount), expectedHours * 100 + 150);
  });

  test("flat WO complete honors the client totalHours", async () => {
    const woCreate = await api("POST", "/api/work-orders", {
      companyId: 99,
      customerId,
      customerName: "WO LM Customer",
      customerEmail: "wo-lm@example.com",
      projectName: "Flat WO complete test",
      description: "labor mode complete authority - flat",
      projectAddress: "123 Test",
      priority: "normal",
      status: "in_progress",
      laborMode: "flat",
      totalLaborHours: "0",
      laborRate: "100.00",
      items: [],
    });
    assert.ok(
      woCreate.status === 200 || woCreate.status === 201,
      `wo create: ${JSON.stringify(woCreate.body)}`,
    );
    const woId = woCreate.body.id;

    const complete = await api("POST", "/api/work-orders/complete", {
      workOrderId: woId,
      workSummary: "Completed in flat mode",
      customerNotes: "ok",
      completedAt: new Date().toISOString(),
      laborMode: "flat",
      totalHours: 5,
      usedParts: [],
      photos: [],
      totalPartsCost: "0",
    });
    assert.equal(complete.status, 200, `complete: ${JSON.stringify(complete.body)}`);

    const get = await api("GET", `/api/work-orders/${woId}`);
    const wo = get.body;
    assert.equal(wo.laborMode, "flat");
    assert.equal(parseFloat(wo.totalHours), 5);
    assert.equal(parseFloat(wo.laborSubtotal), 500);
  });
});

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
  const opts = { method, headers: { ...HEADERS } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let customerId;
let partAId;
let partBId;

async function ensureCustomer() {
  const r = await api("POST", "/api/customers", {
    companyId: 99,
    name: "Estimate Slice1 Customer",
    email: "estimate-slice1@example.com",
    laborRate: "75.00",
  });
  assert.equal(r.status, 201, `customer create failed: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

async function ensurePart(name, price) {
  const r = await api("POST", "/api/parts", {
    name,
    description: "",
    price: String(price),
    sku: `SLICE1-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    category: "general",
    companyId: 99,
  });
  assert.ok(r.status === 200 || r.status === 201, `part create failed: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

describe("Estimate creation — flat line items, no zones (Slice 1)", () => {
  before(async () => {
    customerId = await ensureCustomer();
    partAId = await ensurePart(`Slice1 Head ${Date.now()}`, 15.0);
    partBId = await ensurePart(`Slice1 Valve ${Date.now()}`, 50.0);
  });

  test("POST /api/estimates with flat items creates 1 estimate + N items, totals computed server-side", async () => {
    // laborHours is the per-LINE total (already multiplied by quantity client-side).
    // Item A: 4 × 0.5h/unit = 2.0h.  Item B: 1 × 1.0h/unit = 1.0h.
    const items = [
      {
        description: "Replace 4 broken heads in front",
        partId: partAId,
        partName: "Slice1 Head",
        partPrice: "15.00",
        quantity: 4,
        laborHours: "2.0",
        sortOrder: 0,
      },
      {
        description: "Install 1 zone valve",
        partId: partBId,
        partName: "Slice1 Valve",
        partPrice: "50.00",
        quantity: 1,
        laborHours: "1.0",
        sortOrder: 1,
      },
    ];

    const create = await api("POST", "/api/estimates", {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "Estimate Slice1 Customer",
        customerEmail: "estimate-slice1@example.com",
        projectName: "Slice1 Project",
        projectAddress: "1 Slice1 Way",
        estimateNumber: `EST-S1-${Date.now()}`,
        estimateDate: new Date().toISOString(),
        status: "draft",
        laborRate: "75.00",
        // Task #396 — this Slice 1 test asserts legacy per-line labor
        // behavior; flat is the new default so the mode must be explicit.
        laborMode: "per_part",
        createdBy: "Test Admin",
      },
      items,
    });

    assert.equal(create.status, 201, `create estimate failed: ${JSON.stringify(create.body)}`);
    const estimateId = create.body.id;
    assert.ok(estimateId, "estimate id missing");

    const get = await api("GET", `/api/estimates/${estimateId}`);
    assert.equal(get.status, 200, `get estimate failed: ${JSON.stringify(get.body)}`);
    const est = get.body;

    assert.equal(est.items.length, 2, "should have exactly 2 flat line items");
    assert.ok(!("zones" in est), "estimate response must not include zones");
    for (const it of est.items) {
      assert.ok(!("zoneId" in it), "items must not carry zoneId");
      assert.ok("description" in it, "items must have description field");
      assert.ok("sortOrder" in it, "items must have sortOrder field");
    }

    // partsSubtotal = sum(totalPrice) = 4*15 + 1*50 = 110
    // laborSubtotal = sum(laborHours) * laborRate = (2.0 + 1.0) * 75 = 225
    // totalAmount = parts + labor = 335
    assert.equal(parseFloat(est.partsSubtotal), 110, "partsSubtotal recomputed");
    assert.equal(parseFloat(est.laborSubtotal), 225, "laborSubtotal recomputed");
    assert.equal(parseFloat(est.totalAmount), 335, "totalAmount recomputed");

    // Sort order preserved
    const sorted = [...est.items].sort((a, b) => a.sortOrder - b.sortOrder);
    assert.equal(sorted[0].description, "Replace 4 broken heads in front");
    assert.equal(sorted[1].description, "Install 1 zone valve");
  });

  test("PUT /api/estimates/:id replaces items in place (no zone scaffolding)", async () => {
    const initial = await api("POST", "/api/estimates", {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "Estimate Slice1 Customer",
        customerEmail: "estimate-slice1@example.com",
        projectName: "Slice1 Edit",
        estimateNumber: `EST-S1E-${Date.now()}`,
        estimateDate: new Date().toISOString(),
        status: "draft",
        laborRate: "75.00",
        createdBy: "Test Admin",
      },
      items: [
        { description: "First", partId: partAId, partName: "Slice1 Head",
          partPrice: "15.00", quantity: 1, laborHours: "0.00", sortOrder: 0 },
      ],
    });
    assert.equal(initial.status, 201);
    const id = initial.body.id;

    const upd = await api("PUT", `/api/estimates/${id}`, {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "Estimate Slice1 Customer",
        customerEmail: "estimate-slice1@example.com",
        projectName: "Slice1 Edit",
        estimateNumber: initial.body.estimateNumber,
        estimateDate: new Date().toISOString(),
        status: "draft",
        laborRate: "75.00",
        createdBy: "Test Admin",
      },
      items: [
        { description: "Replaced A", partId: partAId, partName: "Slice1 Head",
          partPrice: "15.00", quantity: 2, laborHours: "0.25", sortOrder: 0 },
        { description: "Replaced B", partId: partBId, partName: "Slice1 Valve",
          partPrice: "50.00", quantity: 1, laborHours: "0.5", sortOrder: 1 },
        { description: "Replaced C", partId: partAId, partName: "Slice1 Head",
          partPrice: "15.00", quantity: 3, laborHours: "0.25", sortOrder: 2 },
      ],
    });
    assert.equal(upd.status, 200, `update failed: ${JSON.stringify(upd.body)}`);

    const get = await api("GET", `/api/estimates/${id}`);
    assert.equal(get.body.items.length, 3, "items should be replaced with new set of 3");
    const descs = get.body.items.map((i) => i.description).sort();
    assert.deepEqual(descs, ["Replaced A", "Replaced B", "Replaced C"]);
    for (const it of get.body.items) {
      assert.ok(!("zoneId" in it), "no zoneId on edited items");
    }
  });
});

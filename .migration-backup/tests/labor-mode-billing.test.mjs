import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// Task #396 — Labor mode end-to-end test for BILLING SHEETS.
// Verifies:
//  - flat-mode billing sheet uses the wizard's totalHours field as the
//    source of truth for laborSubtotal/totalAmount.
//  - per_part-mode billing sheet sums Σ(laborHours × quantity) across
//    items (per-row laborHours are per-unit and must be scaled by qty).
//  - PATCH path honors a mode flip and recomputes both totalHours and
//    laborSubtotal authoritatively.

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
let partId;

describe("Billing sheet labor mode (flat vs per_part)", () => {
  before(async () => {
    const c = await api("POST", "/api/customers", {
      companyId: 99,
      name: "BS Labor Mode Customer",
      email: `bs-lm-${Date.now()}@example.com`,
      laborRate: "100.00",
    });
    assert.equal(c.status, 201, `customer: ${JSON.stringify(c.body)}`);
    customerId = c.body.id;

    const p = await api("POST", "/api/parts", {
      name: `BSLM Part ${Date.now()}`,
      description: "",
      price: "50.00",
      sku: `BSLM-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      category: "general",
      companyId: 99,
    });
    assert.ok(p.status === 200 || p.status === 201, `part: ${JSON.stringify(p.body)}`);
    partId = p.body.id;
  });

  test("flat-mode billing sheet uses totalHours, ignores per-line hours", async () => {
    const create = await api("POST", "/api/billing-sheets", {
      companyId: 99,
      customerId,
      customerName: "BS Labor Mode Customer",
      propertyAddress: "123 Test",
      workDate: new Date().toISOString().slice(0, 10),
      technicianName: "Test Admin",
      workDescription: "Flat-mode billing sheet test",
      laborMode: "flat",
      totalHours: "4",
      laborRate: "100.00",
      status: "approved_passed_to_billing",
      items: [
        {
          partId,
          partName: "BSLM Part",
          quantity: 2,
          unitPrice: "50.00",
          laborHours: "9.99",
          notes: null,
        },
      ],
    });
    assert.ok(create.status === 200 || create.status === 201, `flat create: ${JSON.stringify(create.body)}`);

    const get = await api("GET", `/api/billing-sheets/${create.body.id}`);
    assert.equal(get.status, 200);
    const bs = get.body;

    assert.equal(bs.laborMode, "flat");
    assert.equal(parseFloat(bs.totalHours), 4, "flat totalHours preserved");
    // partsSubtotal = 2 * 50 = 100; laborSubtotal = 4 * 100 = 400; total = 500
    assert.equal(parseFloat(bs.partsSubtotal), 100);
    assert.equal(parseFloat(bs.laborSubtotal), 400);
    assert.equal(parseFloat(bs.totalAmount), 500);
  });

  test("per_part-mode billing sheet sums Σ(laborHours × quantity)", async () => {
    const create = await api("POST", "/api/billing-sheets", {
      companyId: 99,
      customerId,
      customerName: "BS Labor Mode Customer",
      propertyAddress: "123 Test",
      workDate: new Date().toISOString().slice(0, 10),
      technicianName: "Test Admin",
      workDescription: "Per-part billing sheet test",
      laborMode: "per_part",
      // totalHours is ignored in per_part mode — server recomputes.
      totalHours: "999",
      laborRate: "100.00",
      status: "approved_passed_to_billing",
      items: [
        {
          partId,
          partName: "BSLM Part",
          quantity: 3,
          unitPrice: "50.00",
          laborHours: "1.0", // 3 * 1.0 = 3 hr
          notes: null,
        },
        {
          partId,
          partName: "BSLM Part",
          quantity: 2,
          unitPrice: "50.00",
          laborHours: "0.5", // 2 * 0.5 = 1 hr
          notes: null,
        },
      ],
    });
    assert.ok(create.status === 200 || create.status === 201, `per_part create: ${JSON.stringify(create.body)}`);

    const get = await api("GET", `/api/billing-sheets/${create.body.id}`);
    const bs = get.body;
    assert.equal(bs.laborMode, "per_part");
    // Σ(hr×qty) = 3 + 1 = 4 hours
    assert.equal(parseFloat(bs.totalHours), 4, "per_part totalHours = Σ(hr×qty)");
    // partsSubtotal = (3+2)*50 = 250; labor = 4*100 = 400; total = 650
    assert.equal(parseFloat(bs.partsSubtotal), 250);
    assert.equal(parseFloat(bs.laborSubtotal), 400);
    assert.equal(parseFloat(bs.totalAmount), 650);
  });

  test("PATCH flips per_part → flat and recomputes totals", async () => {
    const create = await api("POST", "/api/billing-sheets", {
      companyId: 99,
      customerId,
      customerName: "BS Labor Mode Customer",
      propertyAddress: "123 Test",
      workDate: new Date().toISOString().slice(0, 10),
      technicianName: "Test Admin",
      workDescription: "Mode-flip billing sheet test",
      laborMode: "per_part",
      totalHours: "0",
      laborRate: "100.00",
      status: "approved_passed_to_billing",
      items: [
        {
          partId,
          partName: "BSLM Part",
          quantity: 4,
          unitPrice: "50.00",
          laborHours: "0.25", // 4*0.25 = 1 hr
          notes: null,
        },
      ],
    });
    assert.ok(create.status === 200 || create.status === 201, `mode-flip create: ${JSON.stringify(create.body)}`);
    const id = create.body.id;

    // Flip to flat with 7 total hours; per-line laborHours should be ignored.
    // Re-send items so partsSubtotal stays consistent across the PATCH.
    const patch = await api("PATCH", `/api/billing-sheets/${id}`, {
      laborMode: "flat",
      totalHours: "7",
      items: [
        {
          partId,
          partName: "BSLM Part",
          quantity: 4,
          unitPrice: "50.00",
          laborHours: "0.25",
          notes: null,
        },
      ],
    });
    assert.equal(patch.status, 200, `patch: ${JSON.stringify(patch.body)}`);

    const get = await api("GET", `/api/billing-sheets/${id}`);
    const bs = get.body;
    assert.equal(bs.laborMode, "flat", "mode flipped to flat");
    assert.equal(parseFloat(bs.totalHours), 7, "flat totalHours from PATCH");
    // partsSubtotal = 4*50 = 200; labor = 7*100 = 700; total = 900
    assert.equal(parseFloat(bs.partsSubtotal), 200);
    assert.equal(parseFloat(bs.laborSubtotal), 700);
    assert.equal(parseFloat(bs.totalAmount), 900);
  });
});

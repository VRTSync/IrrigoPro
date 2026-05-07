import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// Task #396 — Labor mode (flat | per_part) end-to-end smoke test for
// estimates. Verifies: flat-mode zeros per-line laborHours and uses the
// estimate's totalLaborHours field as the source of truth; totals are
// recomputed server-side; per_part mode preserves legacy behavior.

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

describe("Estimate labor mode (flat vs per_part)", () => {
  before(async () => {
    const c = await api("POST", "/api/customers", {
      companyId: 99,
      name: "Labor Mode Customer",
      email: `labor-mode-${Date.now()}@example.com`,
      laborRate: "100.00",
    });
    assert.equal(c.status, 201, `customer create: ${JSON.stringify(c.body)}`);
    customerId = c.body.id;

    const p = await api("POST", "/api/parts", {
      name: `LM Part ${Date.now()}`,
      description: "",
      price: "20.00",
      sku: `LM-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      category: "general",
      companyId: 99,
    });
    assert.ok(p.status === 200 || p.status === 201, `part: ${JSON.stringify(p.body)}`);
    partId = p.body.id;
  });

  test("flat-mode estimate uses totalLaborHours and zeros per-line laborHours", async () => {
    const create = await api("POST", "/api/estimates", {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "Labor Mode Customer",
        customerEmail: "labor-mode@example.com",
        projectName: "Flat-mode estimate",
        estimateNumber: `EST-LMF-${Date.now()}`,
        estimateDate: new Date().toISOString(),
        status: "draft",
        laborRate: "100.00",
        laborMode: "flat",
        // Per-line laborHours are intentionally non-zero on the wire to
        // prove the server zeros them and uses totalLaborHours instead.
        totalLaborHours: "3.5",
        createdBy: "Test Admin",
      },
      items: [
        {
          description: "Item one",
          partId,
          partName: "LM Part",
          partPrice: "20.00",
          quantity: 2,
          laborHours: "9.99",
          sortOrder: 0,
        },
        {
          description: "Item two",
          partId,
          partName: "LM Part",
          partPrice: "20.00",
          quantity: 1,
          laborHours: "9.99",
          sortOrder: 1,
        },
      ],
    });
    assert.equal(create.status, 201, `flat create: ${JSON.stringify(create.body)}`);

    const get = await api("GET", `/api/estimates/${create.body.id}`);
    assert.equal(get.status, 200);
    const est = get.body;

    assert.equal(est.laborMode, "flat", "laborMode persisted as flat");
    assert.equal(parseFloat(est.totalLaborHours), 3.5, "totalLaborHours persisted");

    // Per-line labor hours must be zero in flat mode.
    for (const it of est.items) {
      assert.equal(
        parseFloat(it.laborHours ?? "0"),
        0,
        `flat-mode line laborHours must be 0, got ${it.laborHours}`,
      );
    }

    // partsSubtotal = (2 + 1) * 20 = 60
    // laborSubtotal = 3.5 * 100 = 350
    // totalAmount   = 410
    assert.equal(parseFloat(est.partsSubtotal), 60, "partsSubtotal");
    assert.equal(parseFloat(est.laborSubtotal), 350, "laborSubtotal from flat hours");
    assert.equal(parseFloat(est.totalAmount), 410, "totalAmount");
  });

  test("per_part-mode estimate sums per-line labor hours (legacy)", async () => {
    const create = await api("POST", "/api/estimates", {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "Labor Mode Customer",
        customerEmail: "labor-mode@example.com",
        projectName: "Per-part estimate",
        estimateNumber: `EST-LMP-${Date.now()}`,
        estimateDate: new Date().toISOString(),
        status: "draft",
        laborRate: "100.00",
        laborMode: "per_part",
        // totalLaborHours is ignored when mode = per_part.
        totalLaborHours: "999",
        createdBy: "Test Admin",
      },
      items: [
        {
          description: "A",
          partId,
          partName: "LM Part",
          partPrice: "20.00",
          quantity: 1,
          laborHours: "1.5",
          sortOrder: 0,
        },
        {
          description: "B",
          partId,
          partName: "LM Part",
          partPrice: "20.00",
          quantity: 1,
          laborHours: "0.5",
          sortOrder: 1,
        },
      ],
    });
    assert.equal(create.status, 201, `per_part create: ${JSON.stringify(create.body)}`);

    const get = await api("GET", `/api/estimates/${create.body.id}`);
    const est = get.body;

    assert.equal(est.laborMode, "per_part");
    // totalLaborHours should reflect the sum of per-line hours, NOT 999.
    assert.equal(parseFloat(est.totalLaborHours), 2, "totalLaborHours = sum of per-line");
    // partsSubtotal = 40, laborSubtotal = 2 * 100 = 200, total = 240
    assert.equal(parseFloat(est.partsSubtotal), 40);
    assert.equal(parseFloat(est.laborSubtotal), 200);
    assert.equal(parseFloat(est.totalAmount), 240);
  });
});

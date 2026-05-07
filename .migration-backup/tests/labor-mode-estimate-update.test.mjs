import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// Task #396 — Estimate update must NOT silently flip a per_part estimate
// to flat when the client omits laborMode on the update payload.

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

describe("Estimate PUT preserves laborMode when omitted", () => {
  before(async () => {
    const c = await api("POST", "/api/customers", {
      companyId: 99,
      name: "EST LM Customer",
      email: `est-lm-${Date.now()}@example.com`,
      laborRate: "100.00",
    });
    assert.equal(c.status, 201, `customer: ${JSON.stringify(c.body)}`);
    customerId = c.body.id;

    const p = await api("POST", "/api/parts", {
      name: `EST Part ${Date.now()}`,
      description: "",
      price: "10.00",
      sku: `ESTLM-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      category: "general",
      companyId: 99,
    });
    assert.ok(p.status === 200 || p.status === 201, `part: ${JSON.stringify(p.body)}`);
    partId = p.body.id;
  });

  test("per_part estimate stays per_part when update omits laborMode", async () => {
    const create = await api("POST", "/api/estimates", {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "EST LM Customer",
        customerEmail: "est-lm@example.com",
        projectName: "Per-part preservation",
        description: "preserve mode on update",
        laborMode: "per_part",
        laborRate: "100.00",
        estimateDate: new Date().toISOString(),
      },
      items: [
        {
          partId,
          partName: "EST Part",
          partPrice: "10.00",
          quantity: 3,
          laborHours: "1.5",
          totalPrice: "30.00",
        },
      ],
    });
    assert.ok(
      create.status === 200 || create.status === 201,
      `est create: ${JSON.stringify(create.body)}`,
    );
    const estId = create.body.id;
    assert.equal(create.body.laborMode, "per_part");
    const originalLaborSubtotal = parseFloat(create.body.laborSubtotal);

    // Update WITHOUT sending laborMode. Without the preservation fix, the
    // server would default to 'flat' and zero out the per-line laborHours,
    // collapsing laborSubtotal to 0.
    const update = await api("PUT", `/api/estimates/${estId}`, {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "EST LM Customer",
        customerEmail: "est-lm@example.com",
        projectName: "Per-part preservation (edited title)",
        description: "preserve mode on update",
        laborRate: "100.00",
        estimateDate: new Date().toISOString(),
      },
      items: [
        {
          partId,
          partName: "EST Part",
          partPrice: "10.00",
          quantity: 3,
          laborHours: "1.5",
          totalPrice: "30.00",
        },
      ],
    });
    assert.equal(update.status, 200, `est update: ${JSON.stringify(update.body)}`);

    const get = await api("GET", `/api/estimates/${estId}`);
    assert.equal(get.status, 200);
    assert.equal(get.body.laborMode, "per_part", "mode must be preserved");
    assert.equal(
      parseFloat(get.body.laborSubtotal),
      originalLaborSubtotal,
      "per-line labor must not be zeroed out by an update that omits laborMode",
    );
  });

  test("flat estimate stays flat when update omits laborMode", async () => {
    const create = await api("POST", "/api/estimates", {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "EST LM Customer",
        customerEmail: "est-lm@example.com",
        projectName: "Flat preservation",
        description: "preserve flat mode on update",
        laborMode: "flat",
        totalLaborHours: "4",
        laborRate: "100.00",
        estimateDate: new Date().toISOString(),
      },
      items: [
        {
          partId,
          partName: "EST Part",
          partPrice: "10.00",
          quantity: 2,
          laborHours: "0",
          totalPrice: "20.00",
        },
      ],
    });
    assert.ok(create.status === 200 || create.status === 201);
    const estId = create.body.id;
    assert.equal(create.body.laborMode, "flat");

    const update = await api("PUT", `/api/estimates/${estId}`, {
      estimate: {
        companyId: 99,
        customerId,
        customerName: "EST LM Customer",
        customerEmail: "est-lm@example.com",
        projectName: "Flat preservation (edited)",
        description: "preserve flat mode on update",
        totalLaborHours: "4",
        laborRate: "100.00",
        estimateDate: new Date().toISOString(),
      },
      items: [
        {
          partId,
          partName: "EST Part",
          partPrice: "10.00",
          quantity: 2,
          laborHours: "0",
          totalPrice: "20.00",
        },
      ],
    });
    assert.equal(update.status, 200, `est update: ${JSON.stringify(update.body)}`);
    const get = await api("GET", `/api/estimates/${estId}`);
    assert.equal(get.body.laborMode, "flat");
    assert.equal(parseFloat(get.body.totalLaborHours), 4);
    assert.equal(parseFloat(get.body.laborSubtotal), 400);
  });
});

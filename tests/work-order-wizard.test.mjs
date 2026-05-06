/**
 * Tests for Task #360 — Cover the new Work Order Wizard with automated
 * tests.
 *
 * The wizard's UI gates (required pin on Step 2, branch required when
 * customer has branches, dirty-form discard prompt) all converge on the
 * same set of API endpoints. These tests pin down the server-side contract
 * the wizard relies on:
 *
 *   1. POST /api/work-orders without workLocationLat/Lng is still accepted
 *      by the server (the wizard UI is what blocks empty-pin submissions).
 *   2. POST with a full pin payload (workType=direct_billing, lat/lng,
 *      workLocationAddress, controllerLetter, zoneNumber) round-trips
 *      cleanly.
 *   3. PATCH /api/work-orders/:id preserves an existing pin when the body
 *      omits the location fields, and updates the pin when new lat/lng
 *      values are provided.
 *   4. The "I'm here" PATCH from the work-order completion modal
 *      (lat/lng + workLocationAddress=null) updates the coordinates AND
 *      clears the previously-stored address.
 *   5. POST without a branchName for a customer that has branches is
 *      rejected with 400 (the wizard's Step 1 enforces the same rule).
 */

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
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { _raw: text };
  }
  return { status: res.status, body: parsed, text };
}

async function ensureCustomer(extra = {}) {
  const suffix = Date.now() + Math.floor(Math.random() * 1000);
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `WO Wizard Test Customer ${suffix}`,
    email: `wo-wizard-${suffix}@example.com`,
    laborRate: "50.00",
    address: "100 Wizard Way",
    ...extra,
  });
  assert.equal(
    res.status,
    201,
    `Customer creation failed: ${JSON.stringify(res.body)}`,
  );
  return res.body;
}

function basePayload(customer, overrides = {}) {
  return {
    customerId: customer.id,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: null,
    branchName: null,
    projectName: "Wizard Test Project",
    projectAddress: customer.address ?? "100 Wizard Way",
    description: "Investigate broken zone valve",
    locationNotes: "",
    accessInstructions: "",
    priority: "medium",
    scheduledDate: null,
    assignedTechnicianId: null,
    assignedTechnicianName: "",
    specialInstructions: "",
    notes: "",
    photos: [],
    workType: "direct_billing",
    status: "pending",
    estimateId: null,
    ...overrides,
  };
}

describe("Work Order Wizard API contract (Task #360)", () => {
  let plainCustomer;
  let branchedCustomer;

  before(async () => {
    plainCustomer = await ensureCustomer();
    branchedCustomer = await ensureCustomer({
      name: `WO Wizard Branched ${Date.now()}`,
      branches: ["North", "South"],
    });
  });

  test("POST without workLocationLat/Lng is still accepted by the server (wizard UI is the gate)", async () => {
    const res = await api(
      "POST",
      "/api/work-orders",
      basePayload(plainCustomer),
    );
    assert.ok(
      res.status === 200 || res.status === 201,
      `Expected 200/201 for pin-less POST, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.equal(res.body.workLocationLat, null);
    assert.equal(res.body.workLocationLng, null);
    // workType is the canonical "direct billing" marker the wizard sends.
    assert.equal(res.body.workType, "direct_billing");
  });

  test("POST with a full pin payload round-trips lat/lng, controllerLetter, zoneNumber", async () => {
    // Decimal columns in Drizzle round-trip as strings, so the wizard sends
    // its numeric pin values serialised as strings to match the
    // insertWorkOrderSchema contract.
    const payload = basePayload(plainCustomer, {
      workLocationLat: "26.1234560",
      workLocationLng: "-80.6543210",
      workLocationAddress: "Pinned: 26.123456, -80.654321",
      controllerLetter: "B",
      zoneNumber: 7,
    });
    const res = await api("POST", "/api/work-orders", payload);
    assert.ok(
      res.status === 200 || res.status === 201,
      `Create failed: ${res.status} ${JSON.stringify(res.body)}`,
    );

    const get = await api("GET", `/api/work-orders/${res.body.id}`);
    assert.equal(get.status, 200);
    assert.equal(Number(get.body.workLocationLat), 26.123456);
    assert.equal(Number(get.body.workLocationLng), -80.654321);
    assert.equal(get.body.workLocationAddress, "Pinned: 26.123456, -80.654321");
    assert.equal(get.body.controllerLetter, "B");
    assert.equal(get.body.zoneNumber, 7);
    assert.equal(get.body.workType, "direct_billing");
  });

  test("PATCH preserves an existing pin when the body omits location fields", async () => {
    const createRes = await api(
      "POST",
      "/api/work-orders",
      basePayload(plainCustomer, {
        workLocationLat: "25.1111110",
        workLocationLng: "-80.2222220",
        workLocationAddress: "Original pin address",
        controllerLetter: "A",
        zoneNumber: 3,
      }),
    );
    assert.ok(createRes.status === 200 || createRes.status === 201);
    const woId = createRes.body.id;

    // Edit only a non-location field.
    const patchRes = await api("PATCH", `/api/work-orders/${woId}`, {
      description: "Edited description, pin must stay put",
    });
    assert.equal(
      patchRes.status,
      200,
      `PATCH failed: ${JSON.stringify(patchRes.body)}`,
    );

    const get = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(get.status, 200);
    assert.equal(Number(get.body.workLocationLat), 25.111111);
    assert.equal(Number(get.body.workLocationLng), -80.222222);
    assert.equal(get.body.workLocationAddress, "Original pin address");
    assert.equal(get.body.controllerLetter, "A");
    assert.equal(get.body.zoneNumber, 3);
    assert.equal(get.body.description, "Edited description, pin must stay put");
  });

  test("PATCH updates pin coordinates when new lat/lng are provided", async () => {
    const createRes = await api(
      "POST",
      "/api/work-orders",
      basePayload(plainCustomer, {
        workLocationLat: "25.0000010",
        workLocationLng: "-80.0000010",
        workLocationAddress: "Old pin",
      }),
    );
    assert.ok(createRes.status === 200 || createRes.status === 201);
    const woId = createRes.body.id;

    const patchRes = await api("PATCH", `/api/work-orders/${woId}`, {
      workLocationLat: "27.9876540",
      workLocationLng: "-82.1234560",
      workLocationAddress: "New pin address",
    });
    assert.equal(
      patchRes.status,
      200,
      `PATCH failed: ${JSON.stringify(patchRes.body)}`,
    );

    const get = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(get.status, 200);
    assert.equal(Number(get.body.workLocationLat), 27.987654);
    assert.equal(Number(get.body.workLocationLng), -82.123456);
    assert.equal(get.body.workLocationAddress, "New pin address");
  });

  test("'I'm here' PATCH (lat/lng + workLocationAddress=null) updates the pin and clears the address", async () => {
    const createRes = await api(
      "POST",
      "/api/work-orders",
      basePayload(plainCustomer, {
        workLocationLat: "25.5555550",
        workLocationLng: "-80.5555550",
        workLocationAddress: "Stale address that should be cleared",
      }),
    );
    assert.ok(createRes.status === 200 || createRes.status === 201);
    const woId = createRes.body.id;

    // Mirrors exactly the payload the work-order-completion modal sends.
    const patchRes = await api("PATCH", `/api/work-orders/${woId}`, {
      workLocationLat: "26.2468100",
      workLocationLng: "-80.1357900",
      workLocationAddress: null,
    });
    assert.equal(
      patchRes.status,
      200,
      `PATCH failed: ${JSON.stringify(patchRes.body)}`,
    );

    const get = await api("GET", `/api/work-orders/${woId}`);
    assert.equal(get.status, 200);
    assert.equal(Number(get.body.workLocationLat), 26.246810);
    assert.equal(Number(get.body.workLocationLng), -80.135790);
    assert.equal(
      get.body.workLocationAddress,
      null,
      "workLocationAddress should be cleared when the modal sends null",
    );
  });

  test("POST without branchName is rejected when the customer has branches", async () => {
    const res = await api(
      "POST",
      "/api/work-orders",
      basePayload(branchedCustomer, { branchName: null }),
    );
    assert.equal(
      res.status,
      400,
      `Expected 400 for missing branch on branched customer, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.match(
      String(res.body.message ?? ""),
      /branch/i,
      "Error message should mention branch",
    );
  });

  test("POST with a valid branchName succeeds for a customer that has branches", async () => {
    const res = await api(
      "POST",
      "/api/work-orders",
      basePayload(branchedCustomer, { branchName: "North" }),
    );
    assert.ok(
      res.status === 200 || res.status === 201,
      `Expected success when branchName is supplied, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    assert.equal(res.body.branchName, "North");
  });
});

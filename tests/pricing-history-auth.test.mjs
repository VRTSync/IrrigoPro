import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5000";

const { storage } = await import("../server/storage.ts");
const { db } = await import("../server/db.ts");
const { billingSheets, workOrders, pricingAuditEvents } = await import("../shared/schema.ts");
const { eq } = await import("drizzle-orm");

const COMPANY_A = 99;
const COMPANY_B = 100;

const headers = (role, companyId, userId = "2") => ({
  "Content-Type": "application/json",
  "x-user-id": String(userId),
  "x-user-role": role,
  "x-user-company-id": String(companyId),
});

async function api(method, path, hdrs, body) {
  const opts = { method, headers: { ...hdrs } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function ensureCompany(id, name) {
  const existing = await storage.getCompany(id).catch(() => null);
  if (existing) return existing;
  return storage.createCompany({ id, name } );
}

async function createCustomerInCompany(companyId) {
  const res = await api(
    "POST",
    "/api/customers",
    headers("company_admin", companyId),
    {
      companyId,
      name: `History Auth Customer ${companyId} ${Date.now()}`,
      email: `history_auth_${companyId}_${Date.now()}@example.com`,
      laborRate: "60.00",
    },
  );
  assert.equal(res.status, 201, `customer create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Pricing audit history endpoint — cross-company access control", () => {
  let companyACustomerId;
  let companyABillingSheetId;
  let companyAWorkOrderId;
  let orphanBillingSheetId;

  before(async () => {
    await ensureCompany(COMPANY_A, "Test Company A").catch(() => {});
    await ensureCompany(COMPANY_B, "Test Company B").catch(() => {});

    companyACustomerId = await createCustomerInCompany(COMPANY_A);

    // 1) Plant a normal billing sheet owned by company A's customer.
    const [bs] = await db.insert(billingSheets).values({
      billingNumber: `BS-AUTH-${Date.now()}`,
      customerId: companyACustomerId,
      customerName: "History Auth Customer",
      propertyAddress: "1 Auth Way",
      workDate: new Date(),
      technicianName: "Auth Tech",
      workDescription: "Cross-company guard test",
      status: "approved_passed_to_billing",
      totalHours: "1",
      laborRate: "60.00",
      laborSubtotal: "60.00",
      partsSubtotal: "0",
      totalAmount: "60.00",
    }).returning();
    companyABillingSheetId = bs.id;

    // 2) Plant a "diverged" billing sheet with NO customerId — this is the
    // exact case the previous implementation skipped its company check on.
    const [orphanBs] = await db.insert(billingSheets).values({
      billingNumber: `BS-AUTH-ORPHAN-${Date.now()}`,
      customerId: null,
      customerName: "Orphan",
      propertyAddress: "1 Orphan Way",
      workDate: new Date(),
      technicianName: "Auth Tech",
      workDescription: "No-customer guard test",
      status: "draft",
      totalHours: "0",
      laborRate: "0.00",
      laborSubtotal: "0",
      partsSubtotal: "0",
      totalAmount: "0",
    }).returning();
    orphanBillingSheetId = orphanBs.id;

    // 3) Plant a normal work order owned by company A's customer.
    const [wo] = await db.insert(workOrders).values({
      workOrderNumber: `WO-AUTH-${Date.now()}`,
      customerId: companyACustomerId,
      customerName: "History Auth Customer",
      customerEmail: `history_auth_wo_${Date.now()}@example.com`,
      projectName: "Auth Cross-Company Test",
      workType: "direct_billing",
      status: "work_completed",
      totalHours: "0",
      laborRate: "0.00",
      partsSubtotal: "0",
      laborSubtotal: "0",
      totalAmount: "0",
    }).returning();
    companyAWorkOrderId = wo.id;

    // Plant pricing audit events for company A's BS and WO so we can verify
    // they ARE returned to a same-company manager and NOT to company B.
    await db.insert(pricingAuditEvents).values({
      companyId: COMPANY_A,
      source: "billing_sheet",
      parentId: companyABillingSheetId,
      parentNumber: bs.billingNumber,
      kind: "catalog_reprice",
      delta: "5.00",
      itemCount: 1,
      details: { items: [{ partName: "X", oldUnitPrice: "0.00", newUnitPrice: "5.00" }] },
    });
    await db.insert(pricingAuditEvents).values({
      companyId: COMPANY_A,
      source: "work_order",
      parentId: companyAWorkOrderId,
      parentNumber: wo.workOrderNumber,
      kind: "labor_rate_reprice",
      delta: "10.00",
      itemCount: 0,
      details: { classification: "standard", oldLaborRate: "50", newLaborRate: "60" },
    });

    // Plant orphan event too — this MUST NOT leak to anyone scoped.
    await db.insert(pricingAuditEvents).values({
      companyId: null,
      source: "billing_sheet",
      parentId: orphanBillingSheetId,
      parentNumber: orphanBs.billingNumber,
      kind: "catalog_reprice",
      delta: "1.00",
      itemCount: 0,
      details: {},
    });
  });

  test("Same-company manager can read history for a billing sheet they own", async () => {
    const res = await api(
      "GET",
      `/api/billing-sheets/${companyABillingSheetId}/pricing-audit-events`,
      headers("billing_manager", COMPANY_A),
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(Array.isArray(res.body.events));
    assert.ok(
      res.body.events.some((e) => e.kind === "catalog_reprice"),
      "company A manager should see the catalog reprice event",
    );
  });

  test("Cross-company manager (company B) cannot read company A's billing sheet history", async () => {
    const res = await api(
      "GET",
      `/api/billing-sheets/${companyABillingSheetId}/pricing-audit-events`,
      headers("company_admin", COMPANY_B),
    );
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("Cross-company manager (company B) cannot read company A's work order history", async () => {
    const res = await api(
      "GET",
      `/api/work-orders/${companyAWorkOrderId}/pricing-audit-events`,
      headers("billing_manager", COMPANY_B),
    );
    assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("Field tech is denied even within the correct company", async () => {
    const res = await api(
      "GET",
      `/api/billing-sheets/${companyABillingSheetId}/pricing-audit-events`,
      headers("field_tech", COMPANY_A),
    );
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("Billing sheet with NULL customerId is denied for non-super-admin (no fall-through to unscoped read)", async () => {
    const res = await api(
      "GET",
      `/api/billing-sheets/${orphanBillingSheetId}/pricing-audit-events`,
      headers("company_admin", COMPANY_A),
    );
    assert.equal(res.status, 403, `Expected 403 for orphan BS, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test("storage.getPricingAuditEvents with companyId filters out NULL-company rows", async () => {
    // Read with explicit company A scope — should NOT include orphan rows
    // even though they share source/parentId space.
    const events = await storage.getPricingAuditEvents(
      "billing_sheet",
      orphanBillingSheetId,
      COMPANY_A,
    );
    assert.equal(events.length, 0, "scoped read must not surface NULL-company events");

    // Without scope, the orphan event is visible (super_admin path).
    const allEvents = await storage.getPricingAuditEvents(
      "billing_sheet",
      orphanBillingSheetId,
      null,
    );
    assert.ok(allEvents.length >= 1, "unscoped read should still see the orphan event");
  });
});

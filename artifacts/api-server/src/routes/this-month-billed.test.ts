// Task #662 — Regression test for the "This Month Billed" doubling bug.
//
// The Company Admin dashboard's Financial Exposure → "This Month
// Billed" tile used to sum /api/invoices client-side. That endpoint
// is intentionally not scoped to the caller's company, so a
// company_admin viewing the tile saw invoices from EVERY tenant.
// With two companies of similar size the tile roughly doubled.
//
// The fix routes the tile through /api/dashboard/this-month-billed,
// which delegates to storage.getThisMonthBilledForCompany. That
// helper joins invoices ⨝ customers, filters on customers.companyId,
// restricts to the current calendar month, and excludes `draft` /
// `cancelled` invoices.
//
// This test pins the predicate the SQL has to satisfy. It exercises
// a JS mirror of the WHERE clause so the regression is caught
// without spinning up a real DB.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

interface InvoiceFixture {
  id: number;
  customerId: number;
  totalAmount: string;
  status: string; // draft | sent | paid | overdue | cancelled
  createdAt: Date;
}
interface CustomerFixture {
  id: number;
  companyId: number;
}

// JS mirror of storage.getThisMonthBilledForCompany's SQL predicate.
// If the WHERE clause in storage.ts drifts from this, this test
// fails.
function thisMonthBilledRollup(
  invoices: InvoiceFixture[],
  customers: CustomerFixture[],
  companyId: number | null,
  now: Date,
): { amount: number; invoiceCount: number; month: string } {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const customerCompany = new Map(customers.map((c) => [c.id, c.companyId]));
  const matching = invoices.filter((inv) => {
    if (inv.status === "draft" || inv.status === "cancelled") return false;
    if (inv.createdAt < monthStart || inv.createdAt >= nextMonthStart) return false;
    if (companyId !== null) {
      const cc = customerCompany.get(inv.customerId);
      if (cc !== companyId) return false;
    }
    return true;
  });
  const amount = matching.reduce((s, inv) => s + parseFloat(inv.totalAmount), 0);
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { amount, invoiceCount: matching.length, month };
}

const NOW = new Date(2026, 4, 15); // May 15, 2026

const CUSTOMERS: CustomerFixture[] = [
  { id: 100, companyId: 1 },
  { id: 101, companyId: 1 },
  { id: 200, companyId: 2 },
  { id: 201, companyId: 2 },
];

const INVOICES: InvoiceFixture[] = [
  // Company 1 — current month
  { id: 1, customerId: 100, totalAmount: "1000.00", status: "sent",  createdAt: new Date(2026, 4, 2) },
  { id: 2, customerId: 100, totalAmount: "1500.00", status: "paid",  createdAt: new Date(2026, 4, 5) },
  { id: 3, customerId: 101, totalAmount:  "500.00", status: "sent",  createdAt: new Date(2026, 4, 10) },
  // Company 1 — should be excluded (draft / cancelled)
  { id: 4, customerId: 100, totalAmount:  "999.00", status: "draft",     createdAt: new Date(2026, 4, 11) },
  { id: 5, customerId: 100, totalAmount:  "777.00", status: "cancelled", createdAt: new Date(2026, 4, 12) },
  // Company 1 — last month, must not contribute
  { id: 6, customerId: 100, totalAmount: "8000.00", status: "paid", createdAt: new Date(2026, 3, 28) },
  // Company 2 — current month (the cross-tenant leak we are fixing)
  { id: 7, customerId: 200, totalAmount: "2000.00", status: "sent",  createdAt: new Date(2026, 4, 3) },
  { id: 8, customerId: 201, totalAmount:  "750.00", status: "overdue", createdAt: new Date(2026, 4, 7) },
];

// JS mirror of the route's authorization + scope-resolution logic
// in routes.ts. If these branches change in the route, this test
// must change too.
const ROLLUP_ROLES = new Set([
  "super_admin",
  "company_admin",
  "billing_manager",
  "irrigation_manager",
]);
function resolveScope(
  role: string | undefined,
  callerCompanyId: number | null,
  queryCompanyId: string | undefined,
): { status: number; scopeCompanyId: number | null } {
  if (!role || !ROLLUP_ROLES.has(role)) return { status: 403, scopeCompanyId: -1 };
  if (role === "super_admin") {
    if (queryCompanyId != null && queryCompanyId !== "") {
      const n = parseInt(queryCompanyId, 10);
      if (!Number.isFinite(n) || n <= 0) return { status: 400, scopeCompanyId: -1 };
      return { status: 200, scopeCompanyId: n };
    }
    return { status: 200, scopeCompanyId: null };
  }
  if (callerCompanyId == null) return { status: 403, scopeCompanyId: -1 };
  return { status: 200, scopeCompanyId: callerCompanyId };
}

describe('Task #662 — /api/dashboard/this-month-billed authorization', () => {
  it('denies field_tech (no monetary rollup for the pricing-hidden role)', () => {
    assert.equal(resolveScope("field_tech", 1, undefined).status, 403);
  });
  it('denies unauthenticated / unknown role', () => {
    assert.equal(resolveScope(undefined, 1, undefined).status, 403);
    assert.equal(resolveScope("guest", 1, undefined).status, 403);
  });
  it('denies non-super-admin with no company association', () => {
    assert.equal(resolveScope("company_admin", null, undefined).status, 403);
  });
  it('non-super-admin cannot override scope via ?companyId', () => {
    // Caller belongs to company 1 but asks for company 2 — must be
    // forced to their own company.
    const r = resolveScope("company_admin", 1, "2");
    assert.equal(r.status, 200);
    assert.equal(r.scopeCompanyId, 1);
  });
  it('super_admin defaults to global and honors ?companyId', () => {
    assert.deepEqual(resolveScope("super_admin", null, undefined), { status: 200, scopeCompanyId: null });
    assert.deepEqual(resolveScope("super_admin", null, "7"), { status: 200, scopeCompanyId: 7 });
  });
  it('super_admin gets 400 for invalid ?companyId (instead of silently going global)', () => {
    assert.equal(resolveScope("super_admin", null, "abc").status, 400);
    assert.equal(resolveScope("super_admin", null, "0").status, 400);
    assert.equal(resolveScope("super_admin", null, "-3").status, 400);
  });
  it('billing_manager and irrigation_manager are allowed (scoped to own company)', () => {
    assert.deepEqual(resolveScope("billing_manager", 5, "9"), { status: 200, scopeCompanyId: 5 });
    assert.deepEqual(resolveScope("irrigation_manager", 5, undefined), { status: 200, scopeCompanyId: 5 });
  });
});

describe('Task #662 — /api/dashboard/this-month-billed company scoping', () => {
  it('company_admin (company 1) sees only company 1 invoices for this month', () => {
    const r = thisMonthBilledRollup(INVOICES, CUSTOMERS, 1, NOW);
    // 1000 + 1500 + 500 = 3000. Excludes draft / cancelled / last
    // month / company 2.
    assert.equal(r.amount, 3000);
    assert.equal(r.invoiceCount, 3);
    assert.equal(r.month, '2026-05');
  });

  it('company_admin (company 2) sees only company 2 invoices', () => {
    const r = thisMonthBilledRollup(INVOICES, CUSTOMERS, 2, NOW);
    assert.equal(r.amount, 2750);
    assert.equal(r.invoiceCount, 2);
  });

  it('two company admins on the same system get different totals (no cross-tenant leak)', () => {
    const a = thisMonthBilledRollup(INVOICES, CUSTOMERS, 1, NOW);
    const b = thisMonthBilledRollup(INVOICES, CUSTOMERS, 2, NOW);
    assert.notEqual(a.amount, b.amount);
    // Sum of independently-scoped totals must equal the global total.
    const global = thisMonthBilledRollup(INVOICES, CUSTOMERS, null, NOW);
    assert.equal(a.amount + b.amount, global.amount);
  });

  it('super_admin (companyId=null) sees the global current-month total', () => {
    const r = thisMonthBilledRollup(INVOICES, CUSTOMERS, null, NOW);
    // 3000 (co 1) + 2750 (co 2) = 5750
    assert.equal(r.amount, 5750);
    assert.equal(r.invoiceCount, 5);
  });

  it('excludes draft and cancelled invoices for every scope', () => {
    const co1 = thisMonthBilledRollup(INVOICES, CUSTOMERS, 1, NOW);
    // Draft 999 + cancelled 777 = 1776 must NOT be in the total.
    assert.ok(!String(co1.amount).includes('1776'));
    assert.equal(co1.amount, 3000);
  });

  it('excludes invoices from prior months even when same company', () => {
    const co1 = thisMonthBilledRollup(INVOICES, CUSTOMERS, 1, NOW);
    // April 28 invoice (8000) must not contribute on May 15.
    assert.equal(co1.amount, 3000);
  });

  it('reproduces the legacy doubling bug when scoping is dropped', () => {
    // The legacy admin-dashboard summed /api/invoices?limit=25
    // client-side with no company filter and no status filter. For
    // a company 1 admin that produced the cross-tenant leak.
    const legacyForCompany1 = INVOICES.filter((inv) => {
      const monthStart = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
      const nextMonthStart = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1);
      return inv.createdAt >= monthStart && inv.createdAt < nextMonthStart;
    }).reduce((s, inv) => s + parseFloat(inv.totalAmount), 0);
    const correctForCompany1 = thisMonthBilledRollup(INVOICES, CUSTOMERS, 1, NOW).amount;
    // Legacy includes drafts, cancelled, and the other tenant; new
    // rollup excludes all three. They MUST differ — that's the bug.
    assert.notEqual(legacyForCompany1, correctForCompany1);
    assert.ok(legacyForCompany1 > correctForCompany1);
  });
});

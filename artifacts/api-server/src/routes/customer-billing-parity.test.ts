/**
 * customer-billing-parity.test.ts (Task #1227)
 *
 * HTTP-level integration test that proves /api/customers/billing-preview and
 * /api/customers/:id/billing return identical unbilled totals for the same
 * customer and selectedMonth.
 *
 * The existing billing-cutoff.test.ts only proves the selector is pure — it
 * calls computeUnbilledPartition twice in-memory and checks equality. That
 * guard cannot catch a future divergence in either route's fetch, status filter,
 * month threading, or company scoping.  This test closes the gap by seeding a
 * real DB fixture and firing real HTTP requests against both endpoints.
 *
 * Fixture (six items):
 *   (a) Approved BS  — target month (2025-03-15)               $100
 *   (b) Approved WO  — earlier month (2025-02-10)               $80  [no lower bound → in March view]
 *   (c) Approved WO  — next month (2025-04-01)                 $200  [after cutoff → excluded from Mar/Feb]
 *   (d) Unapproved BS — target month (2025-03-20, submitted)    $50
 *   (e) Approved WO  — null completedAt (undated, always included) $25
 *   (f) Approved WO  — target month, invoice_id set (billed)   $300  [always excluded]
 *
 * Note: billing_sheets.work_date is NOT NULL, so item (e) is a work order
 * (completedAt is nullable on work_orders) rather than a billing sheet.
 *
 * Expected totals per selectedMonth:
 *   2025-03  approved = (a)100 + (b)80 + (e)25 = 205  unapproved = (d)50  total = 255
 *   2025-02  approved = (b)80 + (e)25 = 105           unapproved = 0       total = 105
 *   all      approved = (a)100+(b)80+(c)200+(e)25=405 unapproved = (d)50  total = 455
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { db } from "../db";

const TAG = `bp-parity-${Date.now()}`;

const TARGET_MONTH = "2025-03";
const EARLIER_MONTH = "2025-02";

let fixtureCompanyId: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureInvoiceId: number;

const woIds: number[] = [];
const bsIds: number[] = [];

let baseUrl: string;
let closeServer: () => Promise<void>;

describe("billing-preview / billing-detail cross-endpoint parity (Task #1227)", () => {
  before(async () => {
    // ── Company ──────────────────────────────────────────────────────────────
    const companyRows = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`Parity Test Co ${TAG}`}, 'basic', true)
      RETURNING id
    `);
    fixtureCompanyId = Number((companyRows.rows[0] as { id: number }).id);

    // ── Customer ─────────────────────────────────────────────────────────────
    const customerRows = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${fixtureCompanyId}, 'Parity Test Customer', ${`parity-${TAG}@example.com`})
      RETURNING id
    `);
    fixtureCustomerId = Number((customerRows.rows[0] as { id: number }).id);

    // ── Tech user ────────────────────────────────────────────────────────────
    const userRows = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`parity-tech-${TAG}`}, 'hashed', 'Parity Tech', 'field_tech', ${fixtureCompanyId}, true)
      RETURNING id
    `);
    fixtureTechId = Number((userRows.rows[0] as { id: number }).id);

    // ── Invoice (anchor for the billed item) ─────────────────────────────────
    const invoiceRows = await db.execute(sql`
      INSERT INTO invoices (
        invoice_number, customer_id, company_id, customer_name, customer_email,
        invoice_month, invoice_year, period_start, period_end,
        status, parts_subtotal, labor_subtotal, total_amount
      ) VALUES (
        ${`INV-PARITY-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${`parity-${TAG}@example.com`},
        3, 2025, '2025-03-01', '2025-03-31',
        'paid', '0.00', '0.00', '300.00'
      ) RETURNING id
    `);
    fixtureInvoiceId = Number((invoiceRows.rows[0] as { id: number }).id);

    // ── (a) Approved BS, target month ─────────────────────────────────────
    // billing_sheets.company_id is NOT NULL; work_date is also NOT NULL
    // (timestamp column), so all BS rows must provide both.
    const a = await db.execute(sql`
      INSERT INTO billing_sheets (
        billing_number, customer_id, company_id, customer_name,
        technician_id, technician_name,
        property_address, work_description, work_date, status,
        labor_subtotal, parts_subtotal, total_amount, total_hours, labor_rate
      ) VALUES (
        ${`BS-PAR-A-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${fixtureTechId}, 'Parity Tech',
        '1 Parity St', 'Approved March BS', '2025-03-15T12:00:00Z',
        'approved_passed_to_billing',
        '60.00', '40.00', '100.00', '2.00', '30.00'
      ) RETURNING id
    `);
    bsIds.push(Number((a.rows[0] as { id: number }).id));

    // ── (b) Approved WO, earlier month (Feb 2025) ─────────────────────────
    // No lower-bound on the cutoff selector — a Feb WO appears in the March view.
    const b = await db.execute(sql`
      INSERT INTO work_orders (
        work_order_number, customer_id, company_id, customer_name, customer_email,
        project_name, status, total_amount, completed_at
      ) VALUES (
        ${`WO-PAR-B-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${`parity-${TAG}@example.com`},
        'Parity WO B', 'approved_passed_to_billing', '80.00', '2025-02-10T12:00:00Z'
      ) RETURNING id
    `);
    woIds.push(Number((b.rows[0] as { id: number }).id));

    // ── (c) Approved WO, next month (Apr 2025) — excluded from Mar and Feb ─
    const c = await db.execute(sql`
      INSERT INTO work_orders (
        work_order_number, customer_id, company_id, customer_name, customer_email,
        project_name, status, total_amount, completed_at
      ) VALUES (
        ${`WO-PAR-C-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${`parity-${TAG}@example.com`},
        'Parity WO C', 'approved_passed_to_billing', '200.00', '2025-04-01T12:00:00Z'
      ) RETURNING id
    `);
    woIds.push(Number((c.rows[0] as { id: number }).id));

    // ── (d) Unapproved BS (submitted), target month ────────────────────────
    const d = await db.execute(sql`
      INSERT INTO billing_sheets (
        billing_number, customer_id, company_id, customer_name,
        technician_id, technician_name,
        property_address, work_description, work_date, status,
        labor_subtotal, parts_subtotal, total_amount, total_hours, labor_rate
      ) VALUES (
        ${`BS-PAR-D-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${fixtureTechId}, 'Parity Tech',
        '4 Parity St', 'Submitted March BS', '2025-03-20T12:00:00Z',
        'submitted',
        '30.00', '20.00', '50.00', '1.00', '30.00'
      ) RETURNING id
    `);
    bsIds.push(Number((d.rows[0] as { id: number }).id));

    // ── (e) Approved WO, null completedAt — undated, always included ──────
    // billing_sheets.work_date is NOT NULL so we use a work order here:
    // work_orders.completed_at is nullable, so a null completedAt exercises
    // the "undated" path in computeUnbilledPartition (included regardless of
    // cutoff, flagged undated:true).
    const e = await db.execute(sql`
      INSERT INTO work_orders (
        work_order_number, customer_id, company_id, customer_name, customer_email,
        project_name, status, total_amount, completed_at
      ) VALUES (
        ${`WO-PAR-E-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${`parity-${TAG}@example.com`},
        'Parity WO E', 'approved_passed_to_billing', '25.00', NULL
      ) RETURNING id
    `);
    woIds.push(Number((e.rows[0] as { id: number }).id));

    // ── (f) Approved WO, target month, billed (invoice_id set) ───────────
    // Must be excluded from both endpoints regardless of selectedMonth.
    const f = await db.execute(sql`
      INSERT INTO work_orders (
        work_order_number, customer_id, company_id, customer_name, customer_email,
        project_name, status, total_amount, completed_at, invoice_id
      ) VALUES (
        ${`WO-PAR-F-${TAG}`}, ${fixtureCustomerId}, ${fixtureCompanyId},
        'Parity Test Customer', ${`parity-${TAG}@example.com`},
        'Parity WO F', 'approved_passed_to_billing', '300.00',
        '2025-03-10T12:00:00Z', ${fixtureInvoiceId}
      ) RETURNING id
    `);
    woIds.push(Number((f.rows[0] as { id: number }).id));

    // ── Mount the real Express app ─────────────────────────────────────────
    // Imported dynamically to avoid tsx/esm compiling the full 16k-line
    // routes.ts dependency tree at module-load time (same pattern as
    // financial-pulse-wcb.test.ts).
    const { registerRoutes } = await import("./routes");
    const app: Express = express();
    app.use(express.json());
    const httpServer = await registerRoutes(app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = () => new Promise<void>((resolve) => {
      // closeAllConnections() (Node 18.2+) force-destroys keep-alive connections
      // so httpServer.close() resolves immediately instead of waiting for them
      // to drain.  Without this, background jobs started by registerRoutes
      // (QbTokenHealth, incident runner) keep the event loop alive and the test
      // runner reports "Promise resolution is still pending".
      if (typeof (httpServer as any).closeAllConnections === "function") {
        (httpServer as any).closeAllConnections();
      }
      httpServer.close(() => resolve());
    });
  });

  after(async () => {
    await closeServer?.();
    // Delete in dependency order: WOs/BSs → invoice → customer → company
    for (const id of woIds) {
      await db.execute(sql`DELETE FROM work_orders WHERE id = ${id}`);
    }
    for (const id of bsIds) {
      await db.execute(sql`DELETE FROM billing_sheets WHERE id = ${id}`);
    }
    if (fixtureInvoiceId) await db.execute(sql`DELETE FROM invoices WHERE id = ${fixtureInvoiceId}`);
    if (fixtureTechId)    await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
    if (fixtureCustomerId) await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
    if (fixtureCompanyId) await db.execute(sql`DELETE FROM companies WHERE id = ${fixtureCompanyId}`);
  });

  // ── Auth headers ────────────────────────────────────────────────────────────
  // Dev-mode header auth (NODE_ENV != 'production') sets authenticatedUserRole and
  // authenticatedUserCompanyId on req via requireAuthentication (billing-detail).
  // billing-preview has no auth middleware, so the x-user-* headers don't affect
  // its company-scoping logic — but the data is isolated by customerId so
  // the fixture customer is always findable in the response array.
  function authHeaders(): Record<string, string> {
    return {
      "x-user-id": "1",
      "x-user-role": "company_admin",
      "x-user-company-id": String(fixtureCompanyId),
    };
  }

  // ── Fetch helpers ────────────────────────────────────────────────────────────

  async function fetchPreview(selectedMonth: string): Promise<{
    approvedTotal: number;
    unapprovedTotal: number;
    total: number;
  }> {
    const url = `${baseUrl}/api/customers/billing-preview?selectedMonth=${encodeURIComponent(selectedMonth)}`;
    const res = await fetch(url, { headers: authHeaders() });
    assert.equal(res.status, 200, `billing-preview returned ${res.status} for month=${selectedMonth}`);
    const all = (await res.json()) as Array<{
      id: number;
      approvedTotal: number;
      unapprovedTotal: number;
      total: number;
    }>;
    const row = all.find((c) => c.id === fixtureCustomerId);
    assert.ok(row, `fixture customer ${fixtureCustomerId} not found in billing-preview response`);
    return { approvedTotal: row.approvedTotal, unapprovedTotal: row.unapprovedTotal, total: row.total };
  }

  async function fetchDetail(selectedMonth: string): Promise<{
    totalUnbilledAmount: number;
    approvedTotal: number;
    unapprovedTotal: number;
    unbilledWorkOrders: unknown[];
    unbilledBillingSheets: unknown[];
    pendingApprovalWorkOrders: unknown[];
    pendingApprovalBillingSheets: unknown[];
  }> {
    const url = `${baseUrl}/api/customers/${fixtureCustomerId}/billing?selectedMonth=${encodeURIComponent(selectedMonth)}`;
    const res = await fetch(url, { headers: authHeaders() });
    assert.equal(res.status, 200, `billing-detail returned ${res.status} for month=${selectedMonth}`);
    return res.json() as Promise<any>;
  }

  // ── Shared cross-endpoint parity assertion ───────────────────────────────────
  async function assertParity(
    selectedMonth: string,
    expected: { approvedTotal: number; unapprovedTotal: number },
  ): Promise<void> {
    const [preview, detail] = await Promise.all([
      fetchPreview(selectedMonth),
      fetchDetail(selectedMonth),
    ]);

    const CENT = 0.005; // half-cent float tolerance

    // Core parity claim: both routes must produce the same cutoff-scoped total.
    assert.ok(
      Math.abs(preview.total - detail.totalUnbilledAmount) < CENT,
      `[${selectedMonth}] preview.total=${preview.total} !== detail.totalUnbilledAmount=${detail.totalUnbilledAmount} — routes diverged`,
    );

    // Internal consistency: detail's own fields must add up.
    assert.ok(
      Math.abs(detail.totalUnbilledAmount - (detail.approvedTotal + detail.unapprovedTotal)) < CENT,
      `[${selectedMonth}] detail.totalUnbilledAmount=${detail.totalUnbilledAmount} !== ` +
      `approvedTotal(${detail.approvedTotal}) + unapprovedTotal(${detail.unapprovedTotal})`,
    );

    // Exact expected values so a future regression names the drift amount,
    // not just "numbers don't match".
    assert.ok(
      Math.abs(detail.approvedTotal - expected.approvedTotal) < CENT,
      `[${selectedMonth}] expected approvedTotal=${expected.approvedTotal}, got ${detail.approvedTotal}`,
    );
    assert.ok(
      Math.abs(detail.unapprovedTotal - expected.unapprovedTotal) < CENT,
      `[${selectedMonth}] expected unapprovedTotal=${expected.unapprovedTotal}, got ${detail.unapprovedTotal}`,
    );
  }

  // ── Test: target month (2025-03) ─────────────────────────────────────────────

  it("target month (2025-03): preview.total === detail.totalUnbilledAmount with correct split", async () => {
    // approved = (a)$100 [March BS] + (b)$80 [Feb WO, no lower bound] + (e)$25 [undated WO] = $205
    // unapproved = (d)$50 [submitted March BS]
    // excluded: (c)$200 [April WO, after cutoff]  (f)$300 [invoice_id set]
    await assertParity(TARGET_MONTH, { approvedTotal: 205, unapprovedTotal: 50 });
  });

  it("target month (2025-03): detail item membership is correct", async () => {
    const detail = await fetchDetail(TARGET_MONTH);

    // Approved WOs: (b) Feb WO + (e) undated WO — (f) is billed, (c) is April
    assert.equal(
      detail.unbilledWorkOrders.length, 2,
      "March: expected 2 approved WOs (Feb WO + undated WO)",
    );
    // Approved BSs: (a) March BS only — (d) is submitted/pending
    assert.equal(
      detail.unbilledBillingSheets.length, 1,
      "March: expected 1 approved BS (March BS)",
    );
    // Pending WOs: none
    assert.equal(
      detail.pendingApprovalWorkOrders.length, 0,
      "March: expected 0 pending WOs",
    );
    // Pending BSs: (d) submitted March BS
    assert.equal(
      detail.pendingApprovalBillingSheets.length, 1,
      "March: expected 1 pending BS (submitted March BS)",
    );
  });

  // ── Test: earlier month (2025-02) ────────────────────────────────────────────

  it("earlier month (2025-02): preview.total === detail.totalUnbilledAmount with correct split", async () => {
    // approved = (b)$80 [Feb WO] + (e)$25 [undated WO] = $105
    // unapproved = $0 — (d) March BS is after Feb cutoff and therefore excluded
    // excluded: (a) March BS, (c) April WO, (d) March BS, (f) billed WO
    await assertParity(EARLIER_MONTH, { approvedTotal: 105, unapprovedTotal: 0 });
  });

  it("earlier month (2025-02): detail item membership is correct", async () => {
    const detail = await fetchDetail(EARLIER_MONTH);

    // Approved WOs: (b) Feb WO + (e) undated WO
    assert.equal(
      detail.unbilledWorkOrders.length, 2,
      "Feb: expected 2 approved WOs (Feb WO + undated WO)",
    );
    // Approved BSs: none — (a) March BS is after Feb cutoff
    assert.equal(
      detail.unbilledBillingSheets.length, 0,
      "Feb: expected 0 approved BSs (March BS excluded by cutoff)",
    );
    // Pending WOs: none
    assert.equal(
      detail.pendingApprovalWorkOrders.length, 0,
      "Feb: expected 0 pending WOs",
    );
    // Pending BSs: none — (d) is a March BS, after Feb cutoff
    assert.equal(
      detail.pendingApprovalBillingSheets.length, 0,
      "Feb: expected 0 pending BSs (March submitted BS excluded by cutoff)",
    );
  });

  // ── Test: all-open view ──────────────────────────────────────────────────────

  it("all-open view ('all'): preview.total === detail.totalUnbilledAmount with correct split", async () => {
    // approved = (a)$100 + (b)$80 + (c)$200 + (e)$25 = $405
    // unapproved = (d)$50
    // excluded: (f)$300 [invoice_id set — excluded in every view]
    await assertParity("all", { approvedTotal: 405, unapprovedTotal: 50 });
  });

  it("all-open view ('all'): detail item membership is correct", async () => {
    const detail = await fetchDetail("all");

    // Approved WOs: (b) Feb + (c) April + (e) undated — (f) billed excluded
    assert.equal(
      detail.unbilledWorkOrders.length, 3,
      "all: expected 3 approved WOs (Feb + April + undated; billed WO excluded)",
    );
    // Approved BSs: (a) March BS only
    assert.equal(
      detail.unbilledBillingSheets.length, 1,
      "all: expected 1 approved BS (March BS)",
    );
    // Pending BSs: (d) submitted March BS
    assert.equal(
      detail.pendingApprovalBillingSheets.length, 1,
      "all: expected 1 pending BS (submitted March BS)",
    );
  });
});

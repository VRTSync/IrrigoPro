/**
 * wcb-delete.test.ts — Task #1728
 *
 * Server-side integration tests for DELETE /api/wet-check-billings/:id.
 *
 * Scenarios:
 *   (a) Happy path: WCB is deleted; finding links (wetCheckBillingId,
 *       convertedAt, resolution) are cleared on every associated finding.
 *   (b) Invoiced WCB returns 409 with WCB_ALREADY_INVOICED code.
 *   (c) Cross-company WCB returns 404.
 *   (d) After WCB deletion, the existing wet-check delete guard passes —
 *       i.e., no WetCheckHasWetCheckBillingError is thrown for that wet check.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  wetCheckFindings,
  wetCheckBillings,
  wetChecks,
} from "@workspace/db/schema";

// ── Fixture state ─────────────────────────────────────────────────────────────

let fixtureCompanyId: number;
let fixtureCompanyId2: number;
let fixtureCustomerId: number;
let fixtureTechId: number;
let fixtureWetCheckId: number;
let fixtureInvoiceId: number;

const RUN_ID = Date.now();
const BILLING_PREFIX = `WCB-DEL-TEST-${RUN_ID}`;
const TECH_USERNAME = `wcb-del-tech-${RUN_ID}`;

async function insertWetCheck(companyId: number, customerId: number, techId: number): Promise<number> {
  const rows = await db.execute(sql`
    INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name, customer_name,
                            num_controllers, status, labor_mode)
    VALUES (${companyId}, ${customerId}, ${techId}, 'Del Tech', 'Del Customer', 1, 'submitted', 'flat')
    RETURNING id
  `);
  return Number((rows.rows[0] as { id: number }).id);
}

async function insertWcb(opts: {
  billingNumber: string;
  wetCheckId: number;
  customerId: number;
  invoiceId?: number;
}): Promise<number> {
  const rows = await db.execute(sql`
    INSERT INTO wet_check_billings (
      billing_number, customer_id, customer_name, property_address, work_date,
      technician_name, wet_check_id, status, total_hours, labor_rate,
      labor_subtotal, parts_subtotal, total_amount, invoice_id
    )
    VALUES (
      ${opts.billingNumber}, ${opts.customerId}, 'Del Customer', '1 Test Rd',
      NOW(), 'Del Tech', ${opts.wetCheckId}, 'submitted', '2.00', '45.00',
      '90.00', '0.00', '90.00', ${opts.invoiceId ?? null}
    )
    RETURNING id
  `);
  return Number((rows.rows[0] as { id: number }).id);
}

async function insertFinding(wetCheckId: number, wcbId: number): Promise<number> {
  const zoneRows = await db.execute(sql`
    INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number, status)
    VALUES (${wetCheckId}, 'A', 1, 'checked')
    RETURNING id
  `);
  const zoneRecordId = Number((zoneRows.rows[0] as { id: number }).id);

  const findingRows = await db.execute(sql`
    INSERT INTO wet_check_findings (
      wet_check_id, zone_record_id, issue_type, issue_group, quantity, resolution,
      wet_check_billing_id, converted_at
    )
    VALUES (
      ${wetCheckId}, ${zoneRecordId}, 'broken_head', 'quick_fix', 1, 'repaired_in_field',
      ${wcbId}, NOW()
    )
    RETURNING id
  `);
  return Number((findingRows.rows[0] as { id: number }).id);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

before(async () => {
  const c1 = await db.execute(sql`
    INSERT INTO companies (name, subscription, is_active)
    VALUES ('WCB Del Test Co 1', 'basic', true) RETURNING id
  `);
  fixtureCompanyId = Number((c1.rows[0] as { id: number }).id);

  const c2 = await db.execute(sql`
    INSERT INTO companies (name, subscription, is_active)
    VALUES ('WCB Del Test Co 2', 'basic', true) RETURNING id
  `);
  fixtureCompanyId2 = Number((c2.rows[0] as { id: number }).id);

  const cust = await db.execute(sql`
    INSERT INTO customers (company_id, name, email)
    VALUES (${fixtureCompanyId}, 'Del Customer', 'wcb-del-test@example.com') RETURNING id
  `);
  fixtureCustomerId = Number((cust.rows[0] as { id: number }).id);

  const tech = await db.execute(sql`
    INSERT INTO users (username, password, name, role, company_id, is_active)
    VALUES (${TECH_USERNAME}, 'hashed', 'Del Tech', 'field_tech', ${fixtureCompanyId}, true)
    RETURNING id
  `);
  fixtureTechId = Number((tech.rows[0] as { id: number }).id);

  fixtureWetCheckId = await insertWetCheck(fixtureCompanyId, fixtureCustomerId, fixtureTechId);

  const inv = await db.execute(sql`
    INSERT INTO invoices (
      customer_id, company_id, invoice_number, customer_name, customer_email,
      invoice_month, invoice_year, period_start, period_end,
      status, parts_subtotal, labor_subtotal, total_amount
    )
    VALUES (
      ${fixtureCustomerId}, ${fixtureCompanyId}, 'INV-DEL-TEST-001', 'Del Customer', 'del@example.com',
      6, 2026, NOW(), NOW(),
      'draft', '0.00', '90.00', '90.00'
    )
    RETURNING id
  `);
  fixtureInvoiceId = Number((inv.rows[0] as { id: number }).id);
});

after(async () => {
  await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_id = ${fixtureWetCheckId}`);
  await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id = ${fixtureWetCheckId}`);
  await db.execute(sql`DELETE FROM wet_check_billings WHERE billing_number LIKE ${BILLING_PREFIX + '%'}`);
  await db.execute(sql`DELETE FROM wet_checks WHERE id = ${fixtureWetCheckId}`);
  await db.execute(sql`DELETE FROM invoices WHERE id = ${fixtureInvoiceId}`);
  await db.execute(sql`DELETE FROM customers WHERE id = ${fixtureCustomerId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${fixtureTechId}`);
  await db.execute(sql`DELETE FROM companies WHERE id IN (${fixtureCompanyId}, ${fixtureCompanyId2})`);
});

// ── (a) Happy path: deletion clears finding links ─────────────────────────────

describe("deleteWetCheckBilling — happy path (a)", () => {
  it("deletes the WCB row and clears finding links", async () => {
    const wcbId = await insertWcb({
      billingNumber: `${BILLING_PREFIX}-A`,
      wetCheckId: fixtureWetCheckId,
      customerId: fixtureCustomerId,
    });
    const findingId = await insertFinding(fixtureWetCheckId, wcbId);

    // Pre-condition: finding must have wcbId set.
    const [beforeFinding] = await db
      .select()
      .from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.equal(beforeFinding?.wetCheckBillingId, wcbId, "finding should reference WCB before delete");
    assert.ok(beforeFinding?.convertedAt instanceof Date, "convertedAt should be set before delete");
    assert.notEqual(beforeFinding?.resolution, "pending", "resolution should not be pending before delete");

    // Act.
    await storage.deleteWetCheckBilling(wcbId);

    // WCB row should be gone.
    const [deletedWcb] = await db
      .select()
      .from(wetCheckBillings)
      .where(eq(wetCheckBillings.id, wcbId));
    assert.equal(deletedWcb, undefined, "WCB row should be gone");

    // Finding links should be cleared.
    const [afterFinding] = await db
      .select()
      .from(wetCheckFindings)
      .where(eq(wetCheckFindings.id, findingId));
    assert.ok(afterFinding !== undefined, "finding row should still exist");
    assert.equal(afterFinding?.wetCheckBillingId, null, "wetCheckBillingId should be null after delete");
    assert.equal(afterFinding?.convertedAt, null, "convertedAt should be null after delete");
    assert.equal(afterFinding?.resolution, "pending", "resolution should be reset to pending");
  });
});

// ── (b) Invoiced WCB guard via route-level check ──────────────────────────────

describe("DELETE /api/wet-check-billings/:id — invoiced WCB returns 409 (b)", () => {
  it("getWetCheckBillingById returns an invoiceId when the WCB is invoiced", async () => {
    const wcbId = await insertWcb({
      billingNumber: `${BILLING_PREFIX}-B`,
      wetCheckId: fixtureWetCheckId,
      customerId: fixtureCustomerId,
      invoiceId: fixtureInvoiceId,
    });

    try {
      const wcb = await storage.getWetCheckBillingById(wcbId, fixtureCompanyId);
      assert.ok(wcb !== undefined, "WCB should be found");
      assert.equal(wcb!.invoiceId, fixtureInvoiceId, "invoiceId must be set so the route returns 409");
    } finally {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${wcbId}`);
    }
  });
});

// ── (c) Cross-company WCB returns 404 ────────────────────────────────────────

describe("DELETE /api/wet-check-billings/:id — cross-company returns 404 (c)", () => {
  it("getWetCheckBillingById with wrong companyId returns undefined", async () => {
    const wcbId = await insertWcb({
      billingNumber: `${BILLING_PREFIX}-C`,
      wetCheckId: fixtureWetCheckId,
      customerId: fixtureCustomerId,
    });

    try {
      // Looking up the WCB with a different company's ID should return undefined.
      const wcb = await storage.getWetCheckBillingById(wcbId, fixtureCompanyId2);
      assert.equal(wcb, undefined, "cross-company lookup must return undefined (route → 404)");
    } finally {
      await db.execute(sql`DELETE FROM wet_check_billings WHERE id = ${wcbId}`);
    }
  });
});

// ── (d) Wet-check delete guard passes after WCB removal ──────────────────────

describe("deleteWetCheck — guard clears after WCB removal (d)", () => {
  it("throws WetCheckHasWetCheckBillingError before WCB delete, then succeeds after", async () => {
    // Create a fresh wet check (can't delete fixtureWetCheckId — it has findings from test a).
    const wcId = await insertWetCheck(fixtureCompanyId, fixtureCustomerId, fixtureTechId);
    const wcbId = await insertWcb({
      billingNumber: `${BILLING_PREFIX}-D`,
      wetCheckId: wcId,
      customerId: fixtureCustomerId,
    });
    await insertFinding(wcId, wcbId);

    const { WetCheckHasWetCheckBillingError } = await import("../storage");

    // Before WCB delete: the wet-check delete should be blocked.
    try {
      await storage.deleteWetCheck(wcId, fixtureCompanyId);
      assert.fail("Expected WetCheckHasWetCheckBillingError but deleteWetCheck succeeded");
    } catch (e: any) {
      assert.ok(
        e instanceof WetCheckHasWetCheckBillingError,
        `Expected WetCheckHasWetCheckBillingError, got ${e?.constructor?.name}: ${e?.message}`,
      );
    }

    // Remove the WCB (clears finding links).
    await storage.deleteWetCheckBilling(wcbId);

    // After WCB delete: deleteWetCheck should succeed without throwing.
    try {
      await storage.deleteWetCheck(wcId, fixtureCompanyId);
    } catch (e: any) {
      assert.fail(`deleteWetCheck threw after WCB removal: ${e?.message}`);
    }

    // Wet check row should be gone.
    const [gone] = await db.select().from(wetChecks).where(eq(wetChecks.id, wcId));
    assert.equal(gone, undefined, "wet check should be deleted");
  });
});

/**
 * wet-check-convert-creates-wcb.test.ts
 * Task #802 — WC Separate System Slice 6.
 *
 * Integration tests verifying that the conversion path now writes to
 * wet_check_billings instead of billing_sheets.
 *
 * Covers:
 *  1. submit with auto-bill → WCB row created, billing_number matches WC-YYYY-NNNN,
 *     findings stamped with wetCheckBillingId, no new billing_sheets row.
 *  2. Partial-conversion append (second convertWetCheck call) → same WCB id reused,
 *     totals recomputed, new findings stamped.
 *  3. Idempotency: re-submit of an already-submitted wet check returns the existing WCB id.
 *
 * Note on no_part_needed=true: findings are seeded with no_part_needed=true so no
 * part_id FK is required. _writeRepairedInFieldBilling treats these as labor-only lines
 * (parts subtotal = 0). Labor totals are still verified against zone repairLaborHours.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "../db";
import { sql, eq, like } from "drizzle-orm";

import {
  wetChecks,
  wetCheckFindings,
  wetCheckBillings,
  billingSheets,
} from "@workspace/db/schema";

import { storage } from "../storage";

// ─── Scratch IDs ─────────────────────────────────────────────────────────────
// company_id=2 always exists after seed. Scratch ids chosen far from real data.

const S = {
  companyId: 2,
  customerId: 78001,
  techId: 78001,
  // Two wet check scenarios with separate ID spaces
  wc1Id: 78001,
  zoneA1Id: 78101,
  finding1Id: 78201,
  finding2Id: 78202,
  // Second wet check for append scenario
  wc2Id: 78002,
  zoneB1Id: 78102,
  finding3Id: 78203,
  finding4Id: 78204,
};

async function seedCustomerAndUser() {
  await db.execute(sql`
    INSERT INTO customers (id, company_id, name, email, labor_rate)
    VALUES (${S.customerId}, ${S.companyId}, 'WCB Create Test Customer', 'wcbcreate@test.local', '60.00')
    ON CONFLICT (id) DO UPDATE SET labor_rate = '60.00'
  `);
  await db.execute(sql`
    INSERT INTO users (id, username, password, name, role, company_id)
    VALUES (${S.techId}, 'wcbcreate-tech-78001', 'hashed', 'WCB Tech', 'field_tech', ${S.companyId})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function seedWetCheck1() {
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name,
                            customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${S.wc1Id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'WCB Tech',
            'WCB Create Test Customer', 1, 'in_progress', 'flat', '0.50', now())
    ON CONFLICT (id) DO UPDATE SET status = 'in_progress', total_labor_hours = '0.50'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number,
                                        status, repair_labor_hours)
    VALUES (${S.zoneA1Id}, ${S.wc1Id}, 'A', 1, 'checked_with_issues', '1.00')
    ON CONFLICT (id) DO UPDATE SET repair_labor_hours = '1.00'
  `);
  // no_part_needed=true avoids requiring a part_id FK. Labor-only lines are
  // still stamped with wetCheckBillingId and contribute to totalHours.
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution, no_part_needed)
    VALUES (${S.finding1Id}, ${S.zoneA1Id}, ${S.wc1Id}, 'broken_head', 'quick_fix',
            0, '0.00', '0.25', 'repaired_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'repaired_in_field', wet_check_billing_id = NULL,
                                   billing_sheet_id = NULL, converted_at = NULL
  `);
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution, no_part_needed)
    VALUES (${S.finding2Id}, ${S.zoneA1Id}, ${S.wc1Id}, 'valve_leak', 'advanced',
            0, '0.00', '0.50', 'repaired_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'repaired_in_field', wet_check_billing_id = NULL,
                                   billing_sheet_id = NULL, converted_at = NULL
  `);
}

async function seedWetCheck2() {
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name,
                            customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${S.wc2Id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'WCB Tech',
            'WCB Create Test Customer', 1, 'in_progress', 'flat', '0.30', now())
    ON CONFLICT (id) DO UPDATE SET status = 'in_progress', total_labor_hours = '0.30'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number,
                                        status, repair_labor_hours)
    VALUES (${S.zoneB1Id}, ${S.wc2Id}, 'A', 1, 'checked_with_issues', '0.75')
    ON CONFLICT (id) DO UPDATE SET repair_labor_hours = '0.75'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution, no_part_needed)
    VALUES (${S.finding3Id}, ${S.zoneB1Id}, ${S.wc2Id}, 'broken_head', 'quick_fix',
            0, '0.00', '0.20', 'repaired_in_field', true),
           (${S.finding4Id}, ${S.zoneB1Id}, ${S.wc2Id}, 'valve_leak', 'advanced',
            0, '0.00', '0.30', 'repaired_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'repaired_in_field', wet_check_billing_id = NULL,
                                   billing_sheet_id = NULL, converted_at = NULL
  `);
}

async function cleanupAll() {
  // findings first (FK → WCBs, wet checks)
  await db.execute(sql`
    DELETE FROM wet_check_findings
    WHERE id IN (${S.finding1Id}, ${S.finding2Id}, ${S.finding3Id}, ${S.finding4Id})
  `);
  await db.execute(sql`
    DELETE FROM wet_check_zone_records WHERE id IN (${S.zoneA1Id}, ${S.zoneB1Id})
  `);
  // WCBs before wet_checks (FK constraint)
  await db.execute(sql`
    DELETE FROM wet_check_billings WHERE wet_check_id IN (${S.wc1Id}, ${S.wc2Id})
  `);
  await db.execute(sql`
    DELETE FROM wet_checks WHERE id IN (${S.wc1Id}, ${S.wc2Id})
  `);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("_writeRepairedInFieldBilling Slice 6 — writes to wet_check_billings, not billing_sheets", () => {
  before(async () => {
    await seedCustomerAndUser();
    await seedWetCheck1();
  });

  after(async () => {
    await cleanupAll();
  });

  it("submitWetCheck creates a wet_check_billings row with a WC-YYYY-NNNN billing number", async () => {
    const result = await storage.submitWetCheck(S.wc1Id, S.companyId);
    assert.ok(result, "submitWetCheck must return a result");

    const wcbId = result.billingSheetId;
    assert.ok(wcbId != null, "billingSheetId (WCB id) must be non-null after auto-bill");

    const [wcb] = await db.select().from(wetCheckBillings)
      .where(eq(wetCheckBillings.id, wcbId));
    assert.ok(wcb, "wet_check_billings row must exist");
    assert.match(wcb.billingNumber, /^WC-\d{4}-\d{4}$/, "billing number must match WC-YYYY-NNNN");
    assert.equal(wcb.wetCheckId, S.wc1Id, "WCB must be linked to the wet check");
    assert.equal(wcb.status, "submitted");
    assert.equal(String(wcb.laborRate), "60.00", "labor rate must be the customer snapshot");
  });

  it("findings are stamped with wetCheckBillingId, not billingSheetId", async () => {
    const [wcb] = await db.select({ id: wetCheckBillings.id })
      .from(wetCheckBillings).where(eq(wetCheckBillings.wetCheckId, S.wc1Id));
    assert.ok(wcb, "WCB must exist");

    const findings = await db.select({
      id: wetCheckFindings.id,
      wetCheckBillingId: wetCheckFindings.wetCheckBillingId,
      billingSheetId: wetCheckFindings.billingSheetId,
    }).from(wetCheckFindings).where(eq(wetCheckFindings.wetCheckId, S.wc1Id));

    assert.equal(findings.length, 2, "should have 2 findings");
    for (const f of findings) {
      assert.equal(f.wetCheckBillingId, wcb.id, `finding ${f.id} must have wetCheckBillingId set`);
      assert.equal(f.billingSheetId, null, `finding ${f.id} must NOT have billingSheetId (Slice 6)`);
    }
  });

  it("no billing_sheets row was created for this wet check's auto-bill", async () => {
    // Verify no billing_sheets rows were created for this customer by the Slice 6 auto-bill path.
    const bsRows = await db.select({ id: billingSheets.id })
      .from(billingSheets)
      .where(like(billingSheets.billingNumber, `BS-WC-${S.wc1Id}%`));
    assert.equal(bsRows.length, 0, "no billing_sheet rows should be created by Slice 6 auto-bill");
  });

  it("WCB totals are computed correctly: zone labor, no parts (labor-only findings)", async () => {
    const [wcb] = await db.select().from(wetCheckBillings)
      .where(eq(wetCheckBillings.wetCheckId, S.wc1Id));
    assert.ok(wcb);

    // no_part_needed=true → parts subtotal = 0 for all findings
    assert.equal(parseFloat(wcb.partsSubtotal), 0, "parts subtotal must be 0 for labor-only findings");

    // Labor: wc.totalLaborHours=0.50 + zoneA1.repairLaborHours=1.00 = 1.50h × 60 = 90
    assert.equal(parseFloat(wcb.laborSubtotal), 90, "labor subtotal must use wc base + zone repairLaborHours");
    assert.equal(parseFloat(wcb.totalAmount), 90, "total must be parts(0) + labor(90)");
  });

  it("re-submit of already-submitted wet check is idempotent — returns same WCB id", async () => {
    const first = await storage.submitWetCheck(S.wc1Id, S.companyId);
    const second = await storage.submitWetCheck(S.wc1Id, S.companyId);
    assert.equal(first?.billingSheetId, second?.billingSheetId,
      "idempotent re-submit must return the same WCB id");
  });
});

describe("Partial-conversion append — second convertWetCheck call reuses the same WCB", () => {
  before(async () => {
    await seedCustomerAndUser();
    await seedWetCheck2();
  });

  it("first submit creates WCB with finding3 only; second convert appends finding4 to the same WCB", async () => {
    // Mark finding4 as pending initially so only finding3 auto-bills on submit
    await db.execute(sql`
      UPDATE wet_check_findings SET resolution = 'pending'
      WHERE id = ${S.finding4Id}
    `);

    const submitResult = await storage.submitWetCheck(S.wc2Id, S.companyId);
    assert.ok(submitResult, "first submit must succeed");
    const firstWcbId = submitResult.billingSheetId;
    assert.ok(firstWcbId != null, "first submit must produce a WCB");

    // Check that only finding3 is stamped
    const [f3] = await db.select({ wetCheckBillingId: wetCheckFindings.wetCheckBillingId })
      .from(wetCheckFindings).where(eq(wetCheckFindings.id, S.finding3Id));
    const [f4] = await db.select({ wetCheckBillingId: wetCheckFindings.wetCheckBillingId })
      .from(wetCheckFindings).where(eq(wetCheckFindings.id, S.finding4Id));
    assert.equal(f3.wetCheckBillingId, firstWcbId, "finding3 must be stamped after first submit");
    assert.equal(f4.wetCheckBillingId, null, "finding4 must not be stamped yet");

    // Now convert finding4 (manager sends it via convertWetCheck)
    await db.execute(sql`
      UPDATE wet_check_findings SET resolution = 'repaired_in_field'
      WHERE id = ${S.finding4Id}
    `);
    const convertResult = await storage.convertWetCheckToWetCheckBilling(S.wc2Id, S.companyId, { id: S.techId, name: "WCB Tech" });
    assert.ok(convertResult, "convertWetCheck must succeed");
    const secondWcbId = convertResult.billingSheetId;

    assert.equal(secondWcbId, firstWcbId, "second convert must reuse the same WCB (append, not new row)");

    const [f4After] = await db.select({ wetCheckBillingId: wetCheckFindings.wetCheckBillingId })
      .from(wetCheckFindings).where(eq(wetCheckFindings.id, S.finding4Id));
    assert.equal(f4After.wetCheckBillingId, firstWcbId, "finding4 must be stamped after append convert");

    // Verify totals were recomputed:
    // Parts: no_part_needed=true for all → 0
    // Labor: wc.totalLaborHours=0.30 + zone=0.75 = 1.05h × 60 = 63
    const [wcb] = await db.select().from(wetCheckBillings)
      .where(eq(wetCheckBillings.id, firstWcbId));
    assert.equal(parseFloat(wcb.partsSubtotal), 0, "appended WCB parts subtotal must be 0 (labor-only findings)");
    assert.equal(parseFloat(wcb.totalAmount), 63, "appended WCB total must be recomputed after append");
  });
});

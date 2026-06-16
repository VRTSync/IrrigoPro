/**
 * wet-check-convert-cif-rescue.test.ts
 *
 * Verifies that convertWetCheckToWetCheckBilling auto-routes findings where
 * techDisposition='completed_in_field' and resolution='pending' (or any non-
 * repaired_in_field value) into the WCB snapshot — mirroring the submit path
 * rescue block. Also covers idempotency (re-running convert) and ensures
 * already-routed findings are not touched.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { db } from "../db";
import { sql, eq } from "drizzle-orm";

import {
  wetChecks,
  wetCheckFindings,
  wetCheckBillings,
} from "@workspace/db/schema";

import { storage } from "../storage";

// ─── Scratch IDs ─────────────────────────────────────────────────────────────
// company_id=2 always exists after seed. IDs chosen far from real data.

const S = {
  companyId: 2,
  customerId: 79001,
  techId: 79001,

  // Scenario 1: CIF rescue on fresh convert
  wc1Id: 79001,
  zone1Id: 79101,
  finding1Id: 79201,  // completed_in_field + resolution=pending → rescued
  finding2Id: 79202,  // completed_in_field + resolution=pending → rescued
  finding3Id: 79203,  // regular repaired_in_field → not touched by rescue (already correct)

  // Scenario 2: Re-running convert is idempotent (no double WCB)
  wc2Id: 79002,
  zone2Id: 79102,
  finding4Id: 79204,  // completed_in_field + resolution=pending

  // Scenario 3: Already-routed findings are untouched
  wc3Id: 79003,
  zone3Id: 79103,
  finding5Id: 79205,  // completed_in_field but already has wetCheckBillingId
};

async function seedBase() {
  await db.execute(sql`
    INSERT INTO customers (id, company_id, name, email, labor_rate)
    VALUES (${S.customerId}, ${S.companyId}, 'CIF Rescue Test Customer', 'cifrescue@test.local', '55.00')
    ON CONFLICT (id) DO UPDATE SET labor_rate = '55.00'
  `);
  await db.execute(sql`
    INSERT INTO users (id, username, password, name, role, company_id)
    VALUES (${S.techId}, 'cifrescue-tech-79001', 'hashed', 'CIF Tech', 'field_tech', ${S.companyId})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function seedWetCheck1() {
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name,
                            customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${S.wc1Id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'CIF Tech',
            'CIF Rescue Test Customer', 1, 'submitted', 'flat', '0.25', now())
    ON CONFLICT (id) DO UPDATE SET status = 'submitted', total_labor_hours = '0.25'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number,
                                        status, repair_labor_hours)
    VALUES (${S.zone1Id}, ${S.wc1Id}, 'A', 1, 'checked_with_issues', '0.50')
    ON CONFLICT (id) DO UPDATE SET repair_labor_hours = '0.50'
  `);
  // finding1: completed_in_field + resolution=pending → must be rescued
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution,
                                    tech_disposition, no_part_needed)
    VALUES (${S.finding1Id}, ${S.zone1Id}, ${S.wc1Id}, 'broken_head', 'quick_fix',
            1, '0.00', '0.25', 'pending', 'completed_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'pending', tech_disposition = 'completed_in_field',
                                   wet_check_billing_id = NULL, billing_sheet_id = NULL,
                                   converted_at = NULL
  `);
  // finding2: completed_in_field + resolution=pending → must be rescued
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution,
                                    tech_disposition, no_part_needed)
    VALUES (${S.finding2Id}, ${S.zone1Id}, ${S.wc1Id}, 'valve_leak', 'advanced',
            1, '0.00', '0.30', 'pending', 'completed_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'pending', tech_disposition = 'completed_in_field',
                                   wet_check_billing_id = NULL, billing_sheet_id = NULL,
                                   converted_at = NULL
  `);
  // finding3: already resolution=repaired_in_field (not a rescue candidate)
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution,
                                    tech_disposition, no_part_needed)
    VALUES (${S.finding3Id}, ${S.zone1Id}, ${S.wc1Id}, 'nozzle_clog', 'quick_fix',
            1, '0.00', '0.10', 'repaired_in_field', 'completed_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'repaired_in_field', tech_disposition = 'completed_in_field',
                                   wet_check_billing_id = NULL, billing_sheet_id = NULL,
                                   converted_at = NULL
  `);
}

async function seedWetCheck2() {
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name,
                            customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${S.wc2Id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'CIF Tech',
            'CIF Rescue Test Customer', 1, 'submitted', 'flat', '0.10', now())
    ON CONFLICT (id) DO UPDATE SET status = 'submitted', total_labor_hours = '0.10'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number,
                                        status, repair_labor_hours)
    VALUES (${S.zone2Id}, ${S.wc2Id}, 'B', 1, 'checked_with_issues', '0.20')
    ON CONFLICT (id) DO UPDATE SET repair_labor_hours = '0.20'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, part_price, labor_hours, resolution,
                                    tech_disposition, no_part_needed)
    VALUES (${S.finding4Id}, ${S.zone2Id}, ${S.wc2Id}, 'broken_head', 'quick_fix',
            1, '0.00', '0.20', 'pending', 'completed_in_field', true)
    ON CONFLICT (id) DO UPDATE SET resolution = 'pending', tech_disposition = 'completed_in_field',
                                   wet_check_billing_id = NULL, billing_sheet_id = NULL,
                                   converted_at = NULL
  `);
}

async function seedWetCheck3() {
  // Wet check seeded first so the WCB FK is valid.
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name,
                            customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${S.wc3Id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'CIF Tech',
            'CIF Rescue Test Customer', 1, 'partially_converted', 'flat', '0.00', now())
    ON CONFLICT (id) DO UPDATE SET status = 'partially_converted'
  `);
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number,
                                        status, repair_labor_hours)
    VALUES (${S.zone3Id}, ${S.wc3Id}, 'C', 1, 'checked_with_issues', '0.00')
    ON CONFLICT (id) DO UPDATE SET repair_labor_hours = '0.00'
  `);
  // Create a real WCB row (all NOT NULL fields required).
  const result = await db.execute(sql`
    INSERT INTO wet_check_billings (
      billing_number, customer_id, customer_name, property_address, work_date,
      technician_name, technician_id, wet_check_id, status,
      total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount
    )
    VALUES (
      'WC-TEST-79003', ${S.customerId}, 'CIF Rescue Test Customer', '123 Test St', now(),
      'CIF Tech', ${S.techId}, ${S.wc3Id}, 'submitted',
      '0.00', '55.00', '0.00', '0.00', '0.00'
    )
    ON CONFLICT (billing_number) DO UPDATE SET wet_check_id = ${S.wc3Id}
    RETURNING id
  `);
  const priorWcbId = (result as any).rows?.[0]?.id ?? null;

  // finding5: already linked to the WCB — must not be re-processed by rescue.
  if (priorWcbId != null) {
    await db.execute(sql`
      INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                      quantity, part_price, labor_hours, resolution,
                                      tech_disposition, wet_check_billing_id, converted_at, no_part_needed)
      VALUES (${S.finding5Id}, ${S.zone3Id}, ${S.wc3Id}, 'broken_head', 'quick_fix',
              1, '0.00', '0.00', 'repaired_in_field', 'completed_in_field',
              ${priorWcbId}, now(), true)
      ON CONFLICT (id) DO UPDATE SET wet_check_billing_id = ${priorWcbId},
                                     converted_at = now(), resolution = 'repaired_in_field'
    `);
  }
}

async function cleanupAll() {
  await db.execute(sql`
    DELETE FROM wet_check_findings
    WHERE id IN (${S.finding1Id}, ${S.finding2Id}, ${S.finding3Id},
                 ${S.finding4Id}, ${S.finding5Id})
  `);
  await db.execute(sql`
    DELETE FROM wet_check_zone_records
    WHERE id IN (${S.zone1Id}, ${S.zone2Id}, ${S.zone3Id})
  `);
  await db.execute(sql`
    DELETE FROM wet_check_billings
    WHERE wet_check_id IN (${S.wc1Id}, ${S.wc2Id}, ${S.wc3Id})
  `);
  await db.execute(sql`
    DELETE FROM wet_checks WHERE id IN (${S.wc1Id}, ${S.wc2Id}, ${S.wc3Id})
  `);
}

const MANAGER = { id: S.techId, name: "CIF Tech" };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("convertWetCheckToWetCheckBilling — completed_in_field rescue", () => {
  before(async () => {
    await seedBase();
    await seedWetCheck1();
  });

  after(cleanupAll);

  it("completed_in_field findings at resolution=pending are stamped repaired_in_field and get wetCheckBillingId", async () => {
    const result = await storage.convertWetCheckToWetCheckBilling(
      S.wc1Id, S.companyId, MANAGER,
    );
    assert.ok(result, "convert must return a result");
    assert.ok(result.billingSheetId != null, "a WCB must be created");

    const findings = await db.select({
      id: wetCheckFindings.id,
      resolution: wetCheckFindings.resolution,
      wetCheckBillingId: wetCheckFindings.wetCheckBillingId,
      convertedAt: wetCheckFindings.convertedAt,
    }).from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, S.wc1Id));

    for (const f of findings) {
      assert.equal(f.resolution, "repaired_in_field",
        `finding ${f.id} resolution must be repaired_in_field after rescue`);
      assert.equal(f.wetCheckBillingId, result.billingSheetId,
        `finding ${f.id} must have wetCheckBillingId set`);
      assert.ok(f.convertedAt != null,
        `finding ${f.id} must have convertedAt stamped`);
    }
  });

  it("wet check status is converted after all findings are handled", async () => {
    const [wc] = await db.select({ status: wetChecks.status })
      .from(wetChecks).where(eq(wetChecks.id, S.wc1Id));
    assert.equal(wc?.status, "converted",
      "wet check must be fully converted when all findings are resolved");
  });

  it("a single WCB row is created — not multiple", async () => {
    const wcbs = await db.select({ id: wetCheckBillings.id })
      .from(wetCheckBillings)
      .where(eq(wetCheckBillings.wetCheckId, S.wc1Id));
    assert.equal(wcbs.length, 1, "exactly one WCB row must exist");
  });
});

describe("convertWetCheckToWetCheckBilling — re-running convert is idempotent (no double WCB)", () => {
  before(async () => {
    await seedBase();
    await seedWetCheck2();
  });

  after(cleanupAll);

  it("second convert call reuses the same WCB — no duplicate created", async () => {
    const first = await storage.convertWetCheckToWetCheckBilling(
      S.wc2Id, S.companyId, MANAGER,
    );
    assert.ok(first.billingSheetId != null, "first convert must create a WCB");

    // Re-seed status so the second call is accepted
    await db.execute(sql`
      UPDATE wet_checks SET status = 'submitted' WHERE id = ${S.wc2Id}
    `);
    // Reset finding so it looks unconverted for the re-run guard check
    // (finding already has wetCheckBillingId so rescue won't fire again)
    const second = await storage.convertWetCheckToWetCheckBilling(
      S.wc2Id, S.companyId, MANAGER,
    );

    assert.equal(second.billingSheetId, first.billingSheetId,
      "second convert must reuse the same WCB id");

    const wcbs = await db.select({ id: wetCheckBillings.id })
      .from(wetCheckBillings)
      .where(eq(wetCheckBillings.wetCheckId, S.wc2Id));
    assert.equal(wcbs.length, 1, "only one WCB must exist after two convert calls");
  });
});

describe("convertWetCheckToWetCheckBilling — already-routed findings are untouched", () => {
  before(async () => {
    await seedBase();
    await seedWetCheck3();
  });

  after(cleanupAll);

  it("finding already linked to a WCB is not re-processed or double-billed", async () => {
    const [before] = await db.select({
      wetCheckBillingId: wetCheckFindings.wetCheckBillingId,
      resolution: wetCheckFindings.resolution,
    }).from(wetCheckFindings).where(eq(wetCheckFindings.id, S.finding5Id));

    assert.ok(before?.wetCheckBillingId != null,
      "finding5 must already be linked to a WCB in seed");

    const wcbsBefore = await db.select({ id: wetCheckBillings.id })
      .from(wetCheckBillings)
      .where(eq(wetCheckBillings.wetCheckId, S.wc3Id));
    const wcbCountBefore = wcbsBefore.length;

    // Wet check 3 is partially_converted, still can be converted
    const result = await storage.convertWetCheckToWetCheckBilling(
      S.wc3Id, S.companyId, MANAGER,
    );
    assert.ok(result, "convert must succeed");

    const [after] = await db.select({
      wetCheckBillingId: wetCheckFindings.wetCheckBillingId,
      resolution: wetCheckFindings.resolution,
    }).from(wetCheckFindings).where(eq(wetCheckFindings.id, S.finding5Id));

    assert.equal(after?.wetCheckBillingId, before?.wetCheckBillingId,
      "already-routed finding's wetCheckBillingId must not change");

    const wcbsAfter = await db.select({ id: wetCheckBillings.id })
      .from(wetCheckBillings)
      .where(eq(wetCheckBillings.wetCheckId, S.wc3Id));
    assert.equal(wcbsAfter.length, wcbCountBefore,
      "no additional WCB rows created for already-routed findings");
  });
});

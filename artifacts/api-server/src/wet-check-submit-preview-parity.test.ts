import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage, LABOR_ONLY_ISSUE_TYPES } from "./storage";

const tag = `wcp-${Date.now()}`;
// The current canonical seed has no inherent labor-only types. Exercise the
// legacy billability path with a test-only member, removed after this suite.
const laborOnlyIssue = `parity_labor_only_${Date.now()}`;
let companyId: number;
let otherCompanyId: number;
let customerId: number;
let techId: number;
let partId: number;
const checks: number[] = [];

async function idOf(query: Promise<{ rows: unknown[] }>): Promise<number> {
  const result = await query;
  return Number((result.rows[0] as { id: number }).id);
}

async function check(mode: string, base = "0.00"): Promise<number> {
  const id = await idOf(db.execute(sql`
    INSERT INTO wet_checks (company_id, customer_id, technician_id, technician_name,
      customer_name, num_controllers, status, labor_mode, total_labor_hours)
    VALUES (${companyId}, ${customerId}, ${techId}, 'Parity Tech', 'Parity Customer',
      1, 'in_progress', ${mode}, ${base}) RETURNING id
  `));
  checks.push(id);
  return id;
}

async function zone(wcId: number, number: number, manual: string | null = null): Promise<number> {
  return idOf(db.execute(sql`
    INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number,
      status, repair_labor_manually_set, repair_labor_hours)
    VALUES (${wcId}, 'A', ${number}, 'checked_with_issues', ${manual != null}, ${manual ?? "0.00"})
    RETURNING id
  `));
}

async function finding(
  wcId: number, zoneId: number, issue: string, quantity: number,
  price: string | null = null, part: number | null = null, noPart = false,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO wet_check_findings (wet_check_id, zone_record_id, issue_type, issue_group,
      quantity, part_id, part_price, no_part_needed, labor_hours, resolution)
    VALUES (${wcId}, ${zoneId}, ${issue}, 'quick_fix',
      ${quantity}, ${part}, ${price}, ${noPart}, '0.25', 'repaired_in_field')
  `);
}

async function assertParity(wcId: number) {
  const preview = await storage.previewWetCheckSubmit(wcId, companyId);
  assert.ok(preview);
  const beforeRows = await db.execute(sql`SELECT count(*)::int AS n FROM wet_check_billings WHERE wet_check_id = ${wcId}`);
  assert.equal(Number((beforeRows.rows[0] as { n: number }).n), 0, "preview must not create a snapshot");
  const submitted = await storage.submitWetCheck(wcId, companyId);
  assert.ok(submitted?.billingSheetId);
  const rows = await db.execute(sql`
    SELECT parts_subtotal, labor_subtotal, total_amount, total_hours
    FROM wet_check_billings WHERE id = ${submitted.billingSheetId}
  `);
  const snapshot = rows.rows[0] as Record<string, string>;
  assert.equal(preview.autoBilledPartsTotal, snapshot.parts_subtotal);
  assert.equal(preview.autoBilledLaborTotal, snapshot.labor_subtotal);
  assert.equal(preview.autoBilledGrandTotal, snapshot.total_amount);
  assert.equal(preview.autoBilledLaborHours, snapshot.total_hours);
  return preview;
}

describe("wet-check preview and submitted snapshot parity", () => {
  before(async () => {
    (LABOR_ONLY_ISSUE_TYPES as Set<string>).add(laborOnlyIssue);
    companyId = await idOf(db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`ParityCo-${tag}`}, 'basic', true) RETURNING id
    `));
    otherCompanyId = await idOf(db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`OtherParityCo-${tag}`}, 'basic', true) RETURNING id
    `));
    customerId = await idOf(db.execute(sql`
      INSERT INTO customers (company_id, name, email, labor_rate)
      VALUES (${companyId}, 'Parity Customer', ${`${tag}@example.test`}, '50.00') RETURNING id
    `));
    techId = await idOf(db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${tag}, 'hashed', 'Parity Tech', 'field_tech', ${companyId}, true) RETURNING id
    `));
    partId = await idOf(db.execute(sql`
      INSERT INTO parts (company_id, name, price, sku, category)
      VALUES (${companyId}, 'Head', '10.00', ${tag}, 'Sprinkler') RETURNING id
    `));
    await db.execute(sql`
      INSERT INTO issue_type_configs (company_id, issue_type, issue_group, display_label, default_labor_hours)
      VALUES (${companyId}, 'head_replacement', 'quick_fix', 'Head', '0.25'),
        (${companyId}, 'nozzle_replacement', 'quick_fix', 'Nozzle', '0.25'),
        (${companyId}, 'leak_repair', 'advanced', 'Leak', '1.00'),
        (${companyId}, ${laborOnlyIssue}, 'quick_fix', 'Labor', '0.50')
      ON CONFLICT (company_id, issue_type) DO UPDATE SET default_labor_hours = EXCLUDED.default_labor_hours
    `);
  });
  after(async () => {
    (LABOR_ONLY_ISSUE_TYPES as Set<string>).delete(laborOnlyIssue);
    for (const wcId of checks) {
      await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_id = ${wcId}`);
      await db.execute(sql`DELETE FROM wet_check_billings WHERE wet_check_id = ${wcId}`);
      await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id = ${wcId}`);
      await db.execute(sql`DELETE FROM wet_checks WHERE id = ${wcId}`);
    }
    await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id = ${companyId}`);
    await db.execute(sql`DELETE FROM parts WHERE id = ${partId}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${techId}`);
    await db.execute(sql`DELETE FROM companies WHERE id IN (${companyId}, ${otherCompanyId})`);
  });

  it("matches multi-finding zone, manual override, labor-only and base hours", async () => {
    const wcId = await check("flat", "1.50");
    const a = await zone(wcId, 1);
    const b = await zone(wcId, 2, "1.25");
    await finding(wcId, a, "head_replacement", 3, "10.00", partId);
    await finding(wcId, a, "nozzle_replacement", 2, "10.00", partId);
    await finding(wcId, b, "leak_repair", 1, null, null, true);
    const preview = await assertParity(wcId);
    assert.equal(preview.autoBilledCount, 3);
    assert.equal(preview.autoBilledPartsTotal, "50.00");
    assert.equal(preview.autoBilledLaborHours, "4.00");
    assert.equal(preview.autoBilledGrandTotal, "250.00");
  });

  it("bills inherent labor-only type without a part or no-part flag", async () => {
    const wcId = await check("flat");
    const a = await zone(wcId, 1);
    await finding(wcId, a, laborOnlyIssue, 1);
    const preview = await assertParity(wcId);
    assert.equal(preview.autoBilledCount, 1);
    assert.equal(preview.autoBilledPartsTotal, "0.00");
    assert.equal(preview.autoBilledLaborHours, "0.50");
  });

  it("includes an unbillable zone finding in auto-zone hours, as the existing bill does", async () => {
    const wcId = await check("flat");
    const a = await zone(wcId, 1);
    await finding(wcId, a, "head_replacement", 3, "10.00", partId);
    await finding(wcId, a, "nozzle_replacement", 2);
    const preview = await assertParity(wcId);
    assert.equal(preview.autoBilledCount, 1);
    assert.equal(preview.autoBilledLaborHours, "1.25");
    assert.equal(preview.autoBilledGrandTotal, "92.50");
  });

  it("keeps inspection preview at zero", async () => {
    const wcId = await check("inspection");
    await zone(wcId, 1);
    const preview = await storage.previewWetCheckSubmit(wcId, companyId);
    assert.ok(preview);
    assert.equal(preview.autoBilledCount, 0);
    for (const amount of [preview.autoBilledPartsTotal, preview.autoBilledLaborTotal,
      preview.autoBilledGrandTotal, preview.autoBilledLaborHours]) assert.equal(amount, "0.00");
  });

  it("does not price a service check with no billable findings", async () => {
    const wcId = await check("flat");
    const a = await zone(wcId, 1);
    await finding(wcId, a, "head_replacement", 3);
    const preview = await storage.previewWetCheckSubmit(wcId, companyId);
    assert.ok(preview);
    assert.equal(preview.autoBilledCount, 0);
    assert.deepEqual([
      preview.autoBilledPartsTotal, preview.autoBilledLaborHours,
      preview.autoBilledLaborTotal, preview.autoBilledGrandTotal,
    ], ["0.00", "0.00", "0.00", "0.00"]);
  });

  it("cannot preview a different company's wet check", async () => {
    const wcId = await check("flat");
    await assert.rejects(storage.previewWetCheckSubmit(wcId, otherCompanyId), /not found/);
  });
});
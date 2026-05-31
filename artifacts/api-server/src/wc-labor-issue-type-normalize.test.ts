/**
 * B2b — Issue type key normalization tests.
 *
 * Verifies:
 *  - normalizeIssueTypeKey: trim, lowercase, spaces/dashes → underscores
 *  - ISSUE_TYPE_ALIASES: semantic short-form aliases resolve to canonical keys
 *  - resolveIssueTypeKey: normalization + alias in one call
 *  - Storage integration: a finding stored with mixed-case issueType resolves
 *    against the catalog correctly (repairLaborHours is non-zero)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  normalizeIssueTypeKey,
  ISSUE_TYPE_ALIASES,
  resolveIssueTypeKey,
} from "./seeds/issue-type-configs";

const TAG = `wcl-norm-${Date.now()}`;

let cid: number;
let customerId: number;
let techId: number;
let wetCheckId: number;

let zoneSeq = 0;
async function insertZone(wcId: number): Promise<number> {
  zoneSeq += 1;
  const rows = await db.execute(sql`
    INSERT INTO wet_check_zone_records
      (wet_check_id, controller_letter, zone_number, repair_labor_manually_set, repair_labor_hours)
    VALUES
      (${wcId}, ${"N" + zoneSeq}, ${zoneSeq}, false, '0.00')
    RETURNING id
  `);
  return Number((rows.rows[0] as { id: number }).id);
}

describe("normalizeIssueTypeKey", () => {
  it("already-canonical key is unchanged", () => {
    assert.equal(normalizeIssueTypeKey("nozzle_replacement"), "nozzle_replacement");
  });

  it("trims leading/trailing whitespace", () => {
    assert.equal(normalizeIssueTypeKey("  leak_repair  "), "leak_repair");
  });

  it("lowercases uppercase letters", () => {
    assert.equal(normalizeIssueTypeKey("NOZZLE_REPLACEMENT"), "nozzle_replacement");
  });

  it("converts spaces to underscores", () => {
    assert.equal(normalizeIssueTypeKey("Nozzle Replacement"), "nozzle_replacement");
  });

  it("converts dashes to underscores", () => {
    assert.equal(normalizeIssueTypeKey("nozzle-replacement"), "nozzle_replacement");
  });

  it("collapses multiple spaces/dashes to a single underscore", () => {
    assert.equal(normalizeIssueTypeKey("head  --  replacement"), "head_replacement");
  });

  it("handles mixed case + spaces", () => {
    assert.equal(normalizeIssueTypeKey("Head Replacement"), "head_replacement");
  });

  it("handles mixed case + dashes", () => {
    assert.equal(normalizeIssueTypeKey("Valve-Issue"), "valve_issue");
  });
});

describe("ISSUE_TYPE_ALIASES", () => {
  it("nozzle_replace → nozzle_replacement", () => {
    assert.equal(ISSUE_TYPE_ALIASES["nozzle_replace"], "nozzle_replacement");
  });

  it("head_replace → head_replacement", () => {
    assert.equal(ISSUE_TYPE_ALIASES["head_replace"], "head_replacement");
  });

  it("head_adjust → head_adjustment", () => {
    assert.equal(ISSUE_TYPE_ALIASES["head_adjust"], "head_adjustment");
  });

  it("leak → leak_repair", () => {
    assert.equal(ISSUE_TYPE_ALIASES["leak"], "leak_repair");
  });

  it("pressure → pressure_issue", () => {
    assert.equal(ISSUE_TYPE_ALIASES["pressure"], "pressure_issue");
  });

  it("coverage → coverage_issue", () => {
    assert.equal(ISSUE_TYPE_ALIASES["coverage"], "coverage_issue");
  });

  it("valve → valve_issue", () => {
    assert.equal(ISSUE_TYPE_ALIASES["valve"], "valve_issue");
  });

  it("wiring → wiring_issue", () => {
    assert.equal(ISSUE_TYPE_ALIASES["wiring"], "wiring_issue");
  });

  it("controller → controller_issue", () => {
    assert.equal(ISSUE_TYPE_ALIASES["controller"], "controller_issue");
  });
});

describe("resolveIssueTypeKey", () => {
  it("canonical key passes through unchanged", () => {
    assert.equal(resolveIssueTypeKey("nozzle_replacement"), "nozzle_replacement");
  });

  it("mixed-case canonical key is normalized", () => {
    assert.equal(resolveIssueTypeKey("Nozzle Replacement"), "nozzle_replacement");
  });

  it("short-form alias is normalized then resolved", () => {
    assert.equal(resolveIssueTypeKey("Nozzle Replace"), "nozzle_replacement");
  });

  it("dash-separated alias is normalized then resolved", () => {
    assert.equal(resolveIssueTypeKey("nozzle-replace"), "nozzle_replacement");
  });

  it("short form 'leak' → 'leak_repair'", () => {
    assert.equal(resolveIssueTypeKey("Leak"), "leak_repair");
  });

  it("unknown type is still normalized (no crash)", () => {
    assert.equal(resolveIssueTypeKey("Custom  Issue-Type"), "custom_issue_type");
  });
});

describe("B2b — key normalization integration (storage)", () => {
  before(async () => {
    const co = await db.execute(sql`
      INSERT INTO companies (name, subscription, is_active)
      VALUES (${`WCLaborNormTestCo_${TAG}`}, 'basic', true)
      RETURNING id
    `);
    cid = Number((co.rows[0] as { id: number }).id);

    const cu = await db.execute(sql`
      INSERT INTO customers (company_id, name, email)
      VALUES (${cid}, 'Norm Test Customer', ${`norm-${TAG}@example.test`})
      RETURNING id
    `);
    customerId = Number((cu.rows[0] as { id: number }).id);

    const u = await db.execute(sql`
      INSERT INTO users (username, password, name, role, company_id, is_active)
      VALUES (${`norm-tech-${TAG}`}, 'hashed', 'Norm Tech', 'field_tech', ${cid}, true)
      RETURNING id
    `);
    techId = Number((u.rows[0] as { id: number }).id);

    const wc = await db.execute(sql`
      INSERT INTO wet_checks
        (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode)
      VALUES
        (${cid}, ${customerId}, ${techId}, 'Norm Tech', 'Norm Test Customer', 1, 'in_progress', 'flat')
      RETURNING id
    `);
    wetCheckId = Number((wc.rows[0] as { id: number }).id);

    // Only seed the canonical key — the test will insert a finding using an
    // alternate casing and verify the lookup resolves correctly.
    await db.execute(sql`
      INSERT INTO issue_type_configs
        (company_id, issue_type, issue_group, display_label, default_labor_hours)
      VALUES
        (${cid}, 'nozzle_replacement', 'quick_fix', 'Nozzle Replace', '0.25'),
        (${cid}, 'leak_repair',        'advanced',  'Leak',           '1.00')
      ON CONFLICT (company_id, issue_type) DO NOTHING
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_id = ${wetCheckId}`);
    await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id = ${wetCheckId}`);
    await db.execute(sql`DELETE FROM wet_checks WHERE id = ${wetCheckId}`);
    await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id = ${cid}`);
    await db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${techId}`);
    await db.execute(sql`DELETE FROM companies WHERE id = ${cid}`);
  });

  it("finding stored with canonical key resolves to non-zero labor", async () => {
    const zoneId = await insertZone(wetCheckId);
    await storage.createWetCheckFinding(zoneId, cid, {
      issueType: "nozzle_replacement",
      quantity: 1,
    });

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(result!.repairLaborHours, "0.25",
      "canonical issueType should resolve to defaultLaborHours=0.25");
  });

  it("configMap built with normalized keys resolves mixed-case issueType to non-zero labor", async () => {
    const zoneId = await insertZone(wetCheckId);

    // Insert finding directly with legacy mixed-case key so the storage
    // method sees the raw DB value (bypassing createWetCheckFinding which
    // already normalizes). This proves the configMap lookup also normalizes.
    await db.execute(sql`
      INSERT INTO wet_check_findings
        (zone_record_id, wet_check_id, issue_type, issue_group, quantity)
      VALUES
        (${zoneId}, ${wetCheckId}, 'Nozzle Replacement', 'quick_fix', 1)
    `);

    const result = await storage.resetZoneRepairLabor(zoneId, cid);
    assert.ok(result !== undefined);
    assert.equal(result!.repairLaborHours, "0.25",
      "mixed-case 'Nozzle Replacement' in DB should resolve to 0.25 via normalization");
  });
});

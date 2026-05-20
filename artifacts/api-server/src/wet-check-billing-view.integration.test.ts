/**
 * wet-check-billing-view.integration.test.ts
 * WC Billing Slice 8 — Integration tests for the view assembler seam.
 *
 * Covers:
 *   1. DB-backed seam: seed wet check + findings + zone records → submit-state
 *      billing sheet → call storage.getBillingSheetWetCheckView → assert payload
 *      shape, zone sort order, totals invariant, and display-label resolution.
 *   2. Observability: console.warn fires when repair_labor_hours=0 but findings
 *      carry non-zero laborHours (backfill-gap detection).
 *   3. No warn fires for a fully-backfilled, correctly quantized sheet.
 *   4. Field-tech pricing visibility contract validated against the real
 *      PRICING_FIELDS_TO_STRIP set and the real recursive strip algorithm:
 *        • Stripped: laborRate, partsSubtotal, laborSubtotal, unitPrice, laborTotal
 *        • Preserved (field_tech work-log): grandTotal, zoneTotal,
 *          zonePartsSubtotal, zoneLaborSubtotal, lineTotal, partsTotal
 *      The strip is executed by copying sanitizePricingFieldsInPlace verbatim
 *      from routes.ts and using the same PRICING_FIELDS_TO_STRIP import that
 *      the production route calls — any future changes to the strip set will
 *      automatically be reflected in these test assertions.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "./db";
import { sql } from "drizzle-orm";
import { PRICING_FIELDS_TO_STRIP } from "@workspace/db";

import { storage } from "./storage";

// ─── Scratch IDs (far from real dev-seed data) ───────────────────────────────
// Uses company_id=2 which always exists post-seeding. Customer and user are
// inserted with ON CONFLICT DO NOTHING so reruns are idempotent.

const T = {
  companyId: 2,
  customerId: 77001,
  userId: 77001,
  wetCheckId: 77001,
  zoneA1Id: 77101,
  zoneB2Id: 77102,
  bsId: 77001,
  findingIds: [77201, 77202, 77203],
  issueConfigId: 77001,
};

// The gap-detection scenario (suite 2): separate IDs so suites can run in
// any combination without FK conflicts.
const W = {
  companyId: 2,
  customerId: 77002,
  wetCheckId: 77002,
  zoneId: 77103,
  bsId: 77002,
  findingId: 77204,
};

// ─── Shared seed helpers ─────────────────────────────────────────────────────

async function seedMain() {
  await db.execute(sql`
    INSERT INTO customers (id, company_id, name, email, labor_rate)
    VALUES (${T.customerId}, ${T.companyId}, 'WCV Test Customer', 'wcv@test.local', '80.00')
    ON CONFLICT (id) DO UPDATE SET labor_rate = '80.00'
  `);
  await db.execute(sql`
    INSERT INTO users (id, username, password, name, role, company_id)
    VALUES (${T.userId}, 'wcv-test-tech-77001', 'hashed', 'WCV Tech', 'field_tech', ${T.companyId})
    ON CONFLICT (id) DO NOTHING
  `);
  // Synthetic issue type to avoid collisions with dev-DB configs
  await db.execute(sql`
    INSERT INTO issue_type_configs (id, company_id, issue_type, issue_group, display_label, default_labor_hours, sort_order)
    VALUES (${T.issueConfigId}, ${T.companyId}, 'wcv_test_type_a', 'quick_fix', 'Configured Label A', '0.50', 0)
    ON CONFLICT (id) DO UPDATE SET display_label = 'Configured Label A'
  `);
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name, customer_name,
                            num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${T.wetCheckId}, ${T.companyId}, ${T.customerId}, ${T.userId}, 'WCV Tech', 'WCV Test Customer',
            2, 'submitted', 'flat', '1.00', now())
    ON CONFLICT (id) DO NOTHING
  `);
  // zone A-1 — fully backfilled (repairLaborHours > 0)
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number, status, repair_labor_hours)
    VALUES (${T.zoneA1Id}, ${T.wetCheckId}, 'A', 1, 'checked_with_issues', '1.50')
    ON CONFLICT (id) DO NOTHING
  `);
  // zone B-2 — fully backfilled
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number, status, repair_labor_hours)
    VALUES (${T.zoneB2Id}, ${T.wetCheckId}, 'B', 2, 'checked_with_issues', '2.00')
    ON CONFLICT (id) DO NOTHING
  `);
  // billing sheet simulating _writeRepairedInFieldBilling outcome:
  //   total_labor = wc.totalLaborHours(1.00) + zoneA1(1.50) + zoneB2(2.00) = 4.50h
  //   labor_subtotal = 4.50 × 80 = 360; parts = 2×15 + 30 = 60; total = 420
  await db.execute(sql`
    INSERT INTO billing_sheets (id, billing_number, customer_id, customer_name, property_address,
                                work_date, technician_name, technician_id, work_description,
                                status, total_hours, labor_rate, applied_labor_rate,
                                labor_subtotal, parts_subtotal, total_amount, labor_mode)
    VALUES (${T.bsId}, 'BS-WC-TEST-77001', ${T.customerId}, 'WCV Test Customer', '123 Test St',
            now(), 'WCV Tech', ${T.userId}, 'Wet check repairs',
            'submitted', '4.50', '80.00', '80.00',
            '360.00', '60.00', '420.00', 'flat')
    ON CONFLICT (id) DO NOTHING
  `);
  // finding 1 — zone A-1, synthetic type with config entry (tests label lookup)
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, labor_hours, resolution, no_part_needed,
                                    part_name, part_price, billing_sheet_id)
    VALUES (${T.findingIds[0]}, ${T.zoneA1Id}, ${T.wetCheckId}, 'wcv_test_type_a', 'quick_fix',
            2, '0.75', 'repaired_in_field', false, 'Rotor Head', '15.00', ${T.bsId})
    ON CONFLICT (id) DO NOTHING
  `);
  // finding 2 — zone A-1, synthetic type with NO config entry → title-case "Wcv Test Type B"
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, labor_hours, resolution, no_part_needed,
                                    part_name, part_price, billing_sheet_id)
    VALUES (${T.findingIds[1]}, ${T.zoneA1Id}, ${T.wetCheckId}, 'wcv_test_type_b', 'advanced',
            1, '0.50', 'repaired_in_field', false, 'PVC Pipe', '30.00', ${T.bsId})
    ON CONFLICT (id) DO NOTHING
  `);
  // finding 3 — zone B-2, labor-only (noPartNeeded=true)
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, labor_hours, resolution, no_part_needed,
                                    billing_sheet_id)
    VALUES (${T.findingIds[2]}, ${T.zoneB2Id}, ${T.wetCheckId}, 'adjustment', 'quick_fix',
            0, '0.25', 'repaired_in_field', true, ${T.bsId})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanupMain() {
  await db.execute(sql`DELETE FROM wet_check_findings WHERE id = ANY(ARRAY[${T.findingIds[0]}, ${T.findingIds[1]}, ${T.findingIds[2]}]::int[])`);
  await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id IN (${T.zoneA1Id}, ${T.zoneB2Id})`);
  await db.execute(sql`DELETE FROM wet_checks WHERE id = ${T.wetCheckId}`);
  await db.execute(sql`DELETE FROM billing_sheets WHERE id = ${T.bsId}`);
  await db.execute(sql`DELETE FROM issue_type_configs WHERE id = ${T.issueConfigId}`);
}

async function seedGapScenario() {
  await db.execute(sql`
    INSERT INTO customers (id, company_id, name, email)
    VALUES (${W.customerId}, ${W.companyId}, 'WCV Warn Customer', 'wcvwarn@test.local')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO wet_checks (id, company_id, customer_id, technician_id, technician_name, customer_name,
                            num_controllers, status, labor_mode, total_labor_hours, started_at)
    VALUES (${W.wetCheckId}, ${W.companyId}, ${W.customerId}, ${T.userId}, 'WCV Tech', 'WCV Warn Customer',
            1, 'submitted', 'flat', '0.00', now())
    ON CONFLICT (id) DO NOTHING
  `);
  // Zone with repairLaborHours=0 — simulates missing backfill
  await db.execute(sql`
    INSERT INTO wet_check_zone_records (id, wet_check_id, controller_letter, zone_number, status, repair_labor_hours)
    VALUES (${W.zoneId}, ${W.wetCheckId}, 'A', 1, 'checked_with_issues', '0.00')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO billing_sheets (id, billing_number, customer_id, customer_name, property_address,
                                work_date, technician_name, work_description,
                                status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount)
    VALUES (${W.bsId}, 'BS-WC-WARN-77002', ${W.customerId}, 'WCV Warn Customer', '456 Warn St',
            now(), 'WCV Tech', 'Warn scenario',
            'submitted', '0.00', '80.00', '0.00', '15.00', '15.00')
    ON CONFLICT (id) DO NOTHING
  `);
  // Finding with non-zero laborHours — triggers the warn
  await db.execute(sql`
    INSERT INTO wet_check_findings (id, zone_record_id, wet_check_id, issue_type, issue_group,
                                    quantity, labor_hours, resolution, no_part_needed,
                                    part_name, part_price, billing_sheet_id)
    VALUES (${W.findingId}, ${W.zoneId}, ${W.wetCheckId}, 'valve_leak', 'advanced',
            1, '1.50', 'repaired_in_field', false, 'Valve', '15.00', ${W.bsId})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanupGapScenario() {
  await db.execute(sql`DELETE FROM wet_check_findings WHERE id = ${W.findingId}`);
  await db.execute(sql`DELETE FROM wet_check_zone_records WHERE id = ${W.zoneId}`);
  await db.execute(sql`DELETE FROM wet_checks WHERE id = ${W.wetCheckId}`);
  await db.execute(sql`DELETE FROM billing_sheets WHERE id = ${W.bsId}`);
}

// ─── Real pricing strip (verbatim copy of sanitizePricingFieldsInPlace from
//     routes.ts) using the SAME PRICING_FIELDS_TO_STRIP import the production
//     route uses. Any future change to the strip set automatically propagates
//     here, keeping tests in sync with real behavior. ─────────────────────────

function realPricingStripInPlace(data: any, seen?: WeakSet<object>): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (seen && seen.has(data)) return data;
  const tracker = seen ?? new WeakSet<object>();
  tracker.add(data);
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) realPricingStripInPlace(data[i], tracker);
    return data;
  }
  for (const key of Object.keys(data)) {
    if (PRICING_FIELDS_TO_STRIP.has(key)) { delete data[key]; continue; }
    const value = data[key];
    if (value !== null && typeof value === "object") realPricingStripInPlace(value, tracker);
  }
  return data;
}

// ─── 1. DB-backed seam test ───────────────────────────────────────────────────

describe("storage.getBillingSheetWetCheckView — DB-backed seam", () => {
  before(async () => { await seedMain(); });
  after(async () => { await cleanupMain(); });

  it("assembles the full view from live DB rows with correct payload shape", async () => {
    const view = await storage.getBillingSheetWetCheckView(T.bsId, T.companyId);
    assert.ok(view !== null, "view must not be null for a WC-backed billing sheet");
    assert.equal(view!.billingSheetId, T.bsId);
    assert.equal(view!.billingNumber, "BS-WC-TEST-77001");
    assert.equal(view!.customerId, T.customerId);
    assert.equal(view!.customerName, "WCV Test Customer");
    assert.equal(view!.inspection.wetCheckId, T.wetCheckId);
    assert.equal(view!.inspection.technicianName, "WCV Tech");
  });

  it("sorts zones by controllerLetter ASC then zoneNumber ASC", async () => {
    const view = await storage.getBillingSheetWetCheckView(T.bsId, T.companyId);
    assert.ok(view !== null);
    assert.deepEqual(
      view!.zones.map((z) => z.zoneLabel),
      ["A-1", "B-2"],
      "zones must be sorted A-1 before B-2",
    );
  });

  it("resolves issueDisplayLabel from issueTypeConfigs; falls back to title-case", async () => {
    const view = await storage.getBillingSheetWetCheckView(T.bsId, T.companyId);
    assert.ok(view !== null);
    const zoneA1 = view!.zones.find((z) => z.zoneLabel === "A-1")!;
    assert.ok(zoneA1, "zone A-1 must be present");
    // wcv_test_type_a → config row "Configured Label A"
    const cfgItem = zoneA1.lineItems.find((l) => l.issueType === "wcv_test_type_a");
    assert.ok(cfgItem, "wcv_test_type_a finding must appear in A-1");
    assert.equal(cfgItem!.issueDisplayLabel, "Configured Label A", "must use config display label");
    // wcv_test_type_b → no config row → title-case "Wcv Test Type B"
    const fbItem = zoneA1.lineItems.find((l) => l.issueType === "wcv_test_type_b");
    assert.ok(fbItem, "wcv_test_type_b finding must appear in A-1");
    assert.equal(fbItem!.issueDisplayLabel, "Wcv Test Type B", "must fall back to title-case");
  });

  it("totals invariant: partsSubtotal + laborSubtotal === grandTotal", async () => {
    const view = await storage.getBillingSheetWetCheckView(T.bsId, T.companyId);
    assert.ok(view !== null);
    const parts = parseFloat(view!.partsSubtotal);
    const labor = parseFloat(view!.laborSubtotal);
    const grand = parseFloat(view!.grandTotal);
    assert.ok(
      Math.abs(parts + labor - grand) < 0.01,
      `partsSubtotal(${parts}) + laborSubtotal(${labor}) must equal grandTotal(${grand})`,
    );
  });

  it("uses zone.repairLaborHours for zone labor, not per-finding laborHours sum", async () => {
    const view = await storage.getBillingSheetWetCheckView(T.bsId, T.companyId);
    assert.ok(view !== null);
    const zoneA1 = view!.zones.find((z) => z.zoneLabel === "A-1")!;
    // repairLaborHours = 1.50 from DB; per-finding sum would be 0.75 + 0.50 = 1.25
    assert.equal(zoneA1.repairLaborHours, "1.50", "must use repairLaborHours column");
    assert.equal(zoneA1.zoneLaborSubtotal, (1.5 * 80).toFixed(2));
  });

  it("returns null for a billing sheet id with no wet-check findings", async () => {
    const view = await storage.getBillingSheetWetCheckView(99998, T.companyId);
    assert.equal(view, null);
  });
});

// ─── 2. Observability warn — console.warn spy ─────────────────────────────────

describe("getBillingSheetWetCheckView — observability warns on backfill gap", () => {
  // Each test needs different seeded state. Seed both scenarios here so the
  // suites stay independent — both calls are ON CONFLICT idempotent.
  before(async () => {
    await seedGapScenario();
    await seedMain();   // needed by the "no warn" test
  });
  after(async () => {
    await cleanupGapScenario();
    await cleanupMain();
  });

  it("console.warn fires with structured JSON when zone.repairLaborHours=0 but findings have laborHours>0", async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
    try {
      await storage.getBillingSheetWetCheckView(W.bsId, W.companyId);
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.length, 1, "exactly one warn must fire for the single gap zone");
    const parsed = JSON.parse(warnings[0]);
    assert.equal(parsed.event, "wcv.backfill_gap");
    assert.equal(parsed.billingSheetId, W.bsId);
    assert.equal(parsed.wetCheckId, W.wetCheckId);
    assert.equal(parsed.zoneRecordId, W.zoneId);
    assert.equal(parsed.controllerLetter, "A");
    assert.equal(parsed.zoneNumber, 1);
    assert.ok(parsed.findingLaborHoursSum > 0, "findingLaborHoursSum must be > 0");
    assert.ok(typeof parsed.message === "string" && parsed.message.length > 0);
  });

  it("no console.warn fires for a fully-backfilled sheet (repairLaborHours > 0)", async () => {
    // T.bsId has zones with repairLaborHours=1.50 and 2.00 — fully backfilled.
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => { warnings.push(String(args[0])); };
    try {
      await storage.getBillingSheetWetCheckView(T.bsId, T.companyId);
    } finally {
      console.warn = origWarn;
    }
    const gapWarns = warnings.filter((w) => w.includes("wcv.backfill_gap"));
    assert.equal(gapWarns.length, 0, "no backfill-gap warn must fire for a fully-backfilled sheet");
  });
});

// ─── 3. Endpoint contract: pricing visibility against real storage + real strip ─
//
// Uses a minimal Express app whose route handler calls the REAL
// storage.getBillingSheetWetCheckView (against the seeded DB fixture) and
// applies the REAL pricing strip (realPricingStripInPlace — verbatim copy of
// the production sanitizePricingFieldsInPlace using the same PRICING_FIELDS_TO_STRIP
// import). This ensures test assertions match actual production behavior.

describe("GET /api/billing-sheets/:id/wet-check-view — endpoint contract", () => {
  let server: Server;
  let base: string;
  let role = "billing_manager";

  before(async () => {
    await seedMain();   // idempotent — ensures fixture rows exist for this suite

    const app: Express = express();
    app.use(express.json());

    const requireAuthentication: RequestHandler = (req: any, _res, next) => {
      req.authenticatedUserRole = role;
      req.authenticatedUserCompanyId = T.companyId;
      next();
    };

    app.get(
      "/api/billing-sheets/:id/wet-check-view",
      requireAuthentication,
      async (req: any, res) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid billing sheet ID" }); return;
        }
        const view = await storage.getBillingSheetWetCheckView(id, T.companyId);
        if (view === null) {
          // null means either billingSheetId doesn't exist or it has no WC findings
          // (production route checks bs existence first; here we collapse both to 404/422
          // to keep the stub focused on the pricing contract)
          if (id === T.bsId) {
            // should always return a view for the seeded fixture
            res.status(500).json({ message: "unexpected null for seeded fixture" }); return;
          }
          res.status(404).json({ message: "Not found or not a wet-check billing sheet" }); return;
        }
        // Apply the REAL pricing strip — same algorithm and same strip set as production
        let result: any = JSON.parse(JSON.stringify(view)); // deep copy before in-place mutation
        if (req.authenticatedUserRole === "field_tech") {
          realPricingStripInPlace(result);
        }
        res.json(result);
      },
    );

    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await cleanupMain();
  });

  it("200 — returns full WetCheckBillingView for the seeded WC-backed billing sheet", async () => {
    role = "billing_manager";
    const r = await fetch(`${base}/api/billing-sheets/${T.bsId}/wet-check-view`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    assert.equal(body.billingSheetId, T.bsId);
    assert.equal(body.billingNumber, "BS-WC-TEST-77001");
    assert.equal(body.zones.length, 2);
    assert.equal(body.zones[0].zoneLabel, "A-1");
    assert.equal(body.zones[1].zoneLabel, "B-2");
    assert.ok(parseFloat(body.grandTotal) > 0, "grandTotal must be positive");
  });

  it("404 — non-existent billing sheet ID returns Not Found", async () => {
    role = "billing_manager";
    const r = await fetch(`${base}/api/billing-sheets/99997/wet-check-view`);
    assert.equal(r.status, 404);
  });

  // Pricing visibility — tested against the REAL strip set and REAL storage output
  it("field_tech — laborRate, partsSubtotal, laborSubtotal are stripped (in PRICING_FIELDS_TO_STRIP)", async () => {
    role = "field_tech";
    const r = await fetch(`${base}/api/billing-sheets/${T.bsId}/wet-check-view`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    // These are explicitly in PRICING_FIELDS_TO_STRIP (billingSheets group)
    assert.equal(body.laborRate, undefined,     "laborRate must be stripped for field_tech");
    assert.equal(body.partsSubtotal, undefined, "partsSubtotal must be stripped for field_tech");
    assert.equal(body.laborSubtotal, undefined, "laborSubtotal must be stripped for field_tech");
  });

  it("field_tech — unitPrice and laborTotal are stripped (in PRICING_FIELDS_TO_STRIP via billingSheetItems/invoiceItems groups)", async () => {
    // PRICING_FIELDS_TO_STRIP includes 'unitPrice' (from billingSheetItems) and
    // 'laborTotal' (from invoiceItems). The recursive strip removes them from
    // lineItems regardless of nesting depth.
    role = "field_tech";
    const r = await fetch(`${base}/api/billing-sheets/${T.bsId}/wet-check-view`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    const zone = body.zones[0];
    assert.ok(zone, "zones[0] must be present");
    assert.ok(zone.lineItems.length > 0, "lineItems must be non-empty");
    assert.equal(zone.lineItems[0].unitPrice, undefined,  "unitPrice must be stripped for field_tech (billingSheetItems group)");
    assert.equal(zone.lineItems[0].laborTotal, undefined, "laborTotal must be stripped for field_tech (invoiceItems group)");
  });

  it("field_tech — grandTotal, zoneTotal, lineTotal, partsTotal, repairLaborHours are preserved", async () => {
    // These field names are NOT in PRICING_FIELDS_TO_STRIP so the recursive
    // strip leaves them intact. field_tech can see their own work totals —
    // only the contract rate and its named duplicate subtotals are stripped.
    role = "field_tech";
    const r = await fetch(`${base}/api/billing-sheets/${T.bsId}/wet-check-view`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as any;
    assert.ok(body.grandTotal !== undefined,                          "grandTotal must be preserved for field_tech");
    const zone = body.zones[0];
    assert.ok(zone.zoneTotal !== undefined,                           "zoneTotal must be preserved");
    assert.ok(zone.zonePartsSubtotal !== undefined,                   "zonePartsSubtotal must be preserved");
    assert.ok(zone.zoneLaborSubtotal !== undefined,                   "zoneLaborSubtotal must be preserved");
    assert.ok(zone.repairLaborHours !== undefined,                    "repairLaborHours must be preserved");
    assert.ok(zone.lineItems[0].lineTotal !== undefined,              "lineTotal must be preserved");
    assert.ok(zone.lineItems[0].partsTotal !== undefined,             "partsTotal must be preserved");
  });

  it("non-field_tech roles receive the full response including all pricing fields", async () => {
    for (const r of ["billing_manager", "company_admin", "irrigation_manager"]) {
      role = r;
      const res = await fetch(`${base}/api/billing-sheets/${T.bsId}/wet-check-view`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.ok(body.laborRate !== undefined,     `${r} must receive laborRate`);
      assert.ok(body.partsSubtotal !== undefined, `${r} must receive partsSubtotal`);
      assert.ok(body.laborSubtotal !== undefined, `${r} must receive laborSubtotal`);
      assert.ok(body.zones[0]?.lineItems[0]?.unitPrice !== undefined,  `${r} must receive unitPrice`);
      assert.ok(body.zones[0]?.lineItems[0]?.laborTotal !== undefined, `${r} must receive laborTotal`);
    }
  });
});

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE_URL = "http://localhost:5000";
const HEADERS = {
  "Content-Type": "application/json",
  "x-user-id": "53",
  "x-user-role": "company_admin",
  "x-user-company-id": "99",
};

const { db } = await import("../server/db.ts");
const { billingSheets, billingSheetItems, wetCheckFindings, wetChecks } =
  await import("../shared/schema.ts");
const { eq } = await import("drizzle-orm");

async function api(method, path, body) {
  const opts = { method, headers: { ...HEADERS } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const LABOR_RATE = 60;
const PART_PRICE = 25;
const QTY = 2;
const HOURS = 0.75;
const LINE_TOTAL = PART_PRICE * QTY + HOURS * LABOR_RATE; // 50 + 45 = 95

async function createCustomer(label) {
  const res = await api("POST", "/api/customers", {
    companyId: 99,
    name: `WC AutoBill ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email: `wcab-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    address: "1 AutoBill Ln",
    laborRate: LABOR_RATE.toFixed(2),
    totalControllers: 1,
  });
  assert.equal(res.status, 201, `customer create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function createPart() {
  const sku = `WC-AB-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const res = await api("POST", "/api/parts", {
    companyId: 99,
    name: "AutoBill Test Head",
    sku,
    price: PART_PRICE.toFixed(2),
    cost: "5.00",
    category: "Head",
  });
  assert.ok(res.status === 200 || res.status === 201, `part create: ${res.status}`);
  return res.body.id;
}

async function createWetCheck(customerId) {
  const res = await api("POST", "/api/wet-checks", { customerId, clientId: randomUUID() });
  assert.ok(res.status === 200 || res.status === 201, `wc create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function addZone(wetCheckId, zoneNumber, status = "checked_with_issues") {
  const res = await api("POST", `/api/wet-checks/${wetCheckId}/zone-records`, {
    controllerLetter: "A",
    zoneNumber,
    status,
    ranSuccessfully: status === "checked_ok",
    clientId: randomUUID(),
  });
  assert.equal(res.status, 201, `zone create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function addFinding(zoneRecordId, partId, opts = {}) {
  const res = await api("POST", `/api/wet-checks/zone-records/${zoneRecordId}/findings`, {
    issueType: "head_replacement",
    partId,
    quantity: QTY,
    laborHours: HOURS.toFixed(2),
    repairedInField: !!opts.repairedInField,
    clientId: randomUUID(),
  });
  assert.equal(res.status, 201, `finding create: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

describe("Slice 3 — Tech-driven auto-billing on submit", () => {
  test("All-complete wet check auto-bills and skips manager queue", async () => {
    const customerId = await createCustomer("all-complete");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const z2 = await addZone(wcId, 2);
    await addFinding(z1, partId, { repairedInField: true });
    await addFinding(z2, partId, { repairedInField: true });

    // Preview should pre-compute exactly what submit will persist.
    const preview = await api("POST", `/api/wet-checks/${wcId}/submit-preview`, {});
    assert.equal(preview.status, 200, `preview: ${JSON.stringify(preview.body)}`);
    assert.equal(preview.body.autoBilledCount, 2);
    assert.equal(preview.body.pendingCount, 0);
    assert.ok(Math.abs(parseFloat(preview.body.autoBilledGrandTotal) - LINE_TOTAL * 2) < 0.01,
      `preview total: ${preview.body.autoBilledGrandTotal}`);

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(submit.status, 200, `submit: ${JSON.stringify(submit.body)}`);
    assert.equal(submit.body.status, "converted",
      "all-complete wet check must end in 'converted' so it skips the manager queue");
    assert.equal(submit.body.autoBilledCount, 2);
    assert.equal(submit.body.pendingCount, 0);
    assert.ok(submit.body.billingSheetId, "billing sheet must be created");
    assert.ok(submit.body.fullyConvertedAt, "fullyConvertedAt must be stamped");

    // Billing sheet shape: snapshot rate + totals match the same formula
    // convertWetCheck uses (partPrice*qty + laborHours*customerLaborRate).
    const bsId = submit.body.billingSheetId;
    const [bs] = await db.select().from(billingSheets).where(eq(billingSheets.id, bsId));
    assert.ok(bs, "billing sheet row exists");
    assert.ok(Math.abs(parseFloat(bs.appliedLaborRate) - LABOR_RATE) < 0.01,
      `appliedLaborRate snapshot: ${bs.appliedLaborRate}`);
    assert.ok(Math.abs(parseFloat(bs.totalAmount) - LINE_TOTAL * 2) < 0.01,
      `bs totalAmount: ${bs.totalAmount}`);
    const items = await db.select().from(billingSheetItems)
      .where(eq(billingSheetItems.billingSheetId, bsId));
    assert.equal(items.length, 2, "two billing sheet items");

    // Findings stamped with billingSheetId + convertedAt — same shape the
    // manager-driven convert path produces, so downstream consumers see a
    // uniform schema regardless of which path created the bill.
    const findings = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wcId));
    assert.equal(findings.length, 2);
    for (const f of findings) {
      assert.equal(f.billingSheetId, bsId);
      assert.ok(f.convertedAt, "convertedAt must be stamped on auto-billed findings");
    }

    // Should NOT appear in manager pending-review queue.
    const queue = await api("GET", "/api/wet-checks/pending-review");
    assert.equal(queue.status, 200);
    assert.ok(!queue.body.some(r => r.id === wcId),
      `all-complete wet check ${wcId} must not appear in manager queue`);
  });

  test("Mixed wet check ends partially_converted with read-only auto-bill + actionable pending", async () => {
    const customerId = await createCustomer("mixed");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const z2 = await addZone(wcId, 2);
    const fComplete = await addFinding(z1, partId, { repairedInField: true });
    const fPending = await addFinding(z2, partId, { repairedInField: false });

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(submit.status, 200, `submit: ${JSON.stringify(submit.body)}`);
    assert.equal(submit.body.status, "partially_converted",
      "mixed wet check must end in 'partially_converted'");
    assert.equal(submit.body.autoBilledCount, 1);
    assert.equal(submit.body.pendingCount, 1);
    assert.ok(submit.body.billingSheetId);
    assert.equal(submit.body.fullyConvertedAt, null);

    // Auto-billed finding is locked: PATCH to mutate pricing must fail.
    const lockAttempt = await api("PATCH", `/api/wet-checks/findings/${fComplete}`, {
      quantity: 99,
    });
    assert.ok(lockAttempt.status === 400 || lockAttempt.status === 409 || lockAttempt.status === 403,
      `auto-billed finding must be locked, got ${lockAttempt.status}: ${JSON.stringify(lockAttempt.body)}`);

    // Pending finding remains actionable: manager can route it.
    const route = await api("PATCH", `/api/wet-checks/findings/${fPending}/route`, {
      resolution: "documented_only",
    });
    assert.equal(route.status, 200, `route pending: ${JSON.stringify(route.body)}`);

    // Wet check should appear in manager pending-review queue.
    const queue = await api("GET", "/api/wet-checks/pending-review");
    assert.equal(queue.status, 200);
    assert.ok(queue.body.some(r => r.id === wcId),
      `mixed wet check ${wcId} must appear in manager queue`);
  });

  test("All-pending wet check submits to 'submitted' with no billing sheet", async () => {
    const customerId = await createCustomer("all-pending");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    await addFinding(z1, partId, { repairedInField: false });

    const preview = await api("POST", `/api/wet-checks/${wcId}/submit-preview`, {});
    assert.equal(preview.status, 200);
    assert.equal(preview.body.autoBilledCount, 0);
    assert.equal(preview.body.pendingCount, 1);
    assert.equal(parseFloat(preview.body.autoBilledGrandTotal), 0);

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(submit.status, 200);
    assert.equal(submit.body.status, "submitted",
      "all-pending wet check must remain 'submitted' for manager triage");
    assert.equal(submit.body.autoBilledCount, 0);
    assert.equal(submit.body.pendingCount, 1);
    assert.equal(submit.body.billingSheetId, null);
  });

  test("No-findings wet check is marked converted with no billing sheet", async () => {
    const customerId = await createCustomer("no-findings");
    const wcId = await createWetCheck(customerId);
    // One zone checked OK, no issues, no findings.
    await addZone(wcId, 1, "checked_ok");

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(submit.status, 200);
    assert.equal(submit.body.status, "converted",
      "no-findings wet check must skip manager queue");
    assert.equal(submit.body.billingSheetId, null);
    assert.equal(submit.body.autoBilledCount, 0);
    assert.equal(submit.body.pendingCount, 0);
  });

  test("Resubmit is idempotent — no duplicate billing sheet", async () => {
    const customerId = await createCustomer("idempotent");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    await addFinding(z1, partId, { repairedInField: true });

    const first = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(first.status, 200);
    const bsId1 = first.body.billingSheetId;
    assert.ok(bsId1);

    const second = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(second.status, 200);
    assert.equal(second.body.billingSheetId, bsId1, "resubmit must return the same billing sheet id");
    assert.equal(second.body.autoBilledCount, 0, "resubmit must not re-bill");

    // DB-level: still exactly one billing sheet on the wet check.
    const findings = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, wcId));
    const bsIds = new Set(findings.map(f => f.billingSheetId).filter(Boolean));
    assert.equal(bsIds.size, 1, `expected exactly one BS, got ${[...bsIds]}`);
  });

  test("Manager convert after auto-bill: routes only pending findings into the same billing sheet", async () => {
    const customerId = await createCustomer("convert-after-autobill");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const z2 = await addZone(wcId, 2);
    await addFinding(z1, partId, { repairedInField: true });
    const fPending = await addFinding(z2, partId, { repairedInField: false });

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(submit.status, 200);
    const autoBilledBs = submit.body.billingSheetId;
    assert.ok(autoBilledBs);
    assert.equal(submit.body.status, "partially_converted");

    // Manager routes the remaining finding to repaired_in_field, then
    // converts. The conversion must reuse the same billing sheet (one
    // BS per wet-check invariant) and append to it.
    const route = await api("PATCH", `/api/wet-checks/findings/${fPending}/route`, {
      resolution: "repaired_in_field",
    });
    assert.equal(route.status, 200, `route: ${JSON.stringify(route.body)}`);

    const convert = await api("POST", `/api/wet-checks/${wcId}/convert`, {});
    assert.equal(convert.status, 200, `convert: ${JSON.stringify(convert.body)}`);
    assert.equal(convert.body.billingSheetId, autoBilledBs,
      "convert must reuse the auto-billed sheet, not create a new one");
    assert.equal(convert.body.wetCheck.status, "converted");

    // Sheet now totals 2 lines worth.
    const items = await db.select().from(billingSheetItems)
      .where(eq(billingSheetItems.billingSheetId, autoBilledBs));
    assert.equal(items.length, 2, "two items on the shared billing sheet");
    const [bs] = await db.select().from(billingSheets).where(eq(billingSheets.id, autoBilledBs));
    assert.ok(Math.abs(parseFloat(bs.totalAmount) - LINE_TOTAL * 2) < 0.01,
      `total after convert: ${bs.totalAmount}`);
  });

  test("Submit-preview matches submit field-for-field (parity)", async () => {
    const customerId = await createCustomer("preview-parity");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const z2 = await addZone(wcId, 2);
    const z3 = await addZone(wcId, 3);
    await addFinding(z1, partId, { repairedInField: true });
    await addFinding(z2, partId, { repairedInField: true });
    await addFinding(z3, partId, { repairedInField: false }); // pending

    const preview = await api("POST", `/api/wet-checks/${wcId}/submit-preview`, {});
    assert.equal(preview.status, 200, `preview: ${JSON.stringify(preview.body)}`);
    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.equal(submit.status, 200, `submit: ${JSON.stringify(submit.body)}`);

    // Counts the preview promised must match what submit actually wrote.
    assert.equal(preview.body.autoBilledCount, submit.body.autoBilledCount,
      "autoBilledCount parity");
    assert.equal(preview.body.pendingCount, submit.body.pendingCount,
      "pendingCount parity");

    // Pricing the preview promised must match the persisted billing sheet
    // totals (parts + labor → grand total) to the cent.
    const bsId = submit.body.billingSheetId;
    assert.ok(bsId, "submit must produce a billing sheet for repaired findings");
    const [bs] = await db.select().from(billingSheets).where(eq(billingSheets.id, bsId));
    assert.ok(Math.abs(parseFloat(preview.body.autoBilledPartsTotal) - parseFloat(bs.partsSubtotal)) < 0.01,
      `parts parity: preview ${preview.body.autoBilledPartsTotal} vs persisted ${bs.partsSubtotal}`);
    assert.ok(Math.abs(parseFloat(preview.body.autoBilledLaborTotal) - parseFloat(bs.laborSubtotal)) < 0.01,
      `labor parity: preview ${preview.body.autoBilledLaborTotal} vs persisted ${bs.laborSubtotal}`);
    assert.ok(Math.abs(parseFloat(preview.body.autoBilledGrandTotal) - parseFloat(bs.totalAmount)) < 0.01,
      `total parity: preview ${preview.body.autoBilledGrandTotal} vs persisted ${bs.totalAmount}`);

    // autoBillEnabled flag is surfaced for UI gating.
    assert.equal(preview.body.autoBillEnabled, true,
      "preview must surface the auto-bill feature flag for UI gating");
  });

  test("Auto-bill failure rolls back the entire submit transaction", async () => {
    const customerId = await createCustomer("rollback");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const fId = await addFinding(z1, partId, { repairedInField: true });

    // Poison the finding with a partPrice * quantity that will overflow
    // billingSheetItems.totalPrice (decimal(10,2) maxes at 99,999,999.99).
    // The auto-bill INSERT must throw, which must roll back the entire
    // submit transaction — no billing sheet, finding untouched, wet
    // check still in_progress.
    await db.update(wetCheckFindings)
      .set({ partPrice: "99999999.99", quantity: 100 })
      .where(eq(wetCheckFindings.id, fId));

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.ok(submit.status >= 400 && submit.status < 600,
      `corrupt submit must fail, got ${submit.status}: ${JSON.stringify(submit.body)}`);

    // Wet check status must remain in_progress (no partial commit).
    const [wcAfter] = await db.select().from(wetChecks).where(eq(wetChecks.id, wcId));
    assert.equal(wcAfter.status, "in_progress",
      "rollback must leave wet check in 'in_progress'");
    assert.equal(wcAfter.submittedAt, null, "no submittedAt stamp on rollback");

    // Finding must NOT have been stamped with a billing sheet or converted.
    const [fAfter] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, fId));
    assert.equal(fAfter.billingSheetId, null, "finding must not link to any billing sheet");
    assert.equal(fAfter.convertedAt, null, "finding must not be marked converted");

    // No orphan billing sheet was created for this customer.
    const sheets = await db.select().from(billingSheets)
      .where(eq(billingSheets.customerId, customerId));
    assert.equal(sheets.length, 0,
      `no billing sheet should exist for rolled-back submit, got ${sheets.length}`);
  });

  // Slice 3 acceptance — submit must roll back if any repaired_in_field
  // finding is missing its required billing inputs (here: no partId).
  // Spec calls this out explicitly — the auto-bill path must validate
  // before writing so the whole submit transaction fails atomically:
  // no billing sheet, no items, no convertedAt stamps, wet check stays
  // in_progress.
  test("Submit rolls back when a complete finding is missing a part", async () => {
    const customerId = await createCustomer("missing-part");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const fOk = await addFinding(z1, partId, { repairedInField: true });
    // Add a second "complete" finding and strip its partId via direct
    // DB update so it slips past the create-time validation but trips
    // the submit-time auto-bill guard.
    const z2 = await addZone(wcId, 2);
    const fBad = await addFinding(z2, partId, { repairedInField: true });
    await db.update(wetCheckFindings)
      .set({ partId: null, partName: null, partPrice: null })
      .where(eq(wetCheckFindings.id, fBad));

    const submit = await api("POST", `/api/wet-checks/${wcId}/submit`, {});
    assert.ok(submit.status >= 400 && submit.status < 600,
      `submit must fail when a complete finding has no part, got ${submit.status}: ${JSON.stringify(submit.body)}`);

    const [wcAfter] = await db.select().from(wetChecks).where(eq(wetChecks.id, wcId));
    assert.equal(wcAfter.status, "in_progress", "rollback must leave wet check in_progress");
    assert.equal(wcAfter.submittedAt, null, "no submittedAt stamp on rollback");

    const sheets = await db.select().from(billingSheets)
      .where(eq(billingSheets.customerId, customerId));
    assert.equal(sheets.length, 0, "no billing sheet created on validation failure");

    for (const fid of [fOk, fBad]) {
      const [f] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, fid));
      assert.equal(f.billingSheetId, null, `finding ${fid} must not be linked to any BS`);
      assert.equal(f.convertedAt, null, `finding ${fid} must not be stamped converted`);
    }
  });

  // Slice 3 acceptance — flag-off restores Slice 2 behavior verbatim.
  // The HTTP server reads WET_CHECK_AUTO_BILL once at boot, so we exercise
  // submitWetCheck through the storage layer directly with the env var
  // toggled off. This proves: no auto-bill happens, status stays
  // 'submitted' even with everything marked complete (no skip-the-queue),
  // and findings remain unconverted for the manager to handle.
  test("Flag OFF restores Slice 2 submit behavior (no auto-bill, status='submitted')", async () => {
    const customerId = await createCustomer("flag-off");
    const partId = await createPart();
    const wcId = await createWetCheck(customerId);
    const z1 = await addZone(wcId, 1);
    const fId = await addFinding(z1, partId, { repairedInField: true });

    const prev = process.env.WET_CHECK_AUTO_BILL;
    process.env.WET_CHECK_AUTO_BILL = "false";
    try {
      const { storage } = await import("../server/storage.ts");
      const result = await storage.submitWetCheck(wcId, 99);
      assert.equal(result.wetCheck.status, "submitted",
        "flag-off submit must always land in 'submitted' (Slice 2 parity)");
      assert.equal(result.billingSheetId, null, "no billing sheet when flag is off");
      assert.equal(result.autoBilledCount, 0,
        "flag-off must not auto-bill any findings");
    } finally {
      if (prev === undefined) delete process.env.WET_CHECK_AUTO_BILL;
      else process.env.WET_CHECK_AUTO_BILL = prev;
    }

    // Finding must remain unconverted with no billing sheet link.
    const [fAfter] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, fId));
    assert.equal(fAfter.billingSheetId, null, "flag-off must not stamp billingSheetId");
    assert.equal(fAfter.convertedAt, null, "flag-off must not stamp convertedAt");

    // No billing sheet was created for this customer at all.
    const sheets = await db.select().from(billingSheets)
      .where(eq(billingSheets.customerId, customerId));
    assert.equal(sheets.length, 0, "flag-off must not create any billing sheet");
  });
});

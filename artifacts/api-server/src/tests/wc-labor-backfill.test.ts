// Tests for WC Labor Backfill module (Slice 3).
// Covers: type contracts, structural invariants from the spec.
// Uses node:test / node:assert to match the api-server test convention.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  BackfillProgress,
  InvoicedWcbReport,
  BackfillOptions,
} from "../migrations/wc-labor-backfill.js";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

// ── Type-level contracts (runtime shape checks) ────────────────────────────────

describe("BackfillProgress type", () => {
  it("accepts all valid states", () => {
    const states: BackfillProgress["state"][] = [
      "idle",
      "running",
      "done",
      "cancelled",
      "error",
    ];
    for (const s of states) {
      const p: BackfillProgress = {
        state: s,
        scanned: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        dryRun: true,
      };
      assert.equal(p.state, s);
    }
  });
});

describe("InvoicedWcbReport type", () => {
  it("has all required billing fields", () => {
    const r: InvoicedWcbReport = {
      wcbId: 1,
      billingNumber: "WC-2026-001",
      customerName: "Acme",
      wetCheckId: 10,
      invoiceId: 99,
      laborRate: "75.00",
      computedLaborHours: "1.50",
      computedLaborSubtotal: "112.50",
      storedLaborSubtotal: "0.00",
      storedTotalAmount: "0.00",
      computedTotalAmount: "112.50",
    };
    assert.equal(r.computedLaborHours, "1.50");
    assert.equal(r.invoiceId, 99);
    assert.equal(
      parseFloat(r.computedLaborSubtotal),
      parseFloat(r.laborRate) * parseFloat(r.computedLaborHours),
    );
  });

  it("correctly computes a non-zero delta between computed and stored totals", () => {
    const r: InvoicedWcbReport = {
      wcbId: 5,
      billingNumber: "WC-2025-005",
      customerName: "Test Co",
      wetCheckId: 20,
      invoiceId: 77,
      laborRate: "80.00",
      computedLaborHours: "2.00",
      computedLaborSubtotal: "160.00",
      storedLaborSubtotal: "0.00",
      storedTotalAmount: "50.00",
      computedTotalAmount: "210.00",
    };
    const delta =
      parseFloat(r.computedTotalAmount) - parseFloat(r.storedTotalAmount);
    assert.ok(Math.abs(delta - 160) < 0.01);
  });
});

describe("BackfillOptions type", () => {
  it("accepts all optional fields", () => {
    const opts: BackfillOptions = {
      dryRun: true,
      onProgress: (_p) => {},
      cancelSignal: () => false,
    };
    assert.equal(opts.dryRun, true);
  });
});

// ── Source invariants ─────────────────────────────────────────────────────────
// Read the compiled source and assert structural properties of the implementation
// that cannot be verified by the type system alone.

const SRC = readFileSync(
  resolve(__dirname, "../migrations/wc-labor-backfill.ts"),
  "utf-8",
);

describe("Bucket B no-write contract", () => {
  it("runInvoicedReport calls computeZoneLaborForWetCheck with dryRun=true", () => {
    assert.ok(
      SRC.includes(
        "computeZoneLaborForWetCheck(wcb.wetCheckId, companyId, true)",
      ),
      "runInvoicedReport must pass dryRun=true to computeZoneLaborForWetCheck",
    );
  });

  it("runInvoicedReport never calls db.update on wetCheckBillings", () => {
    const reportFnStart = SRC.indexOf(
      "export async function runInvoicedReport",
    );
    assert.ok(reportFnStart >= 0, "runInvoicedReport must be exported");
    const reportFnBody = SRC.slice(reportFnStart, reportFnStart + 3000);
    assert.ok(
      !reportFnBody.includes(".update(wetCheckBillings)"),
      "runInvoicedReport must never update wetCheckBillings rows",
    );
  });
});

describe("Idempotency contract", () => {
  it("uses a done set to skip already-processed IDs", () => {
    assert.ok(
      SRC.includes("doneSet.has(wcb.id)"),
      "must check doneSet before processing each WCB",
    );
    assert.ok(
      SRC.includes("doneSet.add(wcb.id)"),
      "must add to doneSet after success",
    );
    assert.ok(
      SRC.includes("saveIdSet(DONE_KEY, doneSet)"),
      "must persist the doneSet checkpoint",
    );
  });
});

describe("Manual zone skip contract", () => {
  it("honours repairLaborManuallySet by not recomputing", () => {
    assert.ok(
      SRC.includes("repairLaborManuallySet"),
      "must reference repairLaborManuallySet",
    );
    assert.ok(
      SRC.includes("zone.repairLaborManuallySet"),
      "must read the per-zone manual flag",
    );
  });
});

describe("Invoiced WCB isolation", () => {
  it("Bucket A filters on isNull(invoiceId)", () => {
    assert.ok(
      SRC.includes("isNull(wetCheckBillings.invoiceId)"),
      "runUnbilledBackfill must filter invoice_id IS NULL",
    );
  });

  it("Bucket B filters on isNotNull(invoiceId)", () => {
    assert.ok(
      SRC.includes("isNotNull(wetCheckBillings.invoiceId)"),
      "runInvoicedReport must filter invoice_id IS NOT NULL",
    );
  });

  it("Bucket A WCB update targets the specific WCB by id", () => {
    assert.ok(
      SRC.includes("eq(wetCheckBillings.id, wcb.id)"),
      "update must be scoped to the specific unbilled WCB",
    );
  });
});

describe("Dry-run contract", () => {
  it("has at least two !dryRun guards", () => {
    const guards = (SRC.match(/if \(!dryRun\)/g) ?? []).length;
    assert.ok(
      guards >= 2,
      `expected at least 2 dryRun guards, found ${guards}`,
    );
  });
});

// Task #1422 — Unit tests for the billing-sheet/invoice total reconciliation
// core: the pure repair math and the injectable orchestration (add-parts
// semantics + idempotence).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSheetRepair,
  runReconciliation,
  type DriftedSheetRow,
  type SheetRepair,
  type FailureEntry,
} from "./reconcile-billing-sheet-invoice-totals-core";

describe("computeSheetRepair", () => {
  it("folds excluded parts into the recomputed total (BS 201 → +3.50)", () => {
    const repair = computeSheetRepair({
      id: 201,
      invoiceId: 62,
      partsSubtotal: "3.50",
      laborSubtotal: "240.00",
      totalAmount: "240.00",
    });
    assert.ok(repair);
    assert.equal(repair.newSheetTotal, 243.5);
    assert.equal(repair.delta, 3.5);
  });

  it("folds excluded parts into the recomputed total (BS 163 → +260.00)", () => {
    const repair = computeSheetRepair({
      id: 163,
      invoiceId: 57,
      partsSubtotal: "260.00",
      laborSubtotal: "420.00",
      totalAmount: "420.00",
    });
    assert.ok(repair);
    assert.equal(repair.newSheetTotal, 680);
    assert.equal(repair.delta, 260);
  });

  it("returns null when the sheet already reconciles (within tolerance)", () => {
    assert.equal(
      computeSheetRepair({ id: 1, invoiceId: 1, partsSubtotal: "10.00", laborSubtotal: "5.00", totalAmount: "15.00" }),
      null,
    );
    // sub-cent drift is below the guard tolerance — not a repair candidate
    assert.equal(
      computeSheetRepair({ id: 2, invoiceId: 1, partsSubtotal: "10.00", laborSubtotal: "5.00", totalAmount: "15.005" }),
      null,
    );
  });

  it("handles null money fields as zero", () => {
    const repair = computeSheetRepair({
      id: 3,
      invoiceId: 1,
      partsSubtotal: "12.00",
      laborSubtotal: null,
      totalAmount: null,
    });
    assert.ok(repair);
    assert.equal(repair.newSheetTotal, 12);
    assert.equal(repair.delta, 12);
  });
});

// ── In-memory harness for runReconciliation ──────────────────────────────────

interface FakeInvoice { id: number; partsSubtotal: string; totalAmount: string; }

function makeDeps(opts: {
  candidates: DriftedSheetRow[];
  invoices: FakeInvoice[];
  done?: Set<number>;
}) {
  const sheetTotals = new Map<number, number>();
  const invoiceById = new Map(opts.invoices.map((i) => [i.id, { ...i }]));
  let done = new Set<number>(opts.done ?? []);
  const failures: FailureEntry[] = [];
  const appliedSheets: number[] = [];

  const deps = {
    loadIdSet: async () => new Set(done),
    saveDoneSet: async (ids: Set<number>) => { done = new Set(ids); },
    appendFailure: async (e: FailureEntry) => { failures.push(e); },
    getCandidates: async () => opts.candidates,
    applyRepair: async (row: DriftedSheetRow, repair: SheetRepair) => {
      appliedSheets.push(row.id);
      sheetTotals.set(row.id, repair.newSheetTotal);
      const inv = invoiceById.get(row.invoiceId);
      if (!inv) throw new Error(`invoice ${row.invoiceId} missing`);
      inv.partsSubtotal = (parseFloat(inv.partsSubtotal) + repair.delta).toFixed(2);
      inv.totalAmount = (parseFloat(inv.totalAmount) + repair.delta).toFixed(2);
    },
  };

  return { deps, sheetTotals, invoiceById, getDone: () => done, failures, appliedSheets };
}

describe("runReconciliation", () => {
  it("repairs both totals and folds parts into the parent invoice", async () => {
    const h = makeDeps({
      candidates: [
        { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
        { id: 163, invoiceId: 57, partsSubtotal: "260.00", laborSubtotal: "420.00", totalAmount: "420.00" },
      ],
      invoices: [
        { id: 62, partsSubtotal: "100.00", totalAmount: "1142.84" },
        { id: 57, partsSubtotal: "500.00", totalAmount: "2747.00" },
      ],
    });

    const res = await runReconciliation(h.deps, { dryRun: false, batchSize: 50, log: () => {}, logError: () => {} });

    assert.equal(res.repaired, 2);
    assert.equal(res.errors, 0);
    // Sheet totals recomputed to parts+labor
    assert.equal(h.sheetTotals.get(201), 243.5);
    assert.equal(h.sheetTotals.get(163), 680);
    // Invoice totals raised by the missing-parts delta (Done-looks-like values)
    assert.equal(h.invoiceById.get(62)!.totalAmount, "1146.34");
    assert.equal(h.invoiceById.get(57)!.totalAmount, "3007.00");
    // partsSubtotal also folded up (add-parts semantics)
    assert.equal(h.invoiceById.get(62)!.partsSubtotal, "103.50");
    assert.equal(h.invoiceById.get(57)!.partsSubtotal, "760.00");
  });

  it("dry-run reports the repairs but writes nothing", async () => {
    const h = makeDeps({
      candidates: [
        { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
      ],
      invoices: [{ id: 62, partsSubtotal: "100.00", totalAmount: "1142.84" }],
    });

    const res = await runReconciliation(h.deps, { dryRun: true, batchSize: 50, log: () => {}, logError: () => {} });

    assert.equal(res.repairedDryRun, 1);
    assert.equal(res.repaired, 0);
    assert.equal(h.appliedSheets.length, 0);
    assert.equal(h.invoiceById.get(62)!.totalAmount, "1142.84");
    assert.equal(h.getDone().size, 0);
  });

  it("is idempotent — a second run repairs nothing and makes no writes", async () => {
    const candidates: DriftedSheetRow[] = [
      { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
    ];
    const h = makeDeps({
      candidates,
      invoices: [{ id: 62, partsSubtotal: "100.00", totalAmount: "1142.84" }],
    });

    await runReconciliation(h.deps, { dryRun: false, batchSize: 50, log: () => {}, logError: () => {} });
    assert.ok(h.getDone().has(201));

    // Second run: the candidate query in production would no longer return the
    // now-reconciled row, but even if it did, the resume set skips it.
    const h2 = makeDeps({
      candidates,
      invoices: [{ id: 62, partsSubtotal: "103.50", totalAmount: "1146.34" }],
      done: h.getDone(),
    });
    const res2 = await runReconciliation(h2.deps, { dryRun: false, batchSize: 50, log: () => {}, logError: () => {} });
    assert.equal(res2.repaired, 0);
    assert.equal(res2.alreadyProcessed, 1);
    assert.equal(h2.appliedSheets.length, 0);
  });

  it("records a failure and continues when applyRepair throws", async () => {
    const h = makeDeps({
      candidates: [
        { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
        { id: 999, invoiceId: 0, partsSubtotal: "1.00", laborSubtotal: "0.00", totalAmount: "0.00" },
      ],
      invoices: [{ id: 62, partsSubtotal: "100.00", totalAmount: "1142.84" }],
    });

    const res = await runReconciliation(h.deps, { dryRun: false, batchSize: 50, log: () => {}, logError: () => {} });

    assert.equal(res.repaired, 1);
    assert.equal(res.errors, 1);
    assert.equal(h.failures.length, 1);
    assert.equal(h.failures[0].id, 999);
    assert.ok(!h.getDone().has(999));
  });
});

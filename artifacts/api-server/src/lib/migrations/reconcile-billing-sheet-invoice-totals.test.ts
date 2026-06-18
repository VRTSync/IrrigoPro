// Task #1434 — Tests for the admin migration wrapper around the billing-sheet /
// invoice total reconcile core.
//
// The reconcile math + DB orchestration are covered by the core's own tests
// (scripts/reconcile-billing-sheet-invoice-totals.test.ts). These tests cover
// the migration adapter: the pure preview mapping (buildReconcilePreview) and
// the deps-injectable runner (runReconcileMigration) — both exercised with
// in-memory data so no shared dev-DB seeding is required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReconcilePreview,
  runReconcileMigration,
} from "./reconcile-billing-sheet-invoice-totals";
import type {
  DriftedSheetRow,
  SheetRepair,
  FailureEntry,
  ReconciliationDeps,
} from "../../scripts/reconcile-billing-sheet-invoice-totals-core";

// ── buildReconcilePreview (pure, no DB) ──────────────────────────────────────

describe("buildReconcilePreview", () => {
  it("returns the correct drift list, deltas, and post-repair invoice totals", () => {
    const candidates: DriftedSheetRow[] = [
      { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
      { id: 163, invoiceId: 57, partsSubtotal: "260.00", laborSubtotal: "420.00", totalAmount: "420.00" },
    ];
    const invoiceTotals = new Map<number, number>([
      [62, 1142.84],
      [57, 2747.0],
    ]);

    const preview = buildReconcilePreview(candidates, invoiceTotals);

    assert.equal(preview.steps.length, 2);
    assert.equal(preview.steps[0].id, "sheet_201");
    assert.equal(preview.steps[1].id, "sheet_163");
    // delta + new sheet total appear in the per-sheet description
    assert.match(preview.steps[0].description, /delta \+\$3\.50/);
    assert.match(preview.steps[0].description, /Invoice total \$1142\.84 → \$1146\.34/);
    assert.match(preview.steps[1].description, /delta \+\$260\.00/);
    assert.match(preview.steps[1].description, /Invoice total \$2747\.00 → \$3007\.00/);

    // ack gate = number of invoices that will change total
    assert.equal(preview.orphanRows.invoicesAffected, 2);

    // summary + money-change warning present
    assert.ok(preview.warnings.some((w) => /2 billing sheet\(s\) · 2 invoice\(s\) · total \+\$263\.50/.test(w)));
    assert.ok(preview.warnings.some((w) => /billed MORE/.test(w)));
  });

  it("collapses multiple sheets on the same invoice into one ack count", () => {
    const candidates: DriftedSheetRow[] = [
      { id: 1, invoiceId: 99, partsSubtotal: "10.00", laborSubtotal: "0.00", totalAmount: "0.00" },
      { id: 2, invoiceId: 99, partsSubtotal: "5.00", laborSubtotal: "0.00", totalAmount: "0.00" },
    ];
    const preview = buildReconcilePreview(candidates, new Map([[99, 100]]));
    assert.equal(preview.steps.length, 2);
    assert.equal(preview.orphanRows.invoicesAffected, 1);
  });

  it("a non-drifting dataset yields 0 steps and 0 ack count", () => {
    const candidates: DriftedSheetRow[] = [
      { id: 5, invoiceId: 7, partsSubtotal: "10.00", laborSubtotal: "5.00", totalAmount: "15.00" },
    ];
    const preview = buildReconcilePreview(candidates, new Map([[7, 200]]));
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.invoicesAffected, 0);
    assert.ok(preview.warnings.some((w) => /nothing to repair/.test(w)));
  });

  it("an empty candidate set yields 0 steps and 0 ack count", () => {
    const preview = buildReconcilePreview([], new Map());
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.invoicesAffected, 0);
  });
});

// ── runReconcileMigration (in-memory deps) ───────────────────────────────────

interface FakeInvoice { id: number; partsSubtotal: string; totalAmount: string; }

function makeDeps(opts: {
  candidates: DriftedSheetRow[];
  invoices: FakeInvoice[];
  done?: Set<number>;
}) {
  const invoiceById = new Map(opts.invoices.map((i) => [i.id, { ...i }]));
  let done = new Set<number>(opts.done ?? []);
  const failures: FailureEntry[] = [];
  const appliedSheets: number[] = [];

  const deps: ReconciliationDeps = {
    loadIdSet: async () => new Set(done),
    saveDoneSet: async (ids: Set<number>) => { done = new Set(ids); },
    appendFailure: async (e: FailureEntry) => { failures.push(e); },
    getCandidates: async () => opts.candidates,
    applyRepair: async (row: DriftedSheetRow, repair: SheetRepair) => {
      appliedSheets.push(row.id);
      const inv = invoiceById.get(row.invoiceId);
      if (!inv) throw new Error(`invoice ${row.invoiceId} missing`);
      inv.partsSubtotal = (parseFloat(inv.partsSubtotal) + repair.delta).toFixed(2);
      inv.totalAmount = (parseFloat(inv.totalAmount) + repair.delta).toFixed(2);
    },
  };

  return { deps, invoiceById, getDone: () => done, failures, appliedSheets };
}

describe("runReconcileMigration", () => {
  it("emits per-sheet progress, applies via the core, and returns step results + summary", async () => {
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

    const emits: Array<{ step: string; status: string }> = [];
    const results = await runReconcileMigration(h.deps, (e) => emits.push({ step: e.step, status: e.status }));

    // two per-sheet results + one summary
    assert.equal(results.filter((r) => r.id.startsWith("sheet_")).length, 2);
    const summary = results.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary.status, "success");
    assert.equal(summary.rowsAffected, 2);

    // totals reconciled (add-parts semantics)
    assert.equal(h.invoiceById.get(62)!.totalAmount, "1146.34");
    assert.equal(h.invoiceById.get(57)!.totalAmount, "3007.00");

    // emitted running + success per sheet
    assert.ok(emits.some((e) => e.step === "sheet_201" && e.status === "running"));
    assert.ok(emits.some((e) => e.step === "sheet_201" && e.status === "success"));
    assert.ok(emits.some((e) => e.step === "reconcile" && e.status === "success"));
  });

  it("a non-drifting dataset → run reports 0 repaired", async () => {
    const h = makeDeps({
      candidates: [],
      invoices: [],
    });
    const results = await runReconcileMigration(h.deps, () => {});
    assert.equal(h.appliedSheets.length, 0);
    const summary = results.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary.status, "success");
    assert.equal(summary.rowsAffected, 0);
  });

  it("is idempotent — a second run with the done set repairs nothing", async () => {
    const candidates: DriftedSheetRow[] = [
      { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
    ];
    const h = makeDeps({ candidates, invoices: [{ id: 62, partsSubtotal: "100.00", totalAmount: "1142.84" }] });
    await runReconcileMigration(h.deps, () => {});
    assert.ok(h.getDone().has(201));

    const h2 = makeDeps({
      candidates,
      invoices: [{ id: 62, partsSubtotal: "103.50", totalAmount: "1146.34" }],
      done: h.getDone(),
    });
    const results2 = await runReconcileMigration(h2.deps, () => {});
    assert.equal(h2.appliedSheets.length, 0);
    const summary2 = results2.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary2.rowsAffected, 0);
  });

  it("surfaces a partial failure as a failed step and a failed summary", async () => {
    const h = makeDeps({
      candidates: [
        { id: 201, invoiceId: 62, partsSubtotal: "3.50", laborSubtotal: "240.00", totalAmount: "240.00" },
        { id: 999, invoiceId: 0, partsSubtotal: "1.00", laborSubtotal: "0.00", totalAmount: "0.00" },
      ],
      invoices: [{ id: 62, partsSubtotal: "100.00", totalAmount: "1142.84" }],
    });

    const results = await runReconcileMigration(h.deps, () => {});

    const failed = results.find((r) => r.id === "sheet_999")!;
    assert.equal(failed.status, "failed");
    const summary = results.find((r) => r.id === "reconcile_summary")!;
    assert.equal(summary.status, "failed");
    // the good sheet still applied
    assert.equal(h.invoiceById.get(62)!.totalAmount, "1146.34");
    assert.equal(h.failures.length, 1);
    assert.equal(h.failures[0].id, 999);
  });
});

// Task #1752 — Tests for the comprehensive ticket-total drift repair migration.
//
// All tests use in-memory deps — no shared dev-DB seeding required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepairPreview,
  runRepairMigration,
  type DriftedTicket,
  type RepairDeps,
} from "./repair-ticket-total-drift";

// ── In-memory state ──────────────────────────────────────────────────────────

type MutableTicket = {
  tableType: DriftedTicket['tableType'];
  id: number;
  companyId: number;
  partsSubtotal: string;
  laborSubtotal: string;
  totalAmount: string;
  invoiceId: number | null;
};

type MutableInvoice = {
  id: number;
  partsSubtotal: string;
  laborSubtotal: string;
  totalAmount: string;
};

function makeDeps(opts: {
  tickets: MutableTicket[];
  invoices?: MutableInvoice[];
  companyId?: number;
}) {
  const ticketMap = new Map(opts.tickets.map((t) => [`${t.tableType}:${t.id}`, t]));
  const invoiceMap = new Map((opts.invoices ?? []).map((inv) => [inv.id, { ...inv }]));
  let doneCalled = false;
  const repaired: string[] = [];
  const invoicesRecomputed: number[] = [];

  const candidates = opts.companyId != null
    ? opts.tickets.filter((t) => t.companyId === opts.companyId)
    : opts.tickets;

  const deps: RepairDeps = {
    getCandidates: async () => candidates as DriftedTicket[],
    applyTicketRepair: async (ticket, newTotal) => {
      const key = `${ticket.tableType}:${ticket.id}`;
      const t = ticketMap.get(key);
      if (!t) throw new Error(`ticket ${key} not found`);
      t.totalAmount = newTotal;
      repaired.push(key);
    },
    recomputeInvoice: async (invoiceId) => {
      const inv = invoiceMap.get(invoiceId);
      if (!inv) throw new Error(`invoice ${invoiceId} not found`);
      const members = opts.tickets.filter((t) => t.invoiceId === invoiceId);
      const parts = members.reduce((s, t) => s + parseFloat(t.partsSubtotal), 0);
      const labor = members.reduce((s, t) => s + parseFloat(t.laborSubtotal), 0);
      inv.partsSubtotal = parts.toFixed(2);
      inv.laborSubtotal = labor.toFixed(2);
      inv.totalAmount = (parts + labor).toFixed(2);
      invoicesRecomputed.push(invoiceId);
    },
    markDone: async () => { doneCalled = true; },
  };

  return { deps, ticketMap, invoiceMap, repaired, invoicesRecomputed, getDone: () => doneCalled };
}

// ── buildRepairPreview (pure, no DB) ─────────────────────────────────────────

describe("buildRepairPreview", () => {
  it("correct step IDs and descriptions for a drifted un-invoiced billing sheet", () => {
    const candidates: DriftedTicket[] = [
      { tableType: 'billing_sheet', id: 272, companyId: 1, partsSubtotal: "175.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: null },
    ];
    const preview = buildRepairPreview(candidates);
    assert.equal(preview.steps.length, 1);
    assert.equal(preview.steps[0].id, "billing_sheet_272");
    assert.match(preview.steps[0].description, /billing sheet #272/);
    assert.match(preview.steps[0].description, /\$463\.68/);
    assert.match(preview.steps[0].description, /un-invoiced/);
    assert.equal(preview.orphanRows.invoicesAffected, 0);
  });

  it("invoiced drifted sheet shows invoice note and increments invoicesAffected", () => {
    const candidates: DriftedTicket[] = [
      { tableType: 'billing_sheet', id: 273, companyId: 1, partsSubtotal: "100.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: 82027 },
    ];
    const preview = buildRepairPreview(candidates);
    assert.equal(preview.steps.length, 1);
    assert.match(preview.steps[0].description, /invoice #82027/);
    assert.equal(preview.orphanRows.invoicesAffected, 1);
  });

  it("two sheets on the same invoice count as 1 invoicesAffected", () => {
    const candidates: DriftedTicket[] = [
      { tableType: 'billing_sheet', id: 272, companyId: 1, partsSubtotal: "175.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: 82027 },
      { tableType: 'billing_sheet', id: 273, companyId: 1, partsSubtotal: "100.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: 82027 },
    ];
    const preview = buildRepairPreview(candidates);
    assert.equal(preview.orphanRows.invoicesAffected, 1);
    assert.equal(preview.steps.length, 2);
  });

  it("work_order and wet_check_billing candidates produce correct step IDs", () => {
    const candidates: DriftedTicket[] = [
      { tableType: 'work_order', id: 10, companyId: 1, partsSubtotal: "50.00", laborSubtotal: "0.00", totalAmount: "0.00", invoiceId: null },
      { tableType: 'wet_check_billing', id: 20, companyId: 1, partsSubtotal: "25.00", laborSubtotal: "100.00", totalAmount: "100.00", invoiceId: null },
    ];
    const preview = buildRepairPreview(candidates);
    assert.equal(preview.steps.length, 2);
    assert.equal(preview.steps[0].id, "work_order_10");
    assert.equal(preview.steps[1].id, "wet_check_billing_20");
  });

  it("zero-drift dataset yields 0 steps and 'nothing to repair' warning", () => {
    const candidates: DriftedTicket[] = [
      { tableType: 'billing_sheet', id: 1, companyId: 1, partsSubtotal: "10.00", laborSubtotal: "5.00", totalAmount: "15.00", invoiceId: null },
    ];
    const preview = buildRepairPreview(candidates);
    assert.equal(preview.steps.length, 0);
    assert.ok(preview.warnings.some((w) => /nothing to repair/.test(w)));
  });

  it("empty candidate set yields 0 steps", () => {
    const preview = buildRepairPreview([]);
    assert.equal(preview.steps.length, 0);
    assert.equal(preview.orphanRows.invoicesAffected, 0);
  });
});

// ── runRepairMigration — billing sheet (un-invoiced) ─────────────────────────

describe("runRepairMigration — un-invoiced drifted billing sheet", () => {
  it("repairs the sheet total; re-run finds nothing to do", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'billing_sheet', id: 272, companyId: 1, partsSubtotal: "175.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: null },
    ];
    const h = makeDeps({ tickets });

    const results = await runRepairMigration(h.deps, () => {});
    const step = results.find((r) => r.id === "billing_sheet_272")!;
    assert.equal(step.status, "success");

    const sheet = h.ticketMap.get("billing_sheet:272")!;
    assert.equal(sheet.totalAmount, "463.68");
    assert.ok(h.getDone(), "markDone should have been called");

    const emits: string[] = [];
    const h2 = makeDeps({ tickets });
    await runRepairMigration(h2.deps, (e) => emits.push(e.step));
    assert.equal(h2.repaired.length, 0, "re-run should repair nothing");
  });
});

// ── runRepairMigration — invoiced drifted billing sheet ────────────────────────

describe("runRepairMigration — invoiced drifted billing sheet propagates delta", () => {
  it("repairs sheet and recomputes parent invoice total", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'billing_sheet', id: 272, companyId: 1, partsSubtotal: "175.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: 82027 },
      { tableType: 'billing_sheet', id: 273, companyId: 1, partsSubtotal: "100.00", laborSubtotal: "288.68", totalAmount: "288.68", invoiceId: 82027 },
    ];
    const invoices: MutableInvoice[] = [
      { id: 82027, partsSubtotal: "0.00", laborSubtotal: "577.36", totalAmount: "577.36" },
    ];
    const h = makeDeps({ tickets, invoices });

    await runRepairMigration(h.deps, () => {});

    assert.equal(h.ticketMap.get("billing_sheet:272")!.totalAmount, "463.68");
    assert.equal(h.ticketMap.get("billing_sheet:273")!.totalAmount, "388.68");
    assert.ok(h.invoicesRecomputed.includes(82027), "invoice 82027 should be recomputed");
    const inv = h.invoiceMap.get(82027)!;
    assert.equal(inv.totalAmount, "852.36");
  });
});

// ── runRepairMigration — work_order ──────────────────────────────────────────

describe("runRepairMigration — drifted work order", () => {
  it("repairs work order total correctly", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'work_order', id: 55, companyId: 2, partsSubtotal: "200.00", laborSubtotal: "120.00", totalAmount: "120.00", invoiceId: null },
    ];
    const h = makeDeps({ tickets });
    await runRepairMigration(h.deps, () => {});
    assert.equal(h.ticketMap.get("work_order:55")!.totalAmount, "320.00");
  });
});

// ── runRepairMigration — wet_check_billing ────────────────────────────────────

describe("runRepairMigration — drifted wet-check billing", () => {
  it("repairs wet check billing total correctly", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'wet_check_billing', id: 88, companyId: 3, partsSubtotal: "50.00", laborSubtotal: "75.00", totalAmount: "75.00", invoiceId: null },
    ];
    const h = makeDeps({ tickets });
    await runRepairMigration(h.deps, () => {});
    assert.equal(h.ticketMap.get("wet_check_billing:88")!.totalAmount, "125.00");
  });
});

// ── Company isolation ─────────────────────────────────────────────────────────

describe("runRepairMigration — company isolation", () => {
  it("a drifted sheet in company B is not repaired by a company A scan", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'billing_sheet', id: 100, companyId: 1, partsSubtotal: "50.00", laborSubtotal: "0.00", totalAmount: "0.00", invoiceId: null },
      { tableType: 'billing_sheet', id: 200, companyId: 2, partsSubtotal: "80.00", laborSubtotal: "0.00", totalAmount: "0.00", invoiceId: null },
    ];
    const h = makeDeps({ tickets, companyId: 1 });
    await runRepairMigration(h.deps, () => {});
    assert.ok(h.repaired.includes("billing_sheet:100"), "company A sheet should be repaired");
    assert.ok(!h.repaired.includes("billing_sheet:200"), "company B sheet must NOT be touched by a company A scan");
    assert.equal(h.ticketMap.get("billing_sheet:200")!.totalAmount, "0.00", "company B total unchanged");
  });
});

// ── runRepairMigration — idempotent (zero-drift rows skipped) ──────────────────

describe("runRepairMigration — idempotent / skip zero-drift rows", () => {
  it("a zero-drift row is skipped and not counted as a repair", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'billing_sheet', id: 1, companyId: 1, partsSubtotal: "10.00", laborSubtotal: "5.00", totalAmount: "15.00", invoiceId: null },
    ];
    const h = makeDeps({ tickets });
    const results = await runRepairMigration(h.deps, () => {});
    const step = results.find((r) => r.id === "billing_sheet_1")!;
    assert.equal(step.status, "skipped");
    assert.equal(h.repaired.length, 0);
  });
});

// ── runRepairMigration — partial failure ───────────────────────────────────────

describe("runRepairMigration — partial failure", () => {
  it("a failing repair is recorded as failed; other rows still apply", async () => {
    const tickets: MutableTicket[] = [
      { tableType: 'billing_sheet', id: 10, companyId: 1, partsSubtotal: "50.00", laborSubtotal: "0.00", totalAmount: "0.00", invoiceId: null },
      { tableType: 'billing_sheet', id: 999, companyId: 1, partsSubtotal: "1.00", laborSubtotal: "0.00", totalAmount: "0.00", invoiceId: null },
    ];
    const h = makeDeps({ tickets });
    const depsWithBrokenTicket: RepairDeps = {
      ...h.deps,
      applyTicketRepair: async (ticket, newTotal) => {
        if (ticket.id === 999) throw new Error("simulated DB error");
        await h.deps.applyTicketRepair(ticket, newTotal);
      },
    };

    const results = await runRepairMigration(depsWithBrokenTicket, () => {});
    const good = results.find((r) => r.id === "billing_sheet_10")!;
    const bad = results.find((r) => r.id === "billing_sheet_999")!;
    const summary = results.find((r) => r.id === "repair_summary")!;

    assert.equal(good.status, "success");
    assert.equal(bad.status, "failed");
    assert.equal(summary.status, "failed");
    assert.ok(h.repaired.includes("billing_sheet:10"), "the good sheet should still be repaired");
    assert.ok(!h.getDone(), "markDone should NOT be called when there are failures");
  });
});

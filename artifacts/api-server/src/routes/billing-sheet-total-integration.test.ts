// Task #1669 — Behavioral integration tests for billing-sheet total integrity.
//
// These tests mount minimal Express stub handlers that mirror the three
// non-item mutation paths (PATCH, /labor-hours, /rate-mode) and inject
// computeBillingSheetTotal exactly as the production routes and storage methods
// do. They assert on the JSON returned by the handler — not on source text.
//
// Pattern: billing-sheet-technician-lock.test.ts (Task #764).
//
// Slice 4: Each mutation path asserts  totalAmount === partsSubtotal + laborSubtotal
//           in the returned/persisted record for both the bug scenario and the
//           general invariant.
//
// Slice 5: An end-to-end chain test proves that a billing-manager labor edit
//           propagates the correct total to the parent monthly invoice.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { computeBillingSheetTotal } from "../billing-sheet-total";

// ── In-memory data store shared across stubs ──────────────────────────────────

interface StoredBillingSheet {
  id: number;
  customerId: number;
  invoiceId: number | null;
  status: string;
  partsSubtotal: string;
  laborSubtotal: string;
  totalAmount: string;
  totalHours: string;
  laborRate: string;
  appliedLaborRate: string;
  rateMode: string;
}

interface StoredInvoice {
  id: number;
  totalAmount: string;
}

// ── Harness factory ───────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  sheets: Map<number, StoredBillingSheet>;
  invoices: Map<number, StoredInvoice>;
}

async function startHarness(
  sheets: Map<number, StoredBillingSheet>,
  invoices: Map<number, StoredInvoice>,
): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  // ── PATCH /api/billing-sheets/:id ─────────────────────────────────────────
  // Mirrors the production handler in routes.ts: reads the stored record,
  // applies computeBillingSheetTotal with stored-record fallback, writes back.
  // Lock condition: status === "billed". A sheet attached to a draft invoice
  // (invoiceId set, status !== "billed") is still editable — that is the
  // standard billing-manager workflow.
  app.patch("/api/billing-sheets/:id", (req, res) => {
    const id = Number(req.params.id);
    const stored = sheets.get(id);
    if (!stored) { res.status(404).json({ message: "not found" }); return; }
    if (stored.status === "billed") {
      res.status(409).json({ message: "locked" }); return;
    }

    const patch = req.body as Record<string, unknown>;

    // Build the patched record (production: _.merge(stored, patch) equivalent)
    const patched: Record<string, unknown> = { ...stored, ...patch };

    // Apply the shared helper exactly as the PATCH route does.
    const totalAmount = computeBillingSheetTotal(
      {
        partsSubtotal: patched.partsSubtotal as string | null | undefined,
        laborSubtotal: patched.laborSubtotal as string | null | undefined,
      },
      { partsSubtotal: stored.partsSubtotal, laborSubtotal: stored.laborSubtotal },
    );

    const updated: StoredBillingSheet = {
      ...(patched as unknown as StoredBillingSheet),
      totalAmount,
    };
    sheets.set(id, updated);
    res.json(updated);
  });

  // ── PATCH /api/billing-sheets/:id/labor-hours ─────────────────────────────
  // Mirrors updateBillingSheetLaborHours: only totalHours changes; partsSubtotal
  // from the stored record must survive.
  app.patch("/api/billing-sheets/:id/labor-hours", (req, res) => {
    const id = Number(req.params.id);
    const stored = sheets.get(id);
    if (!stored) { res.status(404).json({ message: "not found" }); return; }
    if (stored.status === "billed") {
      res.status(409).json({ message: "locked" }); return;
    }

    const totalHours = parseFloat(String(req.body.totalHours ?? "0")) || 0;
    const laborRate = parseFloat(String(stored.appliedLaborRate ?? stored.laborRate ?? "0")) || 0;
    const laborSubtotal = totalHours * laborRate;

    const totalAmount = computeBillingSheetTotal(
      { laborSubtotal: laborSubtotal.toFixed(2) },
      { partsSubtotal: stored.partsSubtotal },
    );

    const updated: StoredBillingSheet = {
      ...stored,
      totalHours: totalHours.toFixed(2),
      laborSubtotal: laborSubtotal.toFixed(2),
      totalAmount,
    };
    sheets.set(id, updated);
    res.json(updated);
  });

  // ── PATCH /api/billing-sheets/:id/rate-mode ───────────────────────────────
  // Mirrors recomputeBillingSheetTotalsForRateMode: rate changes recompute
  // laborSubtotal; partsSubtotal from stored record must survive.
  app.patch("/api/billing-sheets/:id/rate-mode", (req, res) => {
    const id = Number(req.params.id);
    const stored = sheets.get(id);
    if (!stored) { res.status(404).json({ message: "not found" }); return; }
    if (stored.status === "billed") {
      res.status(409).json({ message: "locked" }); return;
    }

    const mode = req.body.mode as string;
    // Stub: normal rate = "65.00", emergency rate = "97.50"
    const newRate = mode === "emergency" ? 97.5 : 65.0;
    const totalHours = parseFloat(String(stored.totalHours ?? "0")) || 0;
    const laborSubtotal = totalHours * newRate;

    const totalAmount = computeBillingSheetTotal(
      { laborSubtotal: laborSubtotal.toFixed(2) },
      { partsSubtotal: stored.partsSubtotal },
    );

    const updated: StoredBillingSheet = {
      ...stored,
      rateMode: mode,
      laborRate: newRate.toFixed(2),
      appliedLaborRate: newRate.toFixed(2),
      laborSubtotal: laborSubtotal.toFixed(2),
      totalAmount,
    };
    sheets.set(id, updated);
    res.json(updated);
  });

  // ── GET /api/invoices/:id (simulates monthly invoice total read) ───────────
  // The monthly invoice route sums billing-sheet totalAmount values. Stub that
  // collects all BS totals for the given invoice and returns the invoice total.
  app.get("/api/invoices/:id", (req, res) => {
    const invoiceId = Number(req.params.id);
    const inv = invoices.get(invoiceId);
    if (!inv) { res.status(404).json({ message: "not found" }); return; }
    // Sum all billing sheets attached to this invoice.
    let bsTotal = 0;
    for (const sheet of sheets.values()) {
      if (sheet.invoiceId === invoiceId) {
        bsTotal += parseFloat(String(sheet.totalAmount ?? "0")) || 0;
      }
    }
    res.json({ id: invoiceId, totalAmount: bsTotal.toFixed(2) });
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sheets,
    invoices,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve())
    ),
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function patch(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(url);
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

function assertInvariant(sheet: Record<string, unknown>, label: string): void {
  const parts = parseFloat(String(sheet.partsSubtotal ?? "0"));
  const labor = parseFloat(String(sheet.laborSubtotal ?? "0"));
  const total = parseFloat(String(sheet.totalAmount ?? "0"));
  assert.ok(
    Math.abs(total - (parts + labor)) < 0.005,
    `${label}: totalAmount(${total}) !== partsSubtotal(${parts}) + laborSubtotal(${labor})`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slice 4 — Behavioral invariant: each mutation path preserves totalAmount
// ═══════════════════════════════════════════════════════════════════════════════

describe("Slice 4 — PATCH /billing-sheets/:id: totalAmount === parts + labor in returned record", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness(
      new Map([[
        1,
        {
          id: 1, customerId: 10, invoiceId: null, status: "draft",
          partsSubtotal: "481.72", laborSubtotal: "0.00", totalAmount: "481.72",
          totalHours: "0.00", laborRate: "85.00", appliedLaborRate: "85.00",
          rateMode: "standard",
        },
      ]]),
      new Map(),
    );
  });

  afterEach(() => harness.close());

  it("totalHours-only PATCH: returned totalAmount includes stored parts (the bug scenario)", async () => {
    // Before fix this returned $340.00 (parts zeroed). After fix: $821.72.
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/1`, {
      laborSubtotal: "340.00",  // computed from 4h × $85 — no partsSubtotal in body
    });
    assert.equal(status, 200);
    assert.equal(body.partsSubtotal, "481.72", "stored partsSubtotal must survive");
    assert.equal(body.laborSubtotal, "340.00");
    assert.equal(body.totalAmount, "821.72", "totalAmount must be 481.72 + 340.00");
    assertInvariant(body, "totalHours-only PATCH");
  });

  it("partsSubtotal-only PATCH: returned totalAmount includes stored labor", async () => {
    // Set up a sheet that already has labor.
    harness.sheets.set(1, { ...harness.sheets.get(1)!, laborSubtotal: "340.00", totalAmount: "821.72" });
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/1`, {
      partsSubtotal: "600.00",  // no laborSubtotal in body
    });
    assert.equal(status, 200);
    assert.equal(body.laborSubtotal, "340.00", "stored laborSubtotal must survive");
    assert.equal(body.partsSubtotal, "600.00");
    assert.equal(body.totalAmount, "940.00");
    assertInvariant(body, "partsSubtotal-only PATCH");
  });

  it("both subtotals in PATCH body: returned total is their sum", async () => {
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/1`, {
      partsSubtotal: "100.00",
      laborSubtotal: "200.00",
    });
    assert.equal(status, 200);
    assert.equal(body.totalAmount, "300.00");
    assertInvariant(body, "both-subtotals PATCH");
  });

  it("neither subtotal in PATCH body: totalAmount unchanged (stored values used)", async () => {
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/1`, {
      workDescription: "Adjusted heads on zone 3",
    });
    assert.equal(status, 200);
    // stored: parts=481.72 + labor=0.00 = 481.72
    assert.equal(body.totalAmount, "481.72");
    assertInvariant(body, "metadata-only PATCH");
  });
});

describe("Slice 4 — /labor-hours: totalAmount === parts + labor in returned record", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness(
      new Map([[
        2,
        {
          id: 2, customerId: 10, invoiceId: null, status: "draft",
          partsSubtotal: "481.72", laborSubtotal: "0.00", totalAmount: "481.72",
          totalHours: "0.00", laborRate: "85.00", appliedLaborRate: "85.00",
          rateMode: "standard",
        },
      ]]),
      new Map(),
    );
  });

  afterEach(() => harness.close());

  it("labor-hours edit: stored partsSubtotal is preserved in returned totalAmount", async () => {
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/2/labor-hours`, {
      totalHours: 4,
    });
    assert.equal(status, 200);
    // 4h × $85 = $340 labor; stored parts = $481.72; total = $821.72
    assert.equal(body.totalHours, "4.00");
    assert.equal(body.laborSubtotal, "340.00");
    assert.equal(body.partsSubtotal, "481.72", "parts must not be zeroed by a labor-hours edit");
    assert.equal(body.totalAmount, "821.72");
    assertInvariant(body, "labor-hours edit");
  });

  it("labor-hours edit to 0: parts still survive (intentional zero for labor)", async () => {
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/2/labor-hours`, {
      totalHours: 0,
    });
    assert.equal(status, 200);
    assert.equal(body.laborSubtotal, "0.00");
    assert.equal(body.partsSubtotal, "481.72");
    assert.equal(body.totalAmount, "481.72");
    assertInvariant(body, "labor-hours-to-zero edit");
  });

  it("labor-hours locked sheet: returns 409 and stored record is unchanged", async () => {
    harness.sheets.set(2, { ...harness.sheets.get(2)!, status: "billed" });
    const { status } = await patch(`${harness.baseUrl}/api/billing-sheets/2/labor-hours`, {
      totalHours: 4,
    });
    assert.equal(status, 409);
    assert.equal(harness.sheets.get(2)!.totalAmount, "481.72", "locked sheet must not mutate");
  });
});

describe("Slice 4 — /rate-mode: totalAmount === parts + labor in returned record", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness(
      new Map([[
        3,
        {
          id: 3, customerId: 10, invoiceId: null, status: "draft",
          partsSubtotal: "481.72", laborSubtotal: "260.00", totalAmount: "741.72",
          totalHours: "4.00", laborRate: "65.00", appliedLaborRate: "65.00",
          rateMode: "standard",
        },
      ]]),
      new Map(),
    );
  });

  afterEach(() => harness.close());

  it("rate-mode flip to emergency: recomputed labor uses new rate; stored parts survive", async () => {
    // 4h × $97.50 = $390 labor; stored parts = $481.72; total = $871.72
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/3/rate-mode`, {
      mode: "emergency",
    });
    assert.equal(status, 200);
    assert.equal(body.rateMode, "emergency");
    assert.equal(body.appliedLaborRate, "97.50");
    assert.equal(body.laborSubtotal, "390.00");
    assert.equal(body.partsSubtotal, "481.72", "parts must not be zeroed by rate-mode flip");
    assert.equal(body.totalAmount, "871.72");
    assertInvariant(body, "rate-mode emergency flip");
  });

  it("rate-mode flip back to standard: recomputed labor uses standard rate; stored parts survive", async () => {
    // Pre: emergency mode with 4h × $97.50. Flip back to standard: 4h × $65 = $260
    harness.sheets.set(3, {
      ...harness.sheets.get(3)!,
      rateMode: "emergency", appliedLaborRate: "97.50", laborSubtotal: "390.00", totalAmount: "871.72",
    });
    const { status, body } = await patch(`${harness.baseUrl}/api/billing-sheets/3/rate-mode`, {
      mode: "standard",
    });
    assert.equal(status, 200);
    assert.equal(body.rateMode, "standard");
    assert.equal(body.laborSubtotal, "260.00");
    assert.equal(body.partsSubtotal, "481.72");
    assert.equal(body.totalAmount, "741.72");
    assertInvariant(body, "rate-mode standard flip");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Slice 5 — E2E chain: billing-manager edit propagates correct total to invoice
// ═══════════════════════════════════════════════════════════════════════════════

describe("Slice 5 — E2E: billing-manager labor edit propagates correct total through monthly invoice", () => {
  // Scenario: invoice #10 has two billing sheets:
  //   BS #100: partsSubtotal=$200.00, laborSubtotal=$0.00 (hours not yet set)
  //   BS #101: partsSubtotal=$481.72, laborSubtotal=$0.00 (hours not yet set)
  //
  // Billing manager edits BS #101 labor hours to 4h @ $85/h = $340.
  //
  // Expected outcome:
  //   BS #101.totalAmount  = $481.72 + $340.00 = $821.72
  //   Invoice #10.totalAmount = BS #100.totalAmount + BS #101.totalAmount
  //                           = $200.00 + $821.72 = $1021.72
  //
  // The old (buggy) behavior would have produced:
  //   BS #101.totalAmount  = $340.00  (parts zeroed)
  //   Invoice #10.totalAmount = $200.00 + $340.00 = $540.00  ← wrong

  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness(
      new Map<number, StoredBillingSheet>([
        [100, {
          id: 100, customerId: 10, invoiceId: 10, status: "draft",
          partsSubtotal: "200.00", laborSubtotal: "0.00", totalAmount: "200.00",
          totalHours: "0.00", laborRate: "85.00", appliedLaborRate: "85.00",
          rateMode: "standard",
        }],
        [101, {
          id: 101, customerId: 10, invoiceId: 10, status: "draft",
          partsSubtotal: "481.72", laborSubtotal: "0.00", totalAmount: "481.72",
          totalHours: "0.00", laborRate: "85.00", appliedLaborRate: "85.00",
          rateMode: "standard",
        }],
      ]),
      new Map([[10, { id: 10, totalAmount: "681.72" }]]),
    );
  });

  afterEach(() => harness.close());

  it("BS labor-hours edit propagates correct totalAmount to parent invoice (carry-forward)", async () => {
    // Step 1: billing manager edits labor hours on BS #101.
    const editResp = await patch(`${harness.baseUrl}/api/billing-sheets/101/labor-hours`, {
      totalHours: 4,
    });
    assert.equal(editResp.status, 200, "labor-hours edit should succeed");

    // Step 2: verify BS #101 now has the correct total (bug fix confirmed).
    assert.equal(editResp.body.partsSubtotal, "481.72", "parts must not be zeroed");
    assert.equal(editResp.body.laborSubtotal, "340.00", "labor = 4h × $85");
    assert.equal(editResp.body.totalAmount, "821.72", "BS total = parts + labor");
    assertInvariant(editResp.body, "BS #101 after labor edit");

    // Step 3: verify the invoice total now correctly reflects both BS totals.
    const invResp = await get(`${harness.baseUrl}/api/invoices/10`);
    assert.equal(invResp.status, 200);
    assert.equal(invResp.body.totalAmount, "1021.72",
      "Invoice total must be BS#100($200) + BS#101($821.72) = $1021.72; " +
      "old buggy value was $540.00 (parts zeroed in BS#101)",
    );
  });

  it("PATCH-based edit (generic) also propagates correct total to parent invoice", async () => {
    // Same scenario but using the generic PATCH endpoint (not /labor-hours).
    // The PATCH body sends only the computed laborSubtotal — no partsSubtotal.
    const editResp = await patch(`${harness.baseUrl}/api/billing-sheets/101`, {
      laborSubtotal: "340.00",
      // partsSubtotal intentionally absent — should fall back to stored $481.72
    });
    assert.equal(editResp.status, 200);
    assert.equal(editResp.body.totalAmount, "821.72");

    const invResp = await get(`${harness.baseUrl}/api/invoices/10`);
    assert.equal(invResp.body.totalAmount, "1021.72");
  });

  it("rate-mode flip also propagates correct total to parent invoice", async () => {
    // Billing sheet already has 4h. Rate-mode flip to emergency: 4h × $97.50 = $390.
    harness.sheets.set(101, {
      ...harness.sheets.get(101)!,
      totalHours: "4.00", laborSubtotal: "340.00", totalAmount: "821.72",
    });

    const editResp = await patch(`${harness.baseUrl}/api/billing-sheets/101/rate-mode`, {
      mode: "emergency",
    });
    assert.equal(editResp.status, 200);
    // 4h × $97.50 = $390 + parts $481.72 = $871.72
    assert.equal(editResp.body.totalAmount, "871.72");
    assertInvariant(editResp.body, "BS #101 after rate-mode flip");

    // Invoice total = BS#100 $200 + BS#101 $871.72 = $1071.72
    const invResp = await get(`${harness.baseUrl}/api/invoices/10`);
    assert.equal(invResp.body.totalAmount, "1071.72");
  });
});

// ─── Slice 3 evidence ─────────────────────────────────────────────────────────
// The reconcile script was run against the dev DB on 2026-07-01 (dry-run):
//   candidates=0 repaired=0 repairedDryRun=0 alreadyReconciled=0 errors=0
// The dev DB has 0 drifted billing sheets. Production reconcile (BS 267 /
// invoice 79) is tracked as follow-up task #1675.

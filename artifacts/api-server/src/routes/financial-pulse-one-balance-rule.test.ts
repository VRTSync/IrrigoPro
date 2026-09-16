// Task #2013 — one balance rule behind every "money owed" figure.
//
// The invoices page used to stack two "Money Owed by Age" cards that
// disagreed: the Financial Pulse widget said $95,176 where the page's own
// aging strip said $94,305.58, two invoices apart across the middle buckets.
// The populations were identical; only the money differed, because Financial
// Pulse read `balance` only for a `partially_paid` invoice while the invoice
// list read it through `resolveBalanceDue` whenever a payment sync had run.
//
// This file is the evidence for the fix, and it lives on its own rather than
// inside financial-pulse-math.test.ts or financial-pulse.test.ts because those
// two files are edited by four tickets each. It is named explicitly in the
// `seasonal-budget-financial-pulse` validation command — the bucket-sum
// invariant below is the most valuable assertion here, and a validation
// command that never runs it would not catch the next drift.
//
// The Financial Pulse side is proven at the math layer (pure, no database).
// The invoice-list side runs the REAL aging-summary handler over a storage
// spy, so nothing here re-implements bucketing or balance resolution.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type Express, type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  arAmountDue,
  computeArAging,
  computeOutstandingAr,
  computePulseCustomers,
  computePulseTechnicians,
  type CustomerWithBudget,
  type InvoiceLike,
  type PulseBillingSheetLike,
  type PulseWorkOrderLike,
} from "../financial-pulse-math";
import {
  registerInvoiceListRoutes,
  type InvoiceRowLike,
} from "./invoice-list-routes";
import { requireInvoiceRead } from "./role-guards";
import { AGING_BUCKET_KEYS } from "@workspace/shared";

// ── one fixture, two shapes ──────────────────────────────────────────────────
//
// Every test below builds its invoices from a single spec and projects that
// spec into both surfaces' row shapes. Two hand-written fixtures could drift
// apart and make a cross-surface test agree with itself.

const NOW = new Date("2026-08-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const CREATED = new Date(NOW.getTime() - 200 * DAY);

interface Spec {
  id: number;
  totalAmount: string;
  /** Days past the effective due date at NOW. Negative = not yet due. */
  overdueDays: number;
  status?: string;
  paymentStatus?: string | null;
  balance?: string | null;
  paymentSyncedAt?: Date | null;
  paidAt?: Date | null;
  customerId?: number;
  /** Only set by the unparseable-createdAt case. */
  createdAt?: Date | string;
}

function dueFor(spec: Spec): Date {
  return new Date(NOW.getTime() - spec.overdueDays * DAY);
}

/** The Financial Pulse shape, as `loadInvoicesForCustomers` builds it. */
function pulseRow(spec: Spec): InvoiceLike {
  return {
    id: spec.id,
    customerId: spec.customerId ?? 100,
    totalAmount: spec.totalAmount,
    status: spec.status ?? "generated",
    createdAt: spec.createdAt ?? CREATED,
    paidAt: spec.paidAt ?? null,
    dueDate: dueFor(spec),
    paymentStatus: spec.paymentStatus ?? "unpaid",
    balance: spec.balance ?? null,
    paymentSyncedAt: spec.paymentSyncedAt ?? null,
    paymentTerms: "net_30",
  };
}

/** The invoice-list shape, as the list handler receives it from storage. */
function listRow(spec: Spec): InvoiceRowLike {
  return {
    id: spec.id,
    customerId: spec.customerId ?? 100,
    customerName: `Customer ${spec.customerId ?? 100}`,
    customerEmail: `c${spec.id}@example.com`,
    invoiceNumber: `INV-${String(spec.id).padStart(4, "0")}`,
    status: spec.status ?? "generated",
    totalAmount: spec.totalAmount,
    createdAt: spec.createdAt ?? CREATED,
    dueDate: dueFor(spec),
    sentAt: CREATED,
    paidAt: spec.paidAt ?? null,
    paymentStatus: spec.paymentStatus ?? "unpaid",
    balance: spec.balance ?? null,
    paymentSyncedAt: spec.paymentSyncedAt ?? null,
    quickbooksInvoiceId: "QB-1",
    qbVoidDetectedAt: null,
    qbNote: null,
  };
}

// ── the invoice-list aging summary, over the real handler ────────────────────

const SUMMARY = "/api/invoices/aging-summary";

function buildApp(
  rowsByCompany: Map<number | null, InvoiceRowLike[]>,
  companyId: number | null = 1,
): Express {
  const auth: RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserRole = "billing_manager";
    req.authenticatedUserId = 7;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
  const app = express();
  app.use(express.json());
  registerInvoiceListRoutes(app, {
    requireAuthentication: auth,
    requireInvoiceRead,
    applyPricingVisibility: (_req, data) => data,
    applyArNoteVisibility: (_req, data) => data,
    _storageApi: {
      async getInvoices(scoped: number | null) {
        return rowsByCompany.get(scoped) ?? [];
      },
      async getInvoiceReminderSummaries() {
        return new Map();
      },
    },
    _loadPaymentTerms: async () => new Map<number, string | null>(),
    _now: () => NOW,
  });
  return app;
}

/** Runs the real aging-summary handler over `specs` for one company. */
async function agingSummary(
  specs: Spec[],
  { companyId = 1 as number | null, rowsForCompany = 1 as number | null } = {},
): Promise<any> {
  const app = buildApp(
    new Map([[rowsForCompany, specs.map(listRow)]]),
    companyId,
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${SUMMARY}`);
    return await res.json();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function bucketSum(buckets: { amount: number }[]): number {
  return buckets.reduce((s, b) => s + b.amount, 0);
}

function cents(n: number): string {
  return n.toFixed(2);
}

// ── 1. the balance rule itself ───────────────────────────────────────────────

describe("Task #2013 — one balance rule across Financial Pulse and the list", () => {
  it("counts a synced balance below the total, even on an `unpaid` invoice", async () => {
    // The $870 gap, in miniature. QuickBooks reported a reduced balance — a
    // credit memo, or a payment it has not reclassified — but left the status
    // at `unpaid`. Financial Pulse used to count the $1,000 face value here
    // while the invoice list counted the $800 really owed.
    const specs: Spec[] = [
      {
        id: 1,
        totalAmount: "1000.00",
        balance: "800.00",
        paymentStatus: "unpaid",
        paymentSyncedAt: NOW,
        overdueDays: 40,
      },
    ];
    const rows = specs.map(pulseRow);

    assert.equal(computeOutstandingAr(rows), 800);
    assert.equal(bucketSum(computeArAging(rows, NOW)), 800);

    const summary = await agingSummary(specs);
    assert.equal(summary.overall.balanceDue, "800.00");
  });

  it("falls back to the invoice total when no payment sync has run", async () => {
    // No `paymentSyncedAt` means the `balance` column is not a statement about
    // this invoice, so both surfaces must ignore it and use the total.
    const specs: Spec[] = [
      {
        id: 1,
        totalAmount: "1000.00",
        balance: "800.00",
        paymentStatus: "unpaid",
        paymentSyncedAt: null,
        overdueDays: 40,
      },
    ];
    const rows = specs.map(pulseRow);

    assert.equal(computeOutstandingAr(rows), 1000);
    assert.equal(bucketSum(computeArAging(rows, NOW)), 1000);

    const summary = await agingSummary(specs);
    assert.equal(summary.overall.balanceDue, "1000.00");
  });

  it("counts the total for a partially-paid invoice whose balance is null", async () => {
    // `partially_paid` with no balance figure is a half-synced row. Guessing a
    // number from the status would put a different figure on each surface.
    const specs: Spec[] = [
      {
        id: 1,
        totalAmount: "1000.00",
        balance: null,
        paymentStatus: "partially_paid",
        paymentSyncedAt: NOW,
        overdueDays: 40,
      },
    ];
    const rows = specs.map(pulseRow);

    assert.equal(computeOutstandingAr(rows), 1000);
    assert.equal(bucketSum(computeArAging(rows, NOW)), 1000);

    const summary = await agingSummary(specs);
    assert.equal(summary.overall.balanceDue, "1000.00");
  });
});

// ── 2. the buckets sum to the tile ───────────────────────────────────────────

const MIXED: Spec[] = [
  // Not yet due, no sync — counts its total.
  { id: 1, totalAmount: "1000.00", overdueDays: -10 },
  // Freshly overdue, synced down to a partial balance.
  {
    id: 2,
    totalAmount: "900.00",
    balance: "450.25",
    paymentStatus: "partially_paid",
    paymentSyncedAt: NOW,
    overdueDays: 10,
  },
  // Overdue, still flagged unpaid, but QuickBooks knows better.
  {
    id: 3,
    totalAmount: "2000.00",
    balance: "1129.75",
    paymentStatus: "unpaid",
    paymentSyncedAt: NOW,
    overdueDays: 45,
  },
  // Deeply overdue, never synced.
  { id: 4, totalAmount: "750.50", overdueDays: 120 },
  // Fully settled by balance but not yet re-flagged. Owes nothing.
  {
    id: 5,
    totalAmount: "600.00",
    balance: "0.00",
    paymentStatus: "unpaid",
    paymentSyncedAt: NOW,
    overdueDays: 70,
  },
  // Overpaid — a credit memo larger than the invoice. Owes nothing, and must
  // not subtract from anyone else's bucket.
  {
    id: 6,
    totalAmount: "400.00",
    balance: "-125.00",
    paymentStatus: "unpaid",
    paymentSyncedAt: NOW,
    overdueDays: 15,
  },
  // Out of A/R entirely.
  { id: 7, totalAmount: "5000.00", status: "draft", overdueDays: 30 },
  { id: 8, totalAmount: "4000.00", status: "merged", overdueDays: 30 },
  { id: 9, totalAmount: "3000.00", status: "cancelled", overdueDays: 30 },
  { id: 10, totalAmount: "2500.00", status: "paid", paymentStatus: "paid", paidAt: NOW, overdueDays: 30 },
];

describe("Task #2013 — the four buckets sum to the Money Owed tile", () => {
  it("sums to the cent over a mixed fixture", () => {
    const rows = MIXED.map(pulseRow);
    const tile = computeOutstandingAr(rows);
    const buckets = computeArAging(rows, NOW);
    assert.equal(
      cents(bucketSum(buckets)),
      cents(tile),
      "a bucket total that misses the tile means one of the two dropped a row",
    );
  });

  it("keeps a row with an unparseable createdAt in a bucket as well as the tile", () => {
    // `computeArAging` used to `continue` on a createdAt it could not parse,
    // which put the row in the KPI and in no bucket at all. The frozen NaN
    // fallthrough in classifyAgingBucket lands it in the oldest bucket.
    const broken: Spec = {
      id: 99,
      totalAmount: "321.00",
      overdueDays: 0,
      createdAt: "not-a-date",
    };
    const row = { ...pulseRow(broken), dueDate: null };
    assert.equal(computeOutstandingAr([row]), 321);
    const buckets = computeArAging([row], NOW);
    assert.equal(cents(bucketSum(buckets)), "321.00");
    assert.equal(
      buckets.find((b) => b.key === "days90")?.amount,
      321,
      "an undateable row is the oldest thing in the book, not an invisible one",
    );
  });

  it("gives a row that owes nothing neither a count nor a dollar", () => {
    // A bucket that says "3 invoices" over dollars from 2 of them is the
    // 10-vs-9 count gap. Count and amount have to describe the same set.
    const settled = pulseRow({
      id: 1,
      totalAmount: "600.00",
      balance: "0.00",
      paymentStatus: "unpaid",
      paymentSyncedAt: NOW,
      overdueDays: 70,
    });
    const overpaid = pulseRow({
      id: 2,
      totalAmount: "400.00",
      balance: "-125.00",
      paymentStatus: "unpaid",
      paymentSyncedAt: NOW,
      overdueDays: 15,
    });

    assert.equal(arAmountDue(settled), 0);
    assert.equal(arAmountDue(overpaid), 0, "an overpayment is clamped, never negative");
    assert.equal(computeOutstandingAr([settled, overpaid]), 0);
    for (const b of computeArAging([settled, overpaid], NOW)) {
      assert.equal(b.amount, 0, `${b.key} amount`);
      assert.equal(b.count, 0, `${b.key} count`);
    }
  });
});

// ── 3. the two surfaces, bucket for bucket ───────────────────────────────────

describe("Task #2013 — Financial Pulse and the invoice list agree per bucket", () => {
  it("returns the same amount and the same count in every bucket", async () => {
    const pulse = computeArAging(MIXED.map(pulseRow), NOW);
    const summary = await agingSummary(MIXED);

    const listByKey = new Map<string, { balanceDue: string; count: number }>(
      summary.buckets.map((b: any) => [b.key, { balanceDue: b.balanceDue, count: b.count }]),
    );

    for (const key of AGING_BUCKET_KEYS) {
      const fp = pulse.find((b) => b.key === key)!;
      const list = listByKey.get(key)!;
      assert.equal(cents(fp.amount), list.balanceDue, `${key} dollars`);
      assert.equal(fp.count, list.count, `${key} invoice count`);
    }

    // And the strip's own total is the Money Owed tile.
    assert.equal(
      summary.overall.balanceDue,
      cents(computeOutstandingAr(MIXED.map(pulseRow))),
    );
  });

  it("never lets another company's invoice into a caller's buckets", async () => {
    // Scope is the storage call, not a filter the handler could forget. A
    // company-1 caller must see nothing of company 2's five-figure invoice.
    const app = buildApp(
      new Map<number | null, InvoiceRowLike[]>([
        [1, [listRow({ id: 1, totalAmount: "100.00", overdueDays: 40 })]],
        [
          2,
          [listRow({ id: 2, customerId: 200, totalAmount: "99999.00", overdueDays: 40 })],
        ],
      ]),
      1,
    );
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    try {
      const body: any = await (await fetch(`http://127.0.0.1:${port}${SUMMARY}`)).json();
      assert.equal(body.overall.balanceDue, "100.00");
      for (const b of body.buckets) {
        assert.ok(
          parseFloat(b.balanceDue) < 99999,
          `company 2's invoice leaked into ${b.key}`,
        );
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ── 4. the excluded-status set, on the Pulse tab ─────────────────────────────

const YEAR = 2026;

function pulseYtdRow(id: number, status: string, amount: string): InvoiceLike {
  return {
    id,
    customerId: 100,
    totalAmount: amount,
    status,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    paidAt: null,
    invoiceYear: YEAR,
    invoiceMonth: 3,
  };
}

const CUSTOMERS: CustomerWithBudget[] = [
  {
    id: 100,
    companyId: 1,
    name: "Cedar Ridge",
    hiddenFromBilling: false,
    monthlyAllocation: null,
    budgetSoftThresholdPercent: null,
    budgetHardThresholdPercent: null,
  },
];

describe("Task #2013 — merged and failed invoices leave the Pulse-tab rollups", () => {
  // Merged is the harmful case: the amount already lives on the surviving
  // invoice, so the Pulse tab counted it twice while the Accounting tab, which
  // has always used INVOICE_EXCLUDED_STATUSES, counted it once.
  for (const status of ["merged", "failed"]) {
    it(`excludes a ${status} invoice from the per-customer YTD figure`, () => {
      const rows = computePulseCustomers({
        customers: CUSTOMERS,
        invoices: [
          pulseYtdRow(1, "sent", "500.00"),
          pulseYtdRow(2, status, "900.00"),
        ],
        workOrders: [],
        billingSheets: [],
        currentYear: YEAR,
        now: NOW,
        monthSpendByCustomer: new Map(),
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ytd, 500);
    });

    it(`excludes a ${status} invoice from the per-technician YTD figure`, () => {
      const workOrders: PulseWorkOrderLike[] = [
        { customerId: 100, assignedTechnicianId: 5, invoiceId: 1, status: "billed", totalAmount: "500.00" },
        { customerId: 100, assignedTechnicianId: 5, invoiceId: 2, status: "billed", totalAmount: "900.00" },
      ];
      const billingSheets: PulseBillingSheetLike[] = [];
      const rows = computePulseTechnicians({
        techs: [{ id: 5, name: "Tech Five" }],
        invoices: [
          pulseYtdRow(1, "sent", "500.00"),
          pulseYtdRow(2, status, "900.00"),
        ],
        workOrders,
        billingSheets,
        currentYear: YEAR,
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ytd, 500);
    });
  }
});

// ── 5. the loader behind every Financial Pulse endpoint ──────────────────────

describe("Task #2013 — the Financial Pulse invoice projection carries the sync stamp", () => {
  it("selects and forwards paymentSyncedAt", () => {
    // `resolveBalanceDue` degrades to the invoice total when this field is
    // absent — silently, with no type error and no runtime failure — so every
    // number on every Financial Pulse surface would quietly revert to face
    // value. This is the one loader behind all of them.
    const src = readFileSync(join(import.meta.dirname, "financial-pulse.ts"), "utf8");
    const start = src.indexOf("async function loadInvoicesForCustomers");
    assert.ok(start > -1, "loadInvoicesForCustomers is the projection under test");
    const body = src.slice(start, src.indexOf("\n}", start));
    assert.match(body, /paymentSyncedAt: invoices\.paymentSyncedAt/);
    assert.match(body, /paymentSyncedAt: i\.paymentSyncedAt/);
  });
});

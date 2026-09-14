// Financial Pulse — one month-end projection.
//
// The Accounting tab used to show the month-end projection twice: the KPI
// tile "Projected by Month-End" extrapolated the uninvoiced pipeline
// (`unbilledExposure`) while the "Month-End Projection" card extrapolated
// billed month-to-date. Two numbers, both labelled the projection, both
// reporting `method: "runRate"`, routinely 2x apart.
//
// The billed run-rate is the surviving definition. These tests pin that
// contract down:
//   * the projection helper's base is billed-to-date, never a pipeline
//     balance (this replaces the old regression that asserted the opposite);
//   * /kpis and /projections, hit against one fixture at one instant, return
//     an identical projectedMonthEnd — the drift guard;
//   * the edge cases the extrapolation has to survive (zero billed, day 1);
//   * tenancy — the projection is computed only from in-scope invoices.
//
// Lives in its own file on purpose: several tickets edit
// financial-pulse.test.ts and financial-pulse-math.test.ts, and this
// ticket's evidence should not collide with theirs.

import { describe, it, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { db } from "../db";
import {
  billingSheets,
  customers,
  invoices,
  workOrders,
} from "@workspace/db/schema";
import { computeProjectedMonthEnd } from "../financial-pulse-math";

// ─── Pure math: the projection base is billed-to-date ───────────────────────

describe("computeProjectedMonthEnd — base is billed-to-date", () => {
  it("extrapolates the billed figure it is handed, at the current daily pace", () => {
    // September 2026: 30 days in the month, 10 elapsed.
    const now = new Date(2026, 8, 10);
    assert.equal(computeProjectedMonthEnd(30_000, now), (30_000 / 10) * 30);
  });

  it("mid-month: $30,000 billed with a $50,000 pipeline projects $90,000, not $150,000", () => {
    // 10 of 30 days elapsed. The old tile divided the standing pipeline
    // balance by the day of the month and reported $150,000; the run rate
    // reports $90,000. The pipeline figure must not be reachable from this
    // helper's production call sites.
    const now = new Date(2026, 8, 10);
    const billedMtd = 30_000;
    const uninvoicedPipeline = 50_000;
    assert.equal(computeProjectedMonthEnd(billedMtd, now), 90_000);
    assert.notEqual(
      computeProjectedMonthEnd(billedMtd, now),
      computeProjectedMonthEnd(uninvoicedPipeline, now),
    );
  });

  it("zero billed to date projects $0, not NaN or Infinity", () => {
    const proj = computeProjectedMonthEnd(0, new Date(2026, 8, 10));
    assert.equal(proj, 0);
    assert.ok(Number.isFinite(proj), "projection must be finite");
    assert.ok(!Number.isNaN(proj), "projection must not be NaN");
  });

  it("day 1 projects billed-so-far x days-in-month without dividing by zero", () => {
    // Date.getDate() is 1-31, so the smallest divisor is 1 — there is no
    // day-zero branch to fall through.
    const jan1 = new Date(2026, 0, 1);
    assert.equal(computeProjectedMonthEnd(2_000, jan1), 2_000 * 31);
    assert.ok(Number.isFinite(computeProjectedMonthEnd(2_000, jan1)));

    const feb1 = new Date(2026, 1, 1);
    assert.equal(computeProjectedMonthEnd(2_000, feb1), 2_000 * 28);
  });

  it("last day of the month projects exactly what was billed", () => {
    // The run rate converges on the actual as the month closes.
    const sep30 = new Date(2026, 8, 30);
    assert.equal(computeProjectedMonthEnd(42_000, sep30), 42_000);
  });
});

// ─── Route level: /kpis and /projections cannot drift apart ─────────────────
//
// Both handlers are mounted for real against a stubbed `db.select()` that
// serves fixture rows per table, so scope resolution, the loaders and the
// KPI math all run. The clock is frozen so both endpoints see the same
// `now`.

interface CustomerRow {
  id: number;
  companyId: number;
  hiddenFromBilling: boolean;
}
interface InvoiceRow {
  id: number;
  customerId: number;
  totalAmount: string;
  status: string;
  createdAt: Date;
}
interface WorkOrderRow {
  customerId: number;
  invoiceId: number | null;
  totalAmount: string;
  status: string;
  createdAt: Date;
}
interface Fixture {
  customers: CustomerRow[];
  invoices: InvoiceRow[];
  workOrders: WorkOrderRow[];
}

let FIXTURE: Fixture = { customers: [], invoices: [], workOrders: [] };

// Drizzle conditions are SQL objects whose queryChunks carry the referenced
// columns and the bound Params. Walking them lets the stub honour the
// tenancy filters the loaders actually build, rather than ignoring them.
function walkChunks(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walkChunks(n, visit);
    return;
  }
  visit(node);
  const chunks = (node as any).queryChunks;
  if (Array.isArray(chunks)) walkChunks(chunks, visit);
}

function boundNumbers(cond: unknown): number[] {
  const out: number[] = [];
  walkChunks(cond, (n) => {
    // A bound Param carries both `value` and `encoder`; a StringChunk has
    // only `value`.
    if ("encoder" in n && "value" in n && typeof n.value === "number") {
      out.push(n.value);
    }
  });
  return out;
}

function referencedColumns(cond: unknown): string[] {
  const out: string[] = [];
  walkChunks(cond, (n) => {
    if (typeof n.name === "string" && n.table) out.push(n.name);
  });
  return out;
}

function rowsFor(table: unknown, cond: unknown): unknown[] {
  const cols = referencedColumns(cond);
  const nums = boundNumbers(cond);
  if (table === customers) {
    // No condition = super_admin global scope.
    if (!cols.includes("company_id")) return FIXTURE.customers;
    return FIXTURE.customers.filter((c) => nums.includes(c.companyId));
  }
  if (table === invoices) {
    if (!cols.includes("customer_id")) return [];
    return FIXTURE.invoices.filter((i) => nums.includes(i.customerId));
  }
  if (table === workOrders) {
    // Only the customer-scoped pipeline load; the margin loaders key off
    // invoice_id and get nothing.
    if (!cols.includes("customer_id")) return [];
    return FIXTURE.workOrders.filter((w) => nums.includes(w.customerId));
  }
  if (table === billingSheets) return [];
  return [];
}

const originalSelect = (db as any).select;
(db as any).select = () => {
  let table: unknown = null;
  let cond: unknown = null;
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          const rows = rowsFor(table, cond);
          return (resolve: (v: unknown) => void) => resolve(rows);
        }
        if (prop === "from") {
          return (t: unknown) => {
            table = t;
            return chain;
          };
        }
        if (prop === "where") {
          return (c: unknown) => {
            cond = c;
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
};

// Import AFTER patching so the route module closes over the stub.
const { registerFinancialPulseRoutes } = await import("./financial-pulse");

interface ServerCtx {
  server: Server;
  base: string;
}
const SERVERS: ServerCtx[] = [];

async function spin(
  role: string,
  companyId: number | null,
): Promise<ServerCtx> {
  const app: Express = express();
  app.use(express.json());
  const requireAuthentication: express.RequestHandler = (
    req: any,
    _res,
    next,
  ) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
  registerFinancialPulseRoutes(app, { requireAuthentication });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const ctx = { server, base: `http://127.0.0.1:${port}` };
  SERVERS.push(ctx);
  return ctx;
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url);
  assert.equal(r.status, 200, `${url} should be 200`);
  return (await r.json()) as any;
}

// September 2026: 30 days, frozen on the 10th.
const FROZEN_NOW = new Date(2026, 8, 10, 12, 0, 0);
const DAYS_ELAPSED = 10;
const DAYS_IN_MONTH = 30;

function invoice(
  id: number,
  customerId: number,
  amount: number,
  day = 5,
): InvoiceRow {
  return {
    id,
    customerId,
    totalAmount: String(amount),
    status: "sent",
    createdAt: new Date(2026, 8, day),
  };
}

describe("Financial Pulse — /kpis and /projections report one projection", () => {
  before(() => {
    mock.timers.enable({ apis: ["Date"], now: FROZEN_NOW.getTime() });
  });

  after(async () => {
    mock.timers.reset();
    (db as any).select = originalSelect;
    await Promise.all(
      SERVERS.map((s) => new Promise<void>((r) => s.server.close(() => r()))),
    );
  });

  beforeEach(() => {
    FIXTURE = { customers: [], invoices: [], workOrders: [] };
  });

  afterEach(() => {
    FIXTURE = { customers: [], invoices: [], workOrders: [] };
  });

  it("both endpoints return an identical projectedMonthEnd for one fixture at one instant", async () => {
    // Billed MTD ($30,000) and the uninvoiced pipeline ($50,000) are
    // deliberately different, so an endpoint still projecting from the
    // pipeline would disagree here.
    FIXTURE = {
      customers: [{ id: 1, companyId: 10, hiddenFromBilling: false }],
      invoices: [invoice(101, 1, 30_000)],
      workOrders: [
        {
          customerId: 1,
          invoiceId: null,
          totalAmount: "50000",
          status: "in_progress",
          createdAt: new Date(2026, 8, 3),
        },
      ],
    };
    const { base } = await spin("company_admin", 10);

    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);
    const projections = await getJson(`${base}/api/financial-pulse/projections`);

    assert.equal(
      kpis.projectedMonthEnd.value,
      projections.projectedMonthEnd,
      "the KPI tile and the Month-End Projection card must show one number",
    );
    // ...and both still describe themselves as a run rate, truthfully now.
    assert.equal(kpis.projectedMonthEnd.method, "runRate");
    assert.equal(projections.method, "runRate");
  });

  it("mid-month: $30,000 billed with a $50,000 pipeline projects $90,000, not $150,000", async () => {
    FIXTURE = {
      customers: [{ id: 1, companyId: 10, hiddenFromBilling: false }],
      invoices: [invoice(101, 1, 30_000)],
      workOrders: [
        {
          customerId: 1,
          invoiceId: null,
          totalAmount: "50000",
          status: "in_progress",
          createdAt: new Date(2026, 8, 3),
        },
      ],
    };
    const { base } = await spin("company_admin", 10);
    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);

    assert.equal(kpis.projectedMonthEnd.value, 90_000);
    assert.notEqual(
      kpis.projectedMonthEnd.value,
      (50_000 / DAYS_ELAPSED) * DAYS_IN_MONTH,
    );
    // "Work Not Yet Billed" is untouched and still reports the pipeline.
    assert.equal(kpis.unbilledExposure.value, 50_000);
  });

  it("zero billed to date projects $0 rather than NaN or Infinity", async () => {
    FIXTURE = {
      customers: [{ id: 1, companyId: 10, hiddenFromBilling: false }],
      invoices: [],
      workOrders: [
        {
          customerId: 1,
          invoiceId: null,
          totalAmount: "50000",
          status: "in_progress",
          createdAt: new Date(2026, 8, 3),
        },
      ],
    };
    const { base } = await spin("company_admin", 10);
    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);

    assert.equal(kpis.projectedMonthEnd.value, 0);
    assert.ok(
      Number.isFinite(kpis.projectedMonthEnd.value),
      "an empty billing month must not project Infinity",
    );
  });

  it("scopes the projection to the caller's own company", async () => {
    FIXTURE = {
      customers: [
        { id: 1, companyId: 10, hiddenFromBilling: false },
        { id: 2, companyId: 20, hiddenFromBilling: false },
      ],
      invoices: [invoice(101, 1, 30_000), invoice(201, 2, 12_000)],
      workOrders: [],
    };
    const { base } = await spin("company_admin", 10);
    const kpis = await getJson(`${base}/api/financial-pulse/kpis`);

    // Only customer 1's $30,000 — customer 2 belongs to another tenant.
    assert.equal(
      kpis.projectedMonthEnd.value,
      (30_000 / DAYS_ELAPSED) * DAYS_IN_MONTH,
    );
    assert.equal(kpis.billedMtd.value, 30_000);
  });

  it("super_admin with ?companyId projects that company; without it, global", async () => {
    FIXTURE = {
      customers: [
        { id: 1, companyId: 10, hiddenFromBilling: false },
        { id: 2, companyId: 20, hiddenFromBilling: false },
      ],
      invoices: [invoice(101, 1, 30_000), invoice(201, 2, 12_000)],
      workOrders: [],
    };
    const { base } = await spin("super_admin", null);

    const scoped = await getJson(`${base}/api/financial-pulse/kpis?companyId=20`);
    assert.equal(
      scoped.projectedMonthEnd.value,
      (12_000 / DAYS_ELAPSED) * DAYS_IN_MONTH,
    );

    const global = await getJson(`${base}/api/financial-pulse/kpis`);
    assert.equal(
      global.projectedMonthEnd.value,
      (42_000 / DAYS_ELAPSED) * DAYS_IN_MONTH,
    );

    // The two scopes must not collapse into each other.
    assert.notEqual(scoped.projectedMonthEnd.value, global.projectedMonthEnd.value);
  });

  it("the scoped and global projections each equal their own /projections figure", async () => {
    // The drift guard, run again under super_admin scoping so the two
    // endpoints are pinned together on every scope the tile can be viewed in.
    FIXTURE = {
      customers: [
        { id: 1, companyId: 10, hiddenFromBilling: false },
        { id: 2, companyId: 20, hiddenFromBilling: false },
      ],
      invoices: [invoice(101, 1, 30_000), invoice(201, 2, 12_000)],
      workOrders: [
        {
          customerId: 1,
          invoiceId: null,
          totalAmount: "50000",
          status: "in_progress",
          createdAt: new Date(2026, 8, 3),
        },
      ],
    };
    const { base } = await spin("super_admin", null);

    for (const qs of ["", "?companyId=10", "?companyId=20"]) {
      const kpis = await getJson(`${base}/api/financial-pulse/kpis${qs}`);
      const projections = await getJson(`${base}/api/financial-pulse/projections${qs}`);
      assert.equal(
        kpis.projectedMonthEnd.value,
        projections.projectedMonthEnd,
        `projection drift for scope "${qs || "global"}"`,
      );
    }
  });
});

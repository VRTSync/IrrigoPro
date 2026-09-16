// Task #2027 — the three screens agree about QuickBooks.
//
// The defect this file exists to prevent: Financial Pulse showed an amber
// "QuickBooks sync is unhealthy" banner, the Manager Workspace strip showed
// "QuickBooks: Ok · Synced 8:25 AM" seconds later, and the invoices header
// showed "QuickBooks: out of date" — three answers in one minute, at most one
// of them right, because each surface derived health for itself.
//
// So the assertion that matters here is an *equality* across all three HTTP
// surfaces for one fixture, not three separate shape checks. Everything above
// it tests the one derivation they now share.
//
// The three routes are mounted for real against a table-aware `db` stub, so
// nothing is asserted about a mock of the thing under test. Row counts are
// never asserted — the api-server integration tests share one dev database and
// this file must not depend on it at all.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getTableName } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import {
  deriveQbHealth,
  isPaymentSyncStale,
  qbConnectionRank,
  resolveQbScope,
  worstConnectionStatus,
  QB_CONNECTION_RANK,
  type QuickBooksHealth,
} from "./quickbooks-health";

// ── Fixtures ────────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface IntegrationRow {
  id: number;
  companyId: string;
  connectionStatus: string | null;
  reconnectRequiredReason: string | null;
  lastRefreshSuccess: Date | null;
}

interface Fixture {
  integrations: IntegrationRow[];
  failedSync: any[];
  pendingSync: any[];
  syncedRows: any[];
  queuedInvoices: number;
  lastPaymentSyncAt: Date | null;
  /**
   * Newest payment read per company. Payment sync runs per tenant, so the
   * cross-tenant rollup groups rather than taking one global maximum; a
   * company missing from this map has never been payment-synced.
   */
  paymentSyncByCompany: Record<string, Date | null>;
  /**
   * Queued (finalized, un-pushed) invoices per company, for the cases that
   * care which tenant they belong to. `null` means "use `queuedInvoices` for
   * whatever was asked", which is what every single-company case wants.
   */
  queuedInvoicesByCompany: Record<string, number> | null;
}

function integration(over: Partial<IntegrationRow> = {}): IntegrationRow {
  return {
    id: 1,
    companyId: "7",
    connectionStatus: "connected",
    reconnectRequiredReason: null,
    lastRefreshSuccess: new Date(Date.now() - 2 * HOUR),
    ...over,
  };
}

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    integrations: [integration()],
    failedSync: [],
    pendingSync: [],
    syncedRows: [],
    queuedInvoices: 0,
    lastPaymentSyncAt: new Date(Date.now() - 1 * HOUR),
    paymentSyncByCompany: { "7": new Date(Date.now() - 1 * HOUR) },
    queuedInvoicesByCompany: null,
    ...over,
  };
}

/** The fixture the mounted routes read. Swapped per test. */
let CURRENT: Fixture = fixture();

// ── A table-aware `db.select` stub ──────────────────────────────────────────

/**
 * Drizzle conditions carry their bound values in nested `queryChunks`. Walking
 * them out is enough to tell `syncStatus = 'failed'` from `'pending'` and to
 * see which company id a scoped query asked for — which is how the tenancy
 * case below is a real assertion rather than a restatement of the fixture.
 */
function collectParams(node: any, out: any[] = [], depth = 0): any[] {
  if (node == null || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const n of node) collectParams(n, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;
  if ("value" in node && (typeof node.value === "string" || typeof node.value === "number")) {
    out.push(node.value);
  }
  if (Array.isArray(node.queryChunks)) collectParams(node.queryChunks, out, depth + 1);
  return out;
}

function stubSelect(fields: any): any {
  let table: string | null = null;
  const params: any[] = [];
  const builder: any = {
    from(t: any) {
      try {
        table = getTableName(t);
      } catch {
        table = null;
      }
      return builder;
    },
    innerJoin: (_t: any, cond: any) => (collectParams(cond, params), builder),
    leftJoin: (_t: any, cond: any) => (collectParams(cond, params), builder),
    where: (cond: any) => (collectParams(cond, params), builder),
    orderBy: () => builder,
    groupBy: () => builder,
    limit: () => builder,
    offset: () => builder,
    then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
  };

  function rows(): any[] {
    const keys = fields && typeof fields === "object" ? Object.keys(fields) : [];
    switch (table) {
      case "quickbooks_integration": {
        const wanted = params.find((p) => typeof p === "string" || typeof p === "number");
        return wanted === undefined
          ? CURRENT.integrations
          : CURRENT.integrations.filter((i) => String(i.companyId) === String(wanted));
      }
      case "quickbooks_sync": {
        if (params.includes("failed")) return CURRENT.failedSync;
        if (params.includes("pending")) return CURRENT.pendingSync;
        if (params.includes("synced")) return CURRENT.syncedRows;
        return [];
      }
      case "invoices": {
        // Two different reads live on this table: the queued-invoice count and
        // the newest payment sync. They are told apart by what was selected.
        if (keys.length === 1 && keys[0] === "n") {
          const byCompany = CURRENT.queuedInvoicesByCompany;
          if (!byCompany) return [{ n: CURRENT.queuedInvoices }];
          // The query names the companies it is counting for, so a tenant left
          // out of that list must contribute nothing.
          const asked = new Set(params.filter((p) => typeof p === "number"));
          const n = Object.entries(byCompany)
            .filter(([cid]) => asked.has(Number(cid)))
            .reduce((sum, [, count]) => sum + count, 0);
          return [{ n }];
        }
        if (keys.length === 1 && keys[0] === "at") return [{ at: CURRENT.lastPaymentSyncAt }];
        // The cross-tenant read groups by company — one row per tenant that has
        // ever been payment-synced, absent entirely for one that has not.
        if (keys.length === 2 && keys.includes("companyId") && keys.includes("at")) {
          return Object.entries(CURRENT.paymentSyncByCompany)
            .filter(([, at]) => at != null)
            .map(([companyId, at]) => ({ companyId: Number(companyId), at }));
        }
        return [];
      }
      default:
        return [];
    }
  }

  return builder;
}

// ── The three surfaces, mounted for real ────────────────────────────────────

interface Ctx {
  server: Server;
  base: string;
}
const SERVERS: Ctx[] = [];

let registerFinancialPulseRoutes: any;
let registerInvoiceListRoutes: any;
let registerManagerWorkspaceRoutes: any;

before(async () => {
  (db as any).select = (fields?: any) => stubSelect(fields);
  // The manager strip walks the approval queue before it reaches QuickBooks;
  // none of that is under test here, so it reads empty.
  (storage as any).getWorkOrders = async () => [];
  (storage as any).getAllBillingSheets = async () => [];
  (storage as any).getPendingParts = async () => [];
  (storage as any).getManualPartReviews = async () => [];

  // Imported after the patch so the route modules close over the stub.
  ({ registerFinancialPulseRoutes } = await import("./financial-pulse"));
  ({ registerInvoiceListRoutes } = await import("./invoice-list-routes"));
  ({ registerManagerWorkspaceRoutes } = await import("./manager-workspace-routes"));
});

after(async () => {
  await Promise.all(SERVERS.map((s) => new Promise<void>((r) => s.server.close(() => r()))));
});

function makeApp(role: string, companyId: number | null): Express {
  const app = express();
  app.use(express.json());
  const requireAuthentication: express.RequestHandler = (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserCompanyId = companyId;
    req.user = { id: 1, role, companyId };
    next();
  };
  const passthrough: express.RequestHandler = (_req, _res, next) => next();

  registerFinancialPulseRoutes(app, { requireAuthentication });
  registerManagerWorkspaceRoutes(app, { requireAuthentication });
  registerInvoiceListRoutes(app, {
    requireAuthentication,
    requireInvoiceRead: passthrough,
    applyPricingVisibility: (_req: any, data: any) => data,
    applyArNoteVisibility: (_req: any, data: any) => data,
    _storageApi: {
      // One invoice carrying the fixture's payment read, so the aggregate's
      // own `lastPaymentSyncAt` is the same fact the other two surfaces load
      // from the database rather than a second, luckier reading of it.
      getInvoices: async () => [
        {
          id: 1,
          customerId: 1,
          companyId: companyId ?? 7,
          invoiceNumber: "INV-1",
          status: "sent",
          totalAmount: "100.00",
          balanceDue: "100.00",
          amountPaid: "0.00",
          dueDate: new Date(Date.now() - 5 * DAY).toISOString(),
          createdAt: new Date(Date.now() - 10 * DAY).toISOString(),
          paymentSyncedAt: CURRENT.lastPaymentSyncAt
            ? CURRENT.lastPaymentSyncAt.toISOString()
            : null,
        },
      ],
      getInvoiceReminderSummaries: async () => new Map(),
      getInvoiceArNoteSummaries: async () => new Map(),
    },
    _loadPaymentTerms: async () => new Map(),
  });
  return app;
}

async function spin(role: string, companyId: number | null): Promise<Ctx> {
  const app = makeApp(role, companyId);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const ctx = { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  SERVERS.push(ctx);
  return ctx;
}

/** The verdict each of the three screens would show, in one call. */
async function verdicts(
  role: string,
  companyId: number | null,
): Promise<{
  financialPulse: QuickBooksHealth;
  managerWorkspace: QuickBooksHealth;
  invoicesHeader: QuickBooksHealth;
}> {
  const { base } = await spin(role, companyId);
  const [fp, mw, inv] = await Promise.all([
    fetch(`${base}/api/financial-pulse/kpis`),
    fetch(`${base}/api/manager-workspace/status-strip`),
    fetch(`${base}/api/invoices/aging-summary`),
  ]);
  assert.equal(fp.status, 200, "financial-pulse/kpis");
  assert.equal(mw.status, 200, "manager-workspace/status-strip");
  assert.equal(inv.status, 200, "invoices/aging-summary");
  const [fpBody, mwBody, invBody] = (await Promise.all([
    fp.json(),
    mw.json(),
    inv.json(),
  ])) as Array<{ quickbooks: QuickBooksHealth }>;
  return {
    financialPulse: fpBody.quickbooks,
    managerWorkspace: mwBody.quickbooks,
    invoicesHeader: invBody.quickbooks,
  };
}

/**
 * The contract. The strip is allowed to carry more detail than the other two
 * (it renders a fuller bar), so the comparison is over the shared verdict, not
 * over the whole payload — but never a different answer.
 */
function assertAllThreeAgree(v: {
  financialPulse: QuickBooksHealth;
  managerWorkspace: QuickBooksHealth;
  invoicesHeader: QuickBooksHealth;
}): QuickBooksHealth {
  for (const [name, got] of Object.entries(v)) {
    assert.ok(got, `${name} returned no verdict at all — that is a fourth answer`);
  }
  assert.deepEqual(
    { state: v.managerWorkspace.state, reason: v.managerWorkspace.reason },
    { state: v.financialPulse.state, reason: v.financialPulse.reason },
    "Manager Workspace and Financial Pulse disagree",
  );
  assert.deepEqual(
    { state: v.invoicesHeader.state, reason: v.invoicesHeader.reason },
    { state: v.financialPulse.state, reason: v.financialPulse.reason },
    "the invoices header disagrees with Financial Pulse",
  );
  return v.financialPulse;
}

// ── The derivation itself ───────────────────────────────────────────────────

describe("Task #2027 — one QuickBooks derivation", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const fresh = new Date(now.getTime() - HOUR).toISOString();
  const stale = new Date(now.getTime() - 3 * DAY).toISOString();

  it("a healthy company is ok, with nothing to warn about", () => {
    assert.deepEqual(
      deriveQbHealth({
        integrationCount: 1,
        connectionStatus: "connected",
        failedSyncCount: 0,
        pendingSync: 0,
        lastPaymentSyncAt: fresh,
        now,
      }),
      { state: "ok", reason: "healthy" },
    );
  });

  it("a connected company with a backed-up queue names the backlog, not the connection", () => {
    assert.deepEqual(
      deriveQbHealth({
        integrationCount: 1,
        connectionStatus: "connected",
        failedSyncCount: 0,
        pendingSync: 12,
        lastPaymentSyncAt: fresh,
        now,
      }),
      { state: "degraded", reason: "sync_backlog" },
    );
  });

  it("`expired` is a failure — the regression this ticket was found through", () => {
    // The flat client-side set treated `expired` as unhealthy; the server's
    // rank table had no entry for it, so it tied with `connected` and could
    // never become "worst". Consolidating on the server derivation without
    // this would have quietly dropped a real failure mode.
    assert.ok(QB_CONNECTION_RANK.expired > QB_CONNECTION_RANK.connected);
    assert.deepEqual(
      deriveQbHealth({
        integrationCount: 1,
        connectionStatus: "expired",
        failedSyncCount: 0,
        pendingSync: 0,
        lastPaymentSyncAt: fresh,
        now,
      }),
      { state: "down", reason: "connection" },
    );
  });

  it("a stale payment read degrades an otherwise-healthy company", () => {
    assert.deepEqual(
      deriveQbHealth({
        integrationCount: 1,
        connectionStatus: "connected",
        failedSyncCount: 0,
        pendingSync: 0,
        lastPaymentSyncAt: stale,
        now,
      }),
      { state: "degraded", reason: "stale_payment_sync" },
    );
  });

  it("a broken connection outranks a stale payment read", () => {
    assert.deepEqual(
      deriveQbHealth({
        integrationCount: 1,
        connectionStatus: "reconnect_required",
        failedSyncCount: 0,
        pendingSync: 4,
        lastPaymentSyncAt: stale,
        now,
      }),
      { state: "down", reason: "connection" },
    );
  });

  it("no integration at all is not a failure", () => {
    // A banner that is permanently on carries no information. A company that
    // has never connected QuickBooks reads as unknown, not as broken.
    assert.deepEqual(
      deriveQbHealth({
        integrationCount: 0,
        connectionStatus: null,
        failedSyncCount: 0,
        pendingSync: 0,
        lastPaymentSyncAt: null,
        now,
      }),
      { state: "unknown", reason: "not_configured" },
    );
  });

  it("an unrecognised status is not evidence of health", () => {
    assert.ok(qbConnectionRank("something_new") > QB_CONNECTION_RANK.connected);
    assert.equal(
      deriveQbHealth({
        integrationCount: 1,
        connectionStatus: "something_new",
        failedSyncCount: 0,
        pendingSync: 0,
        lastPaymentSyncAt: fresh,
        now,
      }).state,
      "degraded",
    );
  });

  it("never-synced payments count as stale", () => {
    assert.equal(isPaymentSyncStale(null, now), true);
    assert.equal(isPaymentSyncStale(fresh, now), false);
    assert.equal(isPaymentSyncStale(stale, now), true);
  });

  it("the worst connection status wins across several integrations", () => {
    const worst = worstConnectionStatus([
      { connectionStatus: "connected" },
      { connectionStatus: "reconnect_required" },
      { connectionStatus: "error" },
    ]);
    assert.equal(worst?.connectionStatus, "reconnect_required");
  });

  it("scope is resolved by one rule that cannot widen a caller's view", () => {
    const sa = { authenticatedUserRole: "super_admin", authenticatedUserCompanyId: null };
    assert.deepEqual(resolveQbScope(sa), { kind: "all" });
    assert.deepEqual(resolveQbScope(sa, { companyId: 7 }), { kind: "company", companyId: 7 });
    const admin = { authenticatedUserRole: "company_admin", authenticatedUserCompanyId: 7 };
    assert.deepEqual(resolveQbScope(admin), { kind: "company", companyId: 7 });
    // A scoped caller naming someone else's company is still pinned to her own.
    assert.deepEqual(resolveQbScope(admin, { companyId: 9 }), { kind: "company", companyId: 7 });
  });
});

// ── The agreement itself ────────────────────────────────────────────────────

describe("Task #2027 — the three screens agree", () => {
  it("a connected company with a backed-up queue: same non-ok state everywhere", async () => {
    CURRENT = fixture({ queuedInvoices: 9 });
    const v = await verdicts("company_admin", 7);
    const shared = assertAllThreeAgree(v);
    assert.equal(shared.state, "degraded");
    // The banner has to name the backlog. Its old copy blamed the connection
    // whatever the cause.
    assert.equal(shared.reason, "sync_backlog");
    assert.equal(shared.connectionStatus, "connected");
    assert.ok(shared.pendingSync >= 9);
  });

  it("a healthy company: no warning on any of the three", async () => {
    CURRENT = fixture();
    const shared = assertAllThreeAgree(await verdicts("company_admin", 7));
    assert.equal(shared.state, "ok");
    assert.equal(shared.reason, "healthy");
  });

  it("an expired token: all three report it, none of them reports ok", async () => {
    CURRENT = fixture({
      integrations: [integration({ connectionStatus: "expired" })],
    });
    const shared = assertAllThreeAgree(await verdicts("company_admin", 7));
    assert.equal(shared.state, "down");
    assert.equal(shared.reason, "connection");
  });

  it("healthy connection, day-old payment read: the header cannot contradict the other two", async () => {
    // This is the exact shape of the observed defect — the invoices pill said
    // "QuickBooks: out of date" off this one timestamp while the other two
    // read the connection and said ok.
    CURRENT = fixture({ lastPaymentSyncAt: new Date(Date.now() - 3 * DAY) });
    const shared = assertAllThreeAgree(await verdicts("company_admin", 7));
    assert.equal(shared.state, "degraded");
    assert.equal(shared.reason, "stale_payment_sync");
  });

  it("reconnect_required on one of several integrations wins for a super_admin", async () => {
    CURRENT = fixture({
      integrations: [
        integration({ id: 1, companyId: "7", connectionStatus: "connected" }),
        integration({
          id: 2,
          companyId: "8",
          connectionStatus: "reconnect_required",
          reconnectRequiredReason: "Refresh token revoked",
        }),
        integration({ id: 3, companyId: "9", connectionStatus: "error" }),
      ],
      paymentSyncByCompany: {
        "7": new Date(Date.now() - 1 * HOUR),
        "8": new Date(Date.now() - 1 * HOUR),
        "9": new Date(Date.now() - 1 * HOUR),
      },
    });
    const shared = assertAllThreeAgree(await verdicts("super_admin", null));
    assert.equal(shared.state, "down");
    assert.equal(shared.connectionStatus, "reconnect_required");
    assert.equal(shared.reconnectRequiredReason, "Refresh token revoked");
  });

  it("an irrigation manager gets a real verdict on Financial Pulse", async () => {
    // The banner used to be driven by /api/quickbooks/connection, which is
    // gated on CAN_MANAGE_QUICKBOOKS. An irrigation manager got a 403, the
    // client swallowed it, and the banner silently never showed — a fourth
    // answer, "no answer", for a role the page admits.
    CURRENT = fixture({ integrations: [integration({ connectionStatus: "expired" })] });
    const { base } = await spin("irrigation_manager", 7);
    const r = await fetch(`${base}/api/financial-pulse/kpis`);
    assert.equal(r.status, 200);
    const body = (await r.json()) as { quickbooks?: QuickBooksHealth };
    assert.ok(body.quickbooks, "irrigation_manager received no QuickBooks verdict");
    assert.equal(body.quickbooks!.state, "down");
  });

  it("tenancy: a company's verdict is computed only from its own integrations", async () => {
    // Company 7 is healthy; company 8 is not. A company 7 caller must not
    // inherit company 8's failure, and a super_admin must still see it.
    CURRENT = fixture({
      integrations: [
        integration({ id: 1, companyId: "7", connectionStatus: "connected" }),
        integration({ id: 2, companyId: "8", connectionStatus: "reconnect_required" }),
      ],
      paymentSyncByCompany: {
        "7": new Date(Date.now() - 1 * HOUR),
        "8": new Date(Date.now() - 1 * HOUR),
      },
    });

    const scoped = assertAllThreeAgree(await verdicts("company_admin", 7));
    assert.equal(scoped.state, "ok", "company 7 inherited another tenant's broken connection");

    const rollup = assertAllThreeAgree(await verdicts("super_admin", null));
    assert.equal(rollup.state, "down", "the super_admin rollup lost a broken tenant");
  });

  it("tenancy: one tenant's fresh payment read cannot hide another's stale one", async () => {
    // Payment sync runs per company. A global MAX over payment_synced_at would
    // let the busiest tenant's five-minute-old read speak for a tenant that has
    // not synced in three days — a false green on the one signal that says
    // whether the balances can be trusted. Connection status is worst-wins;
    // this must be too, or the rollup contradicts itself about which tenant
    // decides the verdict.
    CURRENT = fixture({
      integrations: [
        integration({ id: 1, companyId: "7", connectionStatus: "connected" }),
        integration({ id: 2, companyId: "8", connectionStatus: "connected" }),
      ],
      paymentSyncByCompany: {
        "7": new Date(Date.now() - 5 * 60 * 1000),
        "8": new Date(Date.now() - 3 * DAY),
      },
    });

    const scoped = assertAllThreeAgree(await verdicts("company_admin", 7));
    assert.equal(scoped.state, "ok", "company 7 inherited another tenant's stale payment read");

    const rollup = assertAllThreeAgree(await verdicts("super_admin", null));
    assert.equal(rollup.state, "degraded", "a fresh tenant masked a stale one in the rollup");
    assert.equal(rollup.reason, "stale_payment_sync");
  });

  it("tenancy: a connected tenant that has never been payment-synced degrades the rollup", async () => {
    // Absent is worse than old, and `null` is how the derivation spells it.
    CURRENT = fixture({
      integrations: [
        integration({ id: 1, companyId: "7", connectionStatus: "connected" }),
        integration({ id: 2, companyId: "8", connectionStatus: "connected" }),
      ],
      paymentSyncByCompany: { "7": new Date(Date.now() - 5 * 60 * 1000) },
    });

    const rollup = assertAllThreeAgree(await verdicts("super_admin", null));
    assert.equal(rollup.state, "degraded");
    assert.equal(rollup.reason, "stale_payment_sync");
    assert.equal(rollup.lastPaymentSyncAt, null);
  });

  it("a company nobody connected does not drag the rollup down", async () => {
    // Only tenants with an integration have a payment read that can be stale
    // or a queue that can be backed up. An invoice at an unconnected company
    // has nowhere to go: counting it reports a backlog no reconnection and no
    // sync run could ever clear, which is a warning that can never be acted on
    // and therefore stops being read.
    CURRENT = fixture({
      integrations: [integration({ id: 1, companyId: "7", connectionStatus: "connected" })],
      paymentSyncByCompany: {
        "7": new Date(Date.now() - 5 * 60 * 1000),
        // Company 8 has no integration row and has never synced.
      },
      // Company 8's finalized invoices have no QuickBooks id and never will.
      queuedInvoicesByCompany: { "8": 4 },
    });

    const rollup = assertAllThreeAgree(await verdicts("super_admin", null));
    assert.equal(rollup.state, "ok", "an unconnected tenant's invoices read as a backlog");
    assert.equal(rollup.pendingSync, 0);
  });
});

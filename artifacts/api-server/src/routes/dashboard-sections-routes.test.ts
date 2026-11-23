import assert from "node:assert/strict";
import { after, before, describe, it, mock, type TestContext } from "node:test";
import type { Server } from "node:http";
import express, { type RequestHandler } from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { customers, users, wetCheckFindings, wetChecks } from "@workspace/db/schema";
import type { DashboardSectionsResponse, DashboardTileKey } from "@workspace/shared";
import { db } from "../db";
import type { DashboardData } from "./dashboard-sections-routes";
import type { InvoiceRowLike } from "./invoice-list-routes";

// Importing storage starts legacy boot queries. Stub those separately so the
// route fixtures can reject any write without intercepting unrelated startup.
const startupUsers = mock.method(db, "select", () => ({
  from: (table: unknown) => {
    assert.equal(table, users);
    return Promise.resolve([{ id: 1 }]);
  },
}));
const startupMigrations = mock.method(db, "execute", async () => ({ rows: [{ value: "completed" }] }));
const { storage } = await import("../storage");
const { buildDashboardSections, registerDashboardSectionsRoutes } = await import("./dashboard-sections-routes");
const { annotateInvoiceForAr, summarizeAging } = await import("./invoice-list-routes");
const { registerManagerWorkspaceRoutes } = await import("./manager-workspace-routes");
startupUsers.mock.restore();
startupMigrations.mock.restore();

const now = new Date("2026-03-15T12:00:00.000Z");
const daysAgo = (days: number, extraMinutes = 0) => new Date(now.getTime() - days * 86_400_000 - extraMinutes * 60_000).toISOString();
const tileOrder: DashboardTileKey[] = [
  "wet-checks", "estimates", "work-orders", "billing-sheets",
  "approvals", "ready-to-bill", "invoices", "parts",
];
const wo = {
  customerName: "Customer", workOrderNumber: "WO-1", status: "pending",
  createdAt: daysAgo(0), updatedAt: daysAgo(0),
};
const sheet = {
  customerName: "Customer", status: "draft", createdAt: daysAgo(0),
  updatedAt: daysAgo(0), workDate: daysAgo(0),
};
const wetCheck = { customerId: 1, customerName: "Original name", createdAt: daysAgo(0) };
const estimate = { estimateNumber: "EST-1", customerName: "Customer", createdAt: daysAgo(0) };
const invoice: InvoiceRowLike = {
  id: 1, customerId: 1, customerName: "Customer", customerEmail: "",
  invoiceNumber: "INV-1", status: "sent", totalAmount: "100.00", createdAt: daysAgo(5),
};

function invoiceData(...invoices: InvoiceRowLike[]): NonNullable<DashboardData["invoices"]> {
  const rows = invoices.map((row) => annotateInvoiceForAr(row, "Net 30", now));
  return { rows, agingSummary: summarizeAging(rows) };
}

function fixture(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    wetChecksPendingReview: [], customers: new Map([[1, "Current customer name"]]),
    estimates: [], workOrders: [], billingSheets: [], wetCheckBillings: [],
    wetChecksInProgress: [], invoices: invoiceData(), parts: [], manualPartReviews: [],
    ...overrides,
  };
}

const tile = (key: DashboardTileKey, data: Partial<DashboardData>) =>
  buildDashboardSections("company_admin", fixture(data), now).tiles.find((t) => t.key === key);

describe("buildDashboardSections", () => {
  it("counts the wet-check review queue with a strict 2-day cutoff and the current customer name", () => {
    assert.deepEqual(tile("wet-checks", {
      wetChecksPendingReview: [
        { ...wetCheck, createdAt: daysAgo(7), submittedAt: daysAgo(2) },
        { ...wetCheck, createdAt: daysAgo(2, 1), submittedAt: null },
      ],
    }), {
      key: "wet-checks", total: 2, overdue: 1,
      oldest: { label: "Current customer name", verb: "Submitted", at: daysAgo(2, 1) },
    });
  });

  it("ages estimates at 14 days and uses the send or creation date and verb", () => {
    const sent = { ...estimate, approvalSentAt: daysAgo(14, 1), createdAt: daysAgo(40) };
    const created = { ...estimate, estimateNumber: "EST-2", createdAt: daysAgo(14) };
    assert.deepEqual(tile("estimates", { estimates: [created, sent] }), {
      key: "estimates", total: 2, overdue: 1,
      oldest: { label: "EST-1 · Customer", verb: "Sent", at: daysAgo(14, 1) },
    });
    assert.deepEqual(tile("estimates", { estimates: [created] }), {
      key: "estimates", total: 1, overdue: 0,
      oldest: { label: "EST-2 · Customer", verb: "Created", at: daysAgo(14) },
    });
  });

  it("counts only open work orders and ages them at 30 days", () => {
    assert.deepEqual(tile("work-orders", {
      workOrders: [
        { ...wo, createdAt: daysAgo(30) },
        { ...wo, status: "assigned", createdAt: daysAgo(30, 1), workOrderNumber: "WO-2" },
        { ...wo, status: "in_progress" },
        { ...wo, status: "work_completed", createdAt: daysAgo(60) },
      ],
    }), {
      key: "work-orders", total: 3, overdue: 1,
      oldest: { label: "WO-2 · Customer", verb: "Opened", at: daysAgo(30, 1) },
    });
  });

  it("ages draft billing sheets at 3 days from creation, excluding submitted sheets", () => {
    assert.deepEqual(tile("billing-sheets", {
      billingSheets: [
        { ...sheet, createdAt: daysAgo(3) },
        { ...sheet, customerName: "Old draft", createdAt: daysAgo(3, 1) },
        { ...sheet, status: "submitted", createdAt: daysAgo(10) },
      ],
    }), {
      key: "billing-sheets", total: 2, overdue: 1,
      oldest: { label: "Old draft", verb: "Started", at: daysAgo(3, 1) },
    });
  });

  it("ages uninvoiced approvals at 3 days using work-order completion or update and sheet update", () => {
    assert.deepEqual(tile("approvals", {
      workOrders: [
        { ...wo, status: "work_completed", completedAt: daysAgo(3), updatedAt: daysAgo(7) },
        { ...wo, status: "pending_manager_review", completedAt: null, updatedAt: daysAgo(3, 1) },
        { ...wo, status: "work_completed", invoiceId: 42, updatedAt: daysAgo(12) },
      ],
      billingSheets: [
        { ...sheet, status: "completed", customerName: "Waiting sheet", updatedAt: daysAgo(4) },
        { ...sheet, status: "submitted", createdAt: daysAgo(12), updatedAt: daysAgo(3) },
        { ...sheet, status: "pending_manager_review", invoiceId: 42, updatedAt: daysAgo(12) },
      ],
    }), {
      key: "approvals", total: 4, overdue: 2,
      oldest: { label: "Waiting sheet", verb: "Waiting since", at: daysAgo(4) },
    });
  });

  it("ages approved, uninvoiced work strictly before midnight UTC at the start of the month", () => {
    const priorMonth = "2026-02-28T23:59:59.999Z";
    const monthStart = "2026-03-01T00:00:00.000Z";
    const status = "approved_passed_to_billing";
    assert.deepEqual(tile("ready-to-bill", {
      workOrders: [
        { ...wo, status, customerName: "Last month's work", completedAt: priorMonth },
        { ...wo, status, completedAt: monthStart, createdAt: daysAgo(30) },
        { ...wo, status, completedAt: null, createdAt: monthStart },
        { ...wo, status, completedAt: daysAgo(30), invoiceId: 1 },
        { ...wo, status, completedAt: daysAgo(30), returnedForCorrectionAt: monthStart },
      ],
      billingSheets: [{ ...sheet, status, createdAt: daysAgo(30), workDate: monthStart }],
      wetCheckBillings: [
        { customerName: "Prior month snapshot", status, workDate: priorMonth },
        { customerName: "Billed snapshot", status, invoiceId: 1, workDate: daysAgo(30) },
      ],
    }), {
      key: "ready-to-bill", total: 5, overdue: 2,
      oldest: { label: "Last month's work", verb: "Worked", at: priorMonth },
    });
  });

  it("uses the aging buckets and the earliest effective due date for only positive, open invoices", () => {
    const data = fixture({ invoices: invoiceData(
      { ...invoice, dueDate: daysAgo(-1) },
      { ...invoice, id: 9, dueDate: daysAgo(0) }, // Day zero belongs to days30.
      { ...invoice, id: 2, dueDate: daysAgo(1), paymentSyncedAt: now, balance: "12.34" },
      { ...invoice, id: 3, dueDate: daysAgo(40), paymentSyncedAt: now, balance: "10.01" },
      { ...invoice, id: 4, createdAt: daysAgo(120), invoiceNumber: "INV-4" }, // Net 30, due 90 days ago.
      { ...invoice, id: 5, dueDate: daysAgo(200), paymentStatus: "paid" },
      { ...invoice, id: 6, dueDate: daysAgo(200), paymentSyncedAt: now, balance: "0.00" },
      { ...invoice, id: 7, dueDate: daysAgo(200), paymentSyncedAt: now, balance: "-1.00" },
      { ...invoice, id: 8, dueDate: daysAgo(200), status: "draft" },
    ) });
    const result = buildDashboardSections("company_admin", data, now);
    assert.deepEqual(result.tiles.find((t) => t.key === "invoices"), {
      key: "invoices", total: 5, overdue: 4,
      oldest: { label: "INV-4 · Customer", verb: "Due", at: daysAgo(90) },
    });
    assert.deepEqual(result.money, {
      openInvoiceBalance: "322.35", pastDueBalance: "222.35", readyToBillCount: 0,
    });
  });

  it("combines parts and manual reviews with a strict 7-day cutoff", () => {
    assert.deepEqual(tile("parts", {
      parts: [{ name: "Part", createdAt: daysAgo(7) }],
      manualPartReviews: [{ partName: "Review", createdAt: daysAgo(7, 1) }],
    }), {
      key: "parts", total: 2, overdue: 1,
      oldest: { label: "Review", verb: "Added", at: daysAgo(7, 1) },
    });
  });

  it("filters tiles in fixed order and exposes field and money only to their roles", () => {
    const data = fixture({
      workOrders: [
        { ...wo, status: "in_progress", assignedTechnicianId: 1 },
        { ...wo, status: "in_progress", assignedTechnicianId: null },
        { ...wo, status: "assigned", assignedTechnicianId: 2 },
        { ...wo, status: "approved_passed_to_billing" },
      ],
      wetChecksInProgress: [
        { technicianId: 1, count: 1 }, { technicianId: 3, count: 2 }, { technicianId: null, count: 1 },
      ],
    });
    const build = (role: string) => buildDashboardSections(role, data, now);
    const keys = (result: DashboardSectionsResponse) => result.tiles.map(({ key }) => key);
    const admin = build("company_admin");
    assert.deepEqual(keys(admin), tileOrder);
    assert.deepEqual(admin.field, { workOrdersInProgress: 2, wetChecksInProgress: 4, techsOnActiveWork: 2 });
    assert.equal(admin.money?.readyToBillCount, 1);
    const irrigation = build("irrigation_manager");
    assert.deepEqual(keys(irrigation), tileOrder.slice(0, 5));
    assert.deepEqual(irrigation.field, admin.field);
    assert.equal(irrigation.money, null);
    const billing = build("billing_manager");
    assert.deepEqual(keys(billing), tileOrder);
    assert.equal(billing.field, null);
    assert.deepEqual(billing.money, admin.money);
    const bookkeeper = build("bookkeeper");
    assert.deepEqual(keys(bookkeeper), ["invoices"]);
    assert.equal(bookkeeper.field, null);
    assert.deepEqual(bookkeeper.money, { openInvoiceBalance: "0.00", pastDueBalance: "0.00", readyToBillCount: null });
  });

  it("returns zero counts and no oldest item for an empty company", () => {
    const result = buildDashboardSections("company_admin", fixture(), now);
    assert.equal(result.generatedAt, now.toISOString());
    assert.deepEqual(result.tiles, tileOrder.map((key) => ({ key, total: 0, overdue: 0, oldest: null })));
  });
});

describe("GET /api/dashboard/sections", () => {
  let server: Server;
  let base: string;
  let role = "company_admin";
  let companyId: number | null = 1;
  let loggedError: unknown;
  const path = "/api/dashboard/sections";

  before(async () => {
    const app = express();
    const requireAuthentication: RequestHandler = (req, _res, next) => {
      req.authenticatedUserRole = role;
      req.authenticatedUserCompanyId = companyId;
      Object.assign(req, { log: { error: ({ err }: { err: unknown }) => { loggedError = err; } } });
      next();
    };
    registerManagerWorkspaceRoutes(app, { requireAuthentication });
    registerDashboardSectionsRoutes(app, { requireAuthentication });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  function seedCompanies(t: TestContext, { largeWetCheckQueues = false } = {}) {
    t.mock.timers.enable({ apis: ["Date"], now });
    const calls: Array<[string, number | null, ...unknown[]]> = [];
    const rows = <T extends object>(build: (cid: number, name: string, at: string) => T[]) =>
      [1, 2].flatMap((cid) => build(cid, cid === 1 ? "Acme" : "Beta", daysAgo(cid * 40))
        .map((row) => ({ ...row, companyId: cid })));
    const stub = <T extends { companyId: number }>(method: keyof typeof storage, records: T[]) => {
      t.mock.method(storage, method, async (cid: number | null, ...opts: unknown[]) => {
        calls.push([method, cid, ...opts]);
        return cid == null ? records : records.filter((row) => row.companyId === cid);
      });
    };
    stub("getCustomers", rows((cid, name) => [{ id: cid, name }]));
    if (!largeWetCheckQueues) {
      stub("listWetChecksPendingReview", rows((cid, customerName, at) => [{ ...wetCheck, customerId: cid, customerName, submittedAt: at }]));
    }
    stub("getEstimatesPendingApproval", rows((cid, customerName, at) => [{ ...estimate, estimateNumber: `EST-${cid}`, customerName, createdAt: at }]));
    stub("getWorkOrders", rows((cid, customerName, at) => [
      { ...wo, workOrderNumber: `WO-${cid}`, customerName, createdAt: at, status: "in_progress", assignedTechnicianId: cid },
      { ...wo, customerName, status: "work_completed", completedAt: at, assignedTechnicianId: null },
      { ...wo, customerName, status: "work_completed", completedAt: at, invoiceId: cid },
    ]));
    stub("getAllBillingSheets", rows((_cid, customerName, at) => [
      { ...sheet, customerName, createdAt: at },
      { ...sheet, customerName, updatedAt: at, status: "completed", technicianId: null },
    ]));
    stub("getAllWetCheckBillingsWithCounts", rows((customerId, customerName, workDate) => [
      { customerId, customerName, workDate, status: "approved_passed_to_billing" },
    ]));
    const activeWetChecks = rows((cid) => [
      ...Array.from({ length: largeWetCheckQueues ? 200 : 1 }, () => ({ technicianId: cid, status: "in_progress" })),
      ...(largeWetCheckQueues ? [
        { technicianId: cid + 10, status: "in_progress" },
        { technicianId: cid + 20, status: "submitted" },
      ] : []),
    ]);
    const pendingReviews = largeWetCheckQueues
      ? rows((cid, customerName) => Array.from({ length: 201 }, (_, i) => ({
        ...wetCheck, id: cid * 1000 + i, customerId: cid, customerName, status: "submitted",
        submittedAt: i === 200 ? daysAgo(90) : daysAgo(1),
      })))
      : [];
    stub("getPendingParts", rows((_cid, name, createdAt) => [{ name: `${name} part`, createdAt }]));
    stub("getManualPartReviews", rows((_cid, name, createdAt) => [{ partName: `${name} review`, createdAt }]));
    stub("getInvoices", rows((cid, customerName, createdAt) => [
      { ...invoice, customerId: cid, id: cid, invoiceNumber: `INV-${cid}`, customerName, createdAt, totalAmount: `${cid}00.00` },
    ]));
    t.mock.method(storage, "getInvoiceReminderSummaries", async (cid: number) => {
      calls.push(["getInvoiceReminderSummaries", cid]);
      return new Map();
    });
    t.mock.method(db, "select", (fields?: { technicianId?: unknown; count?: Parameters<PgDialect["sqlToQuery"]>[0] }) => ({
      from(table: unknown) {
        return {
          where(condition: Parameters<PgDialect["sqlToQuery"]>[0]) {
            const { sql, params } = new PgDialect().sqlToQuery(condition);
            if (table === wetChecks && fields?.technicianId) {
              assert.equal(fields.technicianId, wetChecks.technicianId);
              assert.ok(fields.count);
              assert.match(new PgDialect().sqlToQuery(fields.count).sql, /count\(\*\)/);
              assert.match(sql, /"wet_checks"\."company_id" = \$1.*"wet_checks"\."status" = \$2/);
              const [cid, status] = params as [number, string];
              calls.push(["getInProgressWetCheckCounts", cid, status]);
              return {
                async groupBy(column: unknown) {
                  assert.equal(column, wetChecks.technicianId);
                  const counts = new Map<number, number>();
                  for (const row of activeWetChecks) {
                    if (row.companyId === cid && row.status === status) {
                      counts.set(row.technicianId, (counts.get(row.technicianId) ?? 0) + 1);
                    }
                  }
                  return Array.from(counts, ([technicianId, count]) => ({ technicianId, count }));
                },
              };
            }
            if (table === wetChecks && largeWetCheckQueues) {
              assert.match(sql, /"wet_checks"\."company_id" = \$1.*"wet_checks"\."status" in/);
              const [cid, ...statuses] = params as [number, ...string[]];
              return {
                orderBy: () => ({
                  async limit(limit: number) {
                    return pendingReviews.filter((row) => row.companyId === cid && statuses.includes(row.status))
                      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, limit);
                  },
                }),
              };
            }
            if (table === wetCheckFindings && largeWetCheckQueues) {
              return Promise.resolve(params.map((wetCheckId) => ({ wetCheckId, resolution: "pending" })));
            }
            assert.equal(table, customers);
            if (largeWetCheckQueues) return Promise.resolve(params.map((id) => ({ id, laborRate: "45" })));
            assert.match(sql, /"customers"\."company_id" = \$2/);
            const [id, cid] = params as [number, number];
            calls.push(["paymentTerms", cid, id]);
            return Promise.resolve(id === cid ? [{ id, paymentTerms: "Net 30" }] : []);
          },
        };
      },
    }));
    for (const method of ["insert", "update", "delete", "execute"] as const) {
      t.mock.method(db, method, () => assert.fail(`Dashboard must not call db.${method}`));
    }
    return calls;
  }

  it("rejects excluded roles and a manager without a company before doing any reads", async (t) => {
    const calls = seedCompanies(t);
    companyId = 1;
    for (role of ["super_admin", "field_tech", "system_documenter", "unknown"]) {
      const res = await fetch(`${base}${path}?companyId=2`);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { message: "No dashboard for this role" });
    }
    role = "irrigation_manager";
    companyId = null;
    const res = await fetch(`${base}${path}?companyId=2`);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { message: "No company context" });
    assert.deepEqual(calls, []);
  });

  it("scopes every read to the authenticated company, ignoring companyId in the query", async (t) => {
    const calls = seedCompanies(t);
    role = "company_admin";
    companyId = 1;
    let first: DashboardSectionsResponse | undefined;
    for (const query of ["", "?companyId=2"]) {
      calls.length = 0;
      const res = await fetch(`${base}${path}${query}`);
      assert.equal(res.status, 200);
      const result = await res.json() as DashboardSectionsResponse;
      assert.deepEqual(result.tiles.map(({ key, total }) => [key, total]), tileOrder.map((key) =>
        [key, key === "approvals" || key === "parts" ? 2 : 1],
      ));
      assert.doesNotMatch(JSON.stringify(result), /Beta/);
      assert.deepEqual(result.money, { openInvoiceBalance: "100.00", pastDueBalance: "100.00", readyToBillCount: 1 });
      assert.deepEqual(result.field, { workOrdersInProgress: 1, wetChecksInProgress: 1, techsOnActiveWork: 1 });
      assert.equal(calls.length, 12);
      assert.equal(new Set(calls.map(([method]) => method)).size, calls.length);
      assert.ok(calls.every(([, cid]) => cid === 1));
      assert.deepEqual(calls.find(([method]) => method === "getInProgressWetCheckCounts"), ["getInProgressWetCheckCounts", 1, "in_progress"]);
      if (first) assert.deepEqual(result, first);
      first = result;
    }
    const badge = await fetch(`${base}/api/manager-workspace/needs-approval/count`);
    assert.equal(badge.status, 200);
    assert.deepEqual(await badge.json(), { workOrderCount: 1, billingSheetCount: 1, total: 2 });
  });

  it("only loads invoice data for a bookkeeper and hides field and ready-to-bill numbers", async (t) => {
    const calls = seedCompanies(t);
    role = "bookkeeper";
    companyId = 1;
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    const result = await res.json() as DashboardSectionsResponse;
    assert.deepEqual(result.tiles.map(({ key }) => key), ["invoices"]);
    assert.equal(result.field, null);
    assert.deepEqual(result.money, { openInvoiceBalance: "100.00", pastDueBalance: "100.00", readyToBillCount: null });
    assert.deepEqual(calls, [["getInvoices", 1], ["paymentTerms", 1, 1], ["getInvoiceReminderSummaries", 1]]);
  });

  it("does not read billing queues for an irrigation manager or field activity for a billing manager", async (t) => {
    const calls = seedCompanies(t);
    companyId = 1;
    role = "irrigation_manager";
    const irrigation = await fetch(`${base}${path}`);
    assert.equal(irrigation.status, 200);
    assert.equal((await irrigation.json() as DashboardSectionsResponse).money, null);
    assert.deepEqual(calls.map(([method]) => method).sort(), [
      "getAllBillingSheets", "getCustomers", "getEstimatesPendingApproval", "getInProgressWetCheckCounts",
      "getWorkOrders", "listWetChecksPendingReview",
    ]);
    calls.length = 0;
    role = "billing_manager";
    const billing = await fetch(`${base}${path}`);
    assert.equal(billing.status, 200);
    assert.equal((await billing.json() as DashboardSectionsResponse).field, null);
    assert.equal(calls.some(([method]) => method === "getInProgressWetCheckCounts"), false);
  });

  it("keeps the badge's 200-review cap but counts all active checks and their technicians", async (t) => {
    seedCompanies(t, { largeWetCheckQueues: true });
    role = "irrigation_manager";
    companyId = 1;
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    const result = await res.json() as DashboardSectionsResponse;
    const badgeRows = await storage.listWetChecksPendingReview(companyId);
    assert.equal(badgeRows.length, 200);
    assert.deepEqual(result.tiles.find(({ key }) => key === "wet-checks"), {
      key: "wet-checks", total: badgeRows.length, overdue: 0,
      oldest: { label: "Acme", verb: "Submitted", at: daysAgo(1) },
    });
    assert.deepEqual(result.field, { workOrdersInProgress: 1, wetChecksInProgress: 201, techsOnActiveWork: 2 });
  });

  it("logs a read failure and returns the dashboard error without a partial response", async (t) => {
    seedCompanies(t);
    role = "bookkeeper";
    companyId = 1;
    const failure = new Error("invoice read failed");
    t.mock.method(storage, "getInvoices", async () => { throw failure; });
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { message: "Failed to load dashboard" });
    assert.equal(loggedError, failure);
  });
});

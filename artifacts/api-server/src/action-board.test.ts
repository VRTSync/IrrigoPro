import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildActionBoardRow } from "./routes/manager-workspace-routes";
import { buildBudgetStatusRow } from "./routes/budget-routes";
import express from "express";
import { registerManagerWorkspaceRoutes, _setWorkOrdersForTests, _setWetChecksForTests, _setActionBoardCustomersForTests, _setActionBoardAllocationsForTests, _setActionBoardSpendForTests, _resetManagerWorkspaceOverridesForTests } from "./routes/manager-workspace-routes";

const customer = { id: 1, name: "Property", annualBudgetGoal: "12000" };
function row(total: number, allocation = 1000, work: any[] = [], check: any = null, month = 9) {
  return buildActionBoardRow({
    customer,
    budget: buildBudgetStatusRow({
      customer,
      allocation,
      monthSpend: { invoiced: total, pendingNotBilled: 0, total },
      seasonTarget: 0,
      seasonSpend: { invoiced: total, pendingNotBilled: 0, total },
    }),
    openWorkOrders: work, newestWetCheck: check, year: 2026, month,
  });
}

describe("Action Board lane boundaries", () => {
  it("uses the creation gate's inspection verdict at positive, zero and negative headroom", () => {
    assert.equal(row(999).inspectionOnly, false);
    assert.equal(row(1000).inspectionOnly, true);
    assert.equal(row(1001).inspectionOnly, true);
    const unbudgeted = buildActionBoardRow({
      customer,
      budget: buildBudgetStatusRow({
        customer,
        allocation: null,
        monthSpend: { invoiced: 0, pendingNotBilled: 0, total: 0 },
        seasonTarget: 0,
        seasonSpend: { invoiced: 0, pendingNotBilled: 0, total: 0 },
      }),
      openWorkOrders: [],
      newestWetCheck: null,
      year: 2026,
      month: 9,
    });
    assert.equal(unbudgeted.inspectionOnly, false);
  });
  it("covers fit, exceed, exact zero, due headroom, and nothing pending", () => {
    assert.equal(row(500, 1000, [{ estimatedTotal: 500 }]).lane, "clear_to_send");
    assert.equal(row(500, 1000, [{ estimatedTotal: 501 }]).lane, "over_budget_nothing_approved");
    assert.equal(row(1000, 1000, [{ estimatedTotal: 1 }]).lane, "over_budget_nothing_approved");
    assert.equal(row(500, 1000, [], { status: "in_progress", startedAt: "2026-09-03" }).lane, "clear_to_send");
    assert.equal(row(500, 1000, [], { status: "submitted", startedAt: "2026-09-03" }).lane, "nothing_pending");
  });

  it("keeps null estimates unknown and marks estimates as pre-approved", () => {
    const unknown = row(0, 1000, [{ estimatedTotal: null, workType: "direct_billing" }]);
    assert.equal(unknown.hasUnknownEstimate, true);
    assert.equal(unknown.lane, "over_budget_nothing_approved");
    const approved = row(1500, 1000, [{ estimatedTotal: 400, estimateId: 9 }]);
    assert.equal(approved.lane, "clear_to_send");
    assert.equal(approved.preApproved, true);
    assert.equal(approved.openWorkOrders[0].preApproved, true);
  });

  it("normalizes decimal estimate strings once for both fit and response", () => {
    const result = row(0, 1000, [
      { estimatedTotal: "12.50" },
      { estimatedTotal: "7.125" },
    ]);
    assert.equal(result.openWorkOrderTotal, 19.625);
    assert.equal(result.openWorkOrders[0].estimatedTotal, 12.5);
    assert.equal(result.openWorkOrders[1].estimatedTotal, 7.125);
  });

  it("uses startedAt month and lifecycle, including null submittedAt", () => {
    assert.equal(row(500, 1000, [], { status: "submitted", submittedAt: null, startedAt: "2026-09-30" }, 9).lane, "nothing_pending");
    assert.equal(row(500, 1000, [], { status: "submitted", startedAt: "2026-09-30" }, 10).lane, "clear_to_send");
    assert.equal(row(500, 1000, [], { status: "in_progress", startedAt: "2026-09-30" }, 9).wetCheckDue, true);
    const historical = buildActionBoardRow({
      customer,
      budget: row(500).budget,
      openWorkOrders: [],
      newestWetCheck: { status: "submitted", startedAt: "2026-10-05" },
      wetChecks: [
        { status: "submitted", startedAt: "2026-09-30" },
        { status: "approved", startedAt: "2026-10-05" },
      ],
      year: 2026,
      month: 9,
    });
    assert.equal(historical.wetCheckDue, false);
  });
});

describe("Action Board endpoint authorization and tenant boundary", () => {
  it("denies field tech and bookkeeper and requires super-admin company scope", async () => {
    const app = express();
    let role = "field_tech";
    const auth = (req: any, _res: any, next: any) => {
      req.authenticatedUserRole = role;
      req.authenticatedUserCompanyId = 1;
      next();
    };
    registerManagerWorkspaceRoutes(app, { requireAuthentication: auth });
    const server = app.listen(0);
    try {
      const port = (server.address() as any).port;
      let response = await fetch(`http://127.0.0.1:${port}/api/action-board`);
      assert.equal(response.status, 403);
      role = "bookkeeper";
      response = await fetch(`http://127.0.0.1:${port}/api/action-board`);
      assert.equal(response.status, 403);
      role = "super_admin";
      response = await fetch(`http://127.0.0.1:${port}/api/action-board`);
      assert.equal(response.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not let an ordinary manager query another company", async () => {
    _setActionBoardCustomersForTests(async () => [
      { ...customer, id: 1, companyId: 1 },
      { ...customer, id: 2, companyId: 2 },
    ]);
    _setActionBoardAllocationsForTests(async (_company, ids) =>
      new Map(ids.filter((id) => id === 1).map((id) => [id, 1000])));
    _setActionBoardSpendForTests(async () => ({ invoiced: 100, pendingNotBilled: 0, total: 100 }));
    _setWorkOrdersForTests(async () => [
      { id: 1, companyId: 1, customerId: 1, status: "pending", estimatedTotal: "10" },
      { id: 2, companyId: 2, customerId: 2, status: "pending", estimatedTotal: "10" },
    ]);
    _setWetChecksForTests(async () => [
      { id: 1, companyId: 1, customerId: 1, status: "in_progress", startedAt: "2026-09-01" },
      { id: 2, companyId: 2, customerId: 2, status: "in_progress", startedAt: "2026-09-01" },
    ]);
    const app = express();
    const auth = (req: any, _res: any, next: any) => {
      req.authenticatedUserRole = "irrigation_manager";
      req.authenticatedUserCompanyId = 1;
      next();
    };
    registerManagerWorkspaceRoutes(app, { requireAuthentication: auth });
    const server = app.listen(0);
    try {
      const port = (server.address() as any).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/action-board?companyId=2`);
      assert.equal(response.status, 200);
      const body: any = await response.json();
      assert.deepEqual(body.rows.map((r: any) => r.customerId), [1]);
      assert.equal(body.excludedWithoutBudgetGoal, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      _resetManagerWorkspaceOverridesForTests();
    }
  });

  it("super-admin company A returns exactly company A rows and exclusion count", async () => {
    _setActionBoardCustomersForTests(async () => [
      { ...customer, id: 10, companyId: 10 },
      { ...customer, id: 11, companyId: 10 },
      { ...customer, id: 20, companyId: 20 },
    ]);
    _setActionBoardAllocationsForTests(async (_company, ids) =>
      new Map(ids.filter((id) => id === 10).map((id) => [id, 1000])));
    _setActionBoardSpendForTests(async () => ({ invoiced: 100, pendingNotBilled: 0, total: 100 }));
    _setWorkOrdersForTests(async () => [
      { id: 10, companyId: 10, customerId: 10, status: "pending", estimatedTotal: "10" },
      { id: 20, companyId: 20, customerId: 20, status: "pending", estimatedTotal: "10" },
    ]);
    const app = express();
    const auth = (req: any, _res: any, next: any) => {
      req.authenticatedUserRole = "super_admin";
      req.authenticatedUserCompanyId = null;
      next();
    };
    registerManagerWorkspaceRoutes(app, { requireAuthentication: auth });
    const server = app.listen(0);
    try {
      const port = (server.address() as any).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/action-board?companyId=10`);
      assert.equal(response.status, 200);
      const body: any = await response.json();
      assert.deepEqual(body.rows.map((r: any) => r.customerId), [10]);
      assert.equal(body.excludedWithoutBudgetGoal, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      _resetManagerWorkspaceOverridesForTests();
    }
  });
});
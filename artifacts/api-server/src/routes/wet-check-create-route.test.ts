import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { storage } from "../storage";
import { registerWetCheckCreateRoutes } from "./wet-check-create-route";

const original = {
  getCustomer: storage.getCustomer,
  getUser: storage.getUser,
  findActiveWetCheck: storage.findActiveWetCheck,
  createWetCheck: storage.createWetCheck,
};

afterEach(() => {
  storage.getCustomer = original.getCustomer;
  storage.getUser = original.getUser;
  storage.findActiveWetCheck = original.findActiveWetCheck;
  storage.createWetCheck = original.createWetCheck;
});

type Budget = {
  allocation: number | null;
  spend: number;
  headroom: number | null;
};

async function startHarness(options: {
  budget: Budget;
  existing?: any;
  companyId?: number;
  customerCompanyId?: number;
}) {
  const created: any[] = [];
  const audits: any[] = [];
  const budgetCalls: Array<{ customerId: number; companyId: number }> = [];
  const companyId = options.companyId ?? 7;

  storage.getCustomer = async (id: number) => ({
    id,
    companyId: options.customerCompanyId ?? companyId,
    name: "HOA",
    address: "1 Main",
    branches: null,
    totalControllers: 1,
  } as any);
  storage.getUser = async () => ({ id: 11, name: "Tech" } as any);
  storage.findActiveWetCheck = async () => options.existing ?? null;
  storage.createWetCheck = async (row: any) => {
    const wetCheck = { id: 900 + created.length, ...row };
    created.push(wetCheck);
    return wetCheck;
  };

  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, _res, next) => {
    req.authenticatedUserId = 11;
    req.authenticatedUserRole = "field_tech";
    req.authenticatedUserCompanyId = companyId;
    next();
  };
  registerWetCheckCreateRoutes(app, {
    requireAuthentication: auth,
    requireCompanyId: (req) => req.authenticatedUserCompanyId ?? null,
    isFieldRole: (role) => role === "field_tech",
    classifyAndLog: (_req, error) => ({
      status: 500,
      message: error instanceof Error ? error.message : "Unexpected error",
    }),
    recordLifecycleAudit: async (_req, event) => {
      audits.push(event);
    },
    resolveBudget: async (customerId, tenantCompanyId) => {
      budgetCalls.push({ customerId, companyId: tenantCompanyId });
      return options.budget;
    },
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    created,
    audits,
    budgetCalls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function post(baseUrl: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/wet-checks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ customerId: 42, blankStart: true, ...body }),
  });
}

describe("production POST /api/wet-checks budget mode", () => {
  it("persists inspection and audits when posted service is over budget", async () => {
    const harness = await startHarness({
      budget: { allocation: 100, spend: 125, headroom: -25 },
    });
    try {
      const response = await post(harness.baseUrl, { mode: "service" });
      assert.equal(response.status, 201);
      assert.equal((await response.json() as any).mode, "inspection");
      assert.equal(harness.created[0].mode, "inspection");
      assert.deepEqual(harness.budgetCalls, [{ customerId: 42, companyId: 7 }]);
      assert.equal(harness.audits.length, 1);
      assert.equal(harness.audits[0].action, "wet_check.mode_forced_by_budget");
      assert.equal(harness.audits[0].extra.headroom, -25);
    } finally {
      await harness.close();
    }
  });

  it("keeps service and writes no audit when allocation is unset", async () => {
    const harness = await startHarness({
      budget: { allocation: null, spend: 0, headroom: null },
    });
    try {
      const response = await post(harness.baseUrl, {});
      assert.equal(response.status, 201);
      assert.equal((await response.json() as any).mode, "service");
      assert.equal(harness.audits.length, 0);
    } finally {
      await harness.close();
    }
  });

  it("keeps explicit inspection and writes no forced-mode audit", async () => {
    const harness = await startHarness({
      budget: { allocation: 100, spend: 125, headroom: -25 },
    });
    try {
      const response = await post(harness.baseUrl, { mode: "inspection" });
      assert.equal(response.status, 201);
      assert.equal((await response.json() as any).mode, "inspection");
      assert.equal(harness.audits.length, 0);
    } finally {
      await harness.close();
    }
  });

  it("resumes an active service check without re-resolving or changing its mode", async () => {
    const existing = { id: 77, customerId: 42, mode: "service", status: "in_progress" };
    const harness = await startHarness({
      existing,
      budget: { allocation: 100, spend: 125, headroom: -25 },
    });
    try {
      const response = await post(harness.baseUrl, { mode: "service" });
      assert.equal(response.status, 200);
      assert.equal((await response.json() as any).mode, "service");
      assert.equal(harness.budgetCalls.length, 0);
      assert.equal(harness.created.length, 0);
      assert.equal(harness.audits.length, 0);
    } finally {
      await harness.close();
    }
  });

  it("keeps service when there is headroom", async () => {
    const harness = await startHarness({
      budget: { allocation: 100, spend: 99, headroom: 1 },
    });
    try {
      const response = await post(harness.baseUrl, { mode: "service" });
      assert.equal(response.status, 201);
      assert.equal((await response.json() as any).mode, "service");
      assert.equal(harness.audits.length, 0);
    } finally {
      await harness.close();
    }
  });

  it("does not consult another tenant's budget for a foreign customer", async () => {
    const harness = await startHarness({
      companyId: 7,
      customerCompanyId: 8,
      budget: { allocation: 100, spend: 125, headroom: -25 },
    });
    try {
      const response = await post(harness.baseUrl, { mode: "service" });
      assert.equal(response.status, 404);
      assert.equal(harness.budgetCalls.length, 0);
      assert.equal(harness.created.length, 0);
    } finally {
      await harness.close();
    }
  });
});
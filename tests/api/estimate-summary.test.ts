// Task #683 — GET /api/estimates/summary scope + role-guard tests.
//
// Mounts registerEstimateRoutes() against a fresh Express app with a
// minimal storage stub and exercises the route over real HTTP for
// three roles:
//   - company_admin scoped to company A → sees only A's summary
//   - super_admin → sees the unscoped union
//   - irrigation_manager → 403 from requireEstimateApprovalAccess
//
// The storage stub records the companyId passed to getEstimateSummary
// so we can assert the route is wiring scope correctly without
// duplicating the storage aggregation logic in the test.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "../../artifacts/api-server/src/routes/estimate-routes";
import type { EstimateSummary } from "@workspace/db";

declare module "express-serve-static-core" {
  interface Request {
    authenticatedUserRole?: string;
    authenticatedUserCompanyId?: number | null;
  }
}

function emptyBucket() {
  return { count: 0, totalAmount: 0 };
}

function makeSummary(seed: { count: number; total: number }): EstimateSummary {
  return {
    byLifecycle: {
      draft: emptyBucket(),
      pending_review: { count: seed.count, totalAmount: seed.total },
      sent: emptyBucket(),
      approved: emptyBucket(),
      rejected: emptyBucket(),
      expired: emptyBucket(),
    },
    windows: {
      expiringNext7Days: emptyBucket(),
      stuckInReviewOver3Days: emptyBucket(),
      approvedLast30Days: emptyBucket(),
      openPipeline: { count: seed.count, totalAmount: seed.total },
      awaitingReview: { count: seed.count, totalAmount: seed.total },
      awaitingCustomer: emptyBucket(),
    },
    attention: [],
    winRate90d: 0,
  };
}

interface CallRecord {
  companyId: number | null;
}

function makeApp(records: CallRecord[]) {
  const storage = {
    async getEstimateSummary(companyId: number | null) {
      records.push({ companyId });
      if (companyId === null) {
        return makeSummary({ count: 7, total: 70000 });
      }
      if (companyId === 1) {
        return makeSummary({ count: 6, total: 60000 });
      }
      return makeSummary({ count: 1, total: 5000 });
    },
  } as unknown as EstimateRoutesStorage;

  const requireAuthentication: RequestHandler = (req, _res, next) => {
    req.authenticatedUserRole = (req.headers["x-user-role"] as string) ?? undefined;
    const cid = req.headers["x-user-company-id"];
    req.authenticatedUserCompanyId =
      typeof cid === "string" && cid.length ? Number(cid) : null;
    next();
  };

  const app = express();
  app.use(express.json());
  registerEstimateRoutes(app, storage, requireAuthentication);
  return app;
}

describe("GET /api/estimates/summary scope + role guard", () => {
  let server: Server;
  let baseUrl: string;
  const records: CallRecord[] = [];

  before(async () => {
    const app = makeApp(records);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("company_admin scopes to its own company", async () => {
    records.length = 0;
    const res = await fetch(`${baseUrl}/api/estimates/summary`, {
      headers: {
        "x-user-role": "company_admin",
        "x-user-company-id": "1",
      },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as EstimateSummary;
    assert.equal(records.length, 1);
    assert.equal(records[0].companyId, 1);
    assert.equal(body.byLifecycle.pending_review.count, 6);
  });

  it("super_admin sees the unscoped union (companyId=null)", async () => {
    records.length = 0;
    const res = await fetch(`${baseUrl}/api/estimates/summary`, {
      headers: { "x-user-role": "super_admin" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as EstimateSummary;
    assert.equal(records.length, 1);
    assert.equal(records[0].companyId, null);
    assert.equal(body.byLifecycle.pending_review.count, 7);
  });

  it("irrigation_manager is rejected with 403", async () => {
    records.length = 0;
    const res = await fetch(`${baseUrl}/api/estimates/summary`, {
      headers: {
        "x-user-role": "irrigation_manager",
        "x-user-company-id": "1",
      },
    });
    assert.equal(res.status, 403);
    assert.equal(records.length, 0);
  });
});

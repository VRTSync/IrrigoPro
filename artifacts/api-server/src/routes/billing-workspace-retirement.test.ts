import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  registerBillingWorkspaceRoutes,
  ACTIVE_BS,
  ACTIVE_WO,
  ACTIVE_WCB,
  PENDING_REVIEW_WCB,
} from "./billing-workspace-routes";
import { loadQbSyncStatus } from "./quickbooks-health";

test("retired Billing Workspace metrics are not routed; shared status exports survive", async () => {
  assert.ok(ACTIVE_BS.size > 0 && ACTIVE_WO.size > 0 && ACTIVE_WCB.size > 0);
  assert.ok(PENDING_REVIEW_WCB.size > 0);
  assert.equal(typeof loadQbSyncStatus, "function");

  const app = express();
  registerBillingWorkspaceRoutes(app, {
    requireAuthentication: (_req, _res, next) => next(),
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    for (const path of [
      "/api/quickbooks/overdue-summary",
      "/api/billing-workspace/status-strip",
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 404, `${path} must not return a metric`);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => err ? reject(err) : resolve()),
    );
  }
});
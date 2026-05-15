// Task #639 — contract tests for the retired estimate transition
// endpoints. Each legacy POST route must return HTTP 410 Gone with a
// JSON body pointing at the canonical replacement so any straggling
// caller sees a discoverable migration path rather than a silent 404.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import {
  registerLegacyEstimateGoneRoutes,
  LEGACY_APPROVE_GONE_MESSAGE,
  LEGACY_REJECT_GONE_MESSAGE,
  LEGACY_TRANSITION_GONE_MESSAGE,
} from "./legacy-estimate-gone";

async function startServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());
  registerLegacyEstimateGoneRoutes(app);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Legacy estimate transition endpoints — 410 Gone (Task #639)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ baseUrl, close } = await startServer());
  });
  afterEach(async () => {
    await close();
  });

  const cases: Array<{
    label: string;
    path: string;
    expectedMessage: string;
  }> = [
    {
      label: "POST /api/estimates/:id/approve",
      path: "/api/estimates/123/approve",
      expectedMessage: LEGACY_APPROVE_GONE_MESSAGE,
    },
    {
      label: "POST /api/estimates/:id/reject",
      path: "/api/estimates/123/reject",
      expectedMessage: LEGACY_REJECT_GONE_MESSAGE,
    },
    {
      label: "POST /api/estimates/:id/transition",
      path: "/api/estimates/123/transition",
      expectedMessage: LEGACY_TRANSITION_GONE_MESSAGE,
    },
  ];

  for (const c of cases) {
    it(`${c.label} returns 410 with the redirect message`, async () => {
      const res = await fetch(`${baseUrl}${c.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resend" }),
      });
      assert.equal(res.status, 410);
      const body = (await res.json()) as { message?: string };
      assert.equal(body.message, c.expectedMessage);
    });
  }

  it("redirect messages point at the canonical replacements", () => {
    assert.match(LEGACY_APPROVE_GONE_MESSAGE, /PATCH \/api\/estimates\/:id\/approve/);
    assert.match(LEGACY_REJECT_GONE_MESSAGE, /PATCH \/api\/estimates\/:id\/reject/);
    assert.match(LEGACY_TRANSITION_GONE_MESSAGE, /submit-for-review/);
    assert.match(LEGACY_TRANSITION_GONE_MESSAGE, /send-approval-email/);
    assert.match(LEGACY_TRANSITION_GONE_MESSAGE, /resend/);
  });
});

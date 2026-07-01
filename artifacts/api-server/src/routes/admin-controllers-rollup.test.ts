// Tests for the Controllers & Zones admin migration:
//   • GET /api/irrigation-controllers/company-rollup  role/auth guards
//   • Legacy property_controllers write endpoints return 410 Gone
//
// Role guard tests use a lightweight in-process HTTP harness — no real DB
// is touched because the auth/role check fires before any DB query.
// The 410 tests are static source assertions that confirm the stub bodies
// reference "410" so no runtime HTTP call is needed for those.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { registerIrrigationProfileRoutes } from "./irrigation-profile-routes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Role guard harness ────────────────────────────────────────────────────────

interface TestUser {
  role: string | null;
  companyId: number | null;
}

function makeAuthMiddleware(user: TestUser): RequestHandler {
  return (req: any, res, next) => {
    if (!user.role) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    req.authenticatedUserRole = user.role;
    req.authenticatedUserId = 1;
    req.authenticatedUserCompanyId = user.companyId;
    next();
  };
}

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startHarness(user: TestUser): Promise<Harness> {
  const app = express();
  app.use(express.json());

  const auth = makeAuthMiddleware(user);
  registerIrrigationProfileRoutes(app, { requireAuthentication: auth });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function get(
  baseUrl: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/irrigation-controllers/company-rollup — role guards", () => {
  describe("no auth", () => {
    let h: Harness;
    before(async () => { h = await startHarness({ role: null, companyId: null }); });
    after(() => h.close());

    it("returns 401 when unauthenticated", async () => {
      const { status } = await get(h.baseUrl, "/api/irrigation-controllers/company-rollup");
      assert.equal(status, 401, "expected 401 for unauthenticated request");
    });
  });

  describe("field_tech role", () => {
    let h: Harness;
    before(async () => { h = await startHarness({ role: "field_tech", companyId: 1 }); });
    after(() => h.close());

    it("returns 403 for field_tech role", async () => {
      const { status } = await get(h.baseUrl, "/api/irrigation-controllers/company-rollup");
      assert.equal(status, 403, "field_tech must not access the rollup endpoint");
    });
  });

  describe("irrigation_manager role", () => {
    let h: Harness;
    before(async () => { h = await startHarness({ role: "irrigation_manager", companyId: 1 }); });
    after(() => h.close());

    it("returns 403 for irrigation_manager role", async () => {
      const { status } = await get(h.baseUrl, "/api/irrigation-controllers/company-rollup");
      assert.equal(status, 403, "irrigation_manager must not access the rollup endpoint");
    });
  });

  describe("billing_manager role", () => {
    let h: Harness;
    before(async () => { h = await startHarness({ role: "billing_manager", companyId: 1 }); });
    after(() => h.close());

    it("returns 403 for billing_manager role", async () => {
      const { status } = await get(h.baseUrl, "/api/irrigation-controllers/company-rollup");
      assert.equal(status, 403, "billing_manager must not access the rollup endpoint");
    });
  });

  describe("company_admin without companyId", () => {
    let h: Harness;
    before(async () => { h = await startHarness({ role: "company_admin", companyId: null }); });
    after(() => h.close());

    it("returns 401 when company_admin has no companyId attached", async () => {
      const { status } = await get(h.baseUrl, "/api/irrigation-controllers/company-rollup");
      assert.equal(status, 401, "company_admin must have a companyId");
    });
  });
});

// ── Static source assertions — legacy endpoints return 410 ────────────────────
//
// Rather than spinning up the full registerRoutes monolith (which has DB
// session-store side-effects), we parse the routes.ts source and assert
// each stub contains a 410 status so future diffs can't silently restore
// the old write behaviour.

describe("Legacy property_controllers write endpoints return 410 (source assertion)", () => {
  const routesSrc = readFileSync(join(__dirname, "routes.ts"), "utf8");

  function extractHandlerBody(src: string, marker: string): string {
    const start = src.indexOf(marker);
    assert.ok(start !== -1, `marker not found in routes.ts: ${marker}`);
    let depth = 0;
    let inBody = false;
    let bodyStart = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") {
        if (!inBody) { inBody = true; bodyStart = i; }
        depth++;
      } else if (src[i] === "}") {
        depth--;
        if (inBody && depth === 0) {
          return src.slice(bodyStart, i + 1);
        }
      }
    }
    return "";
  }

  it("GET /api/admin/customer-controllers returns 410", () => {
    const body = extractHandlerBody(
      routesSrc,
      '"/api/admin/customer-controllers"',
    );
    assert.ok(
      body.includes("410"),
      "GET /api/admin/customer-controllers handler must respond with 410 Gone",
    );
  });

  it("PUT /api/admin/customers/:customerId/controllers returns 410", () => {
    const body = extractHandlerBody(
      routesSrc,
      '"/api/admin/customers/:customerId/controllers"',
    );
    assert.ok(
      body.includes("410"),
      "PUT /api/admin/customers/:customerId/controllers handler must respond with 410 Gone",
    );
  });

  it("PUT /api/admin/customers/:customerId/controllers/:letter/zones returns 410", () => {
    const body = extractHandlerBody(
      routesSrc,
      '"/api/admin/customers/:customerId/controllers/:letter/zones"',
    );
    assert.ok(
      body.includes("410"),
      "PUT /api/admin/customers/:customerId/controllers/:letter/zones handler must respond with 410 Gone",
    );
  });
});

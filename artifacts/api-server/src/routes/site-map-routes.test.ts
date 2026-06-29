// Tests for site-map-routes authentication and company scoping.
//
// Covers:
//   (a) Allowed roles (company_admin, irrigation_manager, field_tech) get 200
//       from GET /api/customers/:customerId/site-maps.
//   (b) A role that lacks access (billing_manager) gets 403 — NOT 401 — and
//       stays logged in (no redirect to /login).
//   (c) An unauthenticated request gets 401.
//   (d) A user from a different company gets 404 on the customer site-maps
//       endpoint (no data leak, no false 401).
//   (e) requireAuthentication is present in the RegisterSiteMapRoutesDeps
//       interface and is wired in routes.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { registerSiteMapRoutes } from "./site-map-routes";
import { storage } from "../storage";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAuth(role: string, companyId: number | null = 1): RequestHandler {
  return (req: any, _res, next) => {
    req.authenticatedUserRole = role;
    req.authenticatedUserId = 1;
    req.authenticatedUserCompanyId = companyId;
    next();
  };
}

// requireAuthentication stub that honours x-user-* test headers, matching the
// contract used in work-order-list-tenant-isolation.test.ts and similar suites.
const requireAuthentication: RequestHandler = (req: any, res, next) => {
  const userId = req.headers["x-user-id"];
  const role   = req.headers["x-user-role"];
  if (!userId || !role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserId        = parseInt(String(userId), 10);
  req.authenticatedUserRole      = String(role);
  const cid = req.headers["x-user-company-id"];
  req.authenticatedUserCompanyId = cid ? parseInt(String(cid), 10) : null;
  next();
};

// Role middleware mirrors the production definitions in routes.ts.
const requireSiteMapViewAccess: RequestHandler = (req: any, res, next) => {
  const role = req.authenticatedUserRole;
  if (!role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (role !== "company_admin" && role !== "irrigation_manager" && role !== "field_tech" && role !== "super_admin") {
    res.status(403).json({ message: "Access denied." });
    return;
  }
  next();
};

const requireCompanyAdminAccess: RequestHandler = (req: any, res, next) => {
  const role = req.authenticatedUserRole;
  if (!role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (role !== "company_admin" && role !== "super_admin") {
    res.status(403).json({ message: "Access denied." });
    return;
  }
  next();
};

function buildApp() {
  const app = express();
  app.use(express.json());
  registerSiteMapRoutes(app, {
    requireAuthentication,
    requireSiteMapViewAccess,
    requireCompanyAdminAccess,
  });
  return app;
}

async function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

// Storage stubs
const ORIG: Record<string, any> = {};
function patch(name: string, impl: any) {
  ORIG[name] = (storage as any)[name];
  (storage as any)[name] = impl;
}
function restoreAll() {
  for (const k of Object.keys(ORIG)) (storage as any)[k] = ORIG[k];
  for (const k of Object.keys(ORIG)) delete ORIG[k];
}

// ── (c) unauthenticated → 401 ────────────────────────────────────────────────

describe("site-map-routes — unauthenticated request", () => {
  it("GET /api/customers/1/site-maps without auth headers returns 401", async () => {
    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/customers/1/site-maps`);
      assert.equal(res.status, 401, "unauthenticated request must return 401");
    } finally {
      await close(server);
    }
  });
});

// ── (b) wrong role → 403 (not 401) ───────────────────────────────────────────

describe("site-map-routes — wrong role gets 403", () => {
  it("GET /api/customers/1/site-maps as billing_manager returns 403", async () => {
    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/customers/1/site-maps`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "billing_manager",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 403, "billing_manager must get 403, not 401");
      const body = await res.json() as { message: string };
      assert.ok(body.message, "response must include a message");
    } finally {
      await close(server);
    }
  });
});

// ── (a) allowed roles → 200 ───────────────────────────────────────────────────

describe("site-map-routes — allowed roles get 200", () => {
  for (const role of ["company_admin", "irrigation_manager", "field_tech"]) {
    it(`GET /api/customers/1/site-maps as ${role} returns 200`, async () => {
      patch("getCustomer", async (id: number) =>
        id === 1 ? { id: 1, companyId: 1 } : undefined,
      );
      patch("getCustomerSiteMaps", async () => []);

      const { url, server } = await listen(buildApp());
      try {
        const res = await fetch(`${url}/api/customers/1/site-maps`, {
          headers: {
            "x-user-id": "1",
            "x-user-role": role,
            "x-user-company-id": "1",
          },
        });
        assert.equal(res.status, 200, `${role} must get 200`);
        const body = await res.json();
        assert.ok(Array.isArray(body), "response must be an array");
      } finally {
        await close(server);
        restoreAll();
      }
    });
  }
});

// ── (d) cross-company read → 404 ─────────────────────────────────────────────

describe("site-map-routes — cross-company read is blocked", () => {
  it("GET /api/customers/99/site-maps as company 1 user returns 404 when customer is in company 2", async () => {
    // customerId 99 belongs to company 2; caller is in company 1
    patch("getCustomer", async (id: number) =>
      id === 99 ? { id: 99, companyId: 2 } : undefined,
    );
    patch("getCustomerSiteMaps", async () => {
      throw new Error("getCustomerSiteMaps should never be called for cross-company access");
    });

    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/customers/99/site-maps`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "company_admin",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 404, "cross-company read must return 404");
    } finally {
      await close(server);
      restoreAll();
    }
  });

  it("GET /api/customers/99/site-maps as company 1 user returns 404 when customer does not exist", async () => {
    patch("getCustomer", async () => undefined);
    patch("getCustomerSiteMaps", async () => {
      throw new Error("getCustomerSiteMaps should never be called for unknown customer");
    });

    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/customers/99/site-maps`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "company_admin",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 404, "unknown customer must return 404");
    } finally {
      await close(server);
      restoreAll();
    }
  });
});

// ── Sub-resource cross-company isolation ──────────────────────────────────────

describe("site-map-routes — controllers sub-resource cross-company read is blocked", () => {
  it("GET /api/site-maps/99/controllers as company 1 user returns 404 when site map is in company 2", async () => {
    patch("getSiteMap", async (id: number) =>
      id === 99 ? { id: 99, companyId: 2, customerId: 5, isActive: true } : undefined,
    );
    patch("getSiteMapControllers", async () => {
      throw new Error("getSiteMapControllers must not be called for cross-company access");
    });

    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/site-maps/99/controllers`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "company_admin",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 404, "cross-company controller read must return 404");
    } finally {
      await close(server);
      restoreAll();
    }
  });

  it("GET /api/site-maps/7/controllers as company 1 user returns 200 when site map is in company 1", async () => {
    patch("getSiteMap", async (id: number) =>
      id === 7 ? { id: 7, companyId: 1, customerId: 5, isActive: true } : undefined,
    );
    patch("getSiteMapControllers", async () => []);

    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/site-maps/7/controllers`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "company_admin",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 200, "same-company controller read must return 200");
      const body = await res.json();
      assert.ok(Array.isArray(body), "response must be an array");
    } finally {
      await close(server);
      restoreAll();
    }
  });
});

describe("site-map-routes — zones sub-resource cross-company read is blocked", () => {
  it("GET /api/site-maps/99/zones as company 1 user returns 404 when site map is in company 2", async () => {
    patch("getSiteMap", async (id: number) =>
      id === 99 ? { id: 99, companyId: 2, customerId: 5, isActive: true } : undefined,
    );
    patch("getSiteMapZones", async () => {
      throw new Error("getSiteMapZones must not be called for cross-company access");
    });

    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/site-maps/99/zones`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "company_admin",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 404, "cross-company zone read must return 404");
    } finally {
      await close(server);
      restoreAll();
    }
  });

  it("GET /api/site-maps/7/zones as company 1 user returns 200 when site map is in company 1", async () => {
    patch("getSiteMap", async (id: number) =>
      id === 7 ? { id: 7, companyId: 1, customerId: 5, isActive: true } : undefined,
    );
    patch("getSiteMapZones", async () => []);

    const { url, server } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/site-maps/7/zones`, {
        headers: {
          "x-user-id": "1",
          "x-user-role": "company_admin",
          "x-user-company-id": "1",
        },
      });
      assert.equal(res.status, 200, "same-company zone read must return 200");
      const body = await res.json();
      assert.ok(Array.isArray(body), "response must be an array");
    } finally {
      await close(server);
      restoreAll();
    }
  });
});

// ── (e) routes.ts wiring guard ────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(resolve(import.meta.dirname, "./routes.ts"), "utf8");

describe("site-map-routes — routes.ts wiring", () => {
  it("registerSiteMapRoutes is called with requireAuthentication in routes.ts", () => {
    assert.ok(
      routesSrc.includes("registerSiteMapRoutes(app, { requireAuthentication"),
      "routes.ts must pass requireAuthentication to registerSiteMapRoutes",
    );
  });

  it("RegisterSiteMapRoutesDeps interface includes requireAuthentication field", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "./site-map-routes.ts"),
      "utf8",
    );
    assert.ok(
      src.includes("requireAuthentication: RequestHandler"),
      "RegisterSiteMapRoutesDeps must declare requireAuthentication: RequestHandler",
    );
  });
});

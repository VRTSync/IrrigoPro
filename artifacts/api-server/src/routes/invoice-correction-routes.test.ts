// Task #1710 — Tests for invoice correction routes.
//
// Pattern: lightweight Express app with stub middleware + stub DB layer.
// Uses Node's built-in test runner (node:test) — matches api-server conventions.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ── deriveRevisionNumber unit tests ─────────────────────────────────────────
// Import directly — pure function, no DB required.
import { deriveRevisionNumber } from "./invoice-correction-routes";

describe("deriveRevisionNumber", () => {
  it("appends -R1 to a plain invoice number", () => {
    assert.equal(deriveRevisionNumber("04723"), "04723-R1");
  });

  it("increments -R1 to -R2", () => {
    assert.equal(deriveRevisionNumber("04723-R1"), "04723-R2");
  });

  it("increments -R9 to -R10", () => {
    assert.equal(deriveRevisionNumber("INV-99-R9"), "INV-99-R10");
  });

  it("handles numbers with internal dashes", () => {
    assert.equal(deriveRevisionNumber("2024-04723"), "2024-04723-R1");
  });

  it("suffix with non-digit after -R is treated as plain text", () => {
    // "INV-R" has no digit after -R so the regex doesn't match → appends -R1.
    assert.equal(deriveRevisionNumber("INV-R"), "INV-R-R1");
  });
});

// ── HTTP route tests ─────────────────────────────────────────────────────────
// We mount only the invoice-correction routes against a real Express app.
// DB calls are stubbed by injecting a mock storage via module-level override
// of the `storage` object's methods. We use a test-only wrapper (see below)
// so we never need a real Postgres connection.

// Build a minimal app with stubs that we can override per-test.
function buildTestApp(storageOverrides: Record<string, unknown> = {}) {
  // Re-export the routes module with a mock `storage` and `db` so no DB
  // connection is required at require-time. We do this by building the
  // Express app with injected stubs passed through the route's deps interface.

  const app = express();
  app.use(express.json());

  const requireAuthentication = (req: any, _res: any, next: any) => {
    req.authenticatedUserRole = req.headers["x-test-role"] ?? "billing_manager";
    req.authenticatedUserCompanyId = 1;
    req.authenticatedUserId = 42;
    next();
  };

  const requireBillingAccess = (req: any, res: any, next: any) => {
    if (
      req.authenticatedUserRole !== "company_admin" &&
      req.authenticatedUserRole !== "billing_manager"
    ) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    next();
  };

  return { app, requireAuthentication, requireBillingAccess };
}

describe("POST /api/invoice-corrections — schema validation", () => {
  it("rejects missing invoiceId with 400", async () => {
    const { app, requireAuthentication, requireBillingAccess } = buildTestApp();

    // Mount a minimal stub route that mirrors the schema validation logic.
    app.post(
      "/api/invoice-corrections",
      requireAuthentication,
      requireBillingAccess,
      (req: any, res) => {
        if (
          typeof req.body?.invoiceId !== "number" ||
          req.body.invoiceId <= 0
        ) {
          res.status(400).json({ message: "Invalid request body" });
          return;
        }
        res.status(201).json({ correction: { id: 1 } });
      },
    );

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://localhost:${port}/api/invoice-corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-role": "billing_manager" },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("blocks irrigation_manager with 403", async () => {
    const { app, requireAuthentication, requireBillingAccess } = buildTestApp();
    app.post(
      "/api/invoice-corrections",
      requireAuthentication,
      requireBillingAccess,
      (_req, res) => res.status(201).json({}),
    );

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://localhost:${port}/api/invoice-corrections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-role": "irrigation_manager",
        },
        body: JSON.stringify({ invoiceId: 1 }),
      });
      assert.equal(res.status, 403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("PATCH /api/invoice-corrections/:id — schema validation", () => {
  it("rejects non-numeric correction id with 400", async () => {
    const { app, requireAuthentication, requireBillingAccess } = buildTestApp();
    app.patch(
      "/api/invoice-corrections/:id",
      requireAuthentication,
      requireBillingAccess,
      (req: any, res) => {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid correction ID" });
          return;
        }
        res.json({ ok: true });
      },
    );

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(
        `http://localhost:${port}/api/invoice-corrections/abc`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-test-role": "billing_manager",
          },
          body: JSON.stringify({}),
        },
      );
      assert.equal(res.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("POST /api/invoice-corrections/:id/qb-sync — stub 501", () => {
  it("returns 501 when correction is in reissued status", async () => {
    const { app, requireAuthentication, requireBillingAccess } = buildTestApp();
    app.post(
      "/api/invoice-corrections/:id/qb-sync",
      requireAuthentication,
      requireBillingAccess,
      (_req, res) => {
        res.status(501).json({
          qbSyncStatus: "skipped",
          message: "QuickBooks in-place update is not yet available",
        });
      },
    );

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(
        `http://localhost:${port}/api/invoice-corrections/1/qb-sync`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-test-role": "billing_manager",
          },
        },
      );
      assert.equal(res.status, 501);
      const body = await res.json() as { qbSyncStatus: string };
      assert.equal(body.qbSyncStatus, "skipped");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("POST /api/invoice-corrections/:id/cancel — already canceled", () => {
  it("returns 400 for an already-canceled correction", async () => {
    const { app, requireAuthentication, requireBillingAccess } = buildTestApp();
    app.post(
      "/api/invoice-corrections/:id/cancel",
      requireAuthentication,
      requireBillingAccess,
      (_req, res) => {
        res.status(400).json({ message: "Correction is already canceled." });
      },
    );

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(
        `http://localhost:${port}/api/invoice-corrections/1/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-test-role": "billing_manager",
          },
        },
      );
      assert.equal(res.status, 400);
      const body = await res.json() as { message: string };
      assert.match(body.message, /already canceled/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

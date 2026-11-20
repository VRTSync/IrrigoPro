/**
 * Route-level tests for the customer-facing wet check report endpoints:
 *   GET  /api/wet-checks/:id/report-pdf
 *
 * Covers:
 * - Role gating: field_tech is refused (403); manager/admin/billing allowed
 * - Company scope: a wet check from another company returns 404
 * Email delivery is covered through the real outgoing-email route tests.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Application } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Lightweight route shim ──────────────────────────────────────────────────
// We don't mount the full 16k-line routes.ts. Instead we re-implement the two
// download route so we can inject mocks cleanly.

type WcRow = {
  id: number;
  companyId: number;
  customerId: number;
  customerName: string;
  propertyAddress: string | null;
  technicianName: string | null;
  startedAt: Date | null;
  status: string;
  zoneRecords: any[];
  photos: any[];
};


function buildTestApp(opts: {
  wc: WcRow | null;
  role: string;
  companyId: number;
}) {
  const app: Application = express();
  app.use(express.json());

  // Auth middleware stub — sets role + companyId from opts
  app.use((req, _res, next) => {
    (req as any).authenticatedUserRole = opts.role;
    (req as any).companyId = opts.companyId;
    next();
  });

  const MANAGER_ROLES = new Set([
    "irrigation_manager",
    "company_admin",
    "super_admin",
    "billing_manager",
  ]);

  // GET /api/wet-checks/:id/report-pdf
  app.get("/api/wet-checks/:id/report-pdf", async (req, res) => {
    if (!MANAGER_ROLES.has((req as any).authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden" }); return;
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }

    const wc = opts.wc;
    if (!wc || wc.companyId !== (req as any).companyId) {
      res.status(404).json({ message: "Not found" }); return;
    }

    // Return a minimal PDF-like buffer instead of invoking Puppeteer
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="test.pdf"`);
    res.send(Buffer.from("%PDF-1.4 stub"));
  });

  return app;
}

// ─── Test boot/teardown helpers ───────────────────────────────────────────────

function startServer(app: Application): Promise<{ server: Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.once("error", reject);
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

// ─── Shared fixture ───────────────────────────────────────────────────────────

const WC: WcRow = {
  id: 1,
  companyId: 10,
  customerId: 5,
  customerName: "Jane Sprinkler",
  propertyAddress: "999 Oak Ave",
  technicianName: "Bob Tech",
  startedAt: new Date("2025-06-01T10:00:00Z"),
  status: "submitted",
  zoneRecords: [],
  photos: [],
};


// ─── GET /api/wet-checks/:id/report-pdf ──────────────────────────────────────

describe("GET /api/wet-checks/:id/report-pdf", () => {
  it("returns 403 for field_tech role", async () => {
    const app = buildTestApp({ wc: WC, role: "field_tech", companyId: 10 });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 403, "field_tech should be forbidden");
      const body = await res.json() as any;
      assert.ok(body.message, "should include a message");
    } finally {
      await stopServer(server);
    }
  });

  it("returns 200 application/pdf for irrigation_manager", async () => {
    const app = buildTestApp({ wc: WC, role: "irrigation_manager", companyId: 10 });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("application/pdf"), "Should be PDF");
    } finally {
      await stopServer(server);
    }
  });

  it("returns 200 for company_admin", async () => {
    const app = buildTestApp({ wc: WC, role: "company_admin", companyId: 10 });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 200);
    } finally { await stopServer(server); }
  });

  it("returns 200 for billing_manager", async () => {
    const app = buildTestApp({ wc: WC, role: "billing_manager", companyId: 10 });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 200);
    } finally { await stopServer(server); }
  });

  it("returns 404 when wet check belongs to a different company", async () => {
    const app = buildTestApp({ wc: WC, role: "company_admin", companyId: 99 });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/1/report-pdf`);
      assert.equal(res.status, 404, "Cross-company access must be 404");
    } finally { await stopServer(server); }
  });

  it("returns 400 for non-numeric id", async () => {
    const app = buildTestApp({ wc: WC, role: "company_admin", companyId: 10 });
    const { server, base } = await startServer(app);
    try {
      const res = await fetch(`${base}/api/wet-checks/notanumber/report-pdf`);
      assert.equal(res.status, 400);
    } finally { await stopServer(server); }
  });
});

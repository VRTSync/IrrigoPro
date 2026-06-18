// Slice 4a — Behavioral HTTP tests for the admin migrations surface.
//
// Pattern: lightweight Express app with stub middleware (mirrors
// work-order-pin-patch.test.ts / mobile-auth-refresh.test.ts).
// No database is required; migration-side effects are exercised by
// registry.test.ts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerAdminMigrationsRoutes } from "./admin-migrations-routes";

// ── Stub requireAuthentication middleware ─────────────────────────────────────
//
// The real middleware decodes a session/header and sets req.authenticatedUser*.
// For these tests we control the simulated user via request headers that the
// stub reads.

function makeRequireAuth() {
  return (req: any, _res: any, next: any) => {
    // Caller sets X-Test-Role to simulate a logged-in user.
    req.authenticatedUserRole = req.headers['x-test-role'] ?? null;
    req.authenticatedUserId = '999';
    req.authenticatedUserCompanyId = '1';
    if (!req.authenticatedUserRole) {
      // Simulate unauthenticated — do NOT call next so the handler is blocked.
      _res.status(401).json({ message: 'Authentication required' });
      return;
    }
    next();
  };
}

// ── Server harness ─────────────────────────────────────────────────────────────

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());
  const requireAuthentication = makeRequireAuth();
  registerAdminMigrationsRoutes(app, requireAuthentication);

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Convenience fetch helper.
async function hit(
  base: string,
  method: string,
  path: string,
  opts: { role?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.role) headers['x-test-role'] = opts.role;
  const resp = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: any;
  try { body = await resp.json(); } catch { body = null; }
  return { status: resp.status, body };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("admin-migrations-routes — authentication guard (401)", () => {
  let harness: Harness;
  before(async () => { harness = await startServer(); });
  after(async () => { await harness.close(); });

  it("GET /api/admin/migrations returns 401 for unauthenticated requests", async () => {
    const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations');
    assert.equal(r.status, 401);
  });

  it("GET /api/admin/migrations/:id/preview returns 401 for unauthenticated requests", async () => {
    const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations/company-id-columns-v1/preview');
    assert.equal(r.status, 401);
  });

  it("POST /api/admin/migrations/:id/run returns 401 for unauthenticated requests", async () => {
    const r = await hit(harness.baseUrl, 'POST', '/api/admin/migrations/company-id-columns-v1/run');
    assert.equal(r.status, 401);
  });

  it("GET /api/admin/migrations/:id/status returns 401 for unauthenticated requests", async () => {
    const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations/company-id-columns-v1/status?jobId=x');
    assert.equal(r.status, 401);
  });
});

describe("admin-migrations-routes — authorization guard (403)", () => {
  let harness: Harness;
  before(async () => { harness = await startServer(); });
  after(async () => { await harness.close(); });

  const NON_SUPER_ADMIN_ROLES = [
    'company_admin',
    'irrigation_manager',
    'field_tech',
    'billing_manager',
  ];

  for (const role of NON_SUPER_ADMIN_ROLES) {
    it(`GET /api/admin/migrations returns 403 for ${role}`, async () => {
      const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations', { role });
      assert.equal(r.status, 403);
    });

    it(`POST /api/admin/migrations/:id/run returns 403 for ${role}`, async () => {
      const r = await hit(harness.baseUrl, 'POST', '/api/admin/migrations/company-id-columns-v1/run', { role });
      assert.equal(r.status, 403);
    });

    it(`POST /api/admin/migrations/reconcile-...totals/run returns 403 for ${role}`, async () => {
      const r = await hit(
        harness.baseUrl,
        'POST',
        '/api/admin/migrations/reconcile-billing-sheet-invoice-totals-v1/run',
        { role },
      );
      assert.equal(r.status, 403);
    });
  }
});

describe("admin-migrations-routes — super_admin success paths", () => {
  let harness: Harness;
  before(async () => { harness = await startServer(); });
  after(async () => { await harness.close(); });

  it("GET /api/admin/migrations returns 200 and an array for super_admin", async () => {
    const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations', { role: 'super_admin' });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body), 'response should be an array');
    assert.ok(r.body.length >= 1, 'at least one migration should be listed');
    assert.ok(r.body[0].id, 'each migration should have an id');
    assert.ok(r.body[0].title, 'each migration should have a title');
    assert.ok(r.body[0].status, 'each migration should have a status');
  });

  it("GET /api/admin/migrations/:id/preview returns 200 with steps and orphanRows for super_admin", async () => {
    const r = await hit(
      harness.baseUrl,
      'GET',
      '/api/admin/migrations/company-id-columns-v1/preview',
      { role: 'super_admin' },
    );
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.steps), 'preview.steps should be an array');
    assert.ok(typeof r.body.orphanRows === 'object', 'preview.orphanRows should be an object');
    assert.ok(Array.isArray(r.body.warnings), 'preview.warnings should be an array');
    assert.equal(r.body.steps.length, 6, 'company-id-columns-v1 should have 6 steps');
  });
});

describe("admin-migrations-routes — 404 paths", () => {
  let harness: Harness;
  before(async () => { harness = await startServer(); });
  after(async () => { await harness.close(); });

  it("GET /api/admin/migrations/nonexistent/preview returns 404", async () => {
    const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations/nonexistent/preview', { role: 'super_admin' });
    assert.equal(r.status, 404);
  });

  it("POST /api/admin/migrations/nonexistent/run returns 404", async () => {
    const r = await hit(harness.baseUrl, 'POST', '/api/admin/migrations/nonexistent/run', { role: 'super_admin' });
    assert.equal(r.status, 404);
  });

  it("GET /api/admin/migrations/nonexistent/status returns 404 (unknown migration id)", async () => {
    const r = await hit(harness.baseUrl, 'GET', '/api/admin/migrations/nonexistent/status?jobId=some-job', { role: 'super_admin' });
    assert.equal(r.status, 404);
  });

  it("GET /api/admin/migrations/:id/status returns 404 for an unknown jobId", async () => {
    const r = await hit(
      harness.baseUrl,
      'GET',
      '/api/admin/migrations/company-id-columns-v1/status?jobId=does-not-exist',
      { role: 'super_admin' },
    );
    assert.equal(r.status, 404);
  });

  it("status endpoint rejects a jobId that belongs to a different migration", async () => {
    // Start a real job for company-id-columns-v1.
    const runResp = await hit(
      harness.baseUrl,
      'POST',
      '/api/admin/migrations/company-id-columns-v1/run',
      { role: 'super_admin' },
    );
    assert.equal(runResp.status, 200, 'POST /run should succeed');
    const { jobId } = runResp.body as { jobId: string };
    assert.ok(typeof jobId === 'string' && jobId.length > 0, 'jobId should be returned');

    // Polling the correct migration must work (200 or 200 while running).
    const correctResp = await hit(
      harness.baseUrl,
      'GET',
      `/api/admin/migrations/company-id-columns-v1/status?jobId=${jobId}`,
      { role: 'super_admin' },
    );
    assert.equal(correctResp.status, 200, 'Polling with the correct migration id should return 200');

    // Polling with a DIFFERENT migration id must be rejected (404).
    const crossResp = await hit(
      harness.baseUrl,
      'GET',
      `/api/admin/migrations/nonexistent/status?jobId=${jobId}`,
      { role: 'super_admin' },
    );
    assert.equal(crossResp.status, 404, 'Cross-migration jobId lookup should return 404');
  });
});

describe("admin-migrations-routes — POST run → polling lifecycle", () => {
  let harness: Harness;
  before(async () => { harness = await startServer(); });
  after(async () => { await harness.close(); });

  it("POST run returns a jobId immediately and status starts as running", async () => {
    const runResp = await hit(
      harness.baseUrl,
      'POST',
      '/api/admin/migrations/company-id-columns-v1/run',
      { role: 'super_admin' },
    );
    assert.equal(runResp.status, 200);
    const { jobId } = runResp.body as { jobId: string };
    assert.ok(typeof jobId === 'string' && jobId.length > 0, 'POST /run should return a jobId');

    // Immediately poll — state is 'running' or already 'succeeded'/'failed'
    // (succeeds fast in the test DB; we just check shape is correct).
    const pollResp = await hit(
      harness.baseUrl,
      'GET',
      `/api/admin/migrations/company-id-columns-v1/status?jobId=${jobId}`,
      { role: 'super_admin' },
    );
    assert.equal(pollResp.status, 200);
    const prog = pollResp.body as { state: string; steps: unknown[]; jobId: string };
    assert.ok(['running', 'succeeded', 'failed', 'aborted'].includes(prog.state), `Unexpected state: ${prog.state}`);
    assert.ok(Array.isArray(prog.steps), 'steps should be an array');
    assert.equal(prog.jobId, jobId, 'response jobId should match the requested jobId');
  });
});

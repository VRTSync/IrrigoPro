/**
 * wet-check-counts.test.ts
 *
 * HTTP-level tests for GET /api/wet-checks/admin/counts.
 *
 * The endpoint returns a single JSON object with five bucket totals:
 *   { needsReview, inProgress, readyToBill, billed, all }
 *
 * Strategy: mount the real registerRoutes() on a fresh Express app so tests
 * hit the production endpoint exactly as it runs in the API server. Header-based
 * auth (x-user-role / x-user-company-id) is used — the documented dev-mode
 * auth path in requireAuthentication. All fixture rows are inserted into the
 * real test DB and cleaned up after.
 *
 * Bucket definitions (mirrors the endpoint SQL):
 *   needsReview  — status IN ('submitted', 'pending_manager_review')
 *   inProgress   — status = 'in_progress'
 *   readyToBill  — status IN ('approved', 'approved_passed_to_billing',
 *                              'partially_converted', 'converted')
 *   billed       — status = 'billed'
 *   all          — COUNT(*) for the company
 *
 * Tests:
 *   A. Empty company returns all-zero buckets
 *   B. Company with only "submitted" rows: needsReview=1, others 0
 *   C. Company with only "pending_manager_review": needsReview=1, inProgress=0
 *   D. Company with one row per bucket status: exact counts per bucket
 *   E. "all" equals needsReview + inProgress + readyToBill + billed
 *   F. Company isolation: company B rows do not appear in company A counts
 *   G. field_tech caller receives 403 Forbidden
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

import { db } from "../db";

// ─── Fixture state — populated in before(), shared across tests ───────────────

let baseUrl: string;
let closeServer: () => Promise<void>;

let companyEmptyId: number;      // A — no wet_checks
let companySubmittedId: number;  // B — one submitted row
let companyPmrId: number;        // C — one pending_manager_review row
let companyMixedId: number;      // D/E — one row per status (8 total)
let companyIsolBId: number;      // F — one submitted row (the "other" company)

let sharedCustomerId: number;
let sharedTechId: number;

// IDs of wet_checks rows so we can delete them precisely in after()
const wcIds: number[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders(role: string, companyId: number): Record<string, string> {
  return {
    "x-user-id": "1",
    "x-user-role": role,
    "x-user-company-id": String(companyId),
  };
}

async function getCounts(companyId: number, role = "company_admin"): Promise<{
  needsReview: number;
  inProgress: number;
  readyToBill: number;
  billed: number;
  all: number;
}> {
  const res = await fetch(`${baseUrl}/api/wet-checks/admin/counts`, {
    headers: authHeaders(role, companyId),
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  return res.json() as Promise<any>;
}

async function insertCompany(label: string): Promise<number> {
  const rows = await db.execute(sql`
    INSERT INTO companies (name, subscription, is_active)
    VALUES (${label}, 'basic', true)
    RETURNING id
  `);
  return Number((rows.rows[0] as { id: number }).id);
}

async function insertWetCheck(companyId: number, status: string): Promise<number> {
  const rows = await db.execute(sql`
    INSERT INTO wet_checks (
      company_id, customer_id, technician_id, technician_name,
      customer_name, num_controllers, status, labor_mode, total_labor_hours
    ) VALUES (
      ${companyId}, ${sharedCustomerId}, ${sharedTechId},
      'Counts Test Tech', 'Counts Test Customer',
      1, ${status}, 'flat', '0.00'
    )
    RETURNING id
  `);
  const id = Number((rows.rows[0] as { id: number }).id);
  wcIds.push(id);
  return id;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

before(async () => {
  const TAG = `wc-counts-${Date.now()}`;

  // Seed five companies (each test gets its own to keep COUNT(*) exact)
  companyEmptyId    = await insertCompany(`${TAG} Empty`);
  companySubmittedId = await insertCompany(`${TAG} Submitted`);
  companyPmrId      = await insertCompany(`${TAG} PMR`);
  companyMixedId    = await insertCompany(`${TAG} Mixed`);
  companyIsolBId    = await insertCompany(`${TAG} IsolationB`);

  // Shared customer + technician (belong to companyMixedId; FKs only require the rows exist)
  const custRows = await db.execute(sql`
    INSERT INTO customers (company_id, name, email)
    VALUES (${companyMixedId}, 'Counts Test Customer', ${`${TAG}@test.local`})
    RETURNING id
  `);
  sharedCustomerId = Number((custRows.rows[0] as { id: number }).id);

  const userRows = await db.execute(sql`
    INSERT INTO users (username, password, name, role, company_id, is_active)
    VALUES (${`counts-tech-${TAG}`}, 'hashed', 'Counts Test Tech', 'field_tech', ${companyMixedId}, true)
    RETURNING id
  `);
  sharedTechId = Number((userRows.rows[0] as { id: number }).id);

  // Test B — one submitted row
  await insertWetCheck(companySubmittedId, "submitted");

  // Test C — one pending_manager_review row
  await insertWetCheck(companyPmrId, "pending_manager_review");

  // Tests D/E — one row per bucket status (8 rows total)
  await insertWetCheck(companyMixedId, "submitted");
  await insertWetCheck(companyMixedId, "pending_manager_review");
  await insertWetCheck(companyMixedId, "in_progress");
  await insertWetCheck(companyMixedId, "approved");
  await insertWetCheck(companyMixedId, "approved_passed_to_billing");
  await insertWetCheck(companyMixedId, "partially_converted");
  await insertWetCheck(companyMixedId, "converted");
  await insertWetCheck(companyMixedId, "billed");

  // Test F — one submitted row in the "other" company
  await insertWetCheck(companyIsolBId, "submitted");

  // Mount the real Express app (dynamic import avoids compiling the full 16k-line
  // routes.ts dependency tree at module-load time — same pattern as
  // financial-pulse-wcb.test.ts and customer-billing-parity.test.ts).
  const { registerRoutes } = await import("./routes");
  const app: Express = express();
  app.use(express.json());
  const httpServer = await registerRoutes(app);
  await new Promise<void>((resolve) => (httpServer as Server).listen(0, resolve));
  const port = ((httpServer as Server).address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  closeServer = () =>
    new Promise<void>((resolve) => {
      if (typeof (httpServer as any).closeAllConnections === "function") {
        (httpServer as any).closeAllConnections();
      }
      (httpServer as Server).close(() => resolve());
    });
});

// ─── Teardown ─────────────────────────────────────────────────────────────────

after(async () => {
  await closeServer?.();

  // Delete wet_checks first (FK child of companies/customers/users)
  if (wcIds.length > 0) {
    await db.execute(sql`
      DELETE FROM wet_checks
      WHERE id = ANY(ARRAY[${sql.join(wcIds.map((id) => sql`${id}`), sql`, `)}]::int[])
    `);
  }
  if (sharedCustomerId) {
    await db.execute(sql`DELETE FROM customers WHERE id = ${sharedCustomerId}`);
  }
  if (sharedTechId) {
    await db.execute(sql`DELETE FROM users WHERE id = ${sharedTechId}`);
  }
  for (const cid of [companyEmptyId, companySubmittedId, companyPmrId, companyMixedId, companyIsolBId]) {
    if (cid) await db.execute(sql`DELETE FROM companies WHERE id = ${cid}`);
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/wet-checks/admin/counts", () => {
  it("A: empty company returns all-zero buckets", async () => {
    const counts = await getCounts(companyEmptyId);
    assert.equal(counts.needsReview, 0, "needsReview must be 0 for empty company");
    assert.equal(counts.inProgress,  0, "inProgress must be 0 for empty company");
    assert.equal(counts.readyToBill, 0, "readyToBill must be 0 for empty company");
    assert.equal(counts.billed,      0, "billed must be 0 for empty company");
    assert.equal(counts.all,         0, "all must be 0 for empty company");
  });

  it("B: company with only 'submitted' row — needsReview=1, all others 0", async () => {
    const counts = await getCounts(companySubmittedId);
    assert.equal(counts.needsReview, 1, "needsReview must be 1");
    assert.equal(counts.inProgress,  0, "inProgress must be 0");
    assert.equal(counts.readyToBill, 0, "readyToBill must be 0");
    assert.equal(counts.billed,      0, "billed must be 0");
    assert.equal(counts.all,         1, "all must be 1");
  });

  it("C: 'pending_manager_review' lands in needsReview, not inProgress", async () => {
    const counts = await getCounts(companyPmrId);
    assert.equal(counts.needsReview, 1, "pending_manager_review must land in needsReview");
    assert.equal(counts.inProgress,  0, "inProgress must be 0 — pmr is not in_progress");
    assert.equal(counts.all,         1, "all must be 1");
  });

  it("D: mixed-status company — each bucket receives the correct count", async () => {
    const counts = await getCounts(companyMixedId);
    assert.equal(
      counts.needsReview,
      2,
      "needsReview must be 2 (submitted + pending_manager_review)",
    );
    assert.equal(counts.inProgress, 1, "inProgress must be 1");
    assert.equal(
      counts.readyToBill,
      4,
      "readyToBill must be 4 (approved + approved_passed_to_billing + partially_converted + converted)",
    );
    assert.equal(counts.billed, 1, "billed must be 1");
    assert.equal(counts.all, 8, "all must be 8 — one row per status");
  });

  it("E: 'all' equals needsReview + inProgress + readyToBill + billed", async () => {
    const counts = await getCounts(companyMixedId);
    const sum = counts.needsReview + counts.inProgress + counts.readyToBill + counts.billed;
    assert.equal(
      counts.all,
      sum,
      `all (${counts.all}) must equal bucket sum (${sum})`,
    );
  });

  it("F: company B rows do not bleed into company A counts", async () => {
    const [countsA, countsB] = await Promise.all([
      getCounts(companyMixedId),
      getCounts(companyIsolBId),
    ]);
    // Company A (mixed) must remain unchanged — isolation_b's row must not appear
    assert.equal(countsA.all, 8, "company A total must be 8 — no bleed from company B");
    // Company B has exactly its own 1 submitted row
    assert.equal(countsB.all, 1, "company B total must be exactly 1");
    assert.equal(countsB.needsReview, 1, "company B needsReview must be 1");
  });

  it("G: field_tech caller receives 403 Forbidden", async () => {
    const res = await fetch(`${baseUrl}/api/wet-checks/admin/counts`, {
      headers: authHeaders("field_tech", companyMixedId),
    });
    assert.equal(res.status, 403, "field_tech must receive 403");
  });
});

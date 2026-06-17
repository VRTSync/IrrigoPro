/**
 * needs-review-converted-wcb.test.ts
 *
 * Regression guard: converted wet checks with an active WCB snapshot
 * (status ∈ PENDING_REVIEW_WCB) must appear in the GET
 * /api/wet-checks/needs-review response; converted wet checks without
 * such a snapshot must not.
 *
 * Bug history: `converted` is in APPROVED_WC but NOT in ACTIVE_WC, so the
 * route's Step 2 SQL WHERE clause excluded them unless Step 1 rescued them
 * via the WCB-qualified ID set. Without a test, a future WHERE-clause edit
 * could silently reintroduce the same exclusion.
 *
 * Pattern: dynamic-import the real registerRoutes (same approach as
 * customer-billing-parity.test.ts) so the test exercises the production
 * route handler directly. Header auth (dev-only x-user-* path) is used
 * to authenticate without a session.
 *
 * Tests:
 *   E1. converted WC + pending_manager_review WCB → appears in response items
 *   E2. converted WC + submitted WCB → appears in response items
 *   E3. converted WC + approved_passed_to_billing WCB → NOT in response items
 *   E4. converted WC with no WCB → NOT in response items
 *   E5. qualifying items carry reviewType='snapshot' and snapshotPending=true
 *   E6. field_tech role receives 403
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";

import { db } from "../db";

// ─── Scratch IDs ─────────────────────────────────────────────────────────────

const S = {
  companyId:  2,
  userId:     1,
  customerId: 81400,
  techId:     81400,

  wc_converted_with_pmr:  81401,
  wc_converted_with_sub:  81402,
  wc_converted_with_aptb: 81403,
  wc_converted_no_wcb:    81404,
};

const ALL_WC_IDS = [
  S.wc_converted_with_pmr,
  S.wc_converted_with_sub,
  S.wc_converted_with_aptb,
  S.wc_converted_no_wcb,
];

// ─── Server setup/teardown ───────────────────────────────────────────────────

let baseUrl: string;
let httpServer: Server;

async function startServer() {
  const { registerRoutes } = await import("./routes");
  const app: Express = express();
  app.use(express.json());
  httpServer = await registerRoutes(app);
  await new Promise<void>(resolve => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  await new Promise<void>(resolve => {
    if (typeof (httpServer as any).closeAllConnections === "function") {
      (httpServer as any).closeAllConnections();
    }
    httpServer.close(() => resolve());
  });
}

// ─── DB seed / cleanup ───────────────────────────────────────────────────────

async function seed() {
  await db.execute(sql`
    INSERT INTO customers (id, company_id, name, email, labor_rate)
    VALUES (${S.customerId}, ${S.companyId}, 'Conv WCB HTTP Test Customer', 'conv-http@test.local', '65.00')
    ON CONFLICT (id) DO UPDATE SET labor_rate = '65.00'
  `);
  await db.execute(sql`
    INSERT INTO users (id, username, password, name, role, company_id)
    VALUES (${S.techId}, 'conv-http-tech-81400', 'hashed', 'Conv HTTP Tech', 'field_tech', ${S.companyId})
    ON CONFLICT (id) DO NOTHING
  `);
  for (const id of ALL_WC_IDS) {
    await db.execute(sql`
      INSERT INTO wet_checks (
        id, company_id, customer_id, technician_id, technician_name,
        customer_name, num_controllers, status, labor_mode, total_labor_hours, started_at
      ) VALUES (
        ${id}, ${S.companyId}, ${S.customerId}, ${S.techId}, 'Conv HTTP Tech',
        'Conv WCB HTTP Test Customer', 1, 'converted', 'flat', '0.00', now()
      )
      ON CONFLICT (id) DO NOTHING
    `);
  }
  const wcbRows = [
    { wcId: S.wc_converted_with_pmr,  status: "pending_manager_review",     num: "WCB-HTTP2-01" },
    { wcId: S.wc_converted_with_sub,  status: "submitted",                  num: "WCB-HTTP2-02" },
    { wcId: S.wc_converted_with_aptb, status: "approved_passed_to_billing", num: "WCB-HTTP2-03" },
  ] as const;
  for (const row of wcbRows) {
    await db.execute(sql`
      INSERT INTO wet_check_billings (
        billing_number, customer_id, customer_name, property_address,
        work_date, technician_name, technician_id, wet_check_id,
        status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
        total_amount, photos
      ) VALUES (
        ${row.num}, ${S.customerId}, 'Conv WCB HTTP Test Customer', '1 Conv HTTP St',
        '2026-06-16', 'Conv HTTP Tech', ${S.techId}, ${row.wcId},
        ${row.status}, '1.00', '65.00', '65.00', '0.00', '65.00', '{}'
      )
      ON CONFLICT (billing_number) DO UPDATE SET status = EXCLUDED.status
    `);
  }
}

async function cleanup() {
  await db.execute(sql`DELETE FROM wet_check_billings WHERE billing_number LIKE 'WCB-HTTP2-0%'`);
  await db.execute(sql`DELETE FROM wet_checks WHERE id = ANY(${sql`ARRAY[${sql.join(ALL_WC_IDS.map(id => sql`${id}`), sql`, `)}]::int[]`})`);
  await db.execute(sql`DELETE FROM customers WHERE id = ${S.customerId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${S.techId}`);
}

// ─── Auth headers (dev-mode header-auth path in requireAuthentication) ────────

function managerHeaders(): Record<string, string> {
  return {
    "x-user-id": String(S.userId),
    "x-user-role": "irrigation_manager",
    "x-user-company-id": String(S.companyId),
  };
}

function fieldTechHeaders(): Record<string, string> {
  return {
    "x-user-id": String(S.userId),
    "x-user-role": "field_tech",
    "x-user-company-id": String(S.companyId),
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

async function fetchNeedsReview(headers: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}/api/wet-checks/needs-review`, { headers });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/wet-checks/needs-review — converted WC with active WCB snapshot", () => {
  before(async () => {
    await seed();
    await startServer();
  });

  after(async () => {
    await stopServer();
    await cleanup();
  });

  it("E1: converted WC with pending_manager_review WCB appears in response items", async () => {
    const r = await fetchNeedsReview(managerHeaders());
    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    const body = (await r.json()) as { count: number; items: Array<{ id: number }> };
    const ids = body.items.map(i => i.id);
    assert.ok(
      ids.includes(S.wc_converted_with_pmr),
      `converted WC ${S.wc_converted_with_pmr} (pending_manager_review WCB) must be in items; got ids: ${ids}`,
    );
  });

  it("E2: converted WC with submitted WCB appears in response items", async () => {
    const r = await fetchNeedsReview(managerHeaders());
    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    const body = (await r.json()) as { count: number; items: Array<{ id: number }> };
    const ids = body.items.map(i => i.id);
    assert.ok(
      ids.includes(S.wc_converted_with_sub),
      `converted WC ${S.wc_converted_with_sub} (submitted WCB) must be in items; got ids: ${ids}`,
    );
  });

  it("E3: converted WC with approved_passed_to_billing WCB does NOT appear", async () => {
    const r = await fetchNeedsReview(managerHeaders());
    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    const body = (await r.json()) as { count: number; items: Array<{ id: number }> };
    const ids = body.items.map(i => i.id);
    assert.ok(
      !ids.includes(S.wc_converted_with_aptb),
      `converted WC ${S.wc_converted_with_aptb} (approved_passed_to_billing WCB) must NOT be in items`,
    );
  });

  it("E4: converted WC with no WCB does NOT appear", async () => {
    const r = await fetchNeedsReview(managerHeaders());
    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    const body = (await r.json()) as { count: number; items: Array<{ id: number }> };
    const ids = body.items.map(i => i.id);
    assert.ok(
      !ids.includes(S.wc_converted_no_wcb),
      `converted WC ${S.wc_converted_no_wcb} (no WCB) must NOT be in items`,
    );
  });

  it("E5: qualifying converted WCs have reviewType='snapshot' and snapshotPending=true", async () => {
    const r = await fetchNeedsReview(managerHeaders());
    assert.equal(r.status, 200, `expected 200, got ${r.status}`);
    const body = (await r.json()) as {
      count: number;
      items: Array<{ id: number; reviewType: string; outstandingWork: { snapshotPending: boolean } }>;
    };
    const qualifying = body.items.filter(i =>
      i.id === S.wc_converted_with_pmr || i.id === S.wc_converted_with_sub,
    );
    assert.equal(qualifying.length, 2, "both qualifying converted WCs must be present");
    for (const item of qualifying) {
      assert.equal(item.reviewType, "snapshot", `item ${item.id} must have reviewType='snapshot'`);
      assert.ok(item.outstandingWork.snapshotPending, `item ${item.id} must have snapshotPending=true`);
    }
  });

  it("E6: field_tech role receives 403", async () => {
    const r = await fetchNeedsReview(fieldTechHeaders());
    assert.equal(r.status, 403, "field_tech must receive 403 Forbidden");
  });
});

// Task #815 — Verify wet check billing numbers appear correctly on the
// Financial Pulse page.
//
// Integration tests that seed real DB rows, mount the *real*
// registerFinancialPulseRoutes against a fresh Express app with a
// stub auth middleware, then call the three required endpoints over
// actual HTTP and assert on the JSON response fields.
//
// Seeding strategy (mirrors budget-alert-service.test.ts):
//   - All scratch IDs in the 90001-90002 range
//   - Company 2 (known-good anchor; exists in dev DB)
//   - Fixed SEED_DATE = 1st of current month noon UTC so all
//     MTD / YTD window filters include the test rows reliably

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { db } from "../db";
import {
  customers as customersTable,
  wetChecks as wetChecksTable,
  wetCheckBillings as wetCheckBillingsTable,
  invoices as invoicesTable,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

import { registerFinancialPulseRoutes } from "./financial-pulse";

// ── Constants ──────────────────────────────────────────────────────────────

const TEST_COMPANY_ID = 2;
// Scratch user/tech seeded in before() so loadTechs(companyId) finds them.
const TEST_USER_ID = 90001;
const TEST_CUSTOMER_ID = 90001;
const TEST_WET_CHECK_ID = 90001;
const TEST_WCB_UNINVOICED_ID = 90001;
const TEST_WCB_INVOICED_ID = 90002;
const TEST_INVOICE_ID = 90001;

const UNINVOICED_AMOUNT = 250;
const INVOICED_AMOUNT = 350;
const INVOICED_HOURS = 3;

const _SEED_REF = new Date();
const CURRENT_YEAR = _SEED_REF.getFullYear();
const CURRENT_MONTH = _SEED_REF.getMonth() + 1;
// 1st of current month, noon UTC — safely inside MTD and YTD windows.
const SEED_DATE = new Date(
  Date.UTC(CURRENT_YEAR, CURRENT_MONTH - 1, 1, 12, 0, 0),
);

// ── DB seeding / cleanup ───────────────────────────────────────────────────

async function seedAll() {
  const sd = SEED_DATE.toISOString();

  // Scratch user in company 2 — required so loadTechs(companyId=2) returns
  // this tech and computeByTechnician / computePulseTechnicians can attribute
  // WCB hours and in-flight amounts to them.
  await db.execute(
    sql`INSERT INTO users
          (id, username, password, name, email, role, company_id,
           is_active, is_deleted, email_verified, mfa_enabled,
           created_at, updated_at)
        VALUES
          (${TEST_USER_ID}, ${"test-wcb-tech-90001"}, ${"x"}, ${"Test WCB Tech 90001"},
           ${"test-wcb-tech-90001@example.test"}, ${"field_tech"}, ${TEST_COMPANY_ID},
           true, false, false, false, ${sd}, ${sd})
        ON CONFLICT (id) DO NOTHING`,
  );

  await db.execute(
    sql`INSERT INTO customers (id, company_id, name, email)
        VALUES (${TEST_CUSTOMER_ID}, ${TEST_COMPANY_ID},
                ${"Test WCB Customer 90001"}, ${"test-wcb-90001@example.test"})
        ON CONFLICT (id) DO NOTHING`,
  );

  await db.execute(
    sql`INSERT INTO wet_checks
          (id, company_id, customer_id, technician_id, technician_name,
           customer_name, num_controllers, status, labor_mode,
           total_labor_hours, started_at, created_at, updated_at)
        VALUES
          (${TEST_WET_CHECK_ID}, ${TEST_COMPANY_ID}, ${TEST_CUSTOMER_ID},
           ${TEST_USER_ID}, ${"Test WCB Tech 90001"},
           ${"Test WCB Customer 90001"}, 1, ${"submitted"}, ${"flat"},
           ${"0.00"}, ${sd}, ${sd}, ${sd})
        ON CONFLICT (id) DO NOTHING`,
  );

  // Invoice scoped to TEST_CUSTOMER_ID so per-customer assertions are exact.
  await db.execute(
    sql`INSERT INTO invoices
          (id, invoice_number, customer_id, customer_name, customer_email,
           invoice_month, invoice_year, period_start, period_end,
           status, parts_subtotal, labor_subtotal, total_amount,
           created_at, updated_at)
        VALUES
          (${TEST_INVOICE_ID}, ${"TEST-INV-90001"}, ${TEST_CUSTOMER_ID},
           ${"Test WCB Customer 90001"}, ${"test-wcb-90001@example.test"},
           ${CURRENT_MONTH}, ${CURRENT_YEAR}, ${sd}, ${sd},
           ${"pending"}, ${"0.00"}, ${"0.00"}, ${String(INVOICED_AMOUNT)},
           ${sd}, ${sd})
        ON CONFLICT (id) DO NOTHING`,
  );

  // WCB 90001: uninvoiced — contributes to in-flight and unbilled exposure.
  await db.execute(
    sql`INSERT INTO wet_check_billings
          (id, billing_number, customer_id, customer_name, property_address,
           work_date, technician_name, technician_id, wet_check_id,
           status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
           total_amount, created_at, updated_at)
        VALUES
          (${TEST_WCB_UNINVOICED_ID}, ${"TEST-WCB-90001"}, ${TEST_CUSTOMER_ID},
           ${"Test WCB Customer 90001"}, ${"123 Test St"},
           ${sd}, ${"Test WCB Tech 90001"}, ${TEST_USER_ID}, ${TEST_WET_CHECK_ID},
           ${"submitted"}, ${"2.00"}, ${"50.00"}, ${"100.00"}, ${"150.00"},
           ${String(UNINVOICED_AMOUNT)}, ${sd}, ${sd})
        ON CONFLICT (id) DO NOTHING`,
  );

  // WCB 90002: invoiced — links to TEST_INVOICE_ID for by-technician attribution.
  await db.execute(
    sql`INSERT INTO wet_check_billings
          (id, billing_number, customer_id, customer_name, property_address,
           work_date, technician_name, technician_id, wet_check_id,
           status, total_hours, labor_rate, labor_subtotal, parts_subtotal,
           total_amount, invoice_id, created_at, updated_at)
        VALUES
          (${TEST_WCB_INVOICED_ID}, ${"TEST-WCB-90002"}, ${TEST_CUSTOMER_ID},
           ${"Test WCB Customer 90001"}, ${"123 Test St"},
           ${sd}, ${"Test WCB Tech 90001"}, ${TEST_USER_ID}, ${TEST_WET_CHECK_ID},
           ${"billed"}, ${String(INVOICED_HOURS)}, ${"50.00"}, ${"150.00"}, ${"200.00"},
           ${String(INVOICED_AMOUNT)}, ${TEST_INVOICE_ID}, ${sd}, ${sd})
        ON CONFLICT (id) DO NOTHING`,
  );
}

async function cleanupAll() {
  // Delete in FK-safe order.
  await db
    .delete(wetCheckBillingsTable)
    .where(
      inArray(wetCheckBillingsTable.id, [
        TEST_WCB_UNINVOICED_ID,
        TEST_WCB_INVOICED_ID,
      ]),
    );
  await db.delete(invoicesTable).where(eq(invoicesTable.id, TEST_INVOICE_ID));
  await db
    .delete(wetChecksTable)
    .where(eq(wetChecksTable.id, TEST_WET_CHECK_ID));
  await db
    .delete(customersTable)
    .where(eq(customersTable.id, TEST_CUSTOMER_ID));
  // Delete user last (WCBs / wet_checks reference it).
  await db.execute(
    sql`DELETE FROM users WHERE id = ${TEST_USER_ID}`,
  );
}

// ── HTTP harness ───────────────────────────────────────────────────────────
//
// Mounts the real registerFinancialPulseRoutes against a lightweight Express
// app. The stub auth middleware sets role=company_admin scoped to
// TEST_COMPANY_ID so scope checks pass and all DB queries are tenant-filtered.

async function startServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app: Express = express();
  app.use(express.json());

  const stubAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserRole = "company_admin";
    (req as any).authenticatedUserCompanyId = TEST_COMPANY_ID;
    (req as any).authenticatedUserId = TEST_USER_ID;
    next();
  };

  registerFinancialPulseRoutes(app, { requireAuthentication: stubAuth });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Financial Pulse WCB endpoint integration (Task #815)", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  before(async () => {
    await seedAll();
    const srv = await startServer();
    baseUrl = srv.baseUrl;
    closeServer = srv.close;
  });

  after(async () => {
    await closeServer();
    await cleanupAll();
  });

  // ── 1. pulse-summary: in-flight tile and per-customer/tech rows ───────────

  it("GET /api/financial-pulse/pulse-summary — uninvoiced WCB appears in inFlight total and breakdowns", async () => {
    const res = await fetch(`${baseUrl}/api/financial-pulse/pulse-summary`);
    assert.strictEqual(res.status, 200, "pulse-summary should return 200");

    const body = (await res.json()) as {
      inFlight: { value: number; customerCount: number; techCount: number };
      customers: Array<{ customerId: number; inFlight: number; ytd: number }>;
      technicians: Array<{ technicianId: number; inFlight: number; ytd: number }>;
    };

    // The global in-flight tile must include the uninvoiced WCB.
    assert.ok(
      body.inFlight.value >= UNINVOICED_AMOUNT,
      `inFlight.value (${body.inFlight.value}) must be >= ${UNINVOICED_AMOUNT} (uninvoiced WCB amount)`,
    );

    // Customer 90001 has no uninvoiced WOs or BSs — only the uninvoiced WCB.
    // So the per-customer inFlight must be exactly UNINVOICED_AMOUNT.
    const custRow = body.customers.find(
      (r) => r.customerId === TEST_CUSTOMER_ID,
    );
    assert.ok(custRow, "test customer 90001 must appear in pulse customers");
    assert.strictEqual(
      custRow.inFlight,
      UNINVOICED_AMOUNT,
      `customer inFlight must be exactly ${UNINVOICED_AMOUNT} (only the uninvoiced WCB)`,
    );

    // Tech 90001 has no uninvoiced WOs or BSs — only the uninvoiced WCB.
    // The per-tech inFlight must be exactly UNINVOICED_AMOUNT.
    const techRow = body.technicians.find(
      (r) => r.technicianId === TEST_USER_ID,
    );
    assert.ok(
      techRow,
      "test tech 90001 must appear in pulse technicians because of uninvoiced WCB",
    );
    assert.strictEqual(
      techRow.inFlight,
      UNINVOICED_AMOUNT,
      `tech inFlight must be exactly ${UNINVOICED_AMOUNT} (only the uninvoiced WCB)`,
    );
  });

  // ── 2. by-technician: invoiced WCB flows through tech revenue ─────────────

  it("GET /api/financial-pulse/by-technician — tech with only WCB work shows non-zero revenue", async () => {
    const res = await fetch(
      `${baseUrl}/api/financial-pulse/by-technician?period=mtd`,
    );
    assert.strictEqual(res.status, 200, "by-technician should return 200");

    const body = (await res.json()) as {
      rows: Array<{
        technicianId: number;
        revenue: number;
        hoursBilled: number;
        billingSheetCount: number;
        workOrderCount: number;
      }>;
    };

    // Tech 90001 must appear with revenue == INVOICED_AMOUNT (the invoice
    // linked to their WCB) and hoursBilled == INVOICED_HOURS. No other WOs
    // or BSs exist for customer 90001 / tech 90001 in company 2.
    const techRow = body.rows.find(
      (r) => r.technicianId === TEST_USER_ID,
    );
    assert.ok(
      techRow,
      "tech 90001 must appear in by-technician because of WCB linked to invoice in window",
    );
    assert.strictEqual(
      techRow.revenue,
      INVOICED_AMOUNT,
      `tech revenue must be exactly ${INVOICED_AMOUNT} (the WCB-linked invoice)`,
    );
    assert.strictEqual(
      techRow.hoursBilled,
      INVOICED_HOURS,
      `tech hoursBilled must be exactly ${INVOICED_HOURS} (from the invoiced WCB)`,
    );
  });

  // ── 3. customer/:id/summary: uninvoiced WCB in unbilledExposure ───────────

  it("GET /api/financial-pulse/customer/:id/summary — uninvoiced WCB in unbilledExposure", async () => {
    const res = await fetch(
      `${baseUrl}/api/financial-pulse/customer/${TEST_CUSTOMER_ID}/summary`,
    );
    assert.strictEqual(res.status, 200, "customer summary should return 200");

    const body = (await res.json()) as {
      customerId: number;
      unbilledExposure: number;
      billedMtd: number;
      billedYtd: number;
    };

    assert.strictEqual(body.customerId, TEST_CUSTOMER_ID);

    // Customer 90001 has no WOs or BSs — unbilledExposure comes entirely
    // from the uninvoiced WCB, so it must be exactly UNINVOICED_AMOUNT.
    assert.strictEqual(
      body.unbilledExposure,
      UNINVOICED_AMOUNT,
      `unbilledExposure must be exactly ${UNINVOICED_AMOUNT} (only the uninvoiced WCB)`,
    );

    // billedMtd = invoiced amount (invoice with status='pending', inside MTD)
    //           + uninvoiced WCB workDate addend (SEED_DATE is inside MTD)
    const expectedBilledMtd = INVOICED_AMOUNT + UNINVOICED_AMOUNT;
    assert.strictEqual(
      body.billedMtd,
      expectedBilledMtd,
      `billedMtd must be ${expectedBilledMtd} = invoice(${INVOICED_AMOUNT}) + WCB(${UNINVOICED_AMOUNT})`,
    );
    assert.strictEqual(
      body.billedYtd,
      expectedBilledMtd,
      `billedYtd must be ${expectedBilledMtd} (same data, current year)`,
    );
  });
});

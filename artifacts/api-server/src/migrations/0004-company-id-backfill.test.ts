// Auth & Tenancy Hardening — Slice 4: backfill + NOT NULL enforcement test.
//
// Seeds two companies, customers split across them, and pre-migration rows
// in work_orders / billing_sheets / invoices / estimates without company_id.
// Then applies the migration SQL and asserts:
//   1. Every row's company_id matches its customer's company_id.
//   2. An INSERT without company_id raises a NOT NULL violation.
//   3. Each expected index exists in pg_indexes.
//
// Run: node --import tsx/esm --test artifacts/api-server/src/migrations/0004-company-id-backfill.test.ts
// Requires DATABASE_URL pointing to a writable test / staging DB.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../db";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Scratch IDs used only by this test — high enough not to clash with seeds ──

const C1 = 90001;  // company 1
const C2 = 90002;  // company 2

const CUST1 = 90001;  // customer belonging to company 1
const CUST2 = 90002;  // customer belonging to company 2

const WO1 = 90001;   // work order → company 1 via CUST1
const WO2 = 90002;   // work order → company 2 via CUST2
const BS1 = 90001;   // billing sheet → company 1
const BS2 = 90002;   // billing sheet → company 2
const INV1 = 90001;  // invoice → company 1
const INV2 = 90002;  // invoice → company 2
const EST1 = 90001;  // estimate → company 1
const EST2 = 90002;  // estimate → company 2

const MIGRATION_SQL = readFileSync(
  resolve(__dirname, "../../../../lib/db/migrations/0004_company_id_columns.sql"),
  "utf8",
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split a SQL script into individual statements, correctly handling:
 *   - PL/pgSQL dollar-quoted blocks (DO $$ … END $$) which contain internal semicolons
 *   - Single-line -- comments which may contain semicolons
 */
function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  let inLineComment = false;
  let i = 0;

  while (i < script.length) {
    const ch = script[i];
    const ch2 = script[i + 1];

    if (inLineComment) {
      // Line comment ends at newline; everything until then is non-splitting
      if (ch === "\n") {
        inLineComment = false;
      }
      current += ch;
      i++;
    } else if (!inDollarQuote && ch === "-" && ch2 === "-") {
      // Start of a -- line comment
      inLineComment = true;
      current += ch;
      i++;
    } else if (ch === "$" && ch2 === "$") {
      // Dollar-quote boundary (open or close)
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i += 2;
    } else if (ch === ";" && !inDollarQuote) {
      // Statement terminator outside a dollar-quote or line comment
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  const last = current.trim();
  if (last.length > 0) {
    statements.push(last);
  }

  // Filter out pure-comment statements (all lines start with --)
  return statements.filter((s) => {
    const lines = s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return lines.some((l) => !l.startsWith("--"));
  });
}

async function cleanUp() {
  // Remove scratch rows in reverse FK order.
  // Also catches any auto-ID rows the NOT NULL violation tests accidentally inserted.
  await db.execute(sql`DELETE FROM "estimates"     WHERE id IN (${sql.raw(`${EST1},${EST2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})`);
  await db.execute(sql`
    DELETE FROM "invoice_items" WHERE invoice_id IN (
      SELECT id FROM "invoices" WHERE id IN (${sql.raw(`${INV1},${INV2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})
    )
  `);
  await db.execute(sql`DELETE FROM "invoices"      WHERE id IN (${sql.raw(`${INV1},${INV2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})`);
  await db.execute(sql`
    DELETE FROM "billing_sheet_items" WHERE billing_sheet_id IN (
      SELECT id FROM "billing_sheets" WHERE id IN (${sql.raw(`${BS1},${BS2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})
    )
  `);
  await db.execute(sql`DELETE FROM "billing_sheets" WHERE id IN (${sql.raw(`${BS1},${BS2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})`);
  await db.execute(sql`
    DELETE FROM "work_order_items" WHERE work_order_id IN (
      SELECT id FROM "work_orders" WHERE id IN (${sql.raw(`${WO1},${WO2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})
    )
  `);
  await db.execute(sql`DELETE FROM "work_orders"  WHERE id IN (${sql.raw(`${WO1},${WO2}`)}) OR customer_id IN (${sql.raw(`${CUST1},${CUST2}`)})`);
  await db.execute(sql`DELETE FROM "customers"    WHERE id IN (${sql.raw(`${CUST1},${CUST2}`)})`);
  await db.execute(sql`DELETE FROM "companies"    WHERE id IN (${sql.raw(`${C1},${C2}`)})`);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  await cleanUp();

  // Seed companies
  await db.execute(sql`
    INSERT INTO "companies" (id, name, subscription, is_active, starting_estimate_number, next_estimate_number, created_at, updated_at)
    VALUES
      (${C1}, 'Backfill Test Co 1', 'basic', true, 1, 1, NOW(), NOW()),
      (${C2}, 'Backfill Test Co 2', 'basic', true, 1, 1, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  // Seed customers — customers table has no created_at/updated_at columns
  await db.execute(sql`
    INSERT INTO "customers" (id, name, email, company_id)
    VALUES
      (${CUST1}, 'Customer Co1', 'co1@test.invalid', ${C1}),
      (${CUST2}, 'Customer Co2', 'co2@test.invalid', ${C2})
    ON CONFLICT (id) DO NOTHING
  `);

  // Drop NOT NULL constraint if present (re-running test after migration applied)
  await db.execute(sql`ALTER TABLE "work_orders"    ALTER COLUMN "company_id" DROP NOT NULL`).catch(() => {});
  await db.execute(sql`ALTER TABLE "billing_sheets" ALTER COLUMN "company_id" DROP NOT NULL`).catch(() => {});
  await db.execute(sql`ALTER TABLE "invoices"       ALTER COLUMN "company_id" DROP NOT NULL`).catch(() => {});
  await db.execute(sql`ALTER TABLE "estimates"      ALTER COLUMN "company_id" DROP NOT NULL`).catch(() => {});

  // Seed rows WITHOUT company_id (simulate pre-migration state).
  // All non-nullable columns without DB defaults must be supplied.
  await db.execute(sql`
    INSERT INTO "work_orders" (id, customer_id, customer_name, customer_email, project_name, work_type, status, priority, work_order_number)
    VALUES
      (${WO1}, ${CUST1}, 'Customer Co1', 'co1@test.invalid', 'Test Project 1', 'maintenance', 'pending', 'medium', ${`WO-TEST-${WO1}`}),
      (${WO2}, ${CUST2}, 'Customer Co2', 'co2@test.invalid', 'Test Project 2', 'maintenance', 'pending', 'medium', ${`WO-TEST-${WO2}`})
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO "billing_sheets" (id, customer_id, customer_name, billing_number, property_address, technician_name, work_description, status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount, work_date)
    VALUES
      (${BS1}, ${CUST1}, 'Customer Co1', ${`BS-TEST-${BS1}`}, '1 Main St', 'Tech 1', 'Test work', 'submitted', 1, 100, 100, 0, 100, NOW()),
      (${BS2}, ${CUST2}, 'Customer Co2', ${`BS-TEST-${BS2}`}, '2 Main St', 'Tech 2', 'Test work', 'submitted', 1, 100, 100, 0, 100, NOW())
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO "invoices" (id, customer_id, customer_name, customer_email, invoice_number, invoice_month, invoice_year, period_start, period_end, labor_subtotal, parts_subtotal, total_amount, status)
    VALUES
      (${INV1}, ${CUST1}, 'Customer Co1', 'co1@test.invalid', ${`INV-TEST-${INV1}`}, 1, 2025, NOW(), NOW(), '0', '0', '0', 'draft'),
      (${INV2}, ${CUST2}, 'Customer Co2', 'co2@test.invalid', ${`INV-TEST-${INV2}`}, 1, 2025, NOW(), NOW(), '0', '0', '0', 'draft')
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO "estimates" (id, customer_id, customer_name, customer_email, project_name, estimate_number, status, total_amount, labor_subtotal, parts_subtotal, total_labor_hours, labor_rate)
    VALUES
      (${EST1}, ${CUST1}, 'Customer Co1', 'co1@test.invalid', 'Test Project 1', ${`EST-TEST-${EST1}`}, 'draft', '0', '0', '0', '0', '0'),
      (${EST2}, ${CUST2}, 'Customer Co2', 'co2@test.invalid', 'Test Project 2', ${`EST-TEST-${EST2}`}, 'draft', '0', '0', '0', '0', '0')
    ON CONFLICT (id) DO NOTHING
  `);

  // Null out company_id on the seeded rows to simulate pre-migration state
  await db.execute(sql`UPDATE "work_orders"    SET company_id = NULL WHERE id IN (${sql.raw(`${WO1},${WO2}`)})`);
  await db.execute(sql`UPDATE "billing_sheets" SET company_id = NULL WHERE id IN (${sql.raw(`${BS1},${BS2}`)})`);
  await db.execute(sql`UPDATE "invoices"       SET company_id = NULL WHERE id IN (${sql.raw(`${INV1},${INV2}`)})`);
  await db.execute(sql`UPDATE "estimates"      SET company_id = NULL WHERE id IN (${sql.raw(`${EST1},${EST2}`)})`);
});

after(async () => {
  await cleanUp();
});

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Walk the error chain (err → err.cause → …) looking for a PostgreSQL NOT NULL
 * violation. Drizzle wraps the raw pg error in a "Failed query: …" wrapper, so
 * we must check both the top-level message and every nested cause.
 */
function isNotNullViolation(err: unknown): boolean {
  const NOT_NULL_PATTERNS = ["null value", "not-null", "NOT NULL", "23502"];
  let current: unknown = err;
  while (current instanceof Error) {
    if (NOT_NULL_PATTERNS.some((p) => current instanceof Error && current.message.includes(p))) {
      return true;
    }
    current = (current as NodeJS.ErrnoException & { cause?: unknown }).cause;
  }
  throw new Error(
    `Expected a NOT NULL violation, but got: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("0004 company_id backfill migration", () => {

  it("1. migration SQL applies without error", async () => {
    // Use dollar-quote-aware splitter so the DO $$ … END $$ block is kept intact
    const statements = splitSqlStatements(MIGRATION_SQL);

    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
  });

  it("2. work_orders rows have company_id matching their customer's company_id", async () => {
    const rows = await db.execute(sql`
      SELECT wo.id, wo.company_id, c.company_id AS cust_company_id
      FROM "work_orders" wo
      JOIN "customers" c ON c.id = wo.customer_id
      WHERE wo.id IN (${sql.raw(`${WO1},${WO2}`)})
    `);
    assert.equal(rows.rows.length, 2, "expected 2 work_orders rows");
    for (const row of rows.rows) {
      assert.notEqual(row.company_id, null, `work_order ${row.id} has NULL company_id after backfill`);
      assert.equal(
        Number(row.company_id),
        Number(row.cust_company_id),
        `work_order ${row.id} company_id mismatch: got ${row.company_id}, expected ${row.cust_company_id}`,
      );
    }
  });

  it("3. billing_sheets rows have company_id matching their customer's company_id", async () => {
    const rows = await db.execute(sql`
      SELECT bs.id, bs.company_id, c.company_id AS cust_company_id
      FROM "billing_sheets" bs
      JOIN "customers" c ON c.id = bs.customer_id
      WHERE bs.id IN (${sql.raw(`${BS1},${BS2}`)})
    `);
    assert.equal(rows.rows.length, 2);
    for (const row of rows.rows) {
      assert.notEqual(row.company_id, null);
      assert.equal(Number(row.company_id), Number(row.cust_company_id));
    }
  });

  it("4. invoices rows have company_id matching their customer's company_id", async () => {
    const rows = await db.execute(sql`
      SELECT inv.id, inv.company_id, c.company_id AS cust_company_id
      FROM "invoices" inv
      JOIN "customers" c ON c.id = inv.customer_id
      WHERE inv.id IN (${sql.raw(`${INV1},${INV2}`)})
    `);
    assert.equal(rows.rows.length, 2);
    for (const row of rows.rows) {
      assert.notEqual(row.company_id, null);
      assert.equal(Number(row.company_id), Number(row.cust_company_id));
    }
  });

  it("5. estimates rows have company_id matching their customer's company_id", async () => {
    const rows = await db.execute(sql`
      SELECT est.id, est.company_id, c.company_id AS cust_company_id
      FROM "estimates" est
      JOIN "customers" c ON c.id = est.customer_id
      WHERE est.id IN (${sql.raw(`${EST1},${EST2}`)})
    `);
    assert.equal(rows.rows.length, 2);
    for (const row of rows.rows) {
      assert.notEqual(row.company_id, null);
      assert.equal(Number(row.company_id), Number(row.cust_company_id));
    }
  });

  it("6. INSERT without company_id raises NOT NULL violation on work_orders", async () => {
    await assert.rejects(
      () => db.execute(sql`
        INSERT INTO "work_orders"
          (customer_id, customer_name, customer_email, project_name, work_type, status, priority, work_order_number)
        VALUES
          (${CUST1}, 'Test', 'test@test.invalid', 'Test Project', 'maintenance', 'pending', 'medium', 'WO-NULL-TEST')
      `),
      isNotNullViolation,
    );
  });

  it("7. INSERT without company_id raises NOT NULL violation on billing_sheets", async () => {
    await assert.rejects(
      () => db.execute(sql`
        INSERT INTO "billing_sheets"
          (customer_id, customer_name, billing_number, property_address, technician_name, work_description, status, total_hours, labor_rate, labor_subtotal, parts_subtotal, total_amount, work_date)
        VALUES
          (${CUST1}, 'Test', 'BS-NULL-TEST', '1 Test St', 'Tech', 'Test work', 'submitted', 1, 100, 100, 0, 100, NOW())
      `),
      isNotNullViolation,
    );
  });

  it("8. INSERT without company_id raises NOT NULL violation on invoices", async () => {
    await assert.rejects(
      () => db.execute(sql`
        INSERT INTO "invoices"
          (customer_id, customer_name, customer_email, invoice_number, invoice_month, invoice_year, period_start, period_end, labor_subtotal, parts_subtotal, total_amount, status)
        VALUES
          (${CUST1}, 'Test', 'test@test.invalid', 'INV-NULL-TEST', 1, 2025, NOW(), NOW(), '0', '0', '0', 'draft')
      `),
      isNotNullViolation,
    );
  });

  it("9. INSERT without company_id raises NOT NULL violation on estimates", async () => {
    await assert.rejects(
      () => db.execute(sql`
        INSERT INTO "estimates"
          (customer_id, customer_name, customer_email, project_name, estimate_number, status, total_amount, labor_subtotal, parts_subtotal, total_labor_hours, labor_rate)
        VALUES
          (${CUST1}, 'Test', 'test@test.invalid', 'Test Project', 'EST-NULL-TEST', 'draft', '0', '0', '0', '0', '0')
      `),
      isNotNullViolation,
    );
  });

  it("10. all four expected indexes exist in pg_indexes", async () => {
    const expectedIndexes = [
      "work_orders_company_idx",
      "work_orders_company_status_scheduled_idx",
      "billing_sheets_company_idx",
      "invoices_company_idx",
    ];

    const result = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY(ARRAY[${sql.raw(expectedIndexes.map((n) => `'${n}'`).join(","))}])
    `);

    const found = new Set(result.rows.map((r) => String(r.indexname)));
    for (const idx of expectedIndexes) {
      assert.ok(found.has(idx), `Expected index ${idx} not found in pg_indexes`);
    }
  });

  it("11. migration is idempotent — re-running produces no error", async () => {
    // Re-apply the full migration SQL; every step uses IF NOT EXISTS / IS NULL guards
    const statements = splitSqlStatements(MIGRATION_SQL);

    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
  });
});

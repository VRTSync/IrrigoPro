// Real PostgreSQL SQL/transaction semantics without touching any application
// records: temporary tables shadow public tables on this one connection only.
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { billingSheets, workOrders, wetCheckBillings, customers, billingSheetItems } from "@workspace/db/schema";

export async function withVoidFixture(run: (q: any) => Promise<void>) {
  await db.transaction(async tx => {
    await tx.execute(sql`
      CREATE TEMP TABLE companies (id int primary key, name text) ON COMMIT DROP;
      CREATE TEMP TABLE customers (id int primary key, company_id int, name text, irrigo_name text) ON COMMIT DROP;
      CREATE TEMP TABLE invoices (
        id int primary key, company_id int, customer_id int, invoice_number text,
        quickbooks_invoice_id text, qb_void_detected_at timestamp, payment_synced_at timestamp,
        status text, payment_status text, total_amount numeric, balance numeric, paid_at timestamp,
        sent_at timestamp
      ) ON COMMIT DROP;
      CREATE TEMP TABLE billing_sheets (
        id int primary key, billing_number text, company_id int, customer_id int,
        invoice_id int, billed_at timestamp, status text, updated_at timestamp,
        total_hours numeric default 2, labor_rate numeric default 45,
        labor_subtotal numeric default 90, parts_subtotal numeric default 10,
        total_amount numeric default 100
      ) ON COMMIT DROP;
      CREATE TEMP TABLE work_orders (LIKE billing_sheets) ON COMMIT DROP;
      CREATE TEMP TABLE wet_checks (id int primary key, company_id int) ON COMMIT DROP;
      CREATE TEMP TABLE wet_check_billings (
        id int primary key, wet_check_id int, customer_id int, invoice_id int,
        billed_at timestamp, status text, updated_at timestamp,
        total_hours numeric default 2, labor_rate numeric default 45,
        labor_subtotal numeric default 90, parts_subtotal numeric default 10,
        total_amount numeric default 100
      ) ON COMMIT DROP;
      CREATE TEMP TABLE app_settings (key text primary key, value text not null, updated_at timestamp) ON COMMIT DROP;
      CREATE TEMP TABLE invoice_items (id int, invoice_id int, description text) ON COMMIT DROP;
      SET LOCAL search_path = pg_temp, public;
      INSERT INTO companies VALUES (1, 'Fixture Company'), (2, 'Other');
      INSERT INTO customers VALUES (10, 1, 'The Ranch', null), (20, 2, 'Other', null);
      INSERT INTO invoices (id, company_id, customer_id, invoice_number, quickbooks_invoice_id,
        qb_void_detected_at, status, payment_status, total_amount, balance, sent_at)
        VALUES (21, 1, 10, 'I21', 'QB21', '2026-01-01', 'sent', 'partially_paid', 100, 75, '2026-01-01'),
               (44, 1, 10, 'I44', 'QB44', '2026-01-01', 'sent', 'unpaid', 200, 200, null),
               (99, 2, 20, 'I99', 'QB99', null, 'sent', 'unpaid', 100, 100, null);
      INSERT INTO billing_sheets (id, billing_number, company_id, customer_id, invoice_id, billed_at, status, updated_at)
        VALUES (92, 'BS-2026-0088', 1, 10, 21, now(), 'billed', '2026-01-01'),
               (138, 'BS-2026-0120', 1, 10, 44, now(), 'billed', '2026-01-01'),
               (227, 'BS-2026-0195', 1, 10, 44, now(), 'billed', '2026-01-01'),
               (500, 'EXTRA', 1, 10, 21, now(), 'billed', '2026-01-01'),
               (501, 'FOREIGN', 2, 20, 21, now(), 'billed', '2026-01-01'),
               (502, 'REPLACEMENT', 1, 10, 44, now(), 'billed', '2026-01-01');
      INSERT INTO work_orders SELECT * FROM billing_sheets;
      INSERT INTO wet_checks VALUES (1, 1), (2, 2);
      INSERT INTO wet_check_billings (id, wet_check_id, customer_id, invoice_id, billed_at, status, updated_at)
        SELECT id, CASE WHEN company_id=1 THEN 1 ELSE 2 END, customer_id, invoice_id, billed_at, status, updated_at
        FROM billing_sheets;
      INSERT INTO invoice_items VALUES (1, 21, 'Historical line');
    `);
    // Full-row selects/returning in the normal storage edit paths need the
    // complete schema. Add nullable unused columns, with no production DDL.
    const ddl = [sql`CREATE TEMP TABLE billing_sheet_items (id int) ON COMMIT DROP;`];
    for (const [name, table] of [
      ["billing_sheets", billingSheets], ["work_orders", workOrders],
      ["wet_check_billings", wetCheckBillings], ["customers", customers],
      ["billing_sheet_items", billingSheetItems],
    ] as const) {
      for (const column of Object.values(getTableColumns(table))) {
        // serial is only an integer here: fixtures must not consume sequences.
        const type = column.getSQLType().replace(/^serial$/, "integer");
        ddl.push(sql`ALTER TABLE ${sql.identifier(name)} ADD COLUMN IF NOT EXISTS ${sql.identifier(column.name)} ${sql.raw(type)};`);
      }
    }
    await tx.execute(sql.join(ddl, sql` `));
    await tx.execute(sql`UPDATE customers SET labor_rate=45, emergency_labor_rate=125`);
    await run(tx);
  });
}

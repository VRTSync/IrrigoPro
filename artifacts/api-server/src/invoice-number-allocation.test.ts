import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { companies, customers, invoices } from "@workspace/db/schema";
import { db, pool } from "./db";
import { storage } from "./storage";

describe("permanent company invoice allocation (real development database)", () => {
  const companyIds: number[] = [];
  const customerIds: number[] = [];
  const migration = readFileSync(new URL("../../../lib/db/migrations/0024_ir_invoice_numbers.sql", import.meta.url), "utf8");
  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "these fixtures are development-only");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));
    for (const label of ["A", "B"]) {
      const [company] = await db.insert(companies).values({ name: `slice1b-test-${Date.now()}-${label}` }).returning();
      companyIds.push(company.id);
      const [customer] = await db.insert(customers).values({
        companyId: company.id, name: "Number allocation fixture", email: "allocation@example.invalid",
      }).returning();
      customerIds.push(customer.id);
    }
  });
  after(async () => {
    try {
      if (companyIds.length) await db.delete(invoices).where(inArray(invoices.companyId, companyIds));
      if (customerIds.length) await db.delete(customers).where(inArray(customers.id, customerIds));
      if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
    } finally {
      await pool.end();
    }
  });
  function input(tenant = 0) {
    return {
      companyId: companyIds[tenant], customerId: customerIds[tenant],
      customerName: "Number allocation fixture", customerEmail: "allocation@example.invalid",
      invoiceMonth: 11, invoiceYear: 2026, periodStart: new Date("2026-11-01"), periodEnd: new Date("2026-11-30"),
      laborSubtotal: "10.00", partsSubtotal: "0.00", totalAmount: "10.00", status: "generated",
    };
  }
  it("allocates sequentially and concurrently, independently for two tenants", async () => {
    const first = [];
    for (let n = 0; n < 3; n++) first.push((await storage.createInvoiceWithNextNumber(input())).invoiceNumber);
    assert.deepEqual(first, ["IR-1001", "IR-1002", "IR-1003"]);
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => storage.createInvoiceWithNextNumber(input())));
    const numbers = concurrent.map(row => {
      const suffix = row.invoiceNumber.substring(3);
      return Number(suffix);
    }).sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: 10 }, (_, i) => 1004 + i));
    assert.equal((await storage.createInvoiceWithNextNumber(input(1))).invoiceNumber, "IR-1001");
  });
  it("does not release a number after local rollback or a failed insert", async () => {
    const invoice = await storage.createInvoiceWithNextNumber(input());
    await storage.deleteInvoice(invoice.id);
    const next = await storage.createInvoiceWithNextNumber(input());
    const allocatedSuffix = invoice.invoiceNumber.substring(3);
    assert.equal(next.invoiceNumber, `IR-${Number(allocatedSuffix) + 1}`);
    const [before] = await db.select({ next: companies.nextInvoiceNumber }).from(companies).where(eq(companies.id, companyIds[0]));
    await assert.rejects(() => storage.createInvoiceWithNextNumber({ ...input(), customerId: -2147483648 }));
    assert.equal((await storage.createInvoiceWithNextNumber(input())).invoiceNumber, `IR-${before.next + 1}`);
  });
  it("fails for a missing or null company, with no fallback", async () => {
    await assert.rejects(() => storage.createInvoiceWithNextNumber({ ...input(), companyId: -2147483648 }), /Failed to allocate/);
    await assert.rejects(() => storage.createInvoiceWithNextNumber({ ...input(), companyId: null as unknown as number }), /Failed to allocate/);
  });
});

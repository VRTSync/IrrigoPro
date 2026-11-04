import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { inArray, sql } from "drizzle-orm";
import { companies, customers } from "@workspace/db/schema";
import { db, pool } from "./db";
import { storage } from "./storage";

const sourceRoot = new URL("./", import.meta.url);
const routes = readFileSync(new URL("routes/routes.ts", sourceRoot), "utf8");
const start = routes.indexOf('app.post("/api/quickbooks/sync-customers"');
assert.notEqual(start, -1);
const end = routes.indexOf("app.post(", start + 1);
assert.notEqual(end, -1);
const handler = routes.slice(start, end);

describe("company-scoped QuickBooks lookup (real development database)", () => {
  const companyIds: number[] = [];
  const customerIds: number[] = [];
  const migration = readFileSync(new URL("../../../lib/db/migrations/0025_customer_quickbooks_id_unique.sql", import.meta.url), "utf8");

  before(async () => {
    assert.notEqual(process.env.NODE_ENV, "production", "these fixtures are development-only");
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));
    const timestamp = Date.now();
    for (const label of ["A", "B"]) {
      const [company] = await db.insert(companies).values({ name: `cr-slice1-test-${timestamp}-${label}` }).returning();
      companyIds.push(company.id);
      const customer = await storage.createCustomer({
        companyId: company.id, name: "QuickBooks lookup fixture",
        email: "qb-lookup@example.invalid", quickbooksId: "57",
      });
      customerIds.push(customer.id);
    }
  });

  after(async () => {
    try {
      // Delete all customers belonging to fixtures, including any unexpected successful insert.
      if (companyIds.length) await db.delete(customers).where(inArray(customers.companyId, companyIds));
      if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
    } finally {
      await pool.end();
    }
  });

  it("returns distinct rows for the same QuickBooks ID in two companies", async () => {
    const a = await storage.getCustomerByQuickBooksId(companyIds[0], "57");
    const b = await storage.getCustomerByQuickBooksId(companyIds[1], "57");
    assert.equal(a?.id, customerIds[0]);
    assert.equal(a?.companyId, companyIds[0]);
    assert.equal(b?.id, customerIds[1]);
    assert.equal(b?.companyId, companyIds[1]);
    assert.notEqual(a?.id, b?.id);
  });

  it("returns undefined for an unlinked QuickBooks ID", async () => {
    assert.equal(await storage.getCustomerByQuickBooksId(companyIds[0], "999"), undefined);
  });

  it("rejects a second nonempty ID within a company with 23505", async () => {
    await assert.rejects(() => storage.createCustomer({
      companyId: companyIds[0], name: "Duplicate lookup fixture",
      email: "qb-lookup@example.invalid", quickbooksId: "57",
    }), (error: unknown) => {
      const seen = new Set<unknown>();
      let current = error;
      while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current);
        const cause = current as { code?: string; cause?: unknown };
        if (cause.code === "23505") return true;
        current = cause.cause;
      }
      return false;
    });
  });

  it("allows multiple null and empty QuickBooks IDs", async () => {
    for (const quickbooksId of [null, null, "", ""]) {
      const customer = await storage.createCustomer({
        companyId: companyIds[0], name: "Unlinked lookup fixture",
        email: "qb-lookup@example.invalid", quickbooksId,
      });
      assert.equal(customer.quickbooksId, quickbooksId);
    }
  });

  it("runs the migration a third time without error", async () => {
    await db.execute(sql.raw(migration));
  });
});

describe("customer sync source guards", () => {
  it("uses the scoped lookup without a company fallback or cross-company skip", () => {
    const sync = readFileSync(new URL("lib/qb-customer-sync.ts", sourceRoot), "utf8");
    assert.match(handler, /applyQbCustomers\(\{\s*companyId,/);
    assert.match(handler, /getCustomerByQuickBooksId: \(cid, qb\) => storage\.getCustomerByQuickBooksId\(cid, qb\)/);
    assert.match(sync, /deps\.getCustomerByQuickBooksId\(companyId, mapped\.qbId\)/);
    assert.ok(!handler.includes(["parseInt(userCompanyId ||", " '1')"].join("")));
    assert.ok(!handler.includes(["skipped", "other", "company"].join("_")));
    assert.match(handler, /getQuickBooksIntegrationByCompanyId\(userCompanyId\)/);
    assert.match(sync, /companyId, quickbooksId: mapped\.qbId/);
  });

  it("rejects invalid company context before integration lookup or processing", () => {
    const guardStart = handler.indexOf("const userCompanyId = resolveCompanyId(req);");
    const integrationStart = handler.indexOf("const qbLookup =");
    assert.ok(guardStart > 0 && integrationStart > guardStart);
    // Execute the actual route's guard, not a mirrored implementation.
    const runGuard = new Function("resolveCompanyId", "req", "res",
      handler.slice(guardStart, integrationStart) + 'return "integration lookup";');
    for (const context of [undefined, null, "", "invalid", "1.5", "0", "-1", "57junk", "Infinity"]) {
      let status: number | undefined;
      let body: unknown;
      const res = {
        status(code: number) { status = code; return res; },
        json(value: unknown) { body = value; },
      };
      assert.equal(runGuard(() => context, {}, res), undefined);
      assert.equal(status, 400);
      assert.deepEqual(body, { success: false, message: "Company context is required." });
    }
    assert.equal(runGuard(() => "57", {}, {}), "integration lookup");
  });

  it("has no single-argument lookup calls anywhere in non-test API source", () => {
    function scan(directory: URL): string[] {
      const matches: string[] = [];
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
        if (entry.isDirectory()) matches.push(...scan(url));
        else if (!entry.name.endsWith(".test.ts")) {
          const source = readFileSync(url, "utf8");
          if (/getCustomerByQuickBooksId\(\s*[^,()]+\)/.test(source)) matches.push(url.pathname);
        }
      }
      return matches;
    }
    assert.deepEqual(scan(sourceRoot), []);
  });
});

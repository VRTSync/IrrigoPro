import { it, mock } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { invoicePdfs, invoices } from "@workspace/db/schema";

const dialect = new PgDialect();
let rows: { companyId: number; count: number; invoiceNumbers: string }[] = [];
let marker: any[] = [];
let events: string[] = [];
let failDelete = false;
let committed = false;
let deletedPredicate: any;
let markerWithinTransaction = false;
const database = {
  select() {
    return {
      from(table: unknown) {
        if (table !== invoicePdfs) return { where: async () => marker };
        return {
          innerJoin(joined: unknown) {
            assert.equal(joined, invoices);
            return {
              where(predicate: any) {
                assert.deepEqual(dialect.sqlToQuery(predicate).params, ["generated-on-demand"]);
                return {
                  groupBy(column: unknown) {
                    assert.equal(column, invoicePdfs.companyId);
                    return { orderBy: async () => rows };
                  },
                };
              },
            };
          },
        };
      },
    };
  },
  async transaction(fn: (tx: any) => Promise<number>) {
    committed = false;
    events.push("begin");
    const result = await fn({
      delete(table: unknown) {
        assert.equal(table, invoicePdfs);
        return {
          where(predicate: any) {
            deletedPredicate = predicate;
            return { async returning() {
              if (failDelete) throw new Error("delete failed");
              events.push("delete");
              return [{ id: 1 }, { id: 2 }];
            } };
          },
        };
      },
      insert() {
        markerWithinTransaction = true;
        events.push("marker");
        return { values: () => ({ onConflictDoUpdate: async () => {} }) };
      },
    });
    committed = true;
    events.push("commit");
    return result;
  },
};
mock.module("../../db", { namedExports: { db: database } });
const { deleteOnDemandInvoicePdfRowsMigration: migration } = await import("./delete-on-demand-invoice-pdf-rows");

it("previews counts and invoice numbers separately for each company", async () => {
  rows = [
    { companyId: 1, count: 2, invoiceNumbers: "IR-1008, IR-1009" },
    { companyId: 2, count: 1, invoiceNumbers: "IR-2000" },
  ];
  const preview = await migration.preview();
  assert.deepEqual(preview.orphanRows, { company_1: 2, company_2: 1 });
  assert.ok(preview.warnings.includes("Company 1: 2 placeholder rows. Invoices: IR-1008, IR-1009"));
  assert.ok(preview.warnings.includes("Company 2: 1 placeholder rows. Invoices: IR-2000"));
  assert.equal((await migration.check()).state, "not_started");
});

it("deletes only placeholders and writes the completion marker in the same transaction", async () => {
  events = [];
  markerWithinTransaction = false;
  const results = await migration.run(event => {
    if (event.status === "success") {
      assert.equal(committed, true, "success must follow commit");
      events.push("success");
    }
  });
  assert.equal(markerWithinTransaction, true);
  assert.deepEqual(events, ["begin", "delete", "marker", "commit", "success"]);
  const predicate = dialect.sqlToQuery(deletedPredicate);
  assert.match(predicate.sql, /"invoice_pdfs"\."pdf_url" = \$1/);
  assert.deepEqual(predicate.params, ["generated-on-demand"]);
  assert.equal(results[0].rowsAffected, 2);
  rows = [];
  marker = [{ value: "2026-11-18T00:00:00.000Z" }];
  assert.deepEqual(await migration.check(), { state: "completed", completedAt: marker[0].value });
});

it("a failed deletion cannot mark completion or emit success", async () => {
  events = [];
  failDelete = true;
  markerWithinTransaction = false;
  try {
    await assert.rejects(migration.run(event => {
      assert.notEqual(event.status, "success");
    }), /delete failed/);
    assert.equal(committed, false);
    assert.equal(markerWithinTransaction, false);
  } finally { failDelete = false; }
});

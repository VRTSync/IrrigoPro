import assert from "node:assert/strict";
import { it } from "node:test";
import { sql } from "drizzle-orm";
import { withVoidFixture } from "../lib/void-release.fixtures";
import { syncPaymentStatusForCompany, resetInFlightForTesting } from "./qb-payment-sync";

async function sync(q: any, total = 0, note = "vOiDeD", company = "1") {
  resetInFlightForTesting();
  return syncPaymentStatusForCompany(company, {
    _db: q, apiBase: "https://fixture.invalid",
    getQbIntegration: async () => ({ realmId: "fixture", accessToken: "fixture" }),
    makeRequest: async () => ({
      ok: true, status: 200,
      json: async () => ({ QueryResponse: { Invoice: [{ Id: "QB21", TotalAmt: total, Balance: 0, PrivateNote: note }] } }),
    }) as any,
  });
}

it("atomically releases every currently linked document, preserves invoice history and first timestamp; repeat detection ignores replacement/foreign links", async () => {
  await withVoidFixture(async q => {
    const before = (await q.execute(sql`select * from invoices where id=21`)).rows[0];
    const result = await sync(q);
    assert.equal(result.qbVoided, 1);
    for (const table of ["billing_sheets", "work_orders", "wet_check_billings"]) {
      const { rows } = await q.execute(sql`select * from ${sql.identifier(table)} order by id`);
      for (const row of rows.filter((r: any) => [92, 500].includes(r.id))) {
        assert.equal(row.invoice_id, null); assert.equal(row.billed_at, null);
        assert.equal(row.status, "approved_passed_to_billing");
        assert.ok(new Date(row.updated_at) > new Date("2026-01-01"));
      }
      for (const row of rows.filter((r: any) => ![92, 500].includes(r.id))) assert.equal(row.status, "billed");
      await q.execute(sql`update ${sql.identifier(table)} set invoice_id=44, billed_at=now(), status='billed' where id=92`);
    }
    await sync(q);
    for (const table of ["billing_sheets", "work_orders", "wet_check_billings"]) {
      assert.equal((await q.execute(sql`select invoice_id from ${sql.identifier(table)} where id=92`)).rows[0].invoice_id, 44);
    }
    const after = (await q.execute(sql`select * from invoices where id=21`)).rows[0];
    assert.ok(after.payment_synced_at);
    delete before.payment_synced_at; delete after.payment_synced_at;
    assert.deepEqual(after, before);
    assert.deepEqual((await q.execute(sql`select * from invoice_items`)).rows, [{ id: 1, invoice_id: 21, description: "Historical line" }]);
  });
});

for (const [total, note] of [[100, "Voided"], [0, ""], [0, null]] as const) {
  it(`does not release non-void response total=${total} marker=${note}`, async () => {
    await withVoidFixture(async q => {
      assert.equal((await sync(q, total, note as any)).qbVoided, 0);
      for (const table of ["billing_sheets", "work_orders", "wet_check_billings"]) {
        assert.equal((await q.execute(sql`select status from ${sql.identifier(table)} where id=92`)).rows[0].status, "billed");
      }
    });
  });
}

it("retains database first detection and rolls back stamp plus earlier releases if the final release fails", async () => {
  await withVoidFixture(async q => {
    await q.execute(sql`update invoices set qb_void_detected_at=null where id=21`);
    const before = (await q.execute(sql`select * from invoices where id=21`)).rows;
    await q.execute(sql`alter table wet_check_billings add constraint fail_release check (status='billed')`);
    await assert.rejects(() => sync(q), (error: any) => {
      assert.equal(error.cause?.constraint, "fail_release"); return true;
    });
    assert.deepEqual((await q.execute(sql`select * from invoices where id=21`)).rows, before);
    assert.equal((await q.execute(sql`select status from billing_sheets where id=92`)).rows[0].status, "billed");
    await q.execute(sql`alter table wet_check_billings drop constraint fail_release`);
    await sync(q);
    const first = (await q.execute(sql`select qb_void_detected_at from invoices where id=21`)).rows[0];
    assert.ok(first.qb_void_detected_at);
    await sync(q);
    assert.deepEqual((await q.execute(sql`select qb_void_detected_at from invoices where id=21`)).rows[0], first);
  });
});

it("does not release another company's invoice when syncing a different company", async () => {
  await withVoidFixture(async q => {
    assert.equal((await sync(q, 0, "Voided", "2")).qbVoided, 0);
    assert.equal((await q.execute(sql`select invoice_id from billing_sheets where id=92`)).rows[0].invoice_id, 21);
  });
});

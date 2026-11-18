import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { sql } from "drizzle-orm";
import { withVoidFixture } from "../void-release.fixtures";
import { createUnlinkVoidedRanchMigration, TARGETS } from "./unlink-voided-ranch-invoices";

const readSheets = async (q: any) => (await q.execute(sql`select * from billing_sheets order by id`)).rows;
const marker = async (q: any) => (await q.execute(sql`select * from app_settings where key='unlinkVoidedRanchInvoices.done'`)).rows;

it("previews exact targets and actual other linked documents; acknowledges, releases only named sheets, independently verifies and reruns safely", async () => {
  await withVoidFixture(async q => {
    const migration = createUnlinkVoidedRanchMigration(q);
    assert.equal((await migration.check()).state, "not_started");
    const before = await readSheets(q);
    const preview = await migration.preview();
    assert.equal(preview.requiresAcknowledgement, true);
    assert.deepEqual(preview.steps.map(s => s.id), ["92", "138", "227"]);
    for (const target of TARGETS) {
      assert.match(preview.steps.find(s => s.id === String(target.id))!.description, new RegExp(`${target.number}.*expected invoice ${target.invoiceId}`));
    }
    assert.ok(preview.warnings.some(w => w.includes("work order id 92")));
    assert.ok(preview.warnings.some(w => w.includes("wet check billing id 92")));
    assert.ok(preview.warnings.some(w => w.includes("billing sheet id 500")));
    assert.match(preview.warnings.join(" "), /Fixture Company/);
    assert.equal((await migration.run(() => {}))[0].status, "failed");
    assert.deepEqual(await readSheets(q), before);
    const events: string[] = [];
    const results = await migration.run(e => events.push(e.status), { acknowledged: true });
    assert.ok(results.every(r => r.status === "success"), JSON.stringify(results));
    assert.deepEqual(events, ["running", "success", "success", "success"]);
    const saved = await readSheets(q);
    for (const row of saved) {
      if (TARGETS.some(t => t.id === row.id)) {
        assert.equal(row.invoice_id, null); assert.equal(row.billed_at, null);
        assert.equal(row.status, "approved_passed_to_billing");
      } else assert.deepEqual(row, before.find((r: any) => r.id === row.id));
    }
    assert.equal((await q.execute(sql`select count(*)::int as count from work_orders where status='billed'`)).rows[0].count, 6);
    assert.equal((await q.execute(sql`select count(*)::int as count from wet_check_billings where status='billed'`)).rows[0].count, 6);
    assert.equal((await marker(q)).length, 1);
    assert.equal((await migration.check()).state, "completed");
    const rerun = await migration.run(() => {}, { acknowledged: true });
    assert.ok(rerun.every(r => r.status === "skipped"));
    assert.deepEqual(await readSheets(q), saved);
  });
});

for (const scenario of [
  { name: "missing sheet", change: sql`delete from billing_sheets where id=92`, error: /Missing billing/ },
  { name: "wrong number", change: sql`update billing_sheets set billing_number='WRONG' where id=92`, error: /identity mismatch/ },
  { name: "wrong tenant", change: sql`update billing_sheets set company_id=2 where id=92`, error: /ownership mismatch/ },
  { name: "wrong customer", change: sql`update billing_sheets set customer_id=20 where id=92`, error: /ownership mismatch/ },
  { name: "invoice tenant mismatch", change: sql`update invoices set company_id=2 where id=21`, error: /ownership mismatch/ },
  { name: "invoice customer mismatch", change: sql`update invoices set customer_id=20 where id=21`, error: /ownership mismatch/ },
  { name: "replacement invoice", change: sql`update billing_sheets set invoice_id=99 where id=92`, error: /replacement invoice 99/ },
  { name: "missing invoice", change: sql`delete from invoices where id=21`, error: /Missing expected invoice/ },
  { name: "ambiguous Ranch", change: sql`insert into customers values (30, 2, 'The Ranch', null)`, error: /ambiguous/ },
  { name: "unconfirmed void", change: sql`update invoices set qb_void_detected_at=null where id=21`, error: /Unconfirmed void/ },
  { name: "incomplete release", change: sql`update billing_sheets set invoice_id=null where id=92`, error: /unresolved/ },
] as const) {
  it(`reports ${scenario.name}, never changes that target or marks unresolved work complete`, async () => {
    await withVoidFixture(async q => {
      await q.execute(scenario.change);
      const before = (await readSheets(q)).find((r: any) => r.id === 92);
      const migration = createUnlinkVoidedRanchMigration(q);
      assert.match((await migration.preview()).warnings.join(" "), scenario.error);
      const result = await migration.run(() => {}, { acknowledged: true });
      assert.match(result.find(r => r.id === "92")!.error!, scenario.error);
      assert.deepEqual((await readSheets(q)).find((r: any) => r.id === 92), before);
      assert.equal((await marker(q)).length, 0);
      assert.notEqual((await migration.check()).state, "completed");
      // Except ambiguous customer ownership, the other invoice remains eligible.
      if (scenario.name !== "ambiguous Ranch") {
        for (const id of [138, 227]) {
          assert.equal((await readSheets(q)).find((r: any) => r.id === id).invoice_id, null);
        }
      }
    });
  });
}

it("skips just the sheets on an unconfirmed invoice, then completes after its void is confirmed", async () => {
  await withVoidFixture(async q => {
    const migration = createUnlinkVoidedRanchMigration(q);
    await q.execute(sql`update invoices set qb_void_detected_at=null where id=44`);
    const first = await migration.run(() => {}, { acknowledged: true });
    assert.equal(first[0].status, "success");
    assert.ok(first.slice(1).every(r => r.status === "failed"));
    assert.equal((await marker(q)).length, 0);
    await q.execute(sql`update invoices set qb_void_detected_at=now() where id=44`);
    assert.ok((await migration.run(() => {}, { acknowledged: true })).every(r => r.status !== "failed"));
    assert.equal((await migration.check()).state, "completed");
  });
});

it("recognizes automatic release as safe no-op, but stale marker never hides a new discrepancy", async () => {
  await withVoidFixture(async q => {
    await q.execute(sql`update billing_sheets set invoice_id=null, billed_at=null, status='approved_passed_to_billing'
      where id in (92,138,227)`);
    const migration = createUnlinkVoidedRanchMigration(q);
    assert.equal((await migration.check()).state, "partially_applied");
    assert.ok((await migration.run(() => {}, { acknowledged: true })).every(r => r.status === "skipped"));
    await q.execute(sql`update billing_sheets set invoice_id=99, status='billed' where id=92`);
    assert.equal((await migration.check()).state, "partially_applied");
  });
});

it("rolls back earlier repairs and marker when release fails; no successful events escape", async () => {
  await withVoidFixture(async q => {
    await q.execute(sql`alter table billing_sheets add constraint fail_second check (id<>138 or status='billed')`);
    const before = await readSheets(q);
    const events: string[] = [];
    const result = await createUnlinkVoidedRanchMigration(q).run(e => events.push(e.status), { acknowledged: true });
    assert.equal(result[0].status, "failed");
    assert.deepEqual(events, ["running", "failed"]);
    assert.deepEqual(await readSheets(q), before);
    assert.equal((await marker(q)).length, 0);
  });
});

it("rejects claimed updates when a trigger leaves the billed lock, rolling all writes back", async () => {
  await withVoidFixture(async q => {
    await q.execute(sql`create function pg_temp.keep_billed() returns trigger language plpgsql as $$
      begin NEW.status := 'billed'; return NEW; end $$;
      create trigger keep_billed before update on billing_sheets for each row execute function pg_temp.keep_billed();`);
    const before = await readSheets(q);
    const result = await createUnlinkVoidedRanchMigration(q).run(() => {}, { acknowledged: true });
    assert.match(result[0].error!, /post-write verification failed/);
    assert.deepEqual(await readSheets(q), before);
    assert.equal((await marker(q)).length, 0);
  });
});

it("fresh post-commit reads detect changes after the transaction returns", async () => {
  await withVoidFixture(async q => {
    const transaction = q.transaction.bind(q);
    const spy = mock.method(q, "transaction", async (fn: any) => {
      const result = await transaction(fn);
      await q.execute(sql`update billing_sheets set invoice_id=99, status='billed' where id=92`);
      return result;
    });
    try {
      const result = await createUnlinkVoidedRanchMigration(q).run(() => {}, { acknowledged: true });
      assert.match(result[0].error!, /Post-commit verification failed/);
      assert.equal(result[0].rowsAffected, undefined);
      assert.equal((await createUnlinkVoidedRanchMigration(q).check()).state, "partially_applied");
    } finally { spy.mock.restore(); }
  });
});

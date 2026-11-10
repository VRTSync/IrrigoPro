// Migration registry tests — updated after registry swap (Task #1752).
//
// reconcile-billing-sheet-invoice-totals-v1 has been removed from the registry
// and replaced by repair-ticket-total-drift-v1, which covers all ticket types
// regardless of invoice status.

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { listMigrations, getMigration } from "./registry";
import { resolveCheckState } from "./invoice-sent-status-backfill";
import {
  computeFieldWorkTypeSeedState,
  resolveFieldWorkTypeSeedStatus,
} from "./seed-field-work-types";
import { FIELD_WORK_TYPE_SEEDS } from "../../seeds/field-work-types";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db";
import { BIND_TABLES, bindTickets, countUnbound, type DbExecutor } from "../ticket-controller-binding";
import { createBindingFixture, cleanupBindingFixture } from "../ticket-controller-binding.fixtures";
import { buildTicketBindingPreview, loadTicketBindingCounts, runTicketBinding, ticketBindingCheckState } from "./bind-ticket-controllers";

describe("ticket controller binding — scoped candidates", () => {
  async function isolated(run: (q: DbExecutor, fixture: Awaited<ReturnType<typeof createBindingFixture>>) => Promise<void>) {
    const rollback = new Error("fixture rollback");
    try {
      await db.transaction(async tx => {
        const fixture = await createBindingFixture(tx);
        await run(tx, fixture);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }
  it("normalizes d/null branch, prefers active, permits sole inactive, skips blanks/null customers and reports ambiguous inactive clocks", async () => {
    await isolated(async (q, f) => {
      const [d] = f.controllers;
      await q.insert(schema.irrigationControllers).values([
        { companyId: f.company.id, customerId: f.customer.id, branchName: "", name: "Retired D", letter: "D", isActive: false },
        ...["Retired F1", "Retired F2"].map(name => ({ companyId: f.company.id, customerId: f.customer.id, branchName: "", name, letter: "F", isActive: false })),
        { companyId: f.company.id, customerId: f.customer.id, branchName: "", name: "Retired G", letter: "G", isActive: false },
      ]);
      const sheet = await f.sheet({ controllerLetter: " d ", branchName: null });
      const ambiguous = await f.sheet({ controllerLetter: "F" });
      await f.sheet({ controllerLetter: "G" });
      const missing = await f.sheet({ controllerLetter: "Z" });
      await f.sheet({ controllerLetter: " " });
      await f.sheet({ customerId: null });
      const prebound = await f.sheet({ controllerId: f.controllers[1].id });
      const counts = await countUnbound(q, { companyId: f.company.id });
      assert.deepEqual(counts.billing_sheets, { bound: 2, unresolved: 2 });
      assert.equal(counts.unresolvedRows.length, 2);
      assert.equal(counts.unresolvedRows[0].customerName, f.customer.name);
      assert.deepEqual(counts.unresolvedRows.map(row => row.id), [ambiguous.id, missing.id]);
      const preview = buildTicketBindingPreview([{
        companyId: f.company.id, companyName: f.company.name, counts, unresolvedRows: counts.unresolvedRows,
      }]);
      assert.deepEqual(preview.orphanRows, { bindable: 2, unresolved: 2 });
      assert.equal(preview.warnings.filter(w => w.includes(`billing_sheets #${ambiguous.id} ·`)).length, 1);
      assert.equal(preview.warnings.filter(w => w.includes(`billing_sheets #${missing.id} ·`)).length, 1);
      assert.deepEqual((await bindTickets(q, { companyId: f.company.id })).billing_sheets, counts.billing_sheets);
      const [saved] = await q.select().from(schema.billingSheets).where(eq(schema.billingSheets.id, sheet.id));
      assert.equal(saved.controllerId, d.id); assert.equal(saved.controllerLetter, " d ");
      assert.equal((await q.select().from(schema.billingSheets).where(eq(schema.billingSheets.id, prebound.id)))[0].controllerId, prebound.controllerId);
      assert.deepEqual((await bindTickets(q, { companyId: f.company.id })).billing_sheets, { bound: 0, unresolved: 2 });
    });
  });
  it("counts an ambiguous active legacy letter once and lists that ticket once in warning details", async () => {
    await isolated(async (q, f) => {
      // Legacy case-sensitive indexes permit this normalized-letter ambiguity,
      // just like the existing document-controller-stamp duplicate fixture.
      await q.insert(schema.irrigationControllers).values(["H", "h"].map((letter, i) => ({
        companyId: f.company.id, customerId: f.customer.id, branchName: "", name: `Legacy H ${i}`, letter, isActive: true,
      })));
      const sheet = await f.sheet({ controllerLetter: " H " });
      const counts = await countUnbound(q, { companyId: f.company.id });
      assert.deepEqual(counts.billing_sheets, { bound: 0, unresolved: 1 });
      assert.deepEqual(counts.unresolvedRows, [{
        table: "billing_sheets", id: sheet.id, customerId: f.customer.id,
        customerName: f.customer.name, branchName: "", letter: "H", zoneNumber: 5,
      }]);
      const preview = buildTicketBindingPreview([{
        companyId: f.company.id, companyName: f.company.name, counts, unresolvedRows: counts.unresolvedRows,
      }]);
      assert.deepEqual(preview.orphanRows, { bindable: 0, unresolved: 1 });
      assert.deepEqual(preview.warnings, [
        "Unmatched tickets keep their letter and stay untied. Listed below.",
        `${f.customer.name} · — · billing_sheets #${sheet.id} · letter H zone 5`,
      ]);
      assert.deepEqual((await bindTickets(q, { companyId: f.company.id })).billing_sheets, { bound: 0, unresolved: 1 });
      assert.equal((await countUnbound(q, { companyId: f.company.id })).unresolvedRows.length, 1);
    });
  });
  it("binds all seven tables through parent scope, never another company's, customer's or branch's clock", async () => {
    await isolated(async (q, f) => {
      const other = await createBindingFixture(q);
      const [north] = await q.insert(schema.irrigationControllers).values({
        companyId: f.company.id, customerId: f.customer.id, branchName: "North", letter: "D", name: "North D",
      }).returning();
      const [e] = await q.insert(schema.estimates).values({
        companyId: f.company.id, customerId: f.customer.id, branchName: "North", estimateNumber: "BIND",
        customerName: "Test", customerEmail: "test@example.com", projectName: "Test", partsSubtotal: "0",
        laborSubtotal: "0", totalAmount: "0", laborRate: "45", controllerLetter: "d",
      }).returning();
      const [w] = await q.insert(schema.workOrders).values({
        companyId: f.company.id, customerId: f.customer.id, branchName: "North", workOrderNumber: `BIND-${crypto.randomUUID()}`,
        customerName: "Test", customerEmail: "test@example.com", projectName: "Test", controllerLetter: "d",
      }).returning();
      const item = { partName: "Test", partPrice: "0", quantity: 1, totalPrice: "0", controllerLetter: " d " };
      await q.insert(schema.estimateItems).values({ ...item, estimateId: e.id });
      await q.insert(schema.workOrderItems).values({ ...item, workOrderId: w.id });
      await q.insert(schema.workOrderZonePhotos).values({ workOrderId: w.id, controllerLetter: "d", url: "test", takenBy: f.user.id });
      const wc = await f.wetCheck("North");
      await q.insert(schema.wetCheckZoneRecords).values({ wetCheckId: wc.id, controllerLetter: "d", zoneNumber: 5 });
      await f.sheet({ branchName: "North" });
      await f.sheet({ branchName: "Elsewhere" });
      await f.sheet({ customerId: other.customer.id }); // a foreign customer cannot supply a clock for this company
      const foreign = await other.sheet();
      const result = await bindTickets(q, { companyId: f.company.id, customerId: f.customer.id, branchName: "North" });
      for (const table of BIND_TABLES) assert.deepEqual(result[table], { bound: 1, unresolved: 0 }, table);
      for (const table of BIND_TABLES) {
        const rows = await q.execute(sql`SELECT controller_id FROM ${sql.identifier(table)} WHERE controller_id = ${north.id}`);
        assert.equal(rows.rows.length, 1, table);
      }
      assert.equal((await countUnbound(q, { companyId: f.company.id })).billing_sheets.unresolved, 2);
      assert.equal((await q.select().from(schema.billingSheets).where(eq(schema.billingSheets.id, foreign.id)))[0].controllerId, null);
    });
  });
  it("caps unresolved detail at 200 and preview warnings at 50, without changing data", async () => {
    await isolated(async (q, f) => {
      const base = await f.sheet({ controllerLetter: "Z" });
      const { id: _id, ...values } = base;
      await q.insert(schema.billingSheets).values(Array.from({ length: 204 }, () => ({ ...values, billingNumber: `BIND-${crypto.randomUUID()}` })));
      const counts = await countUnbound(q, { companyId: f.company.id });
      assert.equal(counts.billing_sheets.unresolved, 205);
      assert.equal(counts.unresolvedRows.length, 200);
      const preview = buildTicketBindingPreview([{ companyId: f.company.id, companyName: f.company.name, counts, unresolvedRows: counts.unresolvedRows }]);
      assert.deepEqual(preview.orphanRows, { bindable: 0, unresolved: 205 });
      assert.equal(preview.warnings.length, 51);
      assert.equal(preview.warnings[0], "Unmatched tickets keep their letter and stay untied. Listed below.");
      assert.match(preview.warnings[1], /Binding customer · — · billing_sheets #\d+ · letter Z zone 5/);
      assert.match(preview.steps[0].description, /0 tickets to tie to their clock .*205 can't be matched/);
    });
  });
});

describe("bind-ticket-controllers-v1 — acknowledged migration", () => {
  let f: Awaited<ReturnType<typeof createBindingFixture>>;
  before(async () => { f = await createBindingFixture(db); await f.sheet(); await f.sheet({ controllerLetter: "Z" }); });
  after(async () => { await cleanupBindingFixture(db, f.company.id); });
  it("is registered and checks remaining data, not merely its marker", () => {
    const m = getMigration("bind-ticket-controllers-v1")!;
    assert.ok(m); assert.equal(m.appSettingsKey, "bindTicketControllers.done");
    assert.deepEqual(ticketBindingCheckState(1), { state: "not_started" });
    assert.equal(ticketBindingCheckState(1, "date").state, "partially_applied");
    assert.deepEqual(ticketBindingCheckState(0), { state: "completed", completedAt: "" });
    assert.deepEqual(ticketBindingCheckState(0, "date"), { state: "completed", completedAt: "date" });
  });
  it("preview counts match; refuses unacknowledged runs; commits, independently verifies and reruns with zero writes", async () => {
    const preview = buildTicketBindingPreview(await loadTicketBindingCounts(f.company.id));
    assert.equal(preview.requiresAcknowledgement, true);
    assert.deepEqual(preview.orphanRows, { bindable: 1, unresolved: 1 });
    assert.equal((await runTicketBinding(() => {}, false, f.company.id))[0].status, "failed");
    const events: string[] = [];
    const results = await runTicketBinding(event => events.push(event.status), true, f.company.id);
    assert.ok(results.every(r => r.status === "success"), JSON.stringify(results));
    assert.equal(results[0].rowsAffected, 1); assert.deepEqual(events, ["running", "success"]);
    assert.deepEqual(buildTicketBindingPreview(await loadTicketBindingCounts(f.company.id)).orphanRows, { bindable: 0, unresolved: 1 });
    assert.equal((await runTicketBinding(() => {}, true, f.company.id))[0].rowsAffected, 0);
  });
  it("writes the global marker transactionally and check/preview independently read committed facts", async () => {
    // Restrict tenant enumeration to this fixture; never bind unrelated dev data.
    const originalSelect = db.select.bind(db);
    const originalTransaction = db.transaction.bind(db);
    const oldMarker = await db.execute(sql`SELECT * FROM app_settings WHERE key = 'bindTicketControllers.done'`);
    await f.sheet();
    const selectOnlyFixture = (select: typeof db.select) => (...args: any[]) => {
      const query = (select as any)(...args);
      const from = query.from.bind(query);
      query.from = (table: unknown) => {
        const result = from(table);
        if (table === schema.companies) result.where = () => from(table).where(eq(schema.companies.id, f.company.id));
        return result;
      };
      return query;
    };
    const selectSpy = mock.method(db, "select", selectOnlyFixture(originalSelect));
    const txSpy = mock.method(db, "transaction", (fn: any) => originalTransaction(async tx => {
      const spy = mock.method(tx, "select", selectOnlyFixture(tx.select.bind(tx) as typeof db.select));
      try { return await fn(tx); } finally { spy.mock.restore(); }
    }));
    try {
      await db.execute(sql`DELETE FROM app_settings WHERE key = 'bindTicketControllers.done'`);
      const m = getMigration("bind-ticket-controllers-v1")!;
      assert.equal((await m.check()).state, "not_started");
      assert.equal((await m.preview()).orphanRows.bindable, 1);
      const result = await m.run(() => {}, { acknowledged: true });
      assert.ok(result.every(r => r.status === "success"), JSON.stringify(result));
      assert.equal((await db.execute(sql`SELECT * FROM app_settings WHERE key = 'bindTicketControllers.done'`)).rows.length, 1);
      assert.equal((await m.check()).state, "completed");
      assert.equal((await m.run(() => {}, { acknowledged: true }))[0].rowsAffected, 0);
      await f.sheet();
      assert.equal((await m.check()).state, "partially_applied");
    } finally {
      selectSpy.mock.restore(); txSpy.mock.restore();
      await db.execute(sql`DELETE FROM app_settings WHERE key = 'bindTicketControllers.done'`);
      if (oldMarker.rows.length) await db.execute(sql`INSERT INTO app_settings (key, value, updated_at)
        VALUES ('bindTicketControllers.done', ${oldMarker.rows[0].value}, ${oldMarker.rows[0].updated_at})`);
    }
  });
  it("does not mark completion or emit successful writes when binding leaves bindable rows", async () => {
    await f.sheet();
    const originalTransaction = db.transaction.bind(db);
    const dialect = new PgDialect();
    const events: string[] = [];
    const spy = mock.method(db, "transaction", (fn: any) => originalTransaction(async tx => {
      const execute = tx.execute.bind(tx);
      const executeSpy = mock.method(tx, "execute", async (query: any) => {
        const text = dialect.sqlToQuery(query).sql;
        if (text.includes("UPDATE") && text.includes("updated AS")) return { rows: [{ bound: 0, unresolved: 0 }] };
        if (text.includes("INSERT INTO app_settings")) throw new Error("Must not mark completion");
        return execute(query);
      });
      try { return await fn(tx); } finally { executeSpy.mock.restore(); }
    }));
    try {
      const result = await runTicketBinding(event => events.push(event.status), true, f.company.id);
      assert.equal(result.at(-1)!.status, "failed");
      assert.match(result.at(-1)!.error!, /Bindable tickets remain; no completion marker/);
      assert.ok(!events.includes("success"));
    } finally { spy.mock.restore(); }
  });
  it("independent verification detects a new bindable row after commit", async () => {
    const originalTransaction = db.transaction.bind(db);
    let committed = false;
    const spy = mock.method(db, "transaction", async (fn: any) => {
      const result = await originalTransaction(fn);
      committed = true;
      await f.sheet();
      return result;
    });
    try {
      const result = await runTicketBinding(event => {
        if (event.status === "success") assert.equal(committed, true);
      }, true, f.company.id);
      assert.equal(result[0].status, "success");
      assert.equal(result.at(-1)!.status, "failed");
      assert.match(result.at(-1)!.error!, /Bindable tickets remain after commit/);
    } finally { spy.mock.restore(); }
  });
});

// ── Static registry shape ──────────────────────────────────────────────────────

describe("migration registry — static shape", () => {
  it("includes confirmed zone type backfill with the required shape and unique ids", () => {
    const migrations = listMigrations();
    assert.equal(new Set(migrations.map(m => m.id)).size, migrations.length);
    const m = getMigration("backfill-zone-type-confirmed-v1")!;
    assert.ok(m);
    assert.ok(m.title && m.description && m.appSettingsKey);
    for (const key of ["check", "preview", "run"] as const) assert.equal(typeof m[key], "function");
    assert.ok(!m.deprecated);
  });
  it("contains repair-ticket-total-drift-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("repair-ticket-total-drift-v1"),
      "missing repair-ticket-total-drift-v1",
    );
  });

  it("contains repair-wo-match-estimate-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("repair-wo-match-estimate-v1"),
      "missing repair-wo-match-estimate-v1",
    );
  });

  it("contains invoice-revision-backfill-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("invoice-revision-backfill-v1"),
      "missing invoice-revision-backfill-v1",
    );
  });

  it("contains backfill-merged-invoice-status-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("backfill-merged-invoice-status-v1"),
      "missing backfill-merged-invoice-status-v1",
    );
  });

  it("contains repair-qb-void-mispaid-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("repair-qb-void-mispaid-v1"),
      "missing repair-qb-void-mispaid-v1",
    );
  });

  it("contains repair-woodglenn-wo-hours-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("repair-woodglenn-wo-hours-v1"),
      "missing repair-woodglenn-wo-hours-v1",
    );
  });

  it("contains retire-followup-work-orders-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("retire-followup-work-orders-v1"),
      "missing retire-followup-work-orders-v1",
    );
  });

  // Task #1942 — 0006 was written for #1847 and never wired to anything. The
  // registry is what makes a written-but-unrun migration visible, so
  // membership here is the guard against it going invisible again.
  it("contains invoice-sent-status-backfill-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("invoice-sent-status-backfill-v1"),
      "missing invoice-sent-status-backfill-v1",
    );
  });

  it("contains seed-field-work-types-v1", () => {
    const ids = listMigrations().map((m) => m.id);
    assert.ok(
      ids.includes("seed-field-work-types-v1"),
      "missing seed-field-work-types-v1",
    );
  });

  it("contains backfill-seasonal-budgets-v1", () => {
    const ids = listMigrations().map((migration) => migration.id);
    assert.ok(ids.includes("backfill-seasonal-budgets-v1"));
  });

  it("computes missing and drifted field-work-type rows by company and code", () => {
    const zoneRepair = FIELD_WORK_TYPE_SEEDS.find((seed) => seed.code === "zone_repair")!;
    const rowFor = (companyId: number, overrides: Record<string, unknown> = {}) => ({
      companyId,
      code: zoneRepair.code,
      label: zoneRepair.label,
      requiresController: zoneRepair.requiresController,
      requiresZone: zoneRepair.requiresZone,
      requiresDetails: zoneRepair.requiresDetails,
      sortOrder: zoneRepair.sortOrder,
      ...overrides,
    });

    const state = computeFieldWorkTypeSeedState(
      [10, 20],
      [rowFor(10), rowFor(20, { label: "Zone Fix" })],
    );
    assert.deepEqual(state, {
      companyCount: 2,
      companiesMissingDefaults: 2,
      rowsMissing: 12,
      rowsDrifted: 1,
      companiesWithDrift: 1,
      driftDetails: [
        'Company 20 · zone_repair (Zone Fix): label "Zone Fix" → "Zone Repair"',
      ],
    });
  });

  it("requires preview acknowledgement before the field-work-type seed writes", async () => {
    const migration = getMigration("seed-field-work-types-v1");
    assert.ok(migration);
    const result = await migration.run(() => {});
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "seed-defaults");
    assert.equal(result[0].status, "failed");
    assert.match(result[0].error ?? "", /acknowledgement/i);
  });

  it("does not report the field-work-type migration complete without its marker", () => {
    const reconciled = {
      companyCount: 2,
      companiesMissingDefaults: 0,
      rowsMissing: 0,
      rowsDrifted: 0,
      companiesWithDrift: 0,
      driftDetails: [],
    };
    assert.deepEqual(
      resolveFieldWorkTypeSeedStatus(reconciled),
      {
        state: "partially_applied",
        details: "All defaults are present, but the completion marker is missing.",
      },
    );
    assert.deepEqual(
      resolveFieldWorkTypeSeedStatus(reconciled, "2026-09-02T12:00:00.000Z"),
      {
        state: "completed",
        completedAt: "2026-09-02T12:00:00.000Z",
      },
    );
  });

  // Presets are owned by the source file, so "every row exists" is no longer
  // the same question as "every row is correct". A company holding a stale
  // label still owes the migration a run.
  it("reports the field-work-type migration partially applied while rows have drifted", () => {
    const status = resolveFieldWorkTypeSeedStatus({
      companyCount: 2,
      companiesMissingDefaults: 0,
      rowsMissing: 0,
      rowsDrifted: 2,
      companiesWithDrift: 2,
      driftDetails: [],
    }, "2026-09-02T12:00:00.000Z");
    assert.equal(status.state, "partially_applied");
    assert.match(String((status as any).details), /2 field work type\(s\) differ from the source file/);
  });

  it("previews field-work-type seeding without mutating state", async () => {
    const migration = getMigration("seed-field-work-types-v1");
    assert.ok(migration);
    const result = await migration.preview();
    assert.deepEqual(result.steps.map((step) => step.id), [
      "seed-defaults",
      "mark-done",
    ]);
    assert.ok((result.orphanRows?.companies ?? -1) >= 0);
    assert.ok((result.orphanRows?.fieldWorkTypesMissing ?? -1) >= 0);
    assert.ok((result.orphanRows?.fieldWorkTypesDrifted ?? -1) >= 0);
    // The preview must not promise something the reconcile no longer honours.
    for (const warning of result.warnings) {
      assert.doesNotMatch(warning, /will not be changed/i);
    }
    for (const step of result.steps) {
      assert.doesNotMatch(step.description, /without overwriting/i);
    }
  });

  it("invoice-sent-status-backfill-v1 has the required MigrationDefinition shape", () => {
    const m = getMigration("invoice-sent-status-backfill-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "invoice-sent-status-backfill-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.ok(m.appSettingsKey.length > 0, "appSettingsKey should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
    assert.ok(!m.deprecated, "ported migration must NOT be deprecated");
  });

  // Task #1942 — completion is inferred from the data, and BOTH halves of the
  // work count. Zero rows at status='sent' only proves step 3 ran; a database
  // whose statuses were cleaned by hand still owes the sent_at recovery, and
  // reporting that as completed retires the migration from /admin/migrations
  // with delivery timestamps still missing.
  describe("invoice-sent-status-backfill — inferred completion", () => {
    it("is not complete while sent_at is still recoverable, even with no sent-status rows", () => {
      const state = resolveCheckState(0, 51, null);
      assert.notEqual(state.state, "completed");
      assert.equal(state.state, "partially_applied");
      assert.match(String(state.details), /recoverable from invoice_pdfs/);
    });

    it("is not complete while rows remain at status='sent'", () => {
      assert.equal(resolveCheckState(33, 0, null).state, "partially_applied");
    });

    it("has not started when neither half has been done", () => {
      assert.equal(resolveCheckState(33, 51, null).state, "not_started");
    });

    it("is partially applied, not complete, when a marker exists but work remains", () => {
      const state = resolveCheckState(33, 51, { completedAt: "2026-08-01T00:00:00.000Z" });
      assert.equal(state.state, "partially_applied");
    });

    it("is complete only when both counts are zero, and reports the marker's date", () => {
      assert.deepEqual(resolveCheckState(0, 0, null), { state: "completed", completedAt: "" });
      assert.deepEqual(resolveCheckState(0, 0, { completedAt: "2026-08-01T00:00:00.000Z" }), {
        state: "completed",
        completedAt: "2026-08-01T00:00:00.000Z",
      });
    });
  });

  it("repair-qb-void-mispaid-v1 has the required MigrationDefinition shape", () => {
    const m = getMigration("repair-qb-void-mispaid-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "repair-qb-void-mispaid-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
    assert.ok(!m.deprecated, "new migration must NOT be deprecated");
  });

  it("repair-work-order-parts-v1 has the required MigrationDefinition shape", () => {
    const m = getMigration("repair-work-order-parts-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "repair-work-order-parts-v1");
    assert.ok(m.title.length > 0);
    assert.ok(m.description.length > 0);
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
    assert.ok(!m.deprecated);
  });

  it("does NOT contain reconcile-billing-sheet-invoice-totals-v1 (superseded)", () => {
    const ids = new Set(listMigrations().map((m) => m.id));
    assert.ok(
      !ids.has("reconcile-billing-sheet-invoice-totals-v1"),
      "reconcile-billing-sheet-invoice-totals-v1 should not be in the registry (superseded by repair-ticket-total-drift-v1)",
    );
  });

  it("does NOT contain any of the removed one-shot migrations", () => {
    const ids = new Set(listMigrations().map((m) => m.id));
    const removed = [
      "company-id-columns-v1",
      "work-order-zones-v1",
      "renumber-estimates-v1",
      "reconcile-finding-disposition-v1",
      "trim-phantom-zones-v1",
      "import-irrigation-profile-from-property-controllers-v1",
      "repair-nan-totals-v1",
      "repair-duplicated-work-order-items-v1",
      "repair-wo-items-from-source-v1",
    ];
    for (const id of removed) {
      assert.ok(!ids.has(id), `removed migration ${id} should not be in the registry`);
    }
  });

  it("getMigration returns undefined for unknown id", () => {
    assert.equal(getMigration("nonexistent"), undefined);
  });

  it("repair-ticket-total-drift-v1 has the required MigrationDefinition shape", () => {
    const m = getMigration("repair-ticket-total-drift-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "repair-ticket-total-drift-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
    assert.ok(!m.deprecated, "new migration must NOT be deprecated");
  });

  it("repair-wo-match-estimate-v1 has the required MigrationDefinition shape", () => {
    const m = getMigration("repair-wo-match-estimate-v1");
    assert.ok(m, "getMigration should return a definition");
    assert.equal(m.id, "repair-wo-match-estimate-v1");
    assert.ok(m.title.length > 0, "title should be non-empty");
    assert.ok(m.description.length > 0, "description should be non-empty");
    assert.equal(typeof m.check, "function");
    assert.equal(typeof m.preview, "function");
    assert.equal(typeof m.run, "function");
    assert.ok(!m.deprecated, "new migration must NOT be deprecated");
  });
});

// ── Behavioral tests — repair-wo-match-estimate-v1 ────────────────────────────

describe("repair-wo-match-estimate-v1 — check()", () => {
  const DONE_KEY = "repairWoMatchEstimate.done";

  before(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${DONE_KEY}`);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM app_settings WHERE key = ${DONE_KEY}`);
  });

  it("check() returns a valid MigrationStatus (not error)", async () => {
    const m = getMigration("repair-wo-match-estimate-v1")!;
    const status = await m.check();
    assert.ok(
      status.state === "not_started" ||
      status.state === "partially_applied" ||
      status.state === "completed",
      `Unexpected state: ${status.state}`,
    );
  });

  it("check() returns completed when done marker is set and 0 candidates remain", async () => {
    await db.execute(sql`
      INSERT INTO app_settings (key, value)
      VALUES (${DONE_KEY}, ${new Date().toISOString()})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
    const m = getMigration("repair-wo-match-estimate-v1")!;
    const status = await m.check();
    assert.ok(
      status.state === "completed" || status.state === "partially_applied",
      `Expected completed or partially_applied, got ${status.state}`,
    );
  });
});

describe("repair-wo-match-estimate-v1 — preview()", () => {
  it("returns a valid MigrationPreview shape", async () => {
    const m = getMigration("repair-wo-match-estimate-v1")!;
    const preview = await m.preview();
    assert.ok(Array.isArray(preview.steps), "steps should be an array");
    assert.ok(Array.isArray(preview.warnings), "warnings should be an array");
    assert.ok(typeof preview.orphanRows === "object" && preview.orphanRows !== null, "orphanRows should be an object");
    assert.ok(Object.hasOwn(preview.orphanRows, "candidateWorkOrders"), "orphanRows should have candidateWorkOrders");
    assert.equal(typeof preview.orphanRows.candidateWorkOrders, "number");
  });

  it("each step has a non-empty id and description", async () => {
    const m = getMigration("repair-wo-match-estimate-v1")!;
    const preview = await m.preview();
    for (const step of preview.steps) {
      assert.ok(step.id.length > 0, "step id must be non-empty");
      assert.ok(step.description.length > 0, "step description must be non-empty");
    }
  });

  it("preview has detect_candidates, rebuild_from_estimate, and mark_done steps", async () => {
    const m = getMigration("repair-wo-match-estimate-v1")!;
    const preview = await m.preview();
    const ids = preview.steps.map((s) => s.id);
    assert.ok(ids.includes("detect_candidates"), "missing detect_candidates step");
    assert.ok(ids.includes("rebuild_from_estimate"), "missing rebuild_from_estimate step");
    assert.ok(ids.includes("mark_done"), "missing mark_done step");
  });
});

describe("repair-wo-match-estimate-v1 — run() acknowledgement gate", () => {
  it("run() without acknowledged=true returns a failed detect_candidates step", async () => {
    const m = getMigration("repair-wo-match-estimate-v1")!;
    const results = await m.run(() => {});
    assert.equal(results.length, 1, "should return exactly one step result");
    assert.equal(results[0].id, "detect_candidates");
    assert.equal(results[0].status, "failed");
    assert.ok(results[0].error && results[0].error.length > 0, "error message should be non-empty");
  });
});

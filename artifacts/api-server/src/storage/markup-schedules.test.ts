import { test } from "node:test";
import assert from "node:assert/strict";
import { db, pool } from "../db";
import { companies, customers, materialMarkupSchedules, materialMarkupTiers, customerMarkupScheduleOverrides } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import * as store from "./markup-schedules";
import { seedDefaultMarkupScheduleMigration as seed } from "../lib/migrations/seed-default-markup-schedule";

test("tenant isolation, concurrent activation, immutable versions and schedule tenant FK", async () => {
  const cs = await db.insert(companies).values([{ name: "Markup fixture A" }, { name: "Markup fixture B" }]).returning();
  const ids = cs.map(c => c.id);
  try {
    const [customer] = await db.insert(customers).values({ companyId: ids[0], name: "Fixture", email: "fixture@example.invalid" }).returning();
    const a = await store.createMarkupSchedule({ companyId: ids[0], name: "A", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    assert.equal(a.minimumMarkupDollars, "2.00");
    const b = await store.createMarkupSchedule({ companyId: ids[0], name: "B", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    const foreign = await store.createMarkupSchedule({ companyId: ids[1], name: "Foreign", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    assert.equal(await store.getActiveMarkupSchedule(ids[0]), null);
    await Promise.all([store.activateMarkupSchedule(a.id, ids[0]), store.activateMarkupSchedule(b.id, ids[0])]);
    assert.equal((await store.getMarkupSchedules(ids[0])).filter(s => s.isActive).length, 1);
    const before = await store.getMarkupSchedule(a.id, ids[0]);
    const version = await store.updateMarkupSchedule(a.id, ids[0], { name: "New version", minimumMarkupDollars: 4.5, tiers: DEFAULT_MARKUP_TIERS.map(t => ({ ...t, markupPercent: 10 })) });
    assert.equal(version.minimumMarkupDollars, "4.50");
    assert.equal((await store.getMarkupSchedule(a.id, ids[0]))?.schedule.minimumMarkupDollars, "2.00");
    const copied = await store.updateMarkupSchedule(version.id, ids[0], { name: "Name only" });
    assert.equal(copied.minimumMarkupDollars, "4.50");
    await store.activateMarkupSchedule(version.id, ids[0]);
    for (const minimumMarkupDollars of [-1, .001, Infinity]) {
      await assert.rejects(store.updateMarkupSchedule(version.id, ids[0], { minimumMarkupDollars }));
      assert.equal((await store.getActiveMarkupSchedule(ids[0]))?.schedule.id, version.id);
    }
    await assert.rejects(db.insert(materialMarkupSchedules).values({ companyId: ids[0], name: "Invalid", effectiveDate: "2026-11-11", isActive: false, minimumMarkupDollars: "-1" }));
    assert.notEqual(version.id, a.id);
    assert.equal((await store.getActiveMarkupSchedule(ids[0]))?.schedule.id, version.id);
    assert.deepEqual((await store.getMarkupSchedule(a.id, ids[0]))?.tiers, before?.tiers);
    assert.equal((await store.getMarkupSchedule(a.id, ids[0]))?.schedule.name, "A");
    assert.equal(await store.getMarkupSchedule(a.id, ids[1]), null);
    await assert.rejects(store.activateMarkupSchedule(a.id, ids[1]), store.MarkupNotFound);
    await assert.rejects(store.setCustomerMarkupOverride(customer.id, ids[0], foreign.id), store.MarkupNotFound);
    // During the approved staged Publish, the customer composite FK is
    // intentionally deferred. The write boundary must still reject it.
    await assert.rejects(store.setCustomerMarkupOverride(customer.id, ids[1], foreign.id), store.MarkupNotFound);
    // The schedule composite FK remains a database-enforced tenant boundary.
    await assert.rejects(db.insert(customerMarkupScheduleOverrides).values({ companyId: ids[0], customerId: customer.id, scheduleId: foreign.id }));
    await store.setCustomerMarkupOverride(customer.id, ids[0], a.id);
    await store.setCustomerMarkupOverride(customer.id, ids[0], b.id);
    assert.equal((await store.getCustomerMarkupOverride(customer.id, ids[0]))?.scheduleId, b.id);
    await store.removeCustomerMarkupOverride(customer.id, ids[0]);
    assert.equal(await store.getCustomerMarkupOverride(customer.id, ids[0]), null);
    assert.equal((await seed.run(() => {}))[0].status, "failed");
    const preview = await seed.preview();
    assert.ok(preview.steps.some(s => s.id === `company-${ids[1]}`));
    assert.equal(preview.warnings.length, 7);
    assert.ok(preview.warnings.includes("Minimum markup: $2.00"));
  } finally {
    await db.delete(customerMarkupScheduleOverrides).where(inArray(customerMarkupScheduleOverrides.companyId, ids));
    const ss = await db.select({ id: materialMarkupSchedules.id }).from(materialMarkupSchedules).where(inArray(materialMarkupSchedules.companyId, ids));
    if (ss.length) await db.delete(materialMarkupTiers).where(inArray(materialMarkupTiers.scheduleId, ss.map(s => s.id)));
    await db.delete(materialMarkupSchedules).where(inArray(materialMarkupSchedules.companyId, ids));
    await db.delete(customers).where(inArray(customers.companyId, ids));
    await db.delete(companies).where(inArray(companies.id, ids));
    await pool.end();
  }
});

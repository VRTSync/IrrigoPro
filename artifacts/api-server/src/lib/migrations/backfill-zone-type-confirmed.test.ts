import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../db";
import { companies, customers, irrigationControllers, irrigationProfileZones } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { buildZoneTypePreview, loadZoneTypeCounts, runZoneTypeBackfill, backfillZoneTypeConfirmedMigration } from "./backfill-zone-type-confirmed";
import { getMigration } from "./registry";

describe("zone type backfill — real scoped DB boundary", () => {
  let companyA: number, companyB: number;
  const customerIds: number[] = [], controllerIds: number[] = [];
  before(async () => {
    const tenants = await db.insert(companies).values([{ name: "Type migration A" }, { name: "Type migration B" }]).returning();
    [companyA, companyB] = tenants.map(c => c.id);
    for (const companyId of [companyA, companyB]) {
      const [customer] = await db.insert(customers).values({ companyId, name: "Property", email: "type-test@example.invalid" }).returning();
      customerIds.push(customer.id);
      const [controller] = await db.insert(irrigationControllers).values({ companyId, customerId: customer.id, name: "A", letter: "A" }).returning();
      controllerIds.push(controller.id);
      await db.insert(irrigationProfileZones).values([
        { companyId, controllerId: controller.id, zoneNumber: 1, name: "Chosen", zoneType: "rotor" },
        { companyId, controllerId: controller.id, zoneNumber: 2, name: "Retired", zoneType: "drip", retiredAt: new Date(), isActive: false },
        { companyId, controllerId: controller.id, zoneNumber: 3, name: "Other", zoneType: "other" },
        { companyId, controllerId: controller.id, zoneNumber: 4, name: "Confirmed", zoneType: "rotor", zoneTypeConfirmed: true },
      ]);
    }
  });
  after(async () => {
    await db.delete(irrigationProfileZones).where(inArray(irrigationProfileZones.controllerId, controllerIds));
    await db.delete(irrigationControllers).where(inArray(irrigationControllers.id, controllerIds));
    await db.delete(customers).where(inArray(customers.id, customerIds));
    await db.delete(companies).where(inArray(companies.id, [companyA, companyB]));
  });
  it("registered, previews per-company counts, requires acknowledgement without writes", async () => {
    assert.equal(getMigration("backfill-zone-type-confirmed-v1"), backfillZoneTypeConfirmedMigration);
    const counts = await loadZoneTypeCounts(companyA);
    assert.deepEqual(counts, [{ companyId: companyA, companyName: "Type migration A", eligible: 2, other: 1 }]);
    const preview = buildZoneTypePreview(counts);
    assert.equal(preview.requiresAcknowledgement, true);
    assert.deepEqual(preview.orphanRows, { eligibleZones: 2, otherZones: 1 });
    assert.match(preview.steps[0].description, /2 unconfirmed non-Other.*1 Other/);
    const result = await runZoneTypeBackfill(() => {}, false, companyA);
    assert.equal(result[0].status, "failed");
    assert.equal((await loadZoneTypeCounts(companyA))[0].eligible, 2);
  });
  it("confirms retired history, re-preview zero, safe rerun, no foreign-tenant or Other changes", async () => {
    const foreign = await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.companyId, companyB));
    const beforeRows = await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.companyId, companyA));
    const result = await runZoneTypeBackfill(() => {}, true, companyA);
    assert.ok(result.every(r => r.status === "success"), JSON.stringify(result));
    assert.equal(result[0].rowsAffected, 2);
    assert.equal(buildZoneTypePreview(await loadZoneTypeCounts(companyA)).orphanRows.eligibleZones, 0);
    const afterRows = await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.companyId, companyA));
    for (const row of afterRows) {
      const old = beforeRows.find(r => r.id === row.id)!;
      assert.deepEqual(row, { ...old, zoneTypeConfirmed: row.zoneType !== "other" });
    }
    assert.deepEqual(await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.companyId, companyB)), foreign);
    const second = await runZoneTypeBackfill(() => {}, true, companyA);
    assert.equal(second[0].rowsAffected, 0);
  });
  it("rejects a runner whose UPDATE reports no-op rather than trusting counters", async () => {
    await db.update(irrigationProfileZones).set({ zoneTypeConfirmed: false }).where(eq(irrigationProfileZones.companyId, companyA));
    const spy = mock.method(db, "transaction", async (fn: any) => fn({
      select: db.select.bind(db),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      execute: () => { throw new Error("Must not mark done"); },
    }));
    try {
      const result = await runZoneTypeBackfill(() => {}, true, companyA);
      assert.equal(result.at(-1)!.status, "failed");
      assert.match(result.at(-1)!.error!, /Eligible zones remain/);
    } finally { spy.mock.restore(); }
  });
});

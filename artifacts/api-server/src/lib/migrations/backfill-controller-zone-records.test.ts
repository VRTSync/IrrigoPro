import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../db";
import { storage } from "../../storage";
import { companies, customers, irrigationControllers, irrigationProfileZones, irrigationProfileHistory } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { planControllerZones, buildControllerZonePreview, runControllerZoneBackfill, loadControllerZonePlans, type ControllerZonePlan } from "./backfill-controller-zone-records";
import { getMigration } from "./registry";

const meta = { companyId: 1, companyName: "Company", customerId: 2, customerName: "Property", controllerId: 3, letter: "A", totalZones: 38 };
describe("backfill controller zone records — contracts", () => {
  it("registry membership and preview show counted controllers with no rows", () => {
    assert.ok(getMigration("backfill-controller-zone-records-v1"));
    const plan = planControllerZones(meta, []);
    const preview = buildControllerZonePreview([plan]);
    assert.equal(preview.orphanRows.zonesToCreate, 38);
    assert.equal(preview.requiresAcknowledgement, false);
    assert.match(preview.steps[1].description, /Controller A: 38 \/ 0 rows → create 1-38/);
  });
  it("null count with rows infers highest current number; retired-only stays unknown", () => {
    const plan = planControllerZones({ ...meta, totalZones: null }, [
      { zoneNumber: 1, retiredAt: null }, { zoneNumber: 5, retiredAt: null }, { zoneNumber: 12, retiredAt: new Date() },
    ]);
    assert.equal(plan.target, 5); assert.deepEqual(plan.created, [2, 3, 4]);
    assert.equal(planControllerZones({ ...meta, totalZones: null }, []).needsRepair, false);
    assert.equal(planControllerZones({ ...meta, totalZones: null }, [{ zoneNumber: 5, retiredAt: new Date() }]).target, null);
  });
  it("invalid legacy counts are surfaced, never truncated", () => {
    for (const n of [0, -1, 101, 2.5]) {
      const plan = planControllerZones({ ...meta, totalZones: n }, []);
      assert.ok(plan.invalid); assert.equal(plan.needsRepair, true);
      assert.deepEqual(plan.created, []); assert.deepEqual(plan.retired, []);
    }
    assert.ok(planControllerZones({ ...meta, totalZones: null }, [{ zoneNumber: 101, retiredAt: null }]).invalid);
  });
  it("retirement is acknowledged before any controller writes", async () => {
    let writes = 0;
    const plan = planControllerZones({ ...meta, totalZones: 1 }, [{ zoneNumber: 2, retiredAt: null }]);
    const result = await runControllerZoneBackfill({
      load: async () => [plan], repair: async () => ++writes, markDone: async () => { throw new Error("Must not mark done"); },
    }, () => {});
    assert.equal(result[0].status, "failed"); assert.equal(writes, 0);
    assert.equal(buildControllerZonePreview([plan]).requiresAcknowledgement, true);
  });
  it("a runner claiming success without repairing is rejected by the fresh read", async () => {
    let marked = false;
    const plan = planControllerZones(meta, []);
    const result = await runControllerZoneBackfill({
      load: async () => [plan], repair: async () => 38, markDone: async () => { marked = true; },
    }, () => {});
    assert.equal(result.at(-1)!.status, "failed"); assert.equal(marked, false);
  });
  it("partial failure never marks complete, even if other controllers committed", async () => {
    let plans: ControllerZonePlan[] = [planControllerZones(meta, []), planControllerZones({ ...meta, controllerId: 4, totalZones: 101 }, [])];
    let marked = false;
    const results = await runControllerZoneBackfill({
      load: async () => plans,
      repair: async (_company, id) => { plans = plans.filter(p => p.controllerId !== id); return 38; },
      markDone: async () => { marked = true; },
    }, () => {}, true);
    assert.ok(results.some(result => result.status === "failed")); assert.equal(marked, false);
  });
});

describe("backfill controller zone records — real DB, scoped transactions and actor FK", () => {
  let companyA: number, companyB: number, customerA: number, customerB: number;
  const ids: number[] = [];
  before(async () => {
    const suffix = Date.now();
    const [a, b] = await db.insert(companies).values([{ name: `ZoneMigrationA_${suffix}` }, { name: `ZoneMigrationB_${suffix}` }]).returning();
    companyA = a.id; companyB = b.id;
    const [ca, cb] = await db.insert(customers).values([
      { companyId: companyA, name: "Property A", email: "zone-test-a@example.invalid" },
      { companyId: companyB, name: "Property B", email: "zone-test-b@example.invalid" },
    ]).returning();
    customerA = ca.id; customerB = cb.id;
  });
  after(async () => {
    if (ids.length) await db.delete(irrigationControllers).where(inArray(irrigationControllers.id, ids));
    await db.delete(customers).where(inArray(customers.id, [customerA, customerB]));
    await db.delete(companies).where(inArray(companies.id, [companyA, companyB]));
  });
  it("preview, run, re-preview 0/0; tenant B untouched, null actor references valid, IDs survive", async () => {
    // Deliberately inconsistent legacy fixtures bypass the production mirror writer.
    const [empty, shrink, unknown, foreign] = await db.insert(irrigationControllers).values([
      { companyId: companyA, customerId: customerA, name: "Empty", letter: "A", totalZones: 38 },
      { companyId: companyA, customerId: customerA, name: "Shrink", letter: "B", totalZones: 2 },
      { companyId: companyA, customerId: customerA, name: "Infer", letter: "C", totalZones: null },
      { companyId: companyB, customerId: customerB, name: "Foreign", letter: "A", totalZones: 38 },
    ]).returning();
    ids.push(empty.id, shrink.id, unknown.id, foreign.id);
    const [kept, retired, inferred] = await db.insert(irrigationProfileZones).values([
      { companyId: companyA, controllerId: shrink.id, zoneNumber: 1, name: "Existing 1", notes: "Preserve", isActive: false },
      { companyId: companyA, controllerId: shrink.id, zoneNumber: 3, name: "Existing 3", notes: "Retire with data", isActive: false },
      { companyId: companyA, controllerId: unknown.id, zoneNumber: 3, name: "Existing inferred" },
    ]).returning();
    const preview = buildControllerZonePreview(await loadControllerZonePlans(companyA));
    assert.equal(preview.orphanRows.controllers, 3);
    assert.equal(preview.orphanRows.zonesToCreate, 41);
    assert.equal(preview.orphanRows.zonesToRetire, 1);
    let marked = false;
    const deps = {
      load: () => loadControllerZonePlans(companyA),
      repair: (companyId: number, id: number, ack: boolean) => storage.backfillControllerZoneRecords(companyId, id, ack),
      markDone: async () => { marked = true; },
    };
    const blocked = await runControllerZoneBackfill(deps, () => {});
    assert.equal(blocked[0].status, "failed"); assert.equal(marked, false);
    const events: string[] = [];
    const result = await runControllerZoneBackfill(deps, e => { if (e.status === "success") events.push(e.step); }, true);
    assert.ok(result.every(r => r.status === "success")); assert.equal(marked, true); assert.equal(events.length, 3);
    const second = buildControllerZonePreview(await loadControllerZonePlans(companyA));
    assert.equal(second.orphanRows.controllers, 0); assert.equal(second.orphanRows.zonesToCreate, 0); assert.equal(second.orphanRows.zonesToRetire, 0);
    const rows = await db.select().from(irrigationProfileZones).where(eq(irrigationProfileZones.controllerId, shrink.id));
    assert.equal(rows.find(r => r.id === kept.id)!.notes, "Preserve"); assert.equal(rows.find(r => r.id === kept.id)!.isActive, false);
    const retiredRow = rows.find(r => r.id === retired.id)!;
    assert.ok(retiredRow.retiredAt); assert.equal(retiredRow.notes, "Retire with data"); assert.equal(retiredRow.retiredByUserId, null);
    assert.equal(retiredRow.retiredByName, "Migration backfill-controller-zone-records-v1");
    const history = await storage.getIrrigationHistory(companyA, shrink.id);
    assert.equal(history.length, 1); assert.equal(history[0].changedByUserId, null);
    assert.equal(history[0].changedByName, "Migration backfill-controller-zone-records-v1");
    const inferredDetail = (await storage.getIrrigationController(companyA, unknown.id))!;
    assert.equal(inferredDetail.totalZones, 3); assert.ok(inferredDetail.zones.some(z => z.id === inferred.id));
    assert.equal((await storage.getIrrigationController(companyB, foreign.id))!.zones.length, 0);
    assert.equal(await storage.backfillControllerZoneRecords(companyA, shrink.id, true), 0);
    assert.equal((await storage.getIrrigationHistory(companyA, shrink.id)).length, 1);
    await assert.rejects(storage.backfillControllerZoneRecords(companyA, foreign.id, true), /not found/);
    const restore = await storage.setControllerZoneCount(companyA, shrink.id, 3);
    assert.deepEqual(restore!.restored, [3]); assert.equal((await storage.getIrrigationController(companyA, shrink.id))!.zones.find(z => z.zoneNumber === 3)!.id, retired.id);
  });
  it("bad legacy target prevents completion without truncating or altering its data", async () => {
    const [ctrl] = await db.insert(irrigationControllers).values({
      companyId: companyA, customerId: customerA, name: "Invalid legacy", letter: "D", totalZones: 101,
    }).returning();
    ids.push(ctrl.id);
    await assert.rejects(storage.backfillControllerZoneRecords(companyA, ctrl.id, true), /1-100/);
    assert.equal((await storage.getIrrigationController(companyA, ctrl.id))!.totalZones, 101);
    assert.equal((await db.select().from(irrigationProfileHistory).where(eq(irrigationProfileHistory.controllerId, ctrl.id))).length, 0);
  });
});

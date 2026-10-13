import { before, after, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db, pool } from "./db";
import * as s from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { registerIrrigationProfileRoutes } from "./routes/irrigation-profile-routes";

describe("document controller stamps (isolated real DB fixtures)", () => {
  let company: number, otherCompany: number, customer: number, otherCustomer: number, sibling: number;
  let a: number, b: number, north: number, siblingA: number, foreign: number, part: number, user: number;
  const wetIds: number[] = [];
  const companies: number[] = [];
  const est = (patch: any = {}) => ({
    companyId: company, customerId: customer, customerName: "Stamp customer", customerEmail: "stamp@test.example",
    projectName: "Stamp test", createdBy: "Stamp manager", laborRate: "45", partsSubtotal: "2",
    laborSubtotal: "0", totalAmount: "2", controllerLetter: " a ", zoneNumber: 3, ...patch,
  });
  const wo = (patch: any = {}) => ({
    companyId: company, customerId: customer, customerName: "Stamp customer", customerEmail: "stamp@test.example", projectName: "Stamp test",
    workType: "maintenance", laborRate: "45", totalAmount: "2", controllerLetter: " a ", zoneNumber: 3, ...patch,
  });
  const item = (patch: any = {}) => ({
    partId: part, partName: "Stamp part", partPrice: "2", quantity: 1, laborHours: "0",
    totalPrice: "2", controllerLetter: " a ", zoneNumber: 3, ...patch,
  });
  const bs = (patch: any = {}) => ({
    companyId: company, customerId: customer, customerName: "Stamp customer", propertyAddress: "Test address",
    technicianName: "Stamp manager", workDescription: "Test", workDate: new Date(), totalHours: "0",
    laborRate: "45", laborSubtotal: "0", partsSubtotal: "0", totalAmount: "0", controllerLetter: " a ", ...patch,
  });
  before(async () => {
    for (const name of ["Stamp A", "Stamp B"]) {
      const [row] = await db.insert(s.companies).values({ name: `${name}-${Date.now()}` }).returning();
      companies.push(row.id);
    }
    [company, otherCompany] = companies;
    const customers = await db.insert(s.customers).values([
      { companyId: company, name: "A", email: "a@test.example" },
      { companyId: otherCompany, name: "B", email: "b@test.example" },
      { companyId: company, name: "Sibling", email: "s@test.example" },
    ]).returning();
    [customer, otherCustomer, sibling] = customers.map(c => c.id);
    const controllers = await db.insert(s.irrigationControllers).values([
      { companyId: company, customerId: customer, branchName: "", name: "A", letter: "A" },
      { companyId: company, customerId: customer, branchName: "", name: "B", letter: "B" },
      { companyId: company, customerId: customer, branchName: "North", name: "North A", letter: "A" },
      { companyId: company, customerId: sibling, branchName: "", name: "Sibling A", letter: "A" },
      { companyId: otherCompany, customerId: otherCustomer, branchName: "", name: "Foreign A", letter: "A" },
    ]).returning();
    [a, b, north, siblingA, foreign] = controllers.map(c => c.id);
    const [p] = await db.insert(s.parts).values({ companyId: company, name: "Stamp part", sku: "stamp", price: "2", category: "test", material: "test", size: "test", brand: "test", fittingType: "test" }).returning();
    part = p.id;
    const [u] = await db.insert(s.users).values({ companyId: company, username: `stamp-${Date.now()}`, password: "not-used", name: "Stamp manager", role: "company_admin" }).returning();
    user = u.id;
  });
  after(async () => {
    try {
    if (companies.length) {
      const orders = await db.select({ id: s.workOrders.id }).from(s.workOrders).where(inArray(s.workOrders.companyId, companies));
      const estimates = await db.select({ id: s.estimates.id }).from(s.estimates).where(inArray(s.estimates.companyId, companies));
      const sheets = await db.select({ id: s.billingSheets.id }).from(s.billingSheets).where(inArray(s.billingSheets.companyId, companies));
      if (orders.length) {
        await db.delete(s.workOrderZonePhotos).where(inArray(s.workOrderZonePhotos.workOrderId, orders.map(r => r.id)));
        await db.delete(s.workOrderItems).where(inArray(s.workOrderItems.workOrderId, orders.map(r => r.id)));
      }
      if (estimates.length) await db.delete(s.estimateItems).where(inArray(s.estimateItems.estimateId, estimates.map(r => r.id)));
      if (sheets.length) await db.delete(s.billingSheetItems).where(inArray(s.billingSheetItems.billingSheetId, sheets.map(r => r.id)));
      if (wetIds.length) {
        await db.delete(s.wetCheckFindings).where(inArray(s.wetCheckFindings.wetCheckId, wetIds));
        await db.delete(s.wetCheckZoneRecords).where(inArray(s.wetCheckZoneRecords.wetCheckId, wetIds));
      }
      await db.delete(s.billingSheets).where(inArray(s.billingSheets.companyId, companies));
      await db.delete(s.workOrders).where(inArray(s.workOrders.companyId, companies));
      await db.delete(s.estimates).where(inArray(s.estimates.companyId, companies));
      if (wetIds.length) await db.delete(s.wetChecks).where(inArray(s.wetChecks.id, wetIds));
      await db.delete(s.irrigationControllers).where(inArray(s.irrigationControllers.companyId, companies));
      await db.delete(s.auditLog).where(inArray(s.auditLog.actorCompanyId, companies));
      await db.delete(s.parts).where(inArray(s.parts.companyId, companies));
      await db.delete(s.users).where(inArray(s.users.companyId, companies));
      await db.delete(s.customers).where(inArray(s.customers.companyId, companies));
      await db.delete(s.companies).where(inArray(s.companies.id, companies));
    }
    } finally { await pool.end(); }
  });

  it("normalizes letters, deduplicates one query, skips empty input and isolates all scope dimensions", async () => {
    const scope = { companyId: company, customerId: customer, branchName: null };
    const select = mock.method(db, "select");
    try {
      assert.deepEqual(await storage.resolveControllerIdsByLetter(db, scope, [" a ", "B", "a", null, "Z"]), new Map([["A", a], ["B", b], ["Z", null]]));
      assert.equal(select.mock.callCount(), 1);
      assert.deepEqual(await storage.resolveControllerIdsByLetter(db, scope, [null, "", " "]), new Map());
      assert.equal(select.mock.callCount(), 1);
    } finally { select.mock.restore(); }
    for (const branchName of [null, "", "   "]) assert.equal((await storage.resolveControllerIdsByLetter(db, { ...scope, branchName }, ["A"])).get("A"), a);
    assert.equal((await storage.resolveControllerIdsByLetter(db, { ...scope, branchName: " North " }, ["A"])).get("A"), north);
    assert.equal((await storage.resolveControllerIdsByLetter(db, { ...scope, branchName: "north" }, ["A"])).get("A"), null);
    assert.equal((await storage.resolveControllerIdsByLetter(db, { ...scope, customerId: sibling }, ["A"])).get("A"), siblingA);
    assert.equal((await storage.resolveControllerIdsByLetter(db, { ...scope, customerId: otherCustomer }, ["A"])).get("A"), null);
    assert.notEqual(a, foreign);
  });

  it("canonical estimates, replacements, header restamps and unrelated patches retain snapshots", async () => {
    const e = await storage.createEstimate(est(), [item()]);
    assert.equal(e.controllerId, a); assert.equal(e.items[0].controllerId, a);
    assert.equal((await storage.updateEstimate(e.id, { workDescription: "unrelated" }))!.controllerId, a);
    const changed = await storage.updateEstimate(e.id, { branchName: " North " });
    assert.equal(changed!.controllerId, north); assert.equal((await storage.getEstimateItems(e.id))[0].controllerId, north);
    await storage.updateEstimate(e.id, { customerId: sibling, branchName: null });
    assert.equal((await storage.getEstimateItems(e.id))[0].controllerId, siblingA);
    const replaced = await storage.updateEstimateWithItems(e.id, est({ branchName: "North" }), [item()]);
    assert.equal(replaced.controllerId, north); assert.equal(replaced.items[0].controllerId, north);
    await storage.updateEstimate(e.id, { controllerLetter: null });
    assert.equal((await storage.getEstimate(e.id))!.controllerId, null);
    await db.update(s.irrigationControllers).set({ letter: "E" }).where(eq(s.irrigationControllers.id, north));
    try {
      assert.equal((await storage.updateEstimate(e.id, { controllerLetter: "E" }))!.controllerId, north);
      await db.update(s.irrigationControllers).set({ letter: "F" }).where(eq(s.irrigationControllers.id, north));
      const saved = (await storage.updateEstimate(e.id, { workDescription: "rename survives" }))!;
      assert.equal(saved.controllerId, north); assert.equal(saved.controllerLetter, "E"); assert.equal(saved.zoneNumber, 3);
    } finally { await db.update(s.irrigationControllers).set({ letter: "A" }).where(eq(s.irrigationControllers.id, north)); }
  });

  it("work-order canonical, add/update, both replacements and photo attachment stamp parent scope", async () => {
    const w = await storage.createWorkOrder(wo(), [item() as any]);
    assert.equal(w.controllerId, a); assert.equal((await storage.getWorkOrderItems(w.id))[0].controllerId, a);
    const added = await storage.addWorkOrderItem(item({ workOrderId: w.id }));
    assert.equal(added.controllerId, a);
    assert.equal((await storage.updateWorkOrderItem(added.id, { partName: "changed" }))!.controllerId, a);
    assert.equal((await storage.updateWorkOrderItem(added.id, { controllerLetter: " b " }))!.controllerId, b);
    assert.equal((await storage.updateWorkOrder(w.id, { notes: "unrelated" }))!.controllerId, a);
    await storage.replaceWorkOrderItemsInTransaction(w.id, [item({ workOrderId: w.id })]);
    await storage.updateWorkOrder(w.id, { branchName: "North" });
    assert.equal((await storage.getWorkOrderItems(w.id))[0].controllerId, north);
    const replaced = await storage.replaceWorkOrderItemsWithResync(w.id, [item()], company);
    assert.equal(replaced.items[0].controllerId, north);
    const photo = await storage.attachWorkOrderZonePhoto(w.id, { controllerLetter: " a ", zoneNumber: 3, url: "/test-photo", takenBy: user });
    assert.equal(photo.controllerId, north);
    await storage.updateWorkOrder(w.id, { customerId: sibling, branchName: null });
    assert.equal((await storage.getWorkOrderItems(w.id))[0].controllerId, siblingA);
    assert.equal((await storage.updateWorkOrder(w.id, { controllerLetter: null }))!.controllerId, null);
  });

  it("both estimate-to-work-order seams resolve again rather than copying saved identity", async () => {
    for (const approve of [false, true]) {
      const e = await storage.createEstimate(est({ status: approve ? "pending" : "approved" }), [item()]);
      // Simulate a stale/incorrect identity; current scope letters must win.
      await db.update(s.estimates).set({ controllerId: foreign }).where(eq(s.estimates.id, e.id));
      await db.update(s.estimateItems).set({ controllerId: foreign }).where(eq(s.estimateItems.estimateId, e.id));
      const w = approve ? (await storage.approveEstimateAndCreateWorkOrder(e.id)).workOrder! : await storage.createWorkOrderFromEstimate(e.id, company);
      assert.equal(w.controllerId, a); assert.equal((await storage.getWorkOrderItems(w.id))[0].controllerId, a);
    }
  });

  it("new repeated parts cannot consume explicitly referenced prior locations; explicit null always clears identity", async () => {
    const w = await storage.createWorkOrder(wo(), [item() as any]);
    const [prior] = await storage.getWorkOrderItems(w.id);
    const plain = { partId: part, partName: "Stamp part", partPrice: "2", quantity: 1, laborHours: "0", totalPrice: "2", workOrderId: w.id };
    const replacements = [
      plain,
      { ...plain, sourceItemId: prior.id },
    ];
    const saved = await storage.replaceWorkOrderItemsWithResync(w.id, replacements, company);
    assert.equal(saved.items[0].controllerId, null);
    assert.equal(saved.items[1].controllerId, a);
    // Legacy data can have an ID with a missing letter: an explicit clear
    // still clears that ID, even though the displayed letter was already null.
    await db.update(s.workOrderItems).set({ controllerLetter: null }).where(eq(s.workOrderItems.id, saved.items[1].id));
    const cleared = await storage.replaceWorkOrderItemsWithResync(w.id, [
      { ...plain, sourceItemId: saved.items[1].id, controllerLetter: null },
    ], company);
    assert.equal(cleared.items[0].controllerId, null);
  });

  it("scope restamping is atomic when a child stamp fails", async () => {
    const w = await storage.createWorkOrder(wo(), [item() as any]);
    const original = storage.resolveControllerIdsByLetter.bind(storage);
    let calls = 0;
    const failure = mock.method(storage, "resolveControllerIdsByLetter", async (...args: Parameters<typeof original>) => {
      if (++calls === 2) throw new Error("Injected child stamping failure");
      return original(...args);
    });
    try {
      await assert.rejects(storage.updateWorkOrder(w.id, { branchName: "North" }), /Injected child/);
      assert.equal((await storage.getWorkOrder(w.id, company))!.branchName, null);
      assert.equal((await storage.getWorkOrder(w.id, company))!.controllerId, a);
      assert.equal((await storage.getWorkOrderItems(w.id))[0].controllerId, a);
    } finally { failure.mock.restore(); }
  });

  it("billing sheets stamp create and location edits, while unrelated edits preserve identity", async () => {
    const sheet = await storage.createBillingSheet(bs());
    assert.equal(sheet.controllerId, a);
    assert.equal((await storage.updateBillingSheet(sheet.id, { notes: "unchanged" }))!.controllerId, a);
    assert.equal((await storage.updateBillingSheet(sheet.id, { branchName: "North" }))!.controllerId, north);
    assert.equal((await storage.updateBillingSheet(sheet.id, { customerId: sibling, branchName: null }))!.controllerId, siblingA);
    assert.equal((await storage.updateBillingSheet(sheet.id, { controllerLetter: null }))!.controllerId, null);
  });

  it("unresolved/duplicate letters never block saves and log structured document warnings", async () => {
    // Case-variant legacy duplicates also work on dev DBs retaining the old
    // case-sensitive index; no schema/index changes are needed for this fixture.
    const [duplicate] = await db.insert(s.irrigationControllers).values({ companyId: company, customerId: customer, branchName: "", letter: "a", name: "Legacy duplicate" }).returning();
    const warn = mock.method(logger, "warn", () => {});
    try {
      const e = await storage.createEstimate(est(), [item()]);
      assert.equal(e.controllerId, null); assert.equal(e.items[0].controllerId, null);
      assert.equal((await storage.createWorkOrder(wo({ controllerLetter: "Z" }))).controllerId, null);
      const warning = warn.mock.calls.map(c => c.arguments[0] as any).find(c => c.table === "estimates");
      assert.deepEqual(warning, { op: "stampControllerId", companyId: company, table: "estimates", documentId: e.id, letter: " a " });
    } finally { warn.mock.restore(); await db.delete(s.irrigationControllers).where(eq(s.irrigationControllers.id, duplicate.id)); }
  });

  it("foreign-customer headers cannot stamp another tenant across all header paths", async () => {
    const e = await storage.createEstimate(est({ customerId: otherCustomer }), [item()]);
    assert.equal(e.controllerId, null);
    assert.equal((await storage.updateEstimate(e.id, { controllerLetter: "A" }))!.controllerId, null);
    assert.equal((await storage.updateEstimateWithItems(e.id, est({ customerId: otherCustomer }), [item()])).controllerId, null);
    assert.equal((await storage.createWorkOrder(wo({ customerId: otherCustomer }))).controllerId, null);
    const w = await storage.createWorkOrder(wo());
    assert.equal((await storage.updateWorkOrder(w.id, { customerId: otherCustomer }))!.controllerId, null);
    const sheet = await storage.createBillingSheet(bs({ customerId: otherCustomer }));
    assert.equal(sheet.controllerId, null);
    assert.equal((await storage.updateBillingSheet(sheet.id, { controllerLetter: "A" }))!.controllerId, null);
    await storage.updateEstimate(e.id, { status: "approved" });
    assert.equal((await storage.createWorkOrderFromEstimate(e.id, company)).controllerId, null);
    const pending = await storage.createEstimate(est({ customerId: otherCustomer }), [item()]);
    assert.equal((await storage.approveEstimateAndCreateWorkOrder(pending.id)).workOrder!.controllerId, null);
  });

  for (const mode of ["service", "inspection"]) it(`${mode} conversion copies renamed source identity for new and append destinations`, async () => {
    const [wc] = await db.insert(s.wetChecks).values({ companyId: company, customerId: customer, customerName: "Stamp customer", numControllers: 1, technicianId: user, technicianName: "Stamp manager", propertyAddress: "Test", status: "submitted", mode } as any).returning();
    wetIds.push(wc.id);
    const [zone] = await db.insert(s.wetCheckZoneRecords).values({ wetCheckId: wc.id, controllerId: a, controllerLetter: "A", zoneNumber: 3 }).returning();
    const add = async () => db.insert(s.wetCheckFindings).values(["sent_to_estimate", "deferred_to_work_order"].map(resolution => ({
      wetCheckId: wc.id, zoneRecordId: zone.id, partId: part, partName: "Stamp part", partPrice: "2",
      quantity: 1, laborHours: "0", issueType: "broken_head", issueGroup: "quick_fix", resolution,
    }))).returning();
    await add();
    await db.update(s.irrigationControllers).set({ letter: "E" }).where(eq(s.irrigationControllers.id, a));
    try {
      const first = await storage.convertWetCheckToWetCheckBilling(wc.id, company, { id: user, name: "Stamp manager" });
      await add();
      await db.update(s.wetChecks).set({ status: "partially_converted" }).where(eq(s.wetChecks.id, wc.id));
      const second = await storage.convertWetCheckToWetCheckBilling(wc.id, company, { id: user, name: "Stamp manager" });
      assert.equal(second.estimateId, first.estimateId); assert.equal(second.workOrderId, first.workOrderId);
      for (const rows of [await storage.getEstimateItems(first.estimateId!), await storage.getWorkOrderItems(first.workOrderId!)]) {
        assert.equal(rows.length, 2);
        for (const row of rows) { assert.equal(row.controllerId, a); assert.equal(row.controllerLetter, "A"); assert.equal(row.zoneNumber, 3); }
      }
    } finally { await db.update(s.irrigationControllers).set({ letter: "A" }).where(eq(s.irrigationControllers.id, a)); }
  });

  it("controller DELETE returns actionable 409, deletes unreferenced controllers, preserves 500 and ownership checks", async () => {
    await storage.createWorkOrder(wo());
    const [unused] = await db.insert(s.irrigationControllers).values({ companyId: company, customerId: customer, name: "Unused", branchName: "", letter: "Z" }).returning();
    const app = express();
    registerIrrigationProfileRoutes(app, { requireAuthentication: (req: any, _res, next) => {
      req.authenticatedUserRole = "company_admin"; req.authenticatedUserCompanyId = company; next();
    } });
    const server = createServer(app); await new Promise<void>(r => server.listen(0, r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      const referenced = await fetch(`${base}/api/irrigation-controllers/${a}`, { method: "DELETE" });
      assert.equal(referenced.status, 409);
      assert.deepEqual(await referenced.json(), { message: "This controller has work history (tickets, estimates or wet checks) and can't be deleted. Turn it off instead." });
      assert.equal((await fetch(`${base}/api/irrigation-controllers/${foreign}`, { method: "DELETE" })).status, 404);
      assert.equal((await fetch(`${base}/api/irrigation-controllers/${unused.id}`, { method: "DELETE" })).status, 200);
      const failure = mock.method(storage, "deleteIrrigationController", async () => { throw new Error("unrelated"); });
      try { assert.equal((await fetch(`${base}/api/irrigation-controllers/${b}`, { method: "DELETE" })).status, 500); }
      finally { failure.mock.restore(); }
    } finally { await new Promise<void>((r, reject) => server.close(err => err ? reject(err) : r())); }
  });

  it("real estimate and inline work-order routes preserve converted item locations through ordinary edits and reordered repeated parts", async () => {
    const [wc] = await db.insert(s.wetChecks).values({
      companyId: company, customerId: customer, customerName: "Stamp customer", technicianId: user,
      technicianName: "Stamp manager", numControllers: 1, status: "submitted", mode: "service",
    }).returning();
    wetIds.push(wc.id);
    const zones = await db.insert(s.wetCheckZoneRecords).values([a, b].map((controllerId, i) => ({
      wetCheckId: wc.id, controllerId, controllerLetter: i ? "B" : "A", zoneNumber: i + 3,
    }))).returning();
    await db.insert(s.wetCheckFindings).values(zones.flatMap(zone => ["sent_to_estimate", "deferred_to_work_order"].map(resolution => ({
      wetCheckId: wc.id, zoneRecordId: zone.id, partId: part, partName: "Stamp part", partPrice: "2",
      quantity: 1, laborHours: "0", issueType: "broken_head", issueGroup: "quick_fix", resolution,
    }))));
    const conversion = await storage.convertWetCheckToWetCheckBilling(wc.id, company, { id: user, name: "Stamp manager" });
    const e = (await storage.getEstimate(conversion.estimateId!))!;
    const w = (await storage.getWorkOrder(conversion.workOrderId!, company))!;
    const estimateRows = await storage.getEstimateItems(e.id);
    const workRows = await storage.getWorkOrderItems(w.id);
    const { registerRoutes } = await import("./routes/routes");
    const server = await registerRoutes(express().use(express.json()));
    await new Promise<void>(r => server.listen(0, r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const request = async (method: string, path: string, body: object) => {
      const response = await fetch(base + path, { method,
        headers: { "content-type": "application/json", "x-user-id": String(user), "x-user-role": "company_admin", "x-user-company-id": String(company) },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      return data;
    };
    await db.update(s.irrigationControllers).set({ letter: "E" }).where(eq(s.irrigationControllers.id, a));
    try {
      // As sent by the wizard: source item IDs, prices and quantities only.
      // No location or controller ID supplied by the client.
      await request("PUT", `/api/estimates/${e.id}`, {
        estimate: { ...e, workDescription: "ordinary edit" },
        items: [...estimateRows].reverse().map(row => ({
          sourceItemId: row.id, partId: row.partId, partName: row.partName, partPrice: "3", quantity: 2,
        })),
      });
      let editedEstimate = await storage.getEstimateItems(e.id);
      assert.deepEqual(editedEstimate.map(row => [row.controllerLetter, row.zoneNumber, row.controllerId]), [["B", 4, b], ["A", 3, a]]);
      await request("PUT", `/api/estimates/${e.id}`, {
        estimate: { ...e, workDescription: "legacy-client edit" },
        items: editedEstimate.map(row => ({ partId: row.partId, partName: row.partName, partPrice: "3", quantity: 2 })),
      });
      editedEstimate = await storage.getEstimateItems(e.id);
      assert.deepEqual(editedEstimate.map(row => [row.controllerLetter, row.zoneNumber, row.controllerId]), [["B", 4, b], ["A", 3, a]]);
      await request("PATCH", `/api/work-orders/${w.id}/items`, {
        items: [...workRows].reverse().map(row => ({
          id: row.id, partId: row.partId, partName: row.partName, unitPrice: 3, quantity: 2, laborHours: 0,
        })),
      });
      let editedWork = await storage.getWorkOrderItems(w.id);
      assert.deepEqual(editedWork.map(row => [row.controllerLetter, row.zoneNumber, row.controllerId]), [["B", 4, b], ["A", 3, a]]);
      assert.deepEqual(editedWork.map(row => row.findingId), [...workRows].reverse().map(row => row.findingId));
      // Older clients omit source IDs too. The scoped, ordered fallback
      // retains each repeated part's snapshots and existing identity.
      await request("PATCH", `/api/work-orders/${w.id}/items`, {
        items: editedWork.map(row => ({ partId: row.partId, partName: row.partName, unitPrice: 4, quantity: 2 })),
      });
      editedWork = await storage.getWorkOrderItems(w.id);
      assert.deepEqual(editedWork.map(row => [row.controllerLetter, row.zoneNumber, row.controllerId]), [["B", 4, b], ["A", 3, a]]);
      // Explicit location edits resolve against the current controller list,
      // rather than retaining the old controller's trusted ID.
      await request("PATCH", `/api/work-orders/${w.id}/items`, {
        items: editedWork.map((row, i) => ({
          id: row.id, partId: row.partId, partName: row.partName, unitPrice: 4, quantity: 2,
          ...(i === 1 ? { controllerLetter: "B", zoneNumber: 8 } : {}),
        })),
      });
      assert.equal((await storage.getWorkOrderItems(w.id))[1].controllerId, b);
      // Changing estimate scope restamps retained item snapshots atomically.
      await request("PUT", `/api/estimates/${e.id}`, {
        estimate: { ...e, branchName: "North" },
        items: editedEstimate.map(row => ({ sourceItemId: row.id, partId: row.partId, partName: row.partName, partPrice: "3", quantity: 2 })),
      });
      assert.deepEqual((await storage.getEstimateItems(e.id)).map(row => row.controllerId), [null, north]);
    } finally {
      await db.update(s.irrigationControllers).set({ letter: "A" }).where(eq(s.irrigationControllers.id, a));
      await new Promise<void>((r, reject) => server.close(err => err ? reject(err) : r()));
    }
  });
});

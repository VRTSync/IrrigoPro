import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { companies, parts, users, materialMarkupSchedules, pricingAuditEvents } from "@workspace/db";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import { db, pool } from "../db";
import { createMarkupSchedule, activateMarkupSchedule, updateMarkupSchedule } from "../storage/markup-schedules";
import { registerPartRoutes } from "./parts-routes";
import { registerMarkupRecalculationRoutes } from "./markup-recalculation-routes";

test("catalog writes and approval compute authoritative prices; bulk routes enforce roles, scope and preview", async () => {
  const tenants = await db.insert(companies).values([{ name: "Catalog engine A" }, { name: "Catalog engine B" }]).returning();
  const ids = tenants.map(c => c.id);
  try {
    const [actor] = await db.insert(users).values({ companyId: ids[0], role: "company_admin", name: "Pricing reviewer", username: `catalog-engine-${ids[0]}`, password: "not-a-login" }).returning();
    function appFor(role: any = "company_admin", companyId: number | null = ids[0]) {
      const app = express(); app.use(express.json());
      const auth: any = (req: any, _res: any, next: any) => { req.authenticatedUserRole = role; req.authenticatedUserCompanyId = companyId; req.authenticatedUserId = actor.id; next(); };
      registerPartRoutes(app, { requireAuthentication: auth, applyPricingVisibility: (_req, data) => data });
      registerMarkupRecalculationRoutes(app, auth);
      return app;
    }
    const admin = appFor();
    const manual = await request(admin).post("/api/parts").send({ name: "Manual fixture", category: "Valve", price: "8", cost: "180", sku: "MANUAL" });
    assert.equal(manual.status, 201); assert.equal(manual.body.price, "8.00");
    const schedule = await createMarkupSchedule({ companyId: ids[0], name: "Current", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    await activateMarkupSchedule(schedule.id, ids[0]);
    const part = await request(admin).post("/api/parts").send({ name: "New fixture", category: "Valve", price: ".01", cost: "180", sku: "NEW" });
    assert.equal(part.status, 201); assert.equal(part.body.price, "252.00"); assert.equal(part.body.cost, "180.00");
    const edited = await request(admin).put(`/api/parts/${part.body.id}`).send({ price: ".02", cost: "1.75" });
    assert.equal(edited.status, 200); assert.equal(edited.body.price, "4.38");
    const approved = await request(appFor("billing_manager")).post(`/api/parts/${part.body.id}/approve`).send({ price: ".03", cost: "180" });
    assert.equal(approved.status, 200); assert.equal(approved.body.price, "252.00");
    await updateMarkupSchedule(schedule.id, ids[0], { minimumMarkupDollars: 4.5 });
    const cheap = await request(admin).patch(`/api/parts/${part.body.id}`).send({ cost: ".25", price: ".01" });
    assert.equal(cheap.status, 200); assert.equal(cheap.body.price, "4.75");
    const floorApproval = await request(appFor("billing_manager")).post(`/api/parts/${part.body.id}/approve`).send({ price: ".01", cost: ".65" });
    assert.equal(floorApproval.status, 200); assert.equal(floorApproval.body.price, "5.15");
    const boundaryApproval = await request(appFor("billing_manager")).post(`/api/parts/${part.body.id}/approve`).send({ price: ".01", cost: "5.01" });
    assert.equal(boundaryApproval.status, 200); assert.equal(boundaryApproval.body.price, "12.50");
    const manualAgain = await request(admin).patch(`/api/parts/${part.body.id}`).send({ price: "14", cost: null });
    assert.equal(manualAgain.status, 200); assert.equal(manualAgain.body.price, "14.00"); assert.equal(manualAgain.body.cost, null);
    const zero = await request(admin).patch(`/api/parts/${part.body.id}`).send({ price: "15", cost: 0 });
    assert.equal(zero.status, 200); assert.equal(zero.body.price, "15.00");
    for (const category of ["Rental", "Service", "Labor"]) {
      const excluded = await request(admin).post("/api/parts").send({ name: category, category, cost: 180, price: 70, sku: category });
      assert.equal(excluded.status, 201); assert.equal(excluded.body.price, "70.00"); assert.equal(excluded.body.cost, "180.00");
    }
    assert.equal((await request(appFor("company_admin", ids[1])).put(`/api/parts/${part.body.id}`).send({ price: 1 })).status, 404);
    assert.equal((await request(appFor("company_admin", ids[1])).post(`/api/parts/${part.body.id}/approve`).send({ price: 1 })).status, 404);
    assert.equal((await request(admin).patch(`/api/parts/${part.body.id}`).send({ cost: -1 })).status, 400);
    for (const role of ["billing_manager", "irrigation_manager", "field_tech", "unknown", null]) {
      assert.equal((await request(appFor(role)).post("/api/markup-schedules/recalculate-prices/preview")).status, 403);
      assert.equal((await request(appFor(role)).post("/api/markup-schedules/recalculate-prices").send({ confirmationToken: "fake", offset: 0 })).status, 403);
    }
    assert.equal((await request(appFor("super_admin", null)).post("/api/markup-schedules/recalculate-prices/preview")).status, 400);
    assert.equal((await request(admin).post(`/api/markup-schedules/recalculate-prices/preview?companyId=${ids[1]}`)).status, 404);
    assert.equal((await request(admin).post("/api/markup-schedules/recalculate-prices").send({})).status, 400);
    assert.equal((await request(admin).post("/api/markup-schedules/recalculate-prices").send({ confirmationToken: "fake", offset: 0 })).status, 409);
    const preview = await request(admin).post("/api/markup-schedules/recalculate-prices/preview");
    assert.equal(preview.status, 200); assert.equal(preview.body.eligible, 1); assert.equal(preview.body.excluded, 4);
    const run = await request(admin).post("/api/markup-schedules/recalculate-prices").send({ confirmationToken: preview.body.confirmationToken, offset: 0 });
    assert.equal(run.status, 200); assert.equal(run.body.updated, 1); assert.equal(run.body.done, true);
  } finally {
    await db.delete(pricingAuditEvents).where(inArray(pricingAuditEvents.companyId, ids));
    await db.delete(parts).where(inArray(parts.companyId, ids));
    await db.delete(materialMarkupSchedules).where(inArray(materialMarkupSchedules.companyId, ids));
    await db.delete(users).where(inArray(users.companyId, ids));
    await db.delete(companies).where(inArray(companies.id, ids));
    await pool.end();
  }
});

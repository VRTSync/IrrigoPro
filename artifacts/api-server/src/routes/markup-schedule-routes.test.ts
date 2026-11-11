import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { db, pool } from "../db";
import { companies, customers, materialMarkupSchedules, materialMarkupTiers, customerMarkupScheduleOverrides } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import { registerMarkupScheduleRoutes } from "./markup-schedule-routes";
import { resolveMaterialSchedule } from "../lib/material-pricing";

test("schedule HTTP contracts, roles, retained versions, override resolution and tenant boundaries", async () => {
  const tenants = await db.insert(companies).values([{ name: "Markup HTTP A" }, { name: "Markup HTTP B" }]).returning();
  const ids = tenants.map(t => t.id);
  const appFor = (role: any, companyId: number | null) => {
    const app = express(); app.use(express.json());
    registerMarkupScheduleRoutes(app, (req: any, _res, next) => { req.authenticatedUserRole = role; req.authenticatedUserCompanyId = companyId; next(); });
    return app;
  };
  try {
    const [customer] = await db.insert(customers).values({ companyId: ids[0], name: "Customer", email: "markup@example.invalid" }).returning();
    const admin = appFor("company_admin", ids[0]);
    const billing = appFor("billing_manager", ids[0]);
    const foreign = appFor("company_admin", ids[1]);
    assert.equal((await request(admin).get("/api/markup-schedules/active")).status, 404);
    const created = await request(admin).post("/api/markup-schedules").send({ name: "Contract", effectiveDate: "2026-11-11", tiers: DEFAULT_MARKUP_TIERS });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal(created.body.isActive, false);
    assert.equal((await request(billing).get("/api/markup-schedules")).status, 403);
    assert.equal((await request(billing).get("/api/markup-schedules/options")).status, 200);
    for (const role of [null, "unknown", "field_tech", "bookkeeper", "irrigation_manager"]) {
      assert.equal((await request(appFor(role, ids[0])).post(`/api/markup-schedules/${id}/activate`)).status, 403);
      assert.equal((await request(appFor(role, ids[0])).put(`/api/customers/${customer.id}/markup-override`).send({ scheduleId: id })).status, 403);
    }
    assert.equal((await request(appFor("field_tech", ids[0])).get("/api/markup-schedules/active")).status, 404);
    assert.equal((await request(admin).post(`/api/markup-schedules/${id}/activate`)).status, 200);
    const newVersion = await request(admin).put(`/api/markup-schedules/${id}`).send({ name: "New", tiers: DEFAULT_MARKUP_TIERS.map(t => ({ ...t, markupPercent: 10 })) });
    assert.equal(newVersion.status, 200);
    assert.notEqual(newVersion.body.id, id);
    assert.equal((await request(admin).get(`/api/markup-schedules/${id}`)).body.schedule.name, "Contract");
    assert.equal((await request(foreign).get(`/api/markup-schedules/${id}`)).status, 404);
    assert.equal((await request(foreign).post(`/api/markup-schedules/${id}/activate`)).status, 404);
    assert.equal((await request(foreign).put(`/api/customers/${customer.id}/markup-override`).send({ scheduleId: id })).status, 404);
    assert.equal((await request(admin).get(`/api/markup-schedules/active?companyId=${ids[1]}`)).status, 404);
    assert.equal((await request(appFor("super_admin", null)).get("/api/markup-schedules/active")).status, 400);
    assert.equal((await request(appFor("super_admin", null)).get(`/api/markup-schedules/active?companyId=${ids[0]}`)).status, 200);
    assert.equal((await request(billing).put(`/api/customers/${customer.id}/markup-override`).send({ scheduleId: id })).status, 200);
    assert.equal((await resolveMaterialSchedule(ids[0], customer.id))?.schedule.id, id);
    assert.equal((await request(billing).delete(`/api/customers/${customer.id}/markup-override`)).status, 200);
    assert.equal((await resolveMaterialSchedule(ids[0], customer.id))?.schedule.id, newVersion.body.id);
    assert.equal((await request(admin).post("/api/markup-schedules").send({ name: "Invalid", effectiveDate: "2026-11-11", tiers: [{ ...DEFAULT_MARKUP_TIERS[0], minCost: 1, maxCost: null }] })).status, 400);
    assert.equal((await request(admin).post(`/api/markup-schedules/${newVersion.body.id}/deactivate`)).status, 200);
    assert.equal((await request(admin).get("/api/markup-schedules/active")).status, 404);
  } finally {
    await db.delete(customerMarkupScheduleOverrides).where(inArray(customerMarkupScheduleOverrides.companyId, ids));
    const schedules = await db.select({ id: materialMarkupSchedules.id }).from(materialMarkupSchedules).where(inArray(materialMarkupSchedules.companyId, ids));
    if (schedules.length) await db.delete(materialMarkupTiers).where(inArray(materialMarkupTiers.scheduleId, schedules.map(s => s.id)));
    await db.delete(materialMarkupSchedules).where(inArray(materialMarkupSchedules.companyId, ids));
    await db.delete(customers).where(inArray(customers.companyId, ids));
    await db.delete(companies).where(inArray(companies.id, ids));
    await pool.end();
  }
});

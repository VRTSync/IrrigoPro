import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const tag = `finding-hours-${Date.now()}`;
const tenants: Array<{ company: number; customer: number; tech: number; wc: number; zone: number }> = [];
let server: Server;
let base: string;

async function tenant(suffix: string, mode: "service" | "inspection") {
  const insert = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute(query);
    return Number((result.rows[0] as { id: number }).id);
  };
  const company = await insert(sql`INSERT INTO companies (name, subscription, is_active)
    VALUES (${tag + suffix}, 'basic', true) RETURNING id`);
  const customer = await insert(sql`INSERT INTO customers (company_id, name, email)
    VALUES (${company}, ${tag + suffix}, ${tag + suffix + "@example.test"}) RETURNING id`);
  const tech = await insert(sql`INSERT INTO users (username, password, name, role, company_id, is_active)
    VALUES (${tag + suffix}, 'hashed', 'Finding Test', 'field_tech', ${company}, true) RETURNING id`);
  const wc = await insert(sql`INSERT INTO wet_checks
    (company_id, customer_id, technician_id, technician_name, customer_name, num_controllers, status, labor_mode, mode)
    VALUES (${company}, ${customer}, ${tech}, 'Finding Test', 'Finding Test', 1, 'in_progress', 'flat', ${mode}) RETURNING id`);
  const zone = await insert(sql`INSERT INTO wet_check_zone_records (wet_check_id, controller_letter, zone_number)
    VALUES (${wc}, 'A', 1) RETURNING id`);
  const record = { company, customer, tech, wc, zone };
  tenants.push(record);
  return record;
}

async function configure(company: number, issueType: string, hours: string, active = true) {
  await db.execute(sql`INSERT INTO issue_type_configs
    (company_id, issue_type, issue_group, display_label, default_labor_hours, is_active)
    VALUES (${company}, ${issueType}, 'quick_fix', ${issueType}, ${hours}, ${active})
    ON CONFLICT (company_id, issue_type)
    DO UPDATE SET default_labor_hours = EXCLUDED.default_labor_hours, is_active = EXCLUDED.is_active`);
}

async function send(company: number, method: "POST" | "PATCH", path: string, data: object) {
  const tech = tenants.find(t => t.company === company)?.tech;
  assert.ok(tech);
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": String(tech),
      "x-user-role": "field_tech",
      "x-user-company-id": String(company),
    },
    body: JSON.stringify(data),
  });
  const body = await response.json() as { id?: number; laborHours?: string; message?: string };
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

describe("real finding routes derive tenant catalog hours", () => {
  before(async () => {
    const { registerRoutes } = await import("./routes");
    server = await registerRoutes(express().use(express.json()));
    await new Promise<void>(resolve => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    for (const t of tenants.reverse()) {
      await db.execute(sql`DELETE FROM wet_check_findings WHERE wet_check_id = ${t.wc}`);
      await db.execute(sql`DELETE FROM wet_check_zone_records WHERE wet_check_id = ${t.wc}`);
      await db.execute(sql`DELETE FROM wet_checks WHERE id = ${t.wc}`);
      await db.execute(sql`DELETE FROM issue_type_configs WHERE company_id = ${t.company}`);
      await db.execute(sql`DELETE FROM customers WHERE id = ${t.customer}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${t.tech}`);
      await db.execute(sql`DELETE FROM companies WHERE id = ${t.company}`);
    }
  });

  it("create and quantity-, hours-, and issue-only patch use the current catalog", async () => {
    const t = await tenant("-a", "service");
    await configure(t.company, "head_replacement", "0.25");
    await configure(t.company, "leak_repair", "1.00", false);
    const path = `/api/wet-checks/zone-records/${t.zone}/findings`;
    const created = await send(t.company, "POST", path, {
      issueType: "head_replacement", quantity: 3, repairedInField: true,
      noPartNeeded: true, laborHours: "2.00",
    });
    assert.equal(created.laborHours, "0.75");
    const patchPath = `/api/wet-checks/findings/${created.id}`;
    assert.equal((await send(t.company, "PATCH", patchPath, { quantity: 5 })).laborHours, "1.25");
    assert.equal((await send(t.company, "PATCH", patchPath, { laborHours: "4.00" })).laborHours, "1.25");
    assert.equal((await send(t.company, "PATCH", patchPath, { issueType: "leak_repair" })).laborHours, "5.00");
    await configure(t.company, "head_replacement", "0.05");
    assert.equal((await send(t.company, "PATCH", patchPath, { issueType: "head_replacement", quantity: 3 })).laborHours, "0.15");
    assert.equal((await send(t.company, "PATCH", patchPath, { issueType: "unknown_issue" })).laborHours, "0.00");
    assert.equal((await send(t.company, "PATCH", patchPath, { issueType: "custom_review", repairedInField: false, laborHours: "4.00" })).laborHours, "0.00");
    assert.equal((await send(t.company, "POST", path, {
      issueType: "custom_review", quantity: 1, laborHours: "4.00",
    })).laborHours, "0.00");
    const invalid = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-user-id": String(t.tech),
        "x-user-role": "field_tech", "x-user-company-id": String(t.company),
      },
      body: JSON.stringify({
        issueType: "head_replacement", quantity: 1, repairedInField: true,
        noPartNeeded: true, laborHours: "-1",
      }),
    });
    assert.equal(invalid.status, 400);
  });

  it("inspection preserves editable quarter-hours and service catalogs cannot cross companies", async () => {
    const inspection = await tenant("-inspection", "inspection");
    const inspected = await send(inspection.company, "POST", `/api/wet-checks/zone-records/${inspection.zone}/findings`, {
      issueType: "head_replacement", quantity: 3, laborHours: "1.30",
    });
    assert.equal(inspected.laborHours, "1.25");
    assert.equal((await send(inspection.company, "PATCH", `/api/wet-checks/findings/${inspected.id}`, {
      laborHours: "1.40",
    })).laborHours, "1.50");
    const other = await tenant("-other", "service");
    await configure(other.company, "head_replacement", "0.35");
    const created = await send(other.company, "POST", `/api/wet-checks/zone-records/${other.zone}/findings`, {
      issueType: "head_replacement", quantity: 3, repairedInField: true,
      noPartNeeded: true, laborHours: "4.00",
    });
    assert.equal(created.laborHours, "1.05");
  });
});
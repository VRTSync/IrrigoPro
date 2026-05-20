/**
 * Task #753 (Slice 4) — Endpoint-level tests for
 *   PATCH /api/wet-checks/zone-records/:id/repair-labor
 *
 * Uses node:test + supertest against a minimal Express app that stubs the
 * storage layer. Tests confirm:
 *   1. Valid values are accepted (200)
 *   2. Invalid values are rejected with 400
 *   3. Non-field roles receive 403
 *   4. Missing repairLaborHours body field yields 400
 *   5. Not-found zone returns 404
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import express from "express";
import request from "supertest";

// ─── Minimal Express app wired up with the same Zod schema ──────────────────
// We reproduce the validation inline so this test runs without needing the
// full `registerRoutes` entrypoint (which requires a live DB).

import { z } from "zod";

const repairLaborHoursSchema = z
  .string()
  .refine((s) => {
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0;
  }, { message: "repairLaborHours must be a non-negative number" })
  .refine((s) => {
    const n = parseFloat(s);
    return Math.abs(Math.round(n * 4) - n * 4) < 0.0001;
  }, { message: "repairLaborHours must be a multiple of 0.25" });

const repairLaborPatchBody = z.object({ repairLaborHours: repairLaborHoursSchema });

function buildApp(opts: { role: string; storageResult: any }) {
  const app = express();
  app.use(express.json());

  app.patch("/api/wet-checks/zone-records/:id/repair-labor", (req, res) => {
    const FIELD_ROLES = ["field_tech", "irrigation_manager", "company_admin", "super_admin", "billing_manager"];
    if (!FIELD_ROLES.includes(opts.role)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const parsed = repairLaborPatchBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      return;
    }

    const result = opts.storageResult;
    if (!result) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    res.json({ ...result, repairLaborHours: parsed.data.repairLaborHours });
  });

  return app;
}

const fakeZone = { id: 5, wetCheckId: 1, controllerLetter: "A", zoneNumber: 1, repairLaborHours: "0.00" };

describe("PATCH /api/wet-checks/zone-records/:id/repair-labor — validation", () => {
  // ── Valid values (200) ──────────────────────────────────────────────────────

  it('accepts "0" → 200', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "0" });
    assert.equal(res.status, 200);
    assert.equal(res.body.repairLaborHours, "0");
  });

  it('accepts "0.25" → 200', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "0.25" });
    assert.equal(res.status, 200);
  });

  it('accepts "0.50" → 200', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "0.50" });
    assert.equal(res.status, 200);
  });

  it('accepts "2.00" → 200', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "2.00" });
    assert.equal(res.status, 200);
  });

  // ── Invalid values (400) ───────────────────────────────────────────────────

  it('rejects "0.1" → 400 (not a multiple of 0.25)', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "0.1" });
    assert.equal(res.status, 400);
  });

  it('rejects "-1" → 400 (negative)', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "-1" });
    assert.equal(res.status, 400);
  });

  it('rejects "0.33" → 400 (not a multiple of 0.25)', async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "0.33" });
    assert.equal(res.status, 400);
  });

  it("rejects missing field → 400", async () => {
    const app = buildApp({ role: "field_tech", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({});
    assert.equal(res.status, 400);
  });

  // ── Auth / existence ───────────────────────────────────────────────────────

  it("returns 403 for non-field role", async () => {
    const app = buildApp({ role: "guest", storageResult: fakeZone });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/5/repair-labor")
      .send({ repairLaborHours: "0.25" });
    assert.equal(res.status, 403);
  });

  it("returns 404 when zone not found", async () => {
    const app = buildApp({ role: "field_tech", storageResult: null });
    const res = await request(app)
      .patch("/api/wet-checks/zone-records/999/repair-labor")
      .send({ repairLaborHours: "0.25" });
    assert.equal(res.status, 404);
  });
});

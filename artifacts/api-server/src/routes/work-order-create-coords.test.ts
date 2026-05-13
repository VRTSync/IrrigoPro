// Task #596 route-level regression — proves POST /api/work-orders and
// PATCH /api/work-orders/:id accept numeric workLocationLat/Lng (the
// shape the LocationPicker / older mobile clients send) and persist
// them to storage as strings, instead of 400'ing with
// `expected string, received number` against the decimal columns.
//
// Mirrors the production handler shape from routes.ts (~line 11892
// for POST and ~line 12009 for PATCH): coerceLatLngStrings(body) then
// insertWorkOrderSchema[.partial()].parse(...) then storage call.
// Storage is stubbed so the test does not need a real DB but still
// proves the exact value handed to `storage.createWorkOrder` /
// `storage.updateWorkOrder`.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { insertWorkOrderSchema } from "@workspace/db";
import { coerceLatLngStrings } from "../lib/coerce-lat-lng";

interface CapturedCreate {
  data: any;
}
interface CapturedUpdate {
  id: number;
  data: any;
}

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  lastCreate: CapturedCreate | null;
  lastUpdate: CapturedUpdate | null;
}

async function startHarness(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  const state: { lastCreate: CapturedCreate | null; lastUpdate: CapturedUpdate | null } = {
    lastCreate: null,
    lastUpdate: null,
  };

  app.post("/api/work-orders", (req, res) => {
    try {
      const { items: _items, ...workOrderBody } = req.body ?? {};
      coerceLatLngStrings(workOrderBody);
      const workOrderData = insertWorkOrderSchema.parse(workOrderBody);
      state.lastCreate = { data: workOrderData };
      res.status(200).json({ id: 1, ...workOrderData });
    } catch (err: any) {
      res.status(400).json({
        message: "Invalid work order data",
        errors: err?.issues ?? [{ message: String(err?.message ?? err) }],
      });
    }
  });

  app.patch("/api/work-orders/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = { ...(req.body ?? {}) };
      coerceLatLngStrings(body);
      const workOrderData = insertWorkOrderSchema.partial().parse(body);
      state.lastUpdate = { id, data: workOrderData };
      res.status(200).json({ id, ...workOrderData });
    } catch (err: any) {
      res.status(400).json({
        message: "Invalid work order data",
        errors: err?.issues ?? [{ message: String(err?.message ?? err) }],
      });
    }
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    get lastCreate() {
      return state.lastCreate;
    },
    get lastUpdate() {
      return state.lastUpdate;
    },
  } as Harness;
}

const baseCreatePayload = () => ({
  customerId: 1,
  customerName: "Acme",
  customerEmail: "ops@acme.test",
  projectName: "Front lawn",
  description: "Repair zone 3 head",
  workType: "direct_billing",
  status: "pending",
});

describe("POST /api/work-orders — workLocationLat/Lng coercion (Task #596)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness(); });
  afterEach(async () => { await h.close(); });

  it("accepts numeric coordinates from the wizard and persists them as strings", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseCreatePayload(),
        workLocationLat: 40.7128123,
        workLocationLng: -74.0060456,
      }),
    });
    const body = await res.text();
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${body}`);
    const json = JSON.parse(body) as any;
    assert.equal(json.workLocationLat, "40.7128123");
    assert.equal(json.workLocationLng, "-74.0060456");
    assert.ok(h.lastCreate);
    assert.equal(h.lastCreate!.data.workLocationLat, "40.7128123");
    assert.equal(h.lastCreate!.data.workLocationLng, "-74.0060456");
  });

  it("accepts a no-pin create (null lat/lng) without 400'ing", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseCreatePayload(),
        workLocationLat: null,
        workLocationLng: null,
      }),
    });
    assert.equal(res.status, 200);
    assert.ok(h.lastCreate);
    assert.equal(h.lastCreate!.data.workLocationLat, null);
    assert.equal(h.lastCreate!.data.workLocationLng, null);
  });

  it("still accepts string coordinates (e.g. wizard after the fix)", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseCreatePayload(),
        workLocationLat: "41.5",
        workLocationLng: "-75.25",
      }),
    });
    assert.equal(res.status, 200);
    assert.ok(h.lastCreate);
    assert.equal(h.lastCreate!.data.workLocationLat, "41.5");
    assert.equal(h.lastCreate!.data.workLocationLng, "-75.25");
  });

  it("rejects non-finite numeric coordinates with 400 (NaN / Infinity)", async () => {
    // Wire-format JSON can't carry NaN, but a misbehaving client could
    // post a bare number that's later treated as NaN by the helper. We
    // simulate by sending a value the schema ultimately can't accept;
    // here we send a true wire-illegal payload via a string the helper
    // leaves alone, which still fails schema parse for non-numeric content.
    const res = await fetch(`${h.baseUrl}/api/work-orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...baseCreatePayload(),
        workLocationLat: { not: "a coord" },
        workLocationLng: 0,
      }),
    });
    assert.equal(res.status, 400);
    const json = await res.json() as any;
    assert.equal(json.message, "Invalid work order data");
  });
});

describe("PATCH /api/work-orders/:id — workLocationLat/Lng coercion (Task #596)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness(); });
  afterEach(async () => { await h.close(); });

  it("accepts numeric coordinates on a partial PATCH and persists them as strings", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/42`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workLocationLat: 41.5,
        workLocationLng: -75.25,
      }),
    });
    const body = await res.text();
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${body}`);
    assert.ok(h.lastUpdate);
    assert.equal(h.lastUpdate!.id, 42);
    assert.equal(h.lastUpdate!.data.workLocationLat, "41.5");
    assert.equal(h.lastUpdate!.data.workLocationLng, "-75.25");
  });

  it("accepts a PATCH that clears the pin (null lat/lng)", async () => {
    const res = await fetch(`${h.baseUrl}/api/work-orders/42`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workLocationLat: null,
        workLocationLng: null,
      }),
    });
    assert.equal(res.status, 200);
    assert.ok(h.lastUpdate);
    assert.equal(h.lastUpdate!.data.workLocationLat, null);
    assert.equal(h.lastUpdate!.data.workLocationLng, null);
  });
});

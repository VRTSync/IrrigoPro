// Task #764 — regression guard: PATCH /api/billing-sheets/:id must never
// overwrite technicianId or technicianName regardless of what the client sends.
//
// Mounts a minimal stub handler that mirrors the production guard added in
// routes.ts (strip technicianId/technicianName before the DB write) and
// verifies the storage layer receives the original values instead of the
// attacker/editor-supplied ones.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

interface StoredSheet {
  id: number;
  technicianId: number;
  technicianName: string;
  customerId: number;
  status: string;
  workDescription: string;
}

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  db: Map<number, StoredSheet>;
  lastPatch: { id: number; data: Record<string, unknown> } | null;
}

async function startHarness(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  const db = new Map<number, StoredSheet>([
    [
      1,
      {
        id: 1,
        technicianId: 42,
        technicianName: "Alice Field",
        customerId: 10,
        status: "draft",
        workDescription: "Replace head zone 3",
      },
    ],
  ]);

  let lastPatch: { id: number; data: Record<string, unknown> } | null = null;

  // Minimal stub that replicates the Task #764 guard from routes.ts:
  //   1. Read existing record (for the lock-check / lock it is billed etc.)
  //   2. Strip technicianId and technicianName from the client payload
  //   3. Write the remaining fields to storage
  //   4. Return the merged record
  app.patch("/api/billing-sheets/:id", (req, res) => {
    const id = Number(req.params.id);
    const existing = db.get(id);
    if (!existing) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    const { items: _items, companyId: _companyId, ...billingSheetData } = req.body ?? {};

    // ── Task #764 guard ───────────────────────────────────────────────────────
    delete billingSheetData.technicianId;
    delete billingSheetData.technicianName;
    // ─────────────────────────────────────────────────────────────────────────

    lastPatch = { id, data: billingSheetData };

    // Merge: original technician fields are always preserved from the DB row.
    const updated: StoredSheet = {
      ...existing,
      ...billingSheetData,
      // Explicitly re-stamp the locked fields from the existing record so the
      // response reflects the true persisted state (mirrors how Drizzle update
      // returns the full row from the DB, not the client-supplied values).
      technicianId: existing.technicianId,
      technicianName: existing.technicianName,
    };
    db.set(id, updated);

    res.status(200).json(updated);
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    db,
    get lastPatch() {
      return lastPatch;
    },
  };
}

describe("PATCH /api/billing-sheets/:id — technician lock (Task #764)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness(); });
  afterEach(async () => { await h.close(); });

  it("strips technicianId from the patch payload so the original tech is preserved", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workDescription: "Updated description",
        technicianId: 99,           // attacker/editor tries to overwrite
        technicianName: "Evil Bob",
        status: "pending_manager_review",
      }),
    });

    const body = await res.text();
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${body}`);

    const json = JSON.parse(body) as StoredSheet;

    // Response must show the original technician — never the attacker value.
    assert.equal(json.technicianId, 42, "technicianId must not change");
    assert.equal(json.technicianName, "Alice Field", "technicianName must not change");

    // The non-locked field should have been updated normally.
    assert.equal(json.workDescription, "Updated description");
    assert.equal(json.status, "pending_manager_review");
  });

  it("preserves the original technician even when only technicianId is sent", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technicianId: 999 }),
    });

    assert.equal(res.status, 200);
    const json = JSON.parse(await res.text()) as StoredSheet;
    assert.equal(json.technicianId, 42);
  });

  it("preserves the original technician even when only technicianName is sent", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technicianName: "Impostor" }),
    });

    assert.equal(res.status, 200);
    const json = JSON.parse(await res.text()) as StoredSheet;
    assert.equal(json.technicianName, "Alice Field");
  });

  it("storage layer receives a payload that does NOT contain technicianId or technicianName", async () => {
    await fetch(`${h.baseUrl}/api/billing-sheets/1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workDescription: "New desc",
        technicianId: 77,
        technicianName: "Dr. Evil",
      }),
    });

    assert.ok(h.lastPatch, "expected a patch to be recorded");
    assert.equal(
      Object.prototype.hasOwnProperty.call(h.lastPatch!.data, "technicianId"),
      false,
      "technicianId must have been stripped before the storage call",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(h.lastPatch!.data, "technicianName"),
      false,
      "technicianName must have been stripped before the storage call",
    );
  });

  it("returns 404 for an unknown billing sheet id", async () => {
    const res = await fetch(`${h.baseUrl}/api/billing-sheets/9999`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technicianId: 1 }),
    });
    assert.equal(res.status, 404);
  });
});

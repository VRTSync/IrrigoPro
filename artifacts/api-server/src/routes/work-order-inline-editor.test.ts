// Work order inline editor route contract tests.
//
// Tests that:
//   (a) GET /api/work-orders/:id embeds items (calls getWorkOrderItems) so the
//       LineItemsEditor and TotalHoursEditor in the command center inline pane
//       receive the data they need.
//   (b) PATCH /api/work-orders/:id/labor-hours calls storage.updateWorkOrderLaborHours.
//   (c) PATCH /api/work-orders/:id/items calls storage.replaceWorkOrderItemsWithResync.
//   (d) Both PATCH endpoints guard field_tech callers (403).
//   (e) Both PATCH endpoints surface WO_LOCKED → 409.
//   (f) Both PATCH endpoints validate the request body with Zod (400/422 on bad input).
//
// Routes live inline in routes.ts (monolith); we verify expected contracts via
// source-code scanning — same approach as rate-mode-routes.test.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROUTES_SRC = readFileSync(
  path.join(import.meta.dirname ?? __dirname, "routes.ts"),
  "utf8",
);

// ── helpers ───────────────────────────────────────────────────────────────────

function regionAround(anchor: string, chars = 1500): string {
  const idx = ROUTES_SRC.indexOf(anchor);
  if (idx === -1) return "";
  return ROUTES_SRC.slice(Math.max(0, idx - 200), idx + chars);
}

// ── GET /api/work-orders/:id — items embed ────────────────────────────────────

describe("Work-order inline editor — GET items embed", () => {
  it("GET /api/work-orders/:id is registered", () => {
    assert.ok(
      ROUTES_SRC.includes('app.get("/api/work-orders/:id"'),
      "GET /api/work-orders/:id not found in routes.ts",
    );
  });

  it("GET handler calls getWorkOrderItems to embed items", () => {
    assert.ok(
      ROUTES_SRC.includes("getWorkOrderItems"),
      "routes.ts must call storage.getWorkOrderItems inside the GET /api/work-orders/:id handler",
    );
  });

  it("GET handler maps partPrice to unitPrice for the InlineItem shape", () => {
    assert.ok(
      ROUTES_SRC.includes("unitPrice: item.partPrice"),
      "GET handler must remap partPrice → unitPrice so the frontend InlineItem shape is satisfied",
    );
  });

  it("GET handler includes items in the response JSON", () => {
    assert.ok(
      ROUTES_SRC.includes("items: woItems"),
      "GET /api/work-orders/:id must include items in the response object",
    );
  });
});

// ── PATCH /api/work-orders/:id/labor-hours ────────────────────────────────────

describe("Work-order inline editor — PATCH labor-hours", () => {
  it("PATCH /api/work-orders/:id/labor-hours is registered", () => {
    assert.ok(
      ROUTES_SRC.includes('app.patch("/api/work-orders/:id/labor-hours"'),
      "PATCH /api/work-orders/:id/labor-hours not found in routes.ts",
    );
  });

  it("labor-hours handler calls storage.updateWorkOrderLaborHours", () => {
    assert.ok(
      ROUTES_SRC.includes("updateWorkOrderLaborHours"),
      "routes.ts must call storage.updateWorkOrderLaborHours",
    );
  });

  it("labor-hours handler forbids field_tech (403 guard present)", () => {
    const ctx = regionAround('app.patch("/api/work-orders/:id/labor-hours"');
    assert.ok(
      ctx.includes("field_tech") || (ctx.includes("403") && ctx.includes("Forbidden")),
      "PATCH /api/work-orders/:id/labor-hours must return 403 for field_tech callers",
    );
  });

  it("labor-hours handler maps WO_LOCKED to 409", () => {
    const ctx = regionAround("updateWorkOrderLaborHours");
    assert.ok(
      ctx.includes('"WO_LOCKED"') && (ctx.includes("status(409)") || ctx.includes(".status(409)")),
      "PATCH /api/work-orders/:id/labor-hours must map WO_LOCKED → 409",
    );
  });

  it("labor-hours body is validated with Zod", () => {
    const ctx = regionAround('app.patch("/api/work-orders/:id/labor-hours"');
    assert.ok(
      ctx.includes("safeParse") || ctx.includes("laborHoursBody"),
      "PATCH /api/work-orders/:id/labor-hours must validate the request body with Zod",
    );
  });
});

// ── PATCH /api/work-orders/:id/items ─────────────────────────────────────────

describe("Work-order inline editor — PATCH items", () => {
  it("PATCH /api/work-orders/:id/items is registered", () => {
    assert.ok(
      ROUTES_SRC.includes('app.patch("/api/work-orders/:id/items"'),
      "PATCH /api/work-orders/:id/items not found in routes.ts",
    );
  });

  it("items handler calls storage.replaceWorkOrderItemsWithResync", () => {
    assert.ok(
      ROUTES_SRC.includes("replaceWorkOrderItemsWithResync"),
      "routes.ts must call storage.replaceWorkOrderItemsWithResync",
    );
  });

  it("items handler forbids field_tech (403 guard present)", () => {
    const ctx = regionAround('app.patch("/api/work-orders/:id/items"');
    assert.ok(
      ctx.includes("field_tech") || (ctx.includes("403") && ctx.includes("Forbidden")),
      "PATCH /api/work-orders/:id/items must return 403 for field_tech callers",
    );
  });

  it("items handler maps WO_LOCKED to 409", () => {
    const ctx = regionAround("replaceWorkOrderItemsWithResync");
    assert.ok(
      ctx.includes('"WO_LOCKED"') && (ctx.includes("status(409)") || ctx.includes(".status(409)")),
      "PATCH /api/work-orders/:id/items must map WO_LOCKED → 409",
    );
  });

  it("items body is validated with Zod (items array)", () => {
    assert.ok(
      ROUTES_SRC.includes('app.patch("/api/work-orders/:id/items"') &&
      ROUTES_SRC.includes("itemsBody.safeParse") &&
      ROUTES_SRC.includes("z.array("),
      "PATCH /api/work-orders/:id/items must validate items array with Zod",
    );
  });

  it("items handler maps partPrice from unitPrice before passing to storage", () => {
    assert.ok(
      ROUTES_SRC.includes("partPrice: String(i.unitPrice)"),
      "items handler must translate unitPrice → partPrice when building insert rows",
    );
  });
});

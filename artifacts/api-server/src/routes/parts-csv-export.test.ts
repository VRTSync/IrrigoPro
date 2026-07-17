// Integration tests: GET /api/parts/export-csv
//
// Uses registerPartsExportRoute (the production extracted handler) with a
// stub storage — the same pattern as work-order-list-tenant-isolation.test.ts.
// This guarantees the tests exercise the real handler code, not a duplicate.
//
// Covers:
//   (a) Correct header row + one row per company part; ordered by category then name
//   (b) Fields with commas/quotes/newlines are RFC 4180 escaped
//   (c) Inactive and pending parts are included
//   (d) Pricing-visibility masking: field_tech sees blank Price/Cost;
//       company_admin sees real values
//   (e) Company isolation: company A export contains no company B parts
//   (f) Round-trip: exported CSV triggers the bulk-import enhanced-format
//       auto-detection and all required columns are present
//   (g) Unauthenticated caller → 401 before storage is touched

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Part } from "@workspace/db/schema";
import {
  registerPartsExportRoute,
  type PartsExportStorage,
} from "./parts-export-route";

// ── Auth stub (mirrors production header-auth contract) ────────────────────────
const requireAuthentication: RequestHandler = (req: any, res, next) => {
  const userId = req.headers["x-user-id"];
  const role = req.headers["x-user-role"];
  if (!userId || !role) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  req.authenticatedUserId = parseInt(String(userId), 10);
  req.authenticatedUserRole = String(role);
  const cid = req.headers["x-user-company-id"];
  req.authenticatedUserCompanyId = cid ? parseInt(String(cid), 10) : null;
  next();
};

// ── applyPricingVisibility stub ────────────────────────────────────────────────
// Mirrors production rule: field_tech callers see no price/cost.
function applyPricingVisibility(req: any, data: any): any {
  if (req.authenticatedUserRole !== "field_tech") return data;
  const mask = (part: any) => ({ ...part, price: null, cost: null });
  return Array.isArray(data) ? data.map(mask) : mask(data);
}

// ── Stub storage ───────────────────────────────────────────────────────────────
function makeStorage(fixture: Record<number, Part[]>): PartsExportStorage & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    async getParts(companyId: number) {
      calls.push(companyId);
      return fixture[companyId] ?? [];
    },
  };
}

// ── Part fixture helper ────────────────────────────────────────────────────────
function makePart(overrides: Partial<Part>): Part {
  return {
    id: 1,
    companyId: 5,
    name: "Test Part",
    description: null,
    price: "10.00",
    cost: "5.00",
    sku: "TEST-001",
    category: "Sprinkler",
    material: null,
    size: null,
    brand: null,
    fittingType: null,
    detail: null,
    quickbooksId: null,
    isActive: true,
    approvalStatus: "approved",
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Harness ────────────────────────────────────────────────────────────────────
interface Harness {
  baseUrl: string;
  storage: PartsExportStorage & { calls: number[] };
  close: () => Promise<void>;
}

function startHarness(fixture: Record<number, Part[]>): Promise<Harness> {
  return new Promise((resolve) => {
    const storage = makeStorage(fixture);
    const app: Express = express();
    app.use(express.json());

    registerPartsExportRoute(app, {
      requireAuthentication,
      applyPricingVisibility: applyPricingVisibility as any,
      storage,
    });

    const server: Server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        storage,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

async function getExport(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; contentDisposition: string | null }> {
  const res = await fetch(`${baseUrl}/api/parts/export-csv`, { headers });
  const text = await res.text();
  return { status: res.status, text, contentDisposition: res.headers.get("content-disposition") };
}

// ── CSV parser (RFC 4180) ──────────────────────────────────────────────────────
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.split(/\r\n|\n/);
  for (const line of lines) {
    if (!line) continue;
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        fields.push(current); current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    rows.push(fields);
  }
  return rows;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────
const FIXTURE: Record<number, Part[]> = {
  5: [
    makePart({ id: 1, companyId: 5, category: "Backflow", name: "PVB 1in",   sku: "BF-001", price: "45.00", cost: "22.00" }),
    makePart({ id: 2, companyId: 5, category: "Sprinkler", name: "Pop-up Head", sku: "SP-002", price: "12.00", cost: null }),
    makePart({ id: 3, companyId: 5, category: "Backflow", name: "RP 1.5in",  sku: "BF-003", price: "99.00", cost: "50.00", isActive: false }),
    makePart({ id: 4, companyId: 5, category: "Controller", name: "ESP-Me",   sku: "CTRL-004", price: "199.00", cost: "120.00", approvalStatus: "pending" }),
  ],
  9: [
    makePart({ id: 99, companyId: 9, category: "Valve", name: "Gate Valve 2in", sku: "VL-099", price: "33.00", cost: "15.00" }),
  ],
};

const ADMIN_HEADERS = {
  "x-user-id": "10",
  "x-user-role": "company_admin",
  "x-user-company-id": "5",
};

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("GET /api/parts/export-csv — via registerPartsExportRoute", () => {
  let harness: Harness;

  beforeEach(async () => { harness = await startHarness(FIXTURE); });
  afterEach(async () => { await harness.close(); });

  it("(a) correct header row (14 columns matching bulk-import enhanced format)", async () => {
    const { status, text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    assert.equal(status, 200);
    const rows = parseCSV(text);
    assert.deepEqual(rows[0], [
      "Part Type", "Product/Service Name", "SKU", "Sales Description",
      "Price", "Cost", "Brand", "Size", "Material", "Fitting Type",
      "Detail", "Active", "Approval Status", "QuickBooks ID",
    ]);
  });

  it("(a) one data row per company part (4 parts for company 5)", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const rows = parseCSV(text);
    assert.equal(rows.length, 5, "header + 4 data rows expected");
    const skus = rows.slice(1).map((r) => r[2]);
    assert.ok(skus.includes("BF-001"), "BF-001 missing");
    assert.ok(skus.includes("SP-002"), "SP-002 missing");
    assert.ok(skus.includes("BF-003"), "BF-003 missing");
    assert.ok(skus.includes("CTRL-004"), "CTRL-004 missing");
  });

  it("(a) rows ordered by category then name", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const names = parseCSV(text).slice(1).map((r) => r[1]);
    // Backflow < Controller < Sprinkler; within Backflow: PVB 1in < RP 1.5in
    assert.equal(names[0], "PVB 1in");
    assert.equal(names[1], "RP 1.5in");
    assert.equal(names[2], "ESP-Me");
    assert.equal(names[3], "Pop-up Head");
  });

  it("(a) storage.getParts called with caller's companyId", async () => {
    await getExport(harness.baseUrl, ADMIN_HEADERS);
    assert.deepEqual(harness.storage.calls, [5], "getParts must be called with companyId 5");
  });

  it("(b) field with comma is RFC 4180 quoted", async () => {
    const fixture: Record<number, Part[]> = {
      5: [makePart({ id: 10, name: "Valve, 1in", sku: "VL-010", description: "Standard, gate", price: "9.99", cost: null })],
    };
    const h = await startHarness(fixture);
    try {
      const { text } = await getExport(h.baseUrl, ADMIN_HEADERS);
      assert.ok(text.includes('"Valve, 1in"'), "name with comma must be quoted");
      assert.ok(text.includes('"Standard, gate"'), "description with comma must be quoted");
    } finally { await h.close(); }
  });

  it("(b) embedded double-quote is doubled (RFC 4180 escape)", async () => {
    const fixture: Record<number, Part[]> = {
      5: [makePart({ id: 11, name: 'Hunter 1" Nozzle', sku: "HU-011", price: "5.00", cost: null })],
    };
    const h = await startHarness(fixture);
    try {
      const { text } = await getExport(h.baseUrl, ADMIN_HEADERS);
      assert.ok(text.includes('"Hunter 1"" Nozzle"'), "embedded quote must be double-escaped");
    } finally { await h.close(); }
  });

  it("(b) field with newline is RFC 4180 quoted", async () => {
    const fixture: Record<number, Part[]> = {
      5: [makePart({ id: 12, name: "Part A", sku: "PA-012", description: "line1\nline2", price: "1.00", cost: null })],
    };
    const h = await startHarness(fixture);
    try {
      const { text } = await getExport(h.baseUrl, ADMIN_HEADERS);
      assert.ok(text.includes('"line1\nline2"'), "description with newline must be quoted");
    } finally { await h.close(); }
  });

  it("(c) inactive part is included, Active column = false", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const rows = parseCSV(text).slice(1);
    const row = rows.find((r) => r[2] === "BF-003");
    assert.ok(row, "inactive part BF-003 must appear");
    assert.equal(row![11], "false");
  });

  it("(c) pending part is included, Approval Status column = pending", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const rows = parseCSV(text).slice(1);
    const row = rows.find((r) => r[2] === "CTRL-004");
    assert.ok(row, "pending part CTRL-004 must appear");
    assert.equal(row![12], "pending");
  });

  it("(d) company_admin: Price and Cost are populated", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const row = parseCSV(text).slice(1).find((r) => r[2] === "BF-001")!;
    assert.equal(row[4], "45.00");
    assert.equal(row[5], "22.00");
  });

  it("(d) field_tech: Price and Cost are blank", async () => {
    const { text } = await getExport(harness.baseUrl, {
      "x-user-id": "20",
      "x-user-role": "field_tech",
      "x-user-company-id": "5",
    });
    const rows = parseCSV(text).slice(1);
    for (const row of rows) {
      assert.equal(row[4], "", `Price must be blank for field_tech, got "${row[4]}"`);
      assert.equal(row[5], "", `Cost must be blank for field_tech, got "${row[5]}"`);
    }
  });

  it("(e) company 5 export contains no company 9 parts", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const skus = parseCSV(text).slice(1).map((r) => r[2]);
    assert.ok(!skus.includes("VL-099"), "company 9 part must not appear");
    assert.equal(skus.length, 4);
  });

  it("(e) company 9 export contains only its own parts", async () => {
    const { text } = await getExport(harness.baseUrl, {
      "x-user-id": "30",
      "x-user-role": "company_admin",
      "x-user-company-id": "9",
    });
    const rows = parseCSV(text).slice(1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][2], "VL-099");
  });

  it("(f) exported CSV triggers enhanced-format auto-detection in bulk-import", async () => {
    const { text } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    const lines = text.trim().split(/\r\n|\n/);
    const parseCSVLine = (line: string) => {
      const result: string[] = [];
      let current = ""; let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      result.push(current.trim());
      return result;
    };
    const headers = parseCSVLine(lines[0]);
    assert.ok(headers.includes("Part Type"), "Part Type column");
    assert.ok(headers.includes("Product/Service Name"), "Product/Service Name column");
    assert.ok(headers.includes("Price"), "Price column");
    assert.ok(headers.includes("SKU"), "SKU column");
    assert.ok(headers.includes("Cost"), "Cost column");
    assert.ok(headers.includes("Brand"), "Brand column");
    assert.ok(headers.includes("Material"), "Material column");
    assert.ok(headers.includes("Size"), "Size column");
    assert.ok(headers.includes("Fitting Type"), "Fitting Type column");
    assert.ok(headers.includes("Detail"), "Detail column");
    assert.ok(headers.includes("Sales Description"), "Sales Description column");
    // Must satisfy the enhanced-format detection predicate in bulk-import
    assert.ok(
      headers.includes("Part Type") && headers.includes("Product/Service Name") && headers.includes("Price"),
      "enhanced-format detection predicate must be satisfied",
    );
  });

  it("(g) unauthenticated caller → 401, storage not touched", async () => {
    const { status } = await getExport(harness.baseUrl, {});
    assert.equal(status, 401);
    assert.deepEqual(harness.storage.calls, [], "storage must not be called");
  });

  it("Content-Disposition contains companyId and today's date", async () => {
    const { status, contentDisposition } = await getExport(harness.baseUrl, ADMIN_HEADERS);
    assert.equal(status, 200);
    assert.ok(contentDisposition, "Content-Disposition must be set");
    const date = new Date().toISOString().slice(0, 10);
    assert.ok(
      contentDisposition!.includes(`parts-catalog-5-${date}.csv`),
      `Expected filename parts-catalog-5-${date}.csv in: ${contentDisposition}`,
    );
  });

  it("caller without companyId → 400", async () => {
    const { status } = await getExport(harness.baseUrl, {
      "x-user-id": "1",
      "x-user-role": "super_admin",
      // no x-user-company-id → null
    });
    assert.equal(status, 400);
  });
});

// Static checks against the production registrations. See
// auth-middleware-coverage.test.ts for why registerRoutes is not mounted here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");

function getHandler(path: string): string {
  const marker = `  app.get("${path}",`;
  const start = routes.indexOf(marker);
  assert.notEqual(start, -1, `Missing GET ${path}`);
  const end = routes.indexOf("\n  });", start);
  assert.notEqual(end, -1, `Missing handler end for GET ${path}`);
  return routes.slice(start, end);
}

for (const path of ["/api/customers", "/api/customers/:id"]) {
  test(`GET ${path} applies pricing visibility without dropping billing-note visibility`, () => {
    assert.match(getHandler(path), /res\.json\(applyPricingVisibility\(req, applyBillingNotesVisibility\(/);
  });
}

test("GET /api/companies only lists all companies for super admins", () => {
  const handler = getHandler("/api/companies");
  assert.match(handler, /if \(req\.authenticatedUserRole === "super_admin"\) \{\s*res\.json\(await storage\.getCompanies\(\)\);\s*return;\s*\}/);
  assert.match(handler, /const companyId = req\.authenticatedUserCompanyId;/);
  assert.match(handler, /storage\.getCompany\(companyId\)/);
  assert.match(handler, /res\.json\(own \? \[own\] : \[\]\)/);
});

test("the production work-order list restricts field techs to their own assignments and strips pricing", () => {
  const handler = getHandler("/api/work-orders");
  const branch = handler.match(/if \(userRole === 'field_tech'\) \{([\s\S]*?)\n {6}\}/)?.[1];
  assert.ok(branch, "Missing field-tech branch in the production work-order list");
  assert.match(branch, /getWorkOrdersByTechnician\(userId,/);
  assert.match(branch, /res\.json\(applyPricingVisibility\(req, ownPage\)\)/);
});

test("retired endpoints are not registered", () => {
  for (const path of [
    "/api/parts/import/google-sheets",
    "/api/parts/sync-google-docs",
    "/api/integrations/google-sheets/customers/status",
    "/api/integrations/google-sheets/customers/connect",
    "/api/integrations/google-sheets/customers/sync",
    "/api/integrations/google-sheets/customers/disconnect",
    "/api/work-orders/:id/create-invoice",
    "/api/work-orders/:id/sync-quickbooks",
    "/api/sample-invoice-pdf",
    "/api/security/status",
    "/api/security/incident",
    "/api/logs",
    "/api/logs/export",
    "/api/logs/summary",
  ]) {
    assert.ok(!routes.includes(path), `Retired route still appears: ${path}`);
  }
});

test("retired storage methods are removed", () => {
  for (const method of [
    "syncCustomersFromGoogleSheets",
    "getGoogleSheetsCustomerStatus",
    "connectGoogleSheetsCustomers",
    "disconnectGoogleSheetsCustomers",
    "syncPartsFromGoogleDocs",
  ]) {
    assert.ok(!storage.includes(method), `Retired storage method still appears: ${method}`);
  }
});

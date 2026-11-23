// Keep these checks DB-free: registerRoutes has startup side effects, and
// assembly-routes imports the storage singleton. The notification update
// predicate is also exercised against the database in the storage test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const assemblyRoutes = readFileSync(new URL("./assembly-routes.ts", import.meta.url), "utf8");

function registrations(source: string) {
  return [...source.matchAll(/^ {2}app\.(get|post|put|delete|patch)\("([^"]+)"[\s\S]*?^ {2}\}\);/gm)]
    .map(([source, method, path]) => ({ source, method, path }));
}

const main = registrations(routes);
function handler(method: string, path: string): string {
  const route = main.find((route) => route.method === method && route.path === path);
  assert.ok(route, `Missing ${method.toUpperCase()} ${path}`);
  return route.source;
}

function precedes(source: string, first: string, second: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.ok(firstIndex >= 0 && secondIndex > firstIndex, `${first} must precede ${second}`);
}

test("bulk work order deletion checks ownership before invoice status or deletion", () => {
  const source = handler("delete", "/api/work-orders/bulk");
  const lookup = "storage.getWorkOrder(id, scopeCompanyId)";
  assert.match(source, /const scopeCompanyId = req\.authenticatedUserRole === 'super_admin' \? null : req\.authenticatedUserCompanyId!/);
  precedes(source, "const scopeCompanyId", "for (const id of validIds)");
  assert.match(source, /getWorkOrder\(id, scopeCompanyId\);\s*if \(!woBefore\) \{\s*notFound\.push\(id\);\s*continue;/);
  for (const operation of ["storage.hasInvoiceItems(", "storage.deleteWorkOrderItems(", "storage.deleteWorkOrder("]) {
    precedes(source, lookup, operation);
    precedes(source, "if (!woBefore)", operation);
  }
  assert.match(source, /if \(deleted === 0 && skipped\.length > 0 && notFound\.length === 0\)/);
  assert.match(source, /res\.json\(\{ deleted, skipped, notFound, skipMessage \}\)/);
});

test("bulk billing sheet deletion treats foreign and missing sheets alike", () => {
  const source = handler("delete", "/api/billing-sheets/bulk");
  assert.match(source, /const scopeCompanyId = req\.authenticatedUserRole === 'super_admin' \? null : req\.authenticatedUserCompanyId!/);
  precedes(source, "const scopeCompanyId", "for (const id of validIds)");
  assert.match(source, /getBillingSheetById\(id, scopeCompanyId\);\s*if \(!owned\) \{\s*results\.push\(\{ id, status: 'not_found' \}\);\s*continue;/);
  precedes(source, "storage.getBillingSheetById(", "storage.deleteBillingSheet(");
  precedes(source, "if (!owned)", "storage.deleteBillingSheet(");
});

test("assembly routes use company ownership rather than default or client-supplied identity", () => {
  assert.doesNotMatch(assemblyRoutes, /\|\|\s*1\b|assembly(?:\?\.|\.)createdBy/);
  assert.match(assemblyRoutes, /if \(!assembly \|\| \(scope !== null && assembly\.companyId !== scope\)\) \{\s*res\.status\(404\)/);

  const assembly = registrations(assemblyRoutes);
  assert.equal(assembly.length, 6);
  for (const { method, path, source } of assembly) {
    if (["put", "delete", "post"].includes(method) && !path.endsWith("/track-usage")) {
      assert.match(source, /canWrite\(req\)/, `${method} ${path} must check the write role`);
    }
    if (path.includes(":id")) {
      assert.match(source, /loadOwned\(/, `${method} ${path} must check ownership`);
    }
  }
});

test("assembly writes validate part ownership and cannot reassign the assembly", () => {
  const assembly = registrations(assemblyRoutes);
  const create = assembly.find(({ method, path }) => method === "post" && path === "/api/assemblies");
  const update = assembly.find(({ method }) => method === "put");
  const usage = assembly.find(({ path }) => path.endsWith("/track-usage"));
  assert.ok(create && update && usage);
  assert.match(create.source, /createdBy: req\.authenticatedUserId/);
  precedes(create.source, "assertPartsInCompany(partsData, assemblyData.companyId)", "storage.createAssembly(");
  assert.match(update.source, /omit\(\{ companyId: true, createdBy: true \}\)/);
  precedes(update.source, "assertPartsInCompany(partsData, existing.companyId)", "storage.updateAssembly(");
  assert.match(usage.source, /trackAssemblyUsage\(existing\.companyId, id\)/);
});

test("notifications can only be marked read by their recipient", () => {
  assert.doesNotMatch(routes, /app\.post\("\/api\/notifications"/);
  assert.match(handler("put", "/api/notifications/:id/read"), /markNotificationAsRead\(id, req\.authenticatedUserId!?\)/);
  assert.match(handler("put", "/api/notifications/:userId/read-all"), /requireAuthentication,\s*requireNotificationAccess,/);
});

test("local attachments cannot be uploaded and only super admins can read them", () => {
  assert.doesNotMatch(routes, /app\.post\("\/api\/upload\/attachment"/);
  const source = handler("get", "/api/attachments/{*fileName}");
  assert.match(source, /if \(req\.authenticatedUserRole !== 'super_admin'\) \{\s*res\.status\(403\)\.json\(\{ message: "Forbidden" \}\);\s*return;/);
  precedes(source, "req.authenticatedUserRole", "fs.existsSync(");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

it("GET /api/admin/client-errors rejects roles other than super_admin before querying", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const routeStart = source.indexOf('app.get("/api/admin/client-errors"');
  assert.notEqual(routeStart, -1, "Crash reports GET route must be registered");

  const guard = source.slice(routeStart, routeStart + 300);
  assert.match(
    guard,
    /if \(role !== "super_admin"\) \{\s+res\.status\(403\)\.json\(\{ message: "Super admin access required" \}\);\s+return;\s+\}/,
  );
  assert.ok(!guard.includes('"company_admin"'), "Company admins must not read platform crash reports");
});

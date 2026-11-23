import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Like auth-middleware-coverage.test.ts, inspect the real route registrations
// without starting registerRoutes' scheduled jobs or database session store.
const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");

function handlerSource(method: string, path: string): string {
  const marker = `  app.${method}("${path}"`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing registration for ${method.toUpperCase()} ${path}`);
  const end = source.indexOf("\n  });", start);
  assert.ok(end > start, `Missing end of registration for ${method.toUpperCase()} ${path}`);
  return source.slice(start, end);
}

describe("user route guard coverage", () => {
  for (const [method, path, guard] of [
    ["get", "/api/users/:id/dependencies", "canManageUser"],
    ["post", "/api/users/:id/soft-delete", "canManageUser"],
    ["delete", "/api/users/:id/hard-delete", "canManageUser"],
    ["delete", "/api/users/:id", "canManageUser"],
    ["get", "/api/company/:companyId/users", "assertCompanyUserAdmin"],
    ["post", "/api/company/:companyId/users", "assertCompanyUserAdmin"],
    ["put", "/api/company/:companyId/users/:userId", "assertCompanyUserAdmin"],
    ["post", "/api/company/:companyId/users/:userId/deactivate", "assertCompanyUserAdmin"],
    ["post", "/api/company/:companyId/users/:userId/change-password", "assertCompanyUserAdmin"],
  ] as const) {
    it(`${method.toUpperCase()} ${path} requires authentication and calls ${guard}`, () => {
      const handler = handlerSource(method, path);
      assert.ok(handler.includes("requireAuthentication,"));
      assert.ok(handler.includes(`${guard}(`));
    });
  }

  it("also checks the target on all company-user mutations of existing users", () => {
    const prefix = "/api/company/:companyId/users/:userId";
    for (const handler of [
      handlerSource("put", prefix),
      handlerSource("post", `${prefix}/deactivate`),
      handlerSource("post", `${prefix}/change-password`),
    ]) {
      assert.match(handler, /canManageUser\(/);
    }
  });

  it("does not register the legacy account update route or use old response shapers", () => {
    assert.doesNotMatch(source, /app\.put\("\/api\/users\/:id"/);
    for (const retired of ["safeUserShape", "password: _", "({ password, ...user })"]) {
      assert.ok(!source.includes(retired), `Found retired response shaper: ${retired}`);
    }
  });
});

describe("user authentication wiring", () => {
  it("checks company assignment immediately before throttling on all three paths", () => {
    assert.equal((source.match(/rejectCompanyless\(req, res\)/g) ?? []).length, 3);
    assert.equal((source.match(
      /if \(!rejectCompanyless\(req, res\)\) return;\n\s*if \(!checkAuthenticatedThrottle\(req, res\)\) return;/g,
    ) ?? []).length, 3);
  });

  it("destroys sessions for missing, inactive, or deleted users before returning 401", () => {
    const auth = source.indexOf("const requireAuthentication =");
    const start = source.indexOf("if (req.session && req.session.userId)", auth);
    const end = source.indexOf("// Legacy header-based auth path", start);
    assert.ok(auth >= 0 && start > auth && end > start);
    const session = source.slice(start, end);
    assert.match(session, /if \(!user \|\| !user\.isActive \|\| user\.isDeleted\)/);
    assert.match(session, /req\.session\.destroy\?\.\(\(\) => \{\}\);\s+res\.status\(401\)[^\n]+\n\s+return;/);
  });
});

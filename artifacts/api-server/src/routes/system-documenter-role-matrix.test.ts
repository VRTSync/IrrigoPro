import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod/v4";
import { insertUserSchema } from "@workspace/db";
import {
  ROLES, isRole, hasCapability, hasRoleApiAllowlist, isApiAllowedForRole,
  CAN_READ_IRRIGATION_PROFILE, CAN_EDIT_IRRIGATION_ZONES,
  CAN_MANAGE_IRRIGATION_EQUIPMENT, CAN_DELETE_IRRIGATION_EQUIPMENT,
  CAN_DOCUMENT_IRRIGATION_SYSTEM,
} from "@workspace/shared";
import { storage } from "../storage";
import { registerIrrigationProfileRoutes } from "./irrigation-profile-routes";
import { enforceRoleApiAllowlist } from "./role-guards";

// Captured on the unmodified branch with these deterministic storage fixtures.
// Each migrated guard shape is represented, including the individual zone write
// (not allowlisted for the documenter). Missing equipment deliberately yields 404.
const baseline = [
  ["GET", "/api/customers/1/controllers-profile", "read", 200],
  ["GET", "/api/irrigation-controllers/1", "read", 404],
  ["GET", "/api/customers/1/backflows", "read", 200],
  ["POST", "/api/customers/1/controllers-profile", "manage", 400],
  ["PUT", "/api/irrigation-controllers/1", "manage", 404],
  ["POST", "/api/irrigation-controllers/1/programs", "manage", 400],
  ["PUT", "/api/irrigation-programs/1", "manage", 404],
  ["DELETE", "/api/irrigation-programs/1", "manage", 404],
  ["POST", "/api/customers/1/backflows", "manage", 400],
  ["PUT", "/api/backflows/1", "manage", 404],
  ["PUT", "/api/irrigation-controllers/1/zone-count", "zones", 400],
  ["PUT", "/api/irrigation-zones/1", "zones", 404],
  ["PUT", "/api/irrigation-controllers/1/zones/bulk", "zones", 400],
  ["POST", "/api/irrigation-controllers/1/photo", "zones", 400],
  ["POST", "/api/backflows/1/log-test", "zones", 400],
  ["DELETE", "/api/irrigation-controllers/1", "delete", 404],
  ["DELETE", "/api/backflows/1", "delete", 404],
] as const;
const existingAccess: Record<string, readonly string[]> = {
  super_admin: ["read", "manage", "zones", "delete"],
  company_admin: ["read", "manage", "zones", "delete"],
  irrigation_manager: ["read", "manage", "zones", "delete"],
  billing_manager: ["read"],
  field_tech: ["read", "zones"],
  bookkeeper: [],
};

let server: Server;
let base: string;
const auth: RequestHandler = (req, res, next) => {
  req.authenticatedUserRole = String(req.headers["x-test-role"]);
  req.authenticatedUserCompanyId = 1;
  if (enforceRoleApiAllowlist(req, res)) next();
};
async function hit(role: string, method: string, path: string, body: unknown = {}) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "x-test-role": role, "Content-Type": "application/json" },
    ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Execute the monolith's actual registration statements, not rewritten handlers.
// AST extraction avoids starting its unrelated scheduled jobs/session store.
const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  let result = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(sourceFile) === name)) {
      result = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(result, `real declaration ${name} exists`);
  return result;
}
function execute(code: string, deps: Record<string, unknown>) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), compiled)(...Object.values(deps));
}
const userWrites = [
  ["post", "/api/users"],
  ["put", "/api/users/:id"],
  ["patch", "/api/users/:id"],
  ["post", "/api/company/:companyId/users"],
  ["put", "/api/company/:companyId/users/:userId"],
] as const;
function userRegistrations() {
  const statements: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (ts.isPropertyAccessExpression(call.expression) &&
        call.expression.expression.getText(sourceFile) === "app" &&
        call.arguments[0] && ts.isStringLiteral(call.arguments[0]) &&
        userWrites.some(([method, path]) => call.expression.getText(sourceFile) === `app.${method}` &&
          (call.arguments[0] as ts.StringLiteral).text === path)) statements.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(statements.length, 5);
  return statements.join("\n");
}
let realAuth: RequestHandler;
const warnings: unknown[][] = [];
before(async () => {
  mock.method(storage, "getCustomer", async () => ({ id: 1, companyId: 1, totalControllers: 0 }));
  mock.method(storage, "listIrrigationControllers", async () => []);
  mock.method(storage, "ensureIrrigationControllers", async () => []);
  mock.method(storage, "listBackflows", async () => []);
  for (const name of [
    "getIrrigationController", "updateIrrigationController", "deleteIrrigationController",
    "updateIrrigationProgram", "deleteIrrigationProgram", "updateIrrigationZone",
    "updateBackflow", "deleteBackflow",
  ] as const) mock.method(storage, name, async () => undefined);
  // Assert the storage boundary receives company scope, not a body-supplied id.
  mock.method(storage, "updateIrrigationController", async (companyId: number | null, id: number, patch: Record<string, unknown>) =>
    id === 3 && companyId === 1 ? { id, companyId, ...patch } : undefined);
  mock.method(storage, "getUser", async (id: number) => ({
    id, name: "Fixture", username: "fixture", isActive: true, password: "not-returned",
    role: id === 13 ? "super_admin" : id === 12 ? "system_documenter" : "field_tech",
    companyId: id === 99 ? 2 : 1,
  }));
  mock.method(storage, "createUser", async (data: Record<string, unknown>) => ({ id: 20, ...data }));
  mock.method(storage, "updateUser", async (id: number, data: Record<string, unknown>) => ({ id, role: "field_tech", companyId: 1, ...data }));
  mock.method(storage, "getCompany", async () => ({ id: 1, isActive: true }));
  mock.method(storage, "checkCompanyProfileExists", async () => true);
  mock.method(storage, "getActiveMobileTokenByHash", async () => ({
    userId: 12, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
  }));
  realAuth = execute(`${declaration("requireAuthentication")}\nreturn requireAuthentication;`, {
    storage, enforceRoleApiAllowlist,
    checkAuthenticatedThrottle: () => true,
    verifyImpersonationToken: () => ({ actorUserId: 13, targetUserId: 12 }),
    crypto: { createHash: () => ({ update: () => ({ digest: () => "fixture-hash" }) }) },
    headerUserId: (req: express.Request) => req.headers["x-user-id"],
    headerUserRole: (req: express.Request) => req.headers["x-user-role"],
    headerUserCompanyId: (req: express.Request) => req.headers["x-user-company-id"],
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers["x-test-session"]) (req as any).session = { userId: 12 };
    (req as any).log = { warn: (...args: unknown[]) => warnings.push(args) };
    next();
  });
  registerIrrigationProfileRoutes(app, { requireAuthentication: auth });
  execute(`${declaration("ROLE_RANK")}\n${declaration("requireCompanySetup")}\n${userRegistrations()}`, {
    app, storage, requireAuthentication: auth, isRole, insertUserSchema, z,
    crypto: { randomBytes: () => ({ toString: () => "fixture-verification" }) },
    EmailService: { sendEmailVerification: async () => {} },
    headerUserId: () => undefined, headerUserRole: () => undefined,
    recordAuditEvent: async () => {},
  });
  const prefixed = express.Router();
  prefixed.get("/customers", realAuth, (_req, res) => res.json({ leaked: true }));
  app.use("/api", prefixed);
  // Generic authenticated probes demonstrate that unrelated handlers are never
  // reached, while unimplemented reserved paths still use the ordinary 404.
  for (const path of ["/api/work-orders", "/api/wet-checks", "/api/invoices"]) {
    app.get(path, auth, (_req, res) => res.json({ leaked: true }));
  }
  app.use("/api", auth);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  mock.restoreAll();
});

describe("existing-role irrigation baseline", () => {
  for (const [role, access] of Object.entries(existingAccess)) {
    it(role, async () => {
      for (const [method, path, group, allowedStatus] of baseline) {
        const response = await hit(role, method, path);
        // The successful update fixture below is separate from the captured
        // missing-record baseline: controller 1 is absent, controller 2 is foreign.
        assert.equal(response.status, access.includes(group) ? allowedStatus : 403, `${method} ${path}`);
      }
    });
  }
});

describe("documenter registry and exact API matcher", () => {
  it("recognizes the role and only the specified five capability memberships", () => {
    assert.equal(ROLES.at(-1), "system_documenter");
    const sets = [
      [CAN_READ_IRRIGATION_PROFILE, ["super_admin", "company_admin", "irrigation_manager", "billing_manager", "field_tech", "system_documenter"]],
      [CAN_EDIT_IRRIGATION_ZONES, ["super_admin", "company_admin", "irrigation_manager", "field_tech", "system_documenter"]],
      [CAN_MANAGE_IRRIGATION_EQUIPMENT, ["super_admin", "company_admin", "irrigation_manager", "system_documenter"]],
      [CAN_DELETE_IRRIGATION_EQUIPMENT, ["super_admin", "company_admin", "irrigation_manager"]],
      [CAN_DOCUMENT_IRRIGATION_SYSTEM, ["super_admin", "company_admin", "irrigation_manager", "system_documenter"]],
    ] as const;
    for (const [capability, members] of sets) {
      assert.deepEqual([...capability], [...members]);
      for (const role of [...ROLES, "wizard", null, undefined]) {
        assert.equal(hasCapability(role, capability), (members as readonly unknown[]).includes(role));
      }
    }
  });
  const rules = [
    ["GET", "/api/system-documentation/sites"],
    ["GET", "/api/system-documentation/customers/1/site"],
    ["PUT", "/api/system-documentation/customers/1/site/controller-order"],
    ["POST", "/api/system-documentation/customers/1/site/no-backflow"],
    ["POST", "/api/system-documentation/customers/1/site/verify"],
    ["POST", "/api/customers/1/controllers-profile"],
    ["PUT", "/api/irrigation-controllers/1"],
    ...["programs", "photo", "field-verify"].map(p => ["POST", `/api/irrigation-controllers/1/${p}`]),
    ...["zone-count", "zones/bulk"].map(p => ["PUT", `/api/irrigation-controllers/1/${p}`]),
    ["PUT", "/api/irrigation-programs/1"], ["DELETE", "/api/irrigation-programs/1"],
    ["POST", "/api/customers/1/backflows"], ["PUT", "/api/backflows/1"],
    ["POST", "/api/backflows/1/log-test"], ["POST", "/api/backflows/1/field-verify"],
    ["POST", "/api/upload/photo"], ["POST", "/api/upload/photo/finalize"],
    ["POST", "/api/photos/signed-urls"], ["GET", "/api/photos/signed-url"],
    ["GET", "/api/photos/company/path.jpg"],
  ];
  it("matches every rule, normalized methods, queries and HEAD; anchors all non-photo rules", () => {
    assert.equal(hasRoleApiAllowlist("system_documenter"), true);
    for (const role of [...Object.keys(existingAccess), "wizard", "toString", null, undefined]) {
      assert.equal(hasRoleApiAllowlist(role), false);
      assert.equal(isApiAllowedForRole(role, "PATCH", "/anything"), true);
    }
    for (const [method, path] of rules) {
      assert.equal(isApiAllowedForRole("system_documenter", method.toLowerCase(), `${path}?x=1`), true, path);
      assert.equal(isApiAllowedForRole("system_documenter", method, `/prefix${path}`), false);
      if (!path.startsWith("/api/photos/") || method !== "GET") {
        assert.equal(isApiAllowedForRole("system_documenter", method, `${path}/extra`), false);
        assert.equal(isApiAllowedForRole("system_documenter", method, `${path}/`), false);
      }
      if (method === "GET") assert.equal(isApiAllowedForRole("system_documenter", "HEAD", path), true);
      assert.equal(isApiAllowedForRole("system_documenter", "PATCH", path), false);
    }
    for (const path of ["/api/irrigation-controllers/1/history", "/api/irrigation-controllers/abc", "/api/photos/", "/api/system-documentation/sites-evil", "/api/system-documentation/customers/1/site/controller-order-evil"]) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) assert.equal(isApiAllowedForRole("system_documenter", method, path), false);
    }
  });
});

describe("documenter real route boundaries", () => {
  it("admits every existing allowlisted irrigation action to normal validation/storage", async () => {
    for (const [method, path, group, status] of baseline) {
      if (group === "read" || group === "delete" || path === "/api/irrigation-zones/1") continue;
      assert.equal((await hit("system_documenter", method, path)).status, status, `${method} ${path}`);
    }
  });
  it("refuses legacy/customer/operational reads and equipment deletion with the exact message", async () => {
    for (const [method, path] of [
      ["GET", "/api/customers"], ["GET", "/api/customers/1/controllers-profile"],
      ["GET", "/api/irrigation-controllers/1"], ["GET", "/api/customers/1/backflows"],
      ["DELETE", "/api/irrigation-controllers/1"], ["DELETE", "/api/backflows/1"],
      ["GET", "/api/work-orders"], ["GET", "/api/wet-checks"], ["GET", "/api/invoices"],
      ["PUT", "/api/irrigation-zones/1"],
    ]) {
      const response = await hit("system_documenter", method, path);
      // /customers is registered on a prefixed router using real authentication.
      if (path === "/api/customers") {
        const res = await fetch(`${base}${path}`, { headers: { "x-user-id": "12", "x-user-role": "system_documenter", "x-user-company-id": "1" } });
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { message: "Not available for this role" });
      } else assert.deepEqual(response, { status: 403, body: { message: "Not available for this role" } });
    }
  });
  it("preserves foreign-company 404 and passes authenticated company scope to storage", async () => {
    const result = await hit("system_documenter", "PUT", "/api/irrigation-controllers/2", { name: "Foreign", companyId: 2 });
    assert.equal(result.status, 404);
    const calls = (storage.getIrrigationController as any).mock.calls;
    assert.equal(calls.at(-1).arguments[0], 1);
    assert.equal(calls.at(-1).arguments[1], 2);
  });
  it("reserved documentation and verification endpoints remain 404", async () => {
    for (const [method, path] of [
      ["GET", "/api/system-documentation/sites"], ["GET", "/api/system-documentation/customers/1/site"],
      ["POST", "/api/system-documentation/customers/1/site/verify"], ["POST", "/api/system-documentation/customers/1/site/no-backflow"],
      ["POST", "/api/irrigation-controllers/1/field-verify"], ["POST", "/api/backflows/1/field-verify"],
    ]) assert.equal((await hit("system_documenter", method, path)).status, 404);
  });
  it("real authentication restricts impersonation, bearer, session, and dev fallback on a prefixed router", async () => {
    for (const headers of [
      { "x-impersonation-token": "fixture" },
      { authorization: "Bearer fixture" },
      { "x-test-session": "1" },
      { "x-user-id": "12", "x-user-role": "system_documenter", "x-user-company-id": "1" },
    ]) {
      const res = await fetch(`${base}/api/customers?secret=query`, { headers });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { message: "Not available for this role" });
      assert.deepEqual(warnings.at(-1), [
        { role: "system_documenter", method: "GET", path: "/api/customers" }, "role api allowlist refused",
      ]);
    }
    assert.equal((await fetch(`${base}/api/customers`)).status, 401);
  });
  it("wires exactly three enforcement calls, immediately after the authentication throttle", () => {
    assert.equal((source.match(/enforceRoleApiAllowlist\(req, res\)/g) ?? []).length, 3);
    assert.equal((source.match(/if \(!checkAuthenticatedThrottle\(req, res\)\) return;\n\s*if \(!enforceRoleApiAllowlist\(req, res\)\) return;/g) ?? []).length, 3);
  });
});

describe("all five real user-write handlers", () => {
  const body = { role: "system_documenter", phone: "5550001234", username: "fixture", name: "Fixture", password: "fixture-password" };
  const paths = [
    ["POST", "/api/users", "super_admin", 201],
    ["PUT", "/api/users/1", "company_admin", 200],
    ["PATCH", "/api/users/1", "company_admin", 200],
    ["POST", "/api/company/1/users", "company_admin", 201],
    ["PUT", "/api/company/1/users/1", "company_admin", 200],
  ] as const;
  it("rejects every supplied unknown value before rank checks, and accepts administrative documenter assignment", async () => {
    for (const [method, path, role, status] of paths) {
      for (const invalid of ["wizard", "", null, 2, {}, ["field_tech"]]) {
        assert.deepEqual(await hit(role, method, path, { ...body, role: invalid }), { status: 400, body: { message: "Unknown role" } }, path);
      }
      assert.equal((await hit(role, method, path, body)).status, status, path);
    }
  });
  it("preserves authorization precedence and rank ceilings", async () => {
    for (const role of ["irrigation_manager", "billing_manager", "field_tech", "bookkeeper"]) {
      for (const roleToAssign of ["wizard", "system_documenter"]) {
        assert.equal((await hit(role, "POST", "/api/company/1/users", { ...body, role: roleToAssign })).status, 403);
        assert.equal((await hit(role, "PUT", "/api/company/1/users/1", { ...body, role: roleToAssign })).status, 403);
        assert.equal((await hit(role, "POST", "/api/users", { ...body, role: roleToAssign })).status, 403);
      }
    }
    assert.equal((await hit("company_admin", "POST", "/api/company/1/users", { ...body, role: "company_admin" })).status, 403);
    for (const [method, path] of [["PUT", "/api/users/1"], ["PATCH", "/api/users/1"], ["PUT", "/api/company/1/users/1"]]) {
      assert.equal((await hit("company_admin", method, path, { role: "super_admin" })).status, 403);
      assert.equal((await hit("company_admin", method, path, { name: "Changed" })).status, 200);
    }
  });
  it("keeps company restrictions ahead of validation and never writes foreign users", async () => {
    for (const [method, path] of [
      ["POST", "/api/company/2/users"], ["PUT", "/api/company/2/users/99"],
      ["PUT", "/api/company/1/users/99"], ["PUT", "/api/users/99"], ["PATCH", "/api/users/99"],
    ]) assert.equal((await hit("company_admin", method, path, { role: "wizard" })).status, 403);
  });
});

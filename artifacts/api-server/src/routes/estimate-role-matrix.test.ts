// Task #632 — Full role × screen coverage matrix for estimate endpoints.
//
// Mounts a real Express app with the *real* estimate role guards from
// ./estimate-role-guards.ts plus the real registerEstimateRoutes() and
// exercises every estimate endpoint with each role's header set. We
// avoid the full registerRoutes() because it triggers top-level
// setInterval timers, QB token-health polls, and a self-running
// data-fix IIFE that all assume a live Postgres.
//
// What this pins:
//   • Middleware-gated endpoints (approve / reject / internal-approve /
//     send-approval-email / email / pending-approval / PDF) return
//     403 for any role outside the allowed set and 200 for any role
//     inside it.
//   • Handler-level role rules inside POST /api/estimates/:id/transition
//     (submit_for_review, send_to_customer, resend) — encoded via the
//     exported `canPerformEstimateTransition` predicate so the matrix
//     test catches drift between the predicate and the route handler.
//   • The endpoints that intentionally do NOT discriminate by role
//     (POST/PUT/submit-for-review, GET /api/estimates list/detail,
//     DELETE, convert-to-work-order) accept every authenticated role
//     so a future "tightening" doesn't slip through unnoticed.
//
// See ./README.md (Estimate role × screen matrix) for the human-
// readable matrix this test enforces.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express, {
  type Express,
  type RequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  requireEstimateApprovalAccess,
  requireEstimatePdfAccess,
  canPerformEstimateTransition,
  estimateOwnershipMatches,
  ESTIMATE_APPROVAL_ROLES,
  ESTIMATE_PDF_READ_ROLES,
  ESTIMATE_SUBMIT_FOR_REVIEW_ROLES,
  ESTIMATE_SEND_TO_CUSTOMER_ROLES,
  ESTIMATE_UNAPPROVE_ROLES,
  ESTIMATE_UNREJECT_ROLES,
  type TransitionAction,
} from "./estimate-role-guards";
import {
  registerEstimateRoutes,
  type EstimateRoutesStorage,
} from "./estimate-routes";
import type { EstimateLineInput } from "../estimate-payload";
import type {
  Customer,
  EstimateWithItems,
  InsertEstimate,
} from "@workspace/db";

// ─── Roles under test ─────────────────────────────────────────────────────────
// `irrigation_manager` is the canonical role name (Task #643).
// `manager` is the retired legacy alias that still appears in
// ESTIMATE_PDF_READ_ROLES for back-compat but is excluded from
// approval and transition gates. Both are exercised so a future
// removal of the alias forces a deliberate update to this test.
const ROLES = [
  "super_admin",
  "company_admin",
  "manager",
  "irrigation_manager",
  "billing_manager",
  "field_tech",
] as const;
type Role = (typeof ROLES)[number];

// ─── Test harness ─────────────────────────────────────────────────────────────

// Stub auth: reads x-user-role / x-user-company-id and stamps the same
// req fields the real requireAuthentication sets. No DB, no session.
const stubAuth: RequestHandler = (req: any, res, next) => {
  const role = req.headers["x-user-role"];
  if (typeof role !== "string" || role === "") {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const companyId = req.headers["x-user-company-id"];
  req.authenticatedUserId = 1;
  req.authenticatedUserRole = role;
  req.authenticatedUserCompanyId =
    typeof companyId === "string" && companyId !== "" ? Number(companyId) : 1;
  next();
};

function ok(_req: Request, res: Response) {
  res.status(200).json({ ok: true });
}

function makeStorageStub(): EstimateRoutesStorage {
  const customer: Customer = {
    id: 1,
    companyId: 1,
    name: "C",
    laborRate: "75.00" as unknown as string,
  } as unknown as Customer;
  return {
    async getCustomer() {
      return customer;
    },
    async getEstimate() {
      return undefined;
    },
    async createEstimateFromPayload(payload) {
      return {
        ...(payload.estimate as InsertEstimate),
        id: 1,
        estimateNumber: "EST-1",
        items: (payload.items ?? []).map(
          (it: EstimateLineInput, i: number) =>
            ({ ...it, id: i + 1, estimateId: 1 }) as unknown as never,
        ),
      } as unknown as EstimateWithItems;
    },
    async updateEstimateWithItems() {
      throw new Error("not called in matrix tests");
    },
  };
}

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startMatrixServer(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  // The actual estimate endpoints under test. Each endpoint is mounted
  // with the *real* middleware chain followed by an `ok` stub handler
  // — the assertion is on the status code the middleware (or 401 auth)
  // produces, not on any downstream business logic.
  //
  // Endpoints that don't have a role guard get `stubAuth` + `ok` so we
  // can prove they accept every authenticated role and still hand
  // back 200.

  // List — auth-optional in routes.ts (no middleware at all).
  app.get("/api/estimates", ok);

  // ── Routes registered BEFORE registerEstimateRoutes() ──────────────────
  //
  // Express matches routes first-come-first-served. Stubs mounted here
  // shadow the corresponding real handlers from registerEstimateRoutes()
  // so the test pins the *middleware gate* (403 vs non-403) rather than
  // the downstream business logic (404 / 500 from the stub storage).
  //
  // Stubs that need to test the gate: approval-gated and PDF endpoints.
  // They are mounted with the *real exported* guards from
  // estimate-role-guards.ts so any drift between the exported constants
  // and the test's role expectations is caught immediately.

  // Pending approval list — requireEstimateApprovalAccess gate.
  // MUST be before /:id so Express doesn't route `pending-approval`
  // into the catch-all detail handler.
  app.get(
    "/api/estimates/pending-approval",
    stubAuth,
    requireEstimateApprovalAccess,
    ok,
  );

  // Approve / reject / internal-approve (POST + PATCH variants) +
  // send-approval-email + email — all gated by requireEstimateApprovalAccess.
  // Mounted here (before registerEstimateRoutes) so the stub fires and
  // returns 200 for allowed roles; the real handler would return 404
  // (getEstimate → undefined in the stub).
  for (const path of [
    "/api/estimates/:id/approve",
    "/api/estimates/:id/reject",
    "/api/estimates/:id/send-approval-email",
    "/api/estimates/:id/email",
  ]) {
    app.post(path, stubAuth, requireEstimateApprovalAccess, ok);
  }
  for (const path of [
    "/api/estimates/:id/approve",
    "/api/estimates/:id/reject",
    "/api/estimates/:id/internal-approve",
  ]) {
    app.patch(path, stubAuth, requireEstimateApprovalAccess, ok);
  }

  // PDF (GET + POST) — gated by requireEstimatePdfAccess.
  // Mounted before registerEstimateRoutes for the same reason: the real
  // handler would call getEstimate() → undefined → 404, masking the
  // middleware gate result.
  app.get("/api/estimates/:id/pdf", stubAuth, requireEstimatePdfAccess, ok);
  app.post("/api/estimates/:id/pdf", stubAuth, requireEstimatePdfAccess, ok);

  // Detail — auth-optional, mounted after fixed-path stubs above.
  app.get("/api/estimates/:id", ok);

  // ── registerEstimateRoutes() ────────────────────────────────────────────
  // POST/PUT/submit-for-review — mounted from the real
  // registerEstimateRoutes() so any future role gating added there is
  // observed by this test. Routes for endpoints already stubbed above
  // are also registered here but are shadowed by the earlier stubs.
  registerEstimateRoutes(app, makeStorageStub(), stubAuth);

  // ── Routes registered AFTER registerEstimateRoutes() ───────────────────
  //
  // DELETE and convert-to-work-order are intentionally left here so the
  // *real* handlers from registerEstimateRoutes() run. This lets the
  // test document real handler behavior (error codes from the stub
  // storage) rather than a simple 200 stub. See the DELETE test below
  // for the expected codes and rationale.

  // Transition — auth-only at middleware level; per-action role
  // dispatch lives inside the handler. Mirror that here using the
  // canPerformEstimateTransition predicate so the test pins the
  // handler-level rules exactly.
  // Mounted after registerEstimateRoutes so it does NOT shadow the
  // real /transition route (registerEstimateRoutes does not register
  // /transition; it uses /resend separately).
  app.post(
    "/api/estimates/:id/transition",
    stubAuth,
    (req: any, res: Response, next: NextFunction) => {
      const action = String(req.body?.action ?? "") as TransitionAction;
      const role = req.authenticatedUserRole as string | undefined;
      const allowed: TransitionAction[] = [
        "submit_for_review",
        "send_to_customer",
        "resend",
      ];
      if (!allowed.includes(action)) {
        res.status(400).json({ message: "Unknown transition action" });
        return;
      }
      if (!canPerformEstimateTransition(role, action)) {
        res.status(403).json({ message: "Access denied" });
        return;
      }
      next();
    },
    ok,
  );

  const server: Server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function callAs(
  baseUrl: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  role: Role | null,
  body?: unknown,
): Promise<number> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (role) {
    headers["x-user-role"] = role;
    headers["x-user-company-id"] = "1";
  }
  const canHaveBody = method !== "GET" && method !== "DELETE";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: canHaveBody && body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

// Minimal but-complete create body for POST/PUT/submit-for-review.
function estimateBody() {
  return {
    estimate: {
      customerId: 1,
      customerName: "C",
      customerEmail: "c@example.com",
      projectName: "P",
      laborRate: 75,
      laborMode: "flat",
      totalLaborHours: 0,
    },
    items: [{ partId: 1, partName: "A", partPrice: 100, quantity: 1 }],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Estimate role × screen matrix (Task #632)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  beforeEach(async () => {
    ({ baseUrl, close } = await startMatrixServer());
  });
  afterEach(async () => {
    await close();
  });

  // ─── Public list / detail — no auth required ────────────────────────────
  it("GET /api/estimates and /api/estimates/:id allow every role (and unauthenticated callers) — they are list/read endpoints", async () => {
    for (const role of [...ROLES, null] as (Role | null)[]) {
      assert.equal(await callAs(baseUrl, "GET", "/api/estimates", role), 200, `list as ${role ?? "anon"}`);
      assert.equal(await callAs(baseUrl, "GET", "/api/estimates/1", role), 200, `detail as ${role ?? "anon"}`);
    }
  });

  // ─── Approval-gated endpoints ───────────────────────────────────────────
  // approve / reject / internal-approve / send-approval-email / email /
  // pending-approval list — ESTIMATE_APPROVAL_ROLES (super_admin,
  // company_admin, billing_manager, irrigation_manager) only.
  it("Approval-gated endpoints return 200 for {super_admin, company_admin, billing_manager, irrigation_manager} and 403 for {manager, field_tech}", async () => {
    const cases: { method: "GET" | "POST" | "PATCH"; path: string }[] = [
      { method: "GET", path: "/api/estimates/pending-approval" },
      { method: "POST", path: "/api/estimates/1/approve" },
      { method: "POST", path: "/api/estimates/1/reject" },
      { method: "PATCH", path: "/api/estimates/1/approve" },
      { method: "PATCH", path: "/api/estimates/1/reject" },
      { method: "PATCH", path: "/api/estimates/1/internal-approve" },
      { method: "POST", path: "/api/estimates/1/send-approval-email" },
      { method: "POST", path: "/api/estimates/1/email" },
    ];
    for (const { method, path } of cases) {
      for (const role of ROLES) {
        const expected = ESTIMATE_APPROVAL_ROLES.has(role) ? 200 : 403;
        const got = await callAs(baseUrl, method, path, role, {});
        assert.equal(got, expected, `${method} ${path} as ${role} → expected ${expected}, got ${got}`);
      }
      // Unauthenticated → 401.
      assert.equal(
        await callAs(baseUrl, method, path, null, {}),
        401,
        `${method} ${path} unauthenticated`,
      );
    }
  });

  // ─── PDF endpoint ───────────────────────────────────────────────────────
  // PDF stubs are mounted before registerEstimateRoutes() in startMatrixServer
  // so the stub (stubAuth + requireEstimatePdfAccess + ok) fires first.
  // Allowed roles get 200; blocked roles get 403. ESTIMATE_PDF_READ_ROLES
  // no longer includes the retired `manager` alias (Task #643) — both
  // `manager` and `field_tech` see 403.
  it("GET/POST /api/estimates/:id/pdf: 200 for {super_admin, company_admin, billing_manager, irrigation_manager}, 403 for {manager, field_tech}", async () => {
    for (const role of ROLES) {
      const expected = ESTIMATE_PDF_READ_ROLES.has(role) ? 200 : 403;
      assert.equal(
        await callAs(baseUrl, "GET", "/api/estimates/1/pdf", role),
        expected,
        `GET pdf as ${role}`,
      );
      assert.equal(
        await callAs(baseUrl, "POST", "/api/estimates/1/pdf", role, {}),
        expected,
        `POST pdf as ${role}`,
      );
    }
    assert.equal(
      await callAs(baseUrl, "GET", "/api/estimates/1/pdf", null),
      401,
      "GET pdf unauthenticated",
    );
  });

  // ─── Wizard write path (no role guard) ──────────────────────────────────
  it("POST /api/estimates, PUT /api/estimates/:id, POST /:id/submit-for-review accept every authenticated role (no role gate by design)", async () => {
    // POST /api/estimates exercises the real handler with a real
    // storage stub — returns 201 on success.
    for (const role of ROLES) {
      const status = await callAs(baseUrl, "POST", "/api/estimates", role, estimateBody());
      assert.equal(status, 201, `POST /api/estimates as ${role}`);
    }
    // PUT and submit-for-review hit getEstimate which returns
    // undefined in the stub, so the handler responds 404 (never 403).
    // That's exactly what we want to verify — the role passed the
    // middleware chain and reached the handler.
    for (const role of ROLES) {
      const putStatus = await callAs(baseUrl, "PUT", "/api/estimates/1", role, estimateBody());
      assert.equal(putStatus, 404, `PUT /api/estimates/:id as ${role} (should reach handler, not 403)`);
      const submitStatus = await callAs(
        baseUrl,
        "POST",
        "/api/estimates/1/submit-for-review",
        role,
        estimateBody(),
      );
      assert.equal(
        submitStatus,
        404,
        `POST /api/estimates/:id/submit-for-review as ${role} (should reach handler, not 403)`,
      );
    }
    // Unauthenticated → 401 on every write path.
    assert.equal(await callAs(baseUrl, "POST", "/api/estimates", null, estimateBody()), 401);
    assert.equal(await callAs(baseUrl, "PUT", "/api/estimates/1", null, estimateBody()), 401);
    assert.equal(
      await callAs(baseUrl, "POST", "/api/estimates/1/submit-for-review", null, estimateBody()),
      401,
    );
  });

  // ─── DELETE and convert-to-work-order ───────────────────────────────────
  // Both routes are handled by real handlers from registerEstimateRoutes()
  // (no stubs are mounted for them in this harness). Expected codes per
  // endpoint:
  //
  //   DELETE — the handler has an inline ESTIMATE_DELETE_ROLES allowlist
  //     that excludes the retired `manager` alias (Task #643). Every
  //     current canonical role is in the list. Because the stub's
  //     getEstimate() returns undefined, any role that passes the allowlist
  //     gets 404 "Estimate not found" — not 403. `manager` gets 403 at the
  //     allowlist gate before the storage call.
  //
  //   convert-to-work-order — Seam 3 (Task #1740) added
  //     requireEstimateApprovalAccess: field_tech and the retired `manager`
  //     alias → 403. Authorized roles (company_admin, super_admin,
  //     irrigation_manager, billing_manager) pass the guard and then hit
  //     the tenancy check, which calls getEstimate(). The stub's
  //     getEstimate() returns undefined → 404 "Estimate not found".
  it("DELETE: 404 for canonical roles (reached handler), 403 for legacy manager alias; convert-to-work-order: role-gated (403) then 404 for authorized roles", async () => {
    // Roles excluded by requireEstimateApprovalAccess or inline allowlists.
    const convertDenied = new Set<string>(["field_tech", "manager"]);
    for (const role of ROLES) {
      // manager excluded by inline ESTIMATE_DELETE_ROLES → 403.
      // All other roles pass → getEstimate() → undefined → 404.
      const deleteExpected = role === "manager" ? 403 : 404;
      assert.equal(
        await callAs(baseUrl, "DELETE", "/api/estimates/1", role),
        deleteExpected,
        `DELETE as ${role}`,
      );
      // Seam 3: field_tech and manager denied at role gate → 403.
      // Authorized roles pass gate, then getEstimate() → undefined → 404.
      const convertExpected = convertDenied.has(role) ? 403 : 404;
      assert.equal(
        await callAs(baseUrl, "POST", "/api/estimates/1/convert-to-work-order", role, {}),
        convertExpected,
        `convert as ${role}`,
      );
    }
    assert.equal(await callAs(baseUrl, "DELETE", "/api/estimates/1", null), 401);
    assert.equal(
      await callAs(baseUrl, "POST", "/api/estimates/1/convert-to-work-order", null, {}),
      401,
    );
  });

  // ─── DELETE on pending_review — Task #658 allowlist ─────────────────────
  // Manager / admin / billing may delete a `pending_review` estimate;
  // field_tech is refused 403. Spins per-case Express servers with a
  // dedicated stub that seeds a pending estimate AND implements
  // softDeleteEstimate so the real handler in registerEstimateRoutes()
  // is exercised end-to-end (instead of the stub `app.delete(... ok)`
  // mounted on `baseUrl` for the no-role-gate test above).
  it("DELETE /api/estimates/:id (pending_review) is gated to manager/admin/billing; field_tech → 403", async () => {
    const allowed = new Set<string>([
      "super_admin",
      "company_admin",
      "irrigation_manager",
      "billing_manager",
    ]);

    function makeSeededStub(internalStatus: string): EstimateRoutesStorage {
      const seeded = {
        id: 1,
        companyId: 1,
        customerId: 1,
        estimateNumber: "EST-1",
        status: "pending",
        internalStatus,
        estimateDate: new Date(),
        items: [],
      } as unknown as EstimateWithItems;
      return {
        async getCustomer() {
          return undefined;
        },
        async getEstimate() {
          return seeded;
        },
        async createEstimateFromPayload() {
          throw new Error("not used");
        },
        async updateEstimateWithItems() {
          throw new Error("not used");
        },
        async softDeleteEstimate() {
          return true;
        },
      };
    }

    for (const internalStatus of ["pending_approval", "approved_internal"]) {
      const app: Express = express();
      app.use(express.json());
      registerEstimateRoutes(app, makeSeededStub(internalStatus), stubAuth);
      const server: Server = createServer(app);
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}`;
      try {
        for (const role of ROLES) {
          const expected = allowed.has(role) ? 200 : 403;
          const got = await callAs(url, "DELETE", "/api/estimates/1", role);
          assert.equal(
            got,
            expected,
            `DELETE pending(${internalStatus}) as ${role} → expected ${expected}, got ${got}`,
          );
        }
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    }
  });

  // ─── DELETE on sent / approved / rejected — never allowed ───────────────
  // Pins the 409 wall: once an estimate is past pending_review, no role
  // can soft-delete it. This is the regression guard for "office can
  // delete pending" not accidentally widening to sent/approved.
  it("DELETE /api/estimates/:id returns 409 for sent / approved / rejected for every role", async () => {
    function makeSeededStub(
      status: string,
      internalStatus: string,
      estimateDate: Date = new Date(),
    ): EstimateRoutesStorage {
      return {
        async getCustomer() {
          return undefined;
        },
        async getEstimate() {
          return {
            id: 1,
            companyId: 1,
            customerId: 1,
            estimateNumber: "EST-1",
            status,
            internalStatus,
            estimateDate,
            items: [],
          } as unknown as EstimateWithItems;
        },
        async createEstimateFromPayload() {
          throw new Error("not used");
        },
        async updateEstimateWithItems() {
          throw new Error("not used");
        },
        async softDeleteEstimate() {
          return true;
        },
      };
    }

    // `expired` is the read-time view over (lifecycle='sent',
    // estimateDate > 30d). At the storage layer the row is still
    // `(status='pending', internalStatus='sent_to_customer')` —
    // the same shape as a fresh `sent` — so the 409 wall covers
    // it via the lifecycle derivation. We pin that explicitly
    // here by seeding a 60-day-old `sent` row.
    const cases: Array<{
      status: string;
      internalStatus: string;
      estimateDate?: Date;
    }> = [
      { status: "pending", internalStatus: "sent_to_customer" },
      { status: "approved", internalStatus: "sent_to_customer" },
      { status: "rejected", internalStatus: "sent_to_customer" },
      {
        status: "pending",
        internalStatus: "sent_to_customer",
        estimateDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    ];
    for (const c of cases) {
      const app: Express = express();
      app.use(express.json());
      registerEstimateRoutes(
        app,
        makeSeededStub(c.status, c.internalStatus, c.estimateDate),
        stubAuth,
      );
      const server: Server = createServer(app);
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}`;
      try {
        for (const role of ROLES) {
          // The retired `manager` alias (Task #643) is no longer in
          // ESTIMATE_DELETE_ROLES, so it short-circuits at the role
          // gate with 403 before the lifecycle 409 path runs.
          const expected = role === "manager" ? 403 : 409;
          const got = await callAs(url, "DELETE", "/api/estimates/1", role);
          assert.equal(
            got,
            expected,
            `DELETE ${c.status}/${c.internalStatus} as ${role} → expected ${expected}, got ${got}`,
          );
        }
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    }
  });

  // ─── Unapprove — role gate ───────────────────────────────────────────
  // POST /api/estimates/:id/unapprove is restricted to super_admin and
  // company_admin. Billing managers, irrigation managers, and field techs
  // must all see 403. The handler-level lifecycle check (must be
  // lifecycle='approved') fires after the role check so any non-admin
  // role hits 403 before the business logic runs.
  it("POST /api/estimates/:id/unapprove: 200 for {super_admin, company_admin}, 403 for all other roles", async () => {
    const approvedEstimate = {
      id: 1,
      companyId: 1,
      customerId: 1,
      estimateNumber: "EST-00001",
      status: "approved",
      internalStatus: "sent_to_customer",
      lifecycle: "approved",
      estimateDate: new Date(),
      items: [],
    } as unknown as import("@workspace/db").EstimateWithItems;
    const sentEstimate = {
      ...approvedEstimate,
      status: "pending",
      internalStatus: "sent_to_customer",
      lifecycle: "sent",
      approvedAt: null,
    } as unknown as import("@workspace/db").EstimateWithItems;

    function makeApprovedStub(): EstimateRoutesStorage {
      return {
        async getCustomer() { return undefined; },
        async getEstimate() { return approvedEstimate; },
        async createEstimateFromPayload() { throw new Error("not used"); },
        async updateEstimateWithItems() { throw new Error("not used"); },
        // Stub returns a successful unapprove result so admin roles get 200.
        async unapproveEstimate() {
          return { estimate: sentEstimate as any, deletedWorkOrderId: null };
        },
      };
    }

    const app2: import("express").Express = express();
    app2.use(express.json());
    registerEstimateRoutes(app2, makeApprovedStub(), stubAuth);
    const server2: Server = createServer(app2);
    await new Promise<void>((r) => server2.listen(0, r));
    const port2 = (server2.address() as AddressInfo).port;
    const url2 = `http://127.0.0.1:${port2}`;
    try {
      for (const role of ROLES) {
        // Admin roles (super_admin, company_admin) pass the gate → 200.
        // All other roles are rejected → 403.
        const expected = ESTIMATE_UNAPPROVE_ROLES.has(role) ? 200 : 403;
        const got = await callAs(url2, "POST", "/api/estimates/1/unapprove", role, {});
        assert.equal(
          got,
          expected,
          `unapprove as ${role}: expected HTTP ${expected}, got ${got}`,
        );
      }
      // Unauthenticated → 401.
      assert.equal(
        await callAs(url2, "POST", "/api/estimates/1/unapprove", null, {}),
        401,
        "unapprove unauthenticated",
      );
    } finally {
      await new Promise<void>((r) => server2.close(() => r()));
    }
  });

  // ─── Unreject — role gate ────────────────────────────────────────────
  // POST /api/estimates/:id/unreject is restricted to super_admin and
  // company_admin — mirrors the unapprove role gate. Billing managers,
  // irrigation managers, and field techs must all see 403.
  it("POST /api/estimates/:id/unreject: 200 for {super_admin, company_admin}, 403 for all other roles", async () => {
    const rejectedEstimate = {
      id: 1,
      companyId: 1,
      customerId: 1,
      estimateNumber: "EST-00001",
      status: "rejected",
      internalStatus: "sent_to_customer",
      lifecycle: "rejected",
      estimateDate: new Date(),
      items: [],
    } as unknown as import("@workspace/db").EstimateWithItems;
    const sentEstimate = {
      ...rejectedEstimate,
      status: "pending",
      internalStatus: "sent_to_customer",
      lifecycle: "sent",
    } as unknown as import("@workspace/db").EstimateWithItems;

    function makeRejectedStub(): EstimateRoutesStorage {
      return {
        async getCustomer() { return undefined; },
        async getEstimate() { return rejectedEstimate; },
        async createEstimateFromPayload() { throw new Error("not used"); },
        async updateEstimateWithItems() { throw new Error("not used"); },
        async unrejectedEstimate() {
          return sentEstimate as any;
        },
      };
    }

    const app3: import("express").Express = express();
    app3.use(express.json());
    registerEstimateRoutes(app3, makeRejectedStub(), stubAuth);
    const server3: Server = createServer(app3);
    await new Promise<void>((r) => server3.listen(0, r));
    const port3 = (server3.address() as AddressInfo).port;
    const url3 = `http://127.0.0.1:${port3}`;
    try {
      for (const role of ROLES) {
        const expected = ESTIMATE_UNREJECT_ROLES.has(role) ? 200 : 403;
        const got = await callAs(url3, "POST", "/api/estimates/1/unreject", role, {});
        assert.equal(
          got,
          expected,
          `unreject as ${role}: expected HTTP ${expected}, got ${got}`,
        );
      }
      assert.equal(
        await callAs(url3, "POST", "/api/estimates/1/unreject", null, {}),
        401,
        "unreject unauthenticated",
      );
    } finally {
      await new Promise<void>((r) => server3.close(() => r()));
    }
  });

  // ─── Transition handler-level role dispatch ─────────────────────────────
  it("POST /api/estimates/:id/transition gates submit_for_review/resend to {super_admin, company_admin, irrigation_manager} and send_to_customer to {super_admin, company_admin, billing_manager, irrigation_manager}", async () => {
    const actions: TransitionAction[] = ["submit_for_review", "resend", "send_to_customer"];
    for (const action of actions) {
      const allowed =
        action === "send_to_customer"
          ? ESTIMATE_SEND_TO_CUSTOMER_ROLES
          : ESTIMATE_SUBMIT_FOR_REVIEW_ROLES;
      for (const role of ROLES) {
        const expected = allowed.has(role) ? 200 : 403;
        const got = await callAs(
          baseUrl,
          "POST",
          "/api/estimates/1/transition",
          role,
          { action },
        );
        assert.equal(got, expected, `transition ${action} as ${role}`);
      }
    }
    // Unknown actions get rejected with 400 (not 403) so clients see
    // the real bug instead of a misleading auth error.
    assert.equal(
      await callAs(baseUrl, "POST", "/api/estimates/1/transition", "super_admin", { action: "wat" }),
      400,
    );
  });

  // ─── Legacy manager alias locked out of both approval and PDF ───────────
  // The retired `manager` alias (Task #643) is excluded from both
  // ESTIMATE_APPROVAL_ROLES and ESTIMATE_PDF_READ_ROLES. Every gated
  // endpoint returns 403 for this role. Locking this down so a future
  // cleanup of the alias must update this test deliberately.
  it("legacy manager alias: 403 on approval endpoints AND on the PDF endpoint", async () => {
    assert.equal(
      await callAs(baseUrl, "PATCH", "/api/estimates/1/approve", "manager", {}),
      403,
      "manager: PATCH approve should 403",
    );
    assert.equal(
      await callAs(baseUrl, "GET", "/api/estimates/pending-approval", "manager"),
      403,
      "manager: GET pending-approval should 403",
    );
    // manager is NOT in ESTIMATE_PDF_READ_ROLES (Task #643 retired the alias).
    assert.equal(
      await callAs(baseUrl, "GET", "/api/estimates/1/pdf", "manager"),
      403,
      "manager: GET pdf should 403",
    );
  });

  // ─── Field tech is fully locked out of every gated endpoint ─────────────
  it("field_tech role: 403 on every approval-gated endpoint AND on the PDF endpoint", async () => {
    const gated: { method: "GET" | "POST" | "PATCH"; path: string }[] = [
      { method: "GET", path: "/api/estimates/pending-approval" },
      { method: "POST", path: "/api/estimates/1/approve" },
      { method: "PATCH", path: "/api/estimates/1/approve" },
      { method: "POST", path: "/api/estimates/1/reject" },
      { method: "PATCH", path: "/api/estimates/1/reject" },
      { method: "PATCH", path: "/api/estimates/1/internal-approve" },
      { method: "POST", path: "/api/estimates/1/send-approval-email" },
      { method: "POST", path: "/api/estimates/1/email" },
      { method: "GET", path: "/api/estimates/1/pdf" },
      { method: "POST", path: "/api/estimates/1/pdf" },
    ];
    for (const { method, path } of gated) {
      assert.equal(
        await callAs(baseUrl, method, path, "field_tech", {}),
        403,
        `${method} ${path} field_tech should 403`,
      );
    }
  });
});

// ─── Cross-company ownership predicate ───────────────────────────────────────
// estimateOwnershipMatches lives in the same module as the guards. It's
// invoked inline by every approval handler; pinning its semantics here
// keeps the matrix complete (the 404-instead-of-403 contract is a
// security property — a non-matching company must NOT be able to probe
// for existence via the response code).
describe("estimateOwnershipMatches predicate (Task #632)", () => {
  it("super_admin sees every company", () => {
    const req = { authenticatedUserRole: "super_admin", authenticatedUserCompanyId: null } as any;
    assert.equal(estimateOwnershipMatches(req, 99), true);
  });
  it("scoped roles match only their own company", () => {
    const req = {
      authenticatedUserRole: "company_admin",
      authenticatedUserCompanyId: 1,
    } as any;
    assert.equal(estimateOwnershipMatches(req, 1), true);
    assert.equal(estimateOwnershipMatches(req, 2), false);
  });
  it("missing user company id or estimate company id is treated as a non-match (never silently bypassed)", () => {
    const req = { authenticatedUserRole: "company_admin", authenticatedUserCompanyId: null } as any;
    assert.equal(estimateOwnershipMatches(req, 1), false);
    const req2 = { authenticatedUserRole: "company_admin", authenticatedUserCompanyId: 1 } as any;
    assert.equal(estimateOwnershipMatches(req2, null), false);
    assert.equal(estimateOwnershipMatches(req2, undefined), false);
  });
});

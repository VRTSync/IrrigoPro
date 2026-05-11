// Task #502 — Spot-check that one of the previously-leaky wet-check
// handlers (POST /api/wet-checks/:id/zone-records) now sanitizes
// Drizzle's `Failed query: ...` strings instead of echoing them in
// the response. Mirrors the routes.ts handler shape just closely
// enough that the classify+log helper sees the same call site.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { classifyAndLog } from "./route-error-helpers";

interface ServerHarness {
  baseUrl: string;
  close: () => Promise<void>;
  setUpsert: (fn: (...args: any[]) => Promise<any>) => void;
  loggedErrors: any[];
}

async function startServer(): Promise<ServerHarness> {
  const app: Express = express();
  app.use(express.json());
  let upsert: (...args: any[]) => Promise<any> = async () => ({ id: 1 });
  const loggedErrors: any[] = [];

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 7;
    (req as any).authenticatedUserCompanyId = 1;
    (req as any).authenticatedUserRole = "field_tech";
    (req as any).log = {
      error: (obj: any) => loggedErrors.push(obj),
    };
    next();
  };

  // Mirrors the relevant slice of the real POST zone-records handler:
  // try storage.upsertWetCheckZoneRecord, on throw run it through
  // classifyAndLog with a fallbackStatus of 400 (matching routes.ts).
  app.post(
    "/api/wet-checks/:id/zone-records",
    noopAuth,
    async (req: any, res) => {
      const wetCheckId = parseInt(req.params.id);
      try {
        const created = await upsert(wetCheckId, 1, req.body);
        res.status(201).json(created);
      } catch (e: any) {
        const { status, message } = classifyAndLog(req, e, {
          op: "upsertWetCheckZoneRecord",
          ctx: {
            cid: 1,
            wetCheckId,
            controllerLetter: req.body?.controllerLetter,
            zoneNumber: req.body?.zoneNumber,
          },
          fallbackStatus: 400,
          fallbackMessage: "Couldn't save zone — please retry",
        });
        res.status(status).json({ message });
      }
    },
  );

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setUpsert: (fn) => {
      upsert = fn;
    },
    loggedErrors,
  };
}

const validBody = () => ({ controllerLetter: "A", zoneNumber: 3, status: "checked_ok" });

describe("POST /api/wet-checks/:id/zone-records — SQL-leak guard (Task #502)", () => {
  it("never leaks a Drizzle 'Failed query' SQL string to the client", async () => {
    const h = await startServer();
    try {
      const drizzleStyleError = Object.assign(
        new Error(
          'Failed query: insert into "wet_check_zone_records" ("wet_check_id", "controller_letter", "zone_number", "status") values ($1, $2, $3, $4) returning *\nparams: 100,A,3,checked_ok',
        ),
        {
          name: "DrizzleQueryError",
          cause: Object.assign(new Error("connection terminated"), { code: "57P01" }),
        },
      );
      h.setUpsert(async () => {
        throw drizzleStyleError;
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/100/zone-records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as any;
      assert.equal(json.message, "Couldn't save zone — please retry");
      // The raw SQL must NOT appear anywhere in the response body.
      const raw = JSON.stringify(json);
      assert.equal(raw.includes("Failed query"), false);
      assert.equal(raw.includes("insert into"), false);
      assert.equal(raw.includes("wet_check_zone_records"), false);
      // But the full underlying error MUST have been logged server-side
      // with enough context to debug.
      assert.equal(h.loggedErrors.length, 1);
      const logged = h.loggedErrors[0]!;
      assert.equal(logged.op, "upsertWetCheckZoneRecord");
      assert.equal(logged.wetCheckId, 100);
      assert.equal(logged.controllerLetter, "A");
      assert.equal(logged.zoneNumber, 3);
      assert.equal(logged.userId, 7);
      assert.equal(logged.companyId, 1);
      assert.equal(logged.err.code, "57P01");
      assert.match(String(logged.err.message), /Failed query/);
    } finally {
      await h.close();
    }
  });

  it("relays a recognized error message (e.g. submit's 'zero zones checked') with the right status", async () => {
    // Re-uses the handler with a recognized rule to prove curated
    // messages still reach the client unchanged.
    const app: Express = express();
    app.use(express.json());
    const loggedErrors: any[] = [];
    const noopAuth: RequestHandler = (req, _res, next) => {
      (req as any).authenticatedUserId = 7;
      (req as any).authenticatedUserCompanyId = 1;
      (req as any).log = { error: (obj: any) => loggedErrors.push(obj) };
      next();
    };
    app.post("/api/wet-checks/:id/submit", noopAuth, async (req: any, res) => {
      try {
        throw new Error("Cannot submit: zero zones checked");
      } catch (e: any) {
        const { status, message } = classifyAndLog(req, e, {
          op: "submitWetCheck",
          fallbackMessage: "Couldn't submit wet check — please retry",
          recognized: [
            {
              test: (_e, raw) => /zero zones checked/.test(raw),
              status: 400,
              message: (_e, raw) => raw,
            },
          ],
        });
        res.status(status).json({ message });
      }
    });
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/wet-checks/100/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      assert.equal(res.status, 400);
      const json = (await res.json()) as any;
      assert.equal(json.message, "Cannot submit: zero zones checked");
      // Recognized errors are NOT logged (curated path).
      assert.equal(loggedErrors.length, 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("bulk-delete loop (e.g. /api/billing-sheets/bulk) sanitizes per-row Drizzle errors", async () => {
    // Mirrors the per-row catch in DELETE /api/billing-sheets/bulk:
    // a Drizzle-style throw must NOT echo the raw SQL into the
    // per-row outcome message; the recognized "invoiced" branch is
    // unaffected and reaches the client unchanged.
    const app: Express = express();
    app.use(express.json());
    const loggedErrors: any[] = [];
    const noopAuth: RequestHandler = (req, _res, next) => {
      (req as any).authenticatedUserId = 7;
      (req as any).authenticatedUserCompanyId = 1;
      (req as any).log = { error: (obj: any) => loggedErrors.push(obj) };
      next();
    };
    let del: (id: number) => Promise<boolean> = async () => true;
    app.delete("/api/billing-sheets/bulk", noopAuth, async (req: any, res) => {
      const ids: number[] = req.body?.ids ?? [];
      const results: Array<{ id: number; status: string; message?: string }> = [];
      for (const id of ids) {
        try {
          const ok = await del(id);
          results.push({ id, status: ok ? "deleted" : "not_found" });
        } catch (e: any) {
          const cls = classifyAndLog(req, e, {
            op: "bulkDeleteBillingSheet",
            ctx: { id },
            fallbackMessage: "Couldn't delete — please retry",
          });
          results.push({ id, status: "error", message: cls.message });
        }
      }
      res.json({ results });
    });
    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      del = async () => {
        throw Object.assign(
          new Error(
            'Failed query: delete from "billing_sheets" where "billing_sheets"."id" = $1\nparams: 42',
          ),
          {
            name: "DrizzleQueryError",
            cause: Object.assign(new Error("connection terminated"), { code: "57P01" }),
          },
        );
      };
      const res = await fetch(`http://127.0.0.1:${port}/api/billing-sheets/bulk`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [42] }),
      });
      assert.equal(res.status, 200);
      const json = (await res.json()) as any;
      assert.equal(json.results.length, 1);
      assert.equal(json.results[0].status, "error");
      assert.equal(json.results[0].message, "Couldn't delete — please retry");
      const body = JSON.stringify(json);
      assert.equal(body.includes("Failed query"), false);
      assert.equal(body.includes("delete from"), false);
      assert.equal(body.includes("billing_sheets"), false);
      assert.equal(loggedErrors.length, 1);
      assert.equal(loggedErrors[0].op, "bulkDeleteBillingSheet");
      assert.equal(loggedErrors[0].id, 42);
      assert.equal(loggedErrors[0].err.code, "57P01");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("returns the configured fallback status (defaults to 500 when omitted)", async () => {
    const h = await startServer();
    try {
      // Override the route to omit fallbackStatus → defaults to 500.
      // We just exercise classifyAndLog directly here.
      const fakeReq: any = {
        authenticatedUserId: 7,
        authenticatedUserCompanyId: 1,
        log: { error: () => {} },
      };
      const out = classifyAndLog(fakeReq, new Error("Failed query: select 1"), {
        op: "anything",
      });
      assert.equal(out.status, 500);
      assert.equal(out.message, "Something went wrong — please retry");
    } finally {
      await h.close();
    }
  });
});

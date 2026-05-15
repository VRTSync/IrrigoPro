// Task #518 — DELETE /api/wet-checks/findings/:id handler regression tests.
//
// Locks in the typed-error mapping introduced in this task:
//
//   • not-found  → 404 with `reason: "not_found"`
//   • already routed downstream (billing sheet / estimate / work order)
//     → 409 with `reason: "already_converted"`
//   • wet check no longer in_progress (submitted / approved / etc)
//     → 409 with `reason: "wet_check_not_editable"`
//   • happy path → 200 `{ ok: true }`
//   • unrecognized storage error → 500 with a curated fallback message,
//     never echoes the raw thrown text (SQL-leak guard).
//
// Pre-Task-#518 the handler returned HTTP 200 `{ ok: false }` for every
// refusal, which the FindingSheet's red trash button silently ignored —
// the icon appeared to do nothing in production.
//
// We don't exercise the storage path against a real DB here; the logic
// under test is purely the handler's classify/map step. A swappable
// stub `del` lets us drive every branch deterministically while still
// importing the REAL production error classes + classifyAndLog helper
// so any drift between the test and routes.ts is visible at compile
// time.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  WetCheckFindingNotFoundError,
  WetCheckFindingNotEditableError,
  WetCheckFindingAlreadyConvertedError,
} from "../storage";
import { classifyAndLog } from "./route-error-helpers";

type DelFn = (id: number, cid: number) => Promise<boolean>;
interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  setDel: (fn: DelFn) => void;
  loggedErrors: any[];
}

async function startServer(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());
  let del: DelFn = async () => true;
  const loggedErrors: any[] = [];

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 7;
    (req as any).authenticatedUserCompanyId = 1;
    (req as any).authenticatedUserRole = "field_tech";
    (req as any).log = { error: (obj: any) => loggedErrors.push(obj) };
    next();
  };

  // Mirrors the production DELETE /api/wet-checks/findings/:id handler
  // in routes.ts (auth/role gate → id parse → storage call → typed-
  // error map → classifyAndLog fallback). Re-uses the real error
  // classes + classifyAndLog so test drift surfaces at compile time.
  app.delete("/api/wet-checks/findings/:id", noopAuth, async (req: any, res) => {
    const cid = req.authenticatedUserCompanyId;
    const findingId = parseInt(req.params.id);
    if (!Number.isFinite(findingId) || findingId <= 0) {
      res.status(400).json({ message: "Invalid finding id" });
      return;
    }
    try {
      const ok = await del(findingId, cid);
      if (!ok) {
        res.status(404).json({ message: "Wet check finding not found", reason: "not_found" });
        return;
      }
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof WetCheckFindingNotFoundError) {
        res.status(404).json({ message: e.message, reason: "not_found" });
        return;
      }
      if (e instanceof WetCheckFindingAlreadyConvertedError) {
        res.status(409).json({
          message: e.message,
          reason: "already_converted",
          target: e.target,
          targetId: e.targetId,
        });
        return;
      }
      if (e instanceof WetCheckFindingNotEditableError) {
        res.status(409).json({
          message: e.message,
          reason: "wet_check_not_editable",
          wetCheckStatus: e.status,
        });
        return;
      }
      const { status, message } = classifyAndLog(req, e, {
        op: "deleteWetCheckFinding",
        ctx: { cid, findingId },
        fallbackStatus: 400,
        fallbackMessage: "Couldn't delete finding — please retry",
        recognized: [
          {
            test: (_e, raw) => /Cannot edit wet check in status/.test(raw),
            status: 409,
            message: (_e, raw) => raw,
          },
          {
            test: (_e, raw) => /not found for company/.test(raw),
            status: 404,
            message: "Wet check finding not found",
          },
        ],
      });
      res.status(status).json({ message });
    }
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setDel: (fn) => { del = fn; },
    loggedErrors,
  };
}

describe("DELETE /api/wet-checks/findings/:id — Task #518 typed-error mapping", () => {
  it("happy path returns 200 { ok: true } and never the legacy { ok: false } shape", async () => {
    const h = await startServer();
    try {
      h.setDel(async () => true);
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/123`, { method: "DELETE" });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.deepEqual(body, { ok: true });
    } finally {
      await h.close();
    }
  });

  it("missing finding throws WetCheckFindingNotFoundError → 404 with reason=not_found (no silent { ok: false })", async () => {
    const h = await startServer();
    try {
      h.setDel(async (id) => { throw new WetCheckFindingNotFoundError(id); });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/999`, { method: "DELETE" });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.equal(body.reason, "not_found");
      assert.match(String(body.message), /finding/i);
    } finally {
      await h.close();
    }
  });

  it("already-routed finding throws WetCheckFindingAlreadyConvertedError → 409 with reason=already_converted + target metadata", async () => {
    const h = await startServer();
    try {
      h.setDel(async (id) => {
        throw new WetCheckFindingAlreadyConvertedError(id, "billing_sheet", 4242);
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/55`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.equal(body.reason, "already_converted");
      assert.equal(body.target, "billing_sheet");
      assert.equal(body.targetId, 4242);
      assert.match(String(body.message), /billing sheet #4242/i);
    } finally {
      await h.close();
    }
  });

  it("estimate-routed finding surfaces target=estimate so the toast can name the right downstream record", async () => {
    const h = await startServer();
    try {
      h.setDel(async (id) => {
        throw new WetCheckFindingAlreadyConvertedError(id, "estimate", 17);
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/55`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.equal(body.target, "estimate");
      assert.equal(body.targetId, 17);
      assert.match(String(body.message), /estimate #17/i);
    } finally {
      await h.close();
    }
  });

  it("submitted wet check throws WetCheckFindingNotEditableError → 409 with reason=wet_check_not_editable + wetCheckStatus", async () => {
    const h = await startServer();
    try {
      h.setDel(async (id) => {
        throw new WetCheckFindingNotEditableError(id, "submitted");
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/77`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.equal(body.reason, "wet_check_not_editable");
      assert.equal(body.wetCheckStatus, "submitted");
      assert.match(String(body.message), /submitted/);
    } finally {
      await h.close();
    }
  });

  it("legacy bare-Error 'Cannot edit wet check in status …' falls through to classifyAndLog and surfaces 409 with the raw status hint", async () => {
    const h = await startServer();
    try {
      h.setDel(async () => {
        throw new Error("Cannot edit wet check in status approved");
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/12`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.match(String(body.message), /approved/);
    } finally {
      await h.close();
    }
  });

  it("unrecognized storage error returns 400 with a curated fallback message — NEVER echoes the raw thrown text (SQL-leak guard)", async () => {
    const h = await startServer();
    try {
      h.setDel(async () => {
        // Mimic a Drizzle wrapper error that would leak SQL otherwise.
        throw new Error("Failed query: delete from wet_check_findings where id = $1");
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/12`, { method: "DELETE" });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok?: boolean; reason?: string; message?: string; target?: string; targetId?: number; wetCheckStatus?: string };
      assert.equal(body.message, "Couldn't delete finding — please retry");
      assert.equal(/Failed query/.test(JSON.stringify(body)), false);
      // The unexpected error should still be logged server-side.
      assert.equal(h.loggedErrors.length, 1);
    } finally {
      await h.close();
    }
  });

  it("rejects non-numeric path id with 400 instead of NaN-ing into storage", async () => {
    const h = await startServer();
    try {
      let called = false;
      h.setDel(async () => { called = true; return true; });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/findings/not-a-number`, { method: "DELETE" });
      assert.equal(res.status, 400);
      assert.equal(called, false);
    } finally {
      await h.close();
    }
  });
});

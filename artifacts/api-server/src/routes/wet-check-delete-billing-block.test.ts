// Task #750 — WC Billing Slice 1: Delete safety patch.
//
// deleteWetCheck previously only blocked deletion when a wet check's findings
// were linked to an *invoiced* billing sheet. A finding attached to a billing
// sheet that had no invoice could slip through. This test locks in the fix:
//
//   (a) storage throws WetCheckHasBillingSheetError when any finding has
//       billingSheetId IS NOT NULL and the BS is not yet on an invoice.
//   (b) DELETE /api/wet-checks/:id returns HTTP 409 with the BS billingNumber
//       in the message and a `billingNumbers` array in the body.
//   (c) The existing WetCheckHasInvoicedRecordsError path is unaffected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Express, type RequestHandler } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  WetCheckHasInvoicedRecordsError,
  WetCheckHasBillingSheetError,
  type WetCheckInvoiceBlocker,
} from "../storage";
import { classifyAndLog } from "./route-error-helpers";

// ─── (a) Error class unit tests ──────────────────────────────────────────────

describe("WetCheckHasBillingSheetError — unit", () => {
  it("carries code WET_CHECK_HAS_BILLING_SHEET", () => {
    const err = new WetCheckHasBillingSheetError(42, [{ id: 10, billingNumber: "BS-0010" }]);
    assert.equal(err.code, "WET_CHECK_HAS_BILLING_SHEET");
  });

  it("message names the billing sheet by billingNumber", () => {
    const err = new WetCheckHasBillingSheetError(7, [{ id: 3, billingNumber: "BS-0003" }]);
    assert.match(err.message, /BS-0003/);
    assert.match(err.message, /wet check #7/i);
  });

  it("falls back to #id when billingNumber is null", () => {
    const err = new WetCheckHasBillingSheetError(7, [{ id: 3, billingNumber: null }]);
    assert.match(err.message, /#3/);
  });

  it("billingNumbers array mirrors the blocker list", () => {
    const err = new WetCheckHasBillingSheetError(1, [
      { id: 10, billingNumber: "BS-0010" },
      { id: 11, billingNumber: null },
    ]);
    assert.deepEqual(err.billingNumbers, ["BS-0010", null]);
  });

  it("name is WetCheckHasBillingSheetError", () => {
    const err = new WetCheckHasBillingSheetError(1, [{ id: 5, billingNumber: "X" }]);
    assert.equal(err.name, "WetCheckHasBillingSheetError");
  });

  it("is distinct from WetCheckHasInvoicedRecordsError", () => {
    const bsErr = new WetCheckHasBillingSheetError(1, [{ id: 1, billingNumber: "BS-001" }]);
    assert.ok(!(bsErr instanceof WetCheckHasInvoicedRecordsError));
  });
});

// ─── (b) Route handler tests ──────────────────────────────────────────────────

type DeleteFn = (id: number, cid: number) => Promise<boolean>;

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
  setDelete: (fn: DeleteFn) => void;
  loggedErrors: any[];
}

async function startServer(): Promise<Harness> {
  const app: Express = express();
  app.use(express.json());

  let deleteFn: DeleteFn = async () => true;
  const loggedErrors: any[] = [];

  const noopAuth: RequestHandler = (req, _res, next) => {
    (req as any).authenticatedUserId = 7;
    (req as any).authenticatedUserCompanyId = 1;
    (req as any).authenticatedUserRole = "company_admin";
    (req as any).log = { error: (obj: any) => loggedErrors.push(obj) };
    next();
  };

  // Mirrors the production DELETE /api/wet-checks/:id handler in routes.ts.
  // Imports the real error classes so any drift surfaces at compile time.
  app.delete("/api/wet-checks/:id", noopAuth, async (req: any, res) => {
    const cid = req.authenticatedUserCompanyId as number;
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
    try {
      const ok = await deleteFn(id, cid);
      if (!ok) { res.status(404).json({ message: "Not found" }); return; }
      res.json({ ok });
    } catch (e: any) {
      if (e instanceof WetCheckHasInvoicedRecordsError) {
        res.status(409).json({ message: e.message, blockers: e.blockers });
        return;
      }
      if (e instanceof WetCheckHasBillingSheetError) {
        res.status(409).json({
          message: e.message,
          code: e.code,
          billingNumbers: e.billingNumbers,
        });
        return;
      }
      const { status, message } = classifyAndLog(req, e, {
        op: "deleteWetCheck",
        ctx: { cid, id },
        fallbackMessage: "Couldn't delete wet check — please retry",
        recognized: [
          { test: (_e, raw) => /not found for company/.test(raw), status: 404, message: "Not found" },
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
    setDelete: (fn) => { deleteFn = fn; },
    loggedErrors,
  };
}

describe("DELETE /api/wet-checks/:id — Task #750 billing-sheet block (409)", () => {
  it("returns 409 with billingNumber in message when finding is on a non-invoiced BS", async () => {
    const h = await startServer();
    try {
      h.setDelete(async (id) => {
        throw new WetCheckHasBillingSheetError(id, [{ id: 55, billingNumber: "BS-0055" }]);
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/42`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = await res.json() as any;
      assert.match(String(body.message), /BS-0055/);
      assert.equal(body.code, "WET_CHECK_HAS_BILLING_SHEET");
      assert.deepEqual(body.billingNumbers, ["BS-0055"]);
    } finally {
      await h.close();
    }
  });

  it("returns 409 and lists all blocked billing sheets when multiple findings are routed", async () => {
    const h = await startServer();
    try {
      h.setDelete(async (id) => {
        throw new WetCheckHasBillingSheetError(id, [
          { id: 10, billingNumber: "BS-0010" },
          { id: 11, billingNumber: "BS-0011" },
        ]);
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/7`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = await res.json() as any;
      assert.match(String(body.message), /BS-0010/);
      assert.match(String(body.message), /BS-0011/);
      assert.deepEqual(body.billingNumbers, ["BS-0010", "BS-0011"]);
    } finally {
      await h.close();
    }
  });

  it("existing invoiced-records path still returns 409 with blockers (unaffected)", async () => {
    const h = await startServer();
    try {
      const blocker: WetCheckInvoiceBlocker = {
        kind: "billing_sheet",
        id: 99,
        displayNumber: "BS-0099",
        invoiceId: 5,
        invoiceNumber: "INV-0005",
      };
      h.setDelete(async (id) => {
        throw new WetCheckHasInvoicedRecordsError(id, [blocker]);
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/3`, { method: "DELETE" });
      assert.equal(res.status, 409);
      const body = await res.json() as any;
      assert.ok(Array.isArray(body.blockers), "expected blockers array on invoiced-records error");
      assert.equal(body.blockers[0].invoiceNumber, "INV-0005");
      assert.equal(body.code, undefined, "invoiced-records error must not expose the BS-error code");
    } finally {
      await h.close();
    }
  });

  it("happy path returns 200 { ok: true }", async () => {
    const h = await startServer();
    try {
      h.setDelete(async () => true);
      const res = await fetch(`${h.baseUrl}/api/wet-checks/1`, { method: "DELETE" });
      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.deepEqual(body, { ok: true });
    } finally {
      await h.close();
    }
  });

  it("unrecognized storage error returns 500 fallback — never echoes raw SQL (leak guard)", async () => {
    const h = await startServer();
    try {
      h.setDelete(async () => {
        throw new Error('Failed query: delete from wet_checks where id = $1');
      });
      const res = await fetch(`${h.baseUrl}/api/wet-checks/5`, { method: "DELETE" });
      assert.equal(res.status, 500);
      const body = await res.json() as any;
      assert.equal(body.message, "Couldn't delete wet check — please retry");
      assert.equal(/Failed query/.test(JSON.stringify(body)), false);
      assert.equal(h.loggedErrors.length, 1);
    } finally {
      await h.close();
    }
  });
});

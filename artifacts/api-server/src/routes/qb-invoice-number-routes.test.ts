// Execute the actual route handlers extracted by the TypeScript parser, not a
// reimplementation of their control flow. External services are injected.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { checkQbCustomTxnNumbersCached, QB_SESSION_EXPIRED, QB_CUSTOM_TXN_DISABLED } from "./qb-invoice-preflight";
import { qbDocNumberMismatch } from "./qb-invoice-ops";
import { money } from "../lib/money";

const source = ts.createSourceFile("routes.ts", readFileSync(new URL("./routes.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function handler(path: string, context: Record<string, unknown>) {
  let text = "";
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "app.post" &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path) {
      text = node.arguments[node.arguments.length - 1].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(text, `missing ${path} handler`);
  return runInNewContext(ts.transpileModule(`(${text})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  // Background PDF/alert work is outside these guard tests; imports in this
  // isolated VM are intentionally unavailable and caught by the real handler.
  }).outputText, { ...context, console: { log() {}, warn() {}, error() {} }, z }) as (req: unknown, res: unknown) => Promise<void>;
}

function syncHandler(context: Record<string, unknown>) {
  let text = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createQuickBooksInvoiceForInvoice") text = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(text);
  return runInNewContext(ts.transpileModule(`(${text})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, { ...context, console: { warn() {} } }) as (id: number, opts: unknown) => Promise<unknown>;
}

const monthly = "/api/invoices/monthly";
const standalone = "/api/invoices/bill-separately";
const req = {
  authenticatedUserRole: "billing_manager", authenticatedUserCompanyId: 12,
  body: { customerId: 42, ticketType: "billing_sheet", ticketId: 7, billingSheetIds: [7] },
};
const sheet = {
  id: 7, customerId: 42, status: "approved_passed_to_billing", invoiceId: null,
  billingNumber: "BS-test", workDate: new Date(), laborSubtotal: "10.00", partsSubtotal: "0.00",
  totalAmount: "10.00", totalHours: "1", laborRate: "10",
};
function fixture(integration: unknown = { realmId: "test-realm", accessToken: "fixture", connectionStatus: "connected" }) {
  let next = 1001;
  let stamps = 0;
  let deleted = 0;
  let posts = 0;
  let mismatch: unknown;
  const storage = {
    getQuickBooksIntegrationByCompanyId: async () => integration,
    getQuickBooksIntegration: async () => integration,
    getBillingSheetById: async () => sheet,
    getCustomerById: async () => ({ id: 42, companyId: 12, name: "Fixture", email: "fixture@example.invalid", quickbooksId: "42" }),
    getWorkOrders: async () => [],
    getAllBillingSheets: async () => [sheet],
    getWetCheckBillingsByCustomer: async () => [],
    createInvoiceWithNextNumber: async (input: unknown) => ({ ...(input as object), id: next, invoiceNumber: `IR-${next++}` }),
    createInvoiceItem: async () => ({}),
    getInvoiceItems: async () => [],
    updateInvoice: async (_id: number, input: { qbDocNumberMismatch?: string | null }) => { mismatch = input.qbDocNumberMismatch; return undefined; },
    deleteInvoiceItemsByInvoiceId: async () => {},
    deleteInvoice: async () => { deleted++; },
    updateBillingSheet: async () => { stamps++; },
  };
  return {
    storage, counts: () => ({ next, stamps, deleted, posts, mismatch }),
    context: {
      storage, qbDocNumberMismatch, QB_SESSION_EXPIRED, money,
      buildAndPostQbInvoice: async () => { posts++; return { quickbooksId: "500", qbDocNumber: "1034" }; },
      recordLifecycleAudit: async () => {},
      logger: { warn() {}, error() {} },
      InvoicePdfService: class { async generateAndSaveInvoicePdf() { return { success: true }; } },
      buildBsLineDescription: () => "Fixture",
      wcbIsEligible: () => false,
    },
  };
}
async function invoke(path: string, context: Record<string, unknown>) {
  let status = 200;
  let body: any;
  await handler(path, context)(req, {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  });
  return { status, body };
}

describe("actual billing route number guards", () => {
  for (const path of [monthly, standalone]) {
    it(`${path}: disabled/auth/throwing settings allocate nothing`, async () => {
      for (const result of [false, "auth_error", new Error("settings unavailable")] as const) {
        const f = fixture();
        const checkQbCustomTxnNumbers = async () => {
          if (result instanceof Error) throw result;
          return result === false
            ? { ok: false, status: 409, message: QB_CUSTOM_TXN_DISABLED }
            : { ok: false, status: 401, message: QB_SESSION_EXPIRED };
        };
        const response = await invoke(path, { ...f.context, checkQbCustomTxnNumbers });
        assert.equal(response.status, result instanceof Error ? 502 : result === false ? 409 : 401);
        assert.equal(response.body.message, result instanceof Error
          ? "Could not read QuickBooks settings: settings unavailable. Try again."
          : result === false ? QB_CUSTOM_TXN_DISABLED : QB_SESSION_EXPIRED);
        assert.equal(response.body.quickbooksError, response.body.message);
        assert.deepEqual(f.counts(), { next: 1001, stamps: 0, deleted: 0, posts: 0, mismatch: undefined });
      }
    });
    it(`${path}: collision rolls back without billing; retry consumes the next number`, async () => {
      const f = fixture();
      let collision = true;
      const context = {
        ...f.context, checkQbCustomTxnNumbers: async () => ({ ok: true }),
        findQbInvoiceIdsByDocNumber: async () => collision ? ["900"] : [],
      };
      const refused = await invoke(path, context);
      assert.equal(refused.status, 409);
      assert.equal(refused.body.quickbooksError, "QuickBooks already has an invoice numbered IR-1001. IrrigoPro did not create a duplicate, and IR-1001 will not be reused. Find that invoice in QuickBooks, then try again.");
      assert.deepEqual(f.counts(), { next: 1002, stamps: 0, deleted: 1, posts: 0, mismatch: undefined });
      collision = false;
      const success = await invoke(path, context);
      assert.equal(success.status, 200, JSON.stringify(success.body));
      assert.equal(success.body.invoiceNumber, "IR-1002");
      assert.deepEqual(f.counts(), { next: 1003, stamps: 1, deleted: 1, posts: 1, mismatch: "1034" });
    });
  }
  it("Bill Separately without usable integration still creates a local numbered invoice", async () => {
    for (const integration of [null, { realmId: "r", accessToken: "fixture", connectionStatus: "reconnect_required" }]) {
      const f = fixture(integration);
      const response = await invoke(standalone, {
        ...f.context, checkQbCustomTxnNumbers: async () => { assert.fail("must not preflight unusable integration"); },
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.invoiceNumber, "IR-1001");
      assert.equal(response.body.quickbooksSuccess, false);
      assert.equal(f.counts().posts, 0);
      assert.equal(f.counts().stamps, 1);
    }
  });
  it("a cold cache blocks settings OFF before allocation; enabling permits immediate retry", async () => {
    const f = fixture();
    const cache = new Map<string, number>();
    let enabled = false;
    const context = {
      ...f.context,
      checkQbCustomTxnNumbers: (integration: { realmId: string; accessToken: string }) =>
        checkQbCustomTxnNumbersCached(async () => new Response(JSON.stringify({
          Preferences: { SalesFormsPrefs: { CustomTxnNumbers: enabled } },
        })), "https://sandbox.invalid", integration, cache),
      findQbInvoiceIdsByDocNumber: async () => [],
    };
    assert.equal((await invoke(standalone, context)).status, 409);
    assert.equal(f.counts().next, 1001);
    enabled = true;
    assert.equal((await invoke(standalone, context)).status, 200);
    assert.equal(f.counts().next, 1002);
  });
});

describe("actual sync entry point preference and number persistence", () => {
  class TestSyncError extends Error {
    constructor(message: string, public httpStatus: number) { super(message); }
  }
  function fixture() {
    const writes: Record<string, unknown>[] = [];
    let syncs = 0;
    const date = new Date("2026-05-01");
    const query = { from() { return this; }, where() { return this; }, orderBy() { return this; }, async limit() { return [{ createdAt: date }]; } };
    const context = {
      InvoiceSyncError: TestSyncError, qbDocNumberMismatch,
      db: { select: () => query }, invoices: {}, eq() {}, and() {}, asc() {},
      storage: {
        getInvoiceById: async () => ({ id: 7, companyId: 12, customerId: 42, invoiceNumber: "IR-1001", quickbooksInvoiceId: "500", createdAt: date }),
        getCustomerById: async () => ({ companyId: 12, quickbooksId: "42" }),
        getQuickBooksIntegrationByCompanyId: async () => ({ realmId: "r" }),
        getQuickBooksIntegration: async () => ({ realmId: "r", accessToken: "fixture" }),
        getInvoiceItems: async () => [{ totalPrice: "10.00", description: "Fixture" }],
        updateInvoice: async (_id: number, fields: Record<string, unknown>) => { writes.push(fields); },
      },
      syncAppInvoiceToQb: async () => { syncs++; return { outcome: "updated", quickbooksId: "500", quickbooksSyncToken: "4" }; },
    };
    return { context, writes, syncs: () => syncs };
  }
  it("clears an earlier mismatch on verified update without changing number", async () => {
    const f = fixture();
    await syncHandler({ ...f.context, checkQbCustomTxnNumbers: async () => ({ ok: true }) })(7, { callerCompanyId: 12 });
    assert.equal(f.syncs(), 1);
    assert.deepEqual(f.writes[0].qbDocNumberMismatch, null);
    assert.ok(!("invoiceNumber" in f.writes[0]));
  });
  it("records differing returned number on create but never writes invoiceNumber", async () => {
    const f = fixture();
    await syncHandler({
      ...f.context, checkQbCustomTxnNumbers: async () => ({ ok: true }),
      syncAppInvoiceToQb: async () => ({ outcome: "created", quickbooksId: "501", qbDocNumber: "1034" }),
    })(7, { callerCompanyId: 12 });
    assert.equal(f.writes[0].qbDocNumberMismatch, "1034");
    assert.ok(!("invoiceNumber" in f.writes[0]));
  });
  it("translates disabled, expired and thrown preference failures before syncing", async () => {
    for (const failure of [
      { ok: false, status: 409, message: QB_CUSTOM_TXN_DISABLED },
      { ok: false, status: 401, message: QB_SESSION_EXPIRED },
      new Error("settings unavailable"),
    ]) {
      const f = fixture();
      const run = syncHandler({
        ...f.context,
        checkQbCustomTxnNumbers: async () => { if (failure instanceof Error) throw failure; return failure; },
      });
      await assert.rejects(() => run(7, { callerCompanyId: 12 }), (error: TestSyncError) => {
        assert.equal(error.httpStatus, failure instanceof Error ? 502 : failure.status);
        assert.equal(error.message, failure instanceof Error
          ? "Could not read QuickBooks settings: settings unavailable. Try again." : failure.message);
        return true;
      });
      assert.equal(f.syncs(), 0);
      assert.equal(f.writes.length, 0);
    }
  });
});

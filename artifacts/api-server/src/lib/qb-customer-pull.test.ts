import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  choosePullMode, filterUsableQbCustomers, runCustomerPull, startQbCustomerPullJob,
  QB_CUSTOMER_PULL_INTERVAL_MS, QB_CDC_MAX_AGE_MS, QB_CDC_OVERLAP_MS,
  QB_CUSTOMER_PULL_AUTH_ERROR, QB_CUSTOMER_PULL_BUSY,
  type PullDeps, type Integration, type PullState, type FetchResult,
} from "./qb-customer-pull";
import { createCustomerPullRealmLock } from "./qb-customer-pull-lock";
import { applyQbCustomers, type QbSyncSummary } from "./qb-customer-sync";
import type { Customer } from "@workspace/db/schema";

const now = new Date("2026-11-05T12:00:00Z");
const integration: Integration = { companyId: "7", realmId: "realm-7", accessToken: "fixture",
  connectionStatus: "connected", customerPullLastSuccessAt: new Date(now.getTime() - 3600000) };
const summary: QbSyncSummary = { customersAdded: 1, customersUpdated: 2, customersUnchanged: 3,
  hiddenByQuickbooks: 1, unhiddenByQuickbooks: 2,
  totalCustomers: 9, heldForReview: 1, ignored: 1, unmappedTerms: ["Net 45"],
  termsError: "term warning", results: [{ action: "error", customer: {}, error: "isolated row failure" }] };
function harness() {
  const events: string[] = [];
  const states: Partial<PullState>[] = [];
  const rows = [{ Id: "1" }, { Id: "2", Active: false }, { Id: "3", status: "Deleted" }];
  const deps: PullDeps = {
    withRealmLock: async (_realm, fn) => { events.push("lock"); return { acquired: true, value: await fn() }; },
    fetchFull: async () => { events.push("full"); return { ok: true, customers: rows }; },
    fetchChanged: async (_i, since) => {
      events.push("incremental"); assert.equal(since, "2026-11-05T10:55:00.000Z");
      return { ok: true, customers: rows };
    },
    fetchTerms: async () => { events.push("terms"); return { termNames: null, termsError: "term warning" }; },
    apply: async (cid, usable, terms) => {
      events.push("apply"); assert.equal(cid, 7); assert.deepEqual(usable, [{ Id: "1" }, { Id: "2", Active: false }]);
      assert.equal(terms.termsError, "term warning"); return summary;
    },
    saveState: async (realm, state) => {
      assert.equal(realm, integration.realmId); states.push(state); events.push("save");
    },
    now: () => new Date(now),
  };
  return { deps, events, states };
}

describe("customer pull pure decisions", () => {
  it("exports the fixed interval and CDC bounds", () => {
    assert.equal(QB_CUSTOMER_PULL_INTERVAL_MS, 900000);
    assert.equal(QB_CDC_MAX_AGE_MS, 29 * 86400000);
    assert.equal(QB_CDC_OVERLAP_MS, 300000);
  });
  it("chooses full without success, at 29 days, or older; overlaps recent success by 5 minutes", () => {
    assert.deepEqual(choosePullMode(null, now), { mode: "full" });
    assert.deepEqual(choosePullMode(integration.customerPullLastSuccessAt, now),
      { mode: "incremental", changedSince: "2026-11-05T10:55:00.000Z" });
    for (const age of [QB_CDC_MAX_AGE_MS, QB_CDC_MAX_AGE_MS + 1]) {
      assert.deepEqual(choosePullMode(new Date(+now - age), now), { mode: "full" });
    }
    assert.equal(choosePullMode(new Date(+now - QB_CDC_MAX_AGE_MS + 3600000), now).mode, "incremental");
    assert.deepEqual(choosePullMode(new Date("invalid"), now), { mode: "full" });
  });
  it("keeps inactive rows and filters only exact Deleted without mutating input", () => {
    const rows = [{ Id: "1", Active: true }, { Id: "2", Active: false },
      { Id: "3", status: "Deleted" }, { Id: "4" }];
    assert.deepEqual(filterUsableQbCustomers(rows), { usable: [rows[0], rows[1], rows[3]], skipped: 1 });
    assert.equal(rows.length, 4);
    assert.equal(filterUsableQbCustomers([{ status: "deleted" }, { Active: "false" }, { Active: null }]).skipped, 0);
  });
});

describe("one realm orchestration, stub-only", () => {
  it("checkpoints start inside lock before fetching; row failures/warnings remain successful summary results", async () => {
    const { deps, states, events } = harness();
    const outcome = await runCustomerPull(integration, "incremental", deps);
    assert.deepEqual(events, ["lock", "save", "incremental", "terms", "apply", "save"]);
    assert.deepEqual(states, [{ lastAttemptAt: now }, { lastSuccessAt: now, lastError: null,
      lastSummary: { mode: "incremental", added: 1, updated: 2, unchanged: 3, heldForReview: 1,
        skippedDeleted: 1, hiddenByQuickbooks: 1, unhiddenByQuickbooks: 2, unmappedTerms: ["Net 45"] } }]);
    assert.equal(outcome.status, "success");
    if (outcome.status === "success") assert.equal(outcome.summary, summary);
  });
  it("manual always fetches full; scheduled without a checkpoint also fetches full", async () => {
    for (const mode of ["manual", "incremental"] as const) {
      const { deps, events, states } = harness();
      await runCustomerPull({ ...integration, customerPullLastSuccessAt: mode === "manual" ? now : null }, mode, deps);
      assert.ok(events.includes("full")); assert.ok(!events.includes("incremental"));
      assert.equal(states[1].lastSummary?.mode, mode === "manual" ? "manual" : "full");
    }
  });
  it("the shared runner retains create-only holds, dismissed ignores and authoritative linked updates", async () => {
    const h = harness();
    const reviews: string[] = [];
    const updated: number[] = [];
    h.deps.fetchFull = async () => ({ ok: true, customers: [
      { Id: "duplicate", DisplayName: "The Acme LLC" },
      { Id: "child", DisplayName: "Subcustomer", ParentRef: { value: "parent" } },
      { Id: "dismissed", DisplayName: "Ignored" },
      { Id: "linked", DisplayName: "Acme", PrimaryPhone: { FreeFormNumber: "new" }, ParentRef: { value: "parent" } },
    ] });
    h.deps.fetchTerms = async () => ({ termNames: null });
    const existing = { id: 42, companyId: 7, name: "Acme", phone: "old" } as Customer;
    h.deps.apply = (companyId, qbCustomers, terms) => applyQbCustomers({ companyId, qbCustomers, ...terms,
      deps: {
        getCustomerRecordsLock: async cid => { assert.equal(cid, 7); return { locked: true }; },
        getCustomerByQuickBooksId: async (cid, qb) => { assert.equal(cid, 7); return qb === "linked" ? existing : undefined; },
        getReviewRow: async (cid, qb) => {
          assert.equal(cid, 7); assert.notEqual(qb, "linked");
          return qb === "dismissed" ? { status: "dismissed" } : undefined;
        },
        getUnlinkedCustomers: async cid => { assert.equal(cid, 7); return [{ id: 3, name: "Acme" }]; },
        insertReviewRow: async row => { assert.equal(row.companyId, 7); reviews.push(row.kind); },
        createCustomer: async () => { throw new Error("none of these records may be created"); },
        updateCustomer: async (id, data) => { updated.push(id); return { ...existing, ...data }; },
      } });
    const result = await runCustomerPull(integration, "manual", h.deps);
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.deepEqual(result.summary.results.map(row => row.action), ["held", "held", "ignored", "updated"]);
      assert.deepEqual([result.summary.heldForReview, result.summary.ignored], [2, 1]);
    }
    assert.deepEqual(reviews, ["possible_duplicate", "sub_customer"]); assert.deepEqual(updated, [42]);
  });
  it("uses run start, not completion, for success", async () => {
    const { deps, states } = harness();
    let calls = 0;
    deps.now = () => { calls++; return calls === 1 ? now : new Date(+now + 999999); };
    await runCustomerPull(integration, "incremental", deps);
    assert.equal(calls, 1);
    assert.equal(states[1].lastSuccessAt, now);
  });
  it("failed fetch saves error but never success or summary, including exact 401/403 state copy", async () => {
    for (const status of [401, 403, 500]) {
      const { deps, states, events } = harness();
      deps.fetchChanged = async () => ({ ok: false, status, message: "fetch failure" });
      const outcome = await runCustomerPull(integration, "incremental", deps);
      assert.deepEqual(outcome, { status: "error", httpStatus: status === 500 ? 500 : 403,
        message: "fetch failure", ...(status === 500 ? {} : { needsReconnection: true }) });
      assert.deepEqual(states, [{ lastAttemptAt: now },
        { lastError: status === 500 ? "fetch failure" : QB_CUSTOMER_PULL_AUTH_ERROR }]);
      assert.deepEqual(events, ["lock", "save", "save"]);
    }
  });
  it("busy has no state writes, clock, terms, application or fetch", async () => {
    const { deps, states, events } = harness();
    deps.withRealmLock = async () => ({ acquired: false });
    deps.now = () => { throw new Error("must not read clock"); };
    assert.deepEqual(await runCustomerPull(integration, "manual", deps), { status: "busy" });
    assert.deepEqual(states, []); assert.deepEqual(events, []);
  });
  it("unexpected failures never escape or advance success, even if error persistence also fails", async () => {
    for (const point of ["fetchChanged", "fetchTerms", "apply", "saveState", "withRealmLock"] as const) {
      const { deps, states } = harness();
      Object.assign(deps, { [point]: async () => { throw new Error(`${point} failed`); } });
      assert.equal((await runCustomerPull(integration, "incremental", deps)).status, "error");
      assert.ok(states.every(state => !("lastSuccessAt" in state)));
    }
    const { deps, states } = harness();
    deps.saveState = async (_realm, state) => {
      if ("lastSuccessAt" in state) throw new Error("success state failed");
      states.push(state);
    };
    assert.equal((await runCustomerPull(integration, "incremental", deps)).status, "error");
    assert.deepEqual(states.at(-1), { lastError: "success state failed" });
  });
});

describe("dedicated advisory session cleanup", () => {
  function lockHarness(acquired = true, failQuery = 0) {
    const queries: Array<[string, string[]]> = [];
    const releases: Array<Error | undefined> = [];
    let connects = 0;
    const lock = createCustomerPullRealmLock({ connect: async () => {
      connects++;
      return { query: async (sql, values) => {
        queries.push([sql, values]);
        if (queries.length === failQuery) throw new Error("query failed");
        return { rows: [{ acquired }] };
      }, release: error => { releases.push(error); } };
    } });
    return { lock, queries, releases, connects: () => connects };
  }
  it("unlocks before releasing the same session on success and callback errors", async () => {
    for (const fails of [false, true]) {
      const h = lockHarness();
      const promise = h.lock("realm", async () => {
        assert.equal(h.releases.length, 0); assert.equal(h.queries.length, 1);
        if (fails) throw new Error("callback failed");
        return 42;
      });
      if (fails) await assert.rejects(promise, /callback failed/);
      else assert.deepEqual(await promise, { acquired: true, value: 42 });
      assert.deepEqual(h.queries, [
        ["SELECT pg_try_advisory_lock(hashtext('qb-customer-pull:' || $1::text)) AS acquired", ["realm"]],
        ["SELECT pg_advisory_unlock(hashtext('qb-customer-pull:' || $1::text))", ["realm"]],
      ]);
      assert.equal(h.connects(), 1); assert.deepEqual(h.releases, [undefined]);
    }
  });
  it("busy releases without unlocking or invoking callback", async () => {
    const h = lockHarness(false);
    assert.deepEqual(await h.lock("realm", async () => { throw new Error("must not run"); }), { acquired: false });
    assert.equal(h.queries.length, 1); assert.deepEqual(h.releases, [undefined]);
  });
  it("acquisition errors release; failed unlock destroys rather than recycles locked client", async () => {
    for (const query of [1, 2]) {
      const h = lockHarness(true, query);
      await assert.rejects(h.lock("realm", async () => 42), /query failed/);
      assert.equal(h.releases.length, 1);
      if (query === 2) assert.match(h.releases[0]!.message, /query failed/);
    }
  });
  it("manual and scheduled competitors share one lock and apply only once", async () => {
    let held = false;
    const lock = createCustomerPullRealmLock({ connect: async () => ({
      query: async sql => {
        if (sql.includes("pg_try")) {
          if (held) return { rows: [{ acquired: false }] };
          held = true; return { rows: [{ acquired: true }] };
        }
        held = false; return { rows: [] };
      }, release() {},
    }) });
    const h = harness();
    h.deps.withRealmLock = lock;
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const fetch = h.deps.fetchFull;
    h.deps.fetchFull = async i => { entered(); await pending; return fetch(i); };
    const first = runCustomerPull(integration, "manual", h.deps);
    await started;
    assert.deepEqual(await runCustomerPull(integration, "incremental", h.deps), { status: "busy" });
    finish(); assert.equal((await first).status, "success");
    assert.equal(h.events.filter(event => event === "apply").length, 1);
    assert.equal(held, false);
  });
});

describe("delayed serial scheduling", () => {
  it("no startup run; first sweep at 15 minutes, invalid companies skipped, realm failures do not stop subsequent realms", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { deps } = harness();
    const seen: string[] = [];
    let loads = 0;
    deps.saveState = async () => {};
    deps.fetchFull = async i => {
      seen.push(i.realmId);
      if (i.realmId === "first") throw new Error("realm failed");
      return { ok: true, customers: [] };
    };
    deps.fetchTerms = async () => ({ termNames: null });
    deps.apply = async () => summary;
    const timer = startQbCustomerPullJob(async () => {
      loads++;
      return [
        { ...integration, realmId: "first", customerPullLastSuccessAt: null },
        ...["abc", "0", "-1", "1.5", "", "Infinity"].map(companyId => ({ ...integration, companyId })),
        { ...integration, realmId: "disconnected", connectionStatus: "disconnected" },
        { ...integration, realmId: "second", customerPullLastSuccessAt: null },
      ];
    }, deps);
    assert.equal(loads, 0);
    t.mock.timers.tick(QB_CUSTOMER_PULL_INTERVAL_MS - 1);
    assert.equal(loads, 0);
    t.mock.timers.tick(1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 1); assert.deepEqual(seen, ["first", "second"]);
    clearInterval(timer);
  });
  it("awaits each realm and skips overlapping ticks; a failed list can recover next tick", async t => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const { deps } = harness();
    deps.saveState = async () => {};
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    let loads = 0;
    deps.fetchFull = async i => { seen.push(i.realmId); if (i.realmId === "first") await pending; return { ok: true, customers: [] }; };
    deps.fetchTerms = async () => ({ termNames: null }); deps.apply = async () => summary;
    const timer = startQbCustomerPullJob(async () => {
      if (++loads === 1) throw new Error("load failed");
      return ["first", "second"].map(realmId => ({ ...integration, realmId, customerPullLastSuccessAt: null }));
    }, deps);
    t.mock.timers.tick(QB_CUSTOMER_PULL_INTERVAL_MS);
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(QB_CUSTOMER_PULL_INTERVAL_MS);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ["first"]);
    t.mock.timers.tick(QB_CUSTOMER_PULL_INTERVAL_MS);
    assert.equal(loads, 2);
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ["first", "second"]);
    clearInterval(timer);
  });
});

const source = readFileSync(new URL("../routes/routes.ts", import.meta.url), "utf8");
function handler(path: string) {
  const start = source.indexOf(`app.${path}`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf("\n  });", start));
}
async function compileHandler(text: string, deps: Record<string, unknown>) {
  const { transform } = await import("esbuild");
  const body = text.slice(text.indexOf("async (req, res) => {") + "async (req, res) => {".length);
  const compiled = await transform(`async function run(req, res) {${body}\n}`, { loader: "ts", target: "es2022" });
  return new Function(...Object.keys(deps), `${compiled.code}; return run;`)(...Object.values(deps));
}
function response() {
  return { code: 200, body: {} as any, status(code: number) { this.code = code; return this; },
    json(body: unknown) { this.body = body; return this; } };
}
describe("real route bodies with injected seams and static registration guards", () => {
  const manual = handler('post("/api/quickbooks/sync-customers"');
  const status = handler('get("/api/quickbooks/customer-pull-status"');
  it("registers one unref'd timer immediately after health and manual delegates without direct application", () => {
    assert.equal((source.match(/startQbCustomerPullJob\(/g) ?? []).length, 1);
    assert.match(source, /_qbHealthTimer\.unref\(\);\s+const _qbCustomerPullTimer = startQbCustomerPullJob/);
    assert.match(source, /_qbCustomerPullTimer\.unref\(\)/);
    assert.match(manual, /runCustomerPull\(integration, "manual", pullDeps\)/);
    assert.doesNotMatch(manual, /applyQbCustomers\(/);
    assert.match(status, /requireAuthentication, requireQuickBooksAccess/);
  });
  it("migration adds exactly four nullable columns idempotently after the prerequisite", () => {
    const migration = readFileSync(new URL("../../../../lib/db/migrations/0029_qb_customer_pull_state.sql", import.meta.url), "utf8");
    assert.equal((migration.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length, 4);
    for (const [field, type] of [["last_attempt_at", "timestamptz"], ["last_success_at", "timestamptz"],
      ["last_error", "text"], ["last_summary", "jsonb"]]) {
      assert.ok(migration.includes(`customer_pull_${field} ${type};`));
    }
    assert.doesNotMatch(migration, /NOT NULL|DEFAULT|DROP/i);
  });
  it("preserves success fields/message and returns exact busy and fetch-error HTTP responses", async () => {
    for (const outcome of [
      { status: "busy" }, { status: "error", httpStatus: 403, message: "auth expired", needsReconnection: true },
      { status: "error", httpStatus: 500, message: "fetch failed" }, { status: "success", summary },
    ]) {
      const calls: any[] = [];
      const pullDeps = {};
      const run = await compileHandler(manual, {
        resolveCompanyId: () => "7", storage: {
          getQuickBooksIntegrationByCompanyId: async (cid: string) => { assert.equal(cid, "7"); return integration; },
          getQuickBooksIntegration: async (realm: string) => { assert.equal(realm, integration.realmId); return integration; },
        }, runCustomerPull: async (...args: unknown[]) => { calls.push(args); return outcome; },
        pullDeps, QB_CUSTOMER_PULL_BUSY, console: { log() {}, error() {} },
      });
      const res = response(); await run({}, res);
      assert.deepEqual(calls, [[integration, "manual", pullDeps]]);
      if (outcome.status === "busy") assert.deepEqual([res.code, res.body], [409, { success: false, message: QB_CUSTOMER_PULL_BUSY }]);
      if (outcome.status === "error") {
        assert.equal(res.code, outcome.httpStatus); assert.equal(res.body.message, outcome.message);
        assert.equal(res.body.needsReconnection, outcome.needsReconnection);
      }
      if (outcome.status === "success") {
        assert.deepEqual(res.body, { success: true, ...summary,
          message: "1 added, 2 updated, 3 unchanged; 1 hidden (inactive in QuickBooks); 2 visible again; payment terms not recognized: Net 45" });
      }
    }
  });
  it("status reads only caller's integration, returns null state when absent, rejects missing tenant", async () => {
    const reads: string[] = [];
    const run = await compileHandler(status, {
      resolveCompanyId: (req: any) => req.companyId,
      storage: { getQuickBooksIntegrationByCompanyId: async (cid: string) => {
        reads.push(cid);
        return cid === "7" ? { customerPullLastAttemptAt: now, customerPullLastSuccessAt: now,
          customerPullLastError: null, customerPullLastSummary: { mode: "manual" } } : undefined;
      } },
    });
    for (const companyId of ["7", "8", null]) {
      const res = response(); await run({ companyId }, res);
      if (!companyId) assert.equal(res.code, 400);
      else {
        assert.equal(res.body.intervalMinutes, 15);
        assert.equal(res.body.lastSuccessAt, companyId === "7" ? now : null);
        if (companyId === "8") assert.deepEqual(res.body, { intervalMinutes: 15,
          lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastSummary: null });
      }
    }
    assert.deepEqual(reads, ["7", "8"]);
  });
});

describe("CDC transport and extracted nonfatal terms adapter", () => {
  async function reader(request: (...args: any[]) => Promise<unknown>) {
    const { transform } = await import("esbuild");
    const start = source.indexOf("  async function fetchQbChangedCustomers(");
    const end = source.indexOf("\n  const customerPullApiBase", start);
    const compiled = await transform(source.slice(start, end), { loader: "ts", target: "es2022" });
    return new Function("makeQuickBooksRequest", `${compiled.code}; return fetchQbChangedCustomers;`)(request);
  }
  it("uses CDC company URL, Customer, ISO changedSince, minorversion and existing wrapper; missing rows default empty", async () => {
    for (const payload of [{ CDCResponse: [{ QueryResponse: [{ Customer: [{ Id: "changed" }] }] }] }, {}]) {
      const calls: any[][] = [];
      const fetch = await reader(async (...args) => { calls.push(args); return { ok: true, json: async () => payload }; });
      const since = "2026-11-05T10:55:00.000Z";
      const result = await fetch(integration, "https://sandbox-quickbooks.api.intuit.com", since);
      const url = new URL(calls[0][0]);
      assert.equal(url.origin, "https://sandbox-quickbooks.api.intuit.com");
      assert.equal(url.pathname, `/v3/company/${integration.realmId}/cdc`);
      assert.equal(url.searchParams.get("entities"), "Customer");
      assert.equal(url.searchParams.get("changedSince"), since);
      assert.equal(url.searchParams.get("minorversion"), "73");
      assert.deepEqual(calls[0].slice(2), ["Customers CDC", integration.realmId]);
      assert.equal(calls[0][1].headers.Authorization, "Bearer fixture");
      assert.deepEqual(result, { ok: true, customers: "CDCResponse" in payload ? [{ Id: "changed" }] : [] });
    }
  });
  it("CDC preserves full fetch's authorization and TID error shape", async () => {
    for (const status of [401, 403, 503]) {
      const fetch = await reader(async () => ({ ok: false, status, headers: { get: () => "fixture-tid" } }));
      const result: FetchResult = await fetch(integration, "https://quickbooks.api.intuit.com", now.toISOString());
      assert.deepEqual(result, status === 503
        ? { ok: false, status: 500, message: "Failed to fetch customers from QuickBooks: 503 [TID: fixture-tid]" }
        : { ok: false, status: 403, message: "QuickBooks authorization expired or invalid. Please reconnect to QuickBooks.", needsReconnection: true });
    }
  });
  it("production dependencies use the same nonfatal terms reader and all review guards", async () => {
    const start = source.indexOf("    fetchTerms: async integration => {", source.indexOf("  const pullDeps: PullDeps"));
    const end = source.indexOf("\n    apply:", start);
    const { transform } = await import("esbuild");
    const compiled = await transform(`const adapter = {${source.slice(start, end)}};`, { loader: "ts" });
    for (const fail of [false, true]) {
      const terms = new Map([["3", "Net 30"]]);
      const adapter = new Function("fetchQbTermNames", "customerPullApiBase", `${compiled.code}; return adapter;`)(
        async (i: Integration, base: string) => {
          assert.equal(i, integration); assert.equal(base, "sandbox");
          if (fail) throw new Error("503"); return terms;
        }, "sandbox");
      assert.deepEqual(await adapter.fetchTerms(integration), fail
        ? { termNames: null, termsError: "Could not read QuickBooks terms: 503" } : { termNames: terms });
    }
    const productionApply = source.slice(end, source.indexOf("\n    saveState:", end));
    for (const guard of ["applyQbCustomers", "getCustomerRecordsLock", "getCustomerByQuickBooksId",
      "getReviewRow", "getUnlinkedCustomers", "insertReviewRow"]) assert.ok(productionApply.includes(guard));
    assert.match(productionApply, /eq\(customers.companyId, companyId\)/);
  });
});

// =============================================================================
// ASPIRE API CLIENT — unit tests (node:test runner)
// =============================================================================
//
// All external calls (fetch, DB, token service) are monkey-patched at the
// module level — no vitest/jest, no DATABASE_URL required.
//
// Run with:
//   DATABASE_URL=<any> ASPIRE_ENCRYPTION_KEY=<64-hex> \
//   node --import tsx --test --test-reporter=spec \
//     "artifacts/api-server/src/services/aspire-api-client.test.ts"
//
// Or via:
//   pnpm --filter @workspace/api-server test

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Patch dependencies BEFORE importing the module under test.
//
// Node:test does not have vi.mock(); instead we use the dynamic-import seam
// trick: import the client AFTER installing stubs on its collaborators.
// ---------------------------------------------------------------------------

// We cannot easily intercept ESM imports post-hoc in node:test, so we use
// the _test* seam functions exported by aspire-api-client for state management,
// and patch the global fetch + the token-service methods at the object level
// after their modules are loaded.

// 1. Patch global fetch before anything else loads
const _realFetch = globalThis.fetch;
let _fetchMock: ((req: Request | string, init?: RequestInit) => Promise<Response>) | null = null;
globalThis.fetch = async (input: Request | string, init?: RequestInit): Promise<Response> => {
  if (_fetchMock) return _fetchMock(input, init);
  throw new Error("[test] No fetch mock installed");
};

// 2. Import the token service first so we can monkey-patch its exports
import * as tokenService from "./aspire-token-service";
import * as dbModule from "../db";

// Patch DB: override the drizzle `db` object with a lightweight stub
const dbStub = {
  select: () => dbStub,
  from: () => dbStub,
  where: () => dbStub,
  limit: async (_n: number) => [{ throttleUntil: null }], // default: no throttle
  update: () => dbStub,
  set: () => dbStub,
  transaction: async (fn: (tx: unknown) => Promise<void>) => fn(dbStub),
};
// @ts-expect-error — patching read-only module export for test isolation
dbModule.db = dbStub;

// 3. Import the module under test (after patches are in place)
import {
  getOrRefreshToken,
  testConnection,
  request,
  AspireApiError,
  AspireThrottleError,
  AspireCredentialsMissingError,
  _testSetCachedToken,
  _testEvictCachedToken,
  _testClearRefreshMutex,
} from "./aspire-api-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPANY_ID = 42;
const MOCK_TOKEN = "mock-bearer-token-xyz";
const FUTURE_EXPIRY = new Date(Date.now() + 60 * 60 * 1_000);
const PAST_EXPIRY = new Date(Date.now() - 1_000);

/** Builds a minimal Response for fetch mocks. */
function makeResponse(
  status: number,
  body: unknown = {},
  extraHeaders: Record<string, string> = {},
): Response {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers({
    "content-type": "application/json",
    ...extraHeaders,
  });
  return new Response(bodyStr, { status, headers });
}

function clearTestState() {
  _testEvictCachedToken(COMPANY_ID);
  _testClearRefreshMutex(COMPANY_ID);
  _fetchMock = null;
}

// ---------------------------------------------------------------------------
// getOrRefreshToken — cache behaviour
// ---------------------------------------------------------------------------

describe("getOrRefreshToken", () => {
  beforeEach(() => {
    clearTestState();
    // Default token-service stubs
    (tokenService as any).getDecryptedAccessToken = async () => null;
    (tokenService as any)._internalGetDecryptedCredentials = async () => null;
    (tokenService as any).saveAccessToken = async () => undefined;
    (tokenService as any).markConnectionError = async () => undefined;
    // Default DB stub: no throttle
    (dbStub as any).limit = async () => [{ throttleUntil: null }];
  });

  after(() => clearTestState());

  it("returns a cached valid token without calling the DB or fetch", async () => {
    _testSetCachedToken(COMPANY_ID, MOCK_TOKEN, FUTURE_EXPIRY);

    let getDecryptedCalled = false;
    (tokenService as any).getDecryptedAccessToken = async () => {
      getDecryptedCalled = true;
      return null;
    };

    const token = await getOrRefreshToken(COMPANY_ID);

    assert.equal(token, MOCK_TOKEN);
    assert.equal(getDecryptedCalled, false, "should NOT hit the DB when cache is warm");
  });

  it("falls back to DB token when memory cache is empty and token is still fresh", async () => {
    let credentialsCalled = false;
    (tokenService as any).getDecryptedAccessToken = async () => ({
      accessToken: MOCK_TOKEN,
      expiresAt: FUTURE_EXPIRY,
    });
    (tokenService as any)._internalGetDecryptedCredentials = async () => {
      credentialsCalled = true;
      return null;
    };

    const token = await getOrRefreshToken(COMPANY_ID);

    assert.equal(token, MOCK_TOKEN);
    assert.equal(credentialsCalled, false, "should NOT fetch new token when DB token is fresh");
  });

  it("performs a fresh handshake when the DB token is expired", async () => {
    (tokenService as any).getDecryptedAccessToken = async () => ({
      accessToken: "old-token",
      expiresAt: PAST_EXPIRY,
    });
    (tokenService as any)._internalGetDecryptedCredentials = async () => ({
      clientId: "cid",
      clientSecret: "csecret",
    });

    let saveCalledWith: { token: string; expiresAt: Date } | null = null;
    (tokenService as any).saveAccessToken = async (
      _cid: number,
      token: string,
      expiresAt: Date,
    ) => { saveCalledWith = { token, expiresAt }; };

    _fetchMock = async () =>
      makeResponse(200, { access_token: "fresh-token", expires_in: 3600 });

    const token = await getOrRefreshToken(COMPANY_ID);

    assert.equal(token, "fresh-token");
    assert.ok(saveCalledWith, "saveAccessToken must be called");
    assert.equal((saveCalledWith as any).token, "fresh-token");
  });

  it("throws AspireCredentialsMissingError when no credentials are stored", async () => {
    (tokenService as any).getDecryptedAccessToken = async () => null;
    (tokenService as any)._internalGetDecryptedCredentials = async () => null;

    await assert.rejects(
      () => getOrRefreshToken(COMPANY_ID),
      AspireCredentialsMissingError,
    );
  });

  it("two concurrent refreshes share the same fetch call (mutex test)", async () => {
    (tokenService as any).getDecryptedAccessToken = async () => null;
    (tokenService as any)._internalGetDecryptedCredentials = async () => ({
      clientId: "cid",
      clientSecret: "secret",
    });
    (tokenService as any).saveAccessToken = async () => undefined;

    let fetchCallCount = 0;
    let resolveFirst!: (r: Response) => void;
    const firstFetchDone = new Promise<Response>((res) => { resolveFirst = res; });

    _fetchMock = async () => {
      fetchCallCount++;
      return firstFetchDone;
    };

    // Launch both before resolving the fetch
    const p1 = getOrRefreshToken(COMPANY_ID);
    const p2 = getOrRefreshToken(COMPANY_ID);

    resolveFirst(makeResponse(200, { access_token: "shared-token", expires_in: 3600 }));

    const [t1, t2] = await Promise.all([p1, p2]);

    assert.equal(t1, "shared-token");
    assert.equal(t2, "shared-token");
    assert.equal(fetchCallCount, 1, "fetch must be called exactly once despite two concurrent calls");
  });
});

// ---------------------------------------------------------------------------
// request — success, 401 retry, 403 error, 429 throttle
// ---------------------------------------------------------------------------

describe("request", () => {
  before(() => {
    // Pre-seed a valid cached token for all request tests
    _testSetCachedToken(COMPANY_ID, MOCK_TOKEN, FUTURE_EXPIRY);
    // Default: no throttle
    (dbStub as any).limit = async () => [{ throttleUntil: null }];
    (tokenService as any).markConnectionError = async () => undefined;
    (tokenService as any).saveAccessToken = async () => undefined;
  });

  beforeEach(() => {
    _fetchMock = null;
    // Re-seed the cache (it gets evicted on refresh)
    _testSetCachedToken(COMPANY_ID, MOCK_TOKEN, FUTURE_EXPIRY);
    _testClearRefreshMutex(COMPANY_ID);
  });

  after(() => clearTestState());

  it("returns parsed JSON on 200", async () => {
    _fetchMock = async () =>
      makeResponse(200, { id: 1, name: "Test Customer" });

    const result = await request<{ id: number; name: string }>(
      COMPANY_ID, "GET", "/Customers/1",
    );

    assert.equal(result.id, 1);
    assert.equal(result.name, "Test Customer");
  });

  it("on 401: performs exactly one refresh+retry and succeeds", async () => {
    (tokenService as any).getDecryptedAccessToken = async () => null;
    (tokenService as any)._internalGetDecryptedCredentials = async () => ({
      clientId: "cid",
      clientSecret: "secret",
    });
    // Prepare transaction stub for markReconnectRequired
    (dbStub as any).transaction = async (fn: (tx: unknown) => Promise<void>) => fn(dbStub);

    let callCount = 0;
    _fetchMock = async (input) => {
      callCount++;
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("Authorization")) {
        // Token refresh call
        return makeResponse(200, { access_token: "refreshed-token", expires_in: 3600 });
      }
      if (callCount === 1) return makeResponse(401, { error: "unauthorized" });
      return makeResponse(200, { id: 2 });
    };

    const result = await request<{ id: number }>(COMPANY_ID, "GET", "/Customers/2");
    assert.equal(result.id, 2);
    assert.equal(callCount, 3, "exactly 3 fetches: original + token refresh + retry");
  });

  it("on 401: marks reconnect_required and throws when retry also 401s", async () => {
    (tokenService as any).getDecryptedAccessToken = async () => null;
    (tokenService as any)._internalGetDecryptedCredentials = async () => ({
      clientId: "cid",
      clientSecret: "secret",
    });

    let callCount = 0;
    _fetchMock = async (input) => {
      callCount++;
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("Authorization")) {
        return makeResponse(200, { access_token: "new-token", expires_in: 3600 });
      }
      return makeResponse(401, { error: "still unauthorized" });
    };

    await assert.rejects(
      () => request(COMPANY_ID, "GET", "/Customers/999"),
      AspireApiError,
    );

    // Must not loop: only 3 calls (original + token refresh + retry)
    assert.equal(callCount, 3, "must stop after single retry (no infinite loop)");
  });

  it("on 403: marks connectionStatus=error and throws AspireApiError", async () => {
    let errorMessageStored: string | null = null;
    (tokenService as any).markConnectionError = async (_cid: number, msg: string) => {
      errorMessageStored = msg;
    };

    _fetchMock = async () => makeResponse(403, { error: "forbidden" });

    await assert.rejects(
      () => request(COMPANY_ID, "POST", "/ProtectedEndpoint"),
      AspireApiError,
    );

    assert.ok(errorMessageStored, "markConnectionError must be called");
    assert.ok(
      errorMessageStored!.toLowerCase().includes("permission"),
      `Error message should mention 'permission', got: ${errorMessageStored}`,
    );
  });

  it("on 429: throws AspireThrottleError", async () => {
    // Override DB update chain for throttleUntil write
    (dbStub as any).update = () => dbStub;
    (dbStub as any).set = () => dbStub;
    (dbStub as any).where = async () => undefined;

    _fetchMock = async () =>
      makeResponse(429, "rate limited", { "retry-after": "60" });

    await assert.rejects(
      () => request(COMPANY_ID, "GET", "/Customers"),
      AspireThrottleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Throttle guard
// ---------------------------------------------------------------------------

describe("throttle guard", () => {
  before(() => {
    _testSetCachedToken(COMPANY_ID, MOCK_TOKEN, FUTURE_EXPIRY);
  });

  after(() => clearTestState());

  it("throws AspireThrottleError before making any fetch when throttleUntil is future", async () => {
    const futureThrottle = new Date(Date.now() + 5 * 60 * 1_000);
    (dbStub as any).limit = async () => [{ throttleUntil: futureThrottle }];

    let fetchCalled = false;
    _fetchMock = async () => {
      fetchCalled = true;
      return makeResponse(200, {});
    };

    await assert.rejects(
      () => request(COMPANY_ID, "GET", "/Customers"),
      AspireThrottleError,
    );

    assert.equal(fetchCalled, false, "no outbound HTTP call when throttled");
  });

  it("proceeds when throttleUntil is in the past", async () => {
    const pastThrottle = new Date(Date.now() - 1_000);
    (dbStub as any).limit = async () => [{ throttleUntil: pastThrottle }];
    _testSetCachedToken(COMPANY_ID, MOCK_TOKEN, FUTURE_EXPIRY);

    _fetchMock = async () => makeResponse(200, { ok: true });

    const result = await request(COMPANY_ID, "GET", "/Customers");
    assert.ok(result !== undefined);
  });
});

// ---------------------------------------------------------------------------
// testConnection
// ---------------------------------------------------------------------------

describe("testConnection", () => {
  beforeEach(() => {
    clearTestState();
    (dbStub as any).limit = async () => [{ throttleUntil: null }];
    (tokenService as any).markConnectionError = async () => undefined;
    (tokenService as any).saveAccessToken = async () => undefined;
    (tokenService as any).getDecryptedAccessToken = async () => null;
  });

  after(() => clearTestState());

  it("returns success=true when token exchange and probe both succeed", async () => {
    (tokenService as any)._internalGetDecryptedCredentials = async () => ({
      clientId: "good-id",
      clientSecret: "good-secret",
    });

    let callCount = 0;
    _fetchMock = async () => {
      callCount++;
      if (callCount === 1) {
        return makeResponse(200, { access_token: "token-abc", expires_in: 3600 });
      }
      return makeResponse(200, []);
    };

    const result = await testConnection(COMPANY_ID);
    assert.equal(result.success, true);
    assert.equal(result.errorMessage, undefined);
  });

  it("returns success=false with sanitized message when credentials are invalid", async () => {
    (tokenService as any)._internalGetDecryptedCredentials = async () => ({
      clientId: "bad-id",
      clientSecret: "bad-secret",
    });

    _fetchMock = async () => makeResponse(401, { error: "invalid_client" });

    const result = await testConnection(COMPANY_ID);
    assert.equal(result.success, false);
    assert.ok(result.errorMessage, "error message must be populated");
    // Ensure credentials are not echoed in the error message
    assert.ok(!result.errorMessage!.includes("bad-secret"), "secret must not appear in error");
  });

  it("never throws — always returns a typed result", async () => {
    (tokenService as any)._internalGetDecryptedCredentials = async () => null;

    // Should resolve (not throw) even with missing credentials
    const result = await testConnection(COMPANY_ID);
    assert.equal(typeof result.success, "boolean");
    assert.equal(result.success, false);
  });
});

// Task #521 — apiRequest transparent-refresh regression tests.
//
// Locks in the contract for the mobile API client:
//
//   1. A 401 with a stored refresh token triggers exactly one refresh
//      POST and replays the original request with the new bearer.
//   2. A 401 with no refresh token clears the cached tokens AND fires
//      the unauthorized handler (no retry attempted).
//   3. A failed refresh (server returns 401) clears the tokens and
//      fires the unauthorized handler.
//   4. Concurrent 401s share a single in-flight refresh promise so the
//      app doesn't issue N parallel refreshes when the access token
//      expires under a burst of queued requests.
//
// SecureStore is swapped out for an in-memory map via the
// `__setSecureTokenStoreForTests` seam exported from `./api`. global
// fetch is monkey-patched per-test so we can drive the response shape
// for both the original request and the refresh POST.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  __resetTokenCacheForTests,
  __setSecureTokenStoreForTests,
  apiRequest,
  setUnauthorizedHandler,
  setToken,
} from "./api";

const TOKEN_KEY = "irrigopro.mobile.token.v2";
const memory = new Map<string, string>();
__setSecureTokenStoreForTests({
  get: async (key) => memory.get(key) ?? null,
  set: async (key, value) => {
    memory.set(key, value);
  },
  delete: async (key) => {
    memory.delete(key);
  },
});

type FetchCall = { url: string; init: RequestInit | undefined };
let fetchCalls: FetchCall[] = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  new Response("{}", { status: 200 });
const realFetch = globalThis.fetch;

beforeEach(async () => {
  memory.clear();
  __resetTokenCacheForTests();
  fetchCalls = [];
  fetchImpl = async () => new Response("{}", { status: 200 });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  }) as typeof fetch;
  setUnauthorizedHandler(null);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setUnauthorizedHandler(null);
});

async function seedTokens(opts: { withRefresh: boolean } = { withRefresh: true }) {
  await setToken({
    accessToken: "stale-access",
    accessTokenExpiresAt: null,
    refreshToken: opts.withRefresh ? "good-refresh" : null,
    refreshTokenExpiresAt: null,
  });
}

describe("apiRequest transparent refresh (Task #521)", () => {
  it("retries the original request after a successful refresh", async () => {
    await seedTokens();
    let firstCall = true;
    fetchImpl = async (url, init) => {
      if (url.endsWith("/api/auth/mobile-refresh")) {
        return new Response(
          JSON.stringify({
            accessToken: "fresh-access",
            accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (firstCall) {
        firstCall = false;
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        assert.equal(auth, "Bearer stale-access");
        return new Response(JSON.stringify({ message: "expired" }), { status: 401 });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      assert.equal(auth, "Bearer fresh-access", "retry must use the fresh access token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await apiRequest<{ ok: boolean }>("/api/some-endpoint");
    assert.deepEqual(result, { ok: true });
    // Three fetches: original 401, refresh, retry.
    assert.equal(fetchCalls.length, 3);
    assert.ok(fetchCalls[1].url.endsWith("/api/auth/mobile-refresh"));
    // Tokens were updated in storage.
    const stored = JSON.parse(memory.get(TOKEN_KEY)!);
    assert.equal(stored.accessToken, "fresh-access");
    assert.equal(stored.refreshToken, "good-refresh");
  });

  it("clears tokens and fires the unauthorized handler when no refresh token is present", async () => {
    await seedTokens({ withRefresh: false });
    let unauthorizedFired = 0;
    setUnauthorizedHandler(() => {
      unauthorizedFired += 1;
    });
    fetchImpl = async () => new Response(JSON.stringify({}), { status: 401 });

    await assert.rejects(() => apiRequest("/api/whatever"));
    assert.equal(unauthorizedFired, 1);
    // Original request only — no refresh, no retry.
    assert.equal(fetchCalls.length, 1);
    assert.equal(memory.has(TOKEN_KEY), false);
  });

  it("clears tokens and fires the unauthorized handler when refresh itself returns 401", async () => {
    await seedTokens();
    let unauthorizedFired = 0;
    setUnauthorizedHandler(() => {
      unauthorizedFired += 1;
    });
    fetchImpl = async (url) => {
      if (url.endsWith("/api/auth/mobile-refresh")) {
        return new Response("{}", { status: 401 });
      }
      return new Response("{}", { status: 401 });
    };
    await assert.rejects(() => apiRequest("/api/whatever"));
    assert.equal(unauthorizedFired, 1);
    assert.equal(memory.has(TOKEN_KEY), false);
  });

  it("dedupes concurrent 401s into a single in-flight refresh", async () => {
    await seedTokens();
    let refreshCalls = 0;
    let resolveRefresh: ((res: Response) => void) | null = null;
    const refreshGate = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    fetchImpl = async (url, init) => {
      if (url.endsWith("/api/auth/mobile-refresh")) {
        refreshCalls += 1;
        return refreshGate;
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (auth === "Bearer fresh-access") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 401 });
    };

    const a = apiRequest<{ ok: boolean }>("/api/a");
    const b = apiRequest<{ ok: boolean }>("/api/b");
    const c = apiRequest<{ ok: boolean }>("/api/c");

    // Allow both original requests to issue + their 401s to land before
    // the refresh resolves.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(refreshCalls, 1, "all three concurrent 401s must share one refresh");

    resolveRefresh!(
      new Response(
        JSON.stringify({
          accessToken: "fresh-access",
          accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.deepEqual(ra, { ok: true });
    assert.deepEqual(rb, { ok: true });
    assert.deepEqual(rc, { ok: true });
    assert.equal(refreshCalls, 1);
  });
});

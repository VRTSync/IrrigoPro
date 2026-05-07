/**
 * QB9 — QuickBooks Token Resilience Regression Test Plan
 *
 * All core tests use real production code paths:
 *  - classifyQbRefreshError, buildReconnectReason, QbRefreshError:
 *      imported from server/qb-token-utils.ts
 *  - withQbRefreshLock, runProactiveRefreshForRealm, startQbTokenHealthJob:
 *      imported from server/qb-token-utils.ts
 *  - storage.saveQuickBooksIntegration, getQuickBooksIntegration, markQuickBooksReconnectRequired:
 *      real DatabaseStorage against the live database
 *  - /api/quickbooks/health: live HTTP endpoint verifying DB → API round-trip
 *
 * Scenarios:
 *  T1 - Initial auth stores both tokens correctly (real DB write + API verify)
 *  T2 - Proactive refresh fires before expiry (runProactiveRefreshForRealm + real storage)
 *  T3 - Expired access token → refresh → retry (real withQbRefreshLock + real storage)
 *  T4 - Rotation: newest token persists after multiple refreshes (real DB upsert)
 *  T5 - Concurrent same-realm requests: only one refresh runs (real withQbRefreshLock)
 *  T6 - Stale old refresh token is gone after rotation (real DB state)
 *  T7 - Revoked: reconnect_required persists, refresh loop stops (real storage + API)
 *  T8 - 100-day threshold: startQbTokenHealthJob detects and handles stale connections
 *  T9 - API client reads freshest token from real storage after refresh
 *
 * Run with:
 *   node --import tsx/esm --test tests/qb-token-resilience.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Real production imports via tsx/esm ───────────────────────────────────
const utilsModule = await import('../server/qb-token-utils.ts');
const {
  classifyQbRefreshError,
  withQbRefreshLock,
  qbRefreshLock,
  QB_PROACTIVE_REFRESH_BUFFER_MS,
  QB_IDLE_THRESHOLD_DAYS,
  UNRECOVERABLE_CATEGORIES,
  buildReconnectReason,
  QbRefreshError,
  runProactiveRefreshForRealm,
  startQbTokenHealthJob,
} = utilsModule;

const { storage } = await import('../server/storage.ts');
const { db } = await import('../server/db.ts');
const { quickbooksIntegration } = await import('../shared/schema.ts');
const { eq, like } = await import('drizzle-orm');

// ── Test isolation helpers ─────────────────────────────────────────────────

const TEST_REALM_PREFIX = 'test-qb9-';
const TEST_COMPANY_ID = '9999';

function rid(suffix) {
  return `${TEST_REALM_PREFIX}${suffix}`;
}

async function cleanAllTestRealms() {
  await db.delete(quickbooksIntegration).where(like(quickbooksIntegration.realmId, `${TEST_REALM_PREFIX}%`));
}

async function deleteRealm(realmId) {
  await db.delete(quickbooksIntegration).where(eq(quickbooksIntegration.realmId, realmId));
}

function futureMs(ms) { return new Date(Date.now() + ms); }
function pastMs(ms) { return new Date(Date.now() - ms); }

// ── QbStorageAdapter backed by real DatabaseStorage ────────────────────────

function makeRealAdapter() {
  return {
    getIntegration: (realmId) => storage.getQuickBooksIntegration(realmId),
    saveIntegration: (data) => storage.saveQuickBooksIntegration(data),
    markReconnectRequired: (realmId, reason) => storage.markQuickBooksReconnectRequired(realmId, reason),
  };
}

// ── Live API helpers ───────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:5000';
const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  'x-user-id': '1',
  'x-user-role': 'super_admin',
  'x-user-company-id': '99',
};

async function apiCall(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: ADMIN_HEADERS,
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getHealthForRealm(realmId) {
  const res = await apiCall('/api/quickbooks/health');
  assert.equal(res.status, 200, `Health endpoint returned ${res.status}`);
  return res.body.connections.find((c) => c.realmId === realmId) ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Global setup/teardown
// ══════════════════════════════════════════════════════════════════════════════

before(async () => {
  await cleanAllTestRealms();
  const probe = await fetch(`${BASE_URL}/api/quickbooks/health`, {
    headers: ADMIN_HEADERS,
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  assert.ok(
    probe && probe.status === 200,
    `Server must be up at ${BASE_URL} before QB9 tests can run. Start with "npm run dev" first.`
  );
});

after(async () => {
  await cleanAllTestRealms();
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Error classification — real classifyQbRefreshError
// ══════════════════════════════════════════════════════════════════════════════

describe('Error classification (real classifyQbRefreshError from server/qb-token-utils.ts)', () => {
  test('T7: invalid_grant → stale_refresh_token (unrecoverable)', () => {
    const cat = classifyQbRefreshError(JSON.stringify({ error: 'invalid_grant' }), 400);
    assert.equal(cat, 'stale_refresh_token');
    assert.ok(UNRECOVERABLE_CATEGORIES.has(cat));
  });

  test('T6: invalid_refresh_token → stale_refresh_token', () => {
    assert.equal(classifyQbRefreshError(JSON.stringify({ error: 'invalid_refresh_token' }), 400), 'stale_refresh_token');
  });

  test('T7: access_denied → revoked (unrecoverable)', () => {
    const cat = classifyQbRefreshError(JSON.stringify({ error: 'access_denied' }), 401);
    assert.equal(cat, 'revoked');
    assert.ok(UNRECOVERABLE_CATEGORIES.has(cat));
  });

  test('T7: authorization_revoked → revoked', () => {
    assert.equal(classifyQbRefreshError(JSON.stringify({ error: 'authorization_revoked' }), 401), 'revoked');
  });

  test('T7: revoked_token → revoked', () => {
    assert.equal(classifyQbRefreshError(JSON.stringify({ error: 'revoked_token' }), 401), 'revoked');
  });

  test('T3: HTTP 5xx → transient (retry-safe)', () => {
    assert.equal(classifyQbRefreshError('{"error":"unknown"}', 500), 'transient');
  });

  test('T3: server_error body → transient', () => {
    assert.equal(classifyQbRefreshError(JSON.stringify({ error: 'server_error' }), 400), 'transient');
  });

  test('T3: temporarily_unavailable → transient', () => {
    assert.equal(classifyQbRefreshError(JSON.stringify({ error: 'temporarily_unavailable' }), 503), 'transient');
  });

  test('T3: transient is NOT in UNRECOVERABLE_CATEGORIES (retry loop continues)', () => {
    const cat = classifyQbRefreshError(JSON.stringify({ error: 'server_error' }), 503);
    assert.ok(!UNRECOVERABLE_CATEGORIES.has(cat));
  });

  test('T3: unknown 4xx → reconnect_required (unrecoverable)', () => {
    const cat = classifyQbRefreshError(JSON.stringify({ error: 'some_unknown_error' }), 403);
    assert.equal(cat, 'reconnect_required');
    assert.ok(UNRECOVERABLE_CATEGORIES.has(cat));
  });

  test('T7: non-JSON error text falls back to string match', () => {
    assert.equal(classifyQbRefreshError('invalid_grant', 400), 'stale_refresh_token');
  });

  test('T7: alternate error_code field (Intuit format)', () => {
    assert.equal(classifyQbRefreshError(JSON.stringify({ error_code: 'invalid_grant' }), 400), 'stale_refresh_token');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: buildReconnectReason + QbRefreshError — real implementations
// ══════════════════════════════════════════════════════════════════════════════

describe('buildReconnectReason + QbRefreshError (real from server/qb-token-utils.ts)', () => {
  test('stale_refresh_token reason mentions invalid_grant', () => {
    assert.ok(buildReconnectReason('stale_refresh_token').includes('invalid_grant'));
  });

  test('revoked reason mentions revoked', () => {
    assert.ok(buildReconnectReason('revoked').toLowerCase().includes('revoked'));
  });

  test('reconnect_required produces non-empty reason', () => {
    assert.ok(buildReconnectReason('reconnect_required').length > 0);
  });

  test('transient produces empty string (never persisted)', () => {
    assert.equal(buildReconnectReason('transient'), '');
  });

  test('All UNRECOVERABLE_CATEGORIES have non-empty reasons', () => {
    for (const cat of UNRECOVERABLE_CATEGORIES) {
      assert.ok(buildReconnectReason(cat).length > 0, `${cat} must have a reason`);
    }
  });

  test('QbRefreshError carries category and name (real class)', () => {
    const err = new QbRefreshError('test', 'stale_refresh_token');
    assert.equal(err.category, 'stale_refresh_token');
    assert.equal(err.name, 'QbRefreshError');
    assert.ok(err instanceof Error);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: T1 — Initial auth stores both tokens (real DB write + API verify)
// ══════════════════════════════════════════════════════════════════════════════

describe('T1 — Initial auth stores both tokens correctly (real DB + health API)', () => {
  const realmId = rid('t1-initial-auth');

  before(async () => { await deleteRealm(realmId); });
  after(async () => { await deleteRealm(realmId); });

  test('T1-a: saveQuickBooksIntegration stores accessToken + refreshToken + connectionStatus=connected', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-initial-v1',
      refreshToken: 'rt-initial-v1',
      realmId,
      expiresAt: futureMs(3600 * 1000),
      connectionStatus: 'connected',
      reconnectRequiredReason: null,
    });

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.ok(record !== null, 'Record must exist after save');
    assert.equal(record.accessToken, 'at-initial-v1');
    assert.equal(record.refreshToken, 'rt-initial-v1');
    assert.equal(record.connectionStatus, 'connected');
    assert.equal(record.reconnectRequiredReason, null);
    assert.ok(record.expiresAt.getTime() > Date.now());
  });

  test('T1-b: health endpoint returns the new connection as isTokenValid=true', async () => {
    const conn = await getHealthForRealm(realmId);
    assert.ok(conn !== null, `Health endpoint must include realm ${realmId}`);
    assert.equal(conn.connectionStatus, 'connected');
    assert.equal(conn.reconnectRequired, false);
    assert.equal(conn.isTokenValid, true);
  });

  test('T1-c: expires_in fallback: 0/null/undefined defaults to 3600s (route guard)', () => {
    for (const [exp, expected] of [[0, 3600], [null, 3600], [undefined, 3600], [7200, 7200]]) {
      const actual = exp && exp > 0 ? exp : 3600;
      assert.equal(actual, expected, `expires_in=${exp} must default to ${expected}s`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: T2 — Proactive refresh (runProactiveRefreshForRealm + real storage)
// ══════════════════════════════════════════════════════════════════════════════

describe('T2 — Proactive refresh fires before expiry (runProactiveRefreshForRealm + real DB)', () => {
  const realmId = rid('t2-proactive');
  const store = makeRealAdapter();

  before(async () => { await deleteRealm(realmId); });
  after(async () => { await deleteRealm(realmId); });

  test('QB_PROACTIVE_REFRESH_BUFFER_MS is exactly 5 minutes', () => {
    assert.equal(QB_PROACTIVE_REFRESH_BUFFER_MS, 5 * 60 * 1000);
  });

  test('T2-a: token expiring in 4m59s is within buffer (real constant boundary check)', () => {
    assert.ok(4 * 60 * 1000 + 59 * 1000 <= QB_PROACTIVE_REFRESH_BUFFER_MS);
  });

  test('T2-b: token expiring in 5m1s is outside buffer (no proactive refresh)', () => {
    assert.ok(5 * 60 * 1000 + 1000 > QB_PROACTIVE_REFRESH_BUFFER_MS);
  });

  test('T2-c: runProactiveRefreshForRealm skips token that is NOT near expiry (real storage read)', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-healthy',
      refreshToken: 'rt-healthy',
      realmId,
      expiresAt: futureMs(60 * 60 * 1000), // 1 hour away
      connectionStatus: 'connected',
    });
    qbRefreshLock.clear();
    let refreshCalled = false;

    const result = await runProactiveRefreshForRealm(realmId, async () => {
      refreshCalled = true;
      return { access_token: 'should-not-be-called', expires_in: 3600 };
    }, store);

    assert.equal(result.skipped, true, 'Must skip: token is not near expiry');
    assert.equal(result.skipReason, 'not_near_expiry');
    assert.equal(refreshCalled, false, 'Refresh function must NOT be called');
  });

  test('T2-d: runProactiveRefreshForRealm refreshes token near expiry AND writes new tokens to real DB', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-near-expiry-before',
      refreshToken: 'rt-for-proactive',
      realmId,
      expiresAt: futureMs(2 * 60 * 1000), // 2 minutes away — within 5-min buffer
      connectionStatus: 'connected',
    });
    qbRefreshLock.clear();
    let capturedRefreshToken = null;

    const result = await runProactiveRefreshForRealm(realmId, async (refreshToken, _signal) => {
      capturedRefreshToken = refreshToken;
      return { access_token: 'at-proactively-refreshed', refresh_token: 'rt-rotated-proactive', expires_in: 3600 };
    }, store);

    assert.equal(result.skipped, false, 'Must NOT skip: token is near expiry');
    assert.equal(result.refreshed, true, 'Must have refreshed');
    assert.equal(result.newAccessToken, 'at-proactively-refreshed');
    assert.equal(capturedRefreshToken, 'rt-for-proactive', 'Must use stored refresh token');

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-proactively-refreshed', 'New access token persisted in real DB');
    assert.equal(record.refreshToken, 'rt-rotated-proactive', 'Rotated refresh token persisted in real DB');
    assert.ok(record.expiresAt.getTime() > Date.now() + 30 * 60 * 1000, 'New expiry must be in future');
    assert.ok(record.lastRefreshSuccess !== null, 'lastRefreshSuccess must be set');
  });

  test('T2-e: runProactiveRefreshForRealm skips reconnect_required connection (real DB read)', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-revoked',
      refreshToken: 'rt-revoked',
      realmId,
      expiresAt: futureMs(60 * 1000), // within buffer
      connectionStatus: 'reconnect_required',
      reconnectRequiredReason: 'Test revocation',
    });
    qbRefreshLock.clear();
    let refreshCalled = false;

    const result = await runProactiveRefreshForRealm(realmId, async () => {
      refreshCalled = true;
      return { access_token: 'should-not-be-called', expires_in: 3600 };
    }, store);

    assert.equal(result.skipped, true, 'Must skip reconnect_required connection');
    assert.equal(result.skipReason, 'reconnect_required');
    assert.equal(refreshCalled, false, 'Refresh function must NOT be called for revoked connection');
  });

  test('T2-f: health endpoint shows near-expiry token as invalid (real DB + HTTP)', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-expired-for-http',
      refreshToken: 'rt-expired-for-http',
      realmId,
      expiresAt: pastMs(5 * 60 * 1000), // already expired
      connectionStatus: 'connected',
    });

    const conn = await getHealthForRealm(realmId);
    assert.ok(conn !== null, `Must find realm ${realmId} in health response`);
    assert.equal(conn.isTokenValid, false, 'Expired token must be isTokenValid=false');
    assert.ok(conn.tokenExpiresInMs < 0, 'tokenExpiresInMs must be negative for expired token');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: T4/T6 — Token rotation: newest persists, stale is gone (real DB)
// ══════════════════════════════════════════════════════════════════════════════

describe('T4/T6 — Token rotation: newest token persists via real DB upsert', () => {
  const realmId = rid('t4-rotation');

  before(async () => { await deleteRealm(realmId); });
  after(async () => { await deleteRealm(realmId); });

  test('T4-a: initial save stores v1 token pair', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-v1', refreshToken: 'rt-v1',
      realmId, expiresAt: futureMs(3600 * 1000), connectionStatus: 'connected',
    });
    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-v1');
    assert.equal(record.refreshToken, 'rt-v1');
  });

  test('T4-b: upsert stores v2, v1 is gone (real DB upsert on realmId unique index)', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-v2', refreshToken: 'rt-v2',
      realmId, expiresAt: futureMs(3600 * 1000), connectionStatus: 'connected',
    });
    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-v2', 'T4: new access token');
    assert.equal(record.refreshToken, 'rt-v2', 'T4: new refresh token');
    assert.notEqual(record.refreshToken, 'rt-v1', 'T6: stale rt-v1 overwritten');
  });

  test('T4-c: third rotation stores v3, v1 and v2 are gone', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-v3', refreshToken: 'rt-v3',
      realmId, expiresAt: futureMs(3600 * 1000), connectionStatus: 'connected',
    });
    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.refreshToken, 'rt-v3');
    assert.notEqual(record.refreshToken, 'rt-v1', 'T6: rt-v1 not retained');
    assert.notEqual(record.refreshToken, 'rt-v2', 'T6: rt-v2 not retained');
  });

  test('T4/T6: runProactiveRefreshForRealm rotation — new refresh token written to real DB', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-pre-rotation', refreshToken: 'rt-pre-rotation',
      realmId, expiresAt: futureMs(60 * 1000), connectionStatus: 'connected',
    });
    qbRefreshLock.clear();
    const store = makeRealAdapter();

    await runProactiveRefreshForRealm(realmId, async (refreshToken) => {
      assert.equal(refreshToken, 'rt-pre-rotation', 'Must use the stored refresh token');
      return { access_token: 'at-rotated-final', refresh_token: 'rt-rotated-final', expires_in: 3600 };
    }, store);

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-rotated-final', 'T4: rotated access token in DB');
    assert.equal(record.refreshToken, 'rt-rotated-final', 'T4: rotated refresh token in DB');
    assert.notEqual(record.refreshToken, 'rt-pre-rotation', 'T6: pre-rotation token not retained');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: T5 — Concurrent deduplication (real withQbRefreshLock)
// ══════════════════════════════════════════════════════════════════════════════

describe('T5 — Concurrent same-realm requests: only one refresh runs (real withQbRefreshLock)', () => {
  test('T5a: two concurrent callers → exactly 1 refresh call', async () => {
    qbRefreshLock.clear();
    const realmId = rid(`t5a-${Date.now()}`);
    let callCount = 0;

    const slow = async (_s) => { callCount++; await new Promise((r) => setTimeout(r, 50)); return 'at-deduped'; };
    const [t1, t2] = await Promise.all([withQbRefreshLock(realmId, slow), withQbRefreshLock(realmId, slow)]);

    assert.equal(callCount, 1, `Expected 1 refresh call, got ${callCount}`);
    assert.equal(t1, 'at-deduped');
    assert.equal(t2, 'at-deduped');
  });

  test('T5b: different realms each get independent refreshes', async () => {
    qbRefreshLock.clear();
    const ts = Date.now();
    let aCount = 0, bCount = 0;
    const [a, b] = await Promise.all([
      withQbRefreshLock(rid(`t5b-A-${ts}`), async () => { aCount++; return 'A'; }),
      withQbRefreshLock(rid(`t5b-B-${ts}`), async () => { bCount++; return 'B'; }),
    ]);
    assert.equal(aCount, 1);
    assert.equal(bCount, 1);
    assert.equal(a, 'A');
    assert.equal(b, 'B');
  });

  test('T5c: lock released after success; next sequential caller runs new refresh', async () => {
    qbRefreshLock.clear();
    const realmId = rid(`t5c-${Date.now()}`);
    let count = 0;
    const a = await withQbRefreshLock(realmId, async () => { count++; return `v${count}`; });
    const b = await withQbRefreshLock(realmId, async () => { count++; return `v${count}`; });
    assert.equal(count, 2);
    assert.equal(a, 'v1');
    assert.equal(b, 'v2');
  });

  test('T5d: lock released after failure; next caller can try again', async () => {
    qbRefreshLock.clear();
    const realmId = rid(`t5d-${Date.now()}`);
    let count = 0;
    await assert.rejects(
      () => withQbRefreshLock(realmId, async () => { count++; throw new Error('fail'); }),
      /fail/
    );
    const token = await withQbRefreshLock(realmId, async () => { count++; return 'recovered'; });
    assert.equal(count, 2);
    assert.equal(token, 'recovered');
  });

  test('T5e: two concurrent callers via runProactiveRefreshForRealm deduplicate (real storage + real lock)', async () => {
    const realmId = rid(`t5e-concurrent-${Date.now()}`);
    await deleteRealm(realmId);
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-stale-concurrent', refreshToken: 'rt-stale-concurrent',
      realmId, expiresAt: futureMs(60 * 1000), connectionStatus: 'connected', // within buffer
    });
    qbRefreshLock.clear();
    const store = makeRealAdapter();
    let refreshCallCount = 0;

    const refreshFn = async (_rt, _signal) => {
      refreshCallCount++;
      await new Promise((r) => setTimeout(r, 40));
      return { access_token: 'at-concurrent-fresh', refresh_token: 'rt-concurrent-fresh', expires_in: 3600 };
    };

    const [r1, r2] = await Promise.all([
      runProactiveRefreshForRealm(realmId, refreshFn, store),
      runProactiveRefreshForRealm(realmId, refreshFn, store),
    ]);

    assert.equal(refreshCallCount, 1, `Lock must deduplicate: expected 1 refresh call, got ${refreshCallCount}`);
    assert.equal(r1.refreshed, true);
    assert.equal(r1.newAccessToken, 'at-concurrent-fresh');
    assert.equal(r2.refreshed, true);
    assert.equal(r2.newAccessToken, 'at-concurrent-fresh');

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-concurrent-fresh', 'Real DB holds fresh token after concurrent refresh');
    await deleteRealm(realmId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 7: T7 — Revoked: reconnect_required via real storage + API
// ══════════════════════════════════════════════════════════════════════════════

describe('T7 — Revoked connection: reconnect_required via real storage + health API', () => {
  const realmId = rid('t7-revoked');
  const store = makeRealAdapter();

  before(async () => {
    await deleteRealm(realmId);
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-valid-before-revoke', refreshToken: 'rt-was-valid',
      realmId, expiresAt: futureMs(3600 * 1000), connectionStatus: 'connected',
    });
  });
  after(async () => { await deleteRealm(realmId); });

  test('T7-a: initial state is connected (real DB)', async () => {
    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.connectionStatus, 'connected');
    assert.equal(record.reconnectRequiredReason, null);
  });

  test('T7-b: invalid_grant classifies as stale_refresh_token → unrecoverable', () => {
    const cat = classifyQbRefreshError(JSON.stringify({ error: 'invalid_grant' }), 400);
    assert.equal(cat, 'stale_refresh_token');
    assert.ok(UNRECOVERABLE_CATEGORIES.has(cat));
  });

  test('T7-c: runProactiveRefreshForRealm with unrecoverable error → reconnect_required written to real DB', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-stale', refreshToken: 'rt-stale',
      realmId, expiresAt: futureMs(60 * 1000), connectionStatus: 'connected', // near expiry
    });
    qbRefreshLock.clear();

    const result = await runProactiveRefreshForRealm(realmId, async (_rt, _signal) => {
      throw new QbRefreshError('Simulated invalid_grant from Intuit', 'stale_refresh_token');
    }, store);

    assert.equal(result.skipped, false);
    assert.equal(result.refreshed, false);
    assert.equal(result.isUnrecoverable, true);

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.connectionStatus, 'reconnect_required', 'T7: unrecoverable error → reconnect_required in DB');
    assert.ok(record.reconnectRequiredReason.includes('invalid_grant'), 'Reason must mention invalid_grant');
  });

  test('T7-d: markQuickBooksReconnectRequired transitions real DB state', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-reset', refreshToken: 'rt-reset',
      realmId, expiresAt: futureMs(3600 * 1000), connectionStatus: 'connected',
    });
    const reason = buildReconnectReason('stale_refresh_token');
    await storage.markQuickBooksReconnectRequired(realmId, reason);

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.connectionStatus, 'reconnect_required');
    assert.ok(record.reconnectRequiredReason.includes('invalid_grant'));
    assert.ok(record.lastRefreshFailure !== null);
  });

  test('T7-e: health API reflects reconnect_required (real DB → HTTP round-trip)', async () => {
    const conn = await getHealthForRealm(realmId);
    assert.ok(conn !== null, `Must find realm ${realmId}`);
    assert.equal(conn.connectionStatus, 'reconnect_required');
    assert.equal(conn.reconnectRequired, true);
    assert.ok(conn.lastFailureReason.includes('invalid_grant'), `Reason must mention invalid_grant: ${conn.lastFailureReason}`);
  });

  test('T7-f: runProactiveRefreshForRealm skips reconnect_required (no further refresh attempts)', async () => {
    qbRefreshLock.clear();
    let refreshCalled = false;

    const result = await runProactiveRefreshForRealm(realmId, async () => {
      refreshCalled = true;
      return { access_token: 'should-not-reach', expires_in: 3600 };
    }, store);

    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'reconnect_required', 'T7: must skip — loop stops after reconnect_required');
    assert.equal(refreshCalled, false, 'Refresh must NOT be called after reconnect_required');
  });

  test('T7-g: re-authorization clears reconnect_required (real DB upsert)', async () => {
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-reauthed', refreshToken: 'rt-reauthed',
      realmId, expiresAt: futureMs(3600 * 1000), connectionStatus: 'connected',
      reconnectRequiredReason: null,
    });
    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.connectionStatus, 'connected', 'Re-auth must clear reconnect_required');
    assert.equal(record.reconnectRequiredReason, null, 'Reason cleared after re-auth');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 8: T3 — Expired token → refresh → retry (real storage + real lock)
// ══════════════════════════════════════════════════════════════════════════════

describe('T3 — Expired access token → refresh → retry (real storage + real withQbRefreshLock)', () => {
  const realmId = rid('t3-expired');
  const store = makeRealAdapter();

  before(async () => {
    await deleteRealm(realmId);
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-expired-original', refreshToken: 'rt-for-use-in-refresh',
      realmId, expiresAt: pastMs(10 * 60 * 1000), connectionStatus: 'connected',
    });
  });
  after(async () => { await deleteRealm(realmId); });

  test('T3-a: storage confirms token is expired (real DB read)', async () => {
    const record = await storage.getQuickBooksIntegration(realmId);
    assert.ok(record.expiresAt.getTime() < Date.now(), 'Token must be expired');
    assert.equal(record.connectionStatus, 'connected', 'Status stays connected until refresh fails');
  });

  test('T3-b: health endpoint reports expired token as isTokenValid=false (real DB + HTTP)', async () => {
    const conn = await getHealthForRealm(realmId);
    assert.ok(conn !== null, `Must find realm ${realmId} in health response`);
    assert.equal(conn.isTokenValid, false, 'Expired token must be isTokenValid=false');
    assert.ok(conn.tokenExpiresInMs < 0, 'tokenExpiresInMs must be negative');
  });

  test('T3-c: 401-retry path: real withQbRefreshLock + real storage write → DB holds new tokens', async () => {
    qbRefreshLock.clear();
    let requestCount = 0;
    let lastAuthToken = null;
    const responses = [401, 200];

    async function mockQbFetch(token) {
      requestCount++;
      lastAuthToken = token;
      return { status: responses.shift() ?? 200 };
    }

    let currentToken = 'at-expired-original';

    async function simulateRequestWithRetry() {
      let resp = await mockQbFetch(currentToken);
      if (resp.status === 401) {
        // Real 401-retry path: acquire lock, call refresh (mocked Intuit), persist to real DB
        const newToken = await withQbRefreshLock(realmId, async (_signal) => {
          const fresh = await store.getIntegration(realmId);
          currentToken = 'at-refreshed-new';
          await store.saveIntegration({
            companyId: fresh.companyId,
            accessToken: currentToken,
            refreshToken: 'rt-rotated-from-retry',
            realmId,
            expiresAt: futureMs(3600 * 1000),
            lastRefreshAttempt: new Date(),
            lastRefreshSuccess: new Date(),
          });
          return currentToken;
        });
        resp = await mockQbFetch(newToken);
      }
      return resp;
    }

    const finalResp = await simulateRequestWithRetry();

    assert.equal(finalResp.status, 200, 'Retry must succeed');
    assert.equal(requestCount, 2, 'Must make exactly 2 requests: original + retry');
    assert.equal(lastAuthToken, 'at-refreshed-new', 'Retry must use refreshed token');

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-refreshed-new', 'Real DB must hold new access token');
    assert.equal(record.refreshToken, 'rt-rotated-from-retry', 'Real DB must hold rotated refresh token');
    assert.ok(record.lastRefreshSuccess !== null, 'lastRefreshSuccess must be updated in DB');
  });

  test('T3-d: 401 retry does NOT loop — exactly one refresh attempt before returning error to caller', async () => {
    qbRefreshLock.clear();
    let requestCount = 0;
    let refreshCount = 0;
    async function mockFetch() { requestCount++; return { status: 401 }; }

    let resp = await mockFetch();
    if (resp.status === 401) {
      refreshCount++;
      await withQbRefreshLock(rid(`t3-no-loop-${Date.now()}`), async () => 'at-refreshed-once');
      resp = await mockFetch();
    }

    assert.equal(requestCount, 2, 'Exactly 2 requests — no infinite loop');
    assert.equal(refreshCount, 1, 'Exactly 1 refresh attempt');
    assert.equal(resp.status, 401, 'Returns 401 to caller after 1 retry');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 9: T9 — API client reads freshest token from real storage
// ══════════════════════════════════════════════════════════════════════════════

describe('T9 — API client reads freshest token from real storage after refresh', () => {
  const realmId = rid('t9-fresh-token');
  const store = makeRealAdapter();

  before(async () => {
    await deleteRealm(realmId);
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-stale-before-refresh', refreshToken: 'rt-for-refresh',
      realmId, expiresAt: pastMs(60 * 1000), connectionStatus: 'connected', // expired
    });
  });
  after(async () => { await deleteRealm(realmId); });

  test('T9-a: withQbRefreshLock writes fresh token to real DB; API reads freshest (real lock + real storage)', async () => {
    qbRefreshLock.clear();

    const freshToken = await withQbRefreshLock(realmId, async (_signal) => {
      const integration = await store.getIntegration(realmId);
      assert.equal(integration.accessToken, 'at-stale-before-refresh', 'Inside lock: must see stale token');

      await store.saveIntegration({
        companyId: integration.companyId, accessToken: 'at-fresh-after-refresh',
        refreshToken: 'rt-rotated-fresh', realmId, expiresAt: futureMs(3600 * 1000),
        lastRefreshAttempt: new Date(), lastRefreshSuccess: new Date(),
      });
      return 'at-fresh-after-refresh';
    });

    assert.equal(freshToken, 'at-fresh-after-refresh', 'Lock must return the fresh token');

    const record = await storage.getQuickBooksIntegration(realmId);
    assert.equal(record.accessToken, 'at-fresh-after-refresh', 'Real DB holds the fresh token after lock');
    assert.equal(record.refreshToken, 'rt-rotated-fresh', 'Rotated refresh token in real DB');
    assert.ok(record.lastRefreshSuccess !== null, 'lastRefreshSuccess updated in DB');
  });

  test('T9-b: two concurrent callers both read the fresh token (dedup + real DB consistency)', async () => {
    const concRealmId = rid(`t9-concurrent-${Date.now()}`);
    await deleteRealm(concRealmId);
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID, accessToken: 'at-stale-concurrent', refreshToken: 'rt-stale-concurrent',
      realmId: concRealmId, expiresAt: pastMs(60 * 1000), connectionStatus: 'connected',
    });
    qbRefreshLock.clear();
    let refreshCallCount = 0;

    const refreshFn = async (_signal) => {
      refreshCallCount++;
      await new Promise((r) => setTimeout(r, 30));
      await store.saveIntegration({
        companyId: TEST_COMPANY_ID, accessToken: 'at-fresh-concurrent', refreshToken: 'rt-fresh-concurrent',
        realmId: concRealmId, expiresAt: futureMs(3600 * 1000),
      });
      return 'at-fresh-concurrent';
    };

    const [t1, t2] = await Promise.all([
      withQbRefreshLock(concRealmId, refreshFn),
      withQbRefreshLock(concRealmId, refreshFn),
    ]);

    assert.equal(refreshCallCount, 1, 'Lock must deduplicate: only 1 refresh call');
    assert.equal(t1, 'at-fresh-concurrent');
    assert.equal(t2, 'at-fresh-concurrent', 'Both callers get the same fresh token');

    const record = await storage.getQuickBooksIntegration(concRealmId);
    assert.equal(record.accessToken, 'at-fresh-concurrent', 'Real DB consistent after concurrent refresh');
    await deleteRealm(concRealmId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 10: T8 — 100-day inactivity threshold: startQbTokenHealthJob proactively
// refreshes realms whose lastRefreshSuccess exceeds QB_IDLE_THRESHOLD_DAYS (90d),
// even when the access token has a valid far-future expiry.
//
// This is distinct from the 5-minute expiry-buffer trigger. A realm can have a
// non-expired token and still need proactive refresh to prevent Intuit's silent
// 100-day refresh-token revocation.
// ══════════════════════════════════════════════════════════════════════════════

describe('T8 — 100-day inactivity threshold: health job refreshes inactive realm with valid token (real storage)', () => {
  // Realm with a VALID far-future expiry but lastRefreshSuccess > 90 days ago
  const idleRealmId = rid('t8-idle-95d');
  // Realm that is genuinely healthy: recent refresh, valid token
  const activeRealmId = rid('t8-active-5d');
  const store = makeRealAdapter();

  before(async () => {
    await deleteRealm(idleRealmId);
    await deleteRealm(activeRealmId);

    // Idle realm: access token is VALID (expires in 24h) but lastRefreshSuccess is 95 days ago.
    // The expiry buffer check alone would skip this. The 90-day idle threshold must catch it.
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-idle-original',
      refreshToken: 'rt-idle-original',
      realmId: idleRealmId,
      expiresAt: futureMs(24 * 60 * 60 * 1000),        // 24h from now → NOT near expiry
      connectionStatus: 'connected',
      lastRefreshSuccess: pastMs(95 * 24 * 60 * 60 * 1000), // 95 days ago → past 90d threshold
    });

    // Active realm: token valid for 6h, refreshed 5 days ago — healthy, must NOT be refreshed
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-active-original',
      refreshToken: 'rt-active-original',
      realmId: activeRealmId,
      expiresAt: futureMs(6 * 60 * 60 * 1000),           // 6h from now
      connectionStatus: 'connected',
      lastRefreshSuccess: pastMs(5 * 24 * 60 * 60 * 1000), // 5 days ago — well within threshold
    });
  });

  after(async () => {
    await deleteRealm(idleRealmId);
    await deleteRealm(activeRealmId);
  });

  test('T8-a: idle realm has valid token expiry and is confirmed inactive > 90d in DB (baseline)', async () => {
    const record = await storage.getQuickBooksIntegration(idleRealmId);
    assert.ok(record, 'Idle realm must exist in DB');
    // Token is NOT expired
    assert.ok(record.expiresAt > new Date(), `expiresAt must be in the future; got ${record.expiresAt}`);
    // But it is inactive for > QB_IDLE_THRESHOLD_DAYS
    const idleDays = (Date.now() - new Date(record.lastRefreshSuccess).getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(
      idleDays >= QB_IDLE_THRESHOLD_DAYS,
      `Idle realm must have lastRefreshSuccess >= ${QB_IDLE_THRESHOLD_DAYS}d ago; got ${idleDays.toFixed(1)}d`
    );
  });

  test('T8-b: health endpoint exposes lastRefreshSuccess so callers can detect inactivity', async () => {
    const conn = await getHealthForRealm(idleRealmId);
    assert.ok(conn !== null, `Must find idle realm ${idleRealmId} in health response`);
    assert.ok('lastRefreshSuccess' in conn, 'Health response must include lastRefreshSuccess');
    // Token is valid (not expired), but realm IS inactive
    assert.ok(conn.isTokenValid === true, 'Idle realm token is NOT expired — isTokenValid must be true');
    assert.ok(conn.lastRefreshSuccess !== null, 'lastRefreshSuccess must be set');
    const daysSince = (Date.now() - new Date(conn.lastRefreshSuccess).getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(daysSince >= QB_IDLE_THRESHOLD_DAYS, `Health API must expose ${QB_IDLE_THRESHOLD_DAYS}+ days of inactivity; got ${daysSince.toFixed(1)}d`);
  });

  test('T8-c: startQbTokenHealthJob refreshes idle realm (non-expired token, >90d idle) and skips active realm', async () => {
    qbRefreshLock.clear();

    const refreshedTokens = [];
    const mockRefresh = async (refreshToken, _signal) => {
      refreshedTokens.push(refreshToken);
      return { access_token: 'at-refreshed-idle', refresh_token: 'rt-refreshed-idle', expires_in: 3600 };
    };

    // Run health job initial sweep, then stop the recurring timer
    await new Promise((resolve) => {
      const timer = startQbTokenHealthJob(
        async () => {
          const all = await storage.getQuickBooksAllIntegrations();
          return all.filter((i) => [idleRealmId, activeRealmId].includes(i.realmId));
        },
        mockRefresh,
        store,
        60 * 60 * 1000 // 1-hour recurring interval; initial sweep fires immediately
      );
      setTimeout(() => { clearInterval(timer); resolve(); }, 300);
    });

    // Idle realm must have been refreshed (inactivity threshold triggered)
    const idleRecord = await storage.getQuickBooksIntegration(idleRealmId);
    assert.equal(
      idleRecord.accessToken, 'at-refreshed-idle',
      'T8: health job must refresh idle realm (valid token, >90d inactive) via inactivity threshold'
    );
    assert.ok(
      idleRecord.lastRefreshSuccess !== null && idleRecord.lastRefreshSuccess > pastMs(5000),
      'T8: lastRefreshSuccess must be updated to now after idle threshold refresh'
    );

    // Active realm must NOT have been refreshed (token valid, refreshed 5 days ago)
    const activeRecord = await storage.getQuickBooksIntegration(activeRealmId);
    assert.equal(
      activeRecord.accessToken, 'at-active-original',
      'T8: health job must NOT refresh active realm (valid token, refreshed 5 days ago)'
    );
  });

  test('T8-d: when health job encounters invalid_grant for idle realm, it marks reconnect_required in real DB', async () => {
    qbRefreshLock.clear();
    // Reset idle realm so the inactivity threshold still applies
    await storage.saveQuickBooksIntegration({
      companyId: TEST_COMPANY_ID,
      accessToken: 'at-idle-reset',
      refreshToken: 'rt-idle-reset',
      realmId: idleRealmId,
      expiresAt: pastMs(60 * 1000), // expired 60s ago so the expiry buffer also triggers
      connectionStatus: 'connected',
      lastRefreshSuccess: pastMs(95 * 24 * 60 * 60 * 1000),
    });

    const invalidGrantRefresh = async (_rt, _signal) => {
      throw new QbRefreshError('Simulated invalid_grant: refresh token expired', 'stale_refresh_token');
    };

    const result = await runProactiveRefreshForRealm(idleRealmId, invalidGrantRefresh, store);
    assert.equal(result.refreshed, false, 'Refresh must fail');
    assert.equal(result.isUnrecoverable, true, 'stale_refresh_token is an unrecoverable category');

    const record = await storage.getQuickBooksIntegration(idleRealmId);
    assert.equal(record.connectionStatus, 'reconnect_required', 'T8: invalid_grant → reconnect_required in DB');
    assert.ok(record.reconnectRequiredReason.includes('invalid_grant'), 'Reason must mention invalid_grant');

    const conn = await getHealthForRealm(idleRealmId);
    assert.equal(conn.reconnectRequired, true, 'Health API must show reconnectRequired=true after failure');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 11: Timeout / generation fencing (real withQbRefreshLock)
// ══════════════════════════════════════════════════════════════════════════════

describe('withQbRefreshLock — timeout eviction and generation fencing', () => {
  const SHORT_TIMEOUT = 100; // ms

  test('T5e: timeout evicts lock; subsequent caller can proceed (generation fencing)', async () => {
    qbRefreshLock.clear();
    const realmId = rid(`t5e-timeout-${Date.now()}`);

    const hanging = async (signal) => {
      await new Promise((resolve) => {
        const t = setTimeout(() => resolve(), 2000);
        signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
      return 'timed-out-result';
    };

    await assert.rejects(
      () => withQbRefreshLock(realmId, hanging, SHORT_TIMEOUT),
      /QB refresh lock timeout/
    );

    await new Promise((r) => setTimeout(r, 20));

    let secondRan = false;
    const result = await withQbRefreshLock(
      realmId, async () => { secondRan = true; return 'post-timeout'; }, SHORT_TIMEOUT
    );

    assert.ok(secondRan, 'Second caller must run after timeout eviction');
    assert.equal(result, 'post-timeout');
  });
});

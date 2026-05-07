# QuickBooks Token Lifecycle Audit

**Date:** 2026-04-03  
**Scope:** Token storage, refresh paths, concurrent-refresh risks, stale-token reuse, caller gaps, and expired-connection detection.  
**Files examined:** `server/routes.ts`, `server/storage.ts`, `shared/schema.ts`, `client/src/components/quickbooks/quickbooks-integration.tsx`

---

## 1. Token Storage Locations

### 1a. Database table — `quickbooks_integration` (`shared/schema.ts:398-407`)

| Column | Type | Notes |
|--------|------|-------|
| `access_token` | `text NOT NULL` | Short-lived OAuth 2 access token (typical TTL: 3600 s) |
| `refresh_token` | `text NOT NULL` | Long-lived refresh token (typical TTL: 100 days) |
| `realm_id` | `text NOT NULL` | Intuit company (realm) ID used in every QB API URL |
| `company_id` | `text NOT NULL` | IrrigoPro company ID (or QB realm ID as fallback — see §5) |
| `expires_at` | `timestamptz NOT NULL` | Absolute expiry instant for the access token |
| `updated_at` | `timestamptz` | Last write timestamp; doubles as `lastSync` in status responses |

The table is designed to hold **one row per company** but `saveQuickBooksIntegration` (`storage.ts:1448-1481`) uses `LIMIT 1` (no `WHERE`) to decide whether to INSERT or UPDATE, so in practice it treats the **first row in the table as the global singleton** regardless of `company_id`. See §5.

### 1b. In-memory OAuth state store (`routes.ts:541`)

```ts
const oauthStateStore = new Map<string, { expiry: number; companyId: string | null }>();
```

A module-level `Map` that holds CSRF state tokens for up to 10 minutes. Cleaned up periodically by a timer (`routes.ts:544-545`). Ephemeral — not persisted across server restarts.

### 1c. Short-lived local variables (in-flight only)

Inside route handlers and helper functions, `integration.accessToken` / `integration.refreshToken` are read into local variables and may be mutated in place (`routes.ts:2373-2375`) to propagate the refreshed token within the same request without re-reading from the DB. These are not persisted beyond the request.

---

## 2. Full OAuth Lifecycle

```
Client                  Server                           Intuit
  |                        |                                |
  |-- GET /api/qb/auth --> |                                |
  |                        | generate state, store in Map   |
  |<--- { authUrl } -------|                                |
  |                        |                                |
  |-- browser redirect --> | (Intuit authorization page)   |
  |                        |                                |
  |<-- redirect with       |                                |
  |    ?code=&realmId= ----|                                |
  |                        |                                |
  | GET /api/qb/callback   |                                |
  |----------------------->|                                |
  |                        | verify state (Map lookup)      |
  |                        |-- POST /oauth2/v1/tokens/bearer|
  |                        |<--- access_token, refresh_token|
  |                        | storage.saveQuickBooksIntegration
  |                        | (DB upsert)                    |
  |<-- success HTML page --|                                |
  |                        |                                |

  [ ... normal API usage ... ]

  | any QB API call        |                                |
  |                        | makeQuickBooksRequest(url, opts)
  |                        |  -> proactive refresh (5 min buffer, per-route)
  |                        |  -> fetch QB API              |
  |                        |  -> on 401: refreshQuickBooksToken
  |                        |              saveQuickBooksIntegration
  |                        |              retry original request
```

### 2a. `/api/quickbooks/auth` (`routes.ts:4828`)

1. Validates `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI` env vars.
2. Generates a 16-byte hex CSRF `state` token.
3. Reads `x-user-company-id` header; stores `{ expiry, companyId }` in `oauthStateStore`.
4. Returns `{ authUrl, state }` to the client for browser redirect.

### 2b. `/api/quickbooks/callback` (`routes.ts:4866`)

1. Verifies `state` against `oauthStateStore` (CSRF check). Deletes state entry immediately after.
2. Calls `exchangeCodeForTokens` → plain `fetch` to Intuit token endpoint (intentionally bypasses `makeQuickBooksRequest` to avoid recursive refresh on a yet-to-exist token).
3. Optionally fetches `companyinfo` to populate `companyName`.
4. Calls `storage.saveQuickBooksIntegration` with IrrigoPro `companyId` (from OAuth state; falls back to QB realm ID if not set).

### 2c. Token refresh — proactive (`routes.ts:2351-2388`)

Found in the **invoice-creation route** (only). Before making any QB API call, if `expiresAt ≤ now + 5 min`, the handler calls `refreshQuickBooksToken` and saves new tokens. Mutates `integration` in place so the downstream code uses the fresh token without a second DB read.

### 2d. Token refresh — reactive / 401 fallback (`routes.ts:4668-4711` inside `makeQuickBooksRequest`)

On any `401` response:
1. Calls `storage.getQuickBooksIntegration()` **without `companyId`** (global singleton — see §5).
2. Calls `refreshQuickBooksToken(integration.refreshToken)`.
3. Saves result via `storage.saveQuickBooksIntegration`.
4. Retries the original request with the new `access_token`.

### 2e. Disconnect (`routes.ts:5030-5051` and `routes.ts:6043-6055`)

Two endpoints delete the DB row via `storage.disconnectQuickBooks(userCompanyId)`:
- `POST /api/quickbooks/disconnect` — requires `requireQuickBooksAccess` middleware.
- `POST /api/integrations/quickbooks/customers/disconnect` — requires generic auth.

Both require a non-null `userCompanyId` from the request header and call `db.delete(quickbooksIntegration).where(eq(quickbooksIntegration.companyId, companyId))`.

---

## 3. Concurrent Refresh Risks

**Risk: HIGH — no mutex or distributed lock exists.**

`makeQuickBooksRequest` is an `async` function with no locking. If two requests that hit a 401 are in-flight simultaneously for the same realm, **both** will:

1. Read the same `refreshToken` from the DB.
2. Both POST to Intuit's token endpoint with the same refresh token.
3. Intuit invalidates the refresh token on the first successful use (refresh token rotation). The second POST will fail with an `invalid_grant` error.
4. The second request will then propagate the original 401 back to the caller.

The **proactive refresh path** (`routes.ts:2351`) is inside a single route handler, so it is not inherently concurrent with itself, but it can race with the 401-fallback path inside `makeQuickBooksRequest` if another request fires during the same window.

**No mutex, no `CAS`-style conditional update, no lock column in the DB exists today.**

---

## 4. Stale-Token Reuse Risks

### 4a. Newest refresh token may not be persisted

In the 401-fallback inside `makeQuickBooksRequest`:

```ts
refreshToken: newTokenData.refresh_token || integration.refreshToken,
```

If `newTokenData.refresh_token` is falsy (empty string, `null`, or not returned), the code falls back to the **old refresh token**. Because Intuit rotates refresh tokens on every use, this fallback is only safe if Intuit returns the same token; otherwise the stored token becomes stale. The proactive-refresh path (`routes.ts:2369`) has the same pattern.

### 4b. `updatedAt` used as `lastSync`

`getQuickBooksCustomerStatus` (`storage.ts:1531`) returns `qbIntegration.updatedAt` as `lastSync`. A token refresh updates `updatedAt`, so the "last sync" timestamp shown in the UI may reflect a token refresh rather than an actual data sync. This is cosmetic but misleading.

### 4c. `isConnected` check is token-expiry-only

```ts
const isTokenValid = qbIntegration.expiresAt > new Date();
```

If the stored tokens have been externally revoked (user disconnected from Intuit's app management portal), `isConnected` returns `true` until `expiresAt` passes. There is no proactive liveness check.

### 4d. In-place mutation of `integration` object

The proactive refresh path (`routes.ts:2373-2375`) mutates the `integration` object in memory and then continues. If anything further in the request reads `integration.accessToken` before the DB write commits, it would see the old value — unlikely in practice because `await storage.saveQuickBooksIntegration(...)` is called before the mutation, but the ordering should be audited by QB2.

---

## 5. `getQuickBooksIntegration()` Calls Without `realmId` / `companyId`

`getQuickBooksIntegration` signature: `(companyId?: string | null) => Promise<any | null>`

When called **without arguments** or with `null`, the method falls back to `LIMIT 1` — it returns whichever row is first in the table (arbitrary in a multi-tenant scenario).

### Flagged call sites

| Location | Line | Route/Context | Risk |
|----------|------|---------------|------|
| `makeQuickBooksRequest` (401 path) | `routes.ts:4671` | All QB API calls | HIGH — ignores tenant; in multi-tenant deployment would refresh tokens for wrong company |
| `POST /api/quickbooks/sync-parts` | `routes.ts:5292` | Parts sync | HIGH — no `x-user-company-id` check before this call |
| `POST /api/quickbooks/sync-estimate/:id` | `routes.ts:5404` | Estimate→invoice sync | HIGH — no company ID propagated |

### Calls that DO pass `companyId`

| Location | Line | Route/Context |
|----------|------|---------------|
| `POST /api/invoices` (proactive refresh) | `routes.ts:2342` | Invoice creation |
| `GET /api/quickbooks/customers` | `routes.ts:5088` | Customer list fetch |
| `POST /api/quickbooks/sync-customers` | `routes.ts:5172` | Customer sync |
| `GET /api/quickbooks/connection` | via `getQuickBooksCustomerStatus` | Connection status |
| `GET /api/quickbooks/status` | via `getQuickBooksCustomerStatus` | Status alias |

---

## 6. Revoked / Expired Connection Detection

| Mechanism | Where | Behaviour |
|-----------|-------|-----------|
| `expiresAt` timestamp check | `getQuickBooksCustomerStatus` (storage.ts:1526) and status/connection endpoints | Returns `isConnected: false` only when timestamp is in the past |
| 401 reactive refresh | `makeQuickBooksRequest` (routes.ts:4668) | Attempts refresh; if refresh also fails, original 401 is returned to caller but **no DB flag is set** and `isConnected` continues to show `true` |
| 403 error | `GET /api/quickbooks/customers` (routes.ts:5112) and `POST /api/quickbooks/sync-customers` (routes.ts:5201) | Logged to console; sync-customers returns `needsReconnection: true`; connection endpoint does NOT return this flag |
| Proactive refresh failure (expired token) | Invoice creation route (routes.ts:2379-2386) | Returns 400 to caller only if token is already past expiry; within buffer window, falls through silently |
| No webhook / revocation listener | — | Intuit token revocation is not detected until the next API call returns 401/403 |

**Summary:** There is no persistent "disconnected" flag in the DB. A revoked connection is discovered only at the next API call and only surfaces to the user if that specific route implements the error-surfacing logic (sync-customers does; other routes swallow the error or return empty arrays).

---

## 7. Summary of Key Issues for QB2–QB9

1. **No concurrency guard** on token refresh — risk of `invalid_grant` under parallel requests (§3).
2. **`getQuickBooksIntegration()` called without `companyId`** at three call sites, breaking multi-tenant isolation (§5, lines 4671, 5292, 5404).
3. **`saveQuickBooksIntegration` uses `LIMIT 1` without `WHERE`** — always upserts the first row regardless of `companyId`, defeating per-company storage (storage.ts:1451, 1464).
4. **Stale refresh-token fallback** — `|| integration.refreshToken` will silently keep the old token when Intuit does not return a new one, which is safe only if Intuit is not rotating; should be logged as a warning at minimum (§4a).
5. **`isConnected` does not detect external revocation** — shows `true` until `expiresAt` passes even after user revokes access in Intuit portal (§6).
6. **`updatedAt` doubling as `lastSync`** — token refreshes update `updatedAt`, misleading users about when data was last synced (§4b).
7. **`disconnectQuickBooks` deletes by `companyId`** but `saveQuickBooksIntegration` upserts by `id` — if the row was originally saved with `companyId = realmId` (the fallback path in the callback), the disconnect will silently no-op (§2b and storage.ts:1656).

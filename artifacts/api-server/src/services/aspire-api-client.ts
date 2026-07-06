// =============================================================================
// ASPIRE API CLIENT
// =============================================================================
//
// HTTP client for the Aspire landscape-management CRM API. Owns the full
// token lifecycle:
//   1. In-memory cache check (5-minute safety buffer before expiry)
//   2. DB-persisted token check (decrypt via aspire-token-service)
//   3. Fresh client-credentials handshake if needed
//   4. Per-tenant async mutex so concurrent requests never double-refresh
//
// Guardrails enforced here:
//   • Raw bearer tokens are NEVER logged — only safe metadata (companyId,
//     expiresAt, HTTP status codes) appears in log lines.
//   • Decrypted tokens exist in memory only for the duration of the call;
//     they are never stored in any durable state other than via saveAccessToken()
//     which re-encrypts before DB write.
//   • throttleUntil is checked before every outbound call; requests are
//     rejected locally while a backoff window is active.
//   • 401 triggers exactly one refresh + retry. A second 401 marks
//     connectionStatus='reconnect_required' and throws.
//   • 403 marks connectionStatus='error' with a human-readable message.
// =============================================================================

import { eq } from "drizzle-orm";
import { db } from "../db";
import { aspireCredentials } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  _internalGetDecryptedCredentials,
  saveAccessToken,
  markConnectionError,
  getDecryptedAccessToken,
} from "./aspire-token-service";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** 5-minute safety buffer: refresh the token before it actually expires. */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1_000;

/** Timeout for any single HTTP call to Aspire (30 s). */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Aspire API base URL. Injected via ASPIRE_BASE_URL env var.
 * Defaults to the known production endpoint.
 */
function getBaseUrl(): string {
  return (
    process.env.ASPIRE_BASE_URL?.replace(/\/$/, "") ??
    "https://api.youraspireapp.com"
  );
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class AspireApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly companyId: number,
  ) {
    super(message);
    this.name = "AspireApiError";
  }
}

export class AspireThrottleError extends Error {
  constructor(
    public readonly companyId: number,
    public readonly throttleUntil: Date,
  ) {
    super(
      `[aspire-api-client] Aspire API is throttled for companyId=${companyId} until ${throttleUntil.toISOString()}`,
    );
    this.name = "AspireThrottleError";
  }
}

export class AspireCredentialsMissingError extends Error {
  constructor(public readonly companyId: number) {
    super(
      `[aspire-api-client] No Aspire credentials stored for companyId=${companyId}`,
    );
    this.name = "AspireCredentialsMissingError";
  }
}

// ---------------------------------------------------------------------------
// In-memory token cache
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: Date;
}

/**
 * Process-local token cache keyed by companyId. Avoids a DB round-trip on
 * every request when the token is still fresh. Cleared on refresh or error.
 *
 * SECURITY: this Map holds decrypted bearer tokens in memory. It is process-
 * scoped and never serialised to any durable store.
 */
const tokenCache = new Map<number, CachedToken>();

function getCachedToken(companyId: number): string | null {
  const entry = tokenCache.get(companyId);
  if (!entry) return null;
  const bufferMs = TOKEN_REFRESH_BUFFER_MS;
  if (Date.now() + bufferMs >= entry.expiresAt.getTime()) {
    // Within the safety buffer — evict and force a refresh.
    tokenCache.delete(companyId);
    return null;
  }
  return entry.token;
}

function setCachedToken(companyId: number, token: string, expiresAt: Date): void {
  tokenCache.set(companyId, { token, expiresAt });
}

function evictCachedToken(companyId: number): void {
  tokenCache.delete(companyId);
}

// ---------------------------------------------------------------------------
// Per-tenant async mutex
// ---------------------------------------------------------------------------
//
// Two concurrent requests for the same companyId can both detect a stale token
// and race to refresh it, hammering the Aspire /Authorization endpoint. The
// mutex serialises that work: the second waiter joins the first caller's
// in-flight refresh promise instead of starting its own.

interface MutexEntry {
  promise: Promise<string>;
}

const refreshMutex = new Map<number, MutexEntry>();

/**
 * Runs `doRefresh` under a per-companyId mutex. If a refresh is already
 * in-flight for this company, subsequent callers await the same promise.
 */
async function withRefreshMutex(
  companyId: number,
  doRefresh: () => Promise<string>,
): Promise<string> {
  const existing = refreshMutex.get(companyId);
  if (existing) {
    logger.debug(
      { companyId },
      "[aspire-api-client] Joining in-flight token refresh (mutex held)",
    );
    return existing.promise;
  }

  const promise = doRefresh().finally(() => {
    refreshMutex.delete(companyId);
  });

  refreshMutex.set(companyId, { promise });
  return promise;
}

// ---------------------------------------------------------------------------
// Token acquisition
// ---------------------------------------------------------------------------

/**
 * Returns a valid decrypted bearer token for `companyId`, refreshing if needed.
 *
 * Order of operations:
 *   1. In-memory cache (fast path — no DB, no network)
 *   2. DB-persisted token (decrypted via token service — no network)
 *   3. Fresh client-credentials handshake with Aspire (network call)
 *
 * Only step 3 is serialised by the mutex; steps 1–2 are lock-free reads.
 */
export async function getOrRefreshToken(companyId: number): Promise<string> {
  // 1. In-memory cache
  const cached = getCachedToken(companyId);
  if (cached) {
    return cached;
  }

  // 2. DB-persisted token
  const persisted = await getDecryptedAccessToken(companyId);
  if (persisted) {
    const msUntilExpiry = persisted.expiresAt.getTime() - Date.now();
    if (msUntilExpiry > TOKEN_REFRESH_BUFFER_MS) {
      // Still fresh — populate the in-memory cache and return.
      setCachedToken(companyId, persisted.accessToken, persisted.expiresAt);
      return persisted.accessToken;
    }
  }

  // 3. Fresh handshake — serialised per company
  return withRefreshMutex(companyId, async () => {
    // Re-check cache inside the mutex in case another waiter already refreshed.
    const recheck = getCachedToken(companyId);
    if (recheck) return recheck;

    return fetchFreshToken(companyId);
  });
}

/**
 * Performs the actual client-credentials POST to Aspire's /Authorization endpoint.
 * Re-encrypts the received token via saveAccessToken() before returning it.
 *
 * Never logs the token value — only safe metadata (companyId, expiresAt).
 */
async function fetchFreshToken(companyId: number): Promise<string> {
  const creds = await _internalGetDecryptedCredentials(companyId);
  if (!creds) {
    throw new AspireCredentialsMissingError(companyId);
  }

  const url = `${getBaseUrl()}/Authorization`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  logger.info({ companyId }, "[aspire-api-client] Requesting fresh token from Aspire");

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Sanitise: the body string contains credentials — never log it.
    logger.error(
      { companyId, error: msg },
      "[aspire-api-client] Network error during token fetch",
    );
    throw new Error(
      `[aspire-api-client] Token fetch failed (network): ${msg}`,
    );
  }

  if (!resp.ok) {
    const status = resp.status;
    logger.warn(
      { companyId, status },
      "[aspire-api-client] Token fetch returned non-2xx",
    );
    const errorText = await resp.text().catch(() => "(unreadable)");
    await markConnectionError(
      companyId,
      `Aspire token exchange failed (HTTP ${status})`,
    );
    throw new AspireApiError(
      `[aspire-api-client] Token fetch failed: HTTP ${status}`,
      status,
      companyId,
    );
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = (await resp.json()) as typeof json;
  } catch {
    throw new Error(
      "[aspire-api-client] Token endpoint returned non-JSON response",
    );
  }

  if (!json.access_token) {
    throw new Error(
      "[aspire-api-client] Token endpoint response missing access_token field",
    );
  }

  const expiresInSec = typeof json.expires_in === "number" && json.expires_in > 0
    ? json.expires_in
    : 3_600; // default 1 hour if not provided

  const expiresAt = new Date(Date.now() + expiresInSec * 1_000);

  // Persist re-encrypted — the raw token is gone after this scope.
  await saveAccessToken(companyId, json.access_token, expiresAt);
  setCachedToken(companyId, json.access_token, expiresAt);

  logger.info(
    { companyId, expiresAt },
    "[aspire-api-client] Fresh token acquired and persisted",
  );

  return json.access_token;
}

// ---------------------------------------------------------------------------
// Throttle guard
// ---------------------------------------------------------------------------

async function checkThrottle(companyId: number): Promise<void> {
  const rows = await db
    .select({ throttleUntil: aspireCredentials.throttleUntil })
    .from(aspireCredentials)
    .where(eq(aspireCredentials.companyId, companyId))
    .limit(1);

  if (rows.length === 0) return;
  const { throttleUntil } = rows[0];
  if (throttleUntil && throttleUntil > new Date()) {
    throw new AspireThrottleError(companyId, throttleUntil);
  }
}

// ---------------------------------------------------------------------------
// General-purpose request
// ---------------------------------------------------------------------------

/**
 * Makes an authenticated HTTP request to the Aspire API.
 *
 * - Fetches a valid token via getOrRefreshToken().
 * - On 401: performs exactly one token refresh + retry. Second 401 marks
 *   connectionStatus='reconnect_required' and throws.
 * - On 403: marks connectionStatus='error' with a human-readable message
 *   and throws.
 * - On 429: stores throttleUntil from the Retry-After header and throws.
 * - On other non-2xx: throws AspireApiError.
 *
 * @param companyId  IrrigoPro company ID (used for auth + scoping)
 * @param method     HTTP method (GET, POST, PATCH, etc.)
 * @param path       API path relative to base URL (e.g. "/Customers")
 * @param body       Optional request body (serialised as JSON)
 */
export async function request<T = unknown>(
  companyId: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  await checkThrottle(companyId);

  const token = await getOrRefreshToken(companyId);
  const result = await executeRequest<T>(companyId, method, path, token, body);

  // If we got a 401, attempt exactly one refresh + retry.
  if (result.status === 401) {
    logger.warn(
      { companyId, path, method },
      "[aspire-api-client] 401 received — evicting cache and refreshing token",
    );
    evictCachedToken(companyId);

    let freshToken: string;
    try {
      freshToken = await withRefreshMutex(companyId, () => fetchFreshToken(companyId));
    } catch (err) {
      await markReconnectRequired(companyId, "Token refresh failed after 401");
      throw err;
    }

    const retry = await executeRequest<T>(companyId, method, path, freshToken, body);
    if (retry.status === 401) {
      await markReconnectRequired(
        companyId,
        "Aspire returned 401 after token refresh — credentials may be revoked",
      );
      throw new AspireApiError(
        `[aspire-api-client] 401 after refresh for ${method} ${path} — reconnect required`,
        401,
        companyId,
      );
    }

    return handleResponseResult(retry, companyId, method, path);
  }

  return handleResponseResult(result, companyId, method, path);
}

// ---------------------------------------------------------------------------
// Internal HTTP execution (separated so retry can reuse it)
// ---------------------------------------------------------------------------

interface ResponseResult<T> {
  status: number;
  data?: T;
  headers: Headers;
  rawText?: string;
}

async function executeRequest<T>(
  companyId: number,
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<ResponseResult<T>> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { companyId, method, path, error: msg },
      "[aspire-api-client] Network error",
    );
    throw new Error(`[aspire-api-client] Network error for ${method} ${path}: ${msg}`);
  }

  const status = resp.status;

  // 204 No Content — return empty
  if (status === 204) {
    return { status, headers: resp.headers } as ResponseResult<T>;
  }

  // Try to parse JSON; fall back to raw text for error reporting.
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && status < 400) {
    try {
      const data = (await resp.json()) as T;
      return { status, data, headers: resp.headers };
    } catch {
      const rawText = await resp.text().catch(() => "(unreadable)");
      return { status, rawText, headers: resp.headers };
    }
  }

  const rawText = await resp.text().catch(() => "(unreadable)");
  return { status, rawText, headers: resp.headers };
}

async function handleResponseResult<T>(
  result: ResponseResult<T>,
  companyId: number,
  method: string,
  path: string,
): Promise<T> {
  const { status } = result;

  if (status >= 200 && status < 300) {
    return (result.data ?? ({} as T));
  }

  if (status === 403) {
    const msg = `Aspire credentials lack permission for ${method} ${path}`;
    await markConnectionError(companyId, msg);
    throw new AspireApiError(
      `[aspire-api-client] 403 Forbidden — ${msg}`,
      403,
      companyId,
    );
  }

  if (status === 429) {
    // Honour the Retry-After header if present (seconds or HTTP-date).
    const retryAfterHeader = result.headers.get("retry-after");
    const throttleUntil = parseRetryAfter(retryAfterHeader);
    if (throttleUntil) {
      await db
        .update(aspireCredentials)
        .set({ throttleUntil, updatedAt: new Date() })
        .where(eq(aspireCredentials.companyId, companyId));
    }
    logger.warn(
      { companyId, method, path, throttleUntil },
      "[aspire-api-client] Rate-limited by Aspire (429)",
    );
    throw new AspireThrottleError(companyId, throttleUntil ?? new Date(Date.now() + 60_000));
  }

  // Generic non-2xx
  logger.error(
    { companyId, method, path, status, rawText: result.rawText?.slice(0, 200) },
    "[aspire-api-client] Non-2xx response from Aspire",
  );
  throw new AspireApiError(
    `[aspire-api-client] Aspire returned HTTP ${status} for ${method} ${path}`,
    status,
    companyId,
  );
}

/** Parses the Retry-After header value into a Date. Returns null if unparseable. */
function parseRetryAfter(header: string | null): Date | null {
  if (!header) return null;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return new Date(Date.now() + seconds * 1_000);
  }
  const date = new Date(header);
  if (!isNaN(date.getTime())) return date;
  return null;
}

/** Marks connectionStatus='reconnect_required' in both credential tables. */
async function markReconnectRequired(
  companyId: number,
  reason: string,
): Promise<void> {
  evictCachedToken(companyId);
  try {
    // Import inline to avoid circular deps at module level.
    const { externalIntegrations } = await import("@workspace/db");
    await db.transaction(async (tx) => {
      await tx
        .update(aspireCredentials)
        .set({
          connectionStatus: "reconnect_required",
          errorMessage: reason,
          updatedAt: new Date(),
        })
        .where(eq(aspireCredentials.companyId, companyId));
      await tx
        .update(externalIntegrations)
        .set({ connectionStatus: "reconnect_required", updatedAt: new Date() })
        .where(eq(externalIntegrations.companyId, companyId));
    });
  } catch (err) {
    logger.error(
      { companyId, err },
      "[aspire-api-client] Failed to persist reconnect_required status",
    );
  }
  logger.warn(
    { companyId, reason },
    "[aspire-api-client] Marked connectionStatus=reconnect_required",
  );
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export interface ConnectionTestResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Validates credentials by performing a token handshake followed by one
 * lightweight authenticated GET. Updates connectionStatus accordingly.
 *
 * Called by the tenant-admin "Test connection" route (Mission 8).
 * Never throws — always returns a typed result so the route can respond
 * cleanly regardless of outcome.
 */
export async function testConnection(
  companyId: number,
): Promise<ConnectionTestResult> {
  try {
    // Force a fresh handshake regardless of cached state.
    evictCachedToken(companyId);
    await fetchFreshToken(companyId);

    // Lightweight probe — a simple GET that every Aspire tenant can read.
    // Adjust the path to whatever the lightest read endpoint is in Aspire's API.
    await request(companyId, "GET", "/ServiceTypes?page=1&pageSize=1");

    logger.info(
      { companyId },
      "[aspire-api-client] testConnection: success",
    );
    return { success: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Sanitise: strip any token-shaped content from the message.
    const errorMessage = sanitizeErrorMessage(raw);

    logger.warn(
      { companyId, errorMessage },
      "[aspire-api-client] testConnection: failed",
    );

    // markConnectionError is already called inside fetchFreshToken on token
    // exchange failure, but call it here too in case the probe GET failed.
    try {
      await markConnectionError(companyId, errorMessage);
    } catch {
      // Best-effort — don't mask the original error.
    }

    return { success: false, errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips anything that looks like a bearer token (long base64/hex strings)
 * from an error message before it is logged or returned to the caller.
 */
function sanitizeErrorMessage(msg: string): string {
  // Replace sequences of 20+ base64/hex chars that look like tokens.
  return msg.replace(/[A-Za-z0-9+/=_-]{20,}/g, "[REDACTED]");
}

// ---------------------------------------------------------------------------
// Test seams (exported for unit tests only — not for production use)
// ---------------------------------------------------------------------------

/**
 * Replaces the in-memory token cache entry for a company. Test-only.
 * Allows tests to pre-seed a valid or expired token without a real DB.
 */
export function _testSetCachedToken(
  companyId: number,
  token: string,
  expiresAt: Date,
): void {
  tokenCache.set(companyId, { token, expiresAt });
}

/**
 * Clears the in-memory token cache for a company. Test-only.
 */
export function _testEvictCachedToken(companyId: number): void {
  tokenCache.delete(companyId);
}

/**
 * Clears the refresh mutex for a company. Test-only.
 * Use this between tests to ensure mutex state doesn't leak.
 */
export function _testClearRefreshMutex(companyId: number): void {
  refreshMutex.delete(companyId);
}

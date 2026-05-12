// `expo-secure-store` is loaded lazily inside the default adapter so
// non-RN consumers (e.g. the node:test harness) can swap the adapter
// via `__setSecureTokenStoreForTests` before any native module load is
// attempted. Importing the package eagerly tries to resolve a native
// binding which throws under plain node.

// v1 stored a single bare access-token string. v2 (Task #521) stores a
// JSON blob with both access + refresh tokens and their expiries so the
// client can transparently refresh expired access tokens. v1 values
// surviving on disk are migrated forward in `loadStored`.
const TOKEN_KEY_V1 = "irrigopro.mobile.token.v1";
const TOKEN_KEY = "irrigopro.mobile.token.v2";

const DOMAIN =
  process.env.EXPO_PUBLIC_API_DOMAIN ||
  process.env.EXPO_PUBLIC_DOMAIN ||
  "";

export const API_BASE_URL = DOMAIN
  ? DOMAIN.startsWith("http")
    ? DOMAIN.replace(/\/+$/, "")
    : `https://${DOMAIN.replace(/\/+$/, "")}`
  : "";

export type StoredTokens = {
  accessToken: string;
  /** ISO timestamp; null when migrated from a legacy v1 row. */
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
};

// ── SecureStore adapter (swappable for tests) ───────────────────────────
export type SecureTokenStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

let store: SecureTokenStore = {
  get: async (key) => (await import("expo-secure-store")).getItemAsync(key),
  set: async (key, value) =>
    (await import("expo-secure-store")).setItemAsync(key, value),
  delete: async (key) => {
    try {
      await (await import("expo-secure-store")).deleteItemAsync(key);
    } catch {
      /* best-effort */
    }
  },
};

/** Test seam — swap the SecureStore-backed adapter for an in-memory one. */
export function __setSecureTokenStoreForTests(next: SecureTokenStore): void {
  store = next;
}

let cached: StoredTokens | null = null;
let cacheLoaded = false;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function loadStored(): Promise<StoredTokens | null> {
  if (cacheLoaded) return cached;
  cacheLoaded = true;
  try {
    const raw = await store.get(TOKEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredTokens>;
      if (parsed && typeof parsed.accessToken === "string") {
        cached = {
          accessToken: parsed.accessToken,
          accessTokenExpiresAt: parsed.accessTokenExpiresAt ?? null,
          refreshToken: parsed.refreshToken ?? null,
          refreshTokenExpiresAt: parsed.refreshTokenExpiresAt ?? null,
        };
        return cached;
      }
    }
  } catch {
    /* corrupted v2 row — fall through to v1 migration */
  }
  // Migrate any v1 single-string token forward as an access token with
  // unknown expiry (so the first 401 will trigger the refresh path; if
  // there's no refresh token the user is bounced to sign-in, which
  // matches today's behavior for sessions still on the legacy shape).
  try {
    const legacy = await store.get(TOKEN_KEY_V1);
    if (legacy) {
      cached = {
        accessToken: legacy,
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
      };
      await store.set(TOKEN_KEY, JSON.stringify(cached));
      await store.delete(TOKEN_KEY_V1);
      return cached;
    }
  } catch {
    /* legacy read failure is non-fatal */
  }
  cached = null;
  return null;
}

async function persistStored(next: StoredTokens | null): Promise<void> {
  cached = next;
  cacheLoaded = true;
  if (next) {
    await store.set(TOKEN_KEY, JSON.stringify(next));
  } else {
    await store.delete(TOKEN_KEY);
    await store.delete(TOKEN_KEY_V1);
  }
}

/** Returns the current access token, hydrating from SecureStore on first call. */
export async function getToken(): Promise<string | null> {
  const stored = await loadStored();
  return stored?.accessToken ?? null;
}

export async function getStoredTokens(): Promise<StoredTokens | null> {
  return await loadStored();
}

/**
 * Replace the entire stored-token blob, or clear it. Pre-Task #521 this
 * accepted a bare string; we keep that overload so callers passing a raw
 * token (or `null` to clear) continue to work and are upgraded to the
 * v2 shape transparently.
 */
export async function setToken(
  token: string | StoredTokens | null,
): Promise<void> {
  if (token == null) {
    await persistStored(null);
    return;
  }
  if (typeof token === "string") {
    await persistStored({
      accessToken: token,
      accessTokenExpiresAt: null,
      refreshToken: cached?.refreshToken ?? null,
      refreshTokenExpiresAt: cached?.refreshTokenExpiresAt ?? null,
    });
    return;
  }
  await persistStored(token);
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export type ApiRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** When true (default), 401 responses clear the token + signal logout. */
  handle401?: boolean;
};

// ── Transparent access-token refresh (Task #521) ────────────────────────
// A single in-flight refresh is shared across concurrent 401 callers so
// a burst of expired-token failures only triggers one network refresh.
let refreshInFlight: Promise<StoredTokens | null> | null = null;

async function refreshAccessTokenOnce(): Promise<StoredTokens | null> {
  const stored = await loadStored();
  if (!stored?.refreshToken) return null;
  const url = `${API_BASE_URL}/api/auth/mobile-refresh`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
  } catch {
    // Network failure mid-refresh — treat as "refresh unavailable" so the
    // original request's 401 falls through to the unauthorized handler.
    return null;
  }
  if (!res.ok) return null;
  type RefreshResponse = {
    accessToken?: string;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
  };
  let data: RefreshResponse | null = null;
  try {
    data = (await res.json()) as RefreshResponse;
  } catch {
    return null;
  }
  const accessToken = data?.accessToken;
  if (!accessToken) return null;
  const next: StoredTokens = {
    accessToken,
    accessTokenExpiresAt: data?.accessTokenExpiresAt ?? null,
    refreshToken: stored.refreshToken,
    refreshTokenExpiresAt:
      data?.refreshTokenExpiresAt ?? stored.refreshTokenExpiresAt ?? null,
  };
  await persistStored(next);
  return next;
}

async function tryRefresh(): Promise<StoredTokens | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessTokenOnce().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doFetch(
  url: string,
  method: string,
  body: unknown,
  headers: Record<string, string>,
  token: string | null,
): Promise<Response> {
  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (token && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }
  return await fetch(url, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {}, handle401 = true } = opts;
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  let token = await getToken();
  let res = await doFetch(url, method, body, headers, token);

  // Task #521 — on 401, attempt a single transparent refresh + retry.
  // Only the first attempt is allowed to refresh; if the retried request
  // also 401s we fall through to the standard handle401 path. We skip
  // refresh entirely when the original request had no token (no session
  // to refresh) or when the caller already overrode the Authorization
  // header (callers minting their own bearer don't go through cached).
  if (
    res.status === 401 &&
    handle401 &&
    token != null &&
    !headers.Authorization
  ) {
    const refreshed = await tryRefresh();
    if (refreshed?.accessToken) {
      token = refreshed.accessToken;
      res = await doFetch(url, method, body, headers, token);
    }
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && handle401) {
      await persistStored(null);
      unauthorizedHandler?.();
    }
    const message =
      (data && typeof data === "object" && "message" in (data as object)
        ? String((data as { message: unknown }).message)
        : null) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

/** Test seam — drop the in-memory cache so the next call re-reads SecureStore. */
export function __resetTokenCacheForTests(): void {
  cached = null;
  cacheLoaded = false;
  refreshInFlight = null;
}

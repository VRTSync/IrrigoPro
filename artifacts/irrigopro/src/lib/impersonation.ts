// Task #554 — client-side impersonation lifecycle. The frontend stores
// the original super-admin user in `irrigopro:impersonator` and swaps
// `localStorage.user` to the target. Trust is anchored on the SERVER
// via a HMAC-signed impersonation token (returned by
// `/impersonate/start`) which is sent on every authed request as
// `x-impersonation-token` and verified inside `requireAuthentication`.
// The localStorage swap exists only so the UI can render as the
// target — the server does not trust it.

import { safeGet, safeSet, safeRemove } from "@/utils/safeStorage";

export type SessionUser = {
  id: number;
  username: string;
  name?: string;
  role: string;
  companyId?: number | null;
  email?: string | null;
};

const KEY_USER = "user";
const KEY_IMPERSONATOR = "irrigopro:impersonator";
const KEY_IMP_TOKEN = "irrigopro:impersonationToken";
const KEY_IMP_TOKEN_EXPIRES = "irrigopro:impersonationTokenExpiresAt";

function readJson<T>(key: string): T | null {
  try {
    const raw = safeGet(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}

export function getCurrentUser(): SessionUser | null {
  return readJson<SessionUser>(KEY_USER);
}

export function getImpersonator(): SessionUser | null {
  return readJson<SessionUser>(KEY_IMPERSONATOR);
}

export function getImpersonationToken(): string | null {
  const tok = safeGet(KEY_IMP_TOKEN);
  if (!tok) return null;
  const exp = safeGet(KEY_IMP_TOKEN_EXPIRES);
  if (exp) {
    const t = new Date(exp).getTime();
    if (Number.isFinite(t) && t <= Date.now()) {
      // Expired locally — clean it up so we stop sending it.
      safeRemove(KEY_IMP_TOKEN);
      safeRemove(KEY_IMP_TOKEN_EXPIRES);
      return null;
    }
  }
  return tok;
}

export function isImpersonating(): boolean {
  return !!safeGet(KEY_IMPERSONATOR) && !!getImpersonationToken();
}

// Begin impersonation. Caller is the super_admin viewing the App Health
// page. Pass the server-issued token + expiry from `/impersonate/start`
// so subsequent requests carry it as `x-impersonation-token`.
export function beginImpersonation(
  target: SessionUser,
  token: string,
  expiresAt: string,
): void {
  const original = getCurrentUser();
  if (!original) throw new Error("No current user to preserve");
  if (original.role !== "super_admin") {
    throw new Error("Only super_admin can impersonate");
  }
  if (!token || typeof token !== "string") {
    throw new Error("Server did not issue an impersonation token");
  }
  // Don't double-stack — preserve the *original* admin even if the
  // operator clicks Impersonate again from a target's drawer somehow.
  if (!getImpersonator()) {
    safeSet(KEY_IMPERSONATOR, JSON.stringify(original));
  }
  safeSet(KEY_USER, JSON.stringify(target));
  safeSet(KEY_IMP_TOKEN, token);
  safeSet(KEY_IMP_TOKEN_EXPIRES, expiresAt);
}

// Restore the saved super-admin user. Returns the previously
// impersonated user id and the just-revoked token so the caller can
// audit + revoke them on the server.
export function restoreImpersonator(): {
  previousUserId: number | null;
  impersonationToken: string | null;
} {
  const previous = getCurrentUser();
  const original = getImpersonator();
  const token = safeGet(KEY_IMP_TOKEN);
  if (original) {
    safeSet(KEY_USER, JSON.stringify(original));
    safeRemove(KEY_IMPERSONATOR);
  }
  safeRemove(KEY_IMP_TOKEN);
  safeRemove(KEY_IMP_TOKEN_EXPIRES);
  return { previousUserId: previous?.id ?? null, impersonationToken: token };
}

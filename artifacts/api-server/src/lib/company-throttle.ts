import type { NextFunction, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";

export type ThrottleConfig = {
  rateLimit: number;
  expiresAt: number;
  setBy: number | null;
  setAt: number;
};

const SETTING_PREFIX = "throttle:company:";

const cache = new Map<number, ThrottleConfig>();
const counters = new Map<number, { windowStart: number; count: number }>();
let lastReload = 0;
const RELOAD_INTERVAL_MS = 30_000;

export async function loadCompanyThrottles(): Promise<void> {
  try {
    const r = await db.execute<{ key: string; value: string }>(sql`
      SELECT key, value FROM app_settings WHERE key LIKE ${SETTING_PREFIX + "%"}
    `);
    const next = new Map<number, ThrottleConfig>();
    const now = Date.now();
    for (const row of r.rows ?? []) {
      const cid = Number(row.key.slice(SETTING_PREFIX.length));
      if (!Number.isInteger(cid)) continue;
      try {
        const cfg = JSON.parse(row.value) as ThrottleConfig;
        if (typeof cfg.rateLimit === "number" && typeof cfg.expiresAt === "number" && cfg.expiresAt > now) {
          next.set(cid, cfg);
        }
      } catch { /* ignore */ }
    }
    cache.clear();
    for (const [k, v] of next) cache.set(k, v);
    lastReload = now;
  } catch { /* ignore */ }
}

export async function setCompanyThrottle(
  companyId: number,
  rateLimit: number,
  durationMinutes: number,
  setBy: number | null,
): Promise<ThrottleConfig> {
  const now = Date.now();
  const cfg: ThrottleConfig = {
    rateLimit,
    expiresAt: now + durationMinutes * 60_000,
    setBy,
    setAt: now,
  };
  const key = SETTING_PREFIX + companyId;
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${JSON.stringify(cfg)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
  cache.set(companyId, cfg);
  counters.delete(companyId);
  return cfg;
}

export async function clearCompanyThrottle(companyId: number): Promise<void> {
  const key = SETTING_PREFIX + companyId;
  await db.execute(sql`DELETE FROM app_settings WHERE key = ${key}`);
  cache.delete(companyId);
  counters.delete(companyId);
}

export function getCompanyThrottle(companyId: number): ThrottleConfig | null {
  const cfg = cache.get(companyId);
  if (!cfg) return null;
  if (cfg.expiresAt <= Date.now()) {
    cache.delete(companyId);
    counters.delete(companyId);
    return null;
  }
  return cfg;
}

export function listActiveThrottles(): Array<ThrottleConfig & { companyId: number }> {
  const now = Date.now();
  const out: Array<ThrottleConfig & { companyId: number }> = [];
  for (const [companyId, cfg] of cache) {
    if (cfg.expiresAt > now) out.push({ companyId, ...cfg });
  }
  return out;
}

export function maybeReloadThrottles(): void {
  const now = Date.now();
  if (now - lastReload > RELOAD_INTERVAL_MS) {
    lastReload = now;
    void loadCompanyThrottles();
  }
}

// Server-side, identity-trusted throttle check. Called from inside
// `requireAuthentication` AFTER the trusted authenticatedUserCompanyId
// is set from a verified bearer token / session / opt-in header path.
// Never reads `x-user-company-id` directly so a tenant cannot spoof
// the header to evade or redirect the cap.
//
// Returns true when the request is allowed; returns false when the
// caller has already sent a 429 response and the route handler should
// stop.
export function checkAuthenticatedThrottle(
  req: Request & {
    authenticatedUserCompanyId?: number | null;
    authenticatedUserRole?: string | null;
  },
  res: Response,
): boolean {
  maybeReloadThrottles();
  if (cache.size === 0) return true;
  const role = req.authenticatedUserRole ?? null;
  if (role === "super_admin") return true; // super-admin always observable
  const cid = req.authenticatedUserCompanyId ?? null;
  if (cid == null) return true; // no verified company → can't throttle
  // App-health / health / config endpoints are exempt regardless of role.
  const p = req.path;
  if (p.startsWith("/api/admin/app-health")) return true;
  if (p === "/api/health") return true;
  if (p === "/api/client-errors") return true;
  if (p === "/api/config/min-app-version") return true;

  const cfg = getCompanyThrottle(cid);
  if (!cfg) return true;
  const now = Date.now();
  const c = counters.get(cid);
  if (!c || now - c.windowStart >= 60_000) {
    counters.set(cid, { windowStart: now, count: 1 });
    return true;
  }
  c.count += 1;
  if (c.count > cfg.rateLimit) {
    res.status(429).json({
      message: "Tenant rate-limited by super admin",
      retryAfterMs: 60_000 - (now - c.windowStart),
      throttleExpiresAt: new Date(cfg.expiresAt).toISOString(),
    });
    return false;
  }
  return true;
}

// Backwards-compatible Express middleware. Now a no-op shim — the
// throttle is enforced from inside `requireAuthentication` instead so
// it can rely on a server-verified company id (no client header
// fallback). Left here so callers that mounted the legacy middleware
// don't need to be removed atomically.
export function companyThrottleMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

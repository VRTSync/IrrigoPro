import crypto from "crypto";
import { logger } from "../logger";

export type ImpersonationClaims = {
  actorUserId: number;
  targetUserId: number;
  exp: number;
  jti: string;
};

const DEFAULT_TTL_MS = 60 * 60 * 1000;

// Resolve the HMAC secret at module load. Production MUST supply one
// of `IMPERSONATION_SECRET` or `SESSION_SECRET` — failure to do so is
// a fatal boot error so a misconfigured deploy can't accept forgeable
// impersonation tokens (Task #554 — review fix). Non-production falls
// back to an ephemeral process-local random secret with a loud warning,
// which means tokens become invalid on every restart but no hardcoded
// value is ever shipped.
function resolveSecret(): string {
  const supplied = process.env.IMPERSONATION_SECRET || process.env.SESSION_SECRET;
  if (supplied && supplied.length >= 32) return supplied;
  if (process.env.NODE_ENV === "production") {
    const msg =
      "FATAL: IMPERSONATION_SECRET (or SESSION_SECRET) must be set to a value of at least 32 characters in production. " +
      "Refusing to start with a guessable / hardcoded fallback because impersonation tokens would be forgeable.";
    // Throw synchronously so the process fails fast at boot rather
    // than partially starting and accepting auth requests.
    throw new Error(msg);
  }
  if (supplied && supplied.length < 32) {
    logger.warn(
      "IMPERSONATION_SECRET / SESSION_SECRET is shorter than 32 chars — using an ephemeral process-local secret instead",
      "impersonation-token",
    );
  } else {
    logger.warn(
      "No IMPERSONATION_SECRET / SESSION_SECRET set — generating an ephemeral process-local secret. Impersonation tokens will not survive a restart. Set IMPERSONATION_SECRET in your environment for stable behavior.",
      "impersonation-token",
    );
  }
  return crypto.randomBytes(48).toString("hex");
}

const SECRET = resolveSecret();

const revoked = new Set<string>();
const REVOKED_MAX = 4096;

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function hmac(payload: string): string {
  return b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());
}

export function mintImpersonationToken(actorUserId: number, targetUserId: number, ttlMs: number = DEFAULT_TTL_MS): { token: string; claims: ImpersonationClaims } {
  const claims: ImpersonationClaims = {
    actorUserId,
    targetUserId,
    exp: Date.now() + ttlMs,
    jti: crypto.randomBytes(12).toString("hex"),
  };
  const payload = b64url(JSON.stringify(claims));
  const sig = hmac(payload);
  return { token: `${payload}.${sig}`, claims };
}

export function verifyImpersonationToken(token: string): ImpersonationClaims | null {
  if (typeof token !== "string" || token.length > 2048 || !token.includes(".")) return null;
  const [payload, sig] = token.split(".", 2);
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  if (expected.length !== sig.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch { return null; }
  let claims: ImpersonationClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString("utf8")) as ImpersonationClaims;
  } catch { return null; }
  if (typeof claims.actorUserId !== "number" || typeof claims.targetUserId !== "number") return null;
  if (typeof claims.exp !== "number" || claims.exp <= Date.now()) return null;
  if (typeof claims.jti !== "string" || revoked.has(claims.jti)) return null;
  return claims;
}

export function revokeImpersonationToken(token: string): void {
  if (typeof token !== "string" || !token.includes(".")) return;
  const [payload] = token.split(".", 2);
  try {
    const claims = JSON.parse(b64urlDecode(payload).toString("utf8")) as ImpersonationClaims;
    if (typeof claims.jti === "string") {
      revoked.add(claims.jti);
      if (revoked.size > REVOKED_MAX) {
        const it = revoked.values();
        for (let i = 0; i < REVOKED_MAX / 4; i++) {
          const v = it.next().value;
          if (v) revoked.delete(v);
          else break;
        }
      }
    }
  } catch { /* ignore */ }
}

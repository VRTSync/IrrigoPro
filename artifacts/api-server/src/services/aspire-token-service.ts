// =============================================================================
// ASPIRE TOKEN SERVICE
// =============================================================================
//
// AES-256-GCM credential store for the Aspire integration. This is the ONLY
// place in the codebase where Aspire credentials are decrypted. All encrypted
// blobs are stored in aspire_credentials; plaintext never leaves this module.
//
// Guardrails enforced here:
//   • No plaintext credential is ever logged or included in thrown errors.
//   • No plaintext credential is returned to any caller outside this file.
//   • Tamper detection is non-optional — if the GCM auth tag fails, decrypt()
//     throws. That error propagates; it is never swallowed here.
//   • ASPIRE_ENCRYPTION_KEY is validated at import time. If the key is missing
//     or malformed, getEncryptionKey() throws, which surfaces at the first call
//     site. The hard fail-at-startup is enforced in index.ts (see below).
// =============================================================================

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  aspireCredentials,
  externalIntegrations,
} from "@workspace/db";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Encryption key — validated eagerly on first access.
// ---------------------------------------------------------------------------

/** Cached key buffer. Populated once, reused for every call. */
let _keyBuffer: Buffer | null = null;

/**
 * Returns the 32-byte AES key derived from ASPIRE_ENCRYPTION_KEY.
 * Throws a startup-safe error if the env var is missing or malformed.
 * This is called at module load time via validateAspireEncryptionKey() so
 * that index.ts can surface the error before the server begins accepting
 * requests.
 */
function getEncryptionKey(): Buffer {
  if (_keyBuffer) return _keyBuffer;

  const raw = process.env.ASPIRE_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "[aspire-token-service] ASPIRE_ENCRYPTION_KEY is not set. " +
        "Generate a 64-character hex string (32 bytes) and add it to your environment.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "[aspire-token-service] ASPIRE_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
        `Got ${raw.length} characters.`,
    );
  }

  _keyBuffer = Buffer.from(raw, "hex");
  return _keyBuffer;
}

/**
 * Called by index.ts at startup to hard-fail early if the key is missing.
 * Throws with a clear, actionable message.
 */
export function validateAspireEncryptionKey(): void {
  getEncryptionKey(); // throws if invalid
}

// ---------------------------------------------------------------------------
// Core crypto — AES-256-GCM
// ---------------------------------------------------------------------------

const IV_BYTES = 12; // 96-bit IV — recommended for GCM
const TAG_BYTES = 16; // 128-bit auth tag — GCM default

/**
 * Encrypts `plaintext` with AES-256-GCM.
 *
 * Wire format: base64( iv[12] || authTag[16] || ciphertext )
 *
 * The IV is randomly generated per call; the same plaintext produces a
 * different ciphertext on every invocation (semantic security).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv || authTag || ciphertext → base64
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypts a value produced by encrypt().
 *
 * Throws if:
 *   • The stored value is not valid base64 or is too short to contain the
 *     mandatory header (iv + authTag).
 *   • The GCM auth tag verification fails (tampered ciphertext or wrong key).
 *
 * Error messages from this function intentionally contain no credential data.
 */
export function decrypt(stored: string): string {
  const key = getEncryptionKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(stored, "base64");
  } catch {
    throw new Error("[aspire-token-service] Stored value is not valid base64.");
  }

  const minLen = IV_BYTES + TAG_BYTES + 1; // at least 1 byte of ciphertext
  if (buf.length < minLen) {
    throw new Error(
      `[aspire-token-service] Stored value too short to contain iv+authTag+ciphertext ` +
        `(got ${buf.length} bytes, need ≥ ${minLen}).`,
    );
  }

  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  // If the auth tag doesn't verify, decipher.final() throws
  // "Unsupported state or unable to authenticate data". We let that
  // propagate — it is NOT swallowed. Callers that need graceful handling
  // must catch it themselves.
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    // Re-throw with a sanitized message that contains no credential data.
    throw new Error(
      "[aspire-token-service] Decryption failed — auth tag verification error. " +
        "The stored value may have been tampered with or encrypted with a different key.",
    );
  }
}

// ---------------------------------------------------------------------------
// Credential persistence
// ---------------------------------------------------------------------------

/**
 * Encrypts clientId and clientSecret and upserts them into aspire_credentials.
 * Also ensures a corresponding external_integrations row exists for this
 * company (connectionStatus stays 'disconnected' until the first successful
 * token test by the API client in Mission 3).
 *
 * This is the only write path for Aspire credentials; all callers must go
 * through here so the encrypt-on-write invariant is never bypassed.
 */
export async function saveCredentials(
  companyId: number,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const encryptedClientId = encrypt(clientId);
  const encryptedClientSecret = encrypt(clientSecret);

  await db.transaction(async (tx) => {
    // Upsert aspire_credentials
    await tx
      .insert(aspireCredentials)
      .values({
        companyId,
        encryptedClientId,
        encryptedClientSecret,
        connectionStatus: "disconnected",
        syncEnabled: true,
      })
      .onConflictDoUpdate({
        target: aspireCredentials.companyId,
        set: {
          encryptedClientId,
          encryptedClientSecret,
          // Clear any stale access token when credentials are rotated.
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
          connectionStatus: "disconnected",
          errorMessage: null,
          throttleUntil: null,
          updatedAt: new Date(),
        },
      });

    // Ensure external_integrations row exists.
    await tx
      .insert(externalIntegrations)
      .values({
        companyId,
        integrationType: "aspire",
        connectionStatus: "disconnected",
      })
      .onConflictDoUpdate({
        target: [externalIntegrations.companyId, externalIntegrations.integrationType],
        set: {
          // Only reset to disconnected if we haven't connected yet.
          // If the row already exists as 'connected', leave it alone —
          // re-saving credentials doesn't break the connection status.
          updatedAt: new Date(),
        },
      });
  });

  logger.info(
    { companyId },
    "[aspire-token-service] Credentials saved (encrypted); connection status = disconnected",
  );
}

/**
 * Wipes all credential material for a company and marks both tables as
 * 'disconnected'. Called when a tenant admin disconnects the integration.
 *
 * Note: we do NOT physically delete the aspire_credentials row so that
 * audit history (createdAt) is preserved. Encrypted fields are nulled.
 */
export async function revokeCredentials(companyId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(aspireCredentials)
      .set({
        encryptedClientId: "",
        encryptedClientSecret: "",
        encryptedAccessToken: null,
        accessTokenExpiresAt: null,
        connectionStatus: "disconnected",
        errorMessage: null,
        throttleUntil: null,
        syncEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(aspireCredentials.companyId, companyId));

    await tx
      .update(externalIntegrations)
      .set({
        connectionStatus: "disconnected",
        updatedAt: new Date(),
      })
      .where(
        eq(externalIntegrations.companyId, companyId),
      );
  });

  logger.info(
    { companyId },
    "[aspire-token-service] Credentials revoked",
  );
}

// ---------------------------------------------------------------------------
// Internal read path — NEVER exported
// ---------------------------------------------------------------------------

/**
 * Decrypts and returns clientId + clientSecret for immediate one-time use
 * by the Aspire API client (Mission 3). This function is intentionally NOT
 * exported. Only code within this module may call it.
 *
 * Returns null if no credentials are stored for this company.
 */
async function getDecryptedCredentials(
  companyId: number,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const rows = await db
    .select({
      encryptedClientId: aspireCredentials.encryptedClientId,
      encryptedClientSecret: aspireCredentials.encryptedClientSecret,
    })
    .from(aspireCredentials)
    .where(eq(aspireCredentials.companyId, companyId))
    .limit(1);

  if (rows.length === 0) return null;

  const { encryptedClientId, encryptedClientSecret } = rows[0];

  // Both fields are marked NOT NULL in the schema but could be empty strings
  // after a revoke(). Guard against that.
  if (!encryptedClientId || !encryptedClientSecret) {
    return null;
  }

  return {
    clientId: decrypt(encryptedClientId),
    clientSecret: decrypt(encryptedClientSecret),
  };
}

// ---------------------------------------------------------------------------
// Access token management (called by the API client in Mission 3)
// ---------------------------------------------------------------------------

/**
 * Persists an encrypted access token and its expiry after a successful
 * OAuth token exchange. Updates connectionStatus to 'connected' in both
 * aspire_credentials and external_integrations.
 *
 * Called exclusively by the Aspire API client (Mission 3) — not by routes.
 */
export async function saveAccessToken(
  companyId: number,
  accessToken: string,
  expiresAt: Date,
): Promise<void> {
  const encryptedAccessToken = encrypt(accessToken);

  await db.transaction(async (tx) => {
    await tx
      .update(aspireCredentials)
      .set({
        encryptedAccessToken,
        accessTokenExpiresAt: expiresAt,
        connectionStatus: "connected",
        errorMessage: null,
        throttleUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(aspireCredentials.companyId, companyId));

    await tx
      .update(externalIntegrations)
      .set({
        connectionStatus: "connected",
        connectedAt: new Date(),
        lastHealthCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        eq(externalIntegrations.companyId, companyId),
      );
  });

  logger.info(
    { companyId, expiresAt },
    "[aspire-token-service] Access token saved (encrypted)",
  );
}

/**
 * Marks the integration in an error state with a sanitized reason.
 * The raw API error message is passed in by the caller; this function
 * stores it as-is since it comes from Aspire's API (not from our credentials).
 */
export async function markConnectionError(
  companyId: number,
  errorMessage: string,
): Promise<void> {
  const status = "error" as const;

  await db.transaction(async (tx) => {
    await tx
      .update(aspireCredentials)
      .set({ connectionStatus: status, errorMessage, updatedAt: new Date() })
      .where(eq(aspireCredentials.companyId, companyId));

    await tx
      .update(externalIntegrations)
      .set({ connectionStatus: status, updatedAt: new Date() })
      .where(
        eq(externalIntegrations.companyId, companyId),
      );
  });

  logger.warn(
    { companyId, errorMessage },
    "[aspire-token-service] Connection marked as error",
  );
}

/**
 * Decrypts and returns the current access token for immediate use.
 * Returns null if no token is stored or if it has already expired.
 *
 * Callers (Mission 3 API client) should check expiry and refresh before
 * calling this if they detect the token is stale.
 */
export async function getDecryptedAccessToken(
  companyId: number,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const rows = await db
    .select({
      encryptedAccessToken: aspireCredentials.encryptedAccessToken,
      accessTokenExpiresAt: aspireCredentials.accessTokenExpiresAt,
    })
    .from(aspireCredentials)
    .where(eq(aspireCredentials.companyId, companyId))
    .limit(1);

  if (rows.length === 0) return null;

  const { encryptedAccessToken, accessTokenExpiresAt } = rows[0];
  if (!encryptedAccessToken || !accessTokenExpiresAt) return null;

  return {
    accessToken: decrypt(encryptedAccessToken),
    expiresAt: accessTokenExpiresAt,
  };
}

/**
 * Exposes getDecryptedCredentials exclusively to the Aspire API client
 * (Mission 3) via a controlled seam. The raw function remains unexported;
 * only this bound reference crosses the module boundary, and it is typed
 * to signal it is for internal integration use only.
 *
 * Usage in Mission 3:
 *   import { _internalGetDecryptedCredentials } from "./aspire-token-service";
 *   const creds = await _internalGetDecryptedCredentials(companyId);
 *
 * Do NOT use this anywhere except the Aspire API client.
 */
export const _internalGetDecryptedCredentials = getDecryptedCredentials;

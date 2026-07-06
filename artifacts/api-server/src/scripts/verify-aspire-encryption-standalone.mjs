// Standalone crypto verification — no DB required.
// Run with:
//   ASPIRE_ENCRYPTION_KEY=<64-hex-chars> node artifacts/api-server/src/scripts/verify-aspire-encryption-standalone.mjs
//
// This script re-implements the encrypt/decrypt logic from aspire-token-service.ts
// using pure Node.js crypto to verify the algorithm is correct before the DB is
// available. It deliberately avoids any imports that trigger DATABASE_URL.

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------
const raw = process.env.ASPIRE_ENCRYPTION_KEY;
if (!raw) {
  console.error(
    "[FAIL] ASPIRE_ENCRYPTION_KEY is not set.\n" +
      "       Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
      "       Then export ASPIRE_ENCRYPTION_KEY=<result>"
  );
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
  console.error(
    `[FAIL] ASPIRE_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${raw.length} chars.`
  );
  process.exit(1);
}
const KEY = Buffer.from(raw, "hex");
console.log("✅  ASPIRE_ENCRYPTION_KEY validated (64 hex chars, 32 bytes)");

// ---------------------------------------------------------------------------
// Core functions (mirrors aspire-token-service.ts exactly)
// ---------------------------------------------------------------------------
function encrypt(plaintext) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(stored) {
  const buf = Buffer.from(stored, "base64");
  const minLen = IV_BYTES + TAG_BYTES + 1;
  if (buf.length < minLen) {
    throw new Error(`Value too short: ${buf.length} bytes (need ≥ ${minLen})`);
  }
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Decryption failed — auth tag verification error.");
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// 1. Round-trip correctness
console.log("\n── Round-trip tests ──────────────────────────────────────────");
const vectors = [
  "super-secret-client-id-abc123",
  "short",
  "a".repeat(256),
  "unicode: 日本語テスト 🔐",
  "newlines\nand\ttabs",
  "aspire-oauth-secret-!@#$%^&*()",
];
for (const pt of vectors) {
  try {
    const stored = encrypt(pt);
    const recovered = decrypt(stored);
    assert(`round-trip: ${JSON.stringify(pt).slice(0, 45)}`, recovered === pt, `got: ${JSON.stringify(recovered)}`);
  } catch (e) {
    assert(`round-trip: ${JSON.stringify(pt).slice(0, 45)}`, false, String(e));
  }
}

// 2. Non-determinism (random IV means same plaintext → different ciphertext)
console.log("\n── Non-determinism tests ─────────────────────────────────────");
for (const pt of ["client-id-xyz", "another-secret"]) {
  const c1 = encrypt(pt);
  const c2 = encrypt(pt);
  assert(`different ciphertext on repeat call: ${pt}`, c1 !== c2);
}

// 3. Tamper detection
console.log("\n── Tamper detection tests ─────────────────────────────────────");
const goodStored = encrypt("my-aspire-client-secret");

// Flip one byte in the ciphertext portion (byte 28 = past iv+tag)
const buf1 = Buffer.from(goodStored, "base64");
buf1[28] = buf1[28] ^ 0xff;
let threw1 = false;
try { decrypt(buf1.toString("base64")); } catch { threw1 = true; }
assert("flipped ciphertext byte throws", threw1);

// Flip one byte in the auth tag (byte 12..27)
const buf2 = Buffer.from(goodStored, "base64");
buf2[14] = buf2[14] ^ 0x01;
let threw2 = false;
try { decrypt(buf2.toString("base64")); } catch { threw2 = true; }
assert("flipped auth tag byte throws", threw2);

// Flip one byte in the IV (byte 0..11) — changes the decryption but auth tag still fails
const buf3 = Buffer.from(goodStored, "base64");
buf3[3] = buf3[3] ^ 0x80;
let threw3 = false;
try { decrypt(buf3.toString("base64")); } catch { threw3 = true; }
assert("flipped IV byte throws", threw3);

// Too short
let threw4 = false;
try { decrypt(Buffer.from("tooshort").toString("base64")); } catch { threw4 = true; }
assert("too-short value throws", threw4);

// Valid stored value decrypts correctly even after tampering tests
assert("original stored value still decrypts correctly after tamper tests", decrypt(goodStored) === "my-aspire-client-secret");

// 4. Key format validation (done before test runner, reported here)
console.log("\n── Key format validation ─────────────────────────────────────");
console.log(`  ✅  64-char hex key accepted (verified at script start)`);
console.log(`  ℹ   To test missing key:  unset ASPIRE_ENCRYPTION_KEY && node this-script.mjs`);
console.log(`  ℹ   To test short key:    ASPIRE_ENCRYPTION_KEY=abc123 node this-script.mjs`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n══════════════════════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("  All Aspire encryption verification checks passed ✅\n");
}

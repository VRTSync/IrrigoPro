// Lightweight RFC4122 v4 UUID generator. We can't rely on crypto.randomUUID()
// being present in every React Native runtime we target, and pulling in a
// full polyfill is overkill for the few call sites that need a stable
// client-supplied id. Math.random() is sufficient here — these IDs only need
// to be unique within a single device's request stream so the server's
// uniqueness index can dedupe a retry.
export function generateClientId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") {
    try {
      return g.crypto.randomUUID();
    } catch {
      // fall through to fallback
    }
  }
  // RFC4122 v4 fallback
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(Math.floor(Math.random() * 256).toString(16).padStart(2, "0"));
  }
  // Set version and variant bits.
  hex[6] = ((parseInt(hex[6], 16) & 0x0f) | 0x40).toString(16).padStart(2, "0");
  hex[8] = ((parseInt(hex[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

// Task #552 — PII scrubbing + context allowlist for app_events.
//
// Every app_event row written to `client_errors` runs through
// `scrubEvent()` before insertion. Anything that looks like an email,
// phone number, street address, or SSN is replaced with a token so a
// future export of the App Health table never leaks customer PII.
// The `context` field is constrained to a small allowlist of safe
// keys; everything else is dropped on the floor.
//
// The scrubber is intentionally simple regex-based — it errs on the
// side of over-scrubbing rather than letting a real PII string slip
// through. False positives in stack traces (e.g. a function literal
// that contains an `@`) are acceptable; the tradeoff is that a
// support engineer reading the drawer sees `[email]` instead of a
// customer's address.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Loose phone: 10–14 digits with optional separators / leading +.
const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Street-address-shape: <number> <words> <street type>.
const ADDRESS_RE =
  /\b\d{1,6}\s+[A-Za-z0-9.''-]+(?:\s+[A-Za-z0-9.''-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy)\b\.?/gi;

const ALLOWED_CONTEXT_KEYS = new Set([
  "route",
  "request_id",
  "requestId",
  "app_version",
  "appVersion",
  "device",
  "os",
  "viewport",
  "viewport_w",
  "viewport_h",
  "screen",
  "locale",
  "timezone",
  "tz",
  "browser",
  "platform",
  "online",
  "kind",
  "step",
  "status_code",
  "statusCode",
  "retry_count",
  "retryCount",
  "attempt",
  "queue_age_ms",
  "queueAgeMs",
  "age_ms",
  "ageMs",
  "reason",
  "duration_ms",
  "durationMs",
  "method",
  "path",
  "type",
  "name",
  "build_hash",
  "buildHash",
]);

// Customer-name scrubbing — Task #552 spec compliance. The list is
// loaded asynchronously from the DB by the routes layer (see
// `setScrubCustomerNames`) and refreshed on a 5-minute timer so the
// scrubber stays sync. Names shorter than 4 chars are skipped (too
// many false positives — e.g. a customer literally named "Sun").
let CUSTOMER_NAMES_RE: RegExp | null = null;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function setScrubCustomerNames(names: ReadonlyArray<string>): void {
  const cleaned = Array.from(
    new Set(
      names
        .map((n) => (typeof n === "string" ? n.trim() : ""))
        .filter((n) => n.length >= 4 && /[A-Za-z]/.test(n)),
    ),
  )
    // Sort longest-first so "Acme Irrigation Co" wins before "Acme".
    .sort((a, b) => b.length - a.length)
    .slice(0, 5000); // keep the regex bounded
  if (cleaned.length === 0) {
    CUSTOMER_NAMES_RE = null;
    return;
  }
  CUSTOMER_NAMES_RE = new RegExp(
    "\\b(" + cleaned.map(escapeRegex).join("|") + ")\\b",
    "gi",
  );
}

export function scrubString(input: string | null | undefined): string | null {
  if (input == null) return input ?? null;
  if (typeof input !== "string") return String(input);
  let out = input
    .replace(EMAIL_RE, "[email]")
    .replace(SSN_RE, "[ssn]")
    .replace(ADDRESS_RE, "[address]")
    .replace(PHONE_RE, (m) => {
      // Don't scrub short numeric-only sequences (line:col, status codes,
      // millis). PHONE_RE already requires 10+ digits, but pass through
      // anything that looks like a stack-trace `:1234:5` location.
      const digits = m.replace(/\D/g, "");
      if (digits.length < 10) return m;
      return "[phone]";
    });
  if (CUSTOMER_NAMES_RE) {
    out = out.replace(CUSTOMER_NAMES_RE, "[customer]");
  }
  return out;
}

function scrubValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = scrubValue(val);
    }
    return out;
  }
  return v;
}

export function scrubBreadcrumbs(input: unknown): unknown[] | null {
  if (!Array.isArray(input)) return null;
  return input.slice(-50).map((entry) => scrubValue(entry));
}

export function scrubContext(input: unknown): Record<string, unknown> | null {
  if (input == null || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_CONTEXT_KEYS.has(k)) continue;
    out[k] = scrubValue(v);
  }
  return Object.keys(out).length === 0 ? null : out;
}

export type ScrubbableEvent = {
  message?: string | null;
  stack?: string | null;
  componentStack?: string | null;
  url?: string | null;
  breadcrumbs?: unknown;
  context?: unknown;
  [key: string]: unknown;
};

export function scrubEvent<T extends ScrubbableEvent>(evt: T): T {
  const out = { ...evt };
  out.message = scrubString(evt.message ?? "") || "";
  out.stack = scrubString(evt.stack ?? null);
  out.componentStack = scrubString(evt.componentStack ?? null);
  // Strip query strings from URLs — they routinely leak emails / ids.
  if (typeof evt.url === "string" && evt.url) {
    out.url = scrubString(evt.url.split("?")[0]);
  }
  out.breadcrumbs = scrubBreadcrumbs(evt.breadcrumbs);
  out.context = scrubContext(evt.context);
  return out;
}

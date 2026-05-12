// Fire-and-forget telemetry poster. Reuses /api/client-errors so the
// server's app_event ingestion handles validation, scrubbing, and
// rollup. Must never throw or await.

import { safeGet } from "@/utils/safeStorage";

declare global {
  interface Window {
    __irrigoSessionId?: string;
    __APP_VERSION__?: string;
  }
}

type TelemetryEventInput = {
  name: string;
  message?: string;
  source?: "web" | "mobile" | "api" | "worker" | "sw" | "integration";
  type?: "error" | "unhandled_rejection" | "log" | "metric";
  severity?: "info" | "warning" | "error" | "fatal";
  component?: string;
  context?: Record<string, unknown>;
};

function getSessionId(): string | null {
  try {
    return window.__irrigoSessionId
      ?? sessionStorage.getItem("irrigopro:sessionId")
      ?? null;
  } catch {
    return null;
  }
}

function getAppVersion(): string | null {
  try {
    return window.__APP_VERSION__ ?? null;
  } catch {
    return null;
  }
}

function getRoute(): string | null {
  try {
    return window.location.pathname || null;
  } catch {
    return null;
  }
}

type CachedUser = { id?: number; role?: string; companyId?: number; name?: string };

function getCachedUser(): CachedUser | null {
  try {
    const raw = safeGet("user");
    if (!raw) return null;
    return JSON.parse(raw) as CachedUser;
  } catch {
    return null;
  }
}

function getAuthHeaders(u: CachedUser | null): Record<string, string> {
  if (!u) return {};
  const headers: Record<string, string> = {};
  if (u.role) headers["x-user-role"] = u.role;
  if (u.id != null) headers["x-user-id"] = String(u.id);
  if (u.companyId != null) headers["x-user-company-id"] = String(u.companyId);
  if (u.name) headers["x-user-name"] = u.name;
  return headers;
}

export function postTelemetry(evt: TelemetryEventInput): void {
  try {
    const cachedUser = getCachedUser();
    const payload = {
      name: evt.name,
      message: evt.message ?? "",
      source: evt.source ?? "web",
      type: evt.type ?? "metric",
      severity: evt.severity ?? "info",
      component: evt.component ?? getRoute(),
      appVersion: getAppVersion(),
      sessionId: getSessionId(),
      url: getRoute(),
      context: evt.context ?? {},
      // Body-level attribution hints. The server treats these as the
      // lowest-priority source (session > header-auth > body) so a
      // spoofed payload can't override a trusted identity, but in prod
      // (where ALLOW_HEADER_AUTH is off) this lets SW/offline events
      // without an active session cookie still resolve a user/company.
      userId: cachedUser?.id ?? undefined,
      companyId: cachedUser?.companyId ?? undefined,
      role: cachedUser?.role ?? undefined,
    };
    const body = JSON.stringify(payload);
    // Prefer fetch with keepalive so an in-flight request survives a
    // page hide / unload. sendBeacon would also work, but it can't
    // attach the x-user-* headers our super_admin guard inspects.
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(cachedUser) },
      credentials: "include",
      body,
      keepalive: body.length < 60_000,
    }).catch(() => {
      /* swallow — telemetry is best-effort */
    });
  } catch {
    /* swallow */
  }
}

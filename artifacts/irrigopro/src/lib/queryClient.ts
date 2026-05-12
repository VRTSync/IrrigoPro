import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Heartbeat hook so the offline sync engine can update its online state
// from any apiRequest activity, not just its own dispatches and the
// 30s `/api/health` poll. Set by the engine bootstrap in main.tsx.
let apiHeartbeat: ((ok: boolean) => void) | null = null;
export function setApiHeartbeat(fn: ((ok: boolean) => void) | null) {
  apiHeartbeat = fn;
}

export async function apiRequest(
  url: string,
  method: string = "GET",
  data?: unknown | undefined,
): Promise<any> {
  // Use safe storage (works in Safari private browsing too)
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    if (!savedUser) return null;
    try {
      return JSON.parse(savedUser);
    } catch {
      return null;
    }
  };
  
  const user = getCurrentUser();
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  
  // Add user headers if user is logged in - server will validate against session
  if (user?.role) {
    headers["x-user-role"] = user.role;
    headers["x-user-id"] = user.id?.toString() || "";
    headers["x-user-name"] = user.name || "";
    headers["x-user-company-id"] = user.companyId?.toString() || "";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      // Task #469 — defense-in-depth against a stale PWA shell or HTTP
      // cache returning a generic HTML 403/login page for an /api/*
      // request. `no-store` skips any browser/SW cache for this fetch
      // so the real Express response is what the engine sees.
      cache: "no-store",
    });
  } catch (e) {
    if (apiHeartbeat) try { apiHeartbeat(false); } catch {}
    throw e;
  }
  if (apiHeartbeat) {
    try { apiHeartbeat(res.status < 500); } catch {}
  }

  await throwIfResNotOk(res);
  return await res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Use safe storage (works in Safari private browsing too)
    const getCurrentUser = () => {
      const savedUser = safeGet("user");
      if (!savedUser) return null;
      try {
        return JSON.parse(savedUser);
      } catch {
        return null;
      }
    };
    
    const user = getCurrentUser();
    const headers: Record<string, string> = {};
    
    // Add user headers if user is logged in - server will validate against session
    if (user?.role) {
      headers["x-user-role"] = user.role;
      headers["x-user-id"] = user.id?.toString() || "";
      headers["x-user-name"] = user.name || "";
      headers["x-user-company-id"] = user.companyId?.toString() || "";
    }

    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Build an `<img src>`-friendly URL for the authenticated photo proxy.
// Browsers cannot attach custom headers (`x-user-id`, etc.) to `<img>`
// requests — they only send cookies — and this app authenticates via
// headers, not session cookies. The server's `requireAuthentication`
// middleware already accepts the same identifiers as query parameters
// (the same fallback used for opening PDFs in new tabs), so we mirror
// that here for thumbnails and gallery previews.
export function authedPhotoSrc(
  photoId: string,
  variant?: "thumb" | "medium" | "original",
): string {
  const raw = safeGet("user");
  let user: { id?: number | string; role?: string; companyId?: number | string; name?: string } | null = null;
  if (raw) {
    try { user = JSON.parse(raw); } catch { user = null; }
  }
  const params = new URLSearchParams();
  if (user?.id != null) params.set("x-user-id", String(user.id));
  if (user?.role) params.set("x-user-role", user.role);
  if (user?.companyId != null) params.set("x-user-company-id", String(user.companyId));
  if (variant) params.set("variant", variant);
  const qs = params.toString();
  return `/api/photos/${encodeURIComponent(photoId)}${qs ? `?${qs}` : ""}`;
}

export function parseApiError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const jsonStart = message.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed: unknown = JSON.parse(message.slice(jsonStart));
      if (parsed !== null && typeof parsed === "object" && "message" in parsed && typeof (parsed as Record<string, unknown>).message === "string") {
        return (parsed as Record<string, unknown>).message as string;
      }
    } catch {
    }
  }
  return fallback;
}

// Task #532 — connection-aware polling helper. Components that opt into
// background polling pass their nominal interval through this helper so
// that:
//   - on a fast/typical connection, the original cadence is used
//   - on `4g`/`3g`-with-saveData, polling is doubled
//   - on `2g`/`slow-2g` (or browser-reported saveData), polling backs off
//     to once every 5 minutes — usually plenty for badge counts
//   - if the user explicitly enables Data Saver, we also back off
// Returns `false` to disable polling entirely when the network looks
// hostile to background traffic. Combine with `refetchIntervalInBackground:
// false` (now the default below) so hidden tabs don't compete with the
// active screen for bandwidth either.
export function adaptiveRefetchInterval(baseMs: number): number | false {
  if (typeof navigator === "undefined") return baseMs;
  const conn: any =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  if (!conn) return baseMs;
  const eff = String(conn.effectiveType || "").toLowerCase();
  const saveData = conn.saveData === true;
  if (eff === "slow-2g" || eff === "2g") return 5 * 60_000;
  if (saveData) return Math.max(baseMs * 2, 2 * 60_000);
  if (eff === "3g") return Math.max(baseMs * 2, baseMs);
  return baseMs;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // Task #532 — never poll a hidden tab. Components that schedule
      // their own `refetchInterval` are explicitly opting into a poll;
      // we still don't want it to run while the tab is in the background
      // and the user can't see the result anyway. Saves a lot of bandwidth
      // for techs who switch between the app and a phone call.
      refetchIntervalInBackground: false,
      // Refresh stale data when the device comes back online.
      refetchOnReconnect: true,
      staleTime: Infinity,
      retry: false,
      throwOnError: false,
    },
    mutations: {
      retry: false,
      throwOnError: false,
    },
  },
});

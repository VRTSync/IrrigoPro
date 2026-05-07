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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
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

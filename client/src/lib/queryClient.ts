import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { safeGet } from "@/utils/safeStorage";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  url: string,
  method: string = "GET",
  data?: unknown | undefined,
): Promise<any> {
  // Use safe storage (works in Safari private browsing too)
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    return savedUser ? JSON.parse(savedUser) : null;
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

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

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
      return savedUser ? JSON.parse(savedUser) : null;
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

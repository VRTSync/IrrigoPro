import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
  // Always get current user from session, not localStorage
  const getCurrentUser = async () => {
    try {
      const response = await fetch("/api/auth/user", {
        credentials: "include"
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // Fallback to localStorage for development/transition
      const savedUser = localStorage.getItem("user");
      return savedUser ? JSON.parse(savedUser) : null;
    }
    return null;
  };
  
  const user = await getCurrentUser();
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
  
  // Add user headers if user is logged in
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
    // Always get current user from session, not localStorage
    const getCurrentUser = async () => {
      try {
        const response = await fetch("/api/auth/user", {
          credentials: "include"
        });
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        // Fallback to localStorage for development/transition
        const savedUser = localStorage.getItem("user");
        return savedUser ? JSON.parse(savedUser) : null;
      }
      return null;
    };
    
    const user = await getCurrentUser();
    const headers: Record<string, string> = {};
    
    // Add user headers if user is logged in
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

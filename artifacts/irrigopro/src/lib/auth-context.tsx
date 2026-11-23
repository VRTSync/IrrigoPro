import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { safeGet, safeRemove, safeSet } from "@/utils/safeStorage";
import { apiRequest, clearSessionAndLogout } from "@/lib/queryClient";
import type { Role } from "@workspace/shared";

export type WebUser = {
  id: number;
  username: string;
  name: string;
  email: string;
  role: Role;
  companyId?: number | null;
  isActive: boolean;
};

type AuthContextValue = {
  user: WebUser | null;
  isLoading: boolean;
  setUser: (user: WebUser | null) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readUserFromStorage(): WebUser | null {
  try {
    const saved = safeGet("user");
    if (saved) return JSON.parse(saved) as WebUser;
  } catch (e) {
    console.error("[auth] error parsing saved user:", e);
    try {
      safeRemove("user");
    } catch {}
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Lazy initialiser: reads localStorage synchronously so the very first
  // render already knows the last saved role. Eliminates the stale-null window
  // that caused super_admin to land on AdminDashboard on BFCache restore.
  const [user, setUserState] = useState<WebUser | null>(readUserFromStorage);

  // isLoading is only true momentarily when no saved user was found (fresh
  // first visit / after logout). Session verification runs in the background
  // so it doesn't block a field user's offline start.
  const [isLoading, setIsLoading] = useState<boolean>(
    () => readUserFromStorage() === null,
  );

  useEffect(() => {
    setIsLoading(false);

    let active = true;
    const storedSnapshot = safeGet("user");
    const stored = readUserFromStorage();
    if (stored && navigator.onLine !== false) {
      void apiRequest("/api/auth/user", "GET")
        .then((server: WebUser) => {
          // Don't restore a stale account if logout or login already changed it.
          if (!active || safeGet("user") !== storedSnapshot) return;
          const changed =
            server.id !== stored.id ||
            server.role !== stored.role ||
            (server.companyId ?? null) !== (stored.companyId ?? null);
          const refreshed = { ...stored, ...server };
          safeSet("user", JSON.stringify(refreshed));
          if (changed) {
            window.location.reload();
            return;
          }
          setUserState(refreshed);
        })
        .catch(() => {
          // Keep the stored user offline. apiRequest already handles a 401
          // through the existing unauthenticated-read path.
        });
    }

    // BFCache guard: when the browser restores this page from the
    // Back-Forward Cache re-read localStorage so any post-login user change
    // is reflected without a hard refresh.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      try {
        setUserState(readUserFromStorage());
      } catch (e) {
        console.error("[auth] BFCache re-read failed:", e);
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      active = false;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  // setUser — updates both the React state and localStorage so non-React
  // callers (apiRequest, impersonation helpers) that read safeGet("user")
  // stay in sync with the context.
  const setUser = useCallback((next: WebUser | null) => {
    if (next === null) {
      safeRemove("user");
    } else {
      safeSet("user", JSON.stringify(next));
    }
    setUserState(next);
  }, []);

  const logout = useCallback(() => {
    setUserState(null);
    clearSessionAndLogout();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, setUser, logout }),
    [user, isLoading, setUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

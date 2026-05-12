import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ApiError,
  apiRequest,
  getStoredTokens,
  setToken,
  setUnauthorizedHandler,
} from "@/lib/api";

const USER_CACHE_KEY = "irrigopro.mobile.user.v1";

export type MobileUser = {
  id: number;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  companyId: number | null;
  companyName?: string | null;
};

type LoginResponse = {
  token: string;
  expiresAt: string;
  // Task #521 — present on every server >= the refresh-token rollout.
  // Optional in the type so the client compiles against older API
  // builds (and we degrade to no-refresh behavior in that case).
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user: MobileUser;
};

type AuthContextValue = {
  user: MobileUser | null;
  isLoading: boolean;
  signIn: (input: {
    username: string;
    password: string;
    deviceName?: string | null;
  }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const signOutInFlight = useRef(false);

  const clearLocal = useCallback(async () => {
    await setToken(null);
    await AsyncStorage.removeItem(USER_CACHE_KEY).catch(() => undefined);
    setUser(null);
  }, []);

  // Bootstrap: hydrate cached user, then revalidate token in the background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(USER_CACHE_KEY);
        if (cached && !cancelled) {
          try {
            setUser(JSON.parse(cached) as MobileUser);
          } catch {
            // ignore malformed cache
          }
        }
        // Revalidate against the server. /api/auth/user returns the bearer
        // user; on 401 the api layer already clears the token + signals.
        try {
          const fresh = await apiRequest<MobileUser>("/api/auth/user");
          if (!cancelled) {
            setUser(fresh);
            await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(fresh));
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            if (!cancelled) await clearLocal();
          }
          // For network errors, keep the cached user and let the app render.
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearLocal]);

  // Wire 401 handler so any API call that fails with 401 boots us back
  // to the sign-in screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearLocal();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  const signIn = useCallback(
    async ({
      username,
      password,
      deviceName,
    }: {
      username: string;
      password: string;
      deviceName?: string | null;
    }) => {
      const result = await apiRequest<LoginResponse>("/api/auth/mobile-login", {
        method: "POST",
        body: { username, password, deviceName: deviceName ?? null },
        handle401: false,
      });
      // Prefer the explicit access/refresh shape; fall back to the
      // legacy single-token field if talking to a pre-Task #521 server.
      const accessToken = result.accessToken ?? result.token;
      await setToken({
        accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt ?? result.expiresAt ?? null,
        refreshToken: result.refreshToken ?? null,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt ?? null,
      });
      await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(result.user));
      // Trigger the user-change effect in `useSyncEngine` (which calls
      // resetAuthFailedEntries + drainQueue) by setting the user last.
      setUser(result.user);
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (signOutInFlight.current) return;
    signOutInFlight.current = true;
    try {
      try {
        // Pass the refresh token so the server can revoke it
        // explicitly even if the access token has already expired and
        // would otherwise have left the refresh half live for 90 days.
        const stored = await getStoredTokens().catch(() => null);
        await apiRequest("/api/auth/mobile-logout", {
          method: "POST",
          body: stored?.refreshToken ? { refreshToken: stored.refreshToken } : {},
          handle401: false,
        });
      } catch {
        // Ignore — logout is idempotent and the token is being cleared anyway.
      }
      await clearLocal();
    } finally {
      signOutInFlight.current = false;
    }
  }, [clearLocal]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, signIn, signOut }),
    [user, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

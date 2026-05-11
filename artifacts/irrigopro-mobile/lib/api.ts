import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "irrigopro.mobile.token.v1";

const DOMAIN =
  process.env.EXPO_PUBLIC_API_DOMAIN ||
  process.env.EXPO_PUBLIC_DOMAIN ||
  "";

export const API_BASE_URL = DOMAIN
  ? DOMAIN.startsWith("http")
    ? DOMAIN.replace(/\/+$/, "")
    : `https://${DOMAIN.replace(/\/+$/, "")}`
  : "";

let cachedToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const stored = await SecureStore.getItemAsync(TOKEN_KEY);
    cachedToken = stored;
    return stored;
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  }
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export type ApiRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** When true (default), 401 responses clear the token + signal logout. */
  handle401?: boolean;
};

export async function apiRequest<T = unknown>(
  path: string,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {}, handle401 = true } = opts;
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) {
    finalHeaders["Content-Type"] = "application/json";
  }
  const token = await getToken();
  if (token && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && handle401) {
      await setToken(null);
      unauthorizedHandler?.();
    }
    const message =
      (data && typeof data === "object" && "message" in (data as object)
        ? String((data as { message: unknown }).message)
        : null) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

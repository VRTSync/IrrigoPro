import { vi } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";

export interface Call { method: string; path: string; search: string; body: unknown }
export type Reply = { status: number; body?: unknown };
export type Route = (call: Call) => Reply | undefined;

export const activeSchedule = {
  id: 11, companyId: 5, name: "Standard 2026", effectiveDate: "2026-01-01", isActive: true,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};
export const oldSchedule = {
  ...activeSchedule, id: 7, name: "Standard 2025", effectiveDate: "2025-01-01", isActive: false,
  createdAt: "2025-01-01T00:00:00Z",
};
export const activeContext = { schedule: activeSchedule, tiers: DEFAULT_MARKUP_TIERS };

/** Intercepts global fetch at the real customFetch boundary; records every call. */
export function installFetch(route: Route) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const call: Call = {
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      search: url.search,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = route(call) ?? { status: 500, body: { message: `unrouted ${call.method} ${call.path}` } };
    if (reply.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

export function polyfillDom() {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

export function renderWithClient(ui: ReactNode, defaultQueryFn?: (key: readonly unknown[]) => unknown) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, ...(defaultQueryFn ? { queryFn: async ({ queryKey }) => defaultQueryFn(queryKey) } : {}) },
      mutations: { retry: false },
    },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

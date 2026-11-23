import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "@/App";
import { AuthProvider, type WebUser } from "@/lib/auth-context";
import { clearSessionAndLogout } from "@/lib/queryClient";

// Keep the real role routes and logout helper; isolate unrelated shell polling.
vi.mock("@/components/layout/desktop-shell", () => ({
  DesktopShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/layout/navigation", () => ({ default: () => null }));
vi.mock("@/components/layout/powered-by-footer", () => ({ default: () => null }));
vi.mock("@/components/offline/service-worker-update-prompt", () => ({
  ServiceWorkerRegistration: () => null,
  ServiceWorkerUpdatePrompt: () => null,
}));
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  return { ...actual, clearSessionAndLogout: vi.fn(actual.clearSessionAndLogout) };
});

const roles = [
  "super_admin",
  "company_admin",
  "irrigation_manager",
  "billing_manager",
  "bookkeeper",
  "field_tech",
  "system_documenter",
] as const satisfies readonly WebUser["role"][];

let seededUser: WebUser;
const fetchStub = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  if (input === "/api/auth/user") return Response.json(seededUser);
  if (input === "/api/system-documentation/sites") return Response.json({ customers: [] });
  return new Response(null, { status: 204 });
});

beforeEach(() => {
  fetchStub.mockClear();
  vi.mocked(clearSessionAndLogout).mockClear();
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("/switch-user", () => {
  it.each(roles)("uses the existing fallback for %s without signing out", async (role) => {
    seededUser = {
      id: 31, role, name: "Route Test", companyId: 1,
      username: "route-test", email: "route-test@example.test", isActive: true,
    };
    localStorage.setItem("user", JSON.stringify(seededUser));
    localStorage.setItem("onboarding_completed", "true");

    const nav = memoryLocation({ path: "/switch-user", record: true });
    render(
      <Router hook={nav.hook} searchHook={nav.searchHook}>
        <AuthProvider><AppRoutes /></AuthProvider>
      </Router>,
    );

    if (role === "system_documenter") {
      expect(await screen.findByRole("heading", { name: "Which property?" })).toBeInTheDocument();
      expect(nav.history.at(-1)).toBe("/");
    } else {
      expect(await screen.findByRole("heading", { name: "404 Page Not Found" })).toBeInTheDocument();
    }
    expect(fetchStub).toHaveBeenCalledWith("/api/auth/user", expect.objectContaining({ method: "GET" }));
    expect(clearSessionAndLogout).not.toHaveBeenCalled();
    const requestedPaths = fetchStub.mock.calls.map(([input]) =>
      new URL(input instanceof Request ? input.url : input, window.location.origin).pathname,
    );
    expect(requestedPaths).not.toContain("/api/auth/logout");
    expect(requestedPaths).not.toContain("/api/users");
    expect(JSON.parse(localStorage.getItem("user")!)).toEqual(seededUser);
  });
});

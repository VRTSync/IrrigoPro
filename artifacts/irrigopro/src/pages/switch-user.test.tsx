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

const fetchStub = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
  it.each(roles)("signs out %s without requesting the user list", async (role) => {
    const user: WebUser = {
      id: 31, role, name: "Switch User Test", companyId: 1,
      username: "switch-test", email: "switch-test@example.test", isActive: true,
    };
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("onboarding_completed", "true");

    const nav = memoryLocation({ path: "/switch-user" });
    render(
      <Router hook={nav.hook} searchHook={nav.searchHook}>
        <AuthProvider><AppRoutes /></AuthProvider>
      </Router>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Signing out to switch accounts…");
    expect(clearSessionAndLogout).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
    const requestedPaths = fetchStub.mock.calls.map(([input]) =>
      new URL(input instanceof Request ? input.url : input, window.location.origin).pathname,
    );
    expect(requestedPaths.filter((path) => path === "/api/auth/logout")).toHaveLength(1);
    expect(requestedPaths).not.toContain("/api/users");
    expect(localStorage.getItem("user")).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { memoryLocation } from "wouter/memory-location";
import { Router } from "wouter";

vi.mock("@/pages/login", () => ({ default: () => <div>Login page</div> }));
vi.mock("@/pages/field-tech-dashboard", () => ({ default: () => <div>Field tech dashboard</div> }));
vi.mock("@/pages/admin-dashboard", () => ({ default: () => <div>AdminDashboard</div> }));
vi.mock("@/pages/manager-workspace", () => ({ default: () => <div>Manager workspace</div> }));
vi.mock("@/pages/estimate-approval", () => ({ default: () => <div>Estimate approval</div> }));
vi.mock("@/components/company-admin-app", () => ({ default: () => <div>Company admin app</div> }));
vi.mock("@/components/layout/navigation", () => ({ default: () => <nav>Navigation</nav> }));
vi.mock("@/components/layout/desktop-shell", () => ({
  DesktopShell: () => <nav>Desktop admin shell</nav>,
}));
vi.mock("@/components/offline/service-worker-update-prompt", () => ({
  ServiceWorkerRegistration: () => null, ServiceWorkerUpdatePrompt: () => null,
}));
vi.mock("@/components/offline/conflict-toast-bridge", () => ({ ConflictToastBridge: () => null }));
vi.mock("@/lib/queryClient", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  return { ...actual, clearSessionAndLogout: vi.fn(actual.clearSessionAndLogout) };
});

import { AppRoutes } from "./App";
import { AuthProvider } from "@/lib/auth-context";
import { clearSessionAndLogout, queryClient } from "@/lib/queryClient";
import { UnsupportedRoleScreen } from "@/components/auth/unsupported-role-screen";

const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
  vi.mocked(clearSessionAndLogout).mockClear();
  localStorage.clear();
  queryClient.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(role: string, path: string) {
  localStorage.setItem("user", JSON.stringify({ id: 1, role, name: "Fixture", companyId: 1 }));
  const location = memoryLocation({ path });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <AuthProvider><AppRoutes /></AuthProvider>
    </Router>,
  );
}

describe("unsupported roles fail closed at real app routing", () => {
  for (const [role, path] of [
    ["wizard", "/"],
  ]) {
    it(`${role} at ${path} mounts only the unsupported card, with no queries`, async () => {
      mount(role, path);
      expect(screen.getByRole("heading", { name: "No screens for this account" })).toBeTruthy();
      expect(screen.getByText(`This account's role (${role}) has no screens in IrrigoPro yet. Ask your company admin to check your role.`)).toBeTruthy();
      expect(screen.queryByText("AdminDashboard")).toBeNull();
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.queryByText("Company admin app")).toBeNull();
      expect(screen.queryByText("Desktop admin shell")).toBeNull();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    });
  }
  it("the Log out button uses the existing logout, clears user/cache and posts logout", async () => {
    mount("wizard", "/");
    queryClient.setQueryData(["private-fixture"], { secret: true });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(clearSessionAndLogout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("user")).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", credentials: "include" });
  });
  it("the standalone screen does not need a query provider or navigation", () => {
    render(<UnsupportedRoleScreen role="wizard" />);
    expect(screen.getByRole("heading").parentElement?.className).toBe("max-w-sm mx-auto mt-24 rounded-xl border bg-white p-6 shadow-sm");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("keeps existing-role entry routes rather than sending them to the fallback", () => {
    for (const [role, text] of [
      ["company_admin", "Company admin app"], ["field_tech", "Field tech dashboard"],
      ["irrigation_manager", "Desktop admin shell"], ["billing_manager", "Desktop admin shell"],
      ["bookkeeper", "Desktop admin shell"], ["super_admin", "Desktop admin shell"],
      ["system_documenter", "System Documenter"],
    ]) {
      mount(role, "/");
      expect(screen.queryByText("No screens for this account")).toBeNull();
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });
});

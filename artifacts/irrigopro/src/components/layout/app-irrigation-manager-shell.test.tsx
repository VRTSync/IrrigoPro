/**
 * app-irrigation-manager-shell.test.tsx (Task #1004 — Slice 5)
 *
 * Smoke test: mounting DesktopShell with managerNav (the same config wired
 * into the irrigation_manager role block in App.tsx) renders a
 * [data-testid="desktop-shell"] element and includes the canonical "Wet Checks"
 * nav entry.
 *
 * We render DesktopShell directly rather than the full App to avoid mounting
 * all lazily-loaded page components, while still exercising the exact shell +
 * navConfig combination that the irrigation_manager role sees.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth-context";

vi.mock("@/components/layout/navigation", () => ({
  default: () => <div data-testid="mock-navigation" />,
}));

vi.mock("@/components/layout/powered-by-footer", () => ({
  default: () => <div data-testid="mock-powered-by-footer" />,
}));

vi.mock("@/components/notifications/notification-system", () => ({
  NotificationSystem: () => <div data-testid="mock-notification-system" />,
}));

vi.mock("@/components/app-health/impersonation-banner", () => ({
  ImpersonationBanner: () => <div data-testid="mock-impersonation-banner" />,
}));

vi.mock("@/utils/safeStorage", () => ({
  safeGet: (key: string) => {
    if (key === "user") {
      return JSON.stringify({
        id: 42,
        name: "Test Manager",
        role: "irrigation_manager",
      });
    }
    return null;
  },
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));

vi.mock("@assets/IrrigoPro_2026-03_1778193170303.png", () => ({
  default: "logo.png",
}));
vi.mock("@assets/IrrigoPro_2026-05_1778193170303.png", () => ({
  default: "mark.png",
}));

vi.mock("@/components/layout/route-meta", () => ({
  resolveRouteMeta: () => ({ breadcrumb: [{ label: "Dashboard" }] }),
}));

import { DesktopShell } from "./desktop-shell";
import { managerNav } from "./nav-config";

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1366);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => vi.unstubAllGlobals());

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => null } },
  });
}

function mount() {
  return render(
    <AuthProvider>
      <QueryClientProvider client={makeQueryClient()}>
        <DesktopShell navConfig={managerNav}>
          <div>content</div>
        </DesktopShell>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe("irrigation_manager DesktopShell smoke test (Task #1004)", () => {
  it("renders a desktop-shell element when using managerNav", () => {
    mount();
    expect(screen.getByTestId("desktop-shell")).toBeTruthy();
  });

  it("renders the canonical Wet Checks nav link", () => {
    mount();
    expect(screen.getByRole("link", { name: "Wet Checks" })).toHaveAttribute("href", "/wet-checks");
  });

  it("renders 'Wet Check' group label", () => {
    mount();
    expect(screen.getByText("Wet Check")).toBeTruthy();
  });
});

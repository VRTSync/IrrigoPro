/**
 * app-irrigation-manager-shell.test.tsx (Task #1004 — Slice 5)
 *
 * Smoke test: mounting DesktopShell with managerNav (the same config wired
 * into the irrigation_manager role block in App.tsx) renders a
 * [data-testid="desktop-shell"] element and includes the "Wet Check Reviews"
 * nav entry.
 *
 * We render DesktopShell directly rather than the full App to avoid mounting
 * all lazily-loaded page components, while still exercising the exact shell +
 * navConfig combination that the irrigation_manager role sees.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

describe("irrigation_manager DesktopShell smoke test (Task #1004)", () => {
  it("renders a desktop-shell element when using managerNav", () => {
    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <DesktopShell navConfig={managerNav}>
          <div>content</div>
        </DesktopShell>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("desktop-shell")).toBeTruthy();
  });

  it("renders 'Wet Check Reviews' nav entry", () => {
    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <DesktopShell navConfig={managerNav}>
          <div>content</div>
        </DesktopShell>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Wet Check Reviews")).toBeTruthy();
  });

  it("renders 'Wet Check' group label", () => {
    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <DesktopShell navConfig={managerNav}>
          <div>content</div>
        </DesktopShell>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Wet Check")).toBeTruthy();
  });
});

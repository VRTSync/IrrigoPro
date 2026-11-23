import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
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

import { DesktopShell } from "./desktop-shell";

beforeEach(() => {
  vi.stubGlobal("innerWidth", 1366);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ total: 3 })));
});

afterEach(() => vi.unstubAllGlobals());

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) =>
          queryKey[0] === "/api/wet-checks/pending-review" ? [{ id: 1 }, { id: 2 }]
            : queryKey[0] === "/api/estimates/pending-approval" ? [{ id: 1 }]
            : null,
      },
    },
  });
}

function mount(path = "/wet-checks") {
  const location = memoryLocation({ path });
  return render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <AuthProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <DesktopShell role="irrigation_manager">
            <div>content</div>
          </DesktopShell>
        </QueryClientProvider>
      </AuthProvider>
    </Router>,
  );
}

describe("irrigation manager sidebar", () => {
  it("starts with only the active section open and opens the reviews tab on click", () => {
    mount();
    expect(screen.getByTestId("desktop-shell")).toBeInTheDocument();
    const field = screen.getByRole("button", { name: "Field Work" });
    const approvals = screen.getByRole("button", { name: "Approvals" });
    const parts = screen.getByRole("button", { name: "Parts" });
    expect(screen.getAllByRole("button", { expanded: true })).toEqual([field]);
    expect(screen.getByRole("link", { name: "Wet Checks" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(parts);
    fireEvent.click(approvals);
    const reviews = screen.getByRole("link", { name: "Wet Check Reviews" });
    expect(reviews).toHaveAttribute("href", "/wet-checks?tab=needs-review");
    expect(reviews).not.toHaveAttribute("aria-current");
    fireEvent.click(reviews);

    expect(screen.getAllByRole("button", { expanded: true })).toEqual([approvals]);
    expect(reviews).toHaveAttribute("aria-current", "page");
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(["Approvals", "Wet Check Reviews"]);
  });

  it("shows the sum on a collapsed section and individual counts when expanded", async () => {
    mount("/");
    const row = within(screen.getByRole("button", { name: "Approvals" }).closest("li")!);
    expect(await row.findByText("5")).toBeVisible();
    fireEvent.click(row.getByRole("button", { name: "Approvals" }));
    expect(row.queryByText("5")).not.toBeInTheDocument();
    expect(within(row.getByRole("link", { name: "Manager Workspace" }).closest("li")!).getByText("3")).toBeVisible();
    expect(within(row.getByRole("link", { name: "Wet Check Reviews" }).closest("li")!).getByText("2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Field Work" }));
    expect(await within(screen.getByRole("link", { name: "Estimates" }).closest("li")!).findByText("1")).toBeVisible();
  });
});

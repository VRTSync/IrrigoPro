import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AuthProvider } from "@/lib/auth-context";
import { safeGet, safeSet } from "@/utils/safeStorage";

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
    return localStorage.getItem(key);
  },
  safeSet: vi.fn((key: string, value: string) => localStorage.setItem(key, value)),
  safeRemove: (key: string) => localStorage.removeItem(key),
}));

vi.mock("@assets/IrrigoPro_2026-05_1778193170303.png", () => ({
  default: "mark.png",
}));

import { DesktopShell } from "./desktop-shell";

let viewportWidth: number;
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  viewportWidth = 1366;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(min-width: 1200px)" && viewportWidth >= 1200,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/auth/user") return Response.json(JSON.parse(safeGet("user") ?? "null"));
    return Response.json({ total: 3 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  const location = memoryLocation({ path, record: true });
  const rendered = render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <AuthProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <DesktopShell role="irrigation_manager">
            <input aria-label="Search work" />
            <textarea aria-label="Long notes" />
            <select aria-label="Work filter"><option>All</option></select>
            <div contentEditable tabIndex={0} aria-label="Notes" />
          </DesktopShell>
        </QueryClientProvider>
      </AuthProvider>
    </Router>,
  );
  return { ...location, unmount: rendered.unmount };
}

describe("irrigation manager rail and panel", () => {
  const rail = () => within(screen.getByRole("navigation", { name: "Desktop sections" }));
  const panel = () => within(screen.getByTestId("pages-panel"));
  const toggle = () => screen.getByTestId("button-toggle-main-menu");

  it("shows six sections and follows the reviews tab on the shared wet-check route", () => {
    const location = mount();
    expect(rail().getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Dashboard", "Field", "Approvals", "Clients", "Insights", "Parts", "Account"]);
    expect(panel().getByRole("link", { name: "Wet Checks" })).toHaveAttribute("aria-current", "page");
    act(() => location.navigate("/wet-checks?tab=needs-review"));
    expect(rail().getByRole("button", { name: "Approvals" })).toHaveAttribute("aria-current", "true");
    expect(panel().getByRole("heading", { name: "Approvals" })).toBeVisible();
    expect(panel().getByRole("link", { name: "Wet Check Reviews" })).toHaveAttribute("aria-current", "page");
    const breadcrumb = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    expect(breadcrumb.getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(["Approvals", "Wet Check Reviews"]);
  });

  it("navigates to the first Field page, then back to its most recently visited page", () => {
    const location = mount("/");
    expect(screen.queryByTestId("pages-panel")).not.toBeInTheDocument();
    fireEvent.click(rail().getByRole("button", { name: "Field" }));
    expect(location.history.at(-1)).toBe("/action-board");
    fireEvent.click(panel().getByRole("link", { name: "Work Orders" }));
    expect(location.history.at(-1)).toBe("/work-orders");
    fireEvent.click(rail().getByRole("button", { name: "Approvals" }));
    expect(location.history.at(-1)).toBe("/manager-workspace");
    fireEvent.click(rail().getByRole("button", { name: "Field" }));
    expect(location.history.at(-1)).toBe("/work-orders");
    expect(panel().getByRole("link", { name: "Work Orders" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the last matched section on an unlisted route, but not on an unmatched first load", () => {
    const location = mount("/user-profile");
    expect(screen.queryByTestId("pages-panel")).not.toBeInTheDocument();
    act(() => location.navigate("/work-orders"));
    act(() => location.navigate("/user-profile"));
    expect(panel().getByRole("heading", { name: "Field Work" })).toBeVisible();
    expect(panel().getByRole("link", { name: "Work Orders" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the section sum while showing individual page counts", async () => {
    mount("/");
    const button = rail().getByRole("button", { name: "Approvals" });
    const row = within(button);
    expect(await row.findByText("5")).toBeVisible();
    fireEvent.click(button);
    expect(row.getByText("5")).toBeVisible();
    expect(within(panel().getByRole("link", { name: "Manager Workspace" })).getByText("3")).toBeVisible();
    expect(within(panel().getByRole("link", { name: "Wet Check Reviews" })).getByText("2")).toBeVisible();
  });

  it("toggles with Cmd+B and the button, saves the preference, and never hides Work Orders pages", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const first = mount("/work-orders");
    const pages = screen.getByTestId("pages-panel");
    expect(toggle()).toHaveAccessibleName("Expand main menu");
    expect(toggle()).toHaveAttribute("title", "Expand main menu (Cmd+B)");
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(toggle()).toHaveAccessibleName("Collapse main menu");
    expect(toggle()).toHaveAttribute("title", "Collapse main menu (Cmd+B)");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    expect(safeSet).toHaveBeenCalledWith("irrigopro_nav_expanded", "true");
    expect(screen.getByTestId("pages-panel")).toBe(pages);
    expect(await screen.findByText("Press Cmd+B (Ctrl+B on Windows) to show section names in the main menu.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss hint" }));

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(safeSet).toHaveBeenCalledWith("irrigopro_nav_expanded", "false");
    expect(screen.getByTestId("pages-panel")).toBe(pages);
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    first.unmount();

    mount("/work-orders");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(rail().getByRole("button", { name: "Collapse menu" }));
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("irrigopro_nav_expanded")).toBe("false");
    expect(panel().getByRole("link", { name: "Work Orders" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Dismiss hint" })).not.toBeInTheDocument();
  });

  it("deletes the old preference without hiding the pages menu", () => {
    const retiredKey = "irrigopro_nav_panel_open";
    localStorage.setItem(retiredKey, "false");
    mount("/work-orders");
    expect(localStorage.getItem(retiredKey)).toBeNull();
    expect(panel().getByRole("link", { name: "Work Orders" })).toHaveAttribute("aria-current", "page");
  });

  it("ignores Ctrl+B while editing and below 1200 px", () => {
    mount("/work-orders");
    for (const name of ["Search work", "Long notes", "Work filter", "Notes"]) {
      const field = screen.getByLabelText(name);
      field.focus();
      expect(fireEvent.keyDown(field, { key: "b", ctrlKey: true })).toBe(true);
      field.blur();
    }
    for (viewportWidth of [820, 1024, 1199]) {
      expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(true);
    }
    expect(safeSet).not.toHaveBeenCalled();
    viewportWidth = 1200;
    expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(false);
    expect(localStorage.getItem("irrigopro_nav_expanded")).toBe("true");
    expect(panel().getByRole("link", { name: "Work Orders" })).toHaveAttribute("aria-current", "page");
  });
});

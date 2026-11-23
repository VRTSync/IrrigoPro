import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DesktopShell } from "./desktop-shell";
import { JumpToProvider, useJumpTo } from "./jump-to";
import { navForRole } from "./nav-config";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: 1, name: "Jump To Fixture" } }),
}));
vi.mock("@/components/notifications/notification-system", () => ({
  NotificationSystem: () => <button type="button" aria-label="Notifications" />,
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1366);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function PageFixture() {
  const { open, close, isOpen } = useJumpTo();
  return (
    <>
      <input aria-label="Page field" onKeyDown={(event) => event.stopPropagation()} />
      <button type="button" onClick={open} aria-expanded={isOpen}>Open from a page</button>
      <button type="button" onClick={close}>Close from a page</button>
    </>
  );
}

function renderJumpTo(role = "company_admin", shell = false) {
  const location = memoryLocation({ path: "/work-orders", record: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { queryFn: async () => [], retry: false } } });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <QueryClientProvider client={queryClient}>
        {shell
          ? <DesktopShell role={role}><PageFixture /></DesktopShell>
          : <JumpToProvider role={role}><PageFixture /></JumpToProvider>}
      </QueryClientProvider>
    </Router>,
  );
  return location;
}

function openWithShortcut() {
  expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: "k", ctrlKey: true })).toBe(false);
  return within(screen.getByRole("dialog", { name: "Jump to a page" }));
}

function optionIds(dialog: ReturnType<typeof within>) {
  return dialog.getAllByRole("option").map((option) =>
    option.getAttribute("data-testid")?.replace("option-jump-to-", ""),
  );
}

describe("Jump To", () => {
  it("opens with Ctrl+K, closes with Esc, and works in a focused text field", async () => {
    renderJumpTo();
    const user = userEvent.setup();
    const dialog = openWithShortcut();
    expect(dialog.getByRole("combobox", { name: "Jump to a page" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const field = screen.getByRole("textbox", { name: "Page field" });
    await user.click(field);
    const input = openWithShortcut().getByRole("combobox");
    expect(input).toHaveFocus();
    await user.type(input, "inv");
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(field).toHaveFocus());
    expect(openWithShortcut().getByRole("combobox")).toHaveValue("");
  });

  it("opens and closes with Cmd+K without toggling the main menu", async () => {
    localStorage.setItem("irrigopro_desktop_shell_seen", "true");
    renderJumpTo("company_admin", true);
    const toggle = screen.getByRole("button", { name: "Expand main menu" });
    const user = userEvent.setup();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByRole("dialog", { name: "Jump to a page" })).toBeInTheDocument();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pages-panel")).toBeInTheDocument();
  });

  it("filters by label, highlights Invoices, and navigates to it on Enter", async () => {
    const location = renderJumpTo();
    const dialog = openWithShortcut();
    const user = userEvent.setup();
    await user.type(dialog.getByPlaceholderText("Type a page name..."), "inv");
    expect(dialog.getByRole("option", { name: /Invoices QuickBooks invoices and aging/ }))
      .toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(location.history).toEqual(["/work-orders", "/invoices"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens Wet Check Reviews with its needs-review query string intact", async () => {
    const location = renderJumpTo();
    const dialog = openWithShortcut();
    const user = userEvent.setup();
    await user.type(dialog.getByRole("combobox"), "reviews");
    await user.click(dialog.getByRole("option", { name: /^Wet Check Reviews/ }));
    expect(location.history).toEqual(["/work-orders", "/wet-checks?tab=needs-review"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses section names and descriptions, and keeps config order while filtering", async () => {
    renderJumpTo();
    const dialog = openWithShortcut();
    const input = dialog.getByRole("combobox");
    const sections = navForRole("company_admin");
    const expectedOrder = sections.flatMap(({ pages }) => pages.map(({ id }) => id));
    expect(optionIds(dialog)).toEqual(expectedOrder);
    const groups = dialog.getAllByRole("group");
    expect(groups).toHaveLength(sections.length);
    sections.forEach(({ label }, index) => expect(groups[index]).toHaveAccessibleName(label));

    fireEvent.change(input, { target: { value: "quickbooks" } });
    expect(optionIds(dialog)).toEqual(["invoices", "quickbooks"]);

    fireEvent.change(input, { target: { value: "aging" } });
    expect(optionIds(dialog)).toEqual(["invoices"]);
    fireEvent.change(input, { target: { value: "approvals" } });
    expect(optionIds(dialog)).toEqual(["manager-workspace", "wet-check-reviews"]);
    const user = userEvent.setup();
    const workspace = dialog.getByTestId("option-jump-to-manager-workspace");
    const reviews = dialog.getByTestId("option-jump-to-wet-check-reviews");
    expect(workspace).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(reviews).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(workspace).toHaveAttribute("aria-selected", "true");

    fireEvent.change(input, { target: { value: "" } });
    expect(optionIds(dialog)).toEqual(expectedOrder);
    expect(dialog.getByTestId("option-jump-to-dashboard")).toHaveAttribute("aria-selected", "true");
  });

  it("shows exactly the five bookkeeper pages with an empty query", () => {
    renderJumpTo("bookkeeper");
    expect(optionIds(openWithShortcut())).toEqual([
      "dashboard", "invoices", "customers", "missing-location", "quickbooks",
    ]);
  });

  it("includes Loose Photos but no Dashboard or retired Switch User for super admins", () => {
    renderJumpTo("super_admin");
    const dialog = openWithShortcut();
    expect(dialog.getByRole("option", { name: /^Loose Photos/ })).toBeVisible();
    expect(dialog.queryByRole("option", { name: /^Dashboard/ })).not.toBeInTheDocument();
    expect(dialog.queryByRole("option", { name: /^Switch User/ })).not.toBeInTheDocument();
  });

  it("shows the typed query when nothing matches", async () => {
    renderJumpTo();
    const dialog = openWithShortcut();
    await userEvent.setup().type(dialog.getByRole("combobox"), "zzz");
    expect(dialog.getByText('No page matches "zzz".')).toBeVisible();
    expect(dialog.queryByRole("option")).not.toBeInTheDocument();
  });

  it.each([["Win32", "Ctrl K"], ["MacIntel", "Cmd K"]])(
    "opens from the top strip and shows the platform hint on %s",
    async (platform, hint) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      renderJumpTo("bookkeeper", true);
      const button = screen.getByRole("button", { name: "Jump to..." });
      expect(button).toHaveTextContent(hint);
      expect(button.nextElementSibling).toHaveAccessibleName("Notifications");
      await userEvent.setup().click(button);
      expect(screen.getByRole("dialog", { name: "Jump to a page" })).toBeInTheDocument();
      expect(button).toHaveAttribute("aria-expanded", "true");
    },
  );

  it("opens the same dialog from the phone bar and from page content", async () => {
    renderJumpTo("bookkeeper", true);
    const user = userEvent.setup();
    const phone = within(screen.getByTestId("phone-nav-header"));
    const trigger = phone.getByRole("button", { name: "Jump to a page" });
    expect(trigger.nextElementSibling).toHaveAccessibleName("Notifications");
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Jump to a page" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const page = screen.getByRole("button", { name: "Open from a page" });
    await user.click(page);
    expect(page).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("dialog", { name: "Jump to a page" })).toHaveLength(1);
    fireEvent.click(screen.getByText("Close from a page"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

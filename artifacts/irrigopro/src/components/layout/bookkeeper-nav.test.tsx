/**
 * bookkeeper-nav.test.tsx (Task #1886)
 *
 * The desktop rail and phone tabs are two views of the same role config.
 *
 * Also covers the customer-profile Billing Details tab, which used to be
 * forced visible for every role by a `billing: isBillingRole || true` entry
 * and now tracks its own contents via CAN_READ_INVOICES.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hasCapability,
  computeEffectiveDueDate,
  isInvoiceOverdue,
  CAN_READ_INVOICES,
  CAN_EDIT_INVOICES,
  CAN_SEND_INVOICE_EMAIL,
  CAN_VIEW_COSTS,
  OVERDUE_AGING_FILTER,
} from "@workspace/shared";

// Task #1914 — the signed-in role has to vary now: the overdue badge is gated
// on invoice-read capability, so a field tech's session must be renderable
// here to prove no request goes out for it. `vi.hoisted` is what lets the
// module mock below read a value the tests can change.
const session = vi.hoisted(() => ({
  role: "bookkeeper" as string,
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
  safeGet: (key: string) =>
    key === "user"
      ? JSON.stringify({ id: 7, name: "Test Bookkeeper", role: session.role, companyId: 1 })
      : null,
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));
vi.mock("@assets/IrrigoPro_2026-05_1778193170303.png", () => ({ default: "mark.png" }));
vi.mock("@/components/layout/route-meta", () => ({
  resolveRouteMeta: () => ({ breadcrumb: [{ label: "Invoices" }] }),
}));
// DesktopShell reads the signed-in user from the auth context. Supplying it
// directly keeps this test to the nav surface instead of pulling in the whole
// provider.
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: {
      id: 7,
      name: "Test Bookkeeper",
      email: "bk@example.com",
      role: session.role,
      companyId: 1,
    },
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

import { DesktopShell } from "./desktop-shell";
import { navForRole } from "./nav-config";

// jsdom has no matchMedia; PhoneNav calls it on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, queryFn: async () => null },
    },
  });
}

const PROFILE_SRC = readFileSync(
  resolve(import.meta.dirname, "../../pages/customer-profile.tsx"),
  "utf8",
);
const INVOICES_SRC = readFileSync(
  resolve(import.meta.dirname, "../../pages/invoices.tsx"),
  "utf8",
);

// ── Surface 1: the desktop rail (nav-config.ts) ──────────────────────────────

describe("bookkeeper desktop rail", () => {
  const expected = [
    ["Dashboard", "/"],
    ["Invoices", "/invoices"],
    ["Customers", "/customers"],
    ["Missing Location Data", "/reports/missing-location-data"],
    ["QuickBooks", "/quickbooks"],
  ];

  it("resolves exactly the five bookkeeper destinations", () => {
    expect(navForRole("bookkeeper").flatMap(({ pages }) => pages.map(({ label, href }) => [label, href])))
      .toEqual(expected);
  });

  it("renders five rail sections and no panel on the single-page Billing section", () => {
    renderShell();
    const rail = within(screen.getByRole("navigation", { name: "Desktop sections" }));
    expect(rail.getAllByRole("button").map((button) => button.getAttribute("aria-label")))
      .toEqual(["Dashboard", "Billing", "Clients", "Insights", "Settings", "Account"]);
    expect(rail.getByRole("button", { name: "Billing" })).toHaveAttribute("aria-current", "true");
    expect(screen.queryByTestId("pages-panel")).not.toBeInTheDocument();
  });

  it("lets the content column shrink so wide tables cannot widen the window", () => {
    renderShell();
    const main = screen.getByTestId("desktop-shell").querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
  });
});

describe("bookkeeper phone navigation", () => {
  it("renders Dashboard, Billing, Clients, Insights and More in order", () => {
    renderShell();
    const tabs = screen.getByRole("navigation", { name: "Phone navigation" });
    expect(Array.from(tabs.children, (tab) => tab.textContent))
      .toEqual(["Dashboard", "Billing", "Clients", "Insights", "More"]);
  });
});

// ── Customer profile: Billing Details tab tracks its own contents ────────────

describe("customer-profile Billing Details tab visibility", () => {
  it("no longer forces the tab visible for every role", () => {
    expect(PROFILE_SRC).not.toContain("isBillingRole || true");
  });

  it("keys the tab on billing role OR invoice-read capability", () => {
    expect(PROFILE_SRC).toMatch(/billing:\s*isBillingRole\s*\|\|\s*canReadInvoices/);
    expect(PROFILE_SRC).toMatch(/canReadInvoices\s*=\s*hasCapability\(userRole,\s*CAN_READ_INVOICES\)/);
  });

  it("gates the Invoices section itself on the same capability", () => {
    expect(PROFILE_SRC).toContain("{canReadInvoices && (");
  });

  it("drops the stale comments that justified the old unconditional tab", () => {
    expect(PROFILE_SRC).not.toContain("Tab has content for ANY role");
    expect(PROFILE_SRC).not.toContain("always true; derived for auditability");
    expect(PROFILE_SRC).not.toContain(
      "InvoiceList — visible to all roles (same as original long-scroll page)",
    );
  });

  // The recurring defect in this area is a control whose capability gate is
  // looser than its endpoint's guard, so the role sees a button that 403s.
  // These assert the invariant rather than individual buttons.
  const guardBefore = (marker: string) => {
    const idx = INVOICES_SRC.indexOf(marker);
    expect(idx, `marker not found: ${marker}`).toBeGreaterThan(-1);
    const before = INVOICES_SRC.slice(0, idx);
    return before.slice(before.lastIndexOf("{can"));
  };

  it.each([
    // Task #1942 — the QuickBooks push answers to CAN_MANAGE_QUICKBOOKS along
    // with the rest of the QuickBooks surface; nothing about the IrrigoPro
    // invoice changes when it runs.
    ["button-sync-quickbooks-invoice", "canManageQuickBooks"],
    ["button-resync-quickbooks-invoice", "canManageQuickBooks"],
    ["button-void-invoice", "canBillingEdit"],
    ["button-finalize-invoice", "canBillingEdit"],
    ["button-return-to-draft-invoice", "canBillingEdit"],
    ["button-edit-invoice-metadata", "canBillingEdit"],
    ["button-manage-tickets-invoice", "canBillingEdit"],
    ["button-correct-invoice", "canCorrect"],
  ])("gates the %s control on %s", (marker, expected) => {
    expect(guardBefore(marker)).toContain(expected);
  });

  it("does not render or query Financial Pulse for a role denied it", () => {
    // Financial Pulse routes allow only super_admin, company_admin, and
    // billing_manager. Linking there, or firing its query, for anyone else
    // produces either a 403 page or a background 403 the user never sees but
    // the server logs.
    //
    // Task #2013 — the invoices page used to carry the Financial Pulse A/R
    // aging widget, and this assertion pointed at its JSX. The widget is gone
    // (the page's own aging strip showed the same buckets), so the guarantee
    // now points at the strip's "View on Financial Pulse" link, which is the
    // page's only remaining Financial Pulse affordance. The page fires no
    // Financial Pulse query at all any more.
    expect(INVOICES_SRC).not.toContain("FinancialPulseWidget");
    expect(INVOICES_SRC).not.toContain("/api/financial-pulse/");
    expect(guardBefore('"/financial-pulse"')).toContain("canViewCosts");
    const summaryQuery = PROFILE_SRC.slice(
      PROFILE_SRC.indexOf("queryKey: [`/api/financial-pulse/customer/"),
    ).slice(0, 220);
    expect(summaryQuery).toMatch(/enabled:[^\n]*CAN_VIEW_COSTS/);

    // The capability the gates resolve through must match that allowlist.
    expect(hasCapability("bookkeeper", CAN_VIEW_COSTS)).toBe(false);
    expect(hasCapability("irrigation_manager", CAN_VIEW_COSTS)).toBe(false);
    expect(hasCapability("field_tech", CAN_VIEW_COSTS)).toBe(false);
    expect(hasCapability("billing_manager", CAN_VIEW_COSTS)).toBe(true);
    expect(hasCapability("company_admin", CAN_VIEW_COSTS)).toBe(true);
  });

  it("opens no invoice write dialog without the matching capability", () => {
    // Defence in depth: the triggers are gated, but the dialog itself must not
    // be openable by a role that cannot perform the write behind it.
    const writeDialogs = [
      "resyncInvoice != null",
      "draftEditorInvoice != null",
      "editMetadataInvoice != null",
      "voidConfirmInvoice != null",
      "correctionInvoice != null",
      "mergeConfirmOpen",
    ];
    for (const state of writeDialogs) {
      const open = INVOICES_SRC.match(
        new RegExp(`open=\\{[^}]*${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^}]*\\}`),
      );
      expect(open, `no open prop found for ${state}`).not.toBeNull();
      expect(open![0], `${state} dialog is not capability-gated`).toMatch(/can[A-Z]/);
    }
  });

  it("gates 'Mark unsent' on invoice write, not on the send capability", () => {
    // The endpoint is guarded by requireInvoiceWrite on the server. Gating the
    // menu item on the send capability would show a bookkeeper a control that
    // 403s, because she can mark an invoice sent but not reverse it.
    const unsent = INVOICES_SRC.slice(
      0,
      INVOICES_SRC.indexOf("button-mark-unsent-invoice"),
    );
    const guard = unsent.slice(unsent.lastIndexOf("{can"));
    expect(guard).toContain("canBillingEdit");
    expect(guard).not.toContain("canMarkSent");

    // The capability split that makes the distinction meaningful.
    expect(hasCapability("bookkeeper", CAN_SEND_INVOICE_EMAIL)).toBe(true);
    expect(hasCapability("bookkeeper", CAN_EDIT_INVOICES)).toBe(false);
    expect(hasCapability("billing_manager", CAN_EDIT_INVOICES)).toBe(true);
  });

  it("still gates 'Mark sent' on the send capability", () => {
    const sent = INVOICES_SRC.slice(
      0,
      INVOICES_SRC.indexOf("button-mark-sent-invoice"),
    );
    expect(sent.slice(sent.lastIndexOf("{can"))).toContain("canMarkSent");
  });

  it("does not offer a 'View Billing Details' button to a role without the tab", () => {
    // Both Financial Snapshot buttons call setTab("billing"); for a field tech
    // that tab no longer exists, so the control would navigate nowhere.
    const buttons = PROFILE_SRC.split('setTab("billing")').length - 1;
    const gated = PROFILE_SRC.split("{tabVisibility.billing && (").length - 1;
    expect(buttons).toBeGreaterThan(0);
    expect(gated).toBe(buttons);
  });

  it("resolves the role through the auth context, not a bespoke localStorage read", () => {
    expect(PROFILE_SRC).toContain("useAuth()");
    expect(PROFILE_SRC).not.toContain('safeGet("user")');
  });

  // The predicate the tab is keyed on, per role. This is the actual behaviour
  // contract: field_tech loses the tab entirely, irrigation_manager keeps it.
  it("field_tech has no invoice-read capability, so the tab disappears", () => {
    expect(hasCapability("field_tech", CAN_READ_INVOICES)).toBe(false);
  });

  it("irrigation_manager keeps invoice read, so the tab stays", () => {
    expect(hasCapability("irrigation_manager", CAN_READ_INVOICES)).toBe(true);
  });

  it("bookkeeper can read invoices", () => {
    expect(hasCapability("bookkeeper", CAN_READ_INVOICES)).toBe(true);
  });
});

// ── Task #1914: the overdue-invoice badge ────────────────────────────────────
//
// The badge does not decide what "overdue" means; it counts through the
// invoice list endpoint's overdue aging filter and renders the post-filter
// total the endpoint reports. So the fake endpoint below applies the SHARED
// definition (computeEffectiveDueDate + isInvoiceOverdue from
// lib/shared/src/invoice-aging.ts) to the fixtures, and every expectation is
// derived from that same helper rather than from a number typed in here. If
// the shell ever grew its own client-side notion of overdue, the count it
// rendered would stop agreeing with these fixtures.
//
// The endpoint's own agreement with the shared definition — that ?aging=
// overdue really selects the shared-overdue rows, and that X-Total-Count is
// the post-filter total — is proved against the real handler in
// artifacts/api-server/src/routes/invoice-list-routes.test.ts.

const NOW = new Date("2026-08-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

interface FixtureInvoice {
  id: number;
  dueDate: string;
  createdAt: string;
  paymentStatus: string;
}

function fixture(id: number, dueInDays: number, paymentStatus = "unpaid"): FixtureInvoice {
  return {
    id,
    dueDate: new Date(NOW.getTime() + dueInDays * DAY).toISOString(),
    createdAt: new Date(NOW.getTime() - 60 * DAY).toISOString(),
    paymentStatus,
  };
}

/** Six invoices: three genuinely overdue, one paid, two not yet due. */
const INVOICE_FIXTURES: FixtureInvoice[] = [
  fixture(1, -75),
  fixture(2, -40),
  fixture(3, -2),
  fixture(4, -90, "paid"),
  fixture(5, 3),
  fixture(6, 20),
];

function isOverduePerSharedModule(inv: FixtureInvoice): boolean {
  return isInvoiceOverdue(
    inv.paymentStatus,
    computeEffectiveDueDate(inv.dueDate, inv.createdAt, null),
    NOW,
  );
}

function sharedOverdueCount(rows: FixtureInvoice[]): number {
  return rows.filter(isOverduePerSharedModule).length;
}

let fetchCalls: string[] = [];

/**
 * Stands in for GET /api/invoices. Honours `?aging=overdue` using the shared
 * definition and reports the post-filter total in X-Total-Count, exactly as
 * the real handler does.
 */
function installFakeInvoiceApi(rows: FixtureInvoice[]) {
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    const params = new URLSearchParams(qs);
    const selected =
      params.get("aging") === OVERDUE_AGING_FILTER
        ? rows.filter(isOverduePerSharedModule)
        : rows;
    const limitRaw = params.get("limit");
    const limit = limitRaw ? Number(limitRaw) : selected.length;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "X-Total-Count": String(selected.length) }),
      json: async () => selected.slice(0, limit),
      text: async () => "",
    } as unknown as Response;
  });
  (globalThis as unknown as { fetch: unknown }).fetch = impl;
  return impl;
}

function renderShell() {
  const location = memoryLocation({ path: "/invoices" });
  return render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <QueryClientProvider client={makeQueryClient()}>
        <DesktopShell role={session.role}>
          <div>content</div>
        </DesktopShell>
      </QueryClientProvider>
    </Router>,
  );
}

function badgeTexts(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="nav-rail-badge-"]')).map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("bookkeeper rail — overdue invoice badge (Task #1914)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    session.role = "bookkeeper";
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("asks the invoice list for the overdue slice, one row deep", async () => {
    installFakeInvoiceApi(INVOICE_FIXTURES);
    renderShell();
    await waitFor(() => {
      expect(fetchCalls.some((u) => u.startsWith("/api/invoices"))).toBe(true);
    });
    const call = fetchCalls.find((u) => u.startsWith("/api/invoices"))!;
    const params = new URLSearchParams(call.slice(call.indexOf("?") + 1));
    expect(params.get("aging")).toBe(OVERDUE_AGING_FILTER);
    // A minimal page: the number comes from the header, not from counting rows.
    expect(params.get("limit")).toBe("1");
    expect(params.get("offset")).toBe("0");
  });

  it("renders the post-filter total, and it agrees with the shared overdue rule", async () => {
    const expected = sharedOverdueCount(INVOICE_FIXTURES);
    expect(expected).toBe(3); // sanity: the fixtures do exercise the rule
    expect(expected).toBeLessThan(INVOICE_FIXTURES.length); // …and it filters
    installFakeInvoiceApi(INVOICE_FIXTURES);
    renderShell();
    await waitFor(() => {
      expect(badgeTexts()).toContain(String(expected));
    });
    // Not the unfiltered list length, and not a paid-but-past-due row's worth.
    expect(badgeTexts()).not.toContain(String(INVOICE_FIXTURES.length));
  });

  it("renders no badge at all — not a 0 — when nothing is overdue", async () => {
    const allCurrent = [fixture(1, 5), fixture(2, 30), fixture(3, -1, "paid")];
    expect(sharedOverdueCount(allCurrent)).toBe(0);
    installFakeInvoiceApi(allCurrent);
    renderShell();
    await waitFor(() => {
      expect(fetchCalls.some((u) => u.startsWith("/api/invoices"))).toBe(true);
    });
    await waitFor(() => {
      expect(badgeTexts()).toEqual([]);
    });
    expect(screen.queryByText("0")).toBeNull();
  });

  it("issues no overdue request at all for a role without invoice-read capability", async () => {
    expect(hasCapability("field_tech", CAN_READ_INVOICES)).toBe(false);
    session.role = "field_tech";
    installFakeInvoiceApi(INVOICE_FIXTURES);
    renderShell();
    // Give React Query every chance to fire it.
    await waitFor(() => {
      expect(screen.getByTestId("desktop-shell")).toBeTruthy();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalls.filter((u) => u.startsWith("/api/invoices"))).toEqual([]);
    expect(badgeTexts()).toEqual([]);
  });

  it("does not turn on the four approval badge queries for the bookkeeper", async () => {
    // The overdue gate is independent: enabling it must not start her polling
    // parts, manual part reviews, wet-check reviews, estimates or the
    // needs-approval count.
    installFakeInvoiceApi(INVOICE_FIXTURES);
    renderShell();
    await waitFor(() => {
      expect(fetchCalls.some((u) => u.startsWith("/api/invoices"))).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 50));
    for (const endpoint of [
      "/api/parts/pending-approval",
      "/api/manual-part-reviews",
      "/api/wet-checks/pending-review",
      "/api/estimates/pending-approval",
      "/api/manager-workspace/needs-approval/count",
    ]) {
      expect(fetchCalls.some((u) => u.startsWith(endpoint)), endpoint).toBe(false);
    }
  });
});

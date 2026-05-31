/**
 * wc-audit-capture.test.tsx
 *
 * WC Manager Experience Slice 9 — Real render capture test.
 *
 * For each (surface × role) combination the test renders the exact component
 * that App.tsx / company-admin-app.tsx routes to for that (path, role) pair,
 * serialises container.innerHTML to:
 *   docs/wc-manager-experience-visual-audit-fixtures/<surface>.<role>.html
 *
 * ── Routing truth (read from App.tsx + company-admin-app.tsx) ─────────────
 *
 *  /wet-checks              → WetChecksListPage      (ALL 4 roles)
 *  /wet-checks/pending-review → WetCheckReviewPage → PendingReviewInbox (ALL 4 roles)
 *  /wet-checks/:id/review:
 *    irrigation_manager  → ManagerWetCheckDetailPage          (App.tsx L346)
 *    company_admin       → ManagerWetCheckDetailPage          (company-admin-app.tsx L199)
 *    billing_manager     → WetCheckReviewPage → WetCheckWizard(id)  (App.tsx L394) ← D1
 *    super_admin         → WetCheckReviewPage → WetCheckWizard(id)  (App.tsx L444) ← D1
 *  /manager-workspace:
 *    irrigation_manager  → ManagerWorkspace          (App.tsx L313)
 *    billing_manager /
 *    super_admin /
 *    company_admin       → NotFound  (D6: no route in their Switch blocks)
 *
 * ── WetCheckReviewPage dual-mode ─────────────────────────────────────────
 *  The component uses useRoute to self-dispatch:
 *    /wet-checks/:id/review  → renders WetCheckWizard(id)    (wizard mode)
 *    /manager/wet-checks/:id → renders WetCheckWizard(id)    (wizard mode)
 *    all other paths         → renders PendingReviewInbox     (queue mode)
 *  D1 delta: billing/super_admin at the :id URL get the wizard shell (not
 *  ManagerWetCheckDetailPage), while irrigation/company_admin get ManagerWetCheckDetailPage.
 *
 * ── Stable-state capture strategy ────────────────────────────────────────
 *  A `defaultQueryFn` is added to the test QueryClient that calls the global
 *  fetch mock. This covers every component query that has no inline queryFn
 *  (e.g. ManagerWorkspace queue/strip, WetCheckWizard parts/issue-types).
 *  Critical keys are also pre-seeded via setQueryData with staleTime:Infinity
 *  for immediate (zero-async) resolution on first render.
 *
 *  Key cache entries pre-seeded per surface:
 *    wc-list:    ["/api/wet-checks/admin", statusFilter]  ← role-specific 2-element key
 *    wc-detail:  ["/api/wet-checks", 1]  (number — matches parseInt(params.id))
 *                ["/api/customers", 1]
 *    wc-review:  ["/api/wet-checks/pending-review"]
 *    (parts, issue-types, queue, strip fall through to defaultQueryFn → fetch mock)
 *
 * ── Sentinels ────────────────────────────────────────────────────────────
 *  wc-list:                "Loading wet checks" absent + page-wet-checks-list
 *                          (waits for isLoading→false so rows are visible)
 *  wc-detail mgr/admin:    mgr-findings-summary        (ManagerWetCheckDetailPage loaded state)
 *  wc-detail billing/super: wizard-two-panel           (WetCheckWizard main panel — real component)
 *  wc-review:              wc-row-1                    (QueueCard in PendingReviewInbox)
 *  wc-dashboard mgr:       queue-row-1                 (ManagerWorkspace row; only appears
 *                                                        after queue data resolves)
 *  wc-dashboard others:    (sync NotFound, no waitFor)
 *
 * ── API mocking ────────────────────────────────────────────────────────────
 *   global.fetch stubbed (URL→fixture JSON after stripping query params).
 *   React Query cache pre-seeded via setQueryData for all surface-specific keys.
 *
 * ── WetCheckWizard ─────────────────────────────────────────────────────────
 *  NOT mocked — the real component renders for billing_manager / super_admin at
 *  wc-detail, giving genuine token-level evidence for D1 delta (wizard vs
 *  ManagerWetCheckDetailPage shell mismatch). Dependent photo/loose-photos
 *  components are lightly mocked to avoid Capacitor/native API calls.
 *
 * ── Fail-fast ──────────────────────────────────────────────────────────────
 *   All waitFor calls are un-guarded — a missing sentinel fails the test and
 *   no partial fixture is written.
 *
 * To re-run (regenerates all 16 fixtures):
 *   cd artifacts/irrigopro && npx vitest run src/test/wc-audit-capture.test.tsx
 */

import React, { useState } from "react";
import { describe, it, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const FIXTURES_DIR = resolve(
  dirname(__filename),
  "../../../../docs/wc-manager-experience-visual-audit-fixtures",
);

// ─── Module mocks ─────────────────────────────────────────────────────────────
// WetCheckWizard is NOT mocked — the real component renders so billing_manager
// and super_admin fixtures show genuine wizard UI for token-level comparison.
//
// Only components with native / offline / camera dependencies are mocked to
// keep the test environment clean.

vi.mock("@/components/estimates/estimate-wizard", () => ({ EstimateWizard: () => null }));
vi.mock("@/components/work-orders/work-order-wizard", () => ({ WorkOrderWizard: () => null }));
vi.mock("@/components/billing/billing-sheet-wizard", () => ({ BillingSheetWizard: () => null }));
vi.mock("@/components/billing/completed-work-detail-modal", () => ({ CompletedWorkDetailModal: () => null }));
vi.mock("@/components/billing/billing-sheet-view-modal", () => ({ BillingSheetViewModal: () => null }));
vi.mock("@/components/offline/sync-ui", () => ({ OfflineStrip: () => null, OfflineSyncUI: () => null }));
vi.mock("@/lib/offline/api", () => ({
  createWetCheck: vi.fn(),
  cachedApiRequest: vi.fn(() => Promise.resolve({})),
}));
vi.mock("@/components/ui/fab", () => ({
  FAB: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="fab-mock">{children}</div>
  ),
}));
vi.mock("@/components/ui/action-sheet", () => ({
  ActionSheet: () => null,
  ActionSheetItem: () => null,
  ActionSheetSection: () => null,
}));
// LoosePhotosSection uses camera/photo APIs not available in jsdom.
vi.mock("@/pages/wet-checks/LoosePhotosSection", () => ({
  LoosePhotosSection: () => <div data-testid="loose-photos-section" />,
}));

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_WET_CHECK_ADMIN_ROWS = [
  {
    id: 1, status: "submitted", customerName: "Acme Irrigation",
    propertyAddress: "123 Main St", startedAt: "2026-05-01T09:00:00Z",
    submittedAt: "2026-05-01T10:30:00Z", technicianName: "Jane Tech",
    companyId: 1, companyName: "High Plains",
    findingCount: 3, quickFixCount: 2, advancedCount: 1, zoneIssueCount: 0,
    totalBillable: "245.00", laborHours: "0.75",
    autoBilledCount: 0, autoBilledTotal: "0.00",
    hasWetCheckBilling: false, billingId: null,
    estimateIds: [], workOrderIds: [],
  },
];

const FIXTURE_PENDING_REVIEW = [
  {
    id: 1, status: "submitted", customerName: "Acme Irrigation",
    propertyAddress: "123 Main St", submittedAt: "2026-05-01T10:30:00Z",
    technicianName: "Jane Tech",
    findingCounts: { quick_fix: 2, advanced: 1, zone_issue: 0, total: 3 },
    totalBillable: "245.00", customerLaborRate: "65.00",
    autoBilledCount: 0, autoBilledTotal: "0.00",
    pendingCount: 3, pendingTotal: "245.00",
    dispositionCounts: { completed_in_field: 0, needs_review: 3 }, companyId: 1,
  },
];

// customerId: 1 required so WetCheckWizard's customer query key ["/api/customers", 1]
// resolves synchronously from the pre-seeded cache.
const FIXTURE_WET_CHECK_DETAIL = {
  id: 1, status: "submitted", customerId: 1,
  customerName: "Acme Irrigation",
  propertyAddress: "123 Main St", submittedAt: "2026-05-01T10:30:00Z",
  startedAt: "2026-05-01T09:00:00Z", technicianName: "Jane Tech", companyId: 1,
  zoneRecords: [
    {
      id: 10, wetCheckId: 1, controllerLetter: "A", zoneNumber: 1,
      status: "checked_with_issues", repairLaborHours: "0.50", repairLaborManuallySet: false,
      findings: [
        {
          id: 100, zoneRecordId: 10, issueType: "broken_head",
          partName: "Rotor Head", quantity: 2, partPrice: "12.00",
          laborHours: "0.25", resolution: "repaired_in_field",
          techDisposition: "completed_in_field", notes: "Replaced both heads",
          estimateId: null, workOrderId: null,
        },
      ],
    },
  ],
};

const FIXTURE_CUSTOMER = {
  id: 1, companyId: 1, name: "Acme Irrigation",
  email: "acme@example.com", phone: "555-1234",
  address: "123 Main St", city: "Denver", state: "CO", zip: "80201",
};

// ─── Fetch mock ───────────────────────────────────────────────────────────────
// Fallback for any query NOT pre-seeded in the cache. Paths matched after
// stripping query params so /api/wet-checks/admin?status=... works correctly.

// ManagerQueueItem.id is a STRING; QueueResponse uses `items` (not `rows`).
// testid rendered as: data-testid={`queue-row-${item.id}`} → "queue-row-wc-1"
const FIXTURE_QUEUE_ITEM = {
  id: "wc-1",
  type: "wet_check" as const,
  refId: 1,
  number: null,
  customerId: 1,
  customerName: "Acme Irrigation",
  technicianId: null,
  technicianName: "Jane Tech",
  total: 245,
  status: "submitted",
  hasPhotos: false,
  flags: [],
  ageDays: 2,
  createdAt: "2026-05-01T10:30:00Z",
  href: "/wet-checks/1/review",
  wetCheckId: 1,
};

const FETCH_FIXTURE_MAP: Record<string, unknown> = {
  "/api/wet-checks/admin":               FIXTURE_WET_CHECK_ADMIN_ROWS,
  "/api/wet-checks/pending-review":       FIXTURE_PENDING_REVIEW,
  "/api/wet-checks/1":                    FIXTURE_WET_CHECK_DETAIL,
  "/api/wet-checks/issue-types":          [],
  // queue uses `items` key; one item so queue-row-wc-1 sentinel appears after data resolves
  "/api/manager-workspace/queue":         {
    items: [FIXTURE_QUEUE_ITEM],
    total: 1, page: 1, pageSize: 50,
  },
  // StatusStrip shape: { indicators: StatusIndicators }
  "/api/manager-workspace/status-strip":  {
    indicators: {
      wcsPendingReview: 2,
      wosAwaitingApproval: 0,
      findingsNeedingRouting: 1,
      approvedThisWeek: 3,
    },
  },
  "/api/companies":                       [],
  "/api/customers":                       [],
  "/api/customers/1":                     FIXTURE_CUSTOMER,
  "/api/technicians":                     [],
  "/api/parts":                           [],
  "/api/work-orders":                     [],
  "/api/billing-sheets":                  [],
};

function makeFetchMock() {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input
      : input instanceof URL ? input.pathname
      : (input as Request).url;
    const path = raw.replace(/\?.*$/, "");
    const data = Object.prototype.hasOwnProperty.call(FETCH_FIXTURE_MAP, path)
      ? FETCH_FIXTURE_MAP[path]
      : [];
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => data,
      text: async () => JSON.stringify(data),
    } as unknown as Response;
  });
}

// ─── Role identities ──────────────────────────────────────────────────────────

type RoleName = "irrigation_manager" | "company_admin" | "super_admin" | "billing_manager";

const ROLE_USERS: Record<RoleName, object> = {
  irrigation_manager: { id: 1001, name: "Manager User", role: "irrigation_manager", companyId: 1, email: "mgr@test.com" },
  company_admin:      { id: 1002, name: "Admin User",   role: "company_admin",      companyId: 1, email: "admin@test.com" },
  super_admin:        { id: 1003, name: "Super Admin",  role: "super_admin",        companyId: 1, email: "super@test.com" },
  billing_manager:    { id: 1004, name: "Billing User", role: "billing_manager",    companyId: 1, email: "billing@test.com" },
};

function setUser(role: RoleName) { localStorage.setItem("user", JSON.stringify(ROLE_USERS[role])); }
function clearUser() { localStorage.removeItem("user"); }

// ─── Query cache seed ─────────────────────────────────────────────────────────
//
// Every key is seeded BEFORE the component mounts. staleTime:Infinity means React
// Query treats the seed as fresh and never triggers a background fetch — so
// isLoading is false on the very first render and no skeleton state appears.
//
// Role-specific seeds:
//   WetChecksListPage uses queryKey: ["/api/wet-checks/admin", statusFilter]
//     where statusFilter = getDefaultStatus(role):
//       irrigation_manager → "submitted,pending_manager_review"
//       billing_manager    → "approved_passed_to_billing,billed"
//       company_admin / super_admin → "all"
//
//   ManagerWorkspace uses queryKey: [queueUrl] where the default URL is:
//     /api/manager-workspace/queue?sort=age_desc&page=1&pageSize=50
//
// WetCheckWizard (real component, not mocked) uses:
//   ["/api/wet-checks", id]       — number key (parseInt result)
//   ["/api/customers", customerId] — derived from wc.customerId = 1
//   ["/api/parts"]
//   ["/api/wet-checks/issue-types"]

function seedCache(qc: QueryClient, role: RoleName) {
  // ── wet check detail (number key — ManagerWetCheckDetailPage + WetCheckWizard)
  qc.setQueryData(["/api/wet-checks", 1],   FIXTURE_WET_CHECK_DETAIL);
  // string key retained for any surface that reads params without parseInt
  qc.setQueryData(["/api/wet-checks", "1"], FIXTURE_WET_CHECK_DETAIL);

  // ── pending review queue (WetCheckReviewPage / PendingReviewInbox)
  qc.setQueryData(["/api/wet-checks/pending-review"], FIXTURE_PENDING_REVIEW);

  // ── WetCheckWizard dependencies
  qc.setQueryData(["/api/customers", 1],            FIXTURE_CUSTOMER);
  qc.setQueryData(["/api/parts"],                   []);
  qc.setQueryData(["/api/wet-checks/issue-types"],  []);

  // ── WetChecksListPage — role-specific two-element key
  const wcListStatusFilter =
    role === "irrigation_manager" ? "submitted,pending_manager_review" :
    role === "billing_manager"    ? "approved_passed_to_billing,billed" :
    "all";
  qc.setQueryData(["/api/wet-checks/admin", wcListStatusFilter], FIXTURE_WET_CHECK_ADMIN_ROWS);
  qc.setQueryData(["/api/customers", { active: true }], []);
  qc.setQueryData(["/api/companies"], []);

  // ── ManagerWorkspace — default URL with all params at their initial values.
  // QueueResponse uses `items` (not `rows`); ManagerQueueItem.id is a string.
  // The seeded item id "wc-1" → testid "queue-row-wc-1".
  const QUEUE_URL = "/api/manager-workspace/queue?sort=age_desc&page=1&pageSize=50";
  qc.setQueryData([QUEUE_URL], {
    items: [FIXTURE_QUEUE_ITEM],
    total: 1,
    page: 1,
    pageSize: 50,
  });
  qc.setQueryData(["/api/manager-workspace/status-strip"], {
    indicators: {
      wcsPendingReview: 2,
      wosAwaitingApproval: 0,
      findingsNeedingRouting: 1,
      approvedThisWeek: 3,
    },
  });

  // ── shared
  qc.setQueryData(["/api/customers"], []);
  qc.setQueryData(["/api/work-orders"], []);
  qc.setQueryData(["/api/billing-sheets"], []);
}

// ─── Page imports ─────────────────────────────────────────────────────────────
// Exact components used by App.tsx / company-admin-app.tsx per route.

// /wet-checks — all roles use WetChecksListPage (barrel re-export)
import WetChecksListPage from "../pages/wet-checks";
// /wet-checks/pending-review  AND  /wet-checks/:id/review (billing_manager, super_admin)
import WetCheckReviewPage from "../pages/wet-check-review";
// /wet-checks/:id/review — irrigation_manager + company_admin
import ManagerWetCheckDetailPage from "../pages/wet-checks/ManagerWetCheckDetailPage";
// /manager-workspace — irrigation_manager only
import ManagerWorkspace from "../pages/manager-workspace";
// Catch-all for roles that have no matching route
import NotFound from "../pages/not-found";

// ─── Render wrapper ───────────────────────────────────────────────────────────

function renderWithProviders(
  ui: React.ReactNode,
  { memoryPath = "/", role }: { memoryPath?: string; role: RoleName },
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        // defaultQueryFn uses the global fetch mock so component queries that
        // have no inline queryFn (e.g. ManagerWorkspace queue/strip, WetCheckWizard
        // parts/issue-types) resolve via the mock instead of erroring.
        queryFn: async ({ queryKey }) => {
          const url = typeof queryKey[0] === "string"
            ? queryKey[0]
            : String(queryKey[0]);
          const res = await fetch(url);
          return res.json();
        },
      },
    },
  });
  seedCache(qc, role);

  function useMemoryLocation(): [string, (to: string) => void] {
    const [loc] = useState(memoryPath);
    return [loc, () => {}];
  }

  return render(
    <TooltipProvider>
      <QueryClientProvider client={qc}>
        <Router hook={useMemoryLocation as Parameters<typeof Router>[0]["hook"]}>
          {ui}
        </Router>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

// ─── Write helper ─────────────────────────────────────────────────────────────

function writeFixture(surface: string, role: RoleName, html: string) {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const header =
    `<!-- AUDIT FIXTURE: ${surface} × ${role} -->\n` +
    `<!-- Generated by src/test/wc-audit-capture.test.tsx. Do not edit manually. -->\n` +
    `<!-- Re-run: cd artifacts/irrigopro && npx vitest run src/test/wc-audit-capture.test.tsx -->\n`;
  writeFileSync(
    join(FIXTURES_DIR, `${surface}.${role}.html`),
    header + html + "\n",
    "utf8",
  );
}

// ─── Global fetch mock ────────────────────────────────────────────────────────

beforeAll(() => { vi.stubGlobal("fetch", makeFetchMock()); });
afterAll(() => { vi.unstubAllGlobals(); clearUser(); });
afterEach(() => { clearUser(); });

const ROLES: RoleName[] = ["irrigation_manager", "company_admin", "super_admin", "billing_manager"];

// ── Surface 1: wc-list (/wet-checks) ─────────────────────────────────────────
// ALL roles → WetChecksListPage  (App.tsx L343, L395, L445, company-admin L200)
//
// Capture strategy: queryKey ["/api/wet-checks/admin", statusFilter] is pre-seeded
// per role AND defaultQueryFn resolves via fetch mock.
// Sentinel: wait until "Loading wet checks" text is absent (isLoading→false), then
// capture outer container. This ensures rows are visible, not a loading skeleton.

describe("capture: wc-list", () => {
  for (const role of ROLES) {
    it(`${role}`, async () => {
      setUser(role);
      const { container, unmount } = renderWithProviders(<WetChecksListPage />, {
        memoryPath: "/wet-checks",
        role,
      });
      await waitFor(() => {
        if (container.textContent?.includes("Loading wet checks")) {
          throw new Error("still loading");
        }
        return screen.getByTestId("page-wet-checks-list");
      }, { timeout: 5000 });
      writeFixture("wc-list", role, container.innerHTML);
      unmount();
    });
  }
});

// ── Surface 2: wc-detail (/wet-checks/1/review) ───────────────────────────────
//
// irrigation_manager (App.tsx L346) + company_admin (company-admin-app.tsx L199):
//   → ManagerWetCheckDetailPage
//   Cache seed: ["/api/wet-checks", 1] (number) → data available synchronously.
//   Sentinel: mgr-findings-summary (rendered inside the loaded ManagerWetCheckDetailView)
//
// billing_manager (App.tsx L394) + super_admin (App.tsx L444):
//   → WetCheckReviewPage at /wet-checks/:id/review
//   → WetCheckReviewPage internally matches useRoute("/wet-checks/:id/review")
//   → dispatches to the REAL WetCheckWizard(id=1) — not mocked
//   Cache seeds: ["/api/wet-checks", 1], ["/api/customers", 1], ["/api/parts"],
//                ["/api/wet-checks/issue-types"]  → all resolve synchronously.
//   Sentinel: wizard-two-panel (WetCheckWizard main panel outer div)
//   Delta D1: billing/super get wizard shell; mgr/admin get ManagerWetCheckDetailPage.

describe("capture: wc-detail", () => {
  for (const role of ["irrigation_manager", "company_admin"] as RoleName[]) {
    it(`${role} — ManagerWetCheckDetailPage (App.tsx routing)`, async () => {
      setUser(role);
      const { container, unmount } = renderWithProviders(
        <Route path="/wet-checks/:id/review">
          <ManagerWetCheckDetailPage />
        </Route>,
        { memoryPath: "/wet-checks/1/review", role },
      );
      await waitFor(() => screen.getByTestId("mgr-findings-summary"), { timeout: 5000 });
      writeFixture("wc-detail", role, container.innerHTML);
      unmount();
    });
  }

  for (const role of ["billing_manager", "super_admin"] as RoleName[]) {
    it(`${role} — WetCheckReviewPage → WetCheckWizard (Delta D1: wizard shell, not ManagerWetCheckDetailPage)`, async () => {
      setUser(role);
      // WetCheckReviewPage self-routes via useRoute("/wet-checks/:id/review"):
      //   match → renders the real WetCheckWizard(id=1) with all deps pre-seeded.
      // Delta D1: billing/super get wizard-two-panel; mgr/admin get mgr-findings-summary.
      const { container, unmount } = renderWithProviders(<WetCheckReviewPage />, {
        memoryPath: "/wet-checks/1/review",
        role,
      });
      await waitFor(() => screen.getByTestId("wizard-two-panel"), { timeout: 5000 });
      writeFixture("wc-detail", role, container.innerHTML);
      unmount();
    });
  }
});

// ── Surface 3: wc-review (/wet-checks/pending-review) ────────────────────────
// ALL roles → WetCheckReviewPage → PendingReviewInbox (path not matched by useRoute)
//   (App.tsx L342/L393/L443, company-admin L198)
// Cache seed: ["/api/wet-checks/pending-review"] → resolves synchronously.
// Sentinel: wc-row-1  (QueueCard for fixture row id=1)

describe("capture: wc-review", () => {
  for (const role of ROLES) {
    it(`${role}`, async () => {
      setUser(role);
      const { container, unmount } = renderWithProviders(<WetCheckReviewPage />, {
        memoryPath: "/wet-checks/pending-review",
        role,
      });
      await waitFor(() => screen.getByTestId("wc-row-1"), { timeout: 5000 });
      writeFixture("wc-review", role, container.innerHTML);
      unmount();
    });
  }
});

// ── Surface 4: wc-dashboard (/manager-workspace) ─────────────────────────────
//
// irrigation_manager (App.tsx L313) → ManagerWorkspace
//   defaultQueryFn resolves queue and strip via fetch mock (both return fixture data).
//   Sentinel: queue-row-1 — only renders after the queue query resolves (data-testid
//   applied to each rendered queue row). This guarantees the fixture captures the
//   fully-loaded pipeline view, not the initial skeleton/loading state.
//
// billing_manager / super_admin / company_admin → NotFound  (Delta D6)
//   No /manager-workspace route in their Switch blocks; falls to catch-all.
//   NotFound renders synchronously — no waitFor needed.

describe("capture: wc-dashboard", () => {
  it("irrigation_manager — ManagerWorkspace (App.tsx L313)", async () => {
    setUser("irrigation_manager");
    const { container, unmount } = renderWithProviders(<ManagerWorkspace />, {
      memoryPath: "/manager-workspace",
      role: "irrigation_manager",
    });
    // Wait for the queue row to render — proves queue data resolved (not loading state).
    // FIXTURE_QUEUE_ITEM.id = "wc-1" → testid "queue-row-wc-1"
    await waitFor(() => screen.getByTestId("queue-row-wc-1"), { timeout: 5000 });
    writeFixture("wc-dashboard", "irrigation_manager", container.innerHTML);
    unmount();
  });

  for (const role of ["billing_manager", "super_admin", "company_admin"] as RoleName[]) {
    it(`${role} — NotFound (Delta D6: no /manager-workspace route)`, () => {
      setUser(role);
      const { container, unmount } = renderWithProviders(<NotFound />, {
        memoryPath: "/manager-workspace",
        role,
      });
      writeFixture("wc-dashboard", role, container.innerHTML);
      unmount();
    });
  }
});

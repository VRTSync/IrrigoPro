/**
 * wet-check-review.test.tsx — Slice 6
 *
 * Covers:
 *  1. WorkflowIndicator highlights the correct step based on data state
 *  2. All-green DismissibleHelp banner appears when fully resolved
 *  3. `A` shortcut triggers optimistic approve when all-green
 *  4. `billing_manager` cannot trigger approve via keyboard
 *  5. "Show help" button re-renders dismissed guides
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/utils/safeStorage", () => ({
  safeGet: vi.fn(() => null),
  safeSet: () => {},
  safeRemove: () => {},
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/offline/engine", () => ({ isOfflineQueueEnabled: () => false }));
vi.mock("@/lib/offline/api", () => ({
  PHOTO_OFFLINE_MESSAGE: "",
  isProbablyOffline: () => false,
  isOfflinePhotosEnabled: () => false,
  ensurePersistentStorage: vi.fn(),
  queuePhotoUpload: vi.fn(),
  createWetCheck: vi.fn(),
  submitWetCheck: vi.fn(),
  upsertZoneRecord: vi.fn(),
  createFinding: vi.fn(),
  updateFinding: vi.fn(),
  deleteFinding: vi.fn(),
  enqueueZoneRevertCascade: vi.fn(),
  linkPhotoToFinding: vi.fn(),
  warmWetCheckMirror: vi.fn(),
  readWetCheckFromMirror: vi.fn(),
  readWetCheckByClientId: vi.fn(),
  cachedApiRequest: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/photo-prep", () => ({ preparePhotoForUpload: vi.fn() }));
vi.mock("@/components/offline/sync-ui", () => ({
  OfflineStrip: () => null,
  OfflineSyncUI: () => null,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/manager/wet-checks/1", vi.fn()],
  useRoute: (pattern: string) => {
    if (pattern === "/manager/wet-checks/:id") return [true, { id: "1" }];
    return [false, null];
  },
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

import { safeGet } from "@/utils/safeStorage";

// ─── WorkflowIndicator unit tests ────────────────────────────────────────────
// Import the private helper indirectly via the wizard module
import { WetCheckWizard } from "@/components/manager/wet-check-wizard";

function makeWcData(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "submitted",
    customerId: 10,
    customerName: "Test Corp",
    propertyAddress: "123 Main St",
    technicianName: "Alex",
    submittedAt: new Date().toISOString(),
    approvedAt: null,
    companyId: 1,
    zoneRecords: [
      {
        id: 1,
        wetCheckId: 1,
        controllerLetter: "A",
        zoneNumber: 1,
        status: "checked_ok",
        findings: [],
        repairLaborHours: "0.00",
        repairLaborManuallySet: false,
      },
    ],
    photos: [],
    ...overrides,
  };
}

function makeQc(data: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["/api/wet-checks", 1], data);
  qc.setQueryData(["/api/parts"], []);
  qc.setQueryData(["/api/wet-checks/issue-types"], []);
  return qc;
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

describe("WorkflowIndicator via WetCheckWizard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(safeGet).mockReturnValue(null);
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    ) as any;
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("step 1 (Review zones) is active when zones are not_checked", () => {
    const qc = makeQc({
      ...makeWcData({
        zoneRecords: [
          {
            id: 1,
            wetCheckId: 1,
            controllerLetter: "A",
            zoneNumber: 1,
            status: "not_checked",
            findings: [],
            repairLaborHours: "0.00",
            repairLaborManuallySet: false,
          },
        ],
      }),
    });
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    const step1 = screen.getByTestId("workflow-step-1");
    expect(step1.getAttribute("aria-current")).toBe("step");
  });

  it("step 2 (Resolve findings) is active when zones reviewed but findings pending", () => {
    const qc = makeQc({
      ...makeWcData({
        zoneRecords: [
          {
            id: 1,
            wetCheckId: 1,
            controllerLetter: "A",
            zoneNumber: 1,
            status: "checked_with_issues",
            markedCompleteAt: new Date().toISOString(),
            findings: [
              {
                id: 10,
                wetCheckId: 1,
                zoneRecordId: 1,
                issueType: "broken_head",
                issueGroup: "heads",
                resolution: "pending",
                convertedAt: null,
                techDisposition: "needs_review",
                partId: null,
                partName: null,
                partPrice: null,
                quantity: 1,
                laborHours: "0.50",
                billingSheetId: null,
              },
            ],
            repairLaborHours: "0.50",
            repairLaborManuallySet: false,
          },
        ],
      }),
    });
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    const step2 = screen.getByTestId("workflow-step-2");
    expect(step2.getAttribute("aria-current")).toBe("step");
  });

  it("step 3 (Approve & route) is active when all-green", () => {
    const qc = makeQc(makeWcData());
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    const step3 = screen.getByTestId("workflow-step-3");
    expect(step3.getAttribute("aria-current")).toBe("step");
  });

  it("all-green DismissibleHelp banner appears when fully resolved", () => {
    const qc = makeQc(makeWcData());
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("wizard-all-green-section")).toBeTruthy();
    expect(screen.getByTestId("dismissible-help-wc-review-ready-to-approve")).toBeTruthy();
  });

  it("all-green banner does NOT appear when findings are still pending", () => {
    const qc = makeQc({
      ...makeWcData({
        zoneRecords: [
          {
            id: 1,
            wetCheckId: 1,
            controllerLetter: "A",
            zoneNumber: 1,
            status: "checked_with_issues",
            findings: [
              {
                id: 10,
                wetCheckId: 1,
                zoneRecordId: 1,
                issueType: "broken_head",
                issueGroup: "heads",
                resolution: "pending",
                convertedAt: null,
                techDisposition: "needs_review",
                partId: null,
                partName: null,
                partPrice: null,
                quantity: 1,
                laborHours: "0.50",
                billingSheetId: null,
              },
            ],
            repairLaborHours: "0.50",
            repairLaborManuallySet: false,
          },
        ],
      }),
    });
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("wizard-all-green-section")).toBeNull();
  });

  it("A shortcut fires approve mutation when all-green", async () => {
    vi.mocked(safeGet).mockReturnValue(JSON.stringify({ id: 1, role: "irrigation_manager" }));
    const approveFetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1, status: "approved" }) }),
    );
    global.fetch = approveFetch as any;

    const qc = makeQc(makeWcData());
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "A" });
    });

    const approveCall = approveFetch.mock.calls.find(([url]: any[]) =>
      String(url).includes("/api/wet-checks/1/approve"),
    );
    expect(approveCall).toBeTruthy();
  });

  it("billing_manager cannot trigger approve via A keyboard shortcut", async () => {
    vi.mocked(safeGet).mockReturnValue(JSON.stringify({ id: 2, role: "billing_manager" }));
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    );
    global.fetch = fetchSpy as any;

    const qc = makeQc(makeWcData());
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "A" });
    });

    const approveCall = fetchSpy.mock.calls.find(([url]: any[]) =>
      String(url).includes("/api/wet-checks/1/approve"),
    );
    expect(approveCall).toBeUndefined();
  });

  it("billing_manager sees the read-only banner", () => {
    vi.mocked(safeGet).mockReturnValue(JSON.stringify({ id: 2, role: "billing_manager" }));
    const qc = makeQc(makeWcData());
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("wizard-billing-manager-banner")).toBeTruthy();
    expect(screen.getByText(/Billing managers can review but cannot approve or route/)).toBeTruthy();
  });

  it("billing_manager decision cards are disabled", () => {
    vi.mocked(safeGet).mockReturnValue(JSON.stringify({ id: 2, role: "billing_manager" }));
    const qc = makeQc(
      makeWcData({
        zoneRecords: [
          {
            id: 1, wetCheckId: 1, controllerLetter: "A", zoneNumber: 1,
            status: "checked_with_issues", repairLaborHours: "0.50",
            repairLaborManuallySet: false,
            findings: [
              {
                id: 10, wetCheckId: 1, zoneRecordId: 1, issueType: "broken_head",
                issueGroup: "heads", resolution: "pending", convertedAt: null,
                techDisposition: "needs_review", partId: null, partName: null,
                partPrice: null, quantity: 1, laborHours: "0.50", billingSheetId: null,
              },
            ],
          },
        ],
      }),
    );
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );
    const estimateCard = screen.getByTestId("wizard-decision-estimate");
    expect(estimateCard).toBeDisabled();
  });

  it("R shortcut opens the route dialog for the active finding", async () => {
    vi.mocked(safeGet).mockReturnValue(JSON.stringify({ id: 1, role: "irrigation_manager" }));
    const qc = makeQc(
      makeWcData({
        zoneRecords: [
          {
            id: 1, wetCheckId: 1, controllerLetter: "A", zoneNumber: 1,
            status: "checked_with_issues", repairLaborHours: "0.50",
            repairLaborManuallySet: false,
            findings: [
              {
                id: 10, wetCheckId: 1, zoneRecordId: 1, issueType: "broken_head",
                issueGroup: "heads", resolution: "pending", convertedAt: null,
                techDisposition: "needs_review", partId: null, partName: null,
                partPrice: null, quantity: 1, laborHours: "0.50", billingSheetId: null,
              },
            ],
          },
        ],
      }),
    );
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "R" });
    });

    expect(screen.getByTestId("wizard-route-dialog")).toBeTruthy();
    expect(screen.getByText("Route this finding")).toBeTruthy();
  });

  it("Show help button re-renders dismissed guides", async () => {
    const qc = makeQc(makeWcData());
    render(
      <QueryClientProvider client={qc}>
        <WetCheckWizard id={1} />
      </QueryClientProvider>,
    );

    const guide = screen.getByTestId("dismissible-help-wc-review-ready-to-approve");
    expect(guide).toBeTruthy();

    fireEvent.click(screen.getByTestId("dismissible-help-wc-review-ready-to-approve-dismiss"));
    expect(screen.queryByTestId("dismissible-help-wc-review-ready-to-approve")).toBeNull();

    const showHelpBtn = screen.getByTestId("wizard-show-help");
    await act(async () => {
      fireEvent.click(showHelpBtn);
    });

    expect(screen.getByTestId("dismissible-help-wc-review-ready-to-approve")).toBeTruthy();
  });
});

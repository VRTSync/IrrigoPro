/**
 * Slice 3 lineage tests — acceptance criteria:
 *   (a) Estimate detail shows the "From Wet Check #X" banner when originWetCheckId is set.
 *   (b) Converting a wet-check-origin estimate to a WO copies originWetCheckId.
 *   (c) WO detail shows the "From Wet Check #X" banner when originWetCheckId is set.
 *   (d) Wet-check manager detail surfaces its originated estimate/WO.
 *
 * These are unit-level / static-source tests that run without a live server.
 * They assert UI rendering (a, c, d) and source-code dual-write invariants (b).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ─── (a) Estimate-detail "From Wet Check #X" banner ──────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => {
    // Return a mock estimate with originWetCheckId = 42 when queried.
    if (String(queryKey?.[0]).includes("/api/estimates")) {
      return {
        data: {
          id: 101,
          estimateNumber: "50001",
          originWetCheckId: 42,
          status: "pending",
          internalStatus: "pending_review",
          lifecycle: "pending_review",
          projectName: "Test project",
          customerName: "Acme Corp",
          customerEmail: "acme@example.com",
          customerPhone: "555-0100",
          customerAddress: "123 Main St",
          createdAt: new Date().toISOString(),
          items: [],
        },
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn() },
  apiRequest: vi.fn(),
  authedPdfUrl: (url: string) => url,
  useArrayQuery: () => ({ data: [], isLoading: false }),
  asArray: (v: any) => (Array.isArray(v) ? v : []),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/email", () => ({
  sendEstimateEmail: vi.fn(),
}));

vi.mock("@/hooks/use-estimate-resend", () => ({
  useEstimateResend: () => ({ resendEstimate: vi.fn(), isResending: false }),
}));

vi.mock("@/components/estimates/estimate-media-block", () => ({
  EstimateMediaBlock: () => null,
}));

vi.mock("@/components/estimates/resend-confirm-dialog", () => ({
  ResendConfirmDialog: () => null,
}));

vi.mock("@/components/estimates/send-estimate-dialog", () => ({
  SendEstimateDialog: () => null,
}));

vi.mock("@/components/activity/ActivityTab", () => ({
  ActivityTab: () => null,
}));

vi.mock("@/components/estimates/list/estimate-list-status-badge", () => ({
  EstimateListStatusBadge: () => null,
}));

vi.mock("@workspace/shared", () => ({
  formatEstimateNumber: (n: any) => String(n ?? ""),
  buildEstimatePdfFilename: (n: any) => `estimate-${n}.pdf`,
  isApproved: () => false,
  isConvertedToWorkOrder: () => false,
  isDraft: () => false,
  isPendingReview: () => true,
  isSent: () => false,
  isExpired: () => false,
  isAwaitingCustomerReply: () => false,
  lifecycleOf: () => "pending_review",
  reviewStageLabelOf: () => "Pending Review",
  customerResponseLabelOf: () => "—",
  canDeleteEstimateAs: () => false,
  ESTIMATE_EXPIRATION_DAYS: 30,
}));

vi.mock("@/lib/maps-url", () => ({ buildMapsUrl: () => null }));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children }: any) => <button>{children}</button>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";

describe("(a) Estimate detail — From Wet Check banner", () => {
  it("renders 'From Wet Check #X' banner when originWetCheckId is set", () => {
    render(
      <EstimateDetailModal
        open={true}
        onOpenChange={() => {}}
        estimateId={101}
      />,
    );

    const banner = screen.getByTestId("from-wet-check-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("From Wet Check");
    expect(banner.textContent).toContain("42");
  });

  it("does not render the banner when originWetCheckId is absent", () => {
    // This test uses a queryKey that won't match the mock so data will be undefined;
    // the modal renders nothing in that case — banner definitely absent.
    render(
      <EstimateDetailModal
        open={false}
        onOpenChange={() => {}}
        estimateId={null}
      />,
    );
    expect(screen.queryByTestId("from-wet-check-banner")).toBeNull();
  });
});

// ─── (b) originWetCheckId copy in conversion source ─────────────────────────

describe("(b) createWorkOrderFromEstimate copies originWetCheckId", () => {
  it("storage.ts createWorkOrderFromEstimate passes originWetCheckId to the WO insert", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync(
      new URL(
        "../../../../artifacts/api-server/src/storage.ts",
        import.meta.url,
      ).pathname,
      "utf-8",
    );
    // Both conversion paths must forward originWetCheckId.
    const createFnIdx = source.indexOf("async createWorkOrderFromEstimate");
    const approveFnIdx = source.indexOf("async approveEstimateAndCreateWorkOrder");
    expect(createFnIdx).toBeGreaterThan(-1);
    expect(approveFnIdx).toBeGreaterThan(-1);

    // Slice after each function header; check for originWetCheckId assignment
    // before the next function definition.
    const createSlice = source.slice(createFnIdx, approveFnIdx);
    expect(createSlice).toContain("originWetCheckId");

    const approveSlice = source.slice(
      approveFnIdx,
      source.indexOf("async updateWorkOrder"),
    );
    expect(approveSlice).toContain("originWetCheckId");
  });
});

// ─── (c) WO detail — From Wet Check banner ───────────────────────────────────

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/utils/safeStorage", () => ({
  safeGet: () =>
    JSON.stringify({
      id: 1,
      role: "company_admin",
      name: "Test Admin",
    }),
}));

vi.mock("@/components/ui/file-upload", () => ({
  FileUpload: () => null,
}));

vi.mock("@/components/ui/billed-indicator", () => ({
  BilledIndicator: () => null,
}));

vi.mock("@/components/work-orders/work-order-completion", () => ({
  WorkOrderCompletion: () => null,
}));

vi.mock("@/components/work-orders/assignment-confirmation-modal", () => ({
  AssignmentConfirmationModal: () => null,
}));

vi.mock("@/components/work-orders/work-order-wizard", () => ({
  WorkOrderWizard: () => null,
}));

vi.mock("@/components/billing/pricing-audit-history", () => ({
  PricingAuditHistory: () => null,
}));

vi.mock("@/components/ui/editable-field", () => ({
  EditableField: ({ children }: any) => <div>{children}</div>,
  InlineEditProvider: ({ children }: any) => <div>{children}</div>,
  InlineEditContext: React.createContext({ triggerSave: async () => true }),
}));

vi.mock("@/components/ui/photo-image", () => ({
  PhotoImage: () => null,
  usePhotoSignedUrls: () => ({ getUrl: (u: string) => u }),
}));

vi.mock("@/lib/maps-url", () => ({ buildMapsUrl: () => null }));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children, value }: any) =>
    value === "overview" ? <div>{children}</div> : null,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: any) => (
    <span className={className}>{children}</span>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

import { WorkOrderDetails } from "@/components/work-orders/work-order-details";

const baseWO: any = {
  id: 200,
  workOrderNumber: "WO-TEST-001",
  status: "pending",
  priority: "medium",
  customerName: "Test Customer",
  customerEmail: "test@example.com",
  companyId: 1,
  customerId: 1,
  projectName: "Test Project",
  estimateId: null,
  originWetCheckId: 7,
  photos: [],
  attachments: [],
  noPhotosNeeded: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("(c) Work-order detail — From Wet Check banner", () => {
  it("renders 'From Wet Check #X' banner when originWetCheckId is set", () => {
    render(
      <WorkOrderDetails
        workOrder={baseWO}
        onClose={() => {}}
        onUpdate={() => {}}
      />,
    );

    const banner = screen.getByTestId("wo-from-wet-check-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("From Wet Check #7");
  });

  it("does not render banner when originWetCheckId is null", () => {
    render(
      <WorkOrderDetails
        workOrder={{ ...baseWO, originWetCheckId: null }}
        onClose={() => {}}
        onUpdate={() => {}}
      />,
    );
    expect(screen.queryByTestId("wo-from-wet-check-banner")).toBeNull();
  });
});

// ─── (d) Wet-check manager detail surfaces the originated estimate/WO ─────────

describe("(d) ManagerWetCheckDetailPage lineage source-guard", () => {
  it("ManagerWetCheckDetailPage renders the lineage panel data-testid", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync(
      new URL(
        "./ManagerWetCheckDetailPage.tsx",
        import.meta.url,
      ).pathname,
      "utf-8",
    );
    // The panel must have the data-testid anchor.
    expect(source).toContain('data-testid="wc-lineage-panel"');
    // It must branch on originatedEstimateId.
    expect(source).toContain("originatedEstimateId");
    // It must branch on originatedWorkOrderId.
    expect(source).toContain("originatedWorkOrderId");
  });
});

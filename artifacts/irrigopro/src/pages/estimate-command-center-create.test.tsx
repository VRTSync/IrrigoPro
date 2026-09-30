import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { shouldInvalidateAfterEstimateWrite } from "@/components/estimates/estimate-wizard-submit";
import EstimateCommandCenter from "./estimate-command-center";

type Row = {
  id: number;
  estimateNumber: string;
  customerName: string;
  projectName: string;
  createdBy: string;
  totalAmount: string;
  status: string;
  internalStatus: string;
  lifecycle: string;
  createdAt: string;
};
let rows: Row[] = [];
let nextId = 10;

vi.mock("@/components/estimates/estimate-wizard", () => ({
  EstimateWizard: ({
    open, estimateId, onOpenChange,
  }: {
    open: boolean;
    estimateId?: number | null;
    onOpenChange: (open: boolean) => void;
  }) => {
    // The stub stands in for a completed save so this page test can prove
    // which active queries refetch; the real wizard's predicate is tested separately.
    const qc = useQueryClient();
    if (!open) return null;
    return (
      <div data-testid="wizard-stub" data-estimate-id={String(estimateId ?? "null")}>
        <button onClick={() => onOpenChange(false)}>Close wizard</button>
        <button onClick={() => {
          rows = [...rows, {
            id: nextId++, estimateNumber: `EST-${nextId}`, customerName: "New customer",
            projectName: "New project", createdBy: "Admin", totalAmount: "300",
            status: "draft", internalStatus: "draft", lifecycle: "draft",
            createdAt: new Date().toISOString(),
          }];
          void qc.invalidateQueries({
            predicate: (q) => shouldInvalidateAfterEstimateWrite(q.queryKey?.[0]),
          });
          onOpenChange(false);
        }}>Simulate draft save</button>
        <button onClick={() => {
          rows = [...rows, {
            id: nextId++, estimateNumber: `EST-${nextId}`, customerName: "Review customer",
            projectName: "Review project", createdBy: "Admin", totalAmount: "500",
            status: "pending", internalStatus: "pending_approval", lifecycle: "pending_review",
            createdAt: new Date().toISOString(),
          }];
          void qc.invalidateQueries({
            predicate: (q) => shouldInvalidateAfterEstimateWrite(q.queryKey?.[0]),
          });
          onOpenChange(false);
        }}>Simulate submit</button>
      </div>
    );
  },
}));
vi.mock("@/components/estimates/estimate-detail-modal", () => ({
  EstimateDetailModal: () => null,
}));
vi.mock("@/components/estimates/convert-to-work-order-modal", () => ({
  ConvertToWorkOrderModal: () => null,
}));

function mount() {
  const fetched: string[] = [];
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const key = String(queryKey[0]);
          fetched.push(key);
          if (key === "/api/estimates?limit=500") return rows;
          if (key === "/api/estimates/summary") {
            const bucket = (lifecycle: string) => {
              const matching = rows.filter((r) => r.lifecycle === lifecycle);
              return { count: matching.length, totalAmount: matching.reduce((s, r) => s + Number(r.totalAmount), 0) };
            };
            const draft = bucket("draft");
            const pending = bucket("pending_review");
            const sent = bucket("sent");
            const empty = { count: 0, totalAmount: 0 };
            return {
              byLifecycle: { draft, pending_review: pending, sent, approved: empty, rejected: empty, expired: empty },
              windows: {
                openPipeline: { count: pending.count + sent.count, totalAmount: pending.totalAmount + sent.totalAmount },
                awaitingReview: pending, awaitingCustomer: sent, expiringNext7Days: empty,
                approvedLast30Days: empty,
              },
              winRate90d: 0, attention: [],
            };
          }
          throw new Error(`Unexpected query: ${key}`);
        },
      },
    },
  });
  const location = memoryLocation({ path: "/estimates/command-center" });
  render(
    <QueryClientProvider client={client}>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <EstimateCommandCenter />
      </Router>
    </QueryClientProvider>,
  );
  return fetched;
}

beforeEach(() => {
  rows = [];
  nextId = 10;
  window.history.replaceState({}, "", "/estimates/command-center");
  // Radix's dropdown relies on these pointer methods, absent in jsdom.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

describe("Command Center new estimate entry", () => {
  it("renders the header button and opens create mode, including after closing unsaved", async () => {
    mount();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Estimates" })).toBeInTheDocument();
    fireEvent.click(within(header).getByTestId("cc-new-estimate"));
    expect(screen.getByTestId("wizard-stub")).toHaveAttribute("data-estimate-id", "null");
    fireEvent.click(screen.getByRole("button", { name: "Close wizard" }));
    expect(screen.queryByTestId("wizard-stub")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cc-new-estimate"));
    expect(screen.getByTestId("wizard-stub")).toHaveAttribute("data-estimate-id", "null");
  });

  it("opens Edit with its ID, then resets to create mode", async () => {
    rows = [{
      id: 7, estimateNumber: "EST-7", customerName: "Existing customer",
      projectName: "Old project", createdBy: "Admin", totalAmount: "100",
      status: "draft", internalStatus: "draft", lifecycle: "draft",
      createdAt: new Date().toISOString(),
    }];
    mount();
    fireEvent.pointerDown(await screen.findByTestId("estimate-row-actions-7"), {
      button: 0, ctrlKey: false, pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(screen.getByTestId("wizard-stub")).toHaveAttribute("data-estimate-id", "7");
    fireEvent.click(screen.getByRole("button", { name: "Close wizard" }));
    fireEvent.click(screen.getByTestId("cc-new-estimate"));
    expect(screen.getByTestId("wizard-stub")).toHaveAttribute("data-estimate-id", "null");
  });

  it("refetches list and summary after a draft and a submission without inflating draft pipeline", async () => {
    const fetched = mount();
    await screen.findByTestId("kanban-count-draft");
    fireEvent.click(screen.getByTestId("cc-new-estimate"));
    fireEvent.click(screen.getByRole("button", { name: "Simulate draft save" }));
    await waitFor(() => {
      expect(screen.getByTestId("estimate-row-10")).toBeInTheDocument();
      expect(screen.getByTestId("kanban-count-draft")).toHaveTextContent("1 · $300");
    });
    expect(screen.getByTestId("kpi-open-pipeline")).toHaveTextContent("0");
    fireEvent.click(screen.getByTestId("cc-new-estimate"));
    fireEvent.click(screen.getByRole("button", { name: "Simulate submit" }));
    await waitFor(() => {
      expect(screen.getByTestId("estimate-row-11")).toBeInTheDocument();
      expect(screen.getByTestId("kpi-open-pipeline")).toHaveTextContent("1");
    });
    expect(fetched.filter((key) => key === "/api/estimates?limit=500").length).toBeGreaterThanOrEqual(3);
    expect(fetched.filter((key) => key === "/api/estimates/summary").length).toBeGreaterThanOrEqual(3);
  });
});
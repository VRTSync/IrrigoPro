import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Estimate } from "@workspace/db/schema";
import type { LifecycleStatus } from "@workspace/shared";
import { EstimateTable } from "./estimate-table";

const estimate = (lifecycle: LifecycleStatus): Estimate => ({
  id: 42, estimateNumber: "00042", customerName: "Acme",
  projectName: "Repairs", createdBy: "Admin", totalAmount: "200",
  lifecycle, createdAt: new Date(), updatedAt: new Date(),
} as Estimate);

function mount(lifecycle: LifecycleStatus, role: string | null, withCallback = true) {
  const onDeleteEstimate = vi.fn();
  render(
    <EstimateTable
      estimates={[estimate(lifecycle)]}
      lifecycleFilter={[]}
      onLifecycleFilterChange={vi.fn()}
      attentionEstimateIds={null}
      onClearAttention={vi.fn()}
      sort="total_desc"
      onSortChange={vi.fn()}
      onOpenEstimate={vi.fn()}
      currentRole={role}
      onDeleteEstimate={withCallback ? onDeleteEstimate : undefined}
    />,
  );
  fireEvent.pointerDown(screen.getByTestId("estimate-row-actions-42"), {
    button: 0, ctrlKey: false, pointerType: "mouse",
  });
  return onDeleteEstimate;
}

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

describe("Command Center row Delete menu", () => {
  for (const [lifecycle, role] of [
    ["draft", "company_admin"], ["pending_review", "company_admin"],
    ["draft", "field_tech"],
  ] as const) {
    it(`offers Delete to ${role} on ${lifecycle}`, () => {
      const onDelete = mount(lifecycle, role);
      fireEvent.click(screen.getByTestId("row-delete-42"));
      expect(onDelete).toHaveBeenCalledWith(42);
    });
  }

  for (const role of ["field_tech", "unknown", null]) {
    it(`omits pending-review Delete for ${role}`, () => {
      mount("pending_review", role);
      expect(screen.queryByTestId("row-delete-42")).not.toBeInTheDocument();
      expect(screen.queryByTestId("row-delete-disabled-42")).not.toBeInTheDocument();
    });
  }

  for (const lifecycle of ["sent", "approved", "rejected", "expired"] as const) {
    it(`explains the audit restriction on ${lifecycle}`, () => {
      const onDelete = mount(lifecycle, "company_admin");
      const item = screen.getByTestId("row-delete-disabled-42");
      expect(within(item).getByText("Sent estimates are kept for audit")).toBeInTheDocument();
      expect(item).toHaveAttribute("data-disabled");
      fireEvent.click(item);
      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByTestId("row-delete-42")).not.toBeInTheDocument();
    });
  }

  it("does not render Delete if no callback is supplied", () => {
    mount("draft", "company_admin", false);
    expect(screen.queryByTestId("row-delete-42")).not.toBeInTheDocument();
  });
});
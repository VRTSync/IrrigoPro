import { fireEvent, render, screen } from "@testing-library/react";
import type { Estimate } from "@workspace/db/schema";
import { expect, it, vi } from "vitest";
import { AttentionStrip, type AttentionItem } from "./attention-strip";
import { EstimateTable } from "./estimate-table";
import { LifecycleKanban } from "./lifecycle-kanban";

it("wraps all eight attention cards instead of putting them in a scrolling strip", () => {
  const items: AttentionItem[] = Array.from({ length: 9 }, (_, i) => ({
    estimateId: i + 1,
    estimateNumber: String(i + 1),
    customerName: "Acme Grounds",
    totalAmount: 200,
    reason: "stuck_in_review",
    sinceDays: 7,
    lifecycle: "pending_review",
  }));
  render(<AttentionStrip items={items} isLoading={false} onOpenEstimate={vi.fn()} />);

  const strip = screen.getByTestId("attention-strip");
  expect(strip).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2", "lg:grid-cols-3", "2xl:grid-cols-4");
  expect(strip).not.toHaveClass("overflow-x-auto");
  expect(strip.children).toHaveLength(8);
  expect(strip.querySelector(":scope > .w-72, :scope > .shrink-0")).toBeNull();
});

it("wraps all six lifecycle columns when the board is open", () => {
  render(<LifecycleKanban estimates={[]} onOpenEstimate={vi.fn()} onViewAll={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Hide board" }));
  fireEvent.click(screen.getByRole("button", { name: "Show board" }));

  const board = screen.getByTestId("lifecycle-kanban");
  expect(board).toHaveClass("grid", "grid-cols-1", "sm:grid-cols-2", "lg:grid-cols-3", "2xl:grid-cols-6");
  expect(board).not.toHaveClass("overflow-x-auto");
  expect(board.children).toHaveLength(6);
  expect(board.querySelector(":scope > .w-72, :scope > .shrink-0")).toBeNull();
});

it("labels every estimate data cell and leaves actions and the empty state unlabeled", () => {
  const props = {
    lifecycleFilter: [],
    onLifecycleFilterChange: vi.fn(),
    attentionEstimateIds: null,
    onClearAttention: vi.fn(),
    sort: "total_desc" as const,
    onSortChange: vi.fn(),
    onOpenEstimate: vi.fn(),
  };
  const estimate = {
    id: 42, estimateNumber: "00042", customerName: "Acme Grounds",
    projectName: "Repairs", createdBy: "Admin", totalAmount: "200",
    lifecycle: "draft", createdAt: new Date(), updatedAt: new Date(),
  } as Estimate;
  const { rerender } = render(<EstimateTable {...props} estimates={[estimate]} />);

  const table = screen.getByRole("table");
  expect(table).toHaveClass("table-stack");
  const labels = ["Estimate #", "Customer", "Project", "Owner", "Lifecycle", "Total", "Age", "Last update"];
  expect(Array.from(table.querySelectorAll("th"), (header) => header.textContent?.trim())).toEqual([...labels, ""]);
  expect(Array.from(screen.getByTestId("estimate-row-42").querySelectorAll("td"), (cell) => cell.getAttribute("data-label")))
    .toEqual([...labels, null]);

  rerender(<EstimateTable {...props} estimates={[]} />);
  expect(screen.getByText("No estimates match")).not.toHaveAttribute("data-label");
});

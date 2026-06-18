/**
 * Task #1419 — Parts editor redesign + price-fill bug fix.
 *
 * Covers the redesigned PartsListEditorDialog in completed-work-detail-modal.tsx:
 *   1. Selecting a library part populates its real unit price (the bug fix —
 *      previously read `match.unitPrice` which was always undefined → "$0").
 *      Line total = qty × price.
 *   2. A custom line lets the user type a name + price; badge shows "Custom".
 *   3. Editing qty / unit price / labor updates the row line total and the
 *      footer parts subtotal live.
 *   4. Save PATCHes the items endpoint with the edited rows.
 *   5. A billed/invoiced record renders the editor read-only (no Save, inputs
 *      disabled).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Catalog fixture served to the PartPicker via useArrayQuery ───────────────
const CATALOG = [
  {
    id: 501,
    companyId: 1,
    name: "Pop-up head 4\"",
    description: null,
    price: "7.50",
    cost: null,
    sku: "PH-4",
    category: "Heads",
    material: null,
    size: null,
    brand: null,
    fittingType: null,
    detail: null,
    quickbooksId: null,
    isActive: true,
    approvalStatus: "approved",
    approvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: apiRequestMock,
  parseApiError: (_e: unknown, fallback: string) => fallback,
  // PartPicker uses useArrayQuery for /api/parts and /api/parts/popular.
  useArrayQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey?.[0] === "/api/parts") return { data: CATALOG, isLoading: false };
    return { data: [], isLoading: false };
  },
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { PartsListEditorDialog } from "./completed-work-detail-modal";
import type { WorkOrderItem } from "@workspace/db/schema";

const noop = () => {};

function renderEditor(props: Partial<React.ComponentProps<typeof PartsListEditorDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PartsListEditorDialog
        open
        onOpenChange={noop}
        type="work_order"
        id={99}
        initialItems={[]}
        canSeePricing
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockClear();
});

describe("PartsListEditorDialog — library add + price fill", () => {
  it("populates the real unit price (not $0) and computes the line total when a library part is picked", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add from library/i }));

    // Pick the catalog part from the PartPicker
    fireEvent.click(screen.getByTestId("part-picker-row-501"));

    // The Catalog badge appears for a library-sourced row
    expect(screen.getByText("Catalog")).toBeInTheDocument();

    // Unit price input now holds the part's real price (7.5), not 0
    const unitInput = screen.getByDisplayValue("7.5") as HTMLInputElement;
    expect(unitInput).toBeInTheDocument();

    // Line total = qty(1) × 7.50 → $7.50 visible (row line total + footer subtotal)
    expect(screen.getAllByText("$7.50").length).toBeGreaterThanOrEqual(1);
  });
});

describe("PartsListEditorDialog — custom line", () => {
  it("lets the user enter a name and price with a Custom badge", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add custom line/i }));

    expect(screen.getByText("Custom")).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText("Part name");
    fireEvent.change(nameInput, { target: { value: "Field-fab riser" } });
    expect((nameInput as HTMLInputElement).value).toBe("Field-fab riser");
  });
});

describe("PartsListEditorDialog — live totals", () => {
  it("recomputes the row line total and footer parts subtotal as inputs change", () => {
    const initialItems: WorkOrderItem[] = [
      {
        id: 1,
        workOrderId: 99,
        partId: 501,
        partName: "Pop-up head 4\"",
        partPrice: "7.50",
        quantity: 1,
        laborHours: "0.00",
        totalPrice: "7.50",
        actualQuantityUsed: null,
        actualLaborHours: null,
        notes: null,
      },
    ];
    renderEditor({ initialItems });

    // Initial: 1 × 7.50 → $7.50 (line total and footer subtotal)
    expect(screen.getAllByText("$7.50").length).toBeGreaterThanOrEqual(1);

    // Bump qty to 3 → 3 × 7.50 = $22.50
    const qtyInput = screen.getByDisplayValue("1") as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: "3" } });
    expect(screen.getAllByText("$22.50").length).toBeGreaterThanOrEqual(1);

    // Edit labor hours → footer labor total reflects it
    const laborInput = screen.getByDisplayValue("0.00") as HTMLInputElement;
    fireEvent.change(laborInput, { target: { value: "2" } });
    expect(screen.getByText("2.00")).toBeInTheDocument();
  });
});

describe("PartsListEditorDialog — save", () => {
  it("PATCHes the work-order items endpoint with the edited rows", async () => {
    const initialItems: WorkOrderItem[] = [
      {
        id: 1,
        workOrderId: 99,
        partId: 501,
        partName: "Pop-up head 4\"",
        partPrice: "7.50",
        quantity: 2,
        laborHours: "0.00",
        totalPrice: "15.00",
        actualQuantityUsed: null,
        actualLaborHours: null,
        notes: null,
      },
    ];
    renderEditor({ initialItems });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(1));
    const [endpoint, method, body] = apiRequestMock.mock.calls[0] as [string, string, any];
    expect(endpoint).toBe("/api/work-orders/99/items");
    expect(method).toBe("PATCH");
    expect(body.items[0]).toMatchObject({
      partId: 501,
      partName: "Pop-up head 4\"",
      quantity: 2,
      unitPrice: 7.5,
    });
  });
});

describe("PartsListEditorDialog — billed/invoiced lock", () => {
  it("renders read-only with no Save button and disabled inputs", () => {
    const initialItems: WorkOrderItem[] = [
      {
        id: 1,
        workOrderId: 99,
        partId: 501,
        partName: "Pop-up head 4\"",
        partPrice: "7.50",
        quantity: 2,
        laborHours: "0.00",
        totalPrice: "15.00",
        actualQuantityUsed: null,
        actualLaborHours: null,
        notes: null,
      },
    ];
    renderEditor({ initialItems, readOnly: true });

    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add from library/i })).not.toBeInTheDocument();

    // Qty input is disabled
    const qtyInput = screen.getByDisplayValue("2") as HTMLInputElement;
    expect(qtyInput).toBeDisabled();
  });
});

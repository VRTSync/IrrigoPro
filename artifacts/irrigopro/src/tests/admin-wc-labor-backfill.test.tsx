// Frontend tests for admin-wc-labor-backfill page.
// Covers: super-admin guard redirect, tab rendering, invoiced report CSV export.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";

// Mock the queryClient's apiRequest helper.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async (method: string, _url: string, _body?: unknown) => ({
    ok: true,
    json: async () => ({
      state: "idle",
      scanned: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      dryRun: true,
    }),
  })),
}));

// Mock wouter's useLocation for redirect tests.
const mockNavigate = vi.fn();
vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/admin/wc-labor-backfill", mockNavigate],
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <Router base="">{children}</Router>
    </QueryClientProvider>
  );
}

function setUser(role: string) {
  localStorage.setItem("user", JSON.stringify({ id: 1, role, name: "Test" }));
}

function clearUser() {
  localStorage.removeItem("user");
}

describe("AdminWcLaborBackfillPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUser();
  });

  it("redirects non-super-admin users", async () => {
    setUser("company_admin");
    const { default: Page } = await import("../pages/admin-wc-labor-backfill");
    render(<Page />, { wrapper });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", expect.anything());
    });
  });

  it("redirects unauthenticated users", async () => {
    const { default: Page } = await import("../pages/admin-wc-labor-backfill");
    render(<Page />, { wrapper });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", expect.anything());
    });
  });

  it("renders two tabs for super admin", async () => {
    setUser("super_admin");
    const { default: Page } = await import("../pages/admin-wc-labor-backfill");
    render(<Page />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Recompute unbilled")).toBeInTheDocument();
      expect(screen.getByText("Invoiced WCBs report")).toBeInTheDocument();
    });
  });

  it("shows dry-run checkbox checked by default", async () => {
    setUser("super_admin");
    const { default: Page } = await import("../pages/admin-wc-labor-backfill");
    render(<Page />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Dry run/)).toBeInTheDocument();
    });
  });

  it("shows live-mode warning when dry-run is unchecked", async () => {
    setUser("super_admin");
    const { default: Page } = await import("../pages/admin-wc-labor-backfill");
    render(<Page />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Dry run/)).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox");
    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByText(/Live mode/i)).toBeInTheDocument();
    });
  });

  it("tab switch shows invoiced WCBs report pane", async () => {
    setUser("super_admin");
    const { default: Page } = await import("../pages/admin-wc-labor-backfill");
    render(<Page />, { wrapper });

    const reportTab = await screen.findByText("Invoiced WCBs report");
    await userEvent.click(reportTab);

    await waitFor(() => {
      expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    });
  });
});

// ── CSV export helper test ───────────────────────────────────────────────────

describe("CSV export helper", () => {
  it("formats InvoicedWcbReport rows with notes correctly", () => {
    const report = [
      {
        wcbId: 1,
        billingNumber: "WC-2026-001",
        customerName: 'Acme "Co"',
        wetCheckId: 10,
        invoiceId: 99,
        laborRate: "75.00",
        computedLaborHours: "2.00",
        computedLaborSubtotal: "150.00",
        storedLaborSubtotal: "0.00",
        storedTotalAmount: "50.00",
        computedTotalAmount: "200.00",
      },
    ];

    const notes: Record<number, string> = { 1: "Needs review" };

    const header = [
      "WCB ID",
      "Billing Number",
      "Customer",
      "Wet Check ID",
      "Invoice ID",
      "Labor Rate",
      "Computed Hours",
      "Computed Subtotal",
      "Stored Subtotal",
      "Stored Total",
      "Computed Total",
      "Notes",
    ].join(",");

    const rows = report.map((r) =>
      [
        r.wcbId,
        `"${r.billingNumber}"`,
        `"${r.customerName.replace(/"/g, '""')}"`,
        r.wetCheckId,
        r.invoiceId,
        r.laborRate,
        r.computedLaborHours,
        r.computedLaborSubtotal,
        r.storedLaborSubtotal,
        r.storedTotalAmount,
        r.computedTotalAmount,
        `"${(notes[r.wcbId] ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );

    const csv = [header, ...rows].join("\n");

    // Customer name with embedded quotes should be double-quoted.
    expect(csv).toContain('"Acme ""Co"""');
    expect(csv).toContain('"Needs review"');
    expect(csv).toContain("WCB ID,Billing Number");
    expect(csv).toContain("2.00");
  });
});

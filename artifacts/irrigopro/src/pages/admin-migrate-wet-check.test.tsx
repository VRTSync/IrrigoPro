// Task #808 — Smoke tests for AdminMigrateWetCheckPage.
// Covers: each state renders correct UI, button visibility, typed-MIGRATE
// confirmation modal, and reconciliation panel rendering.

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, beforeEach, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import AdminMigrateWetCheckPage from "./admin-migrate-wet-check";

// ── Minimal mocks ─────────────────────────────────────────────────────────────

// Mock apiRequest so we control what the status endpoint returns.
mock.module("@/lib/queryClient", () => ({
  apiRequest: mock.fn(async (_method: string, _url: string, _body?: unknown) => ({
    ok: true,
    json: async () => idleSnapshot,
  })),
}));

// Minimal toast mock.
mock.module("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

// ── Snapshot fixtures ─────────────────────────────────────────────────────────

const idleSnapshot = {
  state: "idle",
  jobId: null,
  startedAt: null,
  completedAt: null,
  processed: 0,
  total: 0,
  failed: 0,
  currentBsId: null,
  lastError: null,
  result: null,
  preReport: null,
  postReport: null,
  cancelRequested: false,
};

const runningSnapshot = {
  ...idleSnapshot,
  state: "running",
  jobId: "bswc-123",
  startedAt: new Date().toISOString(),
  processed: 3,
  total: 10,
};

const completedSnapshot = {
  ...idleSnapshot,
  state: "completed",
  jobId: "bswc-456",
  startedAt: new Date(Date.now() - 5000).toISOString(),
  completedAt: new Date().toISOString(),
  processed: 10,
  total: 10,
  preReport: {
    bsWcCount: 10,
    bsWcDistinctCustomers: 3,
    bsWcTotalValue: 1500.0,
    bsWcAlreadyBilled: 2,
    findingsLinkedToBsWc: 25,
    invoiceItemsLinkedToBsWc: 8,
    wcbCount: 0,
    danglingFindingsBsWcId: 0,
    danglingInvoiceItemsBsWcId: 0,
  },
  postReport: {
    bsWcCount: 0,
    bsWcDistinctCustomers: 0,
    bsWcTotalValue: 0,
    bsWcAlreadyBilled: 0,
    findingsLinkedToBsWc: 0,
    invoiceItemsLinkedToBsWc: 0,
    wcbCount: 10,
    danglingFindingsBsWcId: 0,
    danglingInvoiceItemsBsWcId: 0,
  },
  result: {
    migrated: 10,
    skippedAlreadyDone: 0,
    failed: 0,
    failedIds: [],
    preReport: {} as never,
    assertionsPassed: true,
  },
};

const failedSnapshot = {
  ...completedSnapshot,
  state: "failed",
  failed: 2,
  lastError: "2 row(s) failed — see reconciliation report",
  result: {
    ...completedSnapshot.result,
    migrated: 8,
    failed: 2,
    failedIds: [101, 102],
    assertionsPassed: false,
  },
};

// ── Test wrapper ──────────────────────────────────────────────────────────────

function renderPage(snapshot = idleSnapshot) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Pre-populate the cache with the desired snapshot.
  qc.setQueryData(["/api/admin/migrate-bs-wc/status"], snapshot);

  const { unmount } = render(
    <QueryClientProvider client={qc}>
      <AdminMigrateWetCheckPage />
    </QueryClientProvider>,
  );
  return { unmount };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AdminMigrateWetCheckPage", () => {
  it("idle state — shows Run Migration and Dry Run buttons", () => {
    const { unmount } = renderPage(idleSnapshot);
    assert.ok(screen.getByRole("button", { name: /run migration/i }));
    assert.ok(screen.getByRole("button", { name: /dry run/i }));
    assert.equal(screen.queryByRole("button", { name: /cancel/i }), null);
    assert.equal(screen.queryByRole("button", { name: /reset/i }), null);
    unmount();
  });

  it("running state — shows Cancel button, hides Run/Dry-run", () => {
    const { unmount } = renderPage(runningSnapshot as never);
    assert.ok(screen.getByRole("button", { name: /cancel/i }));
    assert.equal(screen.queryByRole("button", { name: /run migration/i }), null);
    assert.equal(screen.queryByRole("button", { name: /dry run/i }), null);
    unmount();
  });

  it("running state — shows progress percentage", () => {
    const { unmount } = renderPage(runningSnapshot as never);
    assert.ok(screen.getByText(/30%/));
    unmount();
  });

  it("completed state — shows Reset button, hides Run/Cancel", () => {
    const { unmount } = renderPage(completedSnapshot as never);
    assert.ok(screen.getByRole("button", { name: /reset/i }));
    assert.equal(screen.queryByRole("button", { name: /run migration/i }), null);
    assert.equal(screen.queryByRole("button", { name: /cancel/i }), null);
    unmount();
  });

  it("completed state — shows reconciliation report table", () => {
    const { unmount } = renderPage(completedSnapshot as never);
    assert.ok(screen.getByText(/reconciliation report/i));
    unmount();
  });

  it("failed state — shows failed rows section", () => {
    const { unmount } = renderPage(failedSnapshot as never);
    assert.ok(screen.getByText(/failed rows/i));
    unmount();
  });

  it("confirmation modal — Run Migration button stays disabled until MIGRATE is typed", async () => {
    const { unmount } = renderPage(idleSnapshot);

    // Click "Run Migration" to open the modal.
    fireEvent.click(screen.getByRole("button", { name: /run migration/i }));

    await waitFor(() => {
      assert.ok(screen.getByRole("dialog"));
    });

    // The confirm button inside the dialog should be disabled initially.
    const confirmBtn = screen.getAllByRole("button", { name: /run migration/i }).find((b) =>
      b.closest("[role=dialog]"),
    );
    assert.ok(confirmBtn, "Confirm button inside dialog should exist");
    assert.ok((confirmBtn as HTMLButtonElement).disabled);

    // Type partial text — still disabled.
    const input = screen.getByPlaceholderText("MIGRATE");
    fireEvent.change(input, { target: { value: "MIGRAT" } });
    assert.ok((confirmBtn as HTMLButtonElement).disabled);

    // Type complete word — should enable.
    fireEvent.change(input, { target: { value: "MIGRATE" } });
    assert.ok(!(confirmBtn as HTMLButtonElement).disabled);

    unmount();
  });
});

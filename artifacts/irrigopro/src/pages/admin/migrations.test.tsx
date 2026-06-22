// Tests for the PreviewModal gate logic in admin/migrations.tsx.
//
// Cases covered:
//   (a) Preview with only informational counts (candidate > 0), skipped=0,
//       failed=0, no warnings → Run enabled immediately, no checkbox.
//   (b) Preview with skipped > 0, failed > 0, or with warnings → checkbox
//       renders, Run is disabled until checked.
//   (c) Preview loading / not yet arrived → Run button stays disabled.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

import type { MigrationPreview } from "@/types/migrations";

// ── apiRequest mock (overridden per-test) ──────────────────────────────────

const mockApiRequest = vi.fn<[string, string], Promise<unknown>>();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...(args as [string, string])),
}));

vi.mock("@/components/admin/MigrationRunner", () => ({
  MigrationRunner: () => <div data-testid="migration-runner" />,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <Router base="">{children}</Router>
    </QueryClientProvider>
  );
}

async function renderModal(migrationId = "test-migration") {
  const { PreviewModal } = await import("./migrations");
  const onClose = vi.fn();
  render(<PreviewModal migrationId={migrationId} onClose={onClose} />, {
    wrapper: Wrapper,
  });
  return { onClose };
}

function setupPreview(preview: MigrationPreview) {
  mockApiRequest.mockResolvedValue(preview);
}

// ── Case (a): clean preview — informational counts only, no orphans, no warnings ──

describe("PreviewModal — clean preview (candidates only, skipped=0, failed=0, no warnings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPreview({
      steps: [{ id: "step1", description: "1 candidate work order(s) to process; 0 already stamped." }],
      orphanRows: { skipped: 0, failed: 0 },
      warnings: [],
    });
  });

  it("renders the Run Migration button in an enabled state", async () => {
    await renderModal();
    const btn = await screen.findByRole("button", { name: /Run Migration/i });
    expect(btn).not.toBeDisabled();
  });

  it("does not render the acknowledgement checkbox", async () => {
    await renderModal();
    await screen.findByRole("button", { name: /Run Migration/i });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

// ── Case (b): problematic preview — orphans or warnings require acknowledgement ──

describe("PreviewModal — skipped > 0 → checkbox shown, Run disabled until checked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPreview({
      steps: [{ id: "step1", description: "Backfill zones." }],
      orphanRows: { skipped: 2, failed: 0 },
      warnings: [],
    });
  });

  it("renders the acknowledgement checkbox", async () => {
    await renderModal();
    await screen.findByRole("checkbox");
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("Run Migration button is disabled before acknowledgement", async () => {
    await renderModal();
    const btn = await screen.findByRole("button", { name: /Run Migration/i });
    expect(btn).toBeDisabled();
  });

  it("Run Migration button becomes enabled after acknowledging", async () => {
    await renderModal();
    const checkbox = await screen.findByRole("checkbox");
    await userEvent.click(checkbox);
    const btn = screen.getByRole("button", { name: /Run Migration/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("PreviewModal — failed > 0 → checkbox shown, Run disabled until checked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPreview({
      steps: [{ id: "step1", description: "Backfill zones." }],
      orphanRows: { skipped: 0, failed: 1 },
      warnings: ["1 work order(s) failed a prior run — they will be retried."],
    });
  });

  it("renders the acknowledgement checkbox", async () => {
    await renderModal();
    await screen.findByRole("checkbox");
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("Run Migration is disabled before acknowledgement", async () => {
    await renderModal();
    const btn = await screen.findByRole("button", { name: /Run Migration/i });
    expect(btn).toBeDisabled();
  });

  it("Run Migration becomes enabled after acknowledging", async () => {
    await renderModal();
    const checkbox = await screen.findByRole("checkbox");
    await userEvent.click(checkbox);
    const btn = screen.getByRole("button", { name: /Run Migration/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("PreviewModal — warnings only (no orphans) → checkbox shown, Run disabled until checked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPreview({
      steps: [{ id: "sheet_1", description: "Billing sheet #1 → invoice #2: +$50.00." }],
      orphanRows: { invoicesAffected: 1 },
      warnings: [
        "1 billing sheet(s) · 1 invoice(s) · total +$50.00 to customers.",
        "Add-parts semantics: affected customers will be billed MORE. Acknowledge to proceed.",
      ],
    });
  });

  it("renders the acknowledgement checkbox", async () => {
    await renderModal();
    await screen.findByRole("checkbox");
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("Run Migration is disabled before acknowledgement", async () => {
    await renderModal();
    const btn = await screen.findByRole("button", { name: /Run Migration/i });
    expect(btn).toBeDisabled();
  });

  it("Run Migration becomes enabled after acknowledging", async () => {
    await renderModal();
    const checkbox = await screen.findByRole("checkbox");
    await userEvent.click(checkbox);
    const btn = screen.getByRole("button", { name: /Run Migration/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

// ── Case (c): preview not yet loaded → Run stays disabled ─────────────────

describe("PreviewModal — preview not yet loaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Never resolves — simulates slow/pending fetch.
    mockApiRequest.mockReturnValue(new Promise(() => {}));
  });

  it("shows a loading state and no Run button while preview is pending", async () => {
    await renderModal();
    await waitFor(() => {
      expect(screen.getByText(/Loading preview/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Run Migration/i })).toBeNull();
  });
});

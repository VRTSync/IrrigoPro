// Task #630 — Behavioral regression test for bug #1 + role gating.
//
// What this exercises:
//   1. Mounts the real <EstimateDetailModal/> inside a QueryClient
//      and Toaster, populated with a stub estimate, and asserts that:
//      a. Clicking "Download PDF" calls the real handler, fetches the
//         PDF endpoint, builds a blob URL, attaches the <a> with the
//         right filename and rel="noopener", clicks it, and removes
//         the node.
//      b. A second click while the first request is in flight is a
//         no-op (the idempotency guard).
//      c. When the server returns 403 with a JSON `{ message }`
//         body, the toast shows the server's message — not the bare
//         "Failed (403)" string the old handler used.
//   2. Mounts the modal with the user's role set to `field_tech` and
//      asserts the View/Download PDF buttons do not render at all
//      (Task #630 done-criterion: "If a role isn't allowed to see the
//      estimate, the buttons don't render at all").
//   3. Mounts with role=`manager` (the role explicitly named in the
//      task) and asserts the buttons DO render — guarding the
//      regression that motivated widening the server middleware.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EstimateDetailModal } from "./estimate-detail-modal";
import { Toaster } from "@/components/ui/toaster";

// ---------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------

const ESTIMATE_FIXTURE = {
  id: 42,
  estimateNumber: "EST-42",
  status: "pending",
  internalStatus: "pending_approval",
  lifecycleStatus: "pending",
  customerName: "Acme",
  customerEmail: "a@example.com",
  projectName: "Test",
  workDescription: "",
  items: [],
  partsSubtotal: "0.00",
  laborSubtotal: "0.00",
  totalAmount: "0.00",
  laborRate: "75.00",
  appliedLaborRate: "75.00",
  estimateDate: new Date("2026-05-01T00:00:00Z").toISOString(),
  photos: [],
  attachments: [],
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const path = String(queryKey[0]);
          if (path === "/api/estimates" && queryKey[1] === 42) {
            return ESTIMATE_FIXTURE;
          }
          return null;
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderModal(client: QueryClient): { unmount: () => void } {
  return render(
    <QueryClientProvider client={client}>
      <EstimateDetailModal
        open={true}
        onOpenChange={() => {}}
        estimateId={42}
      />
      <Toaster />
    </QueryClientProvider>,
  );
}

function setRole(role: string): void {
  window.localStorage.setItem(
    "user",
    JSON.stringify({ id: 1, role, companyId: 1, name: "Test" }),
  );
}

// jsdom doesn't implement URL.createObjectURL / revokeObjectURL by
// default, and we want to assert the anchor was wired up correctly,
// so install fakes.
function installBlobUrlStubs(): {
  createSpy: ReturnType<typeof vi.fn>;
  revokeSpy: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  const createSpy = vi.fn(() => `blob:test-${++n}`);
  const revokeSpy = vi.fn();
  (URL as unknown as { createObjectURL: typeof URL.createObjectURL })
    .createObjectURL = createSpy;
  (URL as unknown as { revokeObjectURL: typeof URL.revokeObjectURL })
    .revokeObjectURL = revokeSpy;
  return { createSpy, revokeSpy };
}

// Track anchor clicks: when the handler does `a.click()` on a
// dynamically-created element, we want to see the href/download/rel
// at click time so we can assert the handler built the URL correctly.
function trackAnchorClicks(): { clicked: HTMLAnchorElement[] } {
  const clicked: HTMLAnchorElement[] = [];
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push(this);
  };
  (globalThis as unknown as { __restoreAnchorClick?: () => void })
    .__restoreAnchorClick = () => {
      HTMLAnchorElement.prototype.click = original;
    };
  return { clicked };
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe("Estimate PDF download — behavioral (Task #630, bug #1)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let restoreFetch: () => void;

  beforeEach(() => {
    setRole("company_admin");
    fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };
  });

  afterEach(() => {
    restoreFetch();
    (
      globalThis as unknown as { __restoreAnchorClick?: () => void }
    ).__restoreAnchorClick?.();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("Download PDF: fetches the endpoint, builds an anchor with the right filename + rel='noopener', clicks it, and revokes the blob URL", async () => {
    const { createSpy, revokeSpy } = installBlobUrlStubs();
    const { clicked } = trackAnchorClicks();
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    fetchSpy.mockResolvedValueOnce(
      new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    const client = makeQueryClient();
    renderModal(client);
    const button = await screen.findByTestId("detail-modal-download-pdf");

    await userEvent.click(button);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const [calledUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain("/api/estimates/42/pdf");
    expect(calledUrl).toContain("download=1");

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clicked.length).toBe(1));

    const a = clicked[0];
    expect(a.href).toContain("blob:test-1");
    expect(a.download).toBe("estimate-EST-42.pdf");
    expect(a.rel).toBe("noopener");

    // The revoke is on a setTimeout(…, 1000) — wait it out so we
    // can confirm we don't leak the object URL.
    await waitFor(() => expect(revokeSpy).toHaveBeenCalled(), {
      timeout: 2500,
    });
  });

  it("Download PDF: a second click while the first request is in flight is a no-op (idempotency guard)", async () => {
    installBlobUrlStubs();
    trackAnchorClicks();
    // Hold the first request open so we can issue a second click
    // before it resolves.
    let resolveFirst!: (v: Response) => void;
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolveFirst = r;
      }),
    );

    const client = makeQueryClient();
    renderModal(client);
    const button = await screen.findByTestId("detail-modal-download-pdf");

    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Resolve so we leave React Query in a clean state.
    resolveFirst(
      new Response(new Uint8Array([0]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it("Download PDF: surfaces the server's `{ message }` from a JSON 403 (not the bare status string)", async () => {
    installBlobUrlStubs();
    trackAnchorClicks();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message:
            "Access denied. The estimate PDF is restricted to managers and administrators.",
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const client = makeQueryClient();
    renderModal(client);
    const button = await screen.findByTestId("detail-modal-download-pdf");

    await userEvent.click(button);

    // Toast surfaces the server's message verbatim.
    expect(
      await screen.findByText(/restricted to managers and administrators/i),
    ).toBeInTheDocument();
    // And does NOT show the bare-status fallback.
    expect(screen.queryByText(/Failed \(403\)/)).not.toBeInTheDocument();
  });
});

describe("Estimate PDF buttons — role gating (Task #630)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("field_tech: View/Download PDF buttons do not render", async () => {
    setRole("field_tech");
    const client = makeQueryClient();
    renderModal(client);

    // Wait until the modal has hydrated with the fixture so the
    // footer is in the DOM.
    await screen.findByTestId("detail-modal-footer");

    expect(
      screen.queryByTestId("detail-modal-view-pdf"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("detail-modal-download-pdf"),
    ).not.toBeInTheDocument();
  });

  it("manager: View/Download PDF buttons render (task spec done-criterion)", async () => {
    setRole("manager");
    const client = makeQueryClient();
    renderModal(client);

    await screen.findByTestId("detail-modal-footer");
    expect(screen.getByTestId("detail-modal-view-pdf")).toBeInTheDocument();
    expect(screen.getByTestId("detail-modal-download-pdf")).toBeInTheDocument();
  });

  it("billing_manager: View/Download PDF buttons render", async () => {
    setRole("billing_manager");
    const client = makeQueryClient();
    renderModal(client);

    await screen.findByTestId("detail-modal-footer");
    expect(screen.getByTestId("detail-modal-view-pdf")).toBeInTheDocument();
    expect(screen.getByTestId("detail-modal-download-pdf")).toBeInTheDocument();
  });
});

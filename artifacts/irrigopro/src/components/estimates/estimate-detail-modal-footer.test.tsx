// Task #630 — Regression test for bug #2.
//
// The detail modal footer used to be a single
// `flex flex-col sm:flex-row justify-end gap-3` row, which on the
// `pending` track renders up to seven buttons (Close, View PDF,
// Download PDF, Resend, Edit, Email, Approve, Reject). At any
// `sm:`-and-up viewport that doesn't fit on the narrower laptop
// widths and the rightmost actions overflowed past the modal edge.
//
// The fix groups secondary actions on the left and primary actions
// on the right, wraps the outer container with `flex-wrap`, and
// keeps each inner cluster flex-wrap as well. This test is a
// static-source guard — Tailwind's responsive classes don't apply
// in jsdom so we assert directly on the class strings that the fix
// is in place and can't silently regress.

import { afterEach, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EstimateDetailModal } from "./estimate-detail-modal";
import { EstimatesManager } from "@/components/manager/estimates-manager";
import { Toaster } from "@/components/ui/toaster";

vi.mock("@/components/estimates/convert-to-work-order-modal", () => ({
  ConvertToWorkOrderModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: (id: number) => void }) =>
    isOpen ? <button onClick={() => onConfirm(9)}>Confirm conversion</button> : null,
}));

const SOURCE_PATH = path.resolve(
  import.meta.dirname,
  "estimate-detail-modal.tsx",
);
const source = fs.readFileSync(SOURCE_PATH, "utf8");

describe("Estimate detail modal footer layout (Task #630, bug #2)", () => {
  it("the footer container is tagged with data-testid='detail-modal-footer'", () => {
    expect(source).toContain('data-testid="detail-modal-footer"');
  });

  it("the outer footer row uses flex-wrap so buttons cannot overflow off-screen", () => {
    // The whole point of the fix: the outer wrapper must allow wrapping
    // at sm+ widths. Without `sm:flex-wrap` the seven-button pending
    // toolbar slices off the right edge on a 1024x600 laptop.
    expect(source).toMatch(
      /flex flex-col-reverse sm:flex-row sm:flex-wrap[^"]*sm:justify-between/,
    );
  });

  it("each inner cluster (secondary + primary) is also flex-wrap so dense rows wrap onto two lines instead of clipping", () => {
    const inner = source.match(/sm:flex-wrap/g) ?? [];
    // outer + secondary + primary
    expect(inner.length).toBeGreaterThanOrEqual(3);
  });

  it("does not regress to the legacy single-row layout with `justify-end` and no wrap", () => {
    // The exact pre-fix class string. If anyone reverts the JSX this
    // string will reappear and we want the regression to fail loudly.
    expect(source).not.toContain(
      'className="flex flex-col sm:flex-row justify-end gap-3"',
    );
  });

  it("Download PDF and View PDF buttons live inside the footer and carry stable testids", () => {
    expect(source).toContain('data-testid="detail-modal-download-pdf"');
    expect(source).toContain('data-testid="detail-modal-view-pdf"');
    expect(source).toContain('data-testid="detail-modal-close"');
  });

  it("Approve / Reject / Email Customer / Convert buttons all carry stable testids so future overflow tests have anchors", () => {
    for (const id of [
      "detail-modal-send-email",
      "detail-modal-approve",
      "detail-modal-reject",
      "detail-modal-convert",
    ]) {
      expect(source).toContain(`data-testid="${id}"`);
    }
  });
});

const branchInstruction =
  "Branch is required for this customer. Open the estimate and choose a branch before sending or approving it.";

function fixture(status: "pending" | "approved" | "draft" | "rejected" = "pending") {
  return {
    id: 42,
    estimateNumber: "EST-42",
    status,
    internalStatus: status === "draft" ? "draft" : status === "pending" ? "pending_approval" : "sent_to_customer",
    customerName: "Acme",
    customerEmail: "a@example.com",
    projectName: "Legacy estimate",
    projectAddress: "123 Main St",
    createdAt: new Date().toISOString(),
    estimateDate: new Date().toISOString(),
    totalAmount: "100.00",
    partsSubtotal: "100.00",
    laborSubtotal: "0.00",
    laborRate: "75.00",
    items: [],
    photos: [],
    attachments: [],
    branchName: null as string | null,
  };
}

function harness(estimate: ReturnType<typeof fixture>, manager = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        queryFn: async ({ queryKey }) =>
          queryKey[0] === "/api/estimates" && queryKey[1] === estimate.id ? estimate : null,
      },
      mutations: { retry: false },
    },
  });
  if (manager) client.setQueryData(["/api/estimates"], [estimate]);
  const view = render(
    <QueryClientProvider client={client}>
      {manager
        ? <EstimatesManager onBack={() => {}} />
        : <EstimateDetailModal open onOpenChange={() => {}} estimateId={estimate.id} />}
      <Toaster />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function failWith(message: string) {
  return new Response(JSON.stringify({ message }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

function mockActionFetch(responses: Array<Response | Error>) {
  let call = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET" &&
      (url.includes("/api/estimates/42/") || url.endsWith("/api/estimates/42"))) {
      const result = responses[call++];
      if (result instanceof Error) throw result;
      if (!result) throw new Error(`Unexpected estimate mutation: ${url}`);
      return result;
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

describe("Estimate action error toasts", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("approval displays the branch instruction, then succeeds after the branch is saved", async () => {
    window.localStorage.setItem("user", JSON.stringify({ id: 1, role: "company_admin" }));
    const estimate = fixture();
    const fetchMock = mockActionFetch([
      failWith(branchInstruction),
      new Response(JSON.stringify({ id: 42 }), { status: 200 }),
    ]);
    const { client } = harness(estimate);
    fireEvent.click(await screen.findByTestId("detail-modal-approve"));
    expect(await screen.findByText(branchInstruction)).toBeInTheDocument();
    expect(screen.queryByText(/400:|{"message":/)).not.toBeInTheDocument();

    // Simulate the wizard's saved branch before retrying the same estimate.
    estimate.branchName = "North Campus";
    client.setQueryData(["/api/estimates", 42], { ...estimate });
    fireEvent.click(screen.getByTestId("detail-modal-approve"));
    expect(await screen.findByText("Estimate approved successfully")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/estimates/42/approve"))).toHaveLength(2);
  });

  it("approval retains its generic fallback when the network provides no server message", async () => {
    mockActionFetch([new TypeError("Failed to fetch")]);
    harness(fixture());
    fireEvent.click(await screen.findByTestId("detail-modal-approve"));
    expect(await screen.findByText("Failed to approve estimate")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("detail conversion shows the branch instruction and preserves its fallback", async () => {
    mockActionFetch([failWith(branchInstruction), new TypeError("Failed to fetch")]);
    harness(fixture("approved"));
    fireEvent.click(await screen.findByTestId("detail-modal-convert"));
    fireEvent.click(screen.getByText("Confirm conversion"));
    expect(await screen.findByText(branchInstruction)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Confirm conversion")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm conversion"));
    expect(await screen.findByText("Failed to convert estimate to work order")).toBeInTheDocument();
  });

  it("manager list conversion shows the branch instruction, and retains its fallback", async () => {
    mockActionFetch([failWith(branchInstruction), new TypeError("Failed to fetch")]);
    harness(fixture("approved"), true);
    fireEvent.click(await screen.findByText("Convert to Work Order"));
    fireEvent.click(screen.getByText("Confirm conversion"));
    expect(await screen.findByText(branchInstruction)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Confirm conversion"));
    expect(await screen.findByText("Failed to convert estimate to work order")).toBeInTheDocument();
  });

  it("reject and mark-sent show clean server messages rather than status and JSON", async () => {
    window.localStorage.setItem("user", JSON.stringify({ id: 1, role: "company_admin" }));
    mockActionFetch([failWith("Rejection was blocked."), failWith("Select a branch before marking sent.")]);
    harness(fixture());
    fireEvent.click(await screen.findByTestId("detail-modal-reject"));
    expect(await screen.findByText("Rejection was blocked.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("detail-modal-mark-sent"));
    fireEvent.click(screen.getByTestId("mark-sent-confirm"));
    expect(await screen.findByText("Select a branch before marking sent.")).toBeInTheDocument();
    expect(screen.queryByText(/400:|{"message":/)).not.toBeInTheDocument();
  });

  it("reject, mark-sent, unapprove, unreject, send and delete handlers use the shared extractor", () => {
    const modalSource = fs.readFileSync(SOURCE_PATH, "utf8");
    for (const name of [
      "rejectEstimateMutation", "markSentMutation", "unapproveEstimateMutation",
      "unrejectedEstimateMutation", "sendApprovalEmailMutation", "deleteEstimateMutation",
    ]) {
      const block = modalSource.split(`const ${name} = useMutation({`)[1]?.split("\n  });")[0];
      expect(block, name).toMatch(/onError: \([^)]*\) => \{[\s\S]*description: parseApiError\(/);
    }
  });
});

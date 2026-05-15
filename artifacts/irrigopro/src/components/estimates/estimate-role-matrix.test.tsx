// Task #632 — Frontend role × screen visibility matrix for the
// estimate detail modal.
//
// What this pins:
//   For every supported role (super_admin, company_admin, manager,
//   irrigation_manager, billing_manager, field_tech), the modal
//   renders exactly the right footer buttons. The matrix below is
//   the source of truth: any drift between this table and the
//   modal's rendering is a contract change and must be made
//   deliberately by updating both at once.
//
// Buttons in scope (testid):
//   • detail-modal-view-pdf       — gated by PDF_READ_ROLES
//   • detail-modal-download-pdf   — gated by PDF_READ_ROLES
//   • detail-modal-approve        — gated by estimate.status==='pending'
//   • detail-modal-reject         — gated by estimate.status==='pending'
//   • detail-modal-send-email     — gated by estimate.status==='pending'
//   • detail-modal-convert        — gated by estimate.status==='approved'
//
// Approve/Reject/Email/Convert are currently *not* role-gated on the
// frontend — the server backstops them with 403 from
// requireEstimateApprovalAccess. Pinning the current visibility here
// means a future client-side role gate cannot ship without updating
// this test, and the server's 403 contract is captured by the
// matching estimate-role-matrix.test.ts in api-server.

import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { EstimateDetailModal } from "./estimate-detail-modal";

// ─── Fixtures ────────────────────────────────────────────────────────────────
function pendingEstimate(id = 100) {
  return {
    id,
    estimateNumber: `EST-${id}`,
    status: "pending",
    internalStatus: "pending_approval",
    lifecycleStatus: "pending",
    customerName: "Acme",
    customerEmail: "a@example.com",
    projectName: "Pending matrix",
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
}

function approvedEstimate(id = 200) {
  return { ...pendingEstimate(id), status: "approved", lifecycleStatus: "approved" };
}

// ─── Harness ─────────────────────────────────────────────────────────────────
function makeClientFor(estimate: ReturnType<typeof pendingEstimate>): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        queryFn: async ({ queryKey }) => {
          const path = String(queryKey[0]);
          if (path === "/api/estimates" && queryKey[1] === estimate.id) return estimate;
          return null;
        },
      },
      mutations: { retry: false },
    },
  });
}

function setRole(role: string): void {
  window.localStorage.setItem(
    "user",
    JSON.stringify({ id: 1, role, companyId: 1, name: "Test" }),
  );
}

function renderModalFor(estimate: ReturnType<typeof pendingEstimate>) {
  const client = makeClientFor(estimate);
  return render(
    <QueryClientProvider client={client}>
      <EstimateDetailModal open={true} onOpenChange={() => {}} estimateId={estimate.id} />
    </QueryClientProvider>,
  );
}

// ─── Matrix ──────────────────────────────────────────────────────────────────
const PDF_ROLES = new Set([
  "super_admin",
  "company_admin",
  "billing_manager",
  "manager",
  "irrigation_manager",
]);

const ALL_ROLES = [
  "super_admin",
  "company_admin",
  "manager",
  "irrigation_manager",
  "billing_manager",
  "field_tech",
] as const;

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("EstimateDetailModal role × button matrix (Task #632)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  for (const role of ALL_ROLES) {
    it(`role=${role} on a PENDING estimate: PDF buttons gated by role; Approve/Reject/Email render for everyone (server enforces 403)`, async () => {
      setRole(role);
      renderModalFor(pendingEstimate());
      await screen.findByTestId("detail-modal-footer");

      // PDF buttons — gated by PDF_READ_ROLES.
      const expectPdf = PDF_ROLES.has(role);
      expect(!!screen.queryByTestId("detail-modal-view-pdf")).toBe(expectPdf);
      expect(!!screen.queryByTestId("detail-modal-download-pdf")).toBe(expectPdf);

      // Approve / Reject / Email Customer — currently rendered for
      // every role because the gate is on estimate.status only. The
      // server backstops with 403 (see estimate-role-matrix.test.ts).
      // If a future change adds a client-side role gate here, update
      // this test in lock-step.
      expect(screen.getByTestId("detail-modal-approve")).toBeInTheDocument();
      expect(screen.getByTestId("detail-modal-reject")).toBeInTheDocument();
      expect(screen.getByTestId("detail-modal-send-email")).toBeInTheDocument();

      // Convert appears only on approved estimates.
      expect(screen.queryByTestId("detail-modal-convert")).not.toBeInTheDocument();
    });

    it(`role=${role} on an APPROVED estimate: Convert renders for everyone; Approve/Reject/Email do not`, async () => {
      setRole(role);
      renderModalFor(approvedEstimate());
      await screen.findByTestId("detail-modal-footer");

      // Convert is gated by estimate.status==='approved' (not role).
      expect(screen.getByTestId("detail-modal-convert")).toBeInTheDocument();

      // Approval actions are gated to status==='pending'.
      expect(screen.queryByTestId("detail-modal-approve")).not.toBeInTheDocument();
      expect(screen.queryByTestId("detail-modal-reject")).not.toBeInTheDocument();
      expect(screen.queryByTestId("detail-modal-send-email")).not.toBeInTheDocument();

      // PDF still follows the role gate.
      const expectPdf = PDF_ROLES.has(role);
      expect(!!screen.queryByTestId("detail-modal-view-pdf")).toBe(expectPdf);
      expect(!!screen.queryByTestId("detail-modal-download-pdf")).toBe(expectPdf);
    });
  }

  // Anchoring case: with no user in localStorage (logged out, or the
  // role lookup failed), PDF buttons must NOT appear. The frontend's
  // readCurrentUserRole returns null on parse failures, and
  // canSeeEstimatePdf treats null as "no". Pin that here so a future
  // "default to manager" refactor doesn't silently leak the PDF.
  it("no user in localStorage: PDF buttons do not render even on a pending estimate", async () => {
    window.localStorage.removeItem("user");
    renderModalFor(pendingEstimate());
    await screen.findByTestId("detail-modal-footer");
    expect(screen.queryByTestId("detail-modal-view-pdf")).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-modal-download-pdf")).not.toBeInTheDocument();
  });
});

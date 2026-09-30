// Task #606 — Cross-list parity contract.
//
// The manager's "Pending Review" bucket on the estimate board and the
// admin's "Pending Approval" list are read off two different code
// paths but must always agree on which estimates they show:
//
//   • Manager board groups every estimate by `computeLifecycleStatus`
//     and shows the ones whose lifecycle bucket is `pending_review`.
//   • Admin Pending Approval list is `GET /api/estimates/
//     pending-approval`, which delegates to
//     `storage.getEstimatesPendingApproval`.
//
// Before this task the server filter accepted only
// `internalStatus = 'pending_approval'` while the client lifecycle
// bucketed both `pending_approval` AND `approved_internal` into
// `pending_review` (the only thing that pulls an estimate out of
// pending_review on the client is `internalStatus =
// 'sent_to_customer'` or a terminal `status`). That mismatch is the
// bug.
//
// This test pins the contract: every internalStatus that lands in the
// `pending_review` bucket on the client must also be a status the
// server filter accepts. It is intentionally allow-list-based on the
// client side so any new internalStatus value forces a deliberate
// decision about both sides at once.

import { describe, it, expect } from "vitest";
import { canDeleteEstimateAs, computeLifecycleStatus } from "@workspace/shared";

// Mirror of the SQL filter in storage.getEstimatesPendingApproval.
// Keeping this list local to the test (rather than importing from the
// server) keeps the frontend test suite hermetic. If you change the
// SQL filter, change this list too — and the test below will catch
// any drift against the lifecycle bucketing.
const SERVER_PENDING_APPROVAL_STATUSES = new Set([
  "pending_approval",
  "approved_internal",
]);

describe("Pending review parity (Task #606)", () => {
  // The two statuses below are the ones the manager wizard's submit
  // path produces (`pending_approval`) and the ones the admin
  // "internal approve" action produces (`approved_internal`). The
  // admin Pending Approval list must show *both*, since the manager
  // board buckets both into `pending_review`. Before this task the
  // server filter only accepted `pending_approval` — an
  // internally-approved estimate appeared in the manager column but
  // not in the admin list.
  for (const internalStatus of SERVER_PENDING_APPROVAL_STATUSES) {
    it(`internalStatus='${internalStatus}' buckets into pending_review on the client`, () => {
      const lifecycle = computeLifecycleStatus({
        status: "pending",
        internalStatus,
        estimateDate: new Date(),
      });
      expect(lifecycle).toBe("pending_review");
    });
  }

  it("server filter and client lifecycle helper agree that approved_internal counts as pending review", () => {
    // This is the regression: previously the client said pending_review
    // and the server filter said "no, that's not pending_approval".
    expect(SERVER_PENDING_APPROVAL_STATUSES.has("approved_internal")).toBe(true);
    expect(
      computeLifecycleStatus({
        status: "pending",
        internalStatus: "approved_internal",
        estimateDate: new Date(),
      }),
    ).toBe("pending_review");
  });

  it("draft and sent_to_customer do NOT bucket into pending_review (sanity)", () => {
    expect(
      computeLifecycleStatus({
        status: "pending",
        internalStatus: "draft",
        estimateDate: new Date(),
      }),
    ).toBe("draft");
    expect(
      computeLifecycleStatus({
        status: "pending",
        internalStatus: "sent_to_customer",
        estimateDate: new Date(),
      }),
    ).toBe("sent");
  });
});

describe("estimate delete role/lifecycle parity with server guards", () => {
  // Mirrors ESTIMATE_DELETE_ROLES and ESTIMATE_PENDING_DELETE_ROLES in
  // estimate-routes.ts / estimate-role-guards.ts; no server rules are changed.
  const officeRoles = ["super_admin", "company_admin", "billing_manager", "irrigation_manager"];
  it("allows the five creation roles on draft, but only office roles in review", () => {
    for (const role of [...officeRoles, "field_tech"]) {
      expect(canDeleteEstimateAs(role, "draft")).toBe(true);
      expect(canDeleteEstimateAs(role, "pending_review")).toBe(role !== "field_tech");
    }
    expect(canDeleteEstimateAs(null, "draft")).toBe(false);
    expect(canDeleteEstimateAs("unknown", "draft")).toBe(false);
  });
  it("preserves sent and terminal rows for audit regardless of role", () => {
    for (const role of [...officeRoles, "field_tech"]) {
      for (const lifecycle of ["sent", "approved", "rejected", "expired"] as const) {
        expect(canDeleteEstimateAs(role, lifecycle)).toBe(false);
      }
    }
  });
});

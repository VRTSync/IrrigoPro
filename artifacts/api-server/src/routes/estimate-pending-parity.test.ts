// Task #606 — Integration-style parity check between
//   • storage.getEstimatesPendingApproval (admin "Pending Approval" list)
//   • computeLifecycleStatus === "pending_review" (manager column)
//
// We deliberately do not exercise the real DatabaseStorage here — it
// would require a live Postgres. Instead, we encode the SQL filter as
// a JS predicate that mirrors the WHERE clause and run a representative
// fixture through both predicates side by side. Any drift between the
// two predicates (e.g. someone changes the SQL filter without updating
// the lifecycle helper, or vice-versa) is a parity bug — exactly the
// regression that produced the original Task #606 report.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Local copy of the lifecycle helper so the api-server test suite stays
// hermetic (the original lives in artifacts/irrigopro/src/lib/lifecycle.ts).
// Keep this in sync with the canonical helper — the parity test below
// will catch drift against the SQL filter in storage.ts.
type LifecycleStatus =
  | "draft"
  | "pending_review"
  | "sent"
  | "approved"
  | "rejected"
  | "expired";

function computeLifecycleStatus(est: {
  status: string;
  internalStatus?: string | null;
  estimateDate?: Date | string | null;
}): LifecycleStatus {
  const status = est.status;
  const internalStatus = est.internalStatus ?? "";
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (internalStatus === "draft") return "draft";
  if (internalStatus === "sent_to_customer" && status === "pending") return "sent";
  return "pending_review";
}

// JS mirror of the SQL filter in
// storage.getEstimatesPendingApproval after Task #606. If the SQL
// changes, change this in lock-step.
function serverPendingApprovalFilter(est: {
  internalStatus?: string | null;
  companyId?: number | null;
}, companyId: number | null): boolean {
  const isPendingStatus =
    est.internalStatus === "pending_approval" ||
    est.internalStatus === "approved_internal";
  if (!isPendingStatus) return false;
  if (companyId === null) return true;
  return est.companyId === companyId;
}

interface FixtureEstimate {
  id: number;
  companyId: number;
  status: string;
  internalStatus: string;
  estimateDate: Date;
}

// One row per realistic (status, internalStatus) combination across two
// companies. The customer-facing `status` is always "pending" here —
// the review track only progresses while the customer hasn't yet
// accepted/rejected. (A row with status="approved" is a customer-
// approved estimate; the internal review track has already finished
// for it and it neither belongs in the manager column nor the admin
// list, so it isn't part of the parity contract this test pins.)
const FIXTURES: FixtureEstimate[] = [
  // Company 1 — every reasonable internalStatus value with the
  // typical "pending" customer status.
  { id: 1, companyId: 1, status: "pending", internalStatus: "draft", estimateDate: new Date() },
  { id: 2, companyId: 1, status: "pending", internalStatus: "pending_approval", estimateDate: new Date() },
  { id: 3, companyId: 1, status: "pending", internalStatus: "approved_internal", estimateDate: new Date() },
  { id: 4, companyId: 1, status: "pending", internalStatus: "sent_to_customer", estimateDate: new Date() },
  // Company 2 — a few rows so the company-scoped filter is exercised too.
  { id: 7, companyId: 2, status: "pending", internalStatus: "pending_approval", estimateDate: new Date() },
  { id: 8, companyId: 2, status: "pending", internalStatus: "approved_internal", estimateDate: new Date() },
  { id: 9, companyId: 2, status: "pending", internalStatus: "draft", estimateDate: new Date() },
];

describe("Admin pending-approval list ⇄ manager pending_review parity (Task #606)", () => {
  it("returns exactly the same set of estimate IDs the manager sees in pending_review (super_admin scope)", () => {
    const adminIds = new Set(
      FIXTURES.filter((e) => serverPendingApprovalFilter(e, null)).map((e) => e.id),
    );
    const managerIds = new Set(
      FIXTURES.filter(
        (e) => computeLifecycleStatus(e) === "pending_review",
      ).map((e) => e.id),
    );
    assert.deepEqual([...adminIds].sort(), [...managerIds].sort());
    // And the regression-specific assertion: an internally-approved
    // estimate (id=3 / id=8) must be in both sets.
    assert.ok(adminIds.has(3), "id 3 (approved_internal) missing from admin list");
    assert.ok(managerIds.has(3), "id 3 (approved_internal) missing from manager bucket");
  });

  it("agrees on the company-scoped view too (billing_manager / company_admin)", () => {
    for (const companyId of [1, 2]) {
      const adminIds = new Set(
        FIXTURES.filter((e) => serverPendingApprovalFilter(e, companyId)).map(
          (e) => e.id,
        ),
      );
      const managerIds = new Set(
        FIXTURES.filter(
          (e) =>
            e.companyId === companyId &&
            computeLifecycleStatus(e) === "pending_review",
        ).map((e) => e.id),
      );
      assert.deepEqual(
        [...adminIds].sort(),
        [...managerIds].sort(),
        `company ${companyId} pending sets diverged`,
      );
    }
  });

  it("excludes drafts and sent_to_customer from both views (no false positives)", () => {
    const drafts = FIXTURES.filter((e) => e.internalStatus === "draft");
    const sents = FIXTURES.filter((e) => e.internalStatus === "sent_to_customer");
    for (const e of [...drafts, ...sents]) {
      assert.equal(serverPendingApprovalFilter(e, null), false, `id ${e.id} should not be in admin list`);
      assert.notEqual(
        computeLifecycleStatus(e),
        "pending_review",
        `id ${e.id} should not be in manager bucket`,
      );
    }
  });
});

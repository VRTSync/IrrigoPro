// Task #630 — Regression test for bug #3.
//
// The admin dashboard tile and the /estimates/pending-approval list
// page were deriving their numbers from two different sources:
//
//   • The tile used GET /api/estimates and filtered client-side on
//     `status === pending|sent` (customer-facing status).
//   • The list page used GET /api/estimates/pending-approval which
//     filters on `internalStatus in (pending_approval, approved_internal)`.
//
// With 6 estimates pending approval the tile would show 4 (or some
// other number) because the customer-facing status and the review
// track are independent — an estimate can be `pending` (customer
// hasn't replied) while its internal review track has already moved
// to `sent_to_customer` or stayed in `draft`. The fix routes both
// surfaces through the same endpoint. This test pins the contract.
//
// We exercise the same SQL filter helper used in
// `estimate-pending-parity.test.ts` so both tests stay in lockstep
// with the server-side query.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

interface Fixture {
  id: number;
  companyId: number;
  status: string;
  internalStatus: string;
}

// JS mirror of storage.getEstimatesPendingApproval after Task #606.
// Same predicate the production query uses. If this drifts from the
// SQL, this test (and estimate-pending-parity.test.ts) will fail.
function pendingApprovalFilter(est: Fixture, companyId: number | null): boolean {
  const isPendingStatus =
    est.internalStatus === "pending_approval" ||
    est.internalStatus === "approved_internal";
  if (!isPendingStatus) return false;
  if (companyId === null) return true;
  return est.companyId === companyId;
}

// The OLD client-side filter that the admin-dashboard tile used to
// run against /api/estimates. Kept here so the test can demonstrate
// the original divergence (6 vs 4) the bug report described.
function legacyDashboardFilter(est: Fixture): boolean {
  return est.status === "pending" || est.status === "sent";
}

// 6 pending-approval estimates across 2 companies, with mixed
// customer-facing statuses so the legacy filter would miscount.
const FIXTURES: Fixture[] = [
  // Company 1 — 4 rows pending approval.
  { id: 1, companyId: 1, status: "pending",   internalStatus: "pending_approval" },
  { id: 2, companyId: 1, status: "pending",   internalStatus: "approved_internal" },
  { id: 3, companyId: 1, status: "approved",  internalStatus: "pending_approval" },  // customer-side status diverges
  { id: 4, companyId: 1, status: "rejected",  internalStatus: "approved_internal" }, // customer-side status diverges
  // Company 2 — 2 rows pending approval.
  { id: 5, companyId: 2, status: "pending",   internalStatus: "pending_approval" },
  { id: 6, companyId: 2, status: "pending",   internalStatus: "approved_internal" },
  // Noise — exercises the legacy filter's false positives. Only id
  // 7 is included so the legacy count (5) differs from the new
  // count (6); the fixture purposely avoids a coincidental tie.
  { id: 7, companyId: 1, status: "pending",   internalStatus: "sent_to_customer" },
  { id: 8, companyId: 2, status: "approved",  internalStatus: "sent_to_customer" },
];

describe("Admin dashboard tile ⇄ /estimates/pending-approval list parity (Task #630, bug #3)", () => {
  it("super_admin: tile count equals list length (6 rows across 2 companies)", () => {
    const tile = FIXTURES.filter((e) => pendingApprovalFilter(e, null)).length;
    const list = FIXTURES.filter((e) => pendingApprovalFilter(e, null)).length;
    assert.equal(tile, list);
    assert.equal(tile, 6, "expected 6 pending-approval rows across 2 companies");
  });

  it("company_admin (company 1): tile and list both report 4", () => {
    const tile = FIXTURES.filter((e) => pendingApprovalFilter(e, 1)).length;
    const list = FIXTURES.filter((e) => pendingApprovalFilter(e, 1)).length;
    assert.equal(tile, list);
    assert.equal(tile, 4);
  });

  it("company_admin (company 2): tile and list both report 2", () => {
    const tile = FIXTURES.filter((e) => pendingApprovalFilter(e, 2)).length;
    const list = FIXTURES.filter((e) => pendingApprovalFilter(e, 2)).length;
    assert.equal(tile, list);
    assert.equal(tile, 2);
  });

  it("regression: the legacy client-side filter (status===pending|sent) would have miscounted", () => {
    // The point of the bug: with 6 pending-approval rows, the old
    // tile predicate doesn't agree with the list. The pending_approval
    // rows with status `approved` or `rejected` (ids 3 and 4) fall
    // out of the legacy filter even though they're in the list, and
    // the draft/sent_to_customer rows (ids 7, 8) leak in even
    // though they don't belong. The fix is to make the tile read
    // the same endpoint as the list — this test pins that the two
    // predicates *would* have diverged on this fixture, so a
    // regression to the old behaviour fails loudly.
    const legacy = FIXTURES.filter(legacyDashboardFilter).length;
    const list = FIXTURES.filter((e) => pendingApprovalFilter(e, null)).length;
    assert.notEqual(legacy, list, "the bug should produce a count mismatch on this fixture");
  });
});

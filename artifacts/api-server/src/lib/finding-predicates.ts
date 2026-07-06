/**
 * finding-predicates.ts
 *
 * Shared server-side predicates for wet-check finding triage and billing eligibility.
 *
 * The `isNeedsReview` logic here mirrors the frontend version in
 * `artifacts/irrigopro/src/lib/finding-save-payload.ts` but is
 * self-contained so the server never imports from the frontend tree.
 *
 * Exported functions:
 *   isNeedsReview(f)       — true when the finding belongs in the manager queue
 *   isUnroutedFinding(f)   — true when the finding is genuinely unrouted
 *                            (needs review AND not yet stamped to any destination)
 *   wcbIsEligible(wcb)     — true when a WetCheckBillingListItem is ready to bill
 */

// ── isNeedsReview ─────────────────────────────────────────────────────────────

const CUSTOM_REVIEW_ISSUE_TYPE = "custom_review";

type FindingForReview = {
  resolution?: string | null;
  techDisposition?: string | null;
  issueType?: string | null;
};

/**
 * A finding belongs to the manager review queue when it is unresolved AND:
 *   - it was explicitly flagged as custom_review, OR
 *   - the tech disposition is not "completed_in_field"
 *
 * This is the canonical server-side mirror of the frontend `isNeedsReview`
 * function. Both must stay in sync. Do not add new conditions to one without
 * updating the other.
 */
export function isNeedsReview(f: FindingForReview): boolean {
  if ((f.resolution ?? "pending") !== "pending") return false;
  if (f.issueType === CUSTOM_REVIEW_ISSUE_TYPE) return true;
  return f.techDisposition !== "completed_in_field";
}

// ── isUnroutedFinding ─────────────────────────────────────────────────────────

type FindingForUnrouted = FindingForReview & {
  convertedAt?: Date | string | null;
  billingSheetId?: number | null;
  estimateId?: number | null;
  workOrderId?: number | null;
  wetCheckBillingId?: number | null;
};

/**
 * A finding is genuinely unrouted when:
 *   1. isNeedsReview(f) is true (resolution is pending and needs manager action), AND
 *   2. convertedAt is null (not yet stamped by any billing path), AND
 *   3. All four routing FKs are null (not yet assigned to any destination):
 *      billingSheetId, estimateId, workOrderId, wetCheckBillingId
 *
 * Used in `GET /api/wet-checks/needs-review` to count the number of findings
 * that still require a manager routing decision. Matches the predicate used by
 * `CombinedReviewSurface.tsx` on the frontend so both surfaces agree.
 */
export function isUnroutedFinding(f: FindingForUnrouted): boolean {
  return (
    isNeedsReview(f) &&
    f.convertedAt == null &&
    f.billingSheetId == null &&
    f.estimateId == null &&
    f.workOrderId == null &&
    f.wetCheckBillingId == null
  );
}

// ── wcbIsEligible ─────────────────────────────────────────────────────────────

type WcbForEligibility = {
  status: string;
  invoiceId?: number | string | null;
  unroutedFindingsCount: number;
};

/**
 * A WetCheckBilling is eligible for invoice generation when:
 *   1. status === 'approved_passed_to_billing'   (manager approved the snapshot)
 *   2. invoiceId == null                          (not already on an invoice)
 *   3. unroutedFindingsCount === 0               (every finding on the parent wet check
 *                                                 is either triaged or auto-billed —
 *                                                 no outstanding manager decisions)
 *
 * Replaces the previous blunt converted-status gate, which
 * blocked partially_converted wet checks even when all findings were actually
 * triaged, and allowed billing before every finding was routed.
 */
export function wcbIsEligible(wcb: WcbForEligibility): boolean {
  return (
    wcb.status === "approved_passed_to_billing" &&
    wcb.invoiceId == null &&
    wcb.unroutedFindingsCount === 0
  );
}

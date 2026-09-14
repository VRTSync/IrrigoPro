// Estimate role guards extracted from routes.ts so the full role × screen
// coverage matrix (Task #632) can mount them against a tiny Express app
// without dragging in registerRoutes()'s startup side effects (top-level
// setInterval, QB token-health timers, data-fix IIFE).
//
// Keep these in lock-step with the inline role rules in routes.ts. The
// matrix test in `estimate-role-matrix.test.ts` mounts the *real* guards
// here, so any drift between the exported guards and the routes.ts call
// sites is a behavior change and will surface as a failing test.

import type { Request, RequestHandler } from "express";
import { checkEstimateBranchGate } from "../estimate-payload";

// ─── Role constants ───────────────────────────────────────────────────────────

// Roles that may perform internal approval / customer delivery on an
// estimate (approve, reject, internal-approve, send-approval-email,
// email, pending-approval list).
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_APPROVAL_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "billing_manager",
  "irrigation_manager",
]);

// Roles that may render or download the priced estimate PDF. Wider than
// the approval set because reading the document is not a mutation —
// managers operationally need to see it. field_tech is excluded so the
// pricing-stripped tech view can't be sidestepped via the PDF.
// Task #643 — the legacy `manager` alias was retired; only the
// canonical `irrigation_manager` role is accepted now.
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_PDF_READ_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "billing_manager",
  "irrigation_manager",
]);

// Roles that may submit a draft for review or resend an expired estimate
// via POST /api/estimates/:id/transition. These are operationally
// "manager-level" roles — the same ones that author estimates.
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_SUBMIT_FOR_REVIEW_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "irrigation_manager",
]);

// Task #658 — roles allowed to delete a `pending_review` estimate
// (internalStatus in {pending_approval, approved_internal}). Drafts
// remain deletable by every authenticated role (including field_tech
// for their own drafts); this set narrows down who can soft-delete a
// row that has already been submitted for review. Mirrors the office
// roles in `ESTIMATE_SUBMIT_FOR_REVIEW_ROLES` plus `billing_manager`
// so the same people who own the pending queue can clean it up.
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_PENDING_DELETE_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "irrigation_manager",
  "billing_manager",
]);

// Roles that may flip an internally-approved estimate to the customer
// via POST /api/estimates/:id/transition (send_to_customer). Same as
// the approval roles but spelled out explicitly so a future widening
// of one set doesn't silently widen the other.
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_SEND_TO_CUSTOMER_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "billing_manager",
  "irrigation_manager",
]);

// Roles that may revert an approved estimate back to `sent` via
// POST /api/estimates/:id/unapprove. Only the two admin tiers — the
// same roles that can approve a customer estimate — so that billing
// managers cannot accidentally undo a customer approval they didn't
// make.
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_UNAPPROVE_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
]);

// Roles that may revert a rejected estimate back to `sent` via
// POST /api/estimates/:id/unreject. Mirrors ESTIMATE_UNAPPROVE_ROLES —
// same admin tiers, same rationale.
// TODO(roles): migrate to a capability from lib/shared/src/roles.ts (hasCapability). Inventory: docs/roles-migration-inventory.md
export const ESTIMATE_UNREJECT_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
]);

// ─── Middlewares ──────────────────────────────────────────────────────────────

// Middleware gating estimate approval / customer-delivery routes.
// Only roles in ESTIMATE_APPROVAL_ROLES (billing_manager, company_admin,
// super_admin, irrigation_manager) can internally approve, reject, or
// send estimates to customers.
export const requireEstimateApprovalAccess: RequestHandler = (req, res, next) => {
  const userRole = (req as unknown as { authenticatedUserRole?: string }).authenticatedUserRole;
  if (!userRole || !ESTIMATE_APPROVAL_ROLES.has(userRole)) {
    res.status(403).json({
      message:
        "Access denied. Estimate approval and customer delivery are restricted to billing managers and administrators.",
    });
    return;
  }
  next();
};

// Read-only access guard for the estimate PDF endpoint. Rendering or
// downloading is not a mutation, so the role list is wider than
// requireEstimateApprovalAccess.
export const requireEstimatePdfAccess: RequestHandler = (req, res, next) => {
  const userRole = (req as unknown as { authenticatedUserRole?: string }).authenticatedUserRole;
  if (!userRole || !ESTIMATE_PDF_READ_ROLES.has(userRole)) {
    res.status(403).json({
      message:
        "Access denied. The estimate PDF is restricted to managers and administrators.",
    });
    return;
  }
  next();
};

// Task #2010 — branch gate on every authenticated door that sends an
// estimate to the customer or pushes it forward into a work order.
//
// Gating only the three write paths would leave the forcing function as
// "a branch-less estimate 400s on its next save" — but an estimate does
// not have to be saved to leave. A legacy branch-less row can be
// approved straight out of the queue by a manager who never opens the
// wizard, and the conversion then carries a null branch into the work
// order. This middleware closes that for every pre-existing row.
//
// It is async and needs storage (unlike the synchronous role guards it
// sits beside), hence the factory: storage is passed in so this module
// stays free of a storage import. The gate itself is NOT reimplemented
// here — it calls the single `checkEstimateBranchGate` helper the three
// write paths call, with the open-the-estimate message variant.
//
// Ordering is a security property: register this AFTER the approval
// access guard so an unauthorised caller gets 403, never a 400 that
// would reveal whether the estimate has a branch. A missing estimate
// falls through to `next()` so the handler's own 404 still stands.

// Minimal structural surface — deliberately narrower than
// `EstimateRoutesStorage` so this module keeps no dependency on it.
export interface EstimateBranchGateStorage {
  getEstimate(
    id: number,
    opts?: { includeDeleted?: boolean },
  ): Promise<
    | {
        companyId?: number | null;
        customerId?: number | null;
        branchName?: string | null;
      }
    | undefined
  >;
  getCustomer(id: number): Promise<{ branches?: unknown } | undefined>;
}

export function requireEstimateBranchForSend(
  storage: EstimateBranchGateStorage,
): RequestHandler {
  // `req` is left loosely typed on purpose — typing this as a
  // parameterised RequestHandler re-types req.params and breaks
  // unrelated routes that share the file.
  return async (req, res, next) => {
    try {
      const id = parseInt(String((req.params as Record<string, string>).id));
      if (!Number.isFinite(id) || id <= 0) {
        next();
        return;
      }
      const estimate = await storage.getEstimate(id);
      // Unknown estimate — let the handler answer with its own 404.
      if (!estimate) {
        next();
        return;
      }
      // Tenancy: an estimate belonging to another company must fall
      // through to the handler's own ownership check, which answers 404.
      // Answering 400 here would confirm the row exists and leak its
      // branch state across the tenant boundary. super_admin has a null
      // company scope and legitimately sees every row.
      const callerCompanyId = (
        req as unknown as { authenticatedUserCompanyId?: number | null }
      ).authenticatedUserCompanyId;
      if (
        callerCompanyId != null &&
        estimate.companyId != null &&
        estimate.companyId !== callerCompanyId
      ) {
        next();
        return;
      }
      if (estimate.customerId == null) {
        next();
        return;
      }
      const customer = await storage.getCustomer(Number(estimate.customerId));
      if (!customer) {
        next();
        return;
      }
      const message = checkEstimateBranchGate(
        customer.branches,
        estimate.branchName ?? null,
        "open_estimate",
      );
      if (message) {
        res.status(400).json({ message });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Per-action role rules for POST /api/estimates/:id/transition. The
// /transition endpoint dispatches three actions and each has a
// different role contract — encoded here so the matrix test can pin
// them without re-importing the giant routes.ts.
export type TransitionAction = "submit_for_review" | "send_to_customer" | "resend";

export function canPerformEstimateTransition(
  role: string | undefined | null,
  action: TransitionAction,
): boolean {
  if (!role) return false;
  switch (action) {
    case "submit_for_review":
    case "resend":
      return ESTIMATE_SUBMIT_FOR_REVIEW_ROLES.has(role);
    case "send_to_customer":
      return ESTIMATE_SEND_TO_CUSTOMER_ROLES.has(role);
  }
}

// Cross-company ownership guard for estimate approval routes. Returns
// 404 (not 403) when an estimate belongs to a different company so
// callers cannot probe for existence. super_admin bypasses the check.
// Pulled into this module so the matrix test can pin the contract too.
export function estimateOwnershipMatches(
  req: Request,
  estimateCompanyId: number | null | undefined,
): boolean {
  const r = req as unknown as {
    authenticatedUserRole?: string;
    authenticatedUserCompanyId?: number | null;
  };
  if (r.authenticatedUserRole === "super_admin") return true;
  const userCompanyId = r.authenticatedUserCompanyId;
  if (!userCompanyId || !estimateCompanyId) return false;
  return Number(userCompanyId) === Number(estimateCompanyId);
}

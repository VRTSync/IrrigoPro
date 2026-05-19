// All `/api/estimates*` HTTP route handlers (Task #640).
//
// Previously most of these routes lived in the 16k-line `routes.ts`
// monolith with a couple already extracted here for test-isolation
// (Task #397/#606). Task #640 consolidates the rest: every estimate
// CRUD, lifecycle transition, PDF, email, public-token, and
// convert-to-work-order endpoint is now defined in this one file.
// `routes.ts` only invokes `registerEstimateRoutes(app, storage,
// requireAuthentication)` once and contributes no estimate routes
// of its own.
//
// Behavior is identical to the pre-extraction inline handlers —
// same paths, payloads, status codes, role guards, and audit-log
// emissions. The helpers that used to be closures inside
// `registerRoutes()` (estimate approval/PDF access middlewares,
// the cross-company ownership guard, the send-approval-email flow,
// and the PDF handler) now live next to the routes that use them.
//
// `storage` is typed as `EstimateRoutesStorage` so the test suite
// can inject an in-memory stub. Methods only used by routes that
// are not exercised in unit tests are marked optional so the stub
// in estimate-routes.test.ts continues to satisfy the interface
// without change. In production the real `DatabaseStorage` provides
// every method.

import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { formatEstimateNumber } from "../estimate-number";
import { z } from "zod/v4";
import {
  estimates,
  insertEstimateSchema,
  type Company,
  type Customer,
  type Estimate,
  type EstimateSummary,
  type EstimateWithItems,
  type InsertEstimate,
  type InsertEstimateItem,
  type InsertNotification,
  type Notification,
  type User,
  type WorkOrder,
} from "@workspace/db";

import { db } from "../db";
import {
  processEstimatePayload,
  resolveCreateLaborRate,
  resolvePutLaborRate,
  type EstimatePayloadInput,
} from "../estimate-payload";
import {
  recordAuditEvent as defaultRecordAuditEvent,
  type AuditEventInput,
  type LifecycleAuditOpts,
} from "./audit-log";
import { paginate } from "./pagination";
import { ESTIMATE_PENDING_DELETE_ROLES } from "./estimate-role-guards";
import { deriveLifecycleForWrite } from "../lifecycle";

// Storage surface used by every estimate route. Methods used only by
// routes that aren't exercised in the existing test suite are marked
// optional so `makeStorageStub()` in estimate-routes.test.ts (which
// stubs just the bare minimum for the create/update/submit flow)
// continues to satisfy the interface without modification. The real
// `DatabaseStorage` implements every method.
export interface EstimateRoutesStorage {
  getCustomer(id: number): Promise<Customer | undefined>;
  getEstimate(
    id: number,
    opts?: { includeDeleted?: boolean },
  ): Promise<EstimateWithItems | undefined>;
  // Optional — when present, POST /api/estimates uses the authenticated
  // user's `name` to stamp `createdBy` so the review queue and audit log
  // show who actually drafted the estimate. Tests can omit this.
  getUser?(id: number): Promise<User | undefined>;
  createEstimateFromPayload(payload: EstimatePayloadInput): Promise<EstimateWithItems>;
  updateEstimateWithItems(
    id: number,
    estimate: InsertEstimate,
    items: InsertEstimateItem[],
  ): Promise<EstimateWithItems>;

  // Optional — required only by the production routes (list, delete,
  // approve, reject, send-approval-email, transition, token approve/
  // reject, convert-to-work-order, PDF). The existing test suite does
  // not exercise these routes and so does not stub them.
  getEstimates?(opts?: { includeDeleted?: boolean }): Promise<Estimate[]>;
  getEstimatesPendingApproval?(companyId: number | null): Promise<Estimate[]>;
  getEstimateSummary?(companyId: number | null): Promise<EstimateSummary>;
  softDeleteEstimate?(id: number, userId: number): Promise<boolean>;
  updateEstimate?(
    id: number,
    updates: Partial<InsertEstimate> & { updatedAt?: Date },
  ): Promise<Estimate | EstimateWithItems | undefined>;
  approveEstimateAndCreateWorkOrder?(id: number): Promise<{
    estimate: Estimate | EstimateWithItems;
    workOrder?: WorkOrder | null;
  }>;
  internallyApproveEstimateIfPending?(
    id: number,
  ): Promise<Estimate | EstimateWithItems | undefined | null>;
  rejectEstimateIfPending?(
    id: number,
  ): Promise<Estimate | EstimateWithItems | undefined | null>;
  markEstimateSentToCustomer?(
    id: number,
    opts: {
      approvalToken: string;
      tokenExpiresAt: Date;
      approvalSentAt: Date;
      newEstimateDate: Date | null;
      isResend: boolean;
    },
  ): Promise<Estimate | EstimateWithItems | undefined | null>;
  createWorkOrderFromEstimate?(id: number): Promise<WorkOrder>;
  getIrrigationManagerForCompany?(
    companyId: number,
  ): Promise<User | undefined | null>;
  assignWorkOrder?(
    workOrderId: number,
    userId: number,
    userName: string,
  ): Promise<WorkOrder | undefined | null | boolean>;
  createNotification?(payload: InsertNotification): Promise<Notification>;
  getUsers?(): Promise<User[]>;
  updateWorkOrder?(
    id: number,
    updates: Partial<WorkOrder>,
  ): Promise<WorkOrder | undefined | null>;
  getCompanyProfile?(companyId: number): Promise<Company | undefined | null>;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const createEstimateWithItemsSchema = z.object({
  estimate: insertEstimateSchema.extend({
    // Task #669 — optional override of the estimate number on edit.
    // company_admin / super_admin can rename an estimate; uniqueness
    // is enforced per-company in `handleEstimateUpdate`. Ignored on
    // create — the per-company counter always wins there.
    estimateNumber: z
      .string()
      .trim()
      .regex(/^\d{5,}$/, "Estimate number must be at least 5 digits")
      .optional(),
    estimateDate: z.union([z.date(), z.string()]).optional(),
    partsSubtotal: z.union([z.string(), z.number()]).optional(),
    laborSubtotal: z.union([z.string(), z.number()]).optional(),
    totalAmount: z.union([z.string(), z.number()]).optional(),
    laborRate: z.union([z.string(), z.number()]),
    // Task #396 — labor entry mode + flat-mode aggregate hours.
    laborMode: z.enum(["flat", "per_part"]).optional(),
    totalLaborHours: z.union([z.string(), z.number()]).optional(),
    workLocationLat: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
    workLocationLng: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
    workLocationAddress: z.string().nullish(),
    controllerLetter: z
      .string()
      .nullish()
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => v === null || (v.length === 1 && v >= "A" && v <= "Z"), {
        message: "controllerLetter must be A-Z",
      }),
    zoneNumber: z.coerce.number().int().min(1).max(100).nullish(),
  }),
  items: z
    .array(
      z.object({
        description: z.string().optional().default(""),
        partId: z.number(),
        partName: z.string(),
        partPrice: z.union([z.string(), z.number()]),
        quantity: z.number(),
        laborHours: z.union([z.string(), z.number()]).optional(),
        totalPrice: z.union([z.string(), z.number()]).optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .min(1, "An estimate must have at least one line item"),
});

// ─── Helpers (estimate-specific) ─────────────────────────────────────────────

// Middleware gating estimate approval / customer-delivery routes.
// Slice 7 — only billing roles (billing_manager, company_admin, super_admin)
// can internally approve, reject, or send estimates to customers.
export const requireEstimateApprovalAccess: RequestHandler = (req, res, next) => {
  const userRole = req.authenticatedUserRole;
  if (
    userRole !== "company_admin" &&
    userRole !== "billing_manager" &&
    userRole !== "super_admin"
  ) {
    res.status(403).json({
      message:
        "Access denied. Estimate approval and customer delivery are restricted to billing managers and administrators.",
    });
    return;
  }
  next();
};

// Task #630 — read-only access guard for the estimate PDF endpoint.
// Rendering or downloading the PDF is not a mutation (approve / reject /
// send-to-customer), so the role list is wider than
// requireEstimateApprovalAccess: managers (both `manager` and the
// legacy `irrigation_manager` alias) are operationally responsible for
// estimate review and need to see the document. field_tech is the only
// role explicitly excluded — techs see a pricing-stripped view in the
// app and should not be able to pull the full priced PDF.
// Task #643 — the legacy `manager` alias was retired; only the
// canonical `irrigation_manager` role is accepted now.
const ESTIMATE_PDF_READ_ROLES = new Set<string>([
  "super_admin",
  "company_admin",
  "billing_manager",
  "irrigation_manager",
]);
export const requireEstimatePdfAccess: RequestHandler = (req, res, next) => {
  const userRole = req.authenticatedUserRole;
  if (!userRole || !ESTIMATE_PDF_READ_ROLES.has(userRole)) {
    res.status(403).json({
      message:
        "Access denied. The estimate PDF is restricted to managers and administrators.",
    });
    return;
  }
  next();
};

// Cross-company ownership guard for estimate approval routes. Returns
// 404 (not 403) when an estimate belongs to a different company so callers
// cannot probe for existence. super_admin bypasses the check.
export function estimateOwnershipMatches(
  req: Request,
  estimateCompanyId: number | null | undefined,
): boolean {
  const userRole = req.authenticatedUserRole;
  if (userRole === "super_admin") return true;
  const userCompanyId = req.authenticatedUserCompanyId;
  if (!userCompanyId || !estimateCompanyId) return false;
  return Number(userCompanyId) === Number(estimateCompanyId);
}

// Task #611 — typed error thrown by `_sendEstimateApprovalEmailFlow`
// when the CAS-style "mark sent to customer" update matches zero
// rows (i.e. someone else won a concurrent send-to-customer race
// or the estimate moved out of a sendable state between the
// route's precheck and the DB write). The route layer catches it
// and returns 409 instead of the generic 500.
export class EstimateSendConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EstimateSendConflictError";
  }
}

// ─── Route registration ──────────────────────────────────────────────────────

export type EstimateRouteDeps = {
  // Task #643 — pricing-strip helper. Wraps GET responses so the
  // field_tech role never sees prices. Defaults to identity for
  // tests that don't supply it.
  applyPricingVisibility?: <T>(req: Request, data: T) => T;
  // Task #641 — lifecycle audit emitter. Records before/after audit
  // rows for every estimate state transition (submit-for-review,
  // internal-approve, approve, reject, resend, convert-to-WO, and
  // the customer-token approve/reject paths). Defaults to a no-op
  // for tests.
  recordLifecycleAudit?: (req: any, opts: LifecycleAuditOpts) => Promise<void>;
  // Task #658 — non-lifecycle audit emitter (estimate.deleted, etc.).
  // Defaults to the real `recordAuditEvent` from `./audit-log`. Tests
  // inject a spy to assert on `details.lifecycle` without a DB round-trip.
  recordAuditEvent?: (
    req: Request | null,
    evt: AuditEventInput,
  ) => Promise<void>;
};

export function registerEstimateRoutes(
  app: Express,
  storage: EstimateRoutesStorage,
  requireAuthentication: RequestHandler,
  deps: EstimateRouteDeps = {},
): void {
  const applyPricingVisibility =
    deps.applyPricingVisibility ?? (<T,>(_req: Request, data: T) => data);
  const recordLifecycleAudit =
    deps.recordLifecycleAudit ?? (async () => {});
  const recordAuditEvent = deps.recordAuditEvent ?? defaultRecordAuditEvent;
  // processEstimatePayload is shared with the Wet Check conversion engine
  // (server/storage.ts → convertWetCheck) so both code paths compute prices
  // and totals identically. See server/estimate-payload.ts for details.

  // ── GET /api/estimates ────────────────────────────────────────────────
  app.get("/api/estimates", requireAuthentication, async (req: any, res) => {
    try {
      // Task #634 — super_admin can opt-in to see soft-deleted rows via
      // ?includeDeleted=1. All other roles always get the active list.
      // `requireAuthentication` populates `authenticatedUserRole` from
      // the header-auth context; without it the super_admin check would
      // silently evaluate false and the toggle would be a no-op.
      const role =
        (req.authenticatedUserRole as string | undefined) ??
        (typeof req.headers?.["x-user-role"] === "string"
          ? (req.headers["x-user-role"] as string)
          : undefined);
      const includeDeleted =
        role === "super_admin" && String(req.query?.includeDeleted ?? "") === "1";
      const list = await storage.getEstimates!({ includeDeleted });
      // Task #532 — opt-in pagination; full list returned when ?limit and
      // ?offset are both omitted to preserve existing client behavior.
      // Task #643 — pricing fields stripped for field_tech via
      // applyPricingVisibility (defense-in-depth — techs typically don't
      // hit this endpoint, but if they do, prices must not leak).
      res.json(
        applyPricingVisibility(req, paginate(req, res, list, { limit: 100, max: 500 })),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch estimates" });
    }
  });

  // ── GET /api/estimates/pending-approval ───────────────────────────────
  // IMPORTANT: register before "/api/estimates/:id" so Express does not
  // route "pending-approval" through the :id handler.
  app.get(
    "/api/estimates/pending-approval",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const userRole = req.authenticatedUserRole;
        const userCompanyId = req.authenticatedUserCompanyId;
        // super_admin can see across companies; everyone else is scoped to
        // their own company. Refuse if a non-super_admin somehow lacks one.
        let scopeCompanyId: number | null;
        if (userRole === "super_admin") {
          scopeCompanyId = null;
        } else {
          if (!userCompanyId) {
            res.status(400).json({ message: "Missing company context" });
            return;
          }
          scopeCompanyId = Number(userCompanyId);
        }
        const pending = await storage.getEstimatesPendingApproval!(scopeCompanyId);
        // Task #643 — defense-in-depth strip for field_tech.
        res.json(applyPricingVisibility(req, pending));
      } catch (error) {
        console.error("Error fetching pending estimates:", error);
        res.status(500).json({ message: "Failed to fetch pending estimates" });
      }
    },
  );

  // ── GET /api/estimates/summary ────────────────────────────────────────
  // Task #683 — aggregate summary for the Estimate Command Center.
  // IMPORTANT: register before "/api/estimates/:id" so Express does not
  // route "summary" through the :id handler.
  app.get(
    "/api/estimates/summary",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const userRole = req.authenticatedUserRole;
        const userCompanyId = req.authenticatedUserCompanyId;
        let scopeCompanyId: number | null;
        if (userRole === "super_admin") {
          scopeCompanyId = null;
        } else {
          if (!userCompanyId) {
            res.status(400).json({ message: "Missing company context" });
            return;
          }
          scopeCompanyId = Number(userCompanyId);
        }
        if (!storage.getEstimateSummary) {
          res.status(500).json({ message: "Summary not available" });
          return;
        }
        const summary = await storage.getEstimateSummary(scopeCompanyId);
        res.json(summary);
      } catch (error) {
        console.error("Error computing estimate summary:", error);
        res.status(500).json({ message: "Failed to compute estimate summary" });
      }
    },
  );

  // ── GET /api/estimates/:id ────────────────────────────────────────────
  app.get("/api/estimates/:id", async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      // Task #643 — strip pricing fields for field_tech.
      res.json(applyPricingVisibility(req, estimate));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch estimate" });
    }
  });

  // ── POST /api/estimates ───────────────────────────────────────────────
  app.post("/api/estimates", requireAuthentication, async (req: any, res) => {
    try {
      const parsed = createEstimateWithItemsSchema.parse(req.body);
      // Defence-in-depth: only `draft` and `pending_approval` may be set on
      // create. Anything else (including the customer-facing `sent_to_customer`)
      // is coerced to the manager review queue so a malicious or buggy client
      // cannot bypass review. Slice 10a allows `draft` so wizard "Save as draft"
      // can land here without an extra transition call.
      {
        const estimateBody = parsed.estimate as { internalStatus?: string };
        const requested = estimateBody.internalStatus;
        estimateBody.internalStatus = requested === "draft" ? "draft" : "pending_approval";
      }
      // Stamp company + creator from the authenticated user. The wizard
      // payload doesn't carry these, and trusting client-supplied values
      // would let one company's user create estimates against another's
      // queue. Without this stamp, `companyId` lands as NULL and the
      // billing-manager review queue (filtered `WHERE company_id = ?`)
      // silently excludes the row — which is the reported bug where
      // submitted estimates never reach the reviewer.
      {
        const estimateBody = parsed.estimate as {
          companyId?: number | null;
          createdBy?: string;
          createdByUserId?: number | null;
        };
        const authUserId: number | null =
          typeof req.authenticatedUserId === "number" ? req.authenticatedUserId : null;
        const authCompanyId: number | null =
          typeof req.authenticatedUserCompanyId === "number"
            ? req.authenticatedUserCompanyId
            : null;
        if (authCompanyId != null) {
          estimateBody.companyId = authCompanyId;
        }
        if (authUserId != null) {
          estimateBody.createdByUserId = authUserId;
          if (storage.getUser) {
            try {
              const user = await storage.getUser(authUserId);
              if (user?.name) estimateBody.createdBy = user.name;
            } catch {
              // Non-fatal — fall back to whatever the client/default supplies.
            }
          }
        }
      }
      // Authoritative labor rate: the customer record is the master.
      // Override whatever the client sent on create so a tampered/stale
      // payload can never bypass the customer's master rate. Falls back
      // to the schema default (45.00) only if the customer truly has no
      // rate on file.
      const customerId = (parsed.estimate as { customerId?: number | null }).customerId ?? null;
      if (customerId != null) {
        const customer = await storage.getCustomer(customerId);
        if (!customer) {
          res.status(400).json({ message: `Customer ${customerId} not found` });
          return;
        }
        const masterRate = resolveCreateLaborRate(customer.laborRate);
        (parsed.estimate as { laborRate: string }).laborRate = masterRate;
        (parsed.estimate as { appliedLaborRate?: string | null }).appliedLaborRate = masterRate;
      }
      // Single sanctioned entry point — same service the wet-check
      // conversion engine calls — so the two flows can never drift in
      // pricing semantics or downstream side effects.
      const newEstimate = await storage.createEstimateFromPayload(parsed);
      res.status(201).json(newEstimate);
    } catch (error) {
      console.error("Estimate creation error:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Invalid estimate data",
          errors: error.issues,
        });
        return;
      }
      res.status(500).json({ message: "Failed to create estimate" });
    }
  });

  // Shared update path used by both PUT /api/estimates/:id and the
  // atomic submit-for-review endpoint below. Returns the updated
  // estimate (with items) or sends an error response and returns null.
  // `opts.submitForReview === true` forces internalStatus to
  // `pending_approval` inside the same transaction so the wizard's
  // submit either fully lands or fully rolls back (Task #606). Callers
  // must NOT have already sent a response when this returns null —
  // this helper owns the response on the error path.
  async function handleEstimateUpdate(
    req: any,
    res: any,
    opts: { submitForReview: boolean },
  ): Promise<EstimateWithItems | null> {
    try {
      const estimateId = parseInt(String(req.params.id));
      if (isNaN(estimateId)) {
        res.status(400).json({ message: "Invalid estimate ID" });
        return null;
      }
      const parsed = createEstimateWithItemsSchema.parse(req.body);
      // Strip ownership/audit fields from the update payload — these are
      // stamped at create time from the authenticated user and must never
      // be reassignable by the client. Without this, an edit could orphan
      // an estimate (companyId → null) or rewrite the audit trail.
      {
        const estimateBody = parsed.estimate as {
          companyId?: number | null;
          createdBy?: string;
          createdByUserId?: number | null;
        };
        delete estimateBody.companyId;
        delete estimateBody.createdBy;
        delete estimateBody.createdByUserId;
      }
      // Authoritative labor rate on update: the customer record is the
      // master, but we only override the stored rate when the customer
      // actually changed. Editing an estimate without swapping the
      // customer preserves the rate that was stamped at creation so
      // historical totals do not silently shift.
      const existing = await storage.getEstimate(estimateId);
      if (!existing) {
        res.status(404).json({ message: "Estimate not found" });
        return null;
      }
      // Submit-for-review only makes sense for a draft. Bouncing any
      // other internal status with a 409 keeps the manager/admin lists
      // honest: we never re-flip an already-reviewed estimate back to
      // pending_approval from the wizard. The wizard's regular PUT path
      // (opts.submitForReview === false) is unaffected.
      if (opts.submitForReview && existing.internalStatus !== "draft") {
        res.status(409).json({
          message: "Estimate is not a draft",
          internalStatus: existing.internalStatus,
        });
        return null;
      }
      const newCustomerId = (parsed.estimate as { customerId?: number | null }).customerId ?? null;
      const customerChanged = newCustomerId != null && newCustomerId !== existing.customerId;
      let resolvedRate: string;
      if (customerChanged) {
        const customer = await storage.getCustomer(newCustomerId!);
        if (!customer) {
          res.status(400).json({ message: `Customer ${newCustomerId} not found` });
          return null;
        }
        resolvedRate = resolvePutLaborRate({
          customerChanged: true,
          newCustomerLaborRate: customer.laborRate,
          existingAppliedLaborRate: existing.appliedLaborRate,
          existingLaborRate: existing.laborRate,
        });
      } else {
        // Customer unchanged — preserve the originally stamped rate
        // regardless of what the client sent so a stale/tampered payload
        // cannot reprice the estimate behind the user's back. Use the
        // snapshot (appliedLaborRate ?? laborRate) consistently for both
        // fields so legacy records where the two diverged stay in sync
        // with the read-time totals computed by storage.getEstimate.
        resolvedRate = resolvePutLaborRate({
          customerChanged: false,
          existingAppliedLaborRate: existing.appliedLaborRate,
          existingLaborRate: existing.laborRate,
        });
      }
      (parsed.estimate as { laborRate: string }).laborRate = resolvedRate;
      (parsed.estimate as { appliedLaborRate?: string | null }).appliedLaborRate = resolvedRate;
      // Task #657 — Labor entry is flat-only for new/edited estimates;
      // `processEstimatePayload` forces `laborMode='flat'` regardless of
      // the incoming value, so the legacy preserve-persisted-mode branch
      // that lived here is gone. Existing per_part rows are migrated to
      // flat by the backfill-estimate-labor-mode.ts script.
      // Task #606 — submit-for-review pins internalStatus inside the
      // same payload that drives updateEstimateWithItems, so the
      // content write and the status transition share a single
      // transaction. If updateEstimateWithItems throws, neither lands.
      if (opts.submitForReview) {
        (parsed.estimate as { internalStatus?: string }).internalStatus = "pending_approval";
      }
      // Task #669 — handle optional estimate-number rename. Only
      // company_admin / super_admin can rename; for every other role
      // (including billing_manager) we silently drop the field so the
      // payload doesn't accidentally rewrite the persisted number on
      // a normal edit. When the field is present and valid, we
      // uniqueness-check it within the estimate's company and emit an
      // `estimate.number_changed` audit row on the actual change.
      const role = (req.authenticatedUserRole as string | undefined) ?? null;
      const canRenameNumber = role === "super_admin" || role === "company_admin";
      const requestedNumberRaw = (parsed.estimate as { estimateNumber?: string }).estimateNumber;
      const requestedNumber = canRenameNumber && requestedNumberRaw
        ? String(requestedNumberRaw).trim()
        : undefined;
      if (requestedNumber !== undefined && requestedNumber !== existing.estimateNumber) {
        const ownerCompanyId = existing.companyId ?? null;
        if (ownerCompanyId != null) {
          const collision = await db
            .select({ id: estimates.id })
            .from(estimates)
            .where(
              and(
                eq(estimates.companyId, ownerCompanyId),
                eq(estimates.estimateNumber, requestedNumber),
              ),
            )
            .limit(1);
          if (collision.length > 0 && collision[0].id !== estimateId) {
            res.status(409).json({
              message: "Estimate number already in use for this company",
              field: "estimateNumber",
            });
            return null;
          }
        }
        (parsed.estimate as { estimateNumber?: string }).estimateNumber = requestedNumber;
      } else {
        // Always strip — either the role can't rename or the value is
        // unchanged. updateEstimateWithItems must not see a stale
        // estimateNumber in the payload.
        delete (parsed.estimate as { estimateNumber?: string }).estimateNumber;
      }
      const { estimate, items } = processEstimatePayload(parsed);
      // processEstimatePayload spreads `input.estimate` so it carries
      // the (validated) renamed number through into the InsertEstimate.
      if (requestedNumber !== undefined && requestedNumber !== existing.estimateNumber) {
        (estimate as { estimateNumber?: string }).estimateNumber = requestedNumber;
      }
      const updatedEstimate = await storage.updateEstimateWithItems(estimateId, estimate, items);
      if (
        requestedNumber !== undefined &&
        requestedNumber !== existing.estimateNumber
      ) {
        try {
          await recordAuditEvent(req as any, {
            actorUserId:
              typeof (req as any).authenticatedUserId === "number"
                ? (req as any).authenticatedUserId
                : null,
            actorRole: role,
            actorCompanyId:
              typeof (req as any).authenticatedUserCompanyId === "number"
                ? (req as any).authenticatedUserCompanyId
                : null,
            actionType: "estimate",
            action: "estimate.number_changed",
            targetType: "estimate",
            targetId: String(estimateId),
            summary: `Estimate number changed from ${formatEstimateNumber(existing.estimateNumber)} to ${formatEstimateNumber(requestedNumber)}`,
            details: {
              from: existing.estimateNumber,
              to: requestedNumber,
            },
          });
        } catch {
          // best-effort audit; route already succeeded
        }
      }
      return updatedEstimate;
    } catch (error) {
      console.error("Estimate update error:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Invalid estimate data",
          errors: error.issues,
        });
        return null;
      }
      res.status(500).json({ message: "Failed to update estimate" });
      return null;
    }
  }

  // ── PUT /api/estimates/:id ────────────────────────────────────────────
  app.put("/api/estimates/:id", requireAuthentication, async (req, res) => {
    const updated = await handleEstimateUpdate(req, res, { submitForReview: false });
    if (updated) res.json(updated);
  });

  // ── POST /api/estimates/:id/submit-for-review ─────────────────────────
  // Atomic submit-for-review (Task #606). Replaces the wizard's old
  // two-step PUT-then-/transition flow which could leave a draft with
  // saved content but the wrong status if the second call failed. The
  // payload shape is identical to PUT; this handler additionally pins
  // internalStatus to `pending_approval` inside the same DB
  // transaction. Only drafts may be submitted — other statuses return
  // 409 so the wizard surfaces a retryable error instead of silently
  // double-flipping.
  app.post("/api/estimates/:id/submit-for-review", requireAuthentication, async (req, res) => {
    const estimateId = parseInt(String(req.params.id));
    let before: { status?: string | null; internalStatus?: string | null } | null = null;
    if (!Number.isNaN(estimateId)) {
      try {
        const existing = await storage.getEstimate(estimateId);
        if (existing) {
          before = {
            status: (existing as any).status ?? null,
            internalStatus: (existing as any).internalStatus ?? null,
          };
        }
      } catch {
        // best-effort snapshot; never block the request
      }
    }
    const updated = await handleEstimateUpdate(req, res, { submitForReview: true });
    if (updated) {
      try {
        await recordLifecycleAudit(req, {
          resource: "estimate",
          action: "estimate.submitted_for_review",
          targetId: estimateId,
          before,
          after: {
            status: (updated as any).status ?? null,
            internalStatus: (updated as any).internalStatus ?? null,
          },
          summary: `Estimate ${estimateId} submitted for review`,
        });
      } catch {
        // never let an audit failure mask the success
      }
      res.json(updated);
    }
  });

  // ── DELETE /api/estimates/:id ─────────────────────────────────────────
  // Task #634 — manager-facing soft delete for draft estimates. Restricted to
  // roles that can already manage estimates (managers + admins). Only rows
  // whose `internalStatus` is still `draft` can be deleted; once submitted
  // for review or sent to the customer the delete is rejected with 409 so
  // approval / send / approve workflows retain their audit trail. Hides
  // cross-company access as 404 (consistent with other estimate routes).
  // Writes an `estimate.deleted` row to `audit_log`.
  app.delete("/api/estimates/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid estimate ID" });
        return;
      }
      const role = req.authenticatedUserRole as string | undefined;
      // Task #634 — "anyone who can create an estimate can delete their
      // own draft". `POST /api/estimates` is gated only by
      // `requireAuthentication` (no role allowlist), so we mirror that
      // here and let `estimateOwnershipMatches` + the draft check below
      // do the real fencing. Field techs are included so a tech who
      // started a draft on a tablet can throw it away themselves.
      // Task #643 — `manager` alias retired; only the canonical
      // `irrigation_manager` role is accepted.
      const ESTIMATE_DELETE_ROLES = new Set<string>([
        "super_admin",
        "company_admin",
        "irrigation_manager",
        "billing_manager",
        "field_tech",
      ]);
      if (!role || !ESTIMATE_DELETE_ROLES.has(role)) {
        res.status(403).json({
          message:
            "Access denied. Deleting estimates is restricted to managers and administrators.",
        });
        return;
      }

      const existing = await storage.getEstimate(id);
      if (!existing) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      if (!estimateOwnershipMatches(req, existing.companyId)) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }

      // Task #658 — soft-delete is allowed for both `draft` and the two
      // `pending_review` internal statuses (`pending_approval` /
      // `approved_internal`). Anything past that (sent / approved /
      // rejected / expired) has customer-facing artifacts and must
      // stay auditable, so we still 409 those.
      const existingLifecycle = deriveLifecycleForWrite({
        status: existing.status ?? null,
        internalStatus: existing.internalStatus ?? null,
      });
      if (existingLifecycle !== "draft" && existingLifecycle !== "pending_review") {
        // Preserve the legacy 409 contract for terminal states
        // (sent / approved / rejected / expired): the row stays
        // intact because customer-facing artifacts depend on it.
        res.status(409).json({
          message:
            "Only draft estimates can be deleted. Submitted or sent estimates are preserved for audit.",
        });
        return;
      }
      // Field techs may still delete their own drafts (this mirrors
      // Task #634), but only the office roles can clear a row that's
      // already been submitted for review.
      if (
        existingLifecycle === "pending_review" &&
        !ESTIMATE_PENDING_DELETE_ROLES.has(role)
      ) {
        res.status(403).json({
          message:
            "Access denied. Deleting a submitted estimate is restricted to managers and administrators.",
        });
        return;
      }

      const userId = (req.authenticatedUserId as number | undefined) ?? 0;
      const success = await storage.softDeleteEstimate!(id, userId);
      if (!success) {
        // Lost the race to a concurrent submit/send/delete.
        res.status(409).json({ message: "Estimate is no longer a deletable draft" });
        return;
      }

      try {
        await recordAuditEvent(req, {
          actorUserId: userId || null,
          actorRole: role ?? null,
          actorCompanyId: req.authenticatedUserCompanyId ?? null,
          actionType: "data",
          action: "estimate.deleted",
          severity: "info",
          targetType: "estimate",
          targetId: String(id),
          summary: `Estimate ${existing.estimateNumber ? formatEstimateNumber(existing.estimateNumber) : id} deleted`,
          details: {
            estimateId: id,
            estimateNumber: existing.estimateNumber ?? null,
            customerId: existing.customerId ?? null,
            companyId: existing.companyId ?? null,
            internalStatus: existing.internalStatus ?? null,
            // Task #658 — include the lifecycle bucket too so the App
            // Health audit tab can show "deleted from pending" vs
            // "deleted from draft" without re-deriving from the two
            // legacy axes.
            lifecycle: existingLifecycle,
          },
        });
      } catch (auditErr) {
        // Audit-log failure must not break the delete; it's already
        // best-effort in writeAuditEvent itself.
        try {
          req?.log?.warn({ err: auditErr }, "estimate.deleted audit failed");
        } catch {}
      }

      // Task #634 — return the updated row (with deletedAt/deletedBy
      // populated) so the client can show the audit metadata in the
      // super-admin "Show deleted" view without a separate refetch.
      const updated = await storage.getEstimate(id, { includeDeleted: true });
      res.json(updated ?? { id, deletedAt: new Date().toISOString(), deletedBy: userId });
    } catch (error) {
      console.error(
        "Error deleting estimate:",
        error instanceof Error ? error.message : error,
      );
      res.status(500).json({ message: "Failed to delete estimate" });
    }
  });

  // ── POST /api/estimates/:id/email ─────────────────────────────────────
  // Task #616 — Email estimate (with optional recipient overrides + note).
  // Previously a stub that returned success without sending. Now funnels
  // through the same `_sendEstimateApprovalEmailFlow` helper as
  // `/send-approval-email` and `/transition` so token generation,
  // status transitions, and SendGrid delivery all live in one place.
  app.post(
    "/api/estimates/:id/email",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const estimate = await storage.getEstimate(id);
        if (!estimate) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, estimate.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }

        // Lifecycle guardrails — mirror /send-approval-email so this
        // endpoint can't be used to bypass send-state rules just
        // because it accepts custom recipients.
        if (estimate.status !== "pending") {
          res
            .status(400)
            .json({ message: "Only pending estimates can have approval emails sent" });
          return;
        }
        if (estimate.internalStatus === "sent_to_customer") {
          res
            .status(400)
            .json({ message: "Estimate has already been sent to the customer" });
          return;
        }
        if (
          estimate.internalStatus !== "pending_approval" &&
          estimate.internalStatus !== "approved_internal"
        ) {
          res
            .status(400)
            .json({ message: "Estimate is not in a sendable internal state" });
          return;
        }

        const emailStr = z.string().trim().email("Invalid email address");
        const sendSchema = z
          .object({
            to: emailStr.optional(),
            cc: z.array(emailStr).max(5, "At most 5 Cc addresses").optional(),
            bcc: z.array(emailStr).max(5, "At most 5 Bcc addresses").optional(),
            note: z
              .string()
              .trim()
              .max(2000, "Note is too long (max 2000 chars)")
              .optional(),
          })
          .strict();
        const parsed = sendSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          res.status(400).json({
            message: first?.message || "Invalid email payload",
            errors: parsed.error.issues,
          });
          return;
        }

        await _sendEstimateApprovalEmailFlow(id, {
          to: parsed.data.to,
          cc: parsed.data.cc,
          bcc: parsed.data.bcc,
          note: parsed.data.note,
          req,
        });

        res.json({ message: "Estimate email sent successfully", sentAt: new Date() });
      } catch (error) {
        req.log?.error?.({ err: error }, "Failed to send estimate email");
        console.error("Error sending estimate email:", error);
        res.status(500).json({ message: "Failed to send estimate email" });
      }
    },
  );

  // ── Estimate approval workflow (legacy POST) ──────────────────────────
  app.post(
    "/api/estimates/:id/approve",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));

        // Validate estimate ID is a valid number
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const existing = await storage.getEstimate(id);
        if (!existing) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, existing.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        // Task #611 — conditional update; loses to a concurrent
        // approve/reject without clobbering the winner.
        if (existing.status !== "pending") {
          res.status(409).json({ message: "Estimate is no longer pending" });
          return;
        }
        // Task #671 — dual-write the canonical lifecycle column. The
        // legacy contract (Task #642) requires every write that mutates
        // `status` or `internalStatus` to re-stamp `lifecycle`; this
        // inline POST handler historically only set `status`, which
        // left `lifecycle` stale at whatever the row had before.
        const [updated] = await db
          .update(estimates)
          .set({
            status: "approved",
            approvedAt: new Date(),
            lifecycle: deriveLifecycleForWrite({
              status: "approved",
              internalStatus: existing.internalStatus,
            }),
          })
          .where(and(eq(estimates.id, id), eq(estimates.status, "pending")))
          .returning();
        if (!updated) {
          res.status(409).json({ message: "Estimate is no longer pending" });
          return;
        }
        res.json({ message: "Estimate approved successfully", estimate: updated });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to approve estimate" });
      }
    },
  );

  app.post(
    "/api/estimates/:id/reject",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));

        // Validate estimate ID is a valid number
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const existing = await storage.getEstimate(id);
        if (!existing) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, existing.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        // Task #611 — conditional update; loses to a concurrent
        // approve/reject without clobbering the winner.
        if (existing.status !== "pending") {
          res.status(409).json({ message: "Estimate is no longer pending" });
          return;
        }
        // Task #671 — dual-write the canonical lifecycle column (see
        // matching comment on the approve handler above).
        const [updated] = await db
          .update(estimates)
          .set({
            status: "rejected",
            rejectedAt: new Date(),
            lifecycle: deriveLifecycleForWrite({
              status: "rejected",
              internalStatus: existing.internalStatus,
            }),
          })
          .where(and(eq(estimates.id, id), eq(estimates.status, "pending")))
          .returning();
        if (!updated) {
          res.status(409).json({ message: "Estimate is no longer pending" });
          return;
        }
        res.json({ message: "Estimate rejected successfully", estimate: updated });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to reject estimate" });
      }
    },
  );

  // Internal approval — flips the internal review track from
  // `pending_approval` to `approved_internal`. Does NOT touch the
  // customer-facing `status`, send an email, or create a work order.
  app.patch(
    "/api/estimates/:id/internal-approve",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const estimate = await storage.getEstimate(id);
        if (!estimate) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, estimate.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (estimate.internalStatus !== "pending_approval") {
          res.status(400).json({
            message: "Only estimates pending internal review can be internally approved",
          });
          return;
        }
        // Task #611 — conditional update pins `internalStatus =
        // pending_approval` in the WHERE so concurrent requests can't
        // both flip the row. If the precondition no longer holds (e.g.
        // a parallel call already approved or rejected), we return 409.
        const updated = await storage.internallyApproveEstimateIfPending!(id);
        if (!updated) {
          res
            .status(409)
            .json({ message: "Estimate is no longer pending internal review" });
          return;
        }
        await recordLifecycleAudit(req, {
          resource: "estimate",
          action: "estimate.internal_approved",
          targetId: id,
          companyId: estimate.companyId ?? null,
          before: { internalStatus: estimate.internalStatus },
          after: { internalStatus: (updated as any).internalStatus },
          summary: `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : id} internally approved`,
        });
        res.json({ message: "Estimate internally approved", estimate: updated });
      } catch (error) {
        console.error("Internal approve error:", error);
        res.status(500).json({ message: "Failed to internally approve estimate" });
      }
    },
  );

  // Approve estimate
  app.patch(
    "/api/estimates/:id/approve",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));

        // Validate estimate ID is a valid number
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const estimate = await storage.getEstimate(id);
        if (!estimate) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, estimate.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (estimate.status !== "pending") {
          res.status(400).json({ message: "Only pending estimates can be approved" });
          return;
        }

        // Task #611 — single atomic call. Previously this route ran the
        // status update, the work-order creation, the manager auto-assign,
        // and the assignment notification as four separate top-level DB
        // calls (with the WO branch wrapped in try/catch that explicitly
        // tolerated a half-applied state). The new storage method wraps
        // all of it in one transaction: either the user sees a fully
        // approved estimate with a work order and a notified manager, or
        // nothing changed and they can safely retry.
        const result = await storage.approveEstimateAndCreateWorkOrder!(id);

        await recordLifecycleAudit(req, {
          resource: "estimate",
          action: "estimate.approved",
          targetId: id,
          companyId: estimate.companyId ?? null,
          before: { status: estimate.status, internalStatus: estimate.internalStatus },
          after: {
            status: result.estimate.status,
            internalStatus: result.estimate.internalStatus,
          },
          summary:
            `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : id} approved` +
            (result.workOrder
              ? `; work order ${result.workOrder.workOrderNumber} created`
              : ""),
          extra: result.workOrder
            ? {
                workOrderId: result.workOrder.id,
                workOrderNumber: result.workOrder.workOrderNumber,
              }
            : undefined,
        });

        res.json({
          message: "Estimate approved successfully",
          estimate: result.estimate,
          workOrderCreated: !!result.workOrder,
          workOrderNumber: result.workOrder?.workOrderNumber,
        });
      } catch (error) {
        console.error(error);
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("Only pending estimates")) {
          res.status(400).json({ message: msg });
          return;
        }
        if (msg.includes("not found")) {
          res.status(404).json({ message: msg });
          return;
        }
        if (msg.includes("already exists")) {
          res.status(409).json({ message: msg });
          return;
        }
        res.status(500).json({ message: "Failed to approve estimate" });
      }
    },
  );

  // Reject estimate
  app.patch(
    "/api/estimates/:id/reject",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));

        // Validate estimate ID is a valid number
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const estimate = await storage.getEstimate(id);
        if (!estimate) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, estimate.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (estimate.status !== "pending") {
          res.status(400).json({ message: "Only pending estimates can be rejected" });
          return;
        }

        // Task #611 — conditional update guards against a concurrent
        // approve+reject race: the WHERE pins status='pending', so the
        // loser of the race sees zero rows updated and gets 409.
        const updatedEstimate = await storage.rejectEstimateIfPending!(id);
        if (!updatedEstimate) {
          res.status(409).json({
            message: "Estimate is no longer pending and cannot be rejected",
          });
          return;
        }

        await recordLifecycleAudit(req, {
          resource: "estimate",
          action: "estimate.rejected",
          targetId: id,
          companyId: estimate.companyId ?? null,
          before: { status: estimate.status },
          after: { status: updatedEstimate.status },
          summary: `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : id} rejected`,
        });

        res.json({
          message: "Estimate rejected successfully",
          estimate: updatedEstimate,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to reject estimate" });
      }
    },
  );

  // Send approval email to customer
  // Shared helper for sending an estimate's approval email. Used by both
  // POST /api/estimates/:id/send-approval-email and the new transition
  // endpoint (`send_to_customer` and `resend`) so token generation, the
  // `approvalSentAt` / `internalStatus = sent_to_customer` write, and the
  // SendGrid send all live in one place. Optionally also resets
  // `estimateDate` (used by `resend` to clear the expired bucket).
  //
  // Task #611 — the flow is now email-first: the token is generated in
  // memory, the customer email is sent, and only then is the DB row
  // marked `sent_to_customer` / stamped with the token. Previously the
  // DB write committed first, so a SendGrid failure left the estimate
  // marked sent with a token the customer never saw. With the order
  // reversed, a transient send failure leaves the estimate in its
  // pre-send internal status and the user can retry the single
  // "Send to customer" action cleanly.
  async function _sendEstimateApprovalEmailFlow(
    estimateId: number,
    opts: {
      resetEstimateDate?: boolean;
      to?: string;
      cc?: string[];
      bcc?: string[];
      note?: string;
      req?: any;
    } = {},
  ) {
    const estimateWithItems = await storage.getEstimate(estimateId);
    if (!estimateWithItems) throw new Error(`Estimate ${estimateId} not found`);

    const crypto = await import("crypto");
    const approvalToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiresAt = new Date();
    tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30);

    // If we're going to reset `estimateDate` (the `resend` flow), use the
    // new value in the email body so the customer sees today's date
    // matching what we're about to persist.
    const effectiveEstimateDate = opts.resetEstimateDate
      ? new Date()
      : new Date(estimateWithItems.estimateDate);

    const items = estimateWithItems.items ?? [];
    const laborRate = parseFloat(estimateWithItems.laborRate);

    const resolvedTo = (opts.to && opts.to.trim()) || estimateWithItems.customerEmail;
    const resolvedCc = (opts.cc ?? []).filter((s) => s && s.trim().length > 0);
    const resolvedBcc = (opts.bcc ?? []).filter((s) => s && s.trim().length > 0);

    const { EmailService } = await import("../email-service");
    await EmailService.sendEstimateApprovalEmail({
      estimateId: estimateWithItems.id,
      estimateNumber: estimateWithItems.estimateNumber,
      customerName: estimateWithItems.customerName,
      customerEmail: estimateWithItems.customerEmail,
      projectName: estimateWithItems.projectName,
      projectAddress: estimateWithItems.projectAddress || undefined,
      workLocationLat: estimateWithItems.workLocationLat ?? null,
      workLocationLng: estimateWithItems.workLocationLng ?? null,
      workLocationAddress: estimateWithItems.workLocationAddress ?? null,
      controllerLetter: estimateWithItems.controllerLetter ?? null,
      zoneNumber: estimateWithItems.zoneNumber ?? null,
      totalAmount: `$${parseFloat(estimateWithItems.totalAmount).toFixed(2)}`,
      approvalToken,
      estimateDate: effectiveEstimateDate.toLocaleDateString(),
      createdBy: estimateWithItems.createdBy,
      companyId: estimateWithItems.companyId!,
      workDescription: estimateWithItems.workDescription ?? null,
      to: resolvedTo,
      cc: resolvedCc,
      bcc: resolvedBcc,
      note: opts.note,
      items: items.map((item) => ({
        description: item.description || item.partName,
        partName: item.partName,
        quantity: item.quantity,
        partPrice: parseFloat(item.partPrice),
        laborHours: parseFloat(item.laborHours),
        partsCost: parseFloat(item.totalPrice),
        laborCost: parseFloat(item.laborHours) * laborRate,
        lineTotal: parseFloat(item.totalPrice) + parseFloat(item.laborHours) * laborRate,
      })),
    });

    // Email send succeeded — persist the transition via a single
    // conditional UPDATE (Task #611). The WHERE clause pins
    // internalStatus to a pre-send value (or `status='expired'` for
    // resend), so two concurrent send-to-customer requests can't
    // both stamp tokens: the second writer matches zero rows and we
    // throw EstimateSendConflictError, which the route layer maps
    // to 409. The cost is a redundant email going out for the loser
    // of the race — preferable to burying a stale token in the DB.
    const persisted = await storage.markEstimateSentToCustomer!(estimateId, {
      approvalToken,
      tokenExpiresAt,
      approvalSentAt: new Date(),
      newEstimateDate: opts.resetEstimateDate ? effectiveEstimateDate : null,
      isResend: !!opts.resetEstimateDate,
    });
    if (!persisted) {
      throw new EstimateSendConflictError(
        opts.resetEstimateDate
          ? "Estimate is no longer in an expired state and cannot be resent"
          : "Estimate has already been sent to the customer",
      );
    }

    // Task #616 — record a single audit row per send so managers can
    // see in the estimate's history exactly who sent it, to which
    // addresses, and when.
    if (opts.req) {
      const req = opts.req;
      await recordAuditEvent(req, {
        actorUserId: req.authenticatedUserId ?? null,
        actorLabel: req.authenticatedUserName ?? null,
        actorRole: req.authenticatedUserRole ?? null,
        actorCompanyId: req.authenticatedUserCompanyId ?? null,
        actionType: "data",
        action: "estimate.email.sent",
        severity: "info",
        targetType: "estimate",
        targetId: String(estimateId),
        summary: `Estimate ${formatEstimateNumber(estimateWithItems.estimateNumber)} sent to ${resolvedTo}`,
        details: {
          estimateId,
          estimateNumber: estimateWithItems.estimateNumber,
          to: resolvedTo,
          cc: resolvedCc,
          bcc: resolvedBcc,
          hasNote: !!(opts.note && opts.note.trim()),
        },
      });
    }

    return persisted;
  }

  app.post(
    "/api/estimates/:id/send-approval-email",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        const estimate = await storage.getEstimate(id);
        if (!estimate) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, estimate.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (estimate.status !== "pending") {
          res
            .status(400)
            .json({ message: "Only pending estimates can have approval emails sent" });
          return;
        }
        // Allow sending from either the queue's pre-approval state
        // (one-click "Approve & Send") or after internal approval
        // (two-step). Reject if it has already been sent.
        if (estimate.internalStatus === "sent_to_customer") {
          res
            .status(400)
            .json({ message: "Estimate has already been sent to the customer" });
          return;
        }
        if (
          estimate.internalStatus !== "pending_approval" &&
          estimate.internalStatus !== "approved_internal"
        ) {
          res
            .status(400)
            .json({ message: "Estimate is not in a sendable internal state" });
          return;
        }

        await _sendEstimateApprovalEmailFlow(id, { req });

        res.json({
          message: "Approval email sent successfully",
          sentAt: new Date(),
        });
      } catch (error) {
        if (error instanceof EstimateSendConflictError) {
          res.status(409).json({ message: error.message });
          return;
        }
        console.error("Error sending approval email:", error);
        res.status(500).json({ message: "Failed to send approval email" });
      }
    },
  );

  // ── POST /api/estimates/:id/resend ────────────────────────────────────
  // Task #639 — canonical resend endpoint. Replaces the legacy
  // `POST /api/estimates/:id/transition` with `action=resend` (which
  // now returns 410 Gone via `registerLegacyEstimateGoneRoutes`).
  // Only estimates in the computed `expired` lifecycle bucket may be
  // resent; the underlying flow resets `estimateDate`, mints a new
  // approval token, and sends the customer email through the shared
  // `_sendEstimateApprovalEmailFlow` helper.
  app.post("/api/estimates/:id/resend", requireAuthentication, async (req: any, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid estimate ID" });
        return;
      }
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      if (!estimateOwnershipMatches(req, estimate.companyId)) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      const role = req.authenticatedUserRole;
      const canResend =
        role === "irrigation_manager" || role === "company_admin" || role === "super_admin";
      if (!canResend) {
        res.status(403).json({
          message: "Access denied. Resending requires irrigation manager or admin role.",
        });
        return;
      }
      if (estimate.lifecycleStatus !== "expired") {
        res.status(400).json({ message: "Only expired estimates can be resent" });
        return;
      }
      await _sendEstimateApprovalEmailFlow(id, { resetEstimateDate: true, req });
      const fresh = await storage.getEstimate(id);
      // Task #641 — audit the resend so the Activity tab shows it.
      await recordLifecycleAudit(req, {
        resource: "estimate",
        action: "estimate.resent",
        targetId: id,
        companyId: estimate.companyId ?? null,
        before: { status: estimate.status, internalStatus: estimate.internalStatus },
        after: { status: fresh?.status, internalStatus: fresh?.internalStatus },
        summary: `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : id} resent after expiration`,
      });
      res.json({ message: "Estimate resent to customer", estimate: fresh });
    } catch (error) {
      if (error instanceof EstimateSendConflictError) {
        res.status(409).json({ message: error.message });
        return;
      }
      console.error("Estimate resend error:", error);
      res.status(500).json({ message: "Failed to resend estimate" });
    }
  });

  // ── POST /api/estimates/:id/mark-sent ─────────────────────────────────
  // Task #680 — Mark an estimate as sent **without** sending an email.
  // Mirrors the preconditions and side effects of
  // `_sendEstimateApprovalEmailFlow` (mints a 32-byte approval token
  // with a 30-day expiry, flips internalStatus → sent_to_customer,
  // dual-stamps the lifecycle column via `markEstimateSentToCustomer`),
  // but intentionally skips the SendGrid send. Used when the estimate
  // is delivered out-of-band (printed, hand-delivered, personal email).
  // Role gate matches the email-send path (billing_manager /
  // company_admin / super_admin); field_tech and irrigation_manager
  // get 403 via `requireEstimateApprovalAccess`.
  app.post(
    "/api/estimates/:id/mark-sent",
    requireAuthentication,
    requireEstimateApprovalAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid estimate ID" });
          return;
        }
        const estimate = await storage.getEstimate(id);
        if (!estimate) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (!estimateOwnershipMatches(req, estimate.companyId)) {
          res.status(404).json({ message: "Estimate not found" });
          return;
        }
        if (estimate.status !== "pending") {
          res
            .status(400)
            .json({ message: "Only pending estimates can be marked as sent" });
          return;
        }
        if (estimate.internalStatus === "sent_to_customer") {
          res
            .status(400)
            .json({ message: "Estimate has already been sent to the customer" });
          return;
        }
        if (
          estimate.internalStatus !== "pending_approval" &&
          estimate.internalStatus !== "approved_internal"
        ) {
          res
            .status(400)
            .json({ message: "Estimate is not in a sendable internal state" });
          return;
        }

        const crypto = await import("crypto");
        const approvalToken = crypto.randomBytes(32).toString("hex");
        const tokenExpiresAt = new Date();
        tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30);

        const persisted = await storage.markEstimateSentToCustomer!(id, {
          approvalToken,
          tokenExpiresAt,
          approvalSentAt: new Date(),
          newEstimateDate: null,
          isResend: false,
        });
        if (!persisted) {
          res.status(409).json({
            message: "Estimate has already been sent to the customer",
          });
          return;
        }

        // Build the customer-facing approval URL server-side so the
        // response carries the canonical link (matches the URL the
        // email flow would have generated). Mirrors `EmailService.baseUrl`.
        const baseUrl = (() => {
          if (process.env.APP_BASE_URL) {
            return process.env.APP_BASE_URL.replace(/\/$/, "");
          }
          if (process.env.NODE_ENV === "production") {
            return "https://irrigopro.com";
          }
          const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
          if (replitDomain) return `https://${replitDomain}`;
          return `https://${process.env.REPL_ID}.${process.env.REPL_OWNER}.replit.dev`;
        })();
        const approvalUrl = `${baseUrl}/estimate-approval/${approvalToken}`;

        // Task #680 — lifecycle audit so finance can later distinguish
        // a manual mark-sent from an emailed send. Same shape used by
        // the resend audit row above.
        await recordLifecycleAudit(req, {
          resource: "estimate",
          action: "estimate.mark_sent",
          targetId: id,
          companyId: estimate.companyId ?? null,
          before: {
            status: estimate.status,
            internalStatus: estimate.internalStatus,
          },
          after: {
            status: persisted.status,
            internalStatus: persisted.internalStatus,
          },
          summary: `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : id} marked as sent without email`,
          extra: { emailSent: false },
        });

        res.json({
          message: "Estimate marked as sent",
          estimate: persisted,
          approvalToken,
          approvalUrl,
          tokenExpiresAt,
        });
      } catch (error) {
        console.error("Estimate mark-sent error:", error);
        res.status(500).json({ message: "Failed to mark estimate as sent" });
      }
    },
  );

  // ── GET /api/estimates/view-by-token/:token ───────────────────────────
  // Task #666 — public, read-only fetch of an estimate by approval
  // token. Returns everything the customer-facing approval page needs
  // to render before deciding to approve or reject: estimate header,
  // line items, totals, signed photo URLs, and the attachment list.
  // **Does not mutate the estimate** — the actual approve/reject calls
  // still go through `approve-via-token` / `reject-via-token`.
  app.get("/api/estimates/view-by-token/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      const list = await storage.getEstimates!();
      const summary = list.find((e) => e.approvalToken === token);

      if (!summary) {
        res.status(404).json({ error: "not_found", message: "Invalid or expired link." });
        return;
      }
      if (summary.tokenExpiresAt && new Date() > new Date(summary.tokenExpiresAt)) {
        res.status(410).json({
          error: "expired",
          message: "This approval link has expired.",
          estimateNumber: summary.estimateNumber,
        });
        return;
      }
      const alreadyResponded = summary.status !== "pending";

      const full = await storage.getEstimate(summary.id);
      if (!full) {
        res.status(404).json({ error: "not_found", message: "Estimate no longer available." });
        return;
      }

      // Pre-sign site photos so the unauthenticated customer can render
      // them without hitting the auth-gated `/api/photos/signed-urls`
      // batch endpoint.
      let photoSignedUrls: Array<{ photoId: string; url: string | null }> = [];
      try {
        const photos = (full.photos ?? []).filter(
          (p): p is string => typeof p === "string" && p.length > 0,
        );
        if (photos.length > 0) {
          const { ObjectStorageService } = await import("../objectStorage");
          const photoService = new ObjectStorageService();
          photoSignedUrls = await Promise.all(
            photos.map(async (raw) => {
              const photoId = raw.replace(/^\//, "").replace(/^api\/photos\//, "");
              try {
                const signed = await photoService.getPhotoDownloadURL(
                  photoId,
                  900,
                  "medium",
                );
                return { photoId, url: signed ?? null };
              } catch {
                return { photoId, url: null };
              }
            }),
          );
        }
      } catch (photoErr) {
        console.error("Failed to sign estimate photos for view-by-token:", photoErr);
      }

      const attachmentsResp = (full.attachments ?? []).filter(
        (a): a is string => typeof a === "string" && a.length > 0,
      );

      res.json({
        alreadyResponded,
        status: full.status,
        estimate: {
          id: full.id,
          estimateNumber: full.estimateNumber,
          projectName: full.projectName,
          projectAddress: full.projectAddress,
          customerName: full.customerName,
          customerEmail: full.customerEmail,
          customerPhone: full.customerPhone,
          estimateDate: full.estimateDate,
          workDescription: full.workDescription,
          locationNotes: full.locationNotes,
          accessInstructions: full.accessInstructions,
          totalAmount: full.totalAmount,
          totalLaborHours: full.totalLaborHours,
          laborRate: full.laborRate,
          items: (full.items ?? []).map((it) => ({
            id: it.id,
            partName: it.partName,
            description: it.description,
            quantity: it.quantity,
            partPrice: it.partPrice,
            laborHours: it.laborHours,
            totalPrice: it.totalPrice,
          })),
        },
        photos: photoSignedUrls,
        attachments: attachmentsResp,
      });
    } catch (error) {
      console.error("Error in view-by-token:", error);
      res.status(500).json({ error: "server_error", message: "Failed to load estimate." });
    }
  });

  // ── GET /api/estimates/approve-via-token/:token ───────────────────────
  // Approve estimate via token (customer clicks link). Public unauth path;
  // response shape (HTML for the error/already-responded branches, JSON
  // for the happy path) must not change — the marketing site / customer
  // emails depend on this exact contract.
  app.get("/api/estimates/approve-via-token/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      const list = await storage.getEstimates!();
      const estimate = list.find((e) => e.approvalToken === token);

      if (!estimate) {
        res.status(404).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ef4444;">Invalid or Expired Link</h2>
            <p>This approval link is no longer valid. Please contact us directly.</p>
          </body></html>
        `);
        return;
      }

      // Check if token has expired
      if (estimate.tokenExpiresAt && new Date() > new Date(estimate.tokenExpiresAt)) {
        // Mark estimate as expired
        await storage.updateEstimate!(estimate.id, { status: "expired" });
        res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ef4444;">Link Expired</h2>
            <p>This approval link has expired. Please contact us to request a new estimate.</p>
          </body></html>
        `);
        return;
      }

      if (estimate.status !== "pending") {
        res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #f59e0b;">Already Responded</h2>
            <p>You have already responded to this estimate. Thank you!</p>
          </body></html>
        `);
        return;
      }

      // Approve the estimate with approval source tracking
      await storage.updateEstimate!(estimate.id, {
        status: "approved",
        approvalSource: "email_link",
        approvalRespondedAt: new Date(),
        approvedAt: new Date(),
      });
      await recordLifecycleAudit(req, {
        resource: "estimate",
        action: "estimate.customer_approved",
        targetId: estimate.id,
        companyId: estimate.companyId ?? null,
        customer: {
          email: estimate.customerEmail,
          name: estimate.customerName,
          token,
        },
        before: { status: estimate.status },
        after: { status: "approved" },
        summary: `Customer approved estimate ${formatEstimateNumber(estimate.estimateNumber)}`,
        extra: { approvalSource: "email_link" },
      });

      // Auto-convert to work order (per business rule: estimates auto-create work orders when approved)
      let workOrder: WorkOrder | null = null;
      try {
        workOrder = await storage.createWorkOrderFromEstimate!(estimate.id);

        // Auto-assign to the company's irrigation manager
        const irrigationManager = await storage.getIrrigationManagerForCompany!(
          estimate.companyId!,
        );
        if (irrigationManager && workOrder) {
          await storage.assignWorkOrder!(
            workOrder.id,
            irrigationManager.id,
            irrigationManager.name,
          );

          // Create notification for the assigned manager
          await storage.createNotification!({
            userId: irrigationManager.id,
            type: "work_order_assigned",
            title: "New Work Order Assigned",
            message: `Work order ${workOrder.workOrderNumber} for ${estimate.customerName} has been auto-assigned to you from approved estimate.`,
            isRead: false,
          });
        }
      } catch (workOrderError) {
        console.error("Auto work order creation failed:", workOrderError);
        // Continue even if work order creation fails - estimate is still approved
      }

      // Notify company admins that the customer approved the estimate
      try {
        const allUsers = await storage.getUsers!();
        const adminUsers = allUsers.filter(
          (u) => u.role === "company_admin" && u.companyId === estimate.companyId,
        );
        for (const admin of adminUsers) {
          await storage.createNotification!({
            userId: admin.id,
            type: "estimate_approved",
            title: "Estimate Approved by Customer",
            message: `Customer approved estimate ${formatEstimateNumber(estimate.estimateNumber)} for ${estimate.customerName}.${workOrder ? ` Work order ${workOrder.workOrderNumber} has been created.` : ""}`,
            relatedEntityType: "estimate",
            relatedEntityId: estimate.id,
            isRead: false,
          });
        }
      } catch (notifError) {
        console.error("Failed to send approval notifications:", notifError);
      }

      // Send confirmation email
      const { EmailService } = await import("../email-service");
      await EmailService.sendApprovalConfirmation(
        estimate.customerEmail,
        estimate.estimateNumber,
        true,
      );

      // Task #666 — surface the estimate's photos and attachments on
      // the customer-facing confirmation page. Photos are pre-signed
      // here because the customer is unauthenticated and can't call
      // the `/api/photos/signed-urls` batch endpoint themselves.
      // Attachments are returned verbatim; the page only shows the
      // filename portion so we don't expose internal storage keys
      // as clickable URLs.
      let photoSignedUrls: Array<{ photoId: string; url: string | null }> = [];
      try {
        const photos = (estimate.photos ?? []).filter(
          (p): p is string => typeof p === "string" && p.length > 0,
        );
        if (photos.length > 0) {
          const { ObjectStorageService } = await import("../objectStorage");
          const photoService = new ObjectStorageService();
          photoSignedUrls = await Promise.all(
            photos.map(async (raw) => {
              const photoId = raw.replace(/^\//, "").replace(/^api\/photos\//, "");
              try {
                const signed = await photoService.getPhotoDownloadURL(
                  photoId,
                  900,
                  "medium",
                );
                return { photoId, url: signed ?? null };
              } catch {
                return { photoId, url: null };
              }
            }),
          );
        }
      } catch (photoErr) {
        console.error("Failed to sign estimate photos for approval page:", photoErr);
      }

      const attachmentsResp = (estimate.attachments ?? []).filter(
        (a): a is string => typeof a === "string" && a.length > 0,
      );

      // Return JSON response for the approval page
      res.json({
        success: true,
        message: "Estimate approved successfully",
        estimateNumber: estimate.estimateNumber,
        customerEmail: estimate.customerEmail,
        workOrderCreated: !!workOrder,
        workOrderNumber: workOrder?.workOrderNumber,
        photos: photoSignedUrls,
        attachments: attachmentsResp,
      });
    } catch (error) {
      console.error("Error approving estimate via token:", error);
      res.status(500).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ef4444;">Error</h2>
          <p>Something went wrong. Please contact us directly.</p>
        </body></html>
      `);
    }
  });

  // ── GET /api/estimates/reject-via-token/:token ────────────────────────
  // Reject estimate via token (customer clicks link). Public unauth path
  // — preserve the HTML response body shape exactly.
  app.get("/api/estimates/reject-via-token/:token", async (req, res) => {
    try {
      const token = String(req.params.token);
      const list = await storage.getEstimates!();
      const estimate = list.find((e) => e.approvalToken === token);

      if (!estimate) {
        res.status(404).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #ef4444;">Invalid or Expired Link</h2>
            <p>This approval link is no longer valid. Please contact us directly.</p>
          </body></html>
        `);
        return;
      }

      if (estimate.status !== "pending") {
        res.status(400).send(`
          <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #f59e0b;">Already Responded</h2>
            <p>You have already responded to this estimate. Thank you!</p>
          </body></html>
        `);
        return;
      }

      // Reject the estimate with approval source tracking
      await storage.updateEstimate!(estimate.id, {
        status: "rejected",
        approvalSource: "email_link",
        approvalRespondedAt: new Date(),
        rejectedAt: new Date(),
      });
      await recordLifecycleAudit(req, {
        resource: "estimate",
        action: "estimate.customer_rejected",
        targetId: estimate.id,
        companyId: estimate.companyId ?? null,
        customer: {
          email: estimate.customerEmail,
          name: estimate.customerName,
          token,
        },
        before: { status: estimate.status },
        after: { status: "rejected" },
        summary: `Customer rejected estimate ${formatEstimateNumber(estimate.estimateNumber)}`,
        extra: { approvalSource: "email_link" },
      });

      // Notify company admins and managers that customer rejected the estimate
      try {
        const allUsers = await storage.getUsers!();
        const notifyUsers = allUsers.filter(
          (u) =>
            (u.role === "company_admin" || u.role === "irrigation_manager") &&
            u.companyId === estimate.companyId,
        );
        for (const user of notifyUsers) {
          await storage.createNotification!({
            userId: user.id,
            type: "estimate_rejected",
            title: "Estimate Rejected by Customer",
            message: `Customer declined estimate ${formatEstimateNumber(estimate.estimateNumber)} for ${estimate.customerName}.`,
            relatedEntityType: "estimate",
            relatedEntityId: estimate.id,
            isRead: false,
          });
        }
      } catch (notifError) {
        console.error("Failed to send rejection notifications:", notifError);
      }

      // Send confirmation email
      const { EmailService } = await import("../email-service");
      await EmailService.sendApprovalConfirmation(
        estimate.customerEmail,
        estimate.estimateNumber,
        false,
      );

      res.send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <div style="max-width: 600px; margin: 0 auto; background: #fef2f2; border: 1px solid #dc2626; border-radius: 12px; padding: 40px;">
            <h1 style="color: #dc2626; margin-bottom: 20px;">Estimate Declined</h1>
            <p style="font-size: 18px; color: #374151; margin-bottom: 20px;">
              Thank you for your response regarding estimate ${formatEstimateNumber(estimate.estimateNumber)}.
            </p>
            <p style="color: #6b7280;">
              We understand this estimate doesn't meet your needs at this time. Please feel free to contact us if you'd like to discuss alternatives or have any questions.
            </p>
            <p style="color: #6b7280; margin-top: 30px;">
              A confirmation email has been sent to ${estimate.customerEmail}.
            </p>
          </div>
        </body></html>
      `);
    } catch (error) {
      console.error("Error rejecting estimate via token:", error);
      res.status(500).send(`
        <html><body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #ef4444;">Error</h2>
          <p>Something went wrong. Please contact us directly.</p>
        </body></html>
      `);
    }
  });

  // ── POST /api/estimates/:id/convert-to-work-order ─────────────────────
  // Convert estimate to work order
  app.post(
    "/api/estimates/:id/convert-to-work-order",
    requireAuthentication,
    async (req, res) => {
      try {
        const id = parseInt(String(req.params.id));
        const estBefore = await storage.getEstimate(id).catch(() => null);

        // Use the new storage function that handles all validation and conversion
        const workOrder = await storage.createWorkOrderFromEstimate!(id);

        await recordLifecycleAudit(req, {
          resource: "estimate",
          action: "estimate.converted_to_work_order",
          targetId: id,
          before: {
            status: estBefore?.status,
            internalStatus: estBefore?.internalStatus,
          },
          after: {
            workOrderId: workOrder.id,
            workOrderNumber: workOrder.workOrderNumber,
          },
          summary: `Estimate ${id} converted to work order ${workOrder.workOrderNumber}`,
          extra: {
            workOrderId: workOrder.id,
            workOrderNumber: workOrder.workOrderNumber,
          },
        });

        // Optionally assign to a technician if provided in request
        if (req.body.assignedTechnicianId) {
          const assignedUser = await storage.getUser!(req.body.assignedTechnicianId);
          if (assignedUser) {
            await storage.assignWorkOrder!(workOrder.id, assignedUser.id, assignedUser.name);
          }
        }

        // Update scheduled date if provided
        if (req.body.scheduledDate) {
          await storage.updateWorkOrder!(workOrder.id, {
            scheduledDate: new Date(req.body.scheduledDate),
          });
        }

        // Add notes if provided
        if (req.body.notes) {
          await storage.updateWorkOrder!(workOrder.id, {
            notes: req.body.notes,
          });
        }

        res.json({
          message: "Work order created successfully",
          workOrder,
          estimateId: id,
        });
      } catch (error) {
        console.error("Error converting estimate to work order:", error);
        if (error instanceof Error) {
          if (error.message.includes("not found")) {
            res.status(404).json({ message: error.message });
            return;
          }
          if (
            error.message.includes("must be approved") ||
            error.message.includes("already exists")
          ) {
            res.status(400).json({ message: error.message });
            return;
          }
        }
        res.status(500).json({ message: "Failed to create work order" });
      }
    },
  );

  // ── GET/POST /api/estimates/:id/pdf ──────────────────────────────────
  // Generate PDF
  // Task #348: produces a real PDF (puppeteer) that includes the project
  // address, the pinned work-location coordinates, and a Google Maps link
  // so customers and dispatch can confirm the exact work area.
  // Task #605 — shared handler for the polished estimate PDF. The legacy
  // POST route stays for back-compat; a new GET route powers View/Download
  // from the UI (?download=1 switches to attachment disposition).
  const handleEstimatePdf = async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const estimate = await storage.getEstimate(id);
      if (!estimate) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }
      if (!estimateOwnershipMatches(req, estimate.companyId)) {
        res.status(404).json({ message: "Estimate not found" });
        return;
      }

      const company = estimate.companyId
        ? await storage.getCompanyProfile!(estimate.companyId)
        : undefined;

      const { renderEstimatePdf } = await import("../estimate-pdf");
      const pdf = await renderEstimatePdf(estimate, { company: company ?? null });

      const wantsDownload = String(req.query?.download ?? "") === "1";
      res.setHeader("Content-Type", "application/pdf");
      // Task #691 — Filename is "{Customer Name} - EST-{Number}.pdf" so
      // saved files sort and identify by customer. Sanitize the customer
      // name by replacing Windows/macOS-reserved characters
      // (/ \ : * ? " < > |) and ASCII control chars with a space.
      // Fall back to "estimate-EST-{Number}.pdf" if the customer name
      // is empty after sanitization. Emit both the RFC 5987
      // `filename*=UTF-8''…` form and an ASCII `filename="…"` fallback
      // so non-ASCII customer names survive.
      const formattedNumber = formatEstimateNumber(estimate.estimateNumber);
      const safeCustomer = (estimate.customerName ?? "")
        // eslint-disable-next-line no-control-regex
        .replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const filename = safeCustomer
        ? `${safeCustomer} - ${formattedNumber}.pdf`
        : `estimate-${formattedNumber}.pdf`;
      // ASCII fallback: replace any non-ASCII byte with `_` so older
      // clients that don't understand `filename*` still get something
      // sane.
      // eslint-disable-next-line no-control-regex
      const asciiFilename = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
      const utf8Filename = encodeURIComponent(filename);
      res.setHeader(
        "Content-Disposition",
        `${wantsDownload ? "attachment" : "inline"}; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`,
      );
      res.send(pdf);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  };

  app.post(
    "/api/estimates/:id/pdf",
    requireAuthentication,
    requireEstimatePdfAccess,
    handleEstimatePdf,
  );
  app.get(
    "/api/estimates/:id/pdf",
    requireAuthentication,
    requireEstimatePdfAccess,
    handleEstimatePdf,
  );
}

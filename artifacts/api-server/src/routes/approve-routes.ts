// Approve / return-for-correction endpoints for billing sheets and work orders.
//
// Extracted from routes.ts (Task #768) so the four handlers can be imported by
// tests without spinning up the full monolith (which requires a live Postgres).
//
// Wired back into routes.ts via registerApproveRoutes(). Behaviour is
// identical to the original inline handlers.

import type { Express, RequestHandler } from "express";
import type { LifecycleAuditOpts } from "./audit-log";

// ─── Minimal storage surface ─────────────────────────────────────────────────

export interface ApproveRoutesStorage {
  getBillingSheetById(id: number, companyId: number | null): Promise<{
    id: number;
    status: string;
    partsSubtotal: string | number | null;
    totalHours: string | number | null;
    laborRate: string | number | null;
    laborSubtotal: string | number | null;
    totalAmount: string | number | null;
    notes: string | null | undefined;
  } | undefined>;

  updateBillingSheet(id: number, data: Record<string, unknown>): Promise<unknown>;

  getWorkOrder(id: number, companyId: number | null): Promise<{
    id: number;
    workOrderNumber: string;
    status: string;
    partsSubtotal: string | number | null;
    totalHours: string | number | null;
    laborRate: string | number | null;
    appliedLaborRate?: string | number | null;
    laborSubtotal: string | number | null;
    totalAmount: string | number | null;
    notes: string | null | undefined;
  } | undefined>;

  updateWorkOrder(id: number, data: Record<string, unknown>): Promise<unknown>;

  getUser(id: number): Promise<{ name?: string | null } | undefined>;
}

// ─── Optional dep injections (for tests) ─────────────────────────────────────

export type ApproveRoutesDeps = {
  // Lifecycle audit emitter — no-op by default so tests don't need a DB.
  recordLifecycleAudit?: (req: any, opts: LifecycleAuditOpts) => Promise<void>;
};

// ─── Route registration ───────────────────────────────────────────────────────

export function registerApproveRoutes(
  app: Express,
  storage: ApproveRoutesStorage,
  requireAuthentication: RequestHandler,
  deps: ApproveRoutesDeps = {},
): void {
  const recordLifecycleAudit = deps.recordLifecycleAudit ?? (async () => {});

  // ── POST /api/billing-sheets/:id/approve ─────────────────────────────────
  // Transitions pending_manager_review OR submitted → approved_passed_to_billing.
  app.post("/api/billing-sheets/:id/approve", requireAuthentication, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;
      const userId = req.authenticatedUserId;

      if (userRole !== "irrigation_manager" && userRole !== "company_admin" && userRole !== "super_admin") {
        res.status(403).json({ message: "Only irrigation managers and company admins can approve billing sheets." });
        return;
      }

      const callerCompanyId: number | null = userRole === 'super_admin' ? null : (req.authenticatedUserCompanyId ?? null);
      const billingSheet = await storage.getBillingSheetById(id, callerCompanyId);
      if (!billingSheet) {
        res.status(404).json({ message: "Billing sheet not found" });
        return;
      }
      if (billingSheet.status !== "pending_manager_review" && billingSheet.status !== "submitted") {
        res.status(400).json({ message: "Billing sheet must be in Pending Manager Review or Submitted to approve." });
        return;
      }

      const approverUser = userId ? await storage.getUser(userId) : undefined;
      const approverName = approverUser?.name || "Manager";

      const partsSnapshot = JSON.stringify({
        partsSubtotal: billingSheet.partsSubtotal,
      });
      const laborSnapshot = JSON.stringify({
        totalHours: billingSheet.totalHours,
        laborRate: billingSheet.laborRate,
        laborSubtotal: billingSheet.laborSubtotal,
      });

      const updated = await storage.updateBillingSheet(id, {
        status: "approved_passed_to_billing",
        approvedBy: approverName,
        approvedByUserId: userId || undefined,
        approvedAt: new Date(),
        approvedTotal: billingSheet.totalAmount,
        approvedPartsSnapshot: partsSnapshot,
        approvedLaborSnapshot: laborSnapshot,
      });

      res.json({ message: "Billing sheet approved and passed to billing", billingSheet: updated });
    } catch (error) {
      console.error("Error approving billing sheet:", error);
      res.status(500).json({ message: "Failed to approve billing sheet" });
    }
  });

  // ── POST /api/billing-sheets/:id/return-for-correction ───────────────────
  // Transitions pending_manager_review OR submitted → draft.
  app.post("/api/billing-sheets/:id/return-for-correction", requireAuthentication, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;

      if (userRole !== "irrigation_manager" && userRole !== "company_admin" && userRole !== "super_admin") {
        res.status(403).json({ message: "Only irrigation managers and company admins can return billing sheets for correction." });
        return;
      }

      const callerCompanyId: number | null = userRole === 'super_admin' ? null : (req.authenticatedUserCompanyId ?? null);
      const billingSheet = await storage.getBillingSheetById(id, callerCompanyId);
      if (!billingSheet) {
        res.status(404).json({ message: "Billing sheet not found" });
        return;
      }
      if (billingSheet.status !== "pending_manager_review" && billingSheet.status !== "submitted") {
        res.status(400).json({ message: "Billing sheet must be in Pending Manager Review or Submitted to return for correction." });
        return;
      }

      const { notes } = req.body ?? {};

      const updated = await storage.updateBillingSheet(id, {
        status: "draft",
        ...(notes
          ? { notes: `${billingSheet.notes ? billingSheet.notes + "\n" : ""}[Returned for correction: ${notes}]` }
          : {}),
      });

      res.json({ message: "Billing sheet returned for correction", billingSheet: updated });
    } catch (error) {
      console.error("Error returning billing sheet for correction:", error);
      res.status(500).json({ message: "Failed to return billing sheet for correction" });
    }
  });

  // ── POST /api/work-orders/:id/approve ────────────────────────────────────
  // Transitions pending_manager_review OR work_completed → approved_passed_to_billing.
  app.post("/api/work-orders/:id/approve", requireAuthentication, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;
      const userId = req.authenticatedUserId;

      if (userRole !== "irrigation_manager" && userRole !== "company_admin" && userRole !== "super_admin") {
        res.status(403).json({ message: "Only irrigation managers and company admins can approve work orders." });
        return;
      }

      const callerCompanyId: number | null = userRole === 'super_admin' ? null : (req.authenticatedUserCompanyId ?? null);
      const workOrder = await storage.getWorkOrder(id, callerCompanyId);
      if (!workOrder) {
        res.status(404).json({ message: "Work order not found" });
        return;
      }
      if (workOrder.status !== "pending_manager_review" && workOrder.status !== "work_completed") {
        res.status(400).json({ message: "Work order must be in Pending Manager Review or Work Completed to approve." });
        return;
      }

      const approverUser = userId ? await storage.getUser(userId) : undefined;
      const approverName = approverUser?.name || "Manager";

      const partsSnapshot = JSON.stringify({
        partsSubtotal: workOrder.partsSubtotal,
      });
      const laborSnapshot = JSON.stringify({
        totalHours: workOrder.totalHours,
        laborRate: workOrder.appliedLaborRate ?? workOrder.laborRate,
        laborSubtotal: workOrder.laborSubtotal,
      });

      const updated = await storage.updateWorkOrder(id, {
        status: "approved_passed_to_billing",
        approvedBy: approverName,
        approvedByUserId: userId || undefined,
        approvedAt: new Date(),
        approvedTotal: workOrder.totalAmount,
        approvedPartsSnapshot: partsSnapshot,
        approvedLaborSnapshot: laborSnapshot,
      });

      await recordLifecycleAudit(req, {
        resource: "work_order",
        action: "work_order.approved",
        targetId: id,
        before: { status: workOrder.status },
        after: { status: "approved_passed_to_billing" },
        summary: `Work order ${workOrder.workOrderNumber} approved by ${approverName}`,
      });

      res.json({ message: "Work order approved and passed to billing", workOrder: updated });
    } catch (error) {
      console.error("Error approving work order:", error);
      res.status(500).json({ message: "Failed to approve work order" });
    }
  });

  // ── POST /api/work-orders/:id/return-for-correction ──────────────────────
  // Transitions pending_manager_review OR work_completed → in_progress.
  app.post("/api/work-orders/:id/return-for-correction", requireAuthentication, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userRole = req.authenticatedUserRole;

      if (userRole !== "irrigation_manager" && userRole !== "company_admin" && userRole !== "super_admin") {
        res.status(403).json({ message: "Only irrigation managers and company admins can return work orders for correction." });
        return;
      }

      const callerCompanyId: number | null = userRole === 'super_admin' ? null : (req.authenticatedUserCompanyId ?? null);
      const workOrder = await storage.getWorkOrder(id, callerCompanyId);
      if (!workOrder) {
        res.status(404).json({ message: "Work order not found" });
        return;
      }
      if (workOrder.status !== "pending_manager_review" && workOrder.status !== "work_completed") {
        res.status(400).json({ message: "Work order must be in Pending Manager Review or Work Completed to return for correction." });
        return;
      }

      const { notes } = req.body ?? {};

      const updated = await storage.updateWorkOrder(id, {
        status: "in_progress",
        ...(notes
          ? { notes: `${workOrder.notes ? workOrder.notes + "\n" : ""}[Returned for correction: ${notes}]` }
          : {}),
      });

      await recordLifecycleAudit(req, {
        resource: "work_order",
        action: "work_order.returned_for_correction",
        targetId: id,
        before: { status: workOrder.status },
        after: { status: "in_progress" },
        note: notes ?? null,
        summary: `Work order ${workOrder.workOrderNumber} returned for correction`,
      });

      res.json({ message: "Work order returned for correction", workOrder: updated });
    } catch (error) {
      console.error("Error returning work order for correction:", error);
      res.status(500).json({ message: "Failed to return work order for correction" });
    }
  });
}

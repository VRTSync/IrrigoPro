import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { buildWetCheckGrid } from "../wet-check-grid";
import {
  resolveMonthlyWetCheckBudget,
  resolveWetCheckCreateMode,
  type MonthlyWetCheckBudget,
} from "../wet-check-budget-mode";
import {
  checkBranchGate,
  normalizeBranchName,
  resolveWetCheckMode,
  wetCheckCreateBody,
  type WetCheckMode,
} from "./wet-check-create-gate";

type BudgetDecision = MonthlyWetCheckBudget & {
  mode: WetCheckMode;
  forced: boolean;
};

export interface RegisterWetCheckCreateRoutesDeps {
  requireAuthentication: RequestHandler;
  requireCompanyId: (req: any, res: any) => number | null;
  isFieldRole: (role: string | undefined) => boolean;
  classifyAndLog: (req: any, error: unknown, options: any) => { status: number; message: string };
  recordLifecycleAudit: (req: any, options: any) => Promise<void>;
  resolveBudget?: (customerId: number, companyId: number) => Promise<MonthlyWetCheckBudget>;
}

export function registerWetCheckCreateRoutes(
  app: Express,
  deps: RegisterWetCheckCreateRoutesDeps,
): void {
  const loadBudget = deps.resolveBudget ?? resolveMonthlyWetCheckBudget;

  app.get("/api/wet-checks/customer/:customerId/create-mode", deps.requireAuthentication, async (req, res) => {
    const cid = deps.requireCompanyId(req, res); if (!cid) return;
    if (!deps.isFieldRole(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const customerId = Number.parseInt(String(req.params.customerId), 10);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }
    try {
      const customer = await storage.getCustomer(customerId);
      if (!customer || customer.companyId !== cid) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      const budget = await loadBudget(customer.id, customer.companyId);
      res.json({
        mode: resolveWetCheckMode(budget.headroom, "service"),
        forcedByBudget: budget.headroom !== null && budget.headroom <= 0,
      });
    } catch (error) {
      const { status, message } = deps.classifyAndLog(req, error, {
        op: "previewWetCheckCreateMode",
        ctx: { cid, customerId },
        fallbackMessage: "Couldn't check wet check mode — please retry",
      });
      res.status(status).json({ message });
    }
  });

  app.post("/api/wet-checks", deps.requireAuthentication, async (req, res) => {
    const cid = deps.requireCompanyId(req, res); if (!cid) return;
    if (!deps.isFieldRole(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const parsed = wetCheckCreateBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ message: "Invalid body", issues: parsed.error.issues }); return; }
    const body = parsed.data;
    try {
      const customer = await storage.getCustomer(body.customerId);
      if (!customer || customer.companyId !== cid) { res.status(404).json({ message: "Customer not found" }); return; }
      const techId = req.authenticatedUserId;
      if (!techId) { res.status(401).json({ message: "Authentication required" }); return; }
      const tech = await storage.getUser(techId);
      if (!tech) { res.status(401).json({ message: "User not found" }); return; }

      const branchName = normalizeBranchName(body.branchName);
      const customerBranches = Array.isArray(customer.branches) ? customer.branches as string[] : [];
      const branchGateError = checkBranchGate(customerBranches, branchName);
      if (branchGateError) {
        res.status(400).json({ message: branchGateError });
        return;
      }

      const existing = await storage.findActiveWetCheck(cid, body.customerId, tech.id, branchName);
      if (existing) {
        // An in-progress visit retains the mode fixed when it was created.
        res.status(200).json(existing);
        return;
      }

      const requestedMode = body.mode ?? "service";
      const budgetDecision: BudgetDecision = await resolveWetCheckCreateMode(
        customer.id, customer.companyId, requestedMode, loadBudget,
      );

      let numControllers: number;
      if (body.blankStart) {
        numControllers = 0;
      } else {
        const branchKey = branchName ?? "";
        const irrigationControllers = await storage.listIrrigationControllers(
          cid,
          body.customerId,
          branchKey,
        );
        let gridResult = buildWetCheckGrid(irrigationControllers);
        if (gridResult.seedConfigs.length === 0) {
          const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
          const count = Math.min(26, Math.max(1, customer.totalControllers ?? 1));
          gridResult = {
            numControllers: count,
            seedConfigs: Array.from({ length: count }, (_, index) => ({
              name: `Controller ${alphabet[index]}`,
              zoneCount: null,
            })),
          };
        }
        numControllers = gridResult.numControllers;
        await storage.ensureIrrigationControllers(
          cid,
          body.customerId,
          gridResult.seedConfigs,
          branchName,
        );
      }

      const wetCheck = await storage.createWetCheck({
        companyId: cid,
        customerId: body.customerId,
        technicianId: tech.id,
        technicianName: tech.name,
        customerName: customer.name,
        propertyAddress: customer.address ?? null,
        numControllers,
        status: "in_progress",
        weather: body.weather ?? null,
        notes: body.notes ?? null,
        clientId: body.clientId ?? null,
        mode: budgetDecision.mode,
        branchName,
      });
      if (budgetDecision.forced) {
        await deps.recordLifecycleAudit(req, {
          resource: "wet_check",
          action: "wet_check.mode_forced_by_budget",
          targetId: wetCheck.id,
          companyId: customer.companyId,
          before: { mode: requestedMode },
          after: { mode: budgetDecision.mode },
          summary: `Wet check ${wetCheck.id} changed to inspection because the monthly budget has no headroom`,
          extra: {
            headroom: budgetDecision.headroom,
            allocation: budgetDecision.allocation,
            spend: budgetDecision.spend,
          },
        });
      }
      res.status(201).json(wetCheck);
    } catch (error) {
      const { status, message } = deps.classifyAndLog(req, error, {
        op: "createWetCheck",
        ctx: { cid, customerId: body.customerId },
        fallbackMessage: "Couldn't start wet check — please retry",
      });
      res.status(status).json({ message });
    }
  });
}
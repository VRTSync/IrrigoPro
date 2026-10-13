import type { RequestHandler } from "express";
import { storage } from "../storage";
import { buildWetCheckGrid } from "../wet-check-grid";

// Importable production handler; authentication remains on the existing mount.
export function makePropertyControllerGet(deps: {
  requireCompanyId: (req: any, res: any) => number | null;
  classifyAndLog: (req: any, error: any, options: any) => { status: number; message: string };
}): RequestHandler {
  return async (req, res) => {
    const cid = deps.requireCompanyId(req, res); if (!cid) return;
    const customerId = parseInt(String(req.params.customerId));
    const branch = typeof req.query.branch === "string" ? req.query.branch.trim() : "";
    try {
      const customer = await storage.getCustomer(customerId);
      if (!customer || customer.companyId !== cid) {
        res.status(404).json({ message: "Customer not found" }); return;
      }
      const existing = await storage.listIrrigationControllers(cid, customerId, branch);
      let { seedConfigs } = buildWetCheckGrid(existing);
      if (seedConfigs.length === 0) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const n = Math.min(26, Math.max(1, customer.totalControllers ?? 1));
        seedConfigs = Array.from({ length: n }, (_, i) => ({ name: `Controller ${alphabet[i]}`, zoneCount: null }));
      }
      const controllers = await storage.ensureIrrigationControllers(cid, customerId, seedConfigs, branch);
      const summaries = await storage.listCurrentZoneSummaries(controllers);
      res.json(controllers.map(ctrl => ({
        id: ctrl.id,
        companyId: ctrl.companyId,
        customerId: ctrl.customerId,
        branchName: branch || null,
        controllerLetter: ctrl.letter,
        zoneCount: ctrl.totalZones,
        notes: ctrl.notes ?? null,
        zones: (summaries.get(ctrl.id) ?? []).map(({ id, zoneNumber, name, setUp }) => ({ id, zoneNumber, name, setUp })),
      })));
    } catch (error) {
      const { status, message } = deps.classifyAndLog(req, error, {
        op: "listControllers", ctx: { cid, customerId },
        fallbackMessage: "Couldn't load controllers — please retry",
      });
      res.status(status).json({ message });
    }
  };
}

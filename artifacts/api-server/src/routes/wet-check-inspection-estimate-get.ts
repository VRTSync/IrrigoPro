import type { Express, Request, RequestHandler, Response } from "express";
import { storage } from "../storage";
import { isWetCheckManagerRole } from "./report-email-guards";
import { classifyAndLog } from "./route-error-helpers";

export function registerWetCheckInspectionEstimateGetRoute(
  app: Express,
  { requireAuthentication, requireCompanyId }: {
    requireAuthentication: RequestHandler;
    requireCompanyId: (req: Request, res: Response) => number | null;
  },
): void {
  // Read-only, inspection mode only. Requires a manager role and company scope.
  app.get("/api/wet-checks/:id/inspection-estimate", requireAuthentication, async (req, res) => {
    const cid = requireCompanyId(req, res);
    if (!cid) return;
    if (!isWetCheckManagerRole(req.authenticatedUserRole)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const rawId = req.params.id;
    const wcId = typeof rawId === "string" ? parseInt(rawId, 10) : NaN;
    if (isNaN(wcId)) {
      res.status(400).json({ message: "Invalid wet check id" });
      return;
    }
    try {
      const result = await storage.getInspectionEstimateForWetCheck(wcId, cid);
      if (result.status === "not_found") {
        res.status(404).json({ message: "Wet check not found" });
        return;
      }
      if (result.status === "not_inspection") {
        res.status(400).json({ message: "Not an inspection wet check" });
        return;
      }
      res.json({ estimate: result.estimate });
    } catch (e) {
      const { status, message } = classifyAndLog(req, e, {
        op: "getInspectionEstimateForWetCheck",
        ctx: { cid, wcId },
        fallbackMessage: "Could not load inspection estimate",
      });
      res.status(status).json({ message });
    }
  });
}

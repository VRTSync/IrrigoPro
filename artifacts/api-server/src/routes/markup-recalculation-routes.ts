import type { Express, RequestHandler } from "express";
import { hasCapability, CAN_MANAGE_MARKUP_SCHEDULES } from "@workspace/shared";
import { RecalculateMarkupPricesBody } from "@workspace/api-zod";
import { z } from "zod/v4";
import { storage } from "../storage";
import { markupCompany } from "./markup-schedule-routes";
import { MarkupNotFound } from "../storage/markup-schedules";
import { previewMarkupRecalculation, runMarkupRecalculation, RecalculationError } from "../lib/markup-recalculation";

export function registerMarkupRecalculationRoutes(app: Express, auth: RequestHandler) {
  const handler = (preview: boolean): RequestHandler => async (req, res) => {
    if (!hasCapability(req.authenticatedUserRole, CAN_MANAGE_MARKUP_SCHEDULES)) {
      res.status(403).json({ message: "Access denied" }); return;
    }
    try {
      const body = preview ? null : RecalculateMarkupPricesBody.parse(req.body);
      const companyId = markupCompany(req);
      const userId = Number(req.authenticatedUserId);
      const user = await storage.getUser(userId);
      if (!user || (user.role !== "super_admin" && user.companyId !== companyId)) {
        res.status(403).json({ message: "Access denied" }); return;
      }
      const actor = { companyId, userId, name: user.name };
      res.json(preview ? await previewMarkupRecalculation(actor) :
        await runMarkupRecalculation(actor, body!.confirmationToken, body!.offset));
    } catch (error) {
      const status = error instanceof RecalculationError ? error.status : error instanceof MarkupNotFound ? 404 :
        error instanceof z.ZodError || error instanceof Error && (error.name === "ZodError" || error.message === "Select an explicit company first") ? 400 : 500;
      req.log?.error({ err: error }, "Catalog recalculation request failed");
      res.status(status).json({ message: status === 500 ? "Could not recalculate prices. Preview again and retry." : (error as Error).message });
    }
  };
  app.post("/api/markup-schedules/recalculate-prices/preview", auth, handler(true));
  app.post("/api/markup-schedules/recalculate-prices", auth, handler(false));
}

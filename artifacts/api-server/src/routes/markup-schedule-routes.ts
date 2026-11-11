import type { Express, Request, RequestHandler } from "express";
import { hasCapability, isRole, CAN_MANAGE_MARKUP_SCHEDULES, CAN_ASSIGN_MARKUP_SCHEDULES } from "@workspace/shared";
import { CreateMarkupScheduleBody, UpdateMarkupScheduleBody, SetCustomerMarkupOverrideBody } from "@workspace/api-zod";
import * as store from "../storage/markup-schedules";
import { resolveMaterialSchedule } from "../lib/material-pricing";
import { z } from "zod/v4";

export function markupCompany(req: Request): number {
  const own = req.authenticatedUserCompanyId;
  const companyId = own ?? (req.authenticatedUserRole === "super_admin" ? Number(req.query.companyId) : null);
  if (!Number.isSafeInteger(companyId) || Number(companyId) <= 0) throw new Error("Select an explicit company first");
  if (req.query.companyId !== undefined && Number(req.query.companyId) !== companyId) throw new store.MarkupNotFound();
  return Number(companyId);
}
export const markupId = (value: unknown): number => z.coerce.number().int().positive().parse(value);

export function registerMarkupScheduleRoutes(app: Express, auth: RequestHandler) {
  const guarded = (capability: ReadonlySet<any> | null, action: (req: Request, companyId: number) => Promise<unknown>, status = 200): RequestHandler =>
    async (req, res) => {
      if (!isRole(req.authenticatedUserRole) || (capability && !hasCapability(req.authenticatedUserRole, capability))) {
        res.status(403).json({ message: "Access denied" }); return;
      }
      try { res.status(status).json(await action(req, markupCompany(req))); }
      catch (error) {
        const status = error instanceof store.MarkupNotFound ? 404 : error instanceof z.ZodError || error instanceof Error && !("cause" in error) ? 400 : 500;
        if (status === 500) req.log?.error({ err: error }, "Material markup request failed");
        res.status(status).json({ message: status === 500 ? "Could not load or save markup. Please retry." : error instanceof Error ? error.message : "Invalid request" });
      }
    };
  app.get("/api/markup-schedules/active", auth, guarded(null, async (req, companyId) => {
    const result = await resolveMaterialSchedule(companyId, req.query.customerId === undefined ? null : markupId(req.query.customerId));
    if (!result) throw new store.MarkupNotFound();
    return result;
  }));
  app.get("/api/markup-schedules/options", auth, guarded(CAN_ASSIGN_MARKUP_SCHEDULES, (_req, c) => store.getMarkupSchedules(c)));
  app.get("/api/markup-schedules", auth, guarded(CAN_MANAGE_MARKUP_SCHEDULES, (_req, c) => store.getMarkupSchedules(c)));
  app.post("/api/markup-schedules", auth, guarded(CAN_MANAGE_MARKUP_SCHEDULES, (req, c) => store.createMarkupSchedule({ ...CreateMarkupScheduleBody.parse(req.body), companyId: c }), 201));
  app.get("/api/markup-schedules/:id", auth, guarded(CAN_MANAGE_MARKUP_SCHEDULES, async (req, c) => {
    const result = await store.getMarkupSchedule(markupId(req.params.id), c);
    if (!result) throw new store.MarkupNotFound();
    return result;
  }));
  app.put("/api/markup-schedules/:id", auth, guarded(CAN_MANAGE_MARKUP_SCHEDULES, (req, c) => store.updateMarkupSchedule(markupId(req.params.id), c, UpdateMarkupScheduleBody.parse(req.body))));
  for (const verb of ["activate", "deactivate"] as const)
    app.post(`/api/markup-schedules/:id/${verb}`, auth, guarded(CAN_MANAGE_MARKUP_SCHEDULES, async (req, c) => {
      await (verb === "activate" ? store.activateMarkupSchedule : store.deactivateMarkupSchedule)(markupId(req.params.id), c);
      return { ok: true };
    }));
  app.get("/api/customers/:id/markup-override", auth, guarded(CAN_ASSIGN_MARKUP_SCHEDULES, async (req, c) => ({ override: await store.getCustomerMarkupOverride(markupId(req.params.id), c) })));
  app.put("/api/customers/:id/markup-override", auth, guarded(CAN_ASSIGN_MARKUP_SCHEDULES, async (req, c) => ({ override: await store.setCustomerMarkupOverride(markupId(req.params.id), c, SetCustomerMarkupOverrideBody.parse(req.body).scheduleId) })));
  app.delete("/api/customers/:id/markup-override", auth, guarded(CAN_ASSIGN_MARKUP_SCHEDULES, async (req, c) => {
    await store.removeCustomerMarkupOverride(markupId(req.params.id), c); return { ok: true };
  }));
}

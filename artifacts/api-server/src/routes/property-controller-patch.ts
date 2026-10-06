import { z } from "zod/v4";
import { storage } from "../storage";
import type { RequestHandler } from "express";

const body = z.object({
  controllerLetter: z.string().length(1).transform(s => s.toUpperCase())
    .refine(s => s >= "A" && s <= "Z", "controllerLetter must be A-Z"),
  zoneCount: z.coerce.number().int().min(1).max(100).optional(),
  notes: z.string().nullish(),
});

// No wet-check mode branch: both modes share the same count operation and role guard.
export function makePropertyControllerPatch(deps: {
  requireCompanyId: (req: any, res: any) => number | null;
  isFieldRole: (role: string | undefined) => boolean;
  classifyAndLog: (req: any, error: any, options: any) => { status: number; message: string };
}): RequestHandler {
  return async (req, res) => {
    const cid = deps.requireCompanyId(req, res); if (!cid) return;
    if (!deps.isFieldRole(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const customerId = parseInt(String(req.params.customerId));
    const parsed = body.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ message: "Invalid body", issues: parsed.error.issues }); return; }
    const { controllerLetter, zoneCount, notes } = parsed.data;
    try {
      const owner = await storage.getCustomer(customerId);
      if (!owner || owner.companyId !== cid) { res.status(404).json({ message: "Not found" }); return; }
      const branch = typeof req.query.branch === "string" ? req.query.branch.trim() : "";
      const ctrls = await storage.listIrrigationControllers(cid, customerId, branch);
      const ctrl = ctrls.find(c => c.letter === controllerLetter);
      if (!ctrl) { res.status(404).json({ message: "Controller not found" }); return; }
      const me = req.authenticatedUserId ? await storage.getUser(req.authenticatedUserId) : undefined;
      const actor = me ? { id: me.id, name: me.name } : undefined;
      let updated = ctrl;
      if (zoneCount !== undefined) {
        const result = await storage.setControllerZoneCount(cid, ctrl.id, zoneCount, actor);
        if (!result) { res.status(404).json({ message: "Not found" }); return; }
        updated = result.controller;
      }
      if (notes !== undefined) {
        const result = await storage.updateIrrigationController(cid, ctrl.id, { notes }, actor);
        if (!result) { res.status(404).json({ message: "Not found" }); return; }
        updated = result;
      }
      res.json({
        id: updated.id, companyId: updated.companyId, customerId: updated.customerId,
        branchName: branch || null, controllerLetter: updated.letter,
        zoneCount: updated.totalZones, notes: updated.notes ?? null,
      });
    } catch (error) {
      const { status, message } = deps.classifyAndLog(req, error, {
        op: "patchPropertyController", ctx: { cid, customerId, controllerLetter },
        fallbackMessage: "Couldn't save controller — please retry",
      });
      res.status(status).json({ message });
    }
  };
}

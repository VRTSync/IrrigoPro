// Task #1437 — Inspection work-order tech zone checklist routes.
//
// PATCH  /api/work-orders/:id/items/:itemId/complete  — toggle per-item done
// GET    /api/work-orders/:id/zone-photos             — list zone photos
// POST   /api/work-orders/:id/zone-photos             — attach a zone photo
// DELETE /api/work-orders/:id/zone-photos/:photoId    — remove a zone photo
//
// Extracted to a testable module (mirrors wet-check-photo-attach-route.ts) so
// the zone-tag write path (controllerLetter / zoneNumber / workOrderItemId
// survive Zod-parse → handler → storage.attachWorkOrderZonePhoto) and the
// field-tech assignment guard can be locked in by a route-level test without
// standing up the full registerRoutes() side effects.
//
// All routes sit behind requireSameCompanyAsWorkOrder, which scopes the work
// order to the caller's company and stashes it on req.tenantScopedWorkOrder.
// Field techs are additionally restricted to work orders assigned to them;
// manager-tier roles (already company-scoped) may edit any ticket in scope.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";

export const itemCompleteBody = z
  .object({
    completed: z.boolean(),
  })
  .strict();

export const zonePhotoBody = z.object({
  // Optional FK to the work-order item this photo documents. When supplied it
  // must belong to the same work order (enforced in storage).
  workOrderItemId: z.coerce.number().int().positive().nullish(),
  // Free zone tag so photos group by zone even without an item FK.
  controllerLetter: z.string().max(8).nullish(),
  zoneNumber: z.coerce.number().int().nullish(),
  // Canonical photoId from /api/upload/photo (e.g. "photos/<uuid>") or a URL.
  url: z.string().min(1),
  caption: z.string().nullish(),
  // Client capture time (ms or ISO). Falls back to NOW() when absent.
  takenAt: z.union([z.string().datetime(), z.number(), z.date()]).nullish(),
  // Offline idempotency key (UUIDv4).
  clientId: z.string().uuid().nullish(),
});

export interface RegisterWorkOrderZoneRouteDeps {
  requireAuthentication: RequestHandler;
  requireSameCompanyAsWorkOrder: RequestHandler;
}

// Field techs may only act on work orders assigned to them; other roles that
// passed the company-scope guard are allowed. Returns false (and writes a 403)
// when a field tech is not the assignee.
function ensureWorkOrderEditable(req: any, res: any): boolean {
  const role = req.authenticatedUserRole as string | undefined;
  if (role !== "field_tech") return true;
  const wo = req.tenantScopedWorkOrder as { assignedTechnicianId?: number | null } | undefined;
  const userId = req.authenticatedUserId;
  const userIdNum = typeof userId === "number" ? userId : parseInt(String(userId), 10);
  if (wo && Number.isFinite(userIdNum) && wo.assignedTechnicianId === userIdNum) {
    return true;
  }
  res.status(403).json({ message: "You can only update a work order assigned to you." });
  return false;
}

export function registerWorkOrderZoneRoutes(
  app: Express,
  deps: RegisterWorkOrderZoneRouteDeps,
): void {
  const { requireAuthentication, requireSameCompanyAsWorkOrder } = deps;

  // PATCH /api/work-orders/:id/items/:itemId/complete
  app.patch(
    "/api/work-orders/:id/items/:itemId/complete",
    requireAuthentication,
    requireSameCompanyAsWorkOrder,
    async (req: any, res: any) => {
      if (!ensureWorkOrderEditable(req, res)) return;
      const workOrderId = parseInt(req.params.id, 10);
      const itemId = parseInt(req.params.itemId, 10);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        res.status(400).json({ message: "Invalid item id" });
        return;
      }
      const parsed = itemCompleteBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
        return;
      }
      try {
        const updated = await storage.setWorkOrderItemCompletion(
          workOrderId,
          itemId,
          parsed.data.completed,
        );
        if (!updated) {
          res.status(404).json({ message: "Work order item not found" });
          return;
        }
        res.json(updated);
      } catch (e: any) {
        req.log?.error?.({ err: e, workOrderId, itemId }, "setWorkOrderItemCompletion failed");
        res.status(500).json({ message: "Couldn't update item — please retry" });
      }
    },
  );

  // GET /api/work-orders/:id/zone-photos
  app.get(
    "/api/work-orders/:id/zone-photos",
    requireAuthentication,
    requireSameCompanyAsWorkOrder,
    async (req: any, res: any) => {
      const workOrderId = parseInt(req.params.id, 10);
      try {
        const photos = await storage.getWorkOrderZonePhotos(workOrderId);
        res.json(photos);
      } catch (e: any) {
        req.log?.error?.({ err: e, workOrderId }, "getWorkOrderZonePhotos failed");
        res.status(500).json({ message: "Couldn't load photos — please retry" });
      }
    },
  );

  // POST /api/work-orders/:id/zone-photos
  app.post(
    "/api/work-orders/:id/zone-photos",
    requireAuthentication,
    requireSameCompanyAsWorkOrder,
    async (req: any, res: any) => {
      if (!ensureWorkOrderEditable(req, res)) return;
      const workOrderId = parseInt(req.params.id, 10);
      const takenBy = req.authenticatedUserId;
      if (!takenBy) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }
      const parsed = zonePhotoBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
        return;
      }
      const body = parsed.data;
      try {
        const takenAt =
          body.takenAt != null ? new Date(body.takenAt as string | number | Date) : new Date();
        const created = await storage.attachWorkOrderZonePhoto(workOrderId, {
          workOrderItemId: body.workOrderItemId ?? null,
          controllerLetter: body.controllerLetter ?? null,
          zoneNumber: body.zoneNumber ?? null,
          url: body.url,
          caption: body.caption ?? null,
          takenAt,
          takenBy,
          clientId: body.clientId ?? null,
        });
        res.status(201).json(created);
      } catch (e: any) {
        if (e?.code === "WORK_ORDER_ZONE_PHOTO_CLIENT_ID_COLLISION") {
          res.status(409).json({ message: e.message });
          return;
        }
        if (typeof e?.message === "string" && e.message.includes("does not belong to")) {
          res.status(400).json({ message: e.message });
          return;
        }
        req.log?.error?.({ err: e, workOrderId, clientId: body.clientId ?? null }, "attachWorkOrderZonePhoto failed");
        res.status(500).json({ message: "Couldn't attach photo — please retry" });
      }
    },
  );

  // DELETE /api/work-orders/:id/zone-photos/:photoId
  app.delete(
    "/api/work-orders/:id/zone-photos/:photoId",
    requireAuthentication,
    requireSameCompanyAsWorkOrder,
    async (req: any, res: any) => {
      if (!ensureWorkOrderEditable(req, res)) return;
      const workOrderId = parseInt(req.params.id, 10);
      const photoId = parseInt(req.params.photoId, 10);
      if (!Number.isFinite(photoId) || photoId <= 0) {
        res.status(400).json({ message: "Invalid photo id" });
        return;
      }
      try {
        const ok = await storage.deleteWorkOrderZonePhoto(photoId, workOrderId);
        if (!ok) {
          res.status(404).json({ message: "Photo not found" });
          return;
        }
        res.json({ ok });
      } catch (e: any) {
        req.log?.error?.({ err: e, workOrderId, photoId }, "deleteWorkOrderZonePhoto failed");
        res.status(500).json({ message: "Couldn't remove photo — please retry" });
      }
    },
  );
}

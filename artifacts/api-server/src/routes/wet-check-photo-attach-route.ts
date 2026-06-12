// Wet-check photo attach routes extracted from the routes.ts monolith.
//
// POST   /api/wet-checks/:id/photos      — attach a new photo (FK-anchored or loose)
// PATCH  /api/wet-checks/photos/:id      — link an existing photo to a finding
// DELETE /api/wet-checks/photos/:id      — remove a photo
//
// Extracted so the FK-anchor write path (zoneRecordId / findingId survive
// Zod-parse → handler → storage.attachWetCheckPhoto) can be locked in by a
// route-level regression test without standing up the full registerRoutes()
// side effects.  The test imports this module directly and monkey-patches the
// storage singleton; the production routes.ts simply calls
// registerWetCheckPhotoAttachRoutes(app, deps) in place of the former inline
// handlers.  See wet-check-photo-attach-regression.test.ts.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import {
  classifyWetCheckPhotoError,
  logPhotoErrorContext,
} from "./wet-check-photo-errors";

// ── Zod schemas ─────────────────────────────────────────────────────────────
// Exported so the regression test can import the REAL schema instead of
// copying it (which would mask future drift between the test and production).

export const photoBody = z.object({
  zoneRecordId: z.coerce.number().int().nullish(),
  findingId: z.coerce.number().int().nullish(),
  // Canonical photoId from /api/upload/photo (e.g. "photos/<uuid>"), or
  // a fully-qualified URL. Accepted as a non-empty string and validated at
  // the storage layer.
  url: z.string().min(1),
  caption: z.string().nullish(),
  // Client-supplied capture timestamp (ms or ISO). Falls back to NOW() in
  // the schema default if absent — preserves true camera time on offline sync.
  takenAt: z.union([z.string().datetime(), z.number(), z.date()]).nullish(),
  clientId: z.string().uuid().nullish(),
});

export const photoLinkBody = z.object({
  findingId: z.number().int().positive(),
}).strict();

// ── Dependency surface ───────────────────────────────────────────────────────
// auth + role helpers are closures inside registerRoutes; they're threaded
// in here rather than re-derived so tests can swap in lightweight stubs
// without mounting the full middleware stack.

export interface RegisterWetCheckPhotoRouteDeps {
  requireAuthentication: RequestHandler;
  requireCompanyId: (req: any, res: any) => number | null;
  isFieldRole: (role: string | undefined) => boolean;
  isWetCheckManagerRole: (role: string | undefined) => boolean;
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerWetCheckPhotoAttachRoutes(
  app: Express,
  deps: RegisterWetCheckPhotoRouteDeps,
): void {
  const { requireAuthentication, requireCompanyId, isFieldRole, isWetCheckManagerRole } = deps;

  // POST /api/wet-checks/:id/photos
  // Attaches a newly-uploaded photo to a wet check, optionally anchored to a
  // zone record and/or finding via zoneRecordId / findingId.  Both FKs are
  // optional (null = "loose photo") but when supplied they MUST belong to
  // the same wet check (enforced by storage.attachWetCheckPhoto).
  app.post("/api/wet-checks/:id/photos", requireAuthentication, async (req: any, res: any) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    if (!isFieldRole(req.authenticatedUserRole)) { res.status(403).json({ message: "Forbidden" }); return; }
    const parsed = photoBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ message: "Invalid body", issues: parsed.error.issues }); return; }
    const body = parsed.data;
    const takenBy = req.authenticatedUserId;
    if (!takenBy) { res.status(401).json({ message: "Authentication required" }); return; }
    const wetCheckId = parseInt(req.params.id);
    if (!Number.isFinite(wetCheckId)) {
      res.status(400).json({ message: "Invalid wet check id" });
      return;
    }
    try {
      const takenAt = body.takenAt != null ? new Date(body.takenAt as string | number | Date) : new Date();
      const created = await storage.attachWetCheckPhoto(wetCheckId, cid, {
        zoneRecordId: body.zoneRecordId ?? null,
        findingId: body.findingId ?? null,
        url: body.url,
        caption: body.caption ?? null,
        takenAt,
        takenBy,
        clientId: body.clientId ?? null,
      });
      res.status(201).json(created);
    } catch (e: any) {
      const { status, message } = classifyWetCheckPhotoError(e);
      logPhotoErrorContext(req, e, {
        op: "attachWetCheckPhoto",
        wetCheckId,
        photoClientId: body.clientId ?? null,
        zoneRecordId: body.zoneRecordId ?? null,
        findingId: body.findingId ?? null,
      });
      res.status(status).json({ message });
    }
  });

  // PATCH /api/wet-checks/photos/:id
  // Links an already-uploaded photo to a finding (post-hoc anchor, used by
  // the offline drain when the finding's server ID becomes known, and by
  // managers resolving loose photos in the review wizard).
  app.patch("/api/wet-checks/photos/:id", requireAuthentication, async (req: any, res: any) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    const role = req.authenticatedUserRole;
    if (!isFieldRole(role) && !isWetCheckManagerRole(role)) { res.status(403).json({ message: "Forbidden" }); return; }
    const parsed = photoLinkBody.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ message: "Invalid body", issues: parsed.error.issues }); return; }
    const photoId = parseInt(req.params.id);
    if (!Number.isFinite(photoId) || photoId <= 0) {
      res.status(400).json({ message: "Invalid photo id" });
      return;
    }
    try {
      const updated = await storage.linkWetCheckPhotoToFinding(
        photoId,
        parsed.data.findingId,
        cid,
      );
      if (!updated) { res.status(404).json({ message: "Not found" }); return; }
      res.json(updated);
    } catch (e: any) {
      const cls = classifyWetCheckPhotoError(e);
      const message = cls.status === 500 ? "Couldn't attach photo — please retry" : cls.message;
      logPhotoErrorContext(req, e, {
        op: "linkWetCheckPhotoToFinding",
        photoId,
        findingId: parsed.data.findingId,
      });
      res.status(cls.status).json({ message });
    }
  });

  // DELETE /api/wet-checks/photos/:id
  // Field roles use the standard path (editability guard enforced by storage).
  // Manager roles dispatch deleteLooseWetCheckPhotoAsManager which skips the
  // editability guard but only permits loose (unattached) photos.
  app.delete("/api/wet-checks/photos/:id", requireAuthentication, async (req: any, res: any) => {
    const cid = requireCompanyId(req, res); if (!cid) return;
    const role = req.authenticatedUserRole;
    const isManager = isWetCheckManagerRole(role);
    const isField = isFieldRole(role);
    if (!isField && !isManager) { res.status(403).json({ message: "Forbidden" }); return; }
    const photoId = parseInt(req.params.id);
    if (!Number.isFinite(photoId)) {
      res.status(400).json({ message: "Invalid photo id" });
      return;
    }
    try {
      const ok = isManager
        ? await storage.deleteLooseWetCheckPhotoAsManager(photoId, cid)
        : await storage.deleteWetCheckPhoto(photoId, cid);
      res.json({ ok });
    } catch (e: any) {
      const cls = classifyWetCheckPhotoError(e);
      const message = cls.status === 500 ? "Couldn't remove photo — please retry" : cls.message;
      logPhotoErrorContext(req, e, {
        op: isManager ? "deleteLooseWetCheckPhotoAsManager" : "deleteWetCheckPhoto",
        photoId,
      });
      res.status(cls.status).json({ message });
    }
  });
}

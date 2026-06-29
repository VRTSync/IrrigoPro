// Irrigation System Profile — Build 1 + Build 3: Route module.
//
// All routes are company-scoped (companyId from req.authenticatedUserCompanyId).
// super_admin gets cross-tenant access (companyId = null treated as bypass).
// Any row whose companyId doesn't match the caller returns 404 (not 403),
// matching the estimate cross-company ownership guard pattern.
//
// Routes:
//   GET    /api/customers/:customerId/controllers-profile
//   POST   /api/customers/:customerId/controllers-profile
//   GET    /api/irrigation-controllers/:id
//   PUT    /api/irrigation-controllers/:id
//   DELETE /api/irrigation-controllers/:id
//   POST   /api/irrigation-controllers/:id/programs
//   PUT    /api/irrigation-programs/:id
//   DELETE /api/irrigation-programs/:id
//   POST   /api/irrigation-controllers/:id/zones
//   PUT    /api/irrigation-zones/:id
//   DELETE /api/irrigation-zones/:id
//   GET    /api/irrigation-controllers/:id/history
//   POST   /api/irrigation-controllers/:id/photo
//   GET    /api/customers/:customerId/irrigation-profile/report-pdf  (Build 3)
//   POST   /api/customers/:customerId/irrigation-profile/report/send (Build 3)

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";

// ── Role helpers ──────────────────────────────────────────────────────────────

const MANAGER_ROLES = new Set([
  "company_admin",
  "super_admin",
  "irrigation_manager",
  "billing_manager",
]);

const WRITE_ROLES = new Set([
  "company_admin",
  "super_admin",
  "irrigation_manager",
  // field_tech: can create zones and attach photos (special-cased in handlers)
]);

function isManagerRole(role: string | undefined): boolean {
  return !!role && MANAGER_ROLES.has(role);
}

function canWrite(role: string | undefined): boolean {
  return !!role && (WRITE_ROLES.has(role) || role === "field_tech");
}

function isSuperAdmin(role: string | undefined): boolean {
  return role === "super_admin";
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const createControllerBody = z.object({
  name: z.string().min(1).max(200),
  branchName: z.string().optional(),
  location: z.string().nullish(),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  totalZones: z.coerce.number().int().nonnegative().nullish(),
  notes: z.string().nullish(),
  settingsPhotoUrl: z.string().nullish(),
  isActive: z.boolean().optional(),
});

export const updateControllerBody = createControllerBody.partial();

export const createProgramBody = z.object({
  name: z.string().min(1).max(100),
  wateringDays: z.array(z.string()).nullish(),
  startTimes: z.array(z.string()).nullish(),
  seasonalAdjustPct: z.coerce.number().int().min(0).max(500).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

export const updateProgramBody = createProgramBody.partial();

export const createZoneBody = z.object({
  zoneNumber: z.coerce.number().int().positive(),
  name: z.string().min(1).max(200),
  zoneType: z
    .enum(["pop_up_spray", "rotor", "drip", "netafim", "bubbler", "other"])
    .optional(),
  runTimeMinutes: z.coerce.number().int().nonnegative().optional(),
  zoneOrder: z.coerce.number().int().optional(),
  programId: z.coerce.number().int().positive().nullish(),
  isActive: z.boolean().optional(),
  notes: z.string().nullish(),
  overrideStartTime: z.string().nullish(),
  overrideDays: z.array(z.string()).nullish(),
});

export const updateZoneBody = createZoneBody.partial();

export const attachPhotoBody = z.object({
  url: z.string().min(1),
});

// ── Deps interface (injected so tests can swap requireAuthentication) ─────────

export interface IrrigationProfileRouteDeps {
  requireAuthentication: RequestHandler;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getCallerCompanyId(req: any): number | null {
  const cid = req.authenticatedUserCompanyId;
  return cid != null ? Number(cid) : null;
}

function badId(res: any, entity: string): void {
  res.status(400).json({ message: `Invalid ${entity} id` });
}

function notFound(res: any, entity: string): void {
  res.status(404).json({ message: `${entity} not found` });
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerIrrigationProfileRoutes(
  app: Express,
  deps: IrrigationProfileRouteDeps,
): void {
  const { requireAuthentication } = deps;

  // ── GET /api/customers/:customerId/controllers-profile ──────────────────────
  app.get(
    "/api/customers/:customerId/controllers-profile",
    requireAuthentication,
    async (req: any, res: any) => {
      const customerId = parseId(req.params.customerId);
      if (!customerId) return badId(res, "customer");

      const role = req.authenticatedUserRole as string | undefined;
      if (!isManagerRole(role) && role !== "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      // Company guard: verify the customer belongs to the caller's company.
      // super_admin can access any customer.
      if (!isSuperAdmin(role)) {
        if (!callerCompanyId) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const customer = await storage.getCustomer(customerId);
        if (!customer || customer.companyId !== callerCompanyId) {
          return notFound(res, "Customer");
        }
      }

      try {
        const branchName =
          typeof req.query.branchName === "string"
            ? req.query.branchName
            : undefined;

        let controllers = await storage.listIrrigationControllers(
          callerCompanyId,
          customerId,
          branchName,
        );

        // Lazy seed: when no irrigation profile exists yet for this customer/branch,
        // check if property_controllers has legacy data and bootstrap irrigation_controllers
        // from it. This is the automated forward-compat bridge so the profile page
        // shows controllers that were set up via the wet-check flow before unification.
        if (controllers.length === 0 && callerCompanyId !== null) {
          const legacyRows = await storage.listPropertyControllers(callerCompanyId, customerId);
          const branchFilter = branchName ?? "";
          const branchRows = legacyRows.filter((r) => (r.branchName ?? "") === branchFilter);
          if (branchRows.length > 0) {
            const count = branchRows.length;
            controllers = await storage.ensureIrrigationControllers(
              callerCompanyId,
              customerId,
              count,
              branchName ?? null,
            );
          }
        }

        res.json(controllers);
      } catch (e: any) {
        req.log?.error?.({ err: e, customerId }, "listIrrigationControllers failed");
        res.status(500).json({ message: "Could not load controllers — please retry" });
      }
    },
  );

  // ── POST /api/customers/:customerId/controllers-profile ─────────────────────
  app.post(
    "/api/customers/:customerId/controllers-profile",
    requireAuthentication,
    async (req: any, res: any) => {
      const customerId = parseId(req.params.customerId);
      if (!customerId) return badId(res, "customer");

      const role = req.authenticatedUserRole as string | undefined;
      if (!canWrite(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      // field_tech cannot create controllers (only zones and photos).
      if (role === "field_tech") {
        return res.status(403).json({ message: "Field technicians cannot create controllers" });
      }

      const callerCompanyId = getCallerCompanyId(req);
      if (!callerCompanyId && !isSuperAdmin(role)) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Customer ownership guard.
      if (!isSuperAdmin(role)) {
        const customer = await storage.getCustomer(customerId);
        if (!customer || customer.companyId !== callerCompanyId!) {
          return notFound(res, "Customer");
        }
      }

      const parsed = createControllerBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const companyIdForCreate = isSuperAdmin(role)
          ? (callerCompanyId ?? (await storage.getCustomer(customerId))?.companyId!)
          : callerCompanyId!;

        const controller = await storage.createIrrigationController({
          companyId: companyIdForCreate,
          customerId,
          branchName: parsed.data.branchName ?? "",
          name: parsed.data.name,
          location: parsed.data.location ?? null,
          brand: parsed.data.brand ?? null,
          model: parsed.data.model ?? null,
          totalZones: parsed.data.totalZones ?? null,
          notes: parsed.data.notes ?? null,
          settingsPhotoUrl: parsed.data.settingsPhotoUrl ?? null,
          isActive: parsed.data.isActive ?? true,
          lastUpdatedByUserId: me?.id ?? null,
          lastUpdatedByName: me?.name ?? null,
          lastUpdatedAt: new Date(),
        });
        res.status(201).json(controller);
      } catch (e: any) {
        req.log?.error?.({ err: e, customerId }, "createIrrigationController failed");
        res.status(500).json({ message: "Could not create controller — please retry" });
      }
    },
  );

  // ── GET /api/irrigation-controllers/:id ────────────────────────────────────
  app.get(
    "/api/irrigation-controllers/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      if (!isManagerRole(role) && role !== "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      try {
        const controller = await storage.getIrrigationController(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
        );
        if (!controller) return notFound(res, "Controller");
        res.json(controller);
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "getIrrigationController failed");
        res.status(500).json({ message: "Could not load controller — please retry" });
      }
    },
  );

  // ── PUT /api/irrigation-controllers/:id ────────────────────────────────────
  app.put(
    "/api/irrigation-controllers/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      if (!WRITE_ROLES.has(role ?? "") || role === "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);
      if (!callerCompanyId && !isSuperAdmin(role)) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const parsed = updateControllerBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const updated = await storage.updateIrrigationController(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
          { ...parsed.data },
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!updated) return notFound(res, "Controller");
        res.json(updated);
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "updateIrrigationController failed");
        res.status(500).json({ message: "Could not update controller — please retry" });
      }
    },
  );

  // ── DELETE /api/irrigation-controllers/:id ─────────────────────────────────
  app.delete(
    "/api/irrigation-controllers/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      if (!WRITE_ROLES.has(role ?? "") || role === "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      try {
        const ok = await storage.deleteIrrigationController(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
        );
        if (!ok) return notFound(res, "Controller");
        res.json({ ok: true });
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "deleteIrrigationController failed");
        res.status(500).json({ message: "Could not delete controller — please retry" });
      }
    },
  );

  // ── POST /api/irrigation-controllers/:id/programs ──────────────────────────
  app.post(
    "/api/irrigation-controllers/:id/programs",
    requireAuthentication,
    async (req: any, res: any) => {
      const controllerId = parseId(req.params.id);
      if (!controllerId) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      if (!WRITE_ROLES.has(role ?? "") || role === "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const parsed = createProgramBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const program = await storage.createIrrigationProgram(
          isSuperAdmin(role) ? null : callerCompanyId,
          controllerId,
          {
            name: parsed.data.name,
            wateringDays: parsed.data.wateringDays ?? null,
            startTimes: parsed.data.startTimes ?? null,
            seasonalAdjustPct: parsed.data.seasonalAdjustPct ?? 100,
            isActive: parsed.data.isActive ?? true,
            sortOrder: parsed.data.sortOrder ?? 0,
          },
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!program) return notFound(res, "Controller");
        res.status(201).json(program);
      } catch (e: any) {
        req.log?.error?.({ err: e, controllerId }, "createIrrigationProgram failed");
        res.status(500).json({ message: "Could not create program — please retry" });
      }
    },
  );

  // ── PUT /api/irrigation-programs/:id ──────────────────────────────────────
  app.put(
    "/api/irrigation-programs/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "program");

      const role = req.authenticatedUserRole as string | undefined;
      if (!WRITE_ROLES.has(role ?? "") || role === "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const parsed = updateProgramBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const updated = await storage.updateIrrigationProgram(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
          parsed.data,
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!updated) return notFound(res, "Program");
        res.json(updated);
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "updateIrrigationProgram failed");
        res.status(500).json({ message: "Could not update program — please retry" });
      }
    },
  );

  // ── DELETE /api/irrigation-programs/:id ───────────────────────────────────
  app.delete(
    "/api/irrigation-programs/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "program");

      const role = req.authenticatedUserRole as string | undefined;
      if (!WRITE_ROLES.has(role ?? "") || role === "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const ok = await storage.deleteIrrigationProgram(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!ok) return notFound(res, "Program");
        res.json({ ok: true });
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "deleteIrrigationProgram failed");
        res.status(500).json({ message: "Could not delete program — please retry" });
      }
    },
  );

  // ── POST /api/irrigation-controllers/:id/zones ─────────────────────────────
  app.post(
    "/api/irrigation-controllers/:id/zones",
    requireAuthentication,
    async (req: any, res: any) => {
      const controllerId = parseId(req.params.id);
      if (!controllerId) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      if (!canWrite(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const parsed = createZoneBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const zone = await storage.createIrrigationZone(
          isSuperAdmin(role) ? null : callerCompanyId,
          controllerId,
          {
            zoneNumber: parsed.data.zoneNumber,
            name: parsed.data.name,
            zoneType: parsed.data.zoneType ?? "other",
            runTimeMinutes: parsed.data.runTimeMinutes ?? 0,
            zoneOrder: parsed.data.zoneOrder ?? parsed.data.zoneNumber,
            programId: parsed.data.programId ?? null,
            isActive: parsed.data.isActive ?? true,
            notes: parsed.data.notes ?? null,
            overrideStartTime: parsed.data.overrideStartTime ?? null,
            overrideDays: parsed.data.overrideDays ?? null,
          },
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!zone) return notFound(res, "Controller");
        res.status(201).json(zone);
      } catch (e: any) {
        req.log?.error?.({ err: e, controllerId }, "createIrrigationZone failed");
        res.status(500).json({ message: "Could not create zone — please retry" });
      }
    },
  );

  // ── PUT /api/irrigation-zones/:id ─────────────────────────────────────────
  app.put(
    "/api/irrigation-zones/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "zone");

      const role = req.authenticatedUserRole as string | undefined;
      if (!canWrite(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (role === "field_tech") {
        return res.status(403).json({ message: "Field technicians cannot update zones" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const parsed = updateZoneBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const updated = await storage.updateIrrigationZone(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
          parsed.data,
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!updated) return notFound(res, "Zone");
        res.json(updated);
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "updateIrrigationZone failed");
        res.status(500).json({ message: "Could not update zone — please retry" });
      }
    },
  );

  // ── DELETE /api/irrigation-zones/:id ──────────────────────────────────────
  app.delete(
    "/api/irrigation-zones/:id",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "zone");

      const role = req.authenticatedUserRole as string | undefined;
      if (!WRITE_ROLES.has(role ?? "") || role === "field_tech") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const ok = await storage.deleteIrrigationZone(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!ok) return notFound(res, "Zone");
        res.json({ ok: true });
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "deleteIrrigationZone failed");
        res.status(500).json({ message: "Could not delete zone — please retry" });
      }
    },
  );

  // ── GET /api/irrigation-controllers/:id/history ────────────────────────────
  app.get(
    "/api/irrigation-controllers/:id/history",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      // History is read-only: all authenticated roles (including field_tech)
      // may view a controller's history within their company scope.
      if (!role) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);
      const scopedCompanyId = isSuperAdmin(role) ? null : callerCompanyId;

      try {
        // Verify the controller exists and belongs to the caller's company
        // before returning history — same guard pattern as GET controller.
        const ctrl = await storage.getIrrigationController(scopedCompanyId, id);
        if (!ctrl) return res.status(404).json({ message: "Controller not found" });

        const history = await storage.getIrrigationHistory(scopedCompanyId, id);
        res.json(history);
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "getIrrigationHistory failed");
        res.status(500).json({ message: "Could not load history — please retry" });
      }
    },
  );

  // ── POST /api/irrigation-controllers/:id/photo ─────────────────────────────
  // Attach a settings photo URL (already uploaded via /api/upload/photo) to
  // the controller's settingsPhotoUrl field.
  app.post(
    "/api/irrigation-controllers/:id/photo",
    requireAuthentication,
    async (req: any, res: any) => {
      const id = parseId(req.params.id);
      if (!id) return badId(res, "controller");

      const role = req.authenticatedUserRole as string | undefined;
      if (!canWrite(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      const parsed = attachPhotoBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
      }

      const userId = req.authenticatedUserId as number | undefined;
      const me = userId ? await storage.getUser(userId) : undefined;

      try {
        const updated = await storage.updateIrrigationController(
          isSuperAdmin(role) ? null : callerCompanyId,
          id,
          { settingsPhotoUrl: parsed.data.url },
          me ? { id: me.id, name: me.name } : undefined,
        );
        if (!updated) return notFound(res, "Controller");
        res.json(updated);
      } catch (e: any) {
        req.log?.error?.({ err: e, id }, "attachIrrigationControllerPhoto failed");
        res.status(500).json({ message: "Could not attach photo — please retry" });
      }
    },
  );

  // ── GET /api/customers/:customerId/irrigation-profile/report-pdf ────────────
  // Generates and streams a branded PDF for the customer's full irrigation
  // profile. Company-scoped; returns 404 on company mismatch.
  app.get(
    "/api/customers/:customerId/irrigation-profile/report-pdf",
    requireAuthentication,
    async (req: any, res: any) => {
      const customerId = parseId(req.params.customerId);
      if (!customerId) return badId(res, "customer");

      const role = req.authenticatedUserRole as string | undefined;
      if (!isManagerRole(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);

      // Company guard: verify customer belongs to caller's company.
      if (!isSuperAdmin(role)) {
        if (!callerCompanyId) {
          return res.status(401).json({ message: "Authentication required" });
        }
        const customer = await storage.getCustomer(customerId);
        if (!customer || customer.companyId !== callerCompanyId) {
          return notFound(res, "Customer");
        }
      }

      try {
        const customer = await storage.getCustomer(customerId);
        if (!customer) return notFound(res, "Customer");

        const companyId = isSuperAdmin(role)
          ? (customer.companyId ?? callerCompanyId)
          : callerCompanyId!;

        const ctrlList = await storage.listIrrigationControllers(companyId, customerId);
        const detailedControllers = await Promise.all(
          ctrlList.map((c: any) => storage.getIrrigationController(companyId, c.id)),
        );
        const validControllers = detailedControllers.filter(
          (c: any): c is NonNullable<typeof c> => c !== null,
        );

        const company = companyId ? await storage.getCompanyProfile(companyId) : null;

        const { renderIrrigationProfilePdf } = await import("../irrigation-profile-pdf");
        const pdf = await renderIrrigationProfilePdf(customer.name, validControllers, {
          company: company ?? null,
          propertyAddress: (customer as any).address ?? null,
        });

        const wantsDownload = String(req.query?.download ?? "") === "1";
        const safeCustomer = customer.name
          // eslint-disable-next-line no-control-regex
          .replace(/[\/\\:*?"<>|\x00-\x1f]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const date = new Date().toISOString().slice(0, 10);
        const filename = safeCustomer
          ? `${safeCustomer} - Irrigation Profile - ${date}.pdf`
          : `irrigation-profile-${customerId}-${date}.pdf`;
        // eslint-disable-next-line no-control-regex
        const asciiFilename = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
        const utf8Filename = encodeURIComponent(filename);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `${wantsDownload ? "attachment" : "inline"}; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`,
        );
        res.send(pdf);
      } catch (e: any) {
        req.log?.error?.({ err: e, customerId }, "irrigationProfileReportPdf failed");
        res.status(500).json({ message: "Failed to generate irrigation profile PDF" });
      }
    },
  );

  // ── POST /api/customers/:customerId/irrigation-profile/report/send ──────────
  // Generates the irrigation profile PDF and emails it to the customer.
  // Company-scoped; returns 404 on company mismatch.
  app.post(
    "/api/customers/:customerId/irrigation-profile/report/send",
    requireAuthentication,
    async (req: any, res: any) => {
      const customerId = parseId(req.params.customerId);
      if (!customerId) return badId(res, "customer");

      const role = req.authenticatedUserRole as string | undefined;
      if (!isManagerRole(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const callerCompanyId = getCallerCompanyId(req);
      if (!isSuperAdmin(role) && !callerCompanyId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      try {
        const customer = await storage.getCustomer(customerId);
        if (!customer) return notFound(res, "Customer");
        if (!isSuperAdmin(role) && customer.companyId !== callerCompanyId) {
          return notFound(res, "Customer");
        }

        const companyId = isSuperAdmin(role)
          ? (customer.companyId ?? callerCompanyId!)
          : callerCompanyId!;

        // Determine recipient: explicit override or customer email on file.
        const { to } = req.body ?? {};
        let toEmail: string | null =
          typeof to === "string" && to.trim() ? to.trim() : null;
        if (!toEmail) toEmail = (customer as any).email ?? null;
        if (!toEmail) {
          return res.status(422).json({
            message:
              "No email address on file for this customer. Provide a 'to' email.",
          });
        }

        const ctrlList = await storage.listIrrigationControllers(companyId, customerId);
        const detailedControllers = await Promise.all(
          ctrlList.map((c: any) => storage.getIrrigationController(companyId, c.id)),
        );
        const validControllers = detailedControllers.filter(
          (c: any): c is NonNullable<typeof c> => c !== null,
        );

        const company = await storage.getCompanyProfile(companyId);

        const { renderIrrigationProfilePdf } = await import("../irrigation-profile-pdf");
        const pdf = await renderIrrigationProfilePdf(customer.name, validControllers, {
          company: company ?? null,
          propertyAddress: (customer as any).address ?? null,
        });

        const { EmailService } = await import("../email-service");
        await EmailService.sendIrrigationProfileReport({
          to: toEmail,
          customerName: customer.name,
          propertyAddress: (customer as any).address ?? null,
          companyName: company?.name ?? "IrrigoPro",
          companyEmail: company?.email ?? null,
          companyPhone: company?.phone ?? null,
          pdfBuffer: pdf,
          customerId,
        });

        res.json({ sent: true, to: toEmail });
      } catch (e: any) {
        req.log?.error?.({ err: e, customerId }, "irrigationProfileReportSend failed");
        res
          .status(500)
          .json({ message: e?.message ?? "Failed to send irrigation profile report" });
      }
    },
  );
}

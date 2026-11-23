import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod/v4";
import { insertAssemblySchema, insertAssemblyPartSchema, type InsertAssemblyPart } from "@workspace/db";
import { storage } from "../storage";

// Match the write roles for the parts catalog.
const ASSEMBLY_WRITE_ROLES = new Set(["company_admin", "super_admin", "billing_manager", "irrigation_manager"]);

function scopeOf(req: Request): number | null {
  // requireAuthentication rejects company-less tenant users.
  return req.authenticatedUserRole === "super_admin" ? null : req.authenticatedUserCompanyId!;
}

function canWrite(req: Request): boolean {
  return ASSEMBLY_WRITE_ROLES.has(req.authenticatedUserRole!);
}

async function loadOwned(req: Request, res: Response, id: number) {
  const scope = scopeOf(req);
  const assembly = await storage.getAssembly(id);
  if (!assembly || (scope !== null && assembly.companyId !== scope)) {
    res.status(404).json({ message: "Assembly not found" });
    return;
  }
  return assembly;
}

async function assertPartsInCompany(partsData: InsertAssemblyPart[], companyId: number): Promise<boolean> {
  if (partsData.length === 0) return true;
  const allowedIds = new Set((await storage.getParts(companyId)).map((part) => part.id));
  return partsData.every((part) => allowedIds.has(part.partId));
}

export interface RegisterAssemblyRoutesDeps {
  requireAuthentication: RequestHandler;
}

export function registerAssemblyRoutes(
  app: Express,
  { requireAuthentication }: RegisterAssemblyRoutesDeps,
): void {
  app.get("/api/assemblies", requireAuthentication, async (req, res) => {
    try {
      let companyId = scopeOf(req);
      if (companyId === null) {
        const requestedCompanyId = req.query.companyId;
        if (requestedCompanyId === undefined) {
          res.json([]);
          return;
        }
        companyId = typeof requestedCompanyId === "string" ? Number(requestedCompanyId) : NaN;
        if (!Number.isSafeInteger(companyId) || companyId <= 0) {
          res.status(400).json({ message: "Invalid company ID" });
          return;
        }
      }
      const assemblies = await storage.getAssemblies(companyId);
      res.json(assemblies);
    } catch (error) {
      console.error("Error fetching assemblies:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to fetch assemblies" });
    }
  });

  app.get("/api/assemblies/:id", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid assembly ID" });
        return;
      }
      const assembly = await loadOwned(req, res, id);
      if (!assembly) return;
      res.json(assembly);
    } catch (error) {
      console.error("Error fetching assembly:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to fetch assembly" });
    }
  });

  app.post("/api/assemblies", requireAuthentication, async (req, res) => {
    if (!canWrite(req)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    try {
      const { assembly, parts } = req.body;
      const companyId = req.authenticatedUserRole === "super_admin"
        ? assembly?.companyId
        : req.authenticatedUserCompanyId;
      if (companyId == null) {
        res.status(400).json({ message: "Select a company" });
        return;
      }
      const assemblyData = insertAssemblySchema.parse({
        ...assembly,
        companyId,
        createdBy: req.authenticatedUserId,
      });
      const partsData = z.array(insertAssemblyPartSchema).parse(parts);
      if (!await assertPartsInCompany(partsData, assemblyData.companyId)) {
        res.status(400).json({ message: "Every part must belong to this company" });
        return;
      }
      const createdAssembly = await storage.createAssembly(assemblyData, partsData);
      res.status(201).json(createdAssembly);
    } catch (error) {
      console.error("Error creating assembly:", error instanceof Error ? error.message : error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid assembly data", errors: error.issues });
        return;
      }
      res.status(500).json({ message: "Failed to create assembly" });
    }
  });

  app.put("/api/assemblies/:id", requireAuthentication, async (req, res) => {
    if (!canWrite(req)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid assembly ID" });
        return;
      }
      const existing = await loadOwned(req, res, id);
      if (!existing) return;
      const { assembly, parts } = req.body;
      const assemblyData = insertAssemblySchema.partial().omit({ companyId: true, createdBy: true }).parse(assembly);
      const partsData = z.array(insertAssemblyPartSchema).optional().parse(parts);
      if (partsData && !await assertPartsInCompany(partsData, existing.companyId)) {
        res.status(400).json({ message: "Every part must belong to this company" });
        return;
      }
      const updatedAssembly = await storage.updateAssembly(id, assemblyData, partsData);
      if (!updatedAssembly) {
        res.status(404).json({ message: "Assembly not found" });
        return;
      }
      res.json(updatedAssembly);
    } catch (error) {
      console.error("Error updating assembly:", error instanceof Error ? error.message : error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid assembly data", errors: error.issues });
        return;
      }
      res.status(500).json({ message: "Failed to update assembly" });
    }
  });

  app.delete("/api/assemblies/:id", requireAuthentication, async (req, res) => {
    if (!canWrite(req)) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid assembly ID" });
        return;
      }
      const existing = await loadOwned(req, res, id);
      if (!existing) return;
      const success = await storage.deleteAssembly(id);
      if (!success) {
        res.status(404).json({ message: "Assembly not found" });
        return;
      }
      res.json({ message: "Assembly deleted successfully" });
    } catch (error) {
      console.error("Error deleting assembly:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to delete assembly" });
    }
  });

  app.post("/api/assemblies/:id/track-usage", requireAuthentication, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid assembly ID" });
        return;
      }
      const existing = await loadOwned(req, res, id);
      if (!existing) return;
      await storage.trackAssemblyUsage(existing.companyId, id);
      res.json({ message: "Assembly usage tracked successfully" });
    } catch (error) {
      console.error("Error tracking assembly usage:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to track assembly usage" });
    }
  });
}

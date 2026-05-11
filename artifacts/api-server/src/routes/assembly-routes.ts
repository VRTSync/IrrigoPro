// Assembly routes — extracted from routes.ts as part of Task #446. Behavior
// is byte-for-byte identical to the previous inline definitions.

import type { Express, RequestHandler } from "express";
import { z } from "zod/v4";
import { insertAssemblySchema, insertAssemblyPartSchema } from "@workspace/db";
import { storage } from "../storage";

export interface RegisterAssemblyRoutesDeps {
  requireAuthentication: RequestHandler;
}

export function registerAssemblyRoutes(
  app: Express,
  { requireAuthentication }: RegisterAssemblyRoutesDeps,
): void {
  app.get("/api/assemblies", requireAuthentication, async (req, res) => {
    try {
      const companyId = req.authenticatedUserCompanyId || 1;
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
      const assembly = await storage.getAssembly(id);
      if (!assembly) {
        res.status(404).json({ message: "Assembly not found" });
        return;
      }
      res.json(assembly);
    } catch (error) {
      console.error("Error fetching assembly:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to fetch assembly" });
    }
  });

  app.post("/api/assemblies", requireAuthentication, async (req, res) => {
    try {
      const { assembly, parts } = req.body;
      const assemblyData = insertAssemblySchema.parse({
        ...assembly,
        companyId: req.authenticatedUserCompanyId || assembly.companyId || 1,
        createdBy: req.authenticatedUserId || assembly.createdBy || 1,
      });
      const partsData = (parts as unknown[]).map((p) => insertAssemblyPartSchema.parse(p));
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
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid assembly ID" });
        return;
      }
      const { assembly, parts } = req.body;
      const assemblyData = insertAssemblySchema.partial().parse(assembly);
      const partsData = parts ? (parts as unknown[]).map((p) => insertAssemblyPartSchema.parse(p)) : undefined;
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
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid assembly ID" });
        return;
      }
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
      const companyId = req.authenticatedUserCompanyId || 1;
      await storage.trackAssemblyUsage(companyId, id);
      res.json({ message: "Assembly usage tracked successfully" });
    } catch (error) {
      console.error("Error tracking assembly usage:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Failed to track assembly usage" });
    }
  });
}

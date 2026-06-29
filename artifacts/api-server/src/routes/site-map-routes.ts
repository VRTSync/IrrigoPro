// Site map routes — extracted from routes.ts as part of Task #446 to make the
// routes layer easier to navigate. Behavior is byte-for-byte identical to the
// previous inline definitions; this file just narrows the surface so each
// route domain lives in its own module.

import type { Express, RequestHandler } from "express";
import { z } from "zod/v4";
import { insertSiteMapSchema } from "@workspace/db";
import { storage } from "../storage";

export interface RegisterSiteMapRoutesDeps {
  requireAuthentication: RequestHandler;
  requireSiteMapViewAccess: RequestHandler;
  requireCompanyAdminAccess: RequestHandler;
}

export function registerSiteMapRoutes(
  app: Express,
  { requireAuthentication, requireSiteMapViewAccess, requireCompanyAdminAccess }: RegisterSiteMapRoutesDeps,
): void {
  // Get all site maps (for overview display)
  app.get("/api/site-maps", requireAuthentication, requireSiteMapViewAccess, async (_req, res) => {
    try {
      const siteMaps = await storage.getAllSiteMaps();
      res.json(siteMaps);
    } catch (error) {
      console.error("Error fetching all site maps:", error);
      res.status(500).json({ message: "Failed to fetch site maps" });
    }
  });

  app.get("/api/customers/:customerId/site-maps", requireAuthentication, requireSiteMapViewAccess, async (req: any, res) => {
    try {
      const customerId = parseInt(String(req.params.customerId));

      // Company scoping: verify the customer belongs to the caller's company
      // before returning any site maps. Super admins can read across companies.
      const callerCompanyId = req.authenticatedUserCompanyId;
      const callerRole = req.authenticatedUserRole;
      if (callerRole !== 'super_admin' && callerCompanyId != null) {
        const customer = await storage.getCustomer(customerId);
        if (!customer || customer.companyId !== callerCompanyId) {
          // Return 404 rather than 403 so we don't reveal whether the
          // customer exists in another tenant.
          res.status(404).json({ message: "Customer not found" });
          return;
        }
      }

      const siteMaps = await storage.getCustomerSiteMaps(customerId);
      res.json(siteMaps);
    } catch (error) {
      console.error("Error fetching customer site maps:", error);
      res.status(500).json({ message: "Failed to fetch customer site maps" });
    }
  });

  app.get("/api/site-maps/:siteMapId/controllers", requireAuthentication, requireSiteMapViewAccess, async (req: any, res) => {
    try {
      const siteMapId = parseInt(String(req.params.siteMapId));

      // Company scoping: verify the site map belongs to the caller's company.
      const callerCompanyId = req.authenticatedUserCompanyId;
      const callerRole = req.authenticatedUserRole;
      if (callerRole !== 'super_admin' && callerCompanyId != null) {
        const siteMap = await storage.getSiteMap(siteMapId);
        if (!siteMap || siteMap.companyId !== callerCompanyId) {
          res.status(404).json({ message: "Site map not found" });
          return;
        }
      }

      const controllers = await storage.getSiteMapControllers(siteMapId);
      res.json(controllers);
    } catch (error) {
      console.error("Error fetching site map controllers:", error);
      res.status(500).json({ message: "Failed to fetch site map controllers" });
    }
  });

  app.get("/api/site-maps/:siteMapId/zones", requireAuthentication, requireSiteMapViewAccess, async (req: any, res) => {
    try {
      const siteMapId = parseInt(String(req.params.siteMapId));

      // Company scoping: verify the site map belongs to the caller's company.
      const callerCompanyId = req.authenticatedUserCompanyId;
      const callerRole = req.authenticatedUserRole;
      if (callerRole !== 'super_admin' && callerCompanyId != null) {
        const siteMap = await storage.getSiteMap(siteMapId);
        if (!siteMap || siteMap.companyId !== callerCompanyId) {
          res.status(404).json({ message: "Site map not found" });
          return;
        }
      }

      const zones = await storage.getSiteMapZones(siteMapId);
      res.json(zones);
    } catch (error) {
      console.error("Error fetching site map zones:", error);
      res.status(500).json({ message: "Failed to fetch site map zones" });
    }
  });

  app.post("/api/customers/:customerId/site-maps", requireAuthentication, requireCompanyAdminAccess, async (req: any, res) => {
    try {
      const customerId = parseInt(String(req.params.customerId));

      // Get user's company ID - production-ready approach
      let companyId = req.userCompanyId; // Set by middleware if using session

      // Fallback to header-based approach for development
      if (!companyId) {
        const userCompanyId = req.headers['x-user-company-id'];
        companyId = userCompanyId ? parseInt(userCompanyId as string) : null;
      }

      if (!companyId) {
        res.status(400).json({
          message: "User company information not available"
        });
        return;
      }

      // Validate the request body
      const validatedData = insertSiteMapSchema.parse({
        ...req.body,
        customerId,
        companyId // Use the authenticated user's company ID
      });

      const siteMap = await storage.createSiteMap(validatedData);
      res.status(201).json(siteMap);
    } catch (error) {
      console.error("Error creating site map:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Invalid site map data",
          errors: error.issues
        });
        return;
      }
      res.status(500).json({ message: "Failed to create site map" });
    }
  });

  app.put("/api/site-maps/:siteMapId", requireAuthentication, requireCompanyAdminAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(String(req.params.siteMapId));

      // Validate the request body
      const validatedData = insertSiteMapSchema.partial().parse(req.body);

      const siteMap = await storage.updateSiteMap(siteMapId, validatedData);
      if (!siteMap) {
        res.status(404).json({ message: "Site map not found" });
        return;
      }

      res.json(siteMap);
    } catch (error) {
      console.error("Error updating site map:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({
          message: "Invalid site map data",
          errors: error.issues
        });
        return;
      }
      res.status(500).json({ message: "Failed to update site map" });
    }
  });

  app.delete("/api/site-maps/:siteMapId", requireAuthentication, requireCompanyAdminAccess, async (req, res) => {
    try {
      const siteMapId = parseInt(String(req.params.siteMapId));
      const success = await storage.deleteSiteMap(siteMapId);

      if (!success) {
        res.status(404).json({ message: "Site map not found" });
        return;
      }

      res.json({ message: "Site map deleted successfully" });
    } catch (error) {
      console.error("Error deleting site map:", error);
      res.status(500).json({ message: "Failed to delete site map" });
    }
  });

  app.post("/api/site-maps/:siteMapId/controllers", requireAuthentication, requireCompanyAdminAccess, async (req: any, res) => {
    try {
      const siteMapId = parseInt(String(req.params.siteMapId));
      const controllers = req.body.controllers;

      if (!Array.isArray(controllers)) {
        res.status(400).json({ message: "Controllers must be an array" });
        return;
      }

      // Get user's company ID - production-ready approach
      let companyId = req.userCompanyId; // Set by middleware if using session

      // Fallback to header-based approach for development
      if (!companyId) {
        const userCompanyId = req.headers['x-user-company-id'];
        companyId = userCompanyId ? parseInt(userCompanyId as string) : null;
      }

      if (!companyId) {
        res.status(400).json({
          message: "User company information not available"
        });
        return;
      }

      const savedControllers = await storage.saveControllers(siteMapId, controllers, companyId);
      res.json(savedControllers);
    } catch (error) {
      console.error("Error saving controllers:", error);
      res.status(500).json({ message: "Failed to save controllers" });
    }
  });

  app.post("/api/site-maps/:siteMapId/zones", requireAuthentication, requireCompanyAdminAccess, async (req: any, res) => {
    try {
      const siteMapId = parseInt(String(req.params.siteMapId));
      const zones = req.body.zones;

      if (!Array.isArray(zones)) {
        res.status(400).json({ message: "Zones must be an array" });
        return;
      }

      // Get user's company ID - production-ready approach
      let companyId = req.userCompanyId; // Set by middleware if using session

      // Fallback to header-based approach for development
      if (!companyId) {
        const userCompanyId = req.headers['x-user-company-id'];
        companyId = userCompanyId ? parseInt(userCompanyId as string) : null;
      }

      if (!companyId) {
        res.status(400).json({
          message: "User company information not available"
        });
        return;
      }

      const savedZones = await storage.saveZones(siteMapId, zones, companyId);
      res.json(savedZones);
    } catch (error) {
      console.error("Error saving zones:", error);
      res.status(500).json({ message: "Failed to save zones" });
    }
  });
}

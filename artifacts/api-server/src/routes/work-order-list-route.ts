// Thin extracted module for GET /api/work-orders tenant-isolation.
//
// Exports registerWorkOrderListRoute() so the route handler's callerCompanyId
// derivation and storage call can be integration-tested without spinning up
// the full registerRoutes() monolith (which requires a live Postgres).
//
// The production routes.ts still registers its own version of this route. This
// module exists only to provide a test-injectable surface; it mirrors the exact
// callerCompanyId derivation used in routes.ts.

import type { Express, RequestHandler } from "express";

export interface WorkOrderListStorage {
  getWorkOrders(companyId: number | null): Promise<{ id: number; [k: string]: unknown }[]>;
}

/**
 * Registers GET /api/work-orders on `app` using `storage.getWorkOrders`.
 *
 * callerCompanyId derivation (mirrors routes.ts):
 *   - super_admin  → null  (unscoped: sees all companies)
 *   - everyone else → req.authenticatedUserCompanyId ?? null
 */
export function registerWorkOrderListRoute(
  app: Express,
  storage: WorkOrderListStorage,
  requireAuthentication: RequestHandler,
): void {
  app.get("/api/work-orders", requireAuthentication, async (req: any, res) => {
    try {
      const callerCompanyId: number | null =
        req.authenticatedUserRole === "super_admin"
          ? null
          : (req.authenticatedUserCompanyId ?? null);

      const workOrders = await storage.getWorkOrders(callerCompanyId);
      res.json(workOrders);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch work orders" });
    }
  });
}

// Tenant guard for single-ID work-order routes.
//
// Extracted from routes.ts so the middleware can be imported directly by
// behavioral tests without dragging in the 16 000-line registerRoutes monolith.
//
// Usage in routes.ts:
//   import { makeRequireSameCompanyAsWorkOrder } from "./work-order-tenant-guard";
//   const requireSameCompanyAsWorkOrder = makeRequireSameCompanyAsWorkOrder(storage);
//
// Usage in tests: pass in-memory stubs that satisfy StorageForTenantGuard.

export interface StorageForTenantGuard {
  getWorkOrder(id: number): Promise<{ id: number; customerId: number | null } | null | undefined>;
  getCustomer(id: number): Promise<{ companyId: number | null } | null | undefined>;
}

export function makeRequireSameCompanyAsWorkOrder(storage: StorageForTenantGuard) {
  return async function requireSameCompanyAsWorkOrder(
    req: any,
    res: any,
    next: any,
  ): Promise<void> {
    const role = req.authenticatedUserRole as string | undefined;
    if (role === 'super_admin') {
      return next();
    }

    const rawId = req.params.id;
    const workOrderId = parseInt(rawId, 10);
    if (!Number.isFinite(workOrderId) || workOrderId <= 0) {
      res.status(400).json({ message: "Invalid work order ID" });
      return;
    }

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    let woCompanyId: number | null = null;
    if (workOrder.customerId) {
      const customer = await storage.getCustomer(workOrder.customerId);
      woCompanyId = customer?.companyId ?? null;
    }

    if (woCompanyId == null) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    const callerCompanyId = req.authenticatedUserCompanyId as number | null | undefined;
    if (!callerCompanyId || Number(callerCompanyId) !== Number(woCompanyId)) {
      console.warn(
        `[AUDIT-TENANT-MISMATCH] workOrderId=${workOrderId} callerCompanyId=${callerCompanyId ?? 'none'} ` +
        `woCompanyId=${woCompanyId} role=${role ?? 'none'} url=${req.method} ${req.path}`,
      );
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    req.tenantScopedWorkOrder = workOrder;
    next();
  };
}

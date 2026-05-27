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
//
// Slice 4: reads companyId directly from the work_orders.company_id column
// instead of joining through customers. The getCustomer round-trip has been
// removed; the interface no longer requires it.

export interface StorageForTenantGuard {
  getWorkOrder(id: number, companyId: number | null): Promise<{ id: number; customerId: number | null; companyId: number | null } | null | undefined>;
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

    // Derive caller scope before the storage read so the DB query is scoped
    // at the storage layer (defense in depth; the subsequent company-match
    // check remains as an application-level safety net).
    const callerCompanyId = req.authenticatedUserCompanyId as number | null | undefined;

    const workOrder = await storage.getWorkOrder(workOrderId, callerCompanyId ?? null);
    if (!workOrder) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }

    // Slice 4: read companyId directly from the work order row — no
    // secondary customer lookup needed.
    const woCompanyId = workOrder.companyId ?? null;

    if (woCompanyId == null) {
      res.status(404).json({ message: "Work order not found" });
      return;
    }
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

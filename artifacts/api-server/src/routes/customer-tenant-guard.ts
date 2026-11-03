// Tenant guard for single-customer routes (Customer Records Slice 2a).
// Injectable storage keeps behavioral tests independent of route registration.
import type { Customer } from "@workspace/db";

export interface StorageForCustomerTenantGuard {
  getCustomer(id: number): Promise<Customer | undefined>;
}

export function makeRequireCustomerInTenant(storage: StorageForCustomerTenantGuard) {
  return async function requireCustomerInTenant(req: any, res: any, next: any): Promise<void> {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: "Invalid customer ID" });
      return;
    }
    try {
      const customer = await storage.getCustomer(id);
      if (!customer) { res.status(404).json({ message: "Customer not found" }); return; }
      if (req.authenticatedUserRole !== "super_admin") {
        const callerCompanyId = req.authenticatedUserCompanyId as number | null | undefined;
        if (!callerCompanyId || Number(callerCompanyId) !== Number(customer.companyId)) {
          console.warn(
            `[AUDIT] cross_tenant_customer_access actor=${req.authenticatedUserId} ` +
            `actorCompany=${callerCompanyId ?? "none"} targetCustomer=${id} ` +
            `targetCompany=${customer.companyId} route=${req.method} ${req.path}`,
          );
          res.status(404).json({ message: "Customer not found" });
          return;
        }
      }
      req.tenantScopedCustomer = customer;
      next();
    } catch (error) {
      console.error("customer tenant guard failed:", error);
      res.status(500).json({ message: "Failed to load customer" });
    }
  };
}

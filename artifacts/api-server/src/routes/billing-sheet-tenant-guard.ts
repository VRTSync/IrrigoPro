// Tenant guard for single-ID billing-sheet routes.
//
// Extracted from routes.ts so the middleware can be imported directly by
// behavioral tests without dragging in the 16 000-line registerRoutes monolith.
//
// Usage in routes.ts:
//   import { makeRequireSameCompanyAsBillingSheet } from "./billing-sheet-tenant-guard";
//   const requireSameCompanyAsBillingSheet = makeRequireSameCompanyAsBillingSheet(storage);
//
// Usage in tests: pass in-memory stubs that satisfy StorageForBillingSheetTenantGuard.
//
// Until Slice 4 lands the billing_sheets.companyId column, the row's tenant is
// read through customerId → customers.companyId.

export interface StorageForBillingSheetTenantGuard {
  getBillingSheetById(id: number): Promise<{ id: number; customerId: number | null } | null | undefined>;
  getCustomer(id: number): Promise<{ companyId: number | null } | null | undefined>;
}

export function makeRequireSameCompanyAsBillingSheet(storage: StorageForBillingSheetTenantGuard) {
  return async function requireSameCompanyAsBillingSheet(
    req: any,
    res: any,
    next: any,
  ): Promise<void> {
    const role = req.authenticatedUserRole as string | undefined;
    if (role === 'super_admin') {
      return next();
    }

    const rawId = req.params.id;
    const billingSheetId = parseInt(rawId, 10);
    if (!Number.isFinite(billingSheetId) || billingSheetId <= 0) {
      res.status(400).json({ message: "Invalid billing sheet ID" });
      return;
    }

    const billingSheet = await storage.getBillingSheetById(billingSheetId);
    if (!billingSheet) {
      res.status(404).json({ message: "Billing sheet not found" });
      return;
    }

    let bsCompanyId: number | null = null;
    if (billingSheet.customerId) {
      const customer = await storage.getCustomer(billingSheet.customerId);
      bsCompanyId = customer?.companyId ?? null;
    }

    if (bsCompanyId == null) {
      // A billing sheet with no resolvable tenant cannot be served safely to a
      // non-super-admin. Treat as 404 — never reveal existence outside the caller's tenant.
      res.status(404).json({ message: "Billing sheet not found" });
      return;
    }

    const callerCompanyId = req.authenticatedUserCompanyId as number | null | undefined;
    if (!callerCompanyId || Number(callerCompanyId) !== Number(bsCompanyId)) {
      console.warn(
        `[AUDIT] cross_tenant_billing_sheet_access ` +
        `actor=${req.authenticatedUserId} actorCompany=${callerCompanyId ?? 'none'} ` +
        `targetBillingSheet=${billingSheetId} targetCompany=${bsCompanyId} ` +
        `route=${req.method} ${req.path}`,
      );
      res.status(404).json({ message: "Billing sheet not found" });
      return;
    }

    req.tenantScopedBillingSheet = billingSheet;
    next();
  };
}

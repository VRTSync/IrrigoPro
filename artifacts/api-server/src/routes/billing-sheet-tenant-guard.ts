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
// Slice 4: reads companyId directly from the billing_sheets.company_id column
// instead of joining through customers. The getCustomer round-trip has been
// removed; the interface no longer requires it.

export interface StorageForBillingSheetTenantGuard {
  getBillingSheetById(id: number, companyId: number | null): Promise<{ id: number; customerId: number | null; companyId: number | null } | null | undefined>;
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

    // Derive caller scope before the storage read so the DB query is scoped
    // at the storage layer (defense in depth; the subsequent company-match
    // check remains as an application-level safety net).
    const callerCompanyId = req.authenticatedUserCompanyId as number | null | undefined;

    const billingSheet = await storage.getBillingSheetById(billingSheetId, callerCompanyId ?? null);
    if (!billingSheet) {
      res.status(404).json({ message: "Billing sheet not found" });
      return;
    }

    // Slice 4: read companyId directly from the billing sheet row — no
    // secondary customer lookup needed.
    const bsCompanyId = billingSheet.companyId ?? null;

    if (bsCompanyId == null) {
      // A billing sheet with no resolvable tenant cannot be served safely to a
      // non-super-admin. Treat as 404 — never reveal existence outside the caller's tenant.
      res.status(404).json({ message: "Billing sheet not found" });
      return;
    }
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

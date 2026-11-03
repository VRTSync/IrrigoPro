// Customer CRUD routes — extracted from routes.ts as part of Task #446.
// Covers POST create, PUT/PATCH update, PATCH /labor-rates, and DELETE.

import type { Express, Request, RequestHandler } from "express";
import { z } from "zod/v4";
import { insertCustomerSchema } from "@workspace/db";
import { withDbRetry } from "@workspace/db";
import { storage } from "../storage";
import { getCustomerRecordsLock } from "../lib/customer-records-lock";
import { changedLockedFields, customerRecordsLabel, QB_OWNED_CUSTOMER_FIELDS } from "@workspace/shared";
import {
  applyMonthOverride,
  generateBudgetMonths,
  validateCurve,
} from "../services/generate-budget-months";

// companyId and quickbooksId are server-owned. Body values are dropped.
export const createCustomerSchema = insertCustomerSchema.omit({ quickbooksId: true });
export const updateCustomerSchema = insertCustomerSchema.omit({ companyId: true, quickbooksId: true }).partial();

export interface RegisterCustomerRoutesDeps {
  requireAuthentication: RequestHandler;
  requireCompanyAdminAccess: RequestHandler;
  requireCustomerEditAccess: RequestHandler;
  requireCustomerInTenant: RequestHandler;
  applyBillingNotesVisibility: <T>(req: Request, data: T) => T;
}

function extractPgFields(error: unknown): {
  pgCode: string | null;
  pgMessage: string | null;
  pgDetail: string | null;
} {
  const cause = (error as { cause?: { code?: string; message?: string; detail?: string } })?.cause;
  return {
    pgCode: cause?.code ?? null,
    pgMessage: cause?.message ?? null,
    pgDetail: cause?.detail ?? null,
  };
}

export function registerCustomerRoutes(
  app: Express,
  {
    requireAuthentication,
    requireCompanyAdminAccess,
    requireCustomerEditAccess,
    requireCustomerInTenant,
    applyBillingNotesVisibility,
  }: RegisterCustomerRoutesDeps,
): void {
  app.post("/api/customers", requireAuthentication, requireCompanyAdminAccess, async (req, res) => {
    try {
      const budgetYear = Number.isInteger(req.body?.budgetYear) ? req.body.budgetYear : new Date().getFullYear();
      const budgetMonthOverrides = req.body?.budgetMonthOverrides as
        | Record<string, string | number>
        | undefined;
      const companyId = req.authenticatedUserCompanyId;
      if (!companyId) {
        res.status(403).json({ message: "Forbidden: user has no company association" });
        return;
      }
      const lock = await getCustomerRecordsLock(companyId);
      if (lock.locked) {
        res.status(403).json({ code: "CUSTOMER_RECORDS_LOCKED", message: `New customers are added in ${customerRecordsLabel(lock.systemName)}.` });
        return;
      }
      if (Array.isArray(req.body?.budgetSeasonCurveOverride)) validateCurve(req.body.budgetSeasonCurveOverride);
      let customerData = createCustomerSchema.parse({ ...req.body, companyId });
      // Only billing_manager may set billingNotes at creation time
      if ('billingNotes' in customerData && req.authenticatedUserRole !== 'billing_manager') {
        const { billingNotes, ...rest } = customerData;
        customerData = rest as typeof customerData;
      }
      const customer = await storage.createCustomer(customerData);
      if (customer.annualBudgetGoal != null || customer.budgetSeasonCurveOverride != null) {
        await generateBudgetMonths(customer.id, budgetYear);
      }
      if (budgetMonthOverrides) {
        for (const [monthText, rawAmount] of Object.entries(budgetMonthOverrides)) {
          const month = parseInt(monthText, 10);
          const amount = parseFloat(String(rawAmount).replace(/[$,\s]/g, ""));
          if (Number.isInteger(month) && month >= 1 && month <= 12 &&
              Number.isFinite(amount) && amount >= 0) {
            await applyMonthOverride({ customerId: customer.id, year: budgetYear, month, amount });
          }
        }
      }
      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid customer data", errors: error.issues });
        return;
      }
      const { pgCode, pgMessage, pgDetail } = extractPgFields(error);
      req.log.error({ err: error, pgCode, pgMessage, pgDetail, route: "POST /api/customers" }, "customer write failed");
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", requireAuthentication, requireCustomerEditAccess, requireCustomerInTenant, async (req, res) => {
    try {
      const id = req.tenantScopedCustomer!.id;
      const budgetYear = Number.isInteger(req.body?.budgetYear)
        ? req.body.budgetYear
        : new Date().getFullYear();
      const budgetMonthOverrides = req.body?.budgetMonthOverrides as
        | Record<string, string | number>
        | undefined;
      const hasBudgetFields =
        "annualBudgetGoal" in (req.body ?? {}) ||
        "budgetSeasonCurveOverride" in (req.body ?? {});
      if (Array.isArray(req.body?.budgetSeasonCurveOverride)) {
        validateCurve(req.body.budgetSeasonCurveOverride);
      }
      let customerData = updateCustomerSchema.parse(req.body);
      // Only billing_manager may write billingNotes (use authenticated role, not raw header)
      if ('billingNotes' in customerData && req.authenticatedUserRole !== 'billing_manager') {
        const { billingNotes, ...rest } = customerData;
        customerData = rest;
      }
      const current = req.tenantScopedCustomer!;
      const lock = await getCustomerRecordsLock(current.companyId);
      if (lock.locked) {
        const changed = changedLockedFields(current as Record<string, unknown>, customerData as Record<string, unknown>);
        if (changed.length > 0) {
          const label = customerRecordsLabel(lock.systemName);
          res.status(409).json({ code: "CUSTOMER_RECORDS_LOCKED", lockedFields: changed,
            message: `${changed.join(", ")} ${changed.length === 1 ? "is" : "are"} managed in ${label}. Edit ${changed.length === 1 ? "it" : "them"} there.` });
          return;
        }
        for (const f of QB_OWNED_CUSTOMER_FIELDS) delete (customerData as Record<string, unknown>)[f];
      }
      // An unchanged full form can become empty after removing owned keys.
      // Drizzle rejects an empty SET; return the guarded row without a write.
      const customer = lock.locked && Object.keys(customerData).length === 0
        ? current
        : await withDbRetry(() => storage.updateCustomer(id, customerData));
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      if (hasBudgetFields) {
        await generateBudgetMonths(id, budgetYear);
      }
      if (budgetMonthOverrides) {
        for (const [monthText, rawAmount] of Object.entries(budgetMonthOverrides)) {
          const month = parseInt(monthText, 10);
          const amount = parseFloat(String(rawAmount).replace(/[$,\s]/g, ""));
          if (Number.isInteger(month) && month >= 1 && month <= 12 &&
              Number.isFinite(amount) && amount >= 0) {
            await applyMonthOverride({ customerId: id, year: budgetYear, month, amount });
          }
        }
      }
      res.json(applyBillingNotesVisibility(req, customer));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid customer data", errors: error.issues });
        return;
      }
      const { pgCode, pgMessage, pgDetail } = extractPgFields(error);
      req.log.error({ err: error, pgCode, pgMessage, pgDetail, route: "PUT /api/customers/:id" }, "customer write failed");
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.patch("/api/customers/:id", requireAuthentication, requireCustomerEditAccess, requireCustomerInTenant, async (req, res) => {
    try {
      const id = req.tenantScopedCustomer!.id;
      const budgetYear = Number.isInteger(req.body?.budgetYear) ? req.body.budgetYear : new Date().getFullYear();
      const hasBudgetFields =
        "annualBudgetGoal" in (req.body ?? {}) ||
        "budgetSeasonCurveOverride" in (req.body ?? {});
      if (Array.isArray(req.body?.budgetSeasonCurveOverride)) validateCurve(req.body.budgetSeasonCurveOverride);
      let customerData = updateCustomerSchema.parse(req.body);
      // Only billing_manager may write billingNotes (use authenticated role, not raw header)
      if ('billingNotes' in customerData && req.authenticatedUserRole !== 'billing_manager') {
        const { billingNotes, ...rest } = customerData;
        customerData = rest;
      }
      const current = req.tenantScopedCustomer!;
      const lock = await getCustomerRecordsLock(current.companyId);
      if (lock.locked) {
        const changed = changedLockedFields(current as Record<string, unknown>, customerData as Record<string, unknown>);
        if (changed.length > 0) {
          const label = customerRecordsLabel(lock.systemName);
          res.status(409).json({ code: "CUSTOMER_RECORDS_LOCKED", lockedFields: changed,
            message: `${changed.join(", ")} ${changed.length === 1 ? "is" : "are"} managed in ${label}. Edit ${changed.length === 1 ? "it" : "them"} there.` });
          return;
        }
        for (const f of QB_OWNED_CUSTOMER_FIELDS) delete (customerData as Record<string, unknown>)[f];
      }
      const customer = lock.locked && Object.keys(customerData).length === 0
        ? current
        : await withDbRetry(() => storage.updateCustomer(id, customerData));
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      if (hasBudgetFields) await generateBudgetMonths(id, budgetYear);
      res.json(applyBillingNotesVisibility(req, customer));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid customer data", errors: error.issues });
        return;
      }
      const { pgCode, pgMessage, pgDetail } = extractPgFields(error);
      req.log.error({ err: error, pgCode, pgMessage, pgDetail, route: "PATCH /api/customers/:id" }, "customer write failed");
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.patch("/api/customers/:id/labor-rates", requireAuthentication, requireCustomerInTenant, async (req, res) => {
    try {
      if (req.authenticatedUserRole !== 'company_admin') {
        res.status(403).json({ message: "Access denied. Labor rate changes are restricted to company administrators." });
        return;
      }
      const id = req.tenantScopedCustomer!.id;
      const laborRateSchema = z.object({
        laborRate: z.union([z.string(), z.number()]).optional(),
        emergencyLaborRate: z.union([z.string(), z.number()]).optional(),
      });
      const parsed = laborRateSchema.parse(req.body);
      const updateData: { laborRate?: string; emergencyLaborRate?: string } = {};
      if (parsed.laborRate !== undefined) updateData.laborRate = String(parsed.laborRate);
      if (parsed.emergencyLaborRate !== undefined) updateData.emergencyLaborRate = String(parsed.emergencyLaborRate);
      const customer = await withDbRetry(() => storage.updateCustomer(id, updateData));
      if (!customer) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      res.json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid labor rate data", errors: error.issues });
        return;
      }
      const { pgCode, pgMessage, pgDetail } = extractPgFields(error);
      req.log.error({ err: error, pgCode, pgMessage, pgDetail, route: "PATCH /api/customers/:id/labor-rates" }, "customer write failed");
      res.status(500).json({ message: "Failed to update labor rates" });
    }
  });

  app.delete("/api/customers/:id", requireAuthentication, requireCompanyAdminAccess, requireCustomerInTenant, async (req, res) => {
    try {
      const id = req.tenantScopedCustomer!.id;
      const current = req.tenantScopedCustomer!;
      const lock = await getCustomerRecordsLock(current.companyId);
      if (lock.locked && (current.quickbooksId ?? "").trim() !== "") {
        res.status(409).json({ code: "CUSTOMER_RECORDS_LOCKED",
          message: `This customer comes from QuickBooks. It can't be deleted in IrrigoPro while customer details are managed in ${customerRecordsLabel(lock.systemName)}.` });
        return;
      }
      const success = await withDbRetry(() => storage.deleteCustomer(id));
      if (!success) {
        res.status(404).json({ message: "Customer not found" });
        return;
      }
      res.json({ message: "Customer deleted successfully" });
    } catch (error) {
      const { pgCode, pgMessage, pgDetail } = extractPgFields(error);
      req.log.error({ err: error, pgCode, pgMessage, pgDetail, route: "DELETE /api/customers/:id" }, "customer write failed");
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });
}

// Task #687 — Financial Pulse Slice 1.
//
// GET /api/customers/:id/budget-usage — read-only visibility endpoint
// powering the "Budget & Alerts" card on the customer profile and the
// live preview in the customer-edit form. Out of scope here: firing the
// alerts themselves (Slice 2) and the /financial-pulse page (Slice 3).

import type { Express, RequestHandler } from "express";
import {
  computePeriodUsage,
  getMonthWindow,
  getPeriodKeys,
  getYearWindow,
} from "../budget-status";
import { storage } from "../storage";
import { getRecentBudgetAlertEvents } from "../services/budget-alert-service";

export interface RegisterBudgetRoutesDeps {
  requireAuthentication: RequestHandler;
}

// Slice 1 spec: only super_admin / company_admin / billing_manager can
// see a customer's budget usage. irrigation_manager is intentionally
// NOT in this set — they get pricing data but not budget signals.
const VISIBILITY_ROLES = new Set([
  "super_admin",
  "company_admin",
  "billing_manager",
]);

function parseDecimal(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

export function registerBudgetRoutes(
  app: Express,
  { requireAuthentication }: RegisterBudgetRoutesDeps,
): void {
  app.get(
    "/api/customers/:id/budget-usage",
    requireAuthentication,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ message: "Invalid customer id" });
          return;
        }

        const role = req.authenticatedUserRole as string | undefined;
        if (!role || !VISIBILITY_ROLES.has(role)) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }

        const customer = await storage.getCustomer(id);
        if (!customer) {
          res.status(404).json({ message: "Customer not found" });
          return;
        }

        // Multi-tenant guard — only super_admin can read across companies.
        const callerCompanyId = req.authenticatedUserCompanyId as
          | number
          | null
          | undefined;
        if (role !== "super_admin" && callerCompanyId !== customer.companyId) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }

        const now = new Date();
        const { monthKey, yearKey } = getPeriodKeys(now);
        const monthWin = getMonthWindow(now);
        const yearWin = getYearWindow(now);

        // Pull all invoices for this customer once and bucket in JS —
        // the per-customer list is small enough that the extra
        // round-trip of two separate SUMs isn't worth the storage
        // method churn. Bucket by `createdAt` to match the canonical
        // dashboard "This Month Billed" rollup
        // (`getThisMonthBilledForCompany`) so the two surfaces always
        // agree on what counts as "this month".
        const invoices = await storage.getInvoicesByCustomer(id, role === 'super_admin' ? null : (callerCompanyId ?? null));

        let monthSpend = 0;
        let yearSpend = 0;
        for (const inv of invoices) {
          if (inv.status === "draft" || inv.status === "cancelled" || inv.status === "superseded") continue;
          const total = parseDecimal(inv.totalAmount) ?? 0;
          const when = inv.createdAt instanceof Date
            ? inv.createdAt
            : new Date(inv.createdAt as unknown as string);
          if (when >= yearWin.start && when < yearWin.end) {
            yearSpend += total;
            if (when >= monthWin.start && when < monthWin.end) {
              monthSpend += total;
            }
          }
        }

        const soft = customer.budgetSoftThresholdPercent ?? 75;
        const hard = customer.budgetHardThresholdPercent ?? 100;
        const monthly = computePeriodUsage(
          parseDecimal(customer.monthlyBudgetCap),
          monthSpend,
          soft,
          hard,
          monthKey,
        );
        const annual = computePeriodUsage(
          parseDecimal(customer.annualBudgetCap),
          yearSpend,
          soft,
          hard,
          yearKey,
        );

        // Flat response shape — slice 1 contract:
        //   customerId, softThresholdPercent, hardThresholdPercent,
        //   currentMonthKey, currentYearKey,
        //   monthly{Cap,Spend,Percent,Status},
        //   annual{Cap,Spend,Percent,Status}
        res.json({
          customerId: id,
          softThresholdPercent: soft,
          hardThresholdPercent: hard,
          currentMonthKey: monthKey,
          currentYearKey: yearKey,
          monthlyCap: monthly.cap,
          monthlySpend: monthly.spend,
          monthlyPercent: monthly.percent,
          monthlyStatus: monthly.status,
          annualCap: annual.cap,
          annualSpend: annual.spend,
          annualPercent: annual.percent,
          annualStatus: annual.status,
        });
      } catch (error) {
        console.error("Error computing budget usage:", error);
        res.status(500).json({ message: "Failed to compute budget usage" });
      }
    },
  );

  // Task #693 — Financial Pulse Slice 4.
  // Recent budget alert events for the "Recent Budget Alerts" section
  // on the customer profile. Same visibility roles + multi-tenant
  // guard as /budget-usage above.
  app.get(
    "/api/customers/:id/budget-alert-events",
    requireAuthentication,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id) || id <= 0) {
          res.status(400).json({ message: "Invalid customer id" });
          return;
        }

        const role = req.authenticatedUserRole as string | undefined;
        if (!role || !VISIBILITY_ROLES.has(role)) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }

        const customer = await storage.getCustomer(id);
        if (!customer) {
          res.status(404).json({ message: "Customer not found" });
          return;
        }

        const callerCompanyId = req.authenticatedUserCompanyId as
          | number
          | null
          | undefined;
        if (role !== "super_admin" && callerCompanyId !== customer.companyId) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }

        const rawLimit = parseInt(String(req.query.limit ?? "20"), 10);
        const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
        const events = await getRecentBudgetAlertEvents(id, limit);
        res.json({ customerId: id, events });
      } catch (error) {
        console.error("Error loading budget alert events:", error);
        res
          .status(500)
          .json({ message: "Failed to load budget alert events" });
      }
    },
  );
}

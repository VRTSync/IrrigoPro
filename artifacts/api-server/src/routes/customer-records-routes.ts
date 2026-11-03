import type { Express, RequestHandler } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { companies } from "@workspace/db/schema";
import { db } from "../db";
import { storage } from "../storage";
import { getCustomerRecordsLock } from "../lib/customer-records-lock";
import { recordAuditEvent } from "./audit-log";

const settingsSchema = z.object({
  locked: z.boolean(),
  systemName: z.string().max(60).nullable(),
}).strict();

async function quickbooksConnected(companyId: number): Promise<boolean> {
  return (await storage.getQuickBooksIntegrationByCompanyId(String(companyId)))?.connectionStatus === "connected";
}

export function registerCustomerRecordsRoutes(
  app: Express,
  deps: { requireAuthentication: RequestHandler },
): void {
  app.get("/api/company/customer-records", deps.requireAuthentication, async (req, res) => {
    try {
      const companyId = req.authenticatedUserCompanyId;
      if (companyId == null) {
        res.json({ locked: false, systemName: null, quickbooksConnected: false });
        return;
      }
      res.json({ ...await getCustomerRecordsLock(companyId), quickbooksConnected: await quickbooksConnected(companyId) });
    } catch (err) {
      req.log.error({ err }, "customer records settings read failed");
      res.status(500).json({ message: "Failed to fetch customer records settings" });
    }
  });

  app.put("/api/company/:companyId/customer-records", deps.requireAuthentication, async (req, res) => {
    const companyId = Number(req.params.companyId);
    if (req.authenticatedUserRole !== "company_admin" || req.authenticatedUserCompanyId !== companyId) {
      res.status(403).json({ message: "Access denied. Company admins can only manage their own company settings." });
      return;
    }
    try {
      const parsed = settingsSchema.parse(req.body);
      const to = { locked: parsed.locked, systemName: parsed.systemName?.trim() || null };
      const from = await getCustomerRecordsLock(companyId);
      const connected = await quickbooksConnected(companyId);
      if (to.locked && !from.locked && !connected) {
        res.status(409).json({ message: "Connect QuickBooks before locking customer details. While locked, customers can only arrive from QuickBooks." });
        return;
      }
      if (from.locked !== to.locked || from.systemName !== to.systemName) {
        await db.update(companies).set({
          customerRecordsLocked: to.locked,
          customerRecordsSystemName: to.systemName,
          updatedAt: new Date(),
        }).where(eq(companies.id, companyId));
        await recordAuditEvent(req, {
          actorUserId: req.authenticatedUserId,
          actorRole: req.authenticatedUserRole,
          actorCompanyId: companyId,
          action: "company.customer_records_lock_changed",
          targetType: "company",
          targetId: String(companyId),
          summary: from.locked !== to.locked
            ? (to.locked ? "Customer records locked" : "Customer records unlocked")
            : "Customer records system name changed",
          details: { from, to },
        });
      }
      res.json({ ...to, quickbooksConnected: connected });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid settings" });
        return;
      }
      req.log.error({ err }, "customer records settings write failed");
      res.status(500).json({ message: "Failed to update customer records settings" });
    }
  });
}

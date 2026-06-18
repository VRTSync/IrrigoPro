// Task #1438 — Record manual delivery of an invoice.
//
// POST /api/invoices/:id/mark-sent   — flip a draft invoice to `sent` and
//   stamp `sentAt = now()`. Does NOT email anything; it only records that
//   the invoice was delivered out-of-band (printed, hand-delivered, sent
//   from a personal mailbox). Only `draft` invoices are eligible.
// POST /api/invoices/:id/mark-unsent — undo a mistaken mark-sent: revert a
//   `sent` invoice back to `draft` and clear `sentAt`. Only valid from
//   `sent`.
//
// Both are company-scoped (getInvoiceById under the caller's company) and
// role-guarded by requireBillingAccess (company_admin / billing_manager).
// Extracted into its own module so the handlers can be mounted against
// in-memory storage stubs in tests without standing up the whole
// routes.ts monolith.

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";

export interface RegisterInvoiceMarkSentRoutesDeps {
  requireAuthentication: RequestHandler;
  requireBillingAccess: RequestHandler;
}

export function registerInvoiceMarkSentRoutes(
  app: Express,
  { requireAuthentication, requireBillingAccess }: RegisterInvoiceMarkSentRoutesDeps,
): void {
  app.post(
    "/api/invoices/:id/mark-sent",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid invoice ID" });
          return;
        }
        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);
        const invoice = await storage.getInvoiceById(id, callerCompanyId);
        if (!invoice) {
          res.status(404).json({ message: "Invoice not found" });
          return;
        }
        if (invoice.status !== "draft") {
          res
            .status(400)
            .json({ message: "Only draft invoices can be marked as sent" });
          return;
        }
        const updated = await storage.updateInvoice(id, {
          status: "sent",
          sentAt: new Date(),
        });
        res.json(updated);
      } catch (error) {
        console.error("Invoice mark-sent error:", error);
        res.status(500).json({ message: "Failed to mark invoice as sent" });
      }
    },
  );

  app.post(
    "/api/invoices/:id/mark-unsent",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid invoice ID" });
          return;
        }
        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);
        const invoice = await storage.getInvoiceById(id, callerCompanyId);
        if (!invoice) {
          res.status(404).json({ message: "Invoice not found" });
          return;
        }
        if (invoice.status !== "sent") {
          res
            .status(400)
            .json({ message: "Only sent invoices can be marked unsent" });
          return;
        }
        const updated = await storage.updateInvoice(id, {
          status: "draft",
          sentAt: null,
        });
        res.json(updated);
      } catch (error) {
        console.error("Invoice mark-unsent error:", error);
        res.status(500).json({ message: "Failed to mark invoice as unsent" });
      }
    },
  );
}

// Task #1443 — Resync a (merged) invoice to QuickBooks.
//
// POST /api/invoices/:id/sync-quickbooks — a billing-capable user pushes a
// single app invoice's current (merged) totals/line items into QuickBooks as
// a fresh CREATE. Two modes, gated by the invoice's existing
// `quickbooksInvoiceId`:
//   - null id  → "Sync to QuickBooks": create normally, no confirm.
//   - has id   → "Re-sync to QuickBooks": only with `{ force: true }`. The old
//                QB invoice (deleted by hand in QuickBooks — manual by design)
//                is NOT touched; a NEW QB invoice is created and the stored id
//                is overwritten. A non-forced call here is rejected to prevent
//                an accidental double-create.
//
// The actual QB create + persistence is injected as `createQuickBooksInvoice`
// (it lives in routes.ts as a closure with access to the QuickBooks request
// helpers). This module owns the HTTP shape, role guard, company scope, and
// the force-gating so it can be unit-tested with storage spies + a stubbed
// create function — no QuickBooks calls in the test path.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";

// Thrown by the injected create function for precondition / QuickBooks
// failures so the route can map them to a clear HTTP status + message.
export class InvoiceSyncError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = "InvoiceSyncError";
    this.httpStatus = httpStatus;
  }
}

export const syncInvoiceQbSchema = z
  .object({ force: z.boolean().optional() })
  .strict();

export interface SyncInvoiceResult {
  quickbooksId?: string;
}

export interface RegisterInvoiceSyncQuickbooksRoutesDeps {
  requireAuthentication: RequestHandler;
  requireBillingAccess: RequestHandler;
  // Creates a fresh QB invoice from the app invoice's current line items and
  // persists the new id. Throws InvoiceSyncError on a precondition (customer
  // not synced, no billable lines, QB not connected) or QuickBooks failure.
  createQuickBooksInvoice: (
    invoiceId: number,
    opts: { callerCompanyId: number | null },
  ) => Promise<SyncInvoiceResult>;
}

export function registerInvoiceSyncQuickbooksRoutes(
  app: Express,
  {
    requireAuthentication,
    requireBillingAccess,
    createQuickBooksInvoice,
  }: RegisterInvoiceSyncQuickbooksRoutesDeps,
): void {
  app.post(
    "/api/invoices/:id/sync-quickbooks",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid invoice id." });
        return;
      }

      const parsed = syncInvoiceQbSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          message: "Invalid request body.",
          errors: parsed.error.flatten(),
        });
        return;
      }
      const force = parsed.data.force === true;

      const callerCompanyId: number | null =
        req.authenticatedUserRole === "super_admin"
          ? null
          : (req.authenticatedUserCompanyId ?? null);

      try {
        const invoice = await storage.getInvoiceById(id, callerCompanyId);
        if (!invoice) {
          res.status(404).json({ message: "Invoice not found." });
          return;
        }

        // Re-sync guard: an invoice that already carries a QB id may only be
        // pushed again with an explicit force (the confirmed "Re-sync" path).
        // This prevents an accidental second QB invoice from a stray click.
        if (invoice.quickbooksInvoiceId && !force) {
          res.status(409).json({
            message:
              "This invoice is already linked to a QuickBooks invoice. Delete the old one in QuickBooks, then re-sync.",
            code: "already_synced",
          });
          return;
        }

        const result = await createQuickBooksInvoice(id, { callerCompanyId });
        res.json({
          success: true,
          quickbooksId: result.quickbooksId,
          message: "Invoice synced to QuickBooks successfully",
        });
      } catch (err) {
        if (err instanceof InvoiceSyncError) {
          res.status(err.httpStatus).json({ message: err.message });
          return;
        }
        req.log?.error?.({ err }, "invoice QuickBooks sync failed");
        res.status(500).json({ message: "Failed to sync invoice to QuickBooks." });
      }
    },
  );
}

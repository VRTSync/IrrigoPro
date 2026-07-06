// Task #1710 — Invoice Correction & Reissue (Guided Dispute Flow)
//
// Implements the full correction lifecycle:
//   POST   /api/invoice-corrections           — open a draft correction
//   PATCH  /api/invoice-corrections/:id       — update reason/evidence/reviewed state
//   POST   /api/invoice-corrections/:id/reissue  — create corrected invoice (-R1)
//   POST   /api/invoice-corrections/:id/qb-sync  — resync QB (stubbed, 501)
//   POST   /api/invoice-corrections/:id/cancel   — cancel a draft correction
//   GET    /api/invoice-corrections/:id           — fetch correction with lines
//   GET    /api/invoices/:invoiceId/correction-tickets — tickets on this invoice
//
// Core architectural invariant: edits always write to source tickets; the
// reissued invoice re-derives totals from live ticket data. No values are
// pushed backward from the invoice.
//
// Ticket unlock: an already-invoiced billing sheet can be edited (totals
// adjusted) while there is an open `draft` correction that references its
// invoice. The guard is enforced inline in the PATCH billing-sheet-items
// handler via storage.getOpenCorrectionForInvoice. Outside that context the
// existing billed-lock stands.

import type { Express, RequestHandler } from "express";
import { z } from "zod/v4";
import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import {
  invoiceCorrections,
  invoiceCorrectionLines,
  invoices,
  invoiceItems,
  billingSheets,
  workOrders,
  wetCheckBillings,
} from "@workspace/db/schema";
import { storage } from "../storage";

export interface RegisterInvoiceCorrectionRoutesDeps {
  requireAuthentication: RequestHandler;
  requireBillingAccess: RequestHandler;
}

// ── Validation schemas ──────────────────────────────────────────────────────

const openCorrectionSchema = z.object({
  invoiceId: z.number().int().positive(),
});

const REASON_CATEGORIES = [
  "customer_dispute",
  "pricing_error",
  "duplicate_charge",
  "goodwill_credit",
  "scope_change",
  "tech_error",
  "other",
] as const;

const REQUEST_SOURCES = [
  "email",
  "phone",
  "in_person",
  "sms",
  "other",
] as const;

const CORRECTION_LINE_ACTIONS = ["zero_line", "adjust", "exclude"] as const;

const updateCorrectionSchema = z.object({
  status: z.enum(["draft", "reviewed"]).optional(),
  reasonCategory: z.enum(REASON_CATEGORIES).optional(),
  requestSource: z.enum(REQUEST_SOURCES).optional(),
  requestedBy: z.string().max(200).optional(),
  approvedByUserId: z.number().int().positive().optional().nullable(),
  reasonDetail: z.string().max(2000).optional(),
  evidenceUrl: z.string().url().optional().nullable(),
  evidenceNote: z.string().max(1000).optional(),
  lines: z
    .array(
      z.object({
        ticketType: z.enum(["billing_sheet", "work_order", "wcb"]),
        ticketId: z.number().int().positive(),
        beforeParts: z.string().optional(),
        beforeLabor: z.string().optional(),
        beforeTotal: z.string().optional(),
        afterParts: z.string().optional(),
        afterLabor: z.string().optional(),
        afterTotal: z.string().optional(),
        action: z.enum(CORRECTION_LINE_ACTIONS),
        lineNote: z.string().max(500).optional(),
      }),
    )
    .optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Derive the next revision suffix for an invoice number. */
export function deriveRevisionNumber(invoiceNumber: string): string {
  const match = invoiceNumber.match(/^(.*)-R(\d+)$/);
  if (match) {
    return `${match[1]}-R${parseInt(match[2]) + 1}`;
  }
  return `${invoiceNumber}-R1`;
}

/** Sum ticket totals from live invoice items. */
async function computeLiveTotalsFromTickets(
  invoiceId: number,
  excludedTickets: Array<{ ticketType: string; ticketId: number }>,
): Promise<{ partsSubtotal: number; laborSubtotal: number; totalAmount: number }> {
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId));

  let parts = 0;
  let labor = 0;

  for (const item of items) {
    const isExcluded = excludedTickets.some(
      (e) =>
        (e.ticketType === "billing_sheet" && e.ticketId === item.billingSheetId) ||
        (e.ticketType === "work_order" && e.ticketId === item.workOrderId) ||
        (e.ticketType === "wcb" && e.ticketId === item.wetCheckBillingId),
    );
    if (isExcluded) continue;

    if (item.sourceType === "billing_sheet" && item.billingSheetId) {
      const bs = await db
        .select({ partsSubtotal: billingSheets.partsSubtotal, laborSubtotal: billingSheets.laborSubtotal })
        .from(billingSheets)
        .where(eq(billingSheets.id, item.billingSheetId))
        .limit(1);
      if (bs[0]) {
        parts += parseFloat(bs[0].partsSubtotal ?? "0");
        labor += parseFloat(bs[0].laborSubtotal ?? "0");
      }
    } else if (item.sourceType === "work_order" && item.workOrderId) {
      const wo = await db
        .select({ partsSubtotal: workOrders.partsSubtotal, laborSubtotal: workOrders.laborSubtotal })
        .from(workOrders)
        .where(eq(workOrders.id, item.workOrderId))
        .limit(1);
      if (wo[0]) {
        parts += parseFloat(String(wo[0].partsSubtotal ?? "0"));
        labor += parseFloat(String(wo[0].laborSubtotal ?? "0"));
      }
    } else if (item.sourceType === "wet_check_billing" && item.wetCheckBillingId) {
      const wcb = await db
        .select({ partsSubtotal: wetCheckBillings.partsSubtotal, laborSubtotal: wetCheckBillings.laborSubtotal })
        .from(wetCheckBillings)
        .where(eq(wetCheckBillings.id, item.wetCheckBillingId))
        .limit(1);
      if (wcb[0]) {
        parts += parseFloat(String(wcb[0].partsSubtotal ?? "0"));
        labor += parseFloat(String(wcb[0].laborSubtotal ?? "0"));
      }
    }
  }

  return {
    partsSubtotal: parts,
    laborSubtotal: labor,
    totalAmount: parts + labor,
  };
}

// ── Route registration ────────────────────────────────────────────────────

export function registerInvoiceCorrectionRoutes(
  app: Express,
  { requireAuthentication, requireBillingAccess }: RegisterInvoiceCorrectionRoutesDeps,
): void {
  // ── GET /api/invoices/:invoiceId/correction-tickets ─────────────────────
  // Returns the tickets (billing sheets, work orders, wet check billings)
  // associated with an invoice, formatted for the Dispute step selector.
  app.get(
    "/api/invoices/:invoiceId/correction-tickets",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const invoiceId = parseInt(String(req.params.invoiceId));
        if (isNaN(invoiceId) || invoiceId <= 0) {
          res.status(400).json({ message: "Invalid invoice ID" });
          return;
        }
        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);

        const invoice = await storage.getInvoiceById(invoiceId, callerCompanyId);
        if (!invoice) {
          res.status(404).json({ message: "Invoice not found" });
          return;
        }

        const items = await db
          .select()
          .from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, invoiceId));

        const tickets: Array<{
          ticketType: "billing_sheet" | "work_order" | "wcb";
          ticketId: number;
          description: string;
          workDate: string | null;
          partsSubtotal: string;
          laborSubtotal: string;
          totalAmount: string;
          ticketNumber: string | null;
        }> = [];

        for (const item of items) {
          if (item.sourceType === "billing_sheet" && item.billingSheetId) {
            const bs = await storage.getBillingSheetById(item.billingSheetId, callerCompanyId);
            if (bs && !tickets.find((t) => t.ticketType === "billing_sheet" && t.ticketId === bs.id)) {
              tickets.push({
                ticketType: "billing_sheet",
                ticketId: bs.id,
                description: bs.workDescription ?? "",
                workDate: bs.workDate ? new Date(bs.workDate).toISOString() : null,
                partsSubtotal: bs.partsSubtotal ?? "0.00",
                laborSubtotal: bs.laborSubtotal ?? "0.00",
                totalAmount: bs.totalAmount ?? "0.00",
                ticketNumber: bs.billingNumber ?? null,
              });
            }
          } else if (item.sourceType === "work_order" && item.workOrderId) {
            const wo = await storage.getWorkOrder(item.workOrderId, callerCompanyId);
            if (wo && !tickets.find((t) => t.ticketType === "work_order" && t.ticketId === wo.id)) {
              tickets.push({
                ticketType: "work_order",
                ticketId: wo.id,
                description: wo.projectName ?? wo.description ?? "",
                workDate: wo.completedAt ? new Date(wo.completedAt).toISOString() : null,
                partsSubtotal: wo.partsSubtotal ?? "0.00",
                laborSubtotal: wo.laborSubtotal ?? "0.00",
                totalAmount: wo.totalAmount ?? "0.00",
                ticketNumber: wo.workOrderNumber ?? null,
              });
            }
          } else if (item.sourceType === "wet_check_billing" && item.wetCheckBillingId) {
            const wcb = await storage.getWetCheckBillingById(item.wetCheckBillingId, callerCompanyId);
            if (wcb && !tickets.find((t) => t.ticketType === "wcb" && t.ticketId === wcb.id)) {
              tickets.push({
                ticketType: "wcb",
                ticketId: wcb.id,
                description: wcb.propertyAddress ?? wcb.notes ?? "",
                workDate: wcb.workDate ? new Date(wcb.workDate).toISOString() : null,
                partsSubtotal: wcb.partsSubtotal ?? "0.00",
                laborSubtotal: wcb.laborSubtotal ?? "0.00",
                totalAmount: wcb.totalAmount ?? "0.00",
                ticketNumber: wcb.billingNumber ?? null,
              });
            }
          }
        }

        res.json({ invoiceId, tickets });
      } catch (err) {
        req.log?.error?.({ err }, "correction-tickets fetch failed");
        res.status(500).json({ message: "Failed to fetch invoice tickets" });
      }
    },
  );

  // ── GET /api/invoice-corrections/:id ────────────────────────────────────
  app.get(
    "/api/invoice-corrections/:id",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid correction ID" });
          return;
        }
        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);

        const [correction] = await db
          .select()
          .from(invoiceCorrections)
          .where(
            callerCompanyId != null
              ? and(eq(invoiceCorrections.id, id), eq(invoiceCorrections.companyId, callerCompanyId))
              : eq(invoiceCorrections.id, id),
          )
          .limit(1);

        if (!correction) {
          res.status(404).json({ message: "Correction not found" });
          return;
        }

        const lines = await db
          .select()
          .from(invoiceCorrectionLines)
          .where(eq(invoiceCorrectionLines.correctionId, id));

        res.json({ correction, lines });
      } catch (err) {
        req.log?.error?.({ err }, "correction fetch failed");
        res.status(500).json({ message: "Failed to fetch correction" });
      }
    },
  );

  // ── POST /api/invoice-corrections ───────────────────────────────────────
  // Open a draft correction for an issued invoice. Only one active (non-canceled)
  // correction per invoice at a time.
  app.post(
    "/api/invoice-corrections",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const parsed = openCorrectionSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
          return;
        }

        const { invoiceId } = parsed.data;
        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);

        const invoice = await storage.getInvoiceById(invoiceId, callerCompanyId);
        if (!invoice) {
          res.status(404).json({ message: "Invoice not found" });
          return;
        }

        // Only issued invoices (non-draft, non-cancelled, non-superseded) can
        // be corrected.
        const correctable = ["sent", "paid", "overdue", "generated"];
        if (!correctable.includes(invoice.status)) {
          res.status(400).json({
            message: `Invoice status "${invoice.status}" is not eligible for correction. Only issued invoices can be corrected.`,
          });
          return;
        }

        // Guard against double corrections on the same invoice.
        const existing = await db
          .select({ id: invoiceCorrections.id })
          .from(invoiceCorrections)
          .where(
            and(
              eq(invoiceCorrections.originalInvoiceId, invoiceId),
              eq(invoiceCorrections.status, "draft"),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          res.status(409).json({
            message: "There is already an open draft correction for this invoice.",
            correctionId: existing[0].id,
          });
          return;
        }

        const [correction] = await db
          .insert(invoiceCorrections)
          .values({
            companyId: invoice.companyId,
            customerId: invoice.customerId,
            originalInvoiceId: invoiceId,
            status: "draft",
            qbSyncStatus: "pending",
            createdByUserId: req.authenticatedUserId ?? null,
          })
          .returning();

        res.status(201).json({ correction, lines: [] });
      } catch (err) {
        req.log?.error?.({ err }, "open correction failed");
        res.status(500).json({ message: "Failed to open correction" });
      }
    },
  );

  // ── PATCH /api/invoice-corrections/:id ──────────────────────────────────
  // Update reason fields, evidence, and/or correction line snapshots.
  app.patch(
    "/api/invoice-corrections/:id",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid correction ID" });
          return;
        }

        const parsed = updateCorrectionSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
          return;
        }

        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);

        const [correction] = await db
          .select()
          .from(invoiceCorrections)
          .where(
            callerCompanyId != null
              ? and(eq(invoiceCorrections.id, id), eq(invoiceCorrections.companyId, callerCompanyId))
              : eq(invoiceCorrections.id, id),
          )
          .limit(1);

        if (!correction) {
          res.status(404).json({ message: "Correction not found" });
          return;
        }

        if (correction.status === "canceled" || correction.status === "reissued" || correction.status === "qb_synced") {
          res.status(400).json({ message: `Cannot edit a correction in "${correction.status}" status` });
          return;
        }

        const { lines, ...fields } = parsed.data;

        // Update correction header fields.
        const [updated] = await db
          .update(invoiceCorrections)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(invoiceCorrections.id, id))
          .returning();

        // Replace lines if provided.
        let updatedLines = await db
          .select()
          .from(invoiceCorrectionLines)
          .where(eq(invoiceCorrectionLines.correctionId, id));

        if (lines !== undefined) {
          // Delete existing lines and re-insert.
          await db
            .delete(invoiceCorrectionLines)
            .where(eq(invoiceCorrectionLines.correctionId, id));

          if (lines.length > 0) {
            const lineRows = lines.map((l) => ({
              companyId: correction.companyId,
              correctionId: id,
              ticketType: l.ticketType,
              ticketId: l.ticketId,
              beforeParts: l.beforeParts ?? null,
              beforeLabor: l.beforeLabor ?? null,
              beforeTotal: l.beforeTotal ?? null,
              afterParts: l.afterParts ?? null,
              afterLabor: l.afterLabor ?? null,
              afterTotal: l.afterTotal ?? null,
              action: l.action,
              lineNote: l.lineNote ?? null,
            }));
            updatedLines = await db
              .insert(invoiceCorrectionLines)
              .values(lineRows)
              .returning();
          } else {
            updatedLines = [];
          }
        }

        res.json({ correction: updated, lines: updatedLines });
      } catch (err) {
        req.log?.error?.({ err }, "update correction failed");
        res.status(500).json({ message: "Failed to update correction" });
      }
    },
  );

  // ── POST /api/invoice-corrections/:id/reissue ────────────────────────────
  // Create a corrected invoice that supersedes the original. The invoice
  // number gets a -R1 (or -R2, etc.) suffix. The original invoice is marked
  // `superseded`. Ticket totals are re-derived from live DB state.
  app.post(
    "/api/invoice-corrections/:id/reissue",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid correction ID" });
          return;
        }

        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);

        const [correction] = await db
          .select()
          .from(invoiceCorrections)
          .where(
            callerCompanyId != null
              ? and(eq(invoiceCorrections.id, id), eq(invoiceCorrections.companyId, callerCompanyId))
              : eq(invoiceCorrections.id, id),
          )
          .limit(1);

        if (!correction) {
          res.status(404).json({ message: "Correction not found" });
          return;
        }

        if (correction.status !== "draft" && correction.status !== "reviewed") {
          res.status(400).json({
            message: `Correction is in "${correction.status}" status and cannot be reissued.`,
          });
          return;
        }

        const originalInvoice = await storage.getInvoiceById(correction.originalInvoiceId, callerCompanyId);
        if (!originalInvoice) {
          res.status(404).json({ message: "Original invoice not found" });
          return;
        }

        // Get correction lines to know which tickets to exclude.
        const lines = await db
          .select()
          .from(invoiceCorrectionLines)
          .where(eq(invoiceCorrectionLines.correctionId, id));

        const excludedTickets = lines
          .filter((l) => l.action === "exclude")
          .map((l) => ({ ticketType: l.ticketType, ticketId: l.ticketId }));

        // Derive live totals from the (now-edited) source tickets.
        const liveTotals = await computeLiveTotalsFromTickets(
          correction.originalInvoiceId,
          excludedTickets,
        );

        const reissuedNumber = deriveRevisionNumber(originalInvoice.invoiceNumber);

        // Create the reissued invoice inside a DB transaction.
        const result = await db.transaction(async (tx) => {
          // Mark original as superseded.
          await tx
            .update(invoices)
            .set({ status: "superseded", updatedAt: new Date() })
            .where(eq(invoices.id, correction.originalInvoiceId));

          // Create the new invoice (same period/customer, corrected totals).
          const [newInvoice] = await tx
            .insert(invoices)
            .values({
              invoiceNumber: reissuedNumber,
              customerId: originalInvoice.customerId,
              companyId: originalInvoice.companyId,
              customerName: originalInvoice.customerName,
              customerEmail: originalInvoice.customerEmail,
              customerPhone: originalInvoice.customerPhone ?? null,
              invoiceMonth: originalInvoice.invoiceMonth,
              invoiceYear: originalInvoice.invoiceYear,
              periodStart: originalInvoice.periodStart,
              periodEnd: originalInvoice.periodEnd,
              status: "draft",
              partsSubtotal: liveTotals.partsSubtotal.toFixed(2),
              laborSubtotal: liveTotals.laborSubtotal.toFixed(2),
              totalAmount: liveTotals.totalAmount.toFixed(2),
              dueDate: originalInvoice.dueDate ?? null,
            })
            .returning();

          // Copy invoice items (excluding excluded tickets) to the new invoice.
          const originalItems = await tx
            .select()
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, correction.originalInvoiceId));

          for (const item of originalItems) {
            const isExcluded = excludedTickets.some(
              (e) =>
                (e.ticketType === "billing_sheet" && e.ticketId === item.billingSheetId) ||
                (e.ticketType === "work_order" && e.ticketId === item.workOrderId) ||
                (e.ticketType === "wcb" && e.ticketId === item.wetCheckBillingId),
            );
            if (isExcluded) continue;

            // Re-derive item total from live ticket.
            let itemTotal = parseFloat(String(item.totalPrice ?? "0"));
            if (item.sourceType === "billing_sheet" && item.billingSheetId) {
              const [bs] = await tx
                .select({ totalAmount: billingSheets.totalAmount })
                .from(billingSheets)
                .where(eq(billingSheets.id, item.billingSheetId))
                .limit(1);
              if (bs) itemTotal = parseFloat(String(bs.totalAmount ?? "0"));
            } else if (item.sourceType === "work_order" && item.workOrderId) {
              const [wo] = await tx
                .select({ totalAmount: workOrders.totalAmount })
                .from(workOrders)
                .where(eq(workOrders.id, item.workOrderId))
                .limit(1);
              if (wo) itemTotal = parseFloat(String(wo.totalAmount ?? "0"));
            } else if (item.sourceType === "wet_check_billing" && item.wetCheckBillingId) {
              const [wcb] = await tx
                .select({ totalAmount: wetCheckBillings.totalAmount })
                .from(wetCheckBillings)
                .where(eq(wetCheckBillings.id, item.wetCheckBillingId))
                .limit(1);
              if (wcb) itemTotal = parseFloat(String(wcb.totalAmount ?? "0"));
            }

            await tx.insert(invoiceItems).values({
              invoiceId: newInvoice.id,
              sourceType: item.sourceType,
              sourceId: item.sourceId,
              workOrderId: item.workOrderId ?? null,
              billingSheetId: item.billingSheetId ?? null,
              wetCheckBillingId: item.wetCheckBillingId ?? null,
              workDate: item.workDate,
              description: item.description,
              totalPrice: itemTotal.toFixed(2),
            });

            // Re-point the source ticket's invoiceId to the new invoice so
            // it's not double-billed on the next monthly run.
            if (item.sourceType === "billing_sheet" && item.billingSheetId) {
              await tx
                .update(billingSheets)
                .set({ invoiceId: newInvoice.id, updatedAt: new Date() })
                .where(eq(billingSheets.id, item.billingSheetId));
            } else if (item.sourceType === "work_order" && item.workOrderId) {
              await tx
                .update(workOrders)
                .set({ invoiceId: newInvoice.id, updatedAt: new Date() })
                .where(eq(workOrders.id, item.workOrderId));
            } else if (item.sourceType === "wet_check_billing" && item.wetCheckBillingId) {
              await tx
                .update(wetCheckBillings)
                .set({ invoiceId: newInvoice.id, updatedAt: new Date() })
                .where(eq(wetCheckBillings.id, item.wetCheckBillingId));
            }
          }

          // Stamp the original invoice with the superseded-by link.
          await tx
            .update(invoices)
            .set({ supersededByInvoiceId: newInvoice.id })
            .where(eq(invoices.id, correction.originalInvoiceId));

          // Finalize the correction record.
          const originalTotal = parseFloat(String(originalInvoice.totalAmount));
          const correctedTotal = liveTotals.totalAmount;
          const [updatedCorrection] = await tx
            .update(invoiceCorrections)
            .set({
              status: "reissued",
              reissuedInvoiceId: newInvoice.id,
              originalTotal: originalTotal.toFixed(2),
              correctedTotal: correctedTotal.toFixed(2),
              deltaAmount: (correctedTotal - originalTotal).toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(invoiceCorrections.id, id))
            .returning();

          return { correction: updatedCorrection, reissuedInvoice: newInvoice };
        });

        res.status(200).json({
          message: `Invoice reissued as ${reissuedNumber}.`,
          correction: result.correction,
          reissuedInvoice: result.reissuedInvoice,
          originalInvoiceId: correction.originalInvoiceId,
        });
      } catch (err) {
        req.log?.error?.({ err }, "reissue correction failed");
        res.status(500).json({ message: "Failed to reissue correction" });
      }
    },
  );

  // ── POST /api/invoice-corrections/:id/qb-sync ────────────────────────────
  // TODO (Slice 4): carry the original quickbooksInvoiceId + quickbooksSyncToken
  // onto the reissued invoice and call updateQbInvoiceInPlace. The QB SyncToken
  // Capture prerequisite has not yet merged; stub returns 501 with a clear message
  // so the rest of the correction flow ships independently.
  app.post(
    "/api/invoice-corrections/:id/qb-sync",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      const id = parseInt(String(req.params.id));
      if (isNaN(id) || id <= 0) {
        res.status(400).json({ message: "Invalid correction ID" });
        return;
      }

      const callerCompanyId: number | null =
        req.authenticatedUserRole === "super_admin"
          ? null
          : (req.authenticatedUserCompanyId ?? null);

      const [correction] = await db
        .select()
        .from(invoiceCorrections)
        .where(
          callerCompanyId != null
            ? and(eq(invoiceCorrections.id, id), eq(invoiceCorrections.companyId, callerCompanyId))
            : eq(invoiceCorrections.id, id),
        )
        .limit(1);

      if (!correction) {
        res.status(404).json({ message: "Correction not found" });
        return;
      }

      if (correction.status !== "reissued") {
        res.status(400).json({
          message: "Only reissued corrections can be QB-synced. Complete the reissue step first.",
        });
        return;
      }

      // Record the skipped/stub status so the correction can be retried later.
      await db
        .update(invoiceCorrections)
        .set({
          qbSyncStatus: "skipped",
          qbNote: "QB SyncToken Capture not yet available — sync manually in QuickBooks.",
          updatedAt: new Date(),
        })
        .where(eq(invoiceCorrections.id, id));

      res.status(501).json({
        message:
          "QuickBooks in-place update is not yet available (prerequisite not merged). " +
          "The correction has been recorded as reissued. Sync the QuickBooks invoice manually, " +
          "or retry this endpoint once the QB SyncToken Capture feature ships.",
        qbSyncStatus: "skipped",
      });
    },
  );

  // ── POST /api/invoice-corrections/:id/cancel ─────────────────────────────
  // Cancel a draft correction. The original invoice is NOT modified;
  // tickets remain in their (possibly edited) state.
  app.post(
    "/api/invoice-corrections/:id/cancel",
    requireAuthentication,
    requireBillingAccess,
    async (req: any, res) => {
      try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id) || id <= 0) {
          res.status(400).json({ message: "Invalid correction ID" });
          return;
        }

        const callerCompanyId: number | null =
          req.authenticatedUserRole === "super_admin"
            ? null
            : (req.authenticatedUserCompanyId ?? null);

        const [correction] = await db
          .select()
          .from(invoiceCorrections)
          .where(
            callerCompanyId != null
              ? and(eq(invoiceCorrections.id, id), eq(invoiceCorrections.companyId, callerCompanyId))
              : eq(invoiceCorrections.id, id),
          )
          .limit(1);

        if (!correction) {
          res.status(404).json({ message: "Correction not found" });
          return;
        }

        if (correction.status === "reissued" || correction.status === "qb_synced") {
          res.status(400).json({
            message: `Cannot cancel a correction that has already been ${correction.status}.`,
          });
          return;
        }

        if (correction.status === "canceled") {
          res.status(400).json({ message: "Correction is already canceled." });
          return;
        }

        const [updated] = await db
          .update(invoiceCorrections)
          .set({ status: "canceled", updatedAt: new Date() })
          .where(eq(invoiceCorrections.id, id))
          .returning();

        res.json({ correction: updated, message: "Correction canceled." });
      } catch (err) {
        req.log?.error?.({ err }, "cancel correction failed");
        res.status(500).json({ message: "Failed to cancel correction" });
      }
    },
  );
}

// ── Exported helper: check if an invoiced ticket can be unlocked ──────────
// Used by billing-sheet item update routes to allow edits inside a correction.
export async function getOpenCorrectionForInvoice(
  invoiceId: number,
  companyId: number | null,
): Promise<{ id: number } | null> {
  const where =
    companyId != null
      ? and(
          eq(invoiceCorrections.originalInvoiceId, invoiceId),
          eq(invoiceCorrections.status, "draft"),
          eq(invoiceCorrections.companyId, companyId),
        )
      : and(
          eq(invoiceCorrections.originalInvoiceId, invoiceId),
          eq(invoiceCorrections.status, "draft"),
        );

  const rows = await db
    .select({ id: invoiceCorrections.id })
    .from(invoiceCorrections)
    .where(where)
    .limit(1);

  return rows[0] ?? null;
}

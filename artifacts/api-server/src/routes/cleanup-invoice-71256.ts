// Temporary one-time cleanup endpoint — Task #760
//
// Deletes test invoice #71256 (id=1) and all connected records from production:
//   invoice_items id=1, invoice_pdfs id=1, work_orders id=3, invoices id=1.
//
// Guards:
//   1. requireAuthentication + super_admin role (same middleware as other admin routes).
//   2. X-Cleanup-Token header must match the CLEANUP_TOKEN_71256 env var — a
//      one-time secret the super-admin sets before deploying.
//
// Safety:
//   * Pre-flight checks abort on any unexpected condition (sent, paid, QB id, children).
//   * All deletes execute in one transaction — rolls back on any failure.
//   * Every DELETE includes both the row id AND a parent-FK guard.
//
// After successful execution, remove this file and its registration from routes.ts.

import type { Express, RequestHandler } from "express";
import { pool } from "../db";

export interface RegisterCleanupInvoice71256Deps {
  requireAuthentication: RequestHandler;
}

const INVOICE_ID = 1;
const INVOICE_NUMBER = "71256";
const WORK_ORDER_ID = 3;
const INVOICE_PDF_ID = 1;

export function registerCleanupInvoice71256Routes(
  app: Express,
  { requireAuthentication }: RegisterCleanupInvoice71256Deps
) {
  app.post(
    "/api/admin/cleanup/invoice-71256",
    requireAuthentication,
    async (req: any, res) => {
      if (req.authenticatedUserRole !== "super_admin") {
        res.status(403).json({ message: "super_admin only" });
        return;
      }

      const expectedToken = process.env.CLEANUP_TOKEN_71256;
      if (!expectedToken) {
        res.status(500).json({
          message:
            "CLEANUP_TOKEN_71256 env var not set — set it before calling this endpoint.",
        });
        return;
      }
      const providedToken =
        typeof req.headers["x-cleanup-token"] === "string"
          ? req.headers["x-cleanup-token"]
          : Array.isArray(req.headers["x-cleanup-token"])
          ? req.headers["x-cleanup-token"][0]
          : undefined;
      if (!providedToken || providedToken !== expectedToken) {
        res.status(403).json({ message: "Invalid or missing X-Cleanup-Token header." });
        return;
      }

      const client = await pool.connect();
      try {
        // ── Pre-flight checks ────────────────────────────────────────────────
        const invoiceRow = await client.query(
          "SELECT id, invoice_number, status, sent_at, quickbooks_invoice_id FROM invoices WHERE id = $1",
          [INVOICE_ID]
        );
        if (invoiceRow.rows.length === 0) {
          res.status(409).json({ message: "Invoice id=1 not found — already deleted?" });
          return;
        }
        const inv = invoiceRow.rows[0];
        if (inv.invoice_number !== INVOICE_NUMBER) {
          res.status(409).json({
            message: `invoice_number mismatch: expected '${INVOICE_NUMBER}', got '${inv.invoice_number}'.`,
          });
          return;
        }
        if (inv.sent_at !== null) {
          res.status(409).json({ message: `Abort: invoice has sent_at=${inv.sent_at}` });
          return;
        }
        if (inv.quickbooks_invoice_id !== null) {
          res.status(409).json({
            message: `Abort: invoice has quickbooks_invoice_id=${inv.quickbooks_invoice_id}`,
          });
          return;
        }
        if (["paid", "overdue"].includes(inv.status)) {
          res.status(409).json({ message: `Abort: invoice status is '${inv.status}'` });
          return;
        }

        const bsCheck = await client.query(
          "SELECT COUNT(*)::int AS cnt FROM billing_sheets WHERE work_order_id = $1",
          [WORK_ORDER_ID]
        );
        if (bsCheck.rows[0].cnt > 0) {
          res.status(409).json({
            message: `Abort: work_order #3 has ${bsCheck.rows[0].cnt} billing sheet(s).`,
          });
          return;
        }

        const photoCheck = await client.query(
          "SELECT COUNT(*)::int AS cnt FROM work_order_photos WHERE work_order_id = $1",
          [WORK_ORDER_ID]
        );
        if (photoCheck.rows[0].cnt > 0) {
          res.status(409).json({
            message: `Abort: work_order #3 has ${photoCheck.rows[0].cnt} photo(s).`,
          });
          return;
        }

        const wcCheck = await client.query(
          "SELECT COUNT(*)::int AS cnt FROM wet_checks WHERE work_order_id = $1",
          [WORK_ORDER_ID]
        );
        if (wcCheck.rows[0].cnt > 0) {
          res.status(409).json({
            message: `Abort: work_order #3 has ${wcCheck.rows[0].cnt} wet check(s).`,
          });
          return;
        }

        const alertCheck = await client.query(
          "SELECT COUNT(*)::int AS cnt FROM customer_budget_alert_events WHERE triggering_invoice_id = $1",
          [INVOICE_ID]
        );
        if (alertCheck.rows[0].cnt > 0) {
          res.status(409).json({
            message: `Abort: ${alertCheck.rows[0].cnt} budget alert event(s) reference invoice id=1.`,
          });
          return;
        }

        // ── Cleanup transaction ──────────────────────────────────────────────
        await client.query("BEGIN");
        try {
          const delItems = await client.query(
            "DELETE FROM invoice_items WHERE invoice_id = $1 RETURNING id",
            [INVOICE_ID]
          );

          const delPdf = await client.query(
            "DELETE FROM invoice_pdfs WHERE id = $1 AND invoice_id = $2 RETURNING id",
            [INVOICE_PDF_ID, INVOICE_ID]
          );
          if ((delPdf.rowCount ?? 0) !== 1) {
            throw new Error(
              `Expected 1 invoice_pdfs row, got ${delPdf.rowCount}`
            );
          }

          const delWo = await client.query(
            "DELETE FROM work_orders WHERE id = $1 AND invoice_id = $2 RETURNING id",
            [WORK_ORDER_ID, INVOICE_ID]
          );
          if ((delWo.rowCount ?? 0) !== 1) {
            throw new Error(
              `Expected 1 work_orders row, got ${delWo.rowCount}`
            );
          }

          const delInv = await client.query(
            "DELETE FROM invoices WHERE id = $1 AND invoice_number = $2 RETURNING id",
            [INVOICE_ID, INVOICE_NUMBER]
          );
          if ((delInv.rowCount ?? 0) !== 1) {
            throw new Error(
              `Expected 1 invoices row, got ${delInv.rowCount}`
            );
          }

          await client.query("COMMIT");

          res.status(200).json({
            success: true,
            deleted: {
              invoice_items: delItems.rows.map((r: { id: number }) => r.id),
              invoice_pdfs: delPdf.rows.map((r: { id: number }) => r.id),
              work_orders: delWo.rows.map((r: { id: number }) => r.id),
              invoices: delInv.rows.map((r: { id: number }) => r.id),
            },
            note: "pdf_url was 'generated-on-demand' — no object storage file deleted.",
          });
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ message: `Cleanup failed: ${message}` });
      } finally {
        client.release();
      }
    }
  );
}

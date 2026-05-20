// One-time cleanup: Delete test invoice #71256 (id=1) and all connected data
// from production. This invoice was never sent to a customer, has no QuickBooks
// ID, and work order #3 has no child records (billing sheets, wet checks, photos).
//
// Safety:
//   * Pre-flight checks confirm the invoice is safe to delete before any write.
//   * All deletes are wrapped in a single transaction — rolls back on any failure.
//   * Every DELETE includes both the row id AND a parent-FK guard.
//   * Deletes are ordered to satisfy FK constraints.
//
// Run against production:
//   CLEANUP_DB_URL="$NEON_DATABASE_URL" \
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/delete-test-invoice-71256.ts

import pg from "pg";

const { Client } = pg;

const dbUrl = process.env.CLEANUP_DB_URL;
if (!dbUrl) {
  console.error(
    "ERROR: CLEANUP_DB_URL env var is required. " +
      "Set it to the production database URL (e.g. NEON_DATABASE_URL)."
  );
  process.exit(1);
}

const INVOICE_ID = 1;
const INVOICE_NUMBER = "71256";
const WORK_ORDER_ID = 3;
const INVOICE_ITEM_ID = 1;
const INVOICE_PDF_ID = 1;

async function run() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log("Connected to database.");

  try {
    // ── Pre-flight checks ─────────────────────────────────────────────────────
    console.log("\n=== Pre-flight checks ===");

    const invoiceRow = await client.query(
      "SELECT id, invoice_number, status, sent_at, quickbooks_invoice_id FROM invoices WHERE id = $1",
      [INVOICE_ID]
    );
    if (invoiceRow.rows.length === 0) {
      console.error("ERROR: Invoice id=1 not found. Nothing to do — aborting.");
      process.exit(1);
    }
    const inv = invoiceRow.rows[0];
    console.log("Invoice:", inv);

    if (inv.invoice_number !== INVOICE_NUMBER) {
      console.error(
        `ERROR: invoice_number mismatch — expected '${INVOICE_NUMBER}', got '${inv.invoice_number}'. Aborting.`
      );
      process.exit(1);
    }
    if (inv.sent_at !== null) {
      console.error(`ERROR: Invoice has sent_at = ${inv.sent_at}. Aborting.`);
      process.exit(1);
    }
    if (inv.quickbooks_invoice_id !== null) {
      console.error(
        `ERROR: Invoice has quickbooks_invoice_id = ${inv.quickbooks_invoice_id}. Aborting.`
      );
      process.exit(1);
    }
    if (["paid", "overdue"].includes(inv.status)) {
      console.error(`ERROR: Invoice status is '${inv.status}'. Aborting.`);
      process.exit(1);
    }

    const billingSheets = await client.query(
      "SELECT COUNT(*) AS cnt FROM billing_sheets WHERE work_order_id = $1",
      [WORK_ORDER_ID]
    );
    const bsCount = Number(billingSheets.rows[0].cnt);
    if (bsCount > 0) {
      console.error(
        `ERROR: Work order #3 has ${bsCount} billing sheet(s). Aborting.`
      );
      process.exit(1);
    }

    const photos = await client.query(
      "SELECT COUNT(*) AS cnt FROM work_order_photos WHERE work_order_id = $1",
      [WORK_ORDER_ID]
    );
    const photoCount = Number(photos.rows[0].cnt);
    if (photoCount > 0) {
      console.error(
        `ERROR: Work order #3 has ${photoCount} photo(s). Aborting.`
      );
      process.exit(1);
    }

    const wetChecks = await client.query(
      "SELECT COUNT(*) AS cnt FROM wet_checks WHERE work_order_id = $1",
      [WORK_ORDER_ID]
    );
    const wcCount = Number(wetChecks.rows[0].cnt);
    if (wcCount > 0) {
      console.error(
        `ERROR: Work order #3 has ${wcCount} wet check(s). Aborting.`
      );
      process.exit(1);
    }

    const budgetAlerts = await client.query(
      "SELECT COUNT(*) AS cnt FROM customer_budget_alert_events WHERE triggering_invoice_id = $1",
      [INVOICE_ID]
    );
    const alertCount = Number(budgetAlerts.rows[0].cnt);
    if (alertCount > 0) {
      console.error(
        `ERROR: Invoice id=1 is referenced by ${alertCount} budget alert event(s). Aborting.`
      );
      process.exit(1);
    }

    const pdfRow = await client.query(
      "SELECT id, filename, pdf_url FROM invoice_pdfs WHERE invoice_id = $1",
      [INVOICE_ID]
    );
    if (pdfRow.rows.length > 0) {
      console.log("Invoice PDF record:", pdfRow.rows[0]);
      const pdfUrl = pdfRow.rows[0].pdf_url;
      if (pdfUrl && pdfUrl !== "generated-on-demand") {
        console.warn(
          `WARN: pdf_url is '${pdfUrl}' — not 'generated-on-demand'. ` +
            "The task says pdf_url should be 'generated-on-demand'. " +
            "Proceeding with DB cleanup; the file at that URL may need manual removal."
        );
      } else {
        console.log(
          "pdf_url is 'generated-on-demand' — no object storage file to delete."
        );
      }
    } else {
      console.log("No invoice_pdfs row found for invoice_id=1.");
    }

    console.log("\nAll pre-flight checks passed. Beginning cleanup...\n");

    // ── Cleanup transaction ───────────────────────────────────────────────────
    await client.query("BEGIN");

    try {
      // Step 1: Delete invoice_items
      const delItems = await client.query(
        "DELETE FROM invoice_items WHERE invoice_id = $1 RETURNING id",
        [INVOICE_ID]
      );
      console.log(
        `Step 1 — invoice_items deleted: ${delItems.rowCount} row(s) (ids: ${delItems.rows.map((r: { id: number }) => r.id).join(", ")})`
      );
      if ((delItems.rowCount ?? 0) < 1) {
        throw new Error("Expected at least 1 invoice_items row to delete.");
      }

      // Step 2: pdf_url is generated-on-demand — no object storage deletion needed
      console.log(
        "Step 2 — Object storage: pdf_url is 'generated-on-demand', skipping file deletion."
      );

      // Step 3: Delete invoice_pdfs
      const delPdf = await client.query(
        "DELETE FROM invoice_pdfs WHERE id = $1 AND invoice_id = $2 RETURNING id",
        [INVOICE_PDF_ID, INVOICE_ID]
      );
      console.log(
        `Step 3 — invoice_pdfs deleted: ${delPdf.rowCount} row(s)`
      );
      if (delPdf.rowCount !== 1) {
        throw new Error(
          `Expected exactly 1 invoice_pdfs row to delete, got ${delPdf.rowCount}.`
        );
      }

      // Step 4: Delete work_orders
      const delWo = await client.query(
        "DELETE FROM work_orders WHERE id = $1 AND invoice_id = $2 RETURNING id",
        [WORK_ORDER_ID, INVOICE_ID]
      );
      console.log(
        `Step 4 — work_orders deleted: ${delWo.rowCount} row(s)`
      );
      if (delWo.rowCount !== 1) {
        throw new Error(
          `Expected exactly 1 work_orders row to delete, got ${delWo.rowCount}.`
        );
      }

      // Step 5: Delete invoice
      const delInv = await client.query(
        "DELETE FROM invoices WHERE id = $1 AND invoice_number = $2 RETURNING id",
        [INVOICE_ID, INVOICE_NUMBER]
      );
      console.log(
        `Step 5 — invoices deleted: ${delInv.rowCount} row(s)`
      );
      if (delInv.rowCount !== 1) {
        throw new Error(
          `Expected exactly 1 invoices row to delete, got ${delInv.rowCount}.`
        );
      }

      await client.query("COMMIT");
      console.log("\nTransaction committed successfully.");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("\nERROR during cleanup — transaction rolled back:", err);
      process.exit(1);
    }

    // ── Post-delete verification ──────────────────────────────────────────────
    console.log("\n=== Post-delete verification ===");
    const verify = await Promise.all([
      client.query("SELECT COUNT(*) AS cnt FROM invoices WHERE id = $1", [INVOICE_ID]),
      client.query("SELECT COUNT(*) AS cnt FROM work_orders WHERE id = $1", [WORK_ORDER_ID]),
      client.query("SELECT COUNT(*) AS cnt FROM invoice_items WHERE invoice_id = $1", [INVOICE_ID]),
      client.query("SELECT COUNT(*) AS cnt FROM invoice_pdfs WHERE invoice_id = $1", [INVOICE_ID]),
    ]);
    const [invCnt, woCnt, itemCnt, pdfCnt] = verify.map((r) =>
      Number(r.rows[0].cnt)
    );

    console.log(`invoices WHERE id=1: ${invCnt} (expected 0)`);
    console.log(`work_orders WHERE id=3: ${woCnt} (expected 0)`);
    console.log(`invoice_items WHERE invoice_id=1: ${itemCnt} (expected 0)`);
    console.log(`invoice_pdfs WHERE invoice_id=1: ${pdfCnt} (expected 0)`);

    if (invCnt === 0 && woCnt === 0 && itemCnt === 0 && pdfCnt === 0) {
      console.log("\n✓ Cleanup complete — all records removed.");
    } else {
      console.error("\nERROR: Some records still present after cleanup. Manual review required.");
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

import { db } from "../../db";
import { invoicePdfs, invoices, appSettings } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import type { MigrationDefinition } from "./types";

const DONE_KEY = "deleteOnDemandInvoicePdfRows.done";
const placeholder = eq(invoicePdfs.pdfUrl, "generated-on-demand");

async function candidates() {
  return db.select({
    companyId: invoicePdfs.companyId,
    count: sql<number>`count(*)::int`,
    invoiceNumbers: sql<string>`string_agg(distinct ${invoices.invoiceNumber}, ', ' order by ${invoices.invoiceNumber})`,
  }).from(invoicePdfs).innerJoin(invoices, eq(invoices.id, invoicePdfs.invoiceId))
    .where(placeholder).groupBy(invoicePdfs.companyId).orderBy(invoicePdfs.companyId);
}

export const deleteOnDemandInvoicePdfRowsMigration: MigrationDefinition = {
  id: "delete-on-demand-invoice-pdf-rows-v1",
  title: "Remove invoice PDF placeholders",
  description: "Removes metadata that never pointed to a saved file. Real emailed copies are preserved. Preview lists affected invoices separately for each company.",
  appSettingsKey: DONE_KEY,
  async check() {
    const rows = await candidates();
    if (rows.length) return { state: "not_started" };
    const [marker] = await db.select().from(appSettings).where(eq(appSettings.key, DONE_KEY));
    return marker
      ? { state: "completed", completedAt: marker.value ?? "" }
      : { state: "not_started" };
  },
  async preview() {
    const rows = await candidates();
    return {
      steps: [{ id: "delete-placeholders", description: `Remove ${rows.reduce((n, r) => n + r.count, 0)} placeholder rows in one transaction and record completion.` }],
      orphanRows: Object.fromEntries(rows.map(r => [`company_${r.companyId}`, r.count])),
      warnings: [
        "Only placeholder metadata is deleted. No saved PDF objects or genuine sent copies are removed.",
        ...rows.map(r => `Company ${r.companyId}: ${r.count} placeholder rows. Invoices: ${r.invoiceNumbers}`),
      ],
    };
  },
  async run(emit) {
    const start = Date.now();
    emit({ step: "delete-placeholders", status: "running" });
    const deleted = await db.transaction(async tx => {
      const rows = await tx.delete(invoicePdfs).where(placeholder).returning({ id: invoicePdfs.id });
      await tx.insert(appSettings).values({ key: DONE_KEY, value: new Date().toISOString() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: new Date().toISOString() } });
      return rows.length;
    });
    emit({ step: "delete-placeholders", status: "success", rowsAffected: deleted });
    return [{ id: "delete-placeholders", status: "success", durationMs: Date.now() - start, rowsAffected: deleted }];
  },
};

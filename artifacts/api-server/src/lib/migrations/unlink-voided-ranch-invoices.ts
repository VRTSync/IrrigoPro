import { db } from "../../db";
import { appSettings, billingSheets, companies, customers, invoices, workOrders, wetCheckBillings, wetChecks } from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { MigrationDefinition, MigrationPreview, MigrationStatus, MigrationStepResult } from "./types";

export const DONE_KEY = "unlinkVoidedRanchInvoices.done";
export const TARGETS = [
  { id: 92, number: "BS-2026-0088", invoiceId: 21 },
  { id: 138, number: "BS-2026-0120", invoiceId: 44 },
  { id: 227, number: "BS-2026-0195", invoiceId: 44 },
] as const;
const INVOICE_IDS = [21, 44];
const APPROVED = "approved_passed_to_billing";
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// One implementation is used by preview, check, production execution and tests.
// Resolve the named customer uniquely rather than guessing an undocumented
// tenant/customer id. Ambiguous or missing ownership is a discrepancy, not consent.
async function snapshot(q: Executor, lock = false) {
  let customerQuery = q.select({
    id: customers.id, companyId: customers.companyId, name: customers.name,
    irrigoName: customers.irrigoName,
  }).from(customers).where(or(eq(customers.name, "The Ranch"), eq(customers.irrigoName, "The Ranch")));
  const owners = await (lock ? customerQuery.for("update") : customerQuery);
  const companyRows = await q.select({ id: companies.id, name: companies.name }).from(companies)
    .where(inArray(companies.id, owners.map(c => c.companyId)));
  const invoiceQuery = q.select({
    id: invoices.id, companyId: invoices.companyId, customerId: invoices.customerId,
    invoiceNumber: invoices.invoiceNumber, quickbooksInvoiceId: invoices.quickbooksInvoiceId,
    qbVoidDetectedAt: invoices.qbVoidDetectedAt,
  }).from(invoices).where(inArray(invoices.id, INVOICE_IDS));
  // Invoice first, sheets second: same lock order as automatic release.
  const invoiceRows = await (lock ? invoiceQuery.for("update") : invoiceQuery);
  const sheetQuery = q.select({
    id: billingSheets.id, billingNumber: billingSheets.billingNumber,
    companyId: billingSheets.companyId, customerId: billingSheets.customerId,
    invoiceId: billingSheets.invoiceId, billedAt: billingSheets.billedAt,
    status: billingSheets.status, updatedAt: billingSheets.updatedAt,
  }).from(billingSheets).where(or(
    inArray(billingSheets.id, TARGETS.map(t => t.id)),
    inArray(billingSheets.billingNumber, TARGETS.map(t => t.number)),
  ));
  const sheets = await (lock ? sheetQuery.for("update") : sheetQuery);
  return { owners, companies: companyRows, invoices: invoiceRows, sheets };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export function assessTargets(s: Snapshot) {
  return TARGETS.map(target => {
    const sheet = s.sheets.find(r => r.id === target.id);
    const invoice = s.invoices.find(r => r.id === target.invoiceId);
    const owner = s.owners.length === 1 ? s.owners[0] : undefined;
    let error: string | undefined;
    if (!sheet) error = "Missing billing sheet";
    else if (sheet.billingNumber !== target.number) error = "Billing sheet identity mismatch";
    else if (!owner) error = "Missing or ambiguous The Ranch customer";
    else if (!invoice) error = "Missing expected invoice";
    else if (sheet.companyId !== owner.companyId || invoice.companyId !== owner.companyId ||
      sheet.customerId !== owner.id || invoice.customerId !== owner.id)
      error = "Tenant/customer ownership mismatch";
    else if (!invoice.qbVoidDetectedAt) error = "Unconfirmed void: expected invoice has no qbVoidDetectedAt";
    else if (sheet.invoiceId !== null && sheet.invoiceId !== target.invoiceId)
      error = `Link mismatch: now on replacement invoice ${sheet.invoiceId}; untouched`;
    else if (sheet.invoiceId === null && (sheet.billedAt !== null || sheet.status !== APPROVED))
      error = "Unlinked but unresolved billed timestamp/status; refusing to guess";
    return { target, sheet, invoice, error, resolved: !error && sheet!.invoiceId === null };
  });
}

async function informational(q: Executor): Promise<string[]> {
  const details: string[] = [];
  // Deliberately includes the whole affected population, not just the two
  // historical invoices. These are informational and can never widen writes.
  for (const [kind, table] of [["billing sheet", billingSheets], ["work order", workOrders], ["wet check billing", wetCheckBillings]] as const) {
    const rows = await q.select({
      id: table.id, invoiceId: table.invoiceId,
    }).from(table).innerJoin(invoices, eq(table.invoiceId, invoices.id))
      .where(or(isNotNull(invoices.qbVoidDetectedAt), inArray(invoices.id, INVOICE_IDS)));
    for (const row of rows) {
      details.push(`Informational only: ${kind} id ${row.id}, invoice ${row.invoiceId}.`);
    }
  }
  const wetOwners = await q.select({ id: wetCheckBillings.id, companyId: wetChecks.companyId })
    .from(wetCheckBillings).innerJoin(wetChecks, eq(wetChecks.id, wetCheckBillings.wetCheckId))
    .where(inArray(wetCheckBillings.invoiceId, INVOICE_IDS));
  details.push(`Named invoices' wet check billing ownership: ${JSON.stringify(wetOwners)} (informational only).`);
  return details;
}

export function createUnlinkVoidedRanchMigration(database: typeof db = db): MigrationDefinition {
  async function check(): Promise<MigrationStatus> {
    const states = assessTargets(await snapshot(database));
    const [marker] = await database.select().from(appSettings).where(eq(appSettings.key, DONE_KEY));
    const unresolved = states.filter(s => !s.resolved);
    if (!unresolved.length && marker) return { state: "completed", completedAt: marker.value };
    if (marker || states.some(s => s.resolved)) return {
      state: "partially_applied",
      details: unresolved.length
          ? unresolved.map(s => `${s.target.number}: ${s.error ?? "still linked"}`).join("; ")
          : "Targets verified released; completion marker missing.",
    };
    return { state: "not_started" };
  }
  async function preview(): Promise<MigrationPreview> {
    const s = await snapshot(database);
    const states = assessTargets(s);
    return {
      requiresAcknowledgement: true,
      steps: states.map(r => ({
        id: String(r.target.id),
        description: `${r.target.number} (id ${r.target.id}, expected invoice ${r.target.invoiceId}): ` +
          `sheet=${JSON.stringify(r.sheet ?? null)}; expected invoice=${JSON.stringify(r.invoice ?? null)}; ` +
          `result=${r.error ?? (r.resolved ? "already released; no-op" : "release to approved_passed_to_billing")}`,
      })),
      orphanRows: { targets: 3, eligible: states.filter(r => !r.error && !r.resolved).length,
        resolved: states.filter(r => r.resolved).length, discrepancies: states.filter(r => r.error).length },
      warnings: [
        `Owning customer/tenant: ${JSON.stringify(s.owners)}; companies: ${JSON.stringify(s.companies)}.`,
        "Only the three named sheets can change: invoiceId and billedAt become null, status becomes approved_passed_to_billing, updatedAt advances. Invoice history and other documents stay intact. Acknowledgement required.",
        ...states.filter(r => r.error).map(r => `${r.target.number}: ${r.error}`),
        ...await informational(database),
      ],
    };
  }
  return {
    id: "unlink-voided-ranch-invoices",
    title: "Release Ranch sheets from confirmed QuickBooks voids",
    description: "Guarded release of BS-2026-0088, BS-2026-0120 and BS-2026-0195 only.",
    appSettingsKey: DONE_KEY, check, preview,
    async run(emit, opts) {
      const started = Date.now();
      const failed = (error: string): MigrationStepResult => ({
        id: "release", status: "failed", durationMs: Date.now() - started, error,
      });
      if (!opts?.acknowledged) {
        const result = failed("Set acknowledged=true after reviewing the preview.");
        emit({ step: result.id, ...result }); return [result];
      }
      emit({ step: "release", status: "running" });
      try {
        const results = await database.transaction(async tx => {
          const s = await snapshot(tx, true);
          const states = assessTargets(s);
          const results: MigrationStepResult[] = [];
          for (const r of states) {
            const result: MigrationStepResult = { id: String(r.target.id), status: "skipped", durationMs: 0 };
            if (r.error) {
              result.status = "failed"; result.error = r.error;
            } else if (!r.resolved) {
              const changed = await tx.update(billingSheets).set({
                invoiceId: null, billedAt: null, status: APPROVED, updatedAt: new Date(),
              }).where(and(
                eq(billingSheets.id, r.target.id), eq(billingSheets.billingNumber, r.target.number),
                eq(billingSheets.companyId, r.sheet!.companyId),
                eq(billingSheets.customerId, r.sheet!.customerId!),
                eq(billingSheets.invoiceId, r.target.invoiceId),
                // The expected invoice is locked, so its confirmed-void evidence
                // cannot change between assessment and this conditional write.
                sql`exists (select 1 from ${invoices} where ${invoices.id} = ${r.target.invoiceId}
                  and ${invoices.companyId} = ${r.sheet!.companyId}
                  and ${invoices.customerId} = ${r.sheet!.customerId}
                  and ${invoices.qbVoidDetectedAt} is not null)`,
              )).returning({ id: billingSheets.id });
              if (changed.length !== 1) throw new Error(`${r.target.number}: conditional release matched no row`);
              result.status = "success"; result.rowsAffected = 1;
            }
            results.push(result);
          }
          const verified = assessTargets(await snapshot(tx));
          for (const r of verified) {
            if (!r.resolved && !states.find(before => before.target.id === r.target.id)!.error)
              throw new Error(`${r.target.number}: post-write verification failed`);
          }
          if (verified.every(r => r.resolved)) {
            await tx.insert(appSettings).values({ key: DONE_KEY, value: new Date().toISOString(), updatedAt: new Date() })
              .onConflictDoUpdate({ target: appSettings.key, set: { value: new Date().toISOString(), updatedAt: new Date() } });
          }
          return results;
        });
        // Independent post-commit evidence; never trust only UPDATE returning.
        const fresh = assessTargets(await snapshot(database));
        for (const r of results) {
          if (r.status !== "failed" && !fresh.find(f => String(f.target.id) === r.id)?.resolved) {
            r.status = "failed"; delete r.rowsAffected;
            r.error = "Post-commit verification failed; sheet is not released.";
          }
          emit({ step: r.id, status: r.status, rowsAffected: r.rowsAffected, error: r.error });
        }
        return results;
      } catch (error) {
        const result = failed(error instanceof Error ? error.message : String(error));
        emit({ step: result.id, status: result.status, error: result.error }); return [result];
      }
    },
  };
}

export const unlinkVoidedRanchInvoicesMigration = createUnlinkVoidedRanchMigration();

// WC Labor Model Slice 3 — Safe backfill of existing wet check billing labor.
//
// Bucket A: runUnbilledBackfill — finds unbilled WCBs (invoice_id IS NULL) with
//   zero totalHours and recomputes zone repair labor, then updates WCB totals.
//   Per-WCB transactions, dry-run support, resumable via app_settings checkpoint.
//   NEVER touches invoiced WCBs.
//
// Bucket B: runInvoicedReport — finds invoiced WCBs (invoice_id IS NOT NULL) with
//   zero laborSubtotal, computes what labor would have been. NO DB writes.

import { db } from "../db";
import {
  wetCheckBillings,
  wetCheckZoneRecords,
  wetCheckFindings,
  issueTypeConfigs,
  customers,
  appSettings,
} from "@workspace/db";
import { eq, isNull, isNotNull, sql, and } from "drizzle-orm";

// ── Checkpoint keys ────────────────────────────────────────────────────────────

const DONE_KEY = "wcLaborBackfill.done";
const FAILED_KEY = "wcLaborBackfill.failed";

// ── Checkpoint helpers ─────────────────────────────────────────────────────────

export async function loadIdSet(key: string): Promise<Set<number>> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (rows.length === 0) return new Set();
  try {
    const parsed = JSON.parse(String((rows[0] as { value: string }).value));
    if (Array.isArray(parsed)) {
      return new Set(
        parsed
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((n) => Number.isFinite(n)),
      );
    }
  } catch {
    // Corrupt — start fresh.
  }
  return new Set();
}

async function saveIdSet(key: string, ids: Set<number>): Promise<void> {
  const value = JSON.stringify(Array.from(ids).sort((a, b) => a - b));
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function clearCheckpoint(): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, DONE_KEY));
  await db.delete(appSettings).where(eq(appSettings.key, FAILED_KEY));
}

// ── Progress type ──────────────────────────────────────────────────────────────

export interface BackfillProgress {
  state: "idle" | "running" | "done" | "cancelled" | "error";
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  invoicedReport?: InvoicedWcbReport[];
}

export interface InvoicedWcbReport {
  wcbId: number;
  billingNumber: string;
  customerName: string;
  wetCheckId: number;
  invoiceId: number;
  laborRate: string;
  computedLaborHours: string;
  computedLaborSubtotal: string;
  storedLaborSubtotal: string;
  storedTotalAmount: string;
  computedTotalAmount: string;
}

export interface BackfillOptions {
  dryRun?: boolean;
  onProgress?: (p: BackfillProgress) => void;
  cancelSignal?: () => boolean;
}

// ── Inner helper: compute total repair hours for a wet check's zones ───────────
// Mirrors storage._recomputeZoneRepairLaborIfAuto but operates on the full
// zone set for a wet check and uses the outer transaction handle.

async function computeZoneLaborForWetCheck(
  wetCheckId: number,
  companyId: number,
  dryRun: boolean,
): Promise<string> {
  const zones = await db
    .select({
      id: wetCheckZoneRecords.id,
      repairLaborManuallySet: wetCheckZoneRecords.repairLaborManuallySet,
      repairLaborHours: wetCheckZoneRecords.repairLaborHours,
    })
    .from(wetCheckZoneRecords)
    .where(eq(wetCheckZoneRecords.wetCheckId, wetCheckId));

  // Load issueTypeConfigs once for the company
  const configs = await db
    .select({
      issueType: issueTypeConfigs.issueType,
      defaultLaborHours: issueTypeConfigs.defaultLaborHours,
    })
    .from(issueTypeConfigs)
    .where(eq(issueTypeConfigs.companyId, companyId));
  const configMap = new Map(configs.map((c) => [c.issueType, c.defaultLaborHours]));

  let totalHours = 0;

  for (const zone of zones) {
    if (zone.repairLaborManuallySet) {
      // Manual override — honour the stored value without recomputing.
      totalHours += parseFloat(String(zone.repairLaborHours)) || 0;
      continue;
    }

    // Auto zone — sum defaultLaborHours for all findings.
    const findings = await db
      .select({ issueType: wetCheckFindings.issueType })
      .from(wetCheckFindings)
      .where(eq(wetCheckFindings.zoneRecordId, zone.id));

    let zoneHours = 0;
    for (const f of findings) {
      const raw = configMap.get(f.issueType);
      if (raw) zoneHours += parseFloat(String(raw)) || 0;
    }

    if (!dryRun) {
      await db
        .update(wetCheckZoneRecords)
        .set({ repairLaborHours: zoneHours.toFixed(2) })
        .where(eq(wetCheckZoneRecords.id, zone.id));
    }

    totalHours += zoneHours;
  }

  return totalHours.toFixed(2);
}

// ── Helper: get companyId for a WCB via its customerId ────────────────────────

async function getCompanyIdForWcb(customerId: number | null | undefined): Promise<number | null> {
  if (!customerId) return null;
  const rows = await db
    .select({ companyId: customers.companyId })
    .from(customers)
    .where(eq(customers.id, customerId));
  return rows[0]?.companyId ?? null;
}

// ── Bucket A: runUnbilledBackfill ─────────────────────────────────────────────

export async function runUnbilledBackfill(
  options: BackfillOptions = {},
): Promise<BackfillProgress> {
  const { dryRun = false, onProgress, cancelSignal } = options;

  const progress: BackfillProgress = {
    state: "running",
    scanned: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    dryRun,
    startedAt: new Date().toISOString(),
  };

  const emit = () => onProgress?.(structuredClone(progress));

  try {
    const doneSet = await loadIdSet(DONE_KEY);
    const failedSet = await loadIdSet(FAILED_KEY);

    // Find all unbilled WCBs where totalHours is zero.
    const unbilled = await db
      .select({
        id: wetCheckBillings.id,
        billingNumber: wetCheckBillings.billingNumber,
        customerId: wetCheckBillings.customerId,
        wetCheckId: wetCheckBillings.wetCheckId,
        laborRate: wetCheckBillings.laborRate,
        partsSubtotal: wetCheckBillings.partsSubtotal,
        totalHours: wetCheckBillings.totalHours,
        laborSubtotal: wetCheckBillings.laborSubtotal,
        totalAmount: wetCheckBillings.totalAmount,
      })
      .from(wetCheckBillings)
      .where(
        and(
          isNull(wetCheckBillings.invoiceId),
          sql`(${wetCheckBillings.totalHours} = '0.00' OR ${wetCheckBillings.laborSubtotal} = '0.00')`,
        ),
      );

    progress.scanned = unbilled.length;
    emit();

    for (const wcb of unbilled) {
      if (cancelSignal?.()) {
        progress.state = "cancelled";
        progress.finishedAt = new Date().toISOString();
        emit();
        return progress;
      }

      if (doneSet.has(wcb.id)) {
        progress.skipped++;
        emit();
        continue;
      }

      const companyId = await getCompanyIdForWcb(wcb.customerId);
      if (!companyId) {
        // Can't recompute without companyId (issueTypeConfigs are company-scoped).
        failedSet.add(wcb.id);
        await saveIdSet(FAILED_KEY, failedSet);
        progress.failed++;
        emit();
        continue;
      }

      try {
        const newTotalHours = await computeZoneLaborForWetCheck(wcb.wetCheckId, companyId, dryRun);
        const laborRate = parseFloat(String(wcb.laborRate)) || 0;
        const newLaborSubtotal = (parseFloat(newTotalHours) * laborRate).toFixed(2);
        const partsSubtotal = parseFloat(String(wcb.partsSubtotal)) || 0;
        const newTotalAmount = (parseFloat(newLaborSubtotal) + partsSubtotal).toFixed(2);

        if (!dryRun) {
          await db
            .update(wetCheckBillings)
            .set({
              totalHours: newTotalHours,
              laborSubtotal: newLaborSubtotal,
              totalAmount: newTotalAmount,
              updatedAt: new Date(),
            })
            .where(eq(wetCheckBillings.id, wcb.id));

          doneSet.add(wcb.id);
          await saveIdSet(DONE_KEY, doneSet);
        }

        progress.updated++;
        emit();
      } catch (err: any) {
        failedSet.add(wcb.id);
        await saveIdSet(FAILED_KEY, failedSet);
        progress.failed++;
        emit();
      }
    }

    progress.state = "done";
    progress.finishedAt = new Date().toISOString();
    emit();
  } catch (err: any) {
    progress.state = "error";
    progress.errorMessage = err?.message ?? String(err);
    progress.finishedAt = new Date().toISOString();
    emit();
  }

  return progress;
}

// ── Bucket B: runInvoicedReport ────────────────────────────────────────────────

export async function runInvoicedReport(): Promise<InvoicedWcbReport[]> {
  // Find all invoiced WCBs where laborSubtotal is zero.
  const invoiced = await db
    .select({
      id: wetCheckBillings.id,
      billingNumber: wetCheckBillings.billingNumber,
      customerName: wetCheckBillings.customerName,
      customerId: wetCheckBillings.customerId,
      wetCheckId: wetCheckBillings.wetCheckId,
      invoiceId: wetCheckBillings.invoiceId,
      laborRate: wetCheckBillings.laborRate,
      laborSubtotal: wetCheckBillings.laborSubtotal,
      partsSubtotal: wetCheckBillings.partsSubtotal,
      totalAmount: wetCheckBillings.totalAmount,
    })
    .from(wetCheckBillings)
    .where(
      and(
        isNotNull(wetCheckBillings.invoiceId),
        sql`${wetCheckBillings.laborSubtotal} = '0.00'`,
      ),
    );

  const report: InvoicedWcbReport[] = [];

  for (const wcb of invoiced) {
    if (!wcb.invoiceId) continue;

    const companyId = await getCompanyIdForWcb(wcb.customerId);
    if (!companyId) {
      // Include in report with zero computed values.
      report.push({
        wcbId: wcb.id,
        billingNumber: wcb.billingNumber,
        customerName: wcb.customerName,
        wetCheckId: wcb.wetCheckId,
        invoiceId: wcb.invoiceId,
        laborRate: String(wcb.laborRate),
        computedLaborHours: "0.00",
        computedLaborSubtotal: "0.00",
        storedLaborSubtotal: String(wcb.laborSubtotal),
        storedTotalAmount: String(wcb.totalAmount),
        computedTotalAmount: String(wcb.totalAmount),
      });
      continue;
    }

    // Dry-run = true means NO writes to zone records.
    const computedLaborHours = await computeZoneLaborForWetCheck(wcb.wetCheckId, companyId, true);
    const laborRate = parseFloat(String(wcb.laborRate)) || 0;
    const computedLaborSubtotal = (parseFloat(computedLaborHours) * laborRate).toFixed(2);
    const partsSubtotal = parseFloat(String(wcb.partsSubtotal)) || 0;
    const computedTotalAmount = (parseFloat(computedLaborSubtotal) + partsSubtotal).toFixed(2);

    report.push({
      wcbId: wcb.id,
      billingNumber: wcb.billingNumber,
      customerName: wcb.customerName,
      wetCheckId: wcb.wetCheckId,
      invoiceId: wcb.invoiceId,
      laborRate: String(wcb.laborRate),
      computedLaborHours,
      computedLaborSubtotal,
      storedLaborSubtotal: String(wcb.laborSubtotal),
      storedTotalAmount: String(wcb.totalAmount),
      computedTotalAmount,
    });
  }

  return report;
}

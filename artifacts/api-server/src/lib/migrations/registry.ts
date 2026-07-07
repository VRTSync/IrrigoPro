import type { MigrationDefinition } from './types';
import { reconcileBillingSheetInvoiceTotalsMigration } from './reconcile-billing-sheet-invoice-totals';
import { repairWoMatchEstimateMigration } from './repair-wo-match-estimate';
import { reconcileInspectionPassMigration } from './reconcile-inspection-pass';
import { invoiceRevisionBackfillMigration } from './invoice-revision-backfill';

const REGISTRY = new Map<string, MigrationDefinition>([
  [reconcileBillingSheetInvoiceTotalsMigration.id, reconcileBillingSheetInvoiceTotalsMigration],
  [repairWoMatchEstimateMigration.id, repairWoMatchEstimateMigration],
  [reconcileInspectionPassMigration.id, reconcileInspectionPassMigration],
  [invoiceRevisionBackfillMigration.id, invoiceRevisionBackfillMigration],
]);

export function listMigrations(): MigrationDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getMigration(id: string): MigrationDefinition | undefined {
  return REGISTRY.get(id);
}
